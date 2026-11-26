import AVFoundation
import AudioToolbox
import CoreMedia
import Foundation

/**
 * Sound for a screen-share stream: the phone's microphone and the sound of
 * whatever is on screen, mixed into one AAC-LC track (48 kHz stereo).
 *
 * The two sources arrive on their own clocks, in their own formats (the app
 * sound has been seen as 44.1 kHz big-endian, the mic as 48 kHz mono), and
 * either can stop at any moment (the mic is off, nothing is playing). So each
 * is converted to 48 kHz stereo float into its own short queue, and the
 * stream's audio is pulled off a steady clock: whatever each queue holds is
 * mixed, and silence fills the gaps. The stream always has audio, so players
 * never wait on a track that is not coming.
 */
final class LiveAudioMixer {
  enum Source: Int, CaseIterable { case app = 0, mic = 1 }

  static let sampleRate = 48_000.0
  private static let channels = 2
  /// A queue holding more than this has fallen behind the clock; the oldest audio is dropped.
  private static let maxQueued = Int(sampleRate * 0.35)
  /// After running dry a source waits for this much before playing again, so jitter does not crackle.
  private static let primeFrames = 2048

  private var queues: [[Float]] = Array(repeating: [], count: Source.allCases.count)
  private var heads: [Int] = Array(repeating: 0, count: Source.allCases.count)
  private var primed: [Bool] = Array(repeating: false, count: Source.allCases.count)
  private var converters: [AVAudioConverter?] = Array(repeating: nil, count: Source.allCases.count)
  private var formats: [AudioStreamBasicDescription?] = Array(repeating: nil, count: Source.allCases.count)
  private var limiter = LivePeakLimiter(sampleRate: LiveAudioMixer.sampleRate)
  private let output = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 2, interleaved: true)!
  private(set) var lastHeard: [CFTimeInterval] = Array(repeating: 0, count: Source.allCases.count)

  func push(_ sample: CMSampleBuffer, from source: Source) {
    guard let pcm = LiveAudioMixer.planarFloat(sample) else { return }
    let index = source.rawValue
    if formats[index].map({ !LiveAudioMixer.same($0, pcm.asbd) }) ?? true {
      formats[index] = pcm.asbd
      converters[index] = AVAudioConverter(from: pcm.buffer.format, to: output)
    }
    guard let converter = converters[index] else { return }
    let ratio = output.sampleRate / pcm.buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(pcm.buffer.frameLength) * ratio + 64)
    guard let converted = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: capacity) else { return }
    var handed = false
    var error: NSError?
    converter.convert(to: converted, error: &error) { _, status in
      if handed { status.pointee = .noDataNow; return nil }
      handed = true
      status.pointee = .haveData
      return pcm.buffer
    }
    guard error == nil, converted.frameLength > 0, let data = converted.floatChannelData?[0] else { return }
    let count = Int(converted.frameLength) * LiveAudioMixer.channels
    queues[index].append(contentsOf: UnsafeBufferPointer(start: data, count: count))
    lastHeard[index] = CACurrentMediaTime()
    let queued = (queues[index].count - heads[index]) / LiveAudioMixer.channels
    if queued > LiveAudioMixer.maxQueued {
      // Keep the newest ~100 ms.
      let keep = Int(LiveAudioMixer.sampleRate * 0.1) * LiveAudioMixer.channels
      heads[index] = queues[index].count - keep
    }
    if heads[index] > 96_000 { queues[index].removeFirst(heads[index]); heads[index] = 0 }
  }

  /// `frames` frames of interleaved stereo, mixed from whatever is queued.
  func pull(frames: Int) -> [Float] {
    var mix = [Float](repeating: 0, count: frames * LiveAudioMixer.channels)
    for index in queues.indices {
      let queued = (queues[index].count - heads[index]) / LiveAudioMixer.channels
      if !primed[index] {
        if queued >= LiveAudioMixer.primeFrames { primed[index] = true } else { continue }
      }
      let take = min(frames, queued) * LiveAudioMixer.channels
      queues[index].withUnsafeBufferPointer { source in
        for i in 0..<take { mix[i] += source[heads[index] + i] }
      }
      heads[index] += take
      if take < frames * LiveAudioMixer.channels { primed[index] = false }
    }
    limiter.process(&mix)
    return mix
  }

  private static func same(_ a: AudioStreamBasicDescription, _ b: AudioStreamBasicDescription) -> Bool {
    a.mSampleRate == b.mSampleRate && a.mChannelsPerFrame == b.mChannelsPerFrame && a.mFormatFlags == b.mFormatFlags
      && a.mBitsPerChannel == b.mBitsPerChannel && a.mFormatID == b.mFormatID
  }

  /**
   * Reads a PCM sample buffer into native-endian Float32, one buffer per
   * channel, whatever integer/float, endianness or interleaving it came in.
   * Done by hand because the converter does not take every layout ReplayKit
   * produces (big-endian app audio in particular).
   */
  static func planarFloat(_ sample: CMSampleBuffer) -> (buffer: AVAudioPCMBuffer, asbd: AudioStreamBasicDescription)? {
    guard let format = CMSampleBufferGetFormatDescription(sample),
      let pointer = CMAudioFormatDescriptionGetStreamBasicDescription(format) else { return nil }
    let asbd = pointer.pointee
    guard asbd.mFormatID == kAudioFormatLinearPCM, asbd.mChannelsPerFrame > 0, asbd.mSampleRate > 0 else { return nil }
    let frames = CMSampleBufferGetNumSamples(sample)
    guard frames > 0 else { return nil }
    let channels = Int(asbd.mChannelsPerFrame)
    let isFloat = asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0
    let bigEndian = asbd.mFormatFlags & kAudioFormatFlagIsBigEndian != 0
    let nonInterleaved = asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0
    let bits = Int(asbd.mBitsPerChannel)
    guard (isFloat && bits == 32) || (!isFloat && (bits == 16 || bits == 32)) else { return nil }
    let bytesPerSample = bits / 8

    // Raw bytes out of the sample buffer, as it laid them out.
    var listSize = 0
    CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, bufferListSizeNeededOut: &listSize, bufferListOut: nil,
      bufferListSize: 0, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)
    guard listSize > 0 else { return nil }
    let rawList = UnsafeMutableRawPointer.allocate(byteCount: listSize, alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { rawList.deallocate() }
    let list = rawList.bindMemory(to: AudioBufferList.self, capacity: 1)
    var block: CMBlockBuffer?
    guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, bufferListSizeNeededOut: nil, bufferListOut: list,
      bufferListSize: listSize, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
      flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, blockBufferOut: &block) == noErr else { return nil }
    let buffers = UnsafeMutableAudioBufferListPointer(list)

    guard let planar = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: asbd.mSampleRate,
      channels: AVAudioChannelCount(channels), interleaved: false),
      let out = AVAudioPCMBuffer(pcmFormat: planar, frameCapacity: AVAudioFrameCount(frames)),
      let targets = out.floatChannelData else { return nil }
    out.frameLength = AVAudioFrameCount(frames)

    func read(_ base: UnsafeRawPointer, _ index: Int) -> Float {
      let at = base + index * bytesPerSample
      if isFloat {
        var raw = at.loadUnaligned(as: UInt32.self)
        if bigEndian { raw = raw.byteSwapped }
        return Float(bitPattern: raw)
      } else if bits == 16 {
        var raw = at.loadUnaligned(as: UInt16.self)
        if bigEndian { raw = raw.byteSwapped }
        return Float(Int16(bitPattern: raw)) / 32768
      } else {
        var raw = at.loadUnaligned(as: UInt32.self)
        if bigEndian { raw = raw.byteSwapped }
        return Float(Int32(bitPattern: raw)) / 2_147_483_648
      }
    }

    for channel in 0..<channels {
      let target = targets[channel]
      if nonInterleaved {
        guard channel < buffers.count, let data = buffers[channel].mData else { return nil }
        let available = Int(buffers[channel].mDataByteSize) / bytesPerSample
        for frame in 0..<min(frames, available) { target[frame] = read(data, frame) }
      } else {
        guard let first = buffers.first, let data = first.mData else { return nil }
        let available = Int(first.mDataByteSize) / bytesPerSample / channels
        for frame in 0..<min(frames, available) { target[frame] = read(data, frame * channels + channel) }
      }
    }
    return (out, asbd)
  }
}

