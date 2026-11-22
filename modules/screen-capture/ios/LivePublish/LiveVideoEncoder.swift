import CoreMedia
import CoreVideo
import Foundation
import VideoToolbox

/**
 * H.264 for a live stream: real time, no B-frames (WebRTC viewers and the HLS
 * muxer both want frames in order), a keyframe at least every two seconds so a
 * viewer joining mid-stream gets a picture fast, and a bitrate that can be
 * turned down when the uplink cannot keep up.
 *
 * Output is AVCC (4-byte NAL lengths), which is exactly what an RTMP/FLV video
 * message carries, plus the avcC record for the sequence header.
 */
final class LiveVideoEncoder {
  struct Frame {
    let data: Data
    let keyframe: Bool
    let pts: CMTime
    /// The avcC record when it differs from the previous frame's (first frame, new size).
    let config: Data?
  }

  let width: Int32
  let height: Int32
  private var session: VTCompressionSession?
  private var lastConfig: Data?
  private let output: (Frame) -> Void
  private let lock = NSLock()
  private(set) var bitrate: Int

  init?(width: Int32, height: Int32, fps: Int, bitrate: Int, output: @escaping (Frame) -> Void) {
    self.width = width
    self.height = height
    self.bitrate = bitrate
    self.output = output
    var created: VTCompressionSession?
    let status = VTCompressionSessionCreate(
      allocator: kCFAllocatorDefault, width: width, height: height, codecType: kCMVideoCodecType_H264,
      encoderSpecification: nil, imageBufferAttributes: nil, compressedDataAllocator: nil,
      outputCallback: nil, refcon: nil, compressionSessionOut: &created)
    guard status == noErr, let session = created else { return nil }
    self.session = session
    let set = { (key: CFString, value: CFTypeRef) in _ = VTSessionSetProperty(session, key: key, value: value) }
    set(kVTCompressionPropertyKey_RealTime, kCFBooleanTrue)
    set(kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_Main_AutoLevel)
    set(kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse)
    set(kVTCompressionPropertyKey_MaxKeyFrameInterval, NSNumber(value: fps * 2))
    set(kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, NSNumber(value: 2))
    set(kVTCompressionPropertyKey_ExpectedFrameRate, NSNumber(value: fps))
    set(kVTCompressionPropertyKey_H264EntropyMode, kVTH264EntropyMode_CABAC)
    applyBitrate(bitrate)
    VTCompressionSessionPrepareToEncodeFrames(session)
  }

  deinit { invalidate() }

  func invalidate() {
    lock.lock(); defer { lock.unlock() }
    guard let session else { return }
    VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid)
    VTCompressionSessionInvalidate(session)
    self.session = nil
  }

  func setBitrate(_ value: Int) {
    guard value != bitrate else { return }
    bitrate = value
    applyBitrate(value)
  }

  private func applyBitrate(_ value: Int) {
    guard let session else { return }
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AverageBitRate, value: NSNumber(value: value))
    // Cap bursts at 1.5x the average over one second, so a scene change cannot
    // flood an uplink that is only just keeping up.
    let bytesPerSecond = Double(value) * 1.5 / 8
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_DataRateLimits, value: [NSNumber(value: bytesPerSecond), NSNumber(value: 1)] as CFArray)
  }

  func encode(_ buffer: CVPixelBuffer, pts: CMTime, forceKeyframe: Bool) {
    lock.lock(); defer { lock.unlock() }
    guard let session else { return }
    let properties: CFDictionary? = forceKeyframe ? [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue] as CFDictionary : nil
    VTCompressionSessionEncodeFrame(session, imageBuffer: buffer, presentationTimeStamp: pts, duration: .invalid,
      frameProperties: properties, infoFlagsOut: nil) { [weak self] status, _, sample in
      guard status == noErr, let sample, let self else { return }
      self.emit(sample)
    }
  }

  private func emit(_ sample: CMSampleBuffer) {
    guard CMSampleBufferDataIsReady(sample), let block = CMSampleBufferGetDataBuffer(sample) else { return }
    var keyframe = true
    if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]],
      let first = attachments.first, let notSync = first[kCMSampleAttachmentKey_NotSync] as? Bool {
      keyframe = !notSync
    }
    var config: Data?
    if keyframe, let format = CMSampleBufferGetFormatDescription(sample), let record = LiveVideoEncoder.avcC(format), record != lastConfig {
      lastConfig = record
      config = record
    }
    let length = CMBlockBufferGetDataLength(block)
    var data = Data(count: length)
    let copied = data.withUnsafeMutableBytes { raw -> OSStatus in
      guard let base = raw.baseAddress else { return -1 }
      return CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: base)
    }
    guard copied == noErr else { return }
    output(Frame(data: data, keyframe: keyframe, pts: CMSampleBufferGetPresentationTimeStamp(sample), config: config))
  }

  /// The avcC record (AVCDecoderConfigurationRecord) for a format, built from its SPS/PPS.
  static func avcC(_ format: CMFormatDescription) -> Data? {
    if let atoms = CMFormatDescriptionGetExtension(format, extensionKey: kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms) as? [String: Any],
      let record = atoms["avcC"] as? Data, record.count > 6 {
      return record
    }
    var count = 0
    var nalHeaderLength: Int32 = 0
    guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, parameterSetIndex: 0, parameterSetPointerOut: nil,
      parameterSetSizeOut: nil, parameterSetCountOut: &count, nalUnitHeaderLengthOut: &nalHeaderLength) == noErr, count >= 2 else { return nil }
    var sets: [Data] = []
    for index in 0..<count {
      var pointer: UnsafePointer<UInt8>?
      var size = 0
      guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, parameterSetIndex: index, parameterSetPointerOut: &pointer,
        parameterSetSizeOut: &size, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil) == noErr, let pointer else { return nil }
      sets.append(Data(bytes: pointer, count: size))
    }
    let sps = sets.filter { ($0.first ?? 0) & 0x1F == 7 }
    let pps = sets.filter { ($0.first ?? 0) & 0x1F == 8 }
    guard let first = sps.first, first.count >= 4, !pps.isEmpty else { return nil }
    var record = Data([0x01, first[1], first[2], first[3], 0xFC | UInt8(max(0, nalHeaderLength - 1) & 0x03), 0xE0 | UInt8(sps.count & 0x1F)])
    for item in sps { record.append(contentsOf: [UInt8(item.count >> 8), UInt8(item.count & 0xFF)]); record.append(item) }
    record.append(UInt8(pps.count))
    for item in pps { record.append(contentsOf: [UInt8(item.count >> 8), UInt8(item.count & 0xFF)]); record.append(item) }
    return record
  }
}
