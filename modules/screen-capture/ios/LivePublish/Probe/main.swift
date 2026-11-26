import AudioToolbox
import CoreMedia
import CoreVideo
import Foundation
import ImageIO
import QuartzCore

/*
 * Drives LiveScreenPublisher on a Mac against a real MediaMTX, with what
 * ReplayKit hands the broadcast extension: 420f portrait screen frames tagged
 * with an orientation, 44.1 kHz big-endian app audio and 48 kHz float mic
 * audio. CI checks what arrives (.github/workflows/live-share-publisher-check.yml).
 *
 *   probe --selftest
 *   probe <rtmp-url> <seconds> [rotate-at-seconds]
 *
 * Exit: 0 went live and stopped cleanly, 2 refused, 3 network, 4 never went live.
 */

func check(_ condition: Bool, _ message: String) {
  if !condition { print("SELFTEST FAIL: \(message)"); exit(1) }
}

if CommandLine.arguments.count > 1, CommandLine.arguments[1] == "--selftest" {
  let mediamtx = RtmpPublisher.Endpoint(url: "rtmp://live.dehub.io/abc123-rtmp?user=dehub&pass=k3y")
  check(mediamtx?.host == "live.dehub.io" && mediamtx?.port == 1935, "host/port")
  check(mediamtx?.app == "" && mediamtx?.streamName == "abc123-rtmp?user=dehub&pass=k3y", "mediamtx split")
  check(mediamtx?.tcUrl == "rtmp://live.dehub.io", "mediamtx tcUrl")
  let livepeer = RtmpPublisher.Endpoint(url: "rtmp://rtmp.livepeer.com/live/abcd-efgh")
  check(livepeer?.app == "live" && livepeer?.streamName == "abcd-efgh" && livepeer?.tcUrl == "rtmp://rtmp.livepeer.com/live", "livepeer split")
  let port = RtmpPublisher.Endpoint(url: "rtmp://127.0.0.1:19350/x-rtmp?user=a&pass=b")
  check(port?.host == "127.0.0.1" && port?.port == 19350 && port?.tcUrl == "rtmp://127.0.0.1:19350", "explicit port")
  check(RtmpPublisher.Endpoint(url: "https://x/y") == nil, "rejects https")
  let decoded = Amf0.decode(Amf0.string("_result") + Amf0.number(4) + Amf0.null + Amf0.number(7))
  check(decoded.count == 4 && decoded[0] as? String == "_result" && decoded[3] as? Double == 7, "amf0 round trip")
  let status = Amf0.decode(Amf0.string("onStatus") + Amf0.number(0) + Amf0.null + Amf0.object([("level", Amf0.string("status")), ("code", Amf0.string("NetStream.Publish.Start"))]))
  check((status[3] as? [String: Any])?["code"] as? String == "NetStream.Publish.Start", "amf0 object")
  let portrait = LiveFrameRenderer.canvasSize(width: 1320, height: 2868)
  check(portrait.width == 590 && portrait.height == 1280, "portrait canvas \(portrait)")
  let landscape = LiveFrameRenderer.canvasSize(width: 2868, height: 1320)
  check(landscape.width == 1280 && landscape.height == 590, "landscape canvas \(landscape)")
  let ipad = LiveFrameRenderer.canvasSize(width: 2064, height: 2752)
  check(ipad.width <= 720 && ipad.height <= 1280 && ipad.width % 2 == 0 && ipad.height % 2 == 0, "ipad canvas \(ipad)")
  // AAC encoder produces packets for a steady tone.
  if let aac = LiveAacEncoder() {
    var produced = 0
    for i in 0..<20 {
      let tone = (0..<2048).map { Float(sin(Double($0 / 2 + i * 1024) * 2 * .pi * 440 / 48000)) * 0.3 }
      if aac.encode(tone) != nil { produced += 1 }
    }
    check(produced >= 15, "aac produced \(produced) of 20")
  } else { check(false, "aac encoder") }
  var limiter = LivePeakLimiter(sampleRate: LiveAudioMixer.sampleRate)
  var appAudio: [Float] = [0.95, -0.9, 0.5, -0.25]
  let original = appAudio
  limiter.process(&appAudio)
  check(appAudio == original, "app audio at unity gain is unchanged")
  var overlap: [Float] = [1.25, -0.625]
  limiter.process(&overlap)
  check(overlap == [1, -0.5], "overlap is limited without moving the stereo image")
  var afterPeak = [Float](repeating: 0.5, count: 1_440)
  limiter.process(&afterPeak)
  check(afterPeak[0] > 0.4 && afterPeak[0] < 0.41 && afterPeak.last == 0.5, "limiter recovers between beats")
  print("SELFTEST OK")
  exit(0)
}