/// Apply the same gain to both channels only when the combined signal
/// would clip. Recover quickly between peaks so one loud beat doesn't
/// turn down the music that follows it.
struct LivePeakLimiter {
  private var gain: Float = 1
  private let recovery: Float

  init(sampleRate: Double) {
    recovery = 1 / Float(sampleRate * 0.015)
  }

  mutating func process(_ stereo: inout [Float]) {
    for i in stride(from: 0, to: stereo.count, by: 2) {
      let peak = max(abs(stereo[i]), abs(stereo[i + 1]))
      gain = min(1, gain + recovery, peak > 1 ? 1 / peak : 1)
      stereo[i] *= gain
      stereo[i + 1] *= gain
    }
  }
}

/** AAC-LC 48 kHz stereo, one 1024-frame packet per call. */
final class LiveAacEncoder {
  static let framesPerPacket = 1024
  /// AudioSpecificConfig for AAC-LC (2), 48 kHz (index 3), 2 channels.
  static let audioSpecificConfig = Data([0x11, 0x90])
  let bitrate = 128_000

  private var converter: AudioConverterRef?
  // Fixed buffers: the converter reads the input after the callback returns,
  // so it has to live somewhere that does not move.
  private let input = UnsafeMutablePointer<Float>.allocate(capacity: LiveAacEncoder.framesPerPacket * 2)
  private var inputHanded = false
  private var maxPacketSize: UInt32 = 2048
  private let output: UnsafeMutableRawPointer