guard CommandLine.arguments.count >= 3, let seconds = Double(CommandLine.arguments[2]) else {
  print("usage: probe <rtmp-url> <seconds> [rotate-at]"); exit(64)
}
let url = CommandLine.arguments[1]
let rotateAt = CommandLine.arguments.count > 3 ? Double(CommandLine.arguments[3]) ?? .infinity : .infinity
guard let publisher = LiveScreenPublisher(url: url) else { print("bad url"); exit(64) }

var wentLive = false
var failure: String?
let lock = NSLock()
publisher.onState = { state in
  print("[probe] state \(state)")
  lock.lock(); defer { lock.unlock() }
  if state == .live { wentLive = true }
  if case .failed(let why) = state { failure = why }
}
var lastStats = Date.distantPast
publisher.onStats = { stats in
  guard Date().timeIntervalSince(lastStats) > 2 else { return }
  lastStats = Date()
  print("[probe] bitrate \(stats.bitrate) frames \(stats.framesSent) mic \(stats.micHeard) app \(stats.appAudioHeard) pending \(stats.pendingBytes)")
}
publisher.start()

// Screen frames: an iPhone 16 Pro Max screen, 420f, a bar sweeping across.
let width = 1320, height = 2868
let attributes: [CFString: Any] = [kCVPixelBufferIOSurfacePropertiesKey: [:] as [CFString: Any]]
var frameIndex = 0
func makeFrame() -> CVPixelBuffer? {
  var buffer: CVPixelBuffer?
  CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, attributes as CFDictionary, &buffer)
  guard let buffer else { return nil }
  CVPixelBufferLockBaseAddress(buffer, [])
  defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
  let bar = (frameIndex * 12) % height
  if let y = CVPixelBufferGetBaseAddressOfPlane(buffer, 0) {
    let stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0)
    for row in 0..<height {
      let value: UInt8 = abs(row - bar) < 60 ? 235 : UInt8(30 + (row * 150 / height))
      memset(y + row * stride, Int32(value), width)
    }
  }
  if let uv = CVPixelBufferGetBaseAddressOfPlane(buffer, 1) {
    let stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 1)
    for row in 0..<(height / 2) { memset(uv + row * stride, 128 + Int32((row / 40) % 2) * 40, width) }
  }
  frameIndex += 1
  return buffer
}