  init?() {
    var inFormat = AudioStreamBasicDescription(mSampleRate: 48_000, mFormatID: kAudioFormatLinearPCM,
      mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked, mBytesPerPacket: 8, mFramesPerPacket: 1,
      mBytesPerFrame: 8, mChannelsPerFrame: 2, mBitsPerChannel: 32, mReserved: 0)
    var outFormat = AudioStreamBasicDescription(mSampleRate: 48_000, mFormatID: kAudioFormatMPEG4AAC,
      mFormatFlags: UInt32(MPEG4ObjectID.AAC_LC.rawValue), mBytesPerPacket: 0, mFramesPerPacket: UInt32(LiveAacEncoder.framesPerPacket),
      mBytesPerFrame: 0, mChannelsPerFrame: 2, mBitsPerChannel: 0, mReserved: 0)
    var description = AudioClassDescription(mType: kAudioEncoderComponentType, mSubType: kAudioFormatMPEG4AAC,
      mManufacturer: 0x6170_706C)  // 'appl': Apple's software encoder, available in extensions
    var created: AudioConverterRef?
    var status = AudioConverterNewSpecific(&inFormat, &outFormat, 1, &description, &created)
    if status != noErr || created == nil { status = AudioConverterNew(&inFormat, &outFormat, &created) }
    guard status == noErr, let converter = created else {
      output = UnsafeMutableRawPointer.allocate(byteCount: 1, alignment: 16)
      return nil
    }
    self.converter = converter
    var rate = UInt32(bitrate)
    AudioConverterSetProperty(converter, kAudioConverterEncodeBitRate, UInt32(MemoryLayout<UInt32>.size), &rate)
    var size = UInt32(MemoryLayout<UInt32>.size)
    var maxSize: UInt32 = 0
    if AudioConverterGetProperty(converter, kAudioConverterPropertyMaximumOutputPacketSize, &size, &maxSize) == noErr, maxSize > 0 {
      maxPacketSize = maxSize
    }
    output = UnsafeMutableRawPointer.allocate(byteCount: Int(maxPacketSize), alignment: 16)
  }

  deinit {
    if let converter { AudioConverterDispose(converter) }
    input.deallocate()
    output.deallocate()
  }

  /// Encodes 1024 interleaved stereo frames. Nil while the encoder is still
  /// filling its look-ahead, or on error.
  func encode(_ samples: [Float]) -> Data? {
    guard let converter, samples.count == LiveAacEncoder.framesPerPacket * 2 else { return nil }
    samples.withUnsafeBufferPointer { source in
      guard let base = source.baseAddress else { return }
      input.update(from: base, count: samples.count)
    }
    inputHanded = false
    var packets: UInt32 = 1
    var description = AudioStreamPacketDescription()
    var list = AudioBufferList(mNumberBuffers: 1, mBuffers: AudioBuffer(mNumberChannels: 2, mDataByteSize: maxPacketSize, mData: output))
    let status = AudioConverterFillComplexBuffer(converter, { _, ioPackets, ioData, _, context in
      guard let context else { ioPackets.pointee = 0; return 1 }
      let encoder = Unmanaged<LiveAacEncoder>.fromOpaque(context).takeUnretainedValue()
      if encoder.inputHanded { ioPackets.pointee = 0; return 1 }
      encoder.inputHanded = true
      ioPackets.pointee = UInt32(LiveAacEncoder.framesPerPacket)
      ioData.pointee.mNumberBuffers = 1
      ioData.pointee.mBuffers.mNumberChannels = 2
      ioData.pointee.mBuffers.mDataByteSize = UInt32(LiveAacEncoder.framesPerPacket * 2 * MemoryLayout<Float>.size)
      ioData.pointee.mBuffers.mData = UnsafeMutableRawPointer(encoder.input)
      return noErr
    }, Unmanaged.passUnretained(self).toOpaque(), &packets, &list, &description)
    let bytes = Int(list.mBuffers.mDataByteSize)
    guard status == noErr || status == 1, packets > 0, bytes > 0 else { return nil }
    return Data(bytes: output, count: bytes)
  }
}