func audioSample(frames: Int, rate: Double, channels: Int, bigEndianInt16: Bool, phase: inout Double, tone: Double, at time: CFTimeInterval) -> CMSampleBuffer? {
  var asbd = AudioStreamBasicDescription()
  asbd.mSampleRate = rate
  asbd.mFormatID = kAudioFormatLinearPCM
  asbd.mChannelsPerFrame = UInt32(channels)
  asbd.mFramesPerPacket = 1
  var bytes = [UInt8]()
  if bigEndianInt16 {
    asbd.mFormatFlags = kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked | kAudioFormatFlagIsBigEndian
    asbd.mBitsPerChannel = 16
    asbd.mBytesPerFrame = UInt32(2 * channels)
    for _ in 0..<frames {
      let value = Int16(sin(phase) * 9000); phase += 2 * .pi * tone / rate
      let raw = UInt16(bitPattern: value).bigEndian
      for _ in 0..<channels { withUnsafeBytes(of: raw) { bytes.append(contentsOf: $0) } }
    }
  } else {
    asbd.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked
    asbd.mBitsPerChannel = 32
    asbd.mBytesPerFrame = UInt32(4 * channels)
    for _ in 0..<frames {
      let value = Float(sin(phase) * 0.25); phase += 2 * .pi * tone / rate
      for _ in 0..<channels { withUnsafeBytes(of: value.bitPattern) { bytes.append(contentsOf: $0) } }
    }
  }
  asbd.mBytesPerPacket = asbd.mBytesPerFrame
  var format: CMAudioFormatDescription?
  guard CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &asbd, layoutSize: 0, layout: nil,
    magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &format) == noErr, let format else { return nil }
  var block: CMBlockBuffer?
  guard CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: bytes.count,
    blockAllocator: kCFAllocatorDefault, customBlockSource: nil, offsetToData: 0, dataLength: bytes.count, flags: 0, blockBufferOut: &block) == noErr,
    let block else { return nil }
  bytes.withUnsafeBytes { raw in _ = CMBlockBufferReplaceDataBytes(with: raw.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: bytes.count) }
  var sample: CMSampleBuffer?
  CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: format,
    sampleCount: frames, presentationTimeStamp: CMTime(seconds: time, preferredTimescale: 48000), packetDescriptions: nil, sampleBufferOut: &sample)
  return sample
}

let feed = DispatchQueue(label: "probe.feed")
let started = CACurrentMediaTime()
let video = DispatchSource.makeTimerSource(queue: feed)
video.schedule(deadline: .now(), repeating: .milliseconds(16))
video.setEventHandler {
  let now = CACurrentMediaTime()
  // Hold still for a while mid-run, like a screen nobody is touching.
  if now - started > 4, now - started < 6 { return }
  guard let frame = makeFrame() else { return }
  let orientation: CGImagePropertyOrientation = now - started >= rotateAt ? .right : .up
  publisher.appendVideo(frame, orientation: orientation, at: now)
}
var appPhase = 0.0, micPhase = 0.0
let appAudio = DispatchSource.makeTimerSource(queue: feed)
appAudio.schedule(deadline: .now(), repeating: .nanoseconds(Int(1024.0 / 44100 * 1e9)))
appAudio.setEventHandler {
  if let s = audioSample(frames: 1024, rate: 44100, channels: 2, bigEndianInt16: true, phase: &appPhase, tone: 440, at: CACurrentMediaTime()) {
    publisher.appendAudio(s, fromMic: false)
  }
}
let micAudio = DispatchSource.makeTimerSource(queue: feed)
micAudio.schedule(deadline: .now(), repeating: .milliseconds(10))
micAudio.setEventHandler {
  if let s = audioSample(frames: 480, rate: 48000, channels: 1, bigEndianInt16: false, phase: &micPhase, tone: 660, at: CACurrentMediaTime()) {
    publisher.appendAudio(s, fromMic: true)
  }
}
video.resume(); appAudio.resume(); micAudio.resume()

let deadline = Date().addingTimeInterval(seconds)
while Date() < deadline {
  RunLoop.current.run(until: Date().addingTimeInterval(0.2))
  lock.lock(); let failed = failure; lock.unlock()
  if failed != nil { break }
}
video.cancel(); appAudio.cancel(); micAudio.cancel()
publisher.stop()
Thread.sleep(forTimeInterval: 1)
lock.lock(); defer { lock.unlock() }
if let failure {
  print("[probe] failed: \(failure)")
  exit(failure.hasPrefix("refused") ? 2 : 3)
}
if !wentLive { print("[probe] never went live"); exit(4) }
print("[probe] done")
exit(0)
