import CoreMedia
import CoreVideo
import Foundation
import ImageIO
import QuartzCore

/**
 * Publishes a screen share straight to the live ingest over RTMP, from inside
 * the broadcast extension.
 *
 * This is the reason the extension does the work and not the app: iOS gives an
 * app in the background no hardware video encoder, so a share that left Riftn
 * sent viewers broken video (2026-11-22). The extension is never "in the
 * background" while a broadcast runs, so it can encode for as long as the
 * share lasts, whichever app the creator is in.
 *
 * Feed it screen frames and audio samples from any thread; everything else
 * happens on its own queue. It reconnects by itself a few times if the network
 * drops, and reports what it is doing through `onState`.
 */
final class LiveScreenPublisher {
  enum State: Equatable {
    case connecting
    case live
    /// Gave up: `refused` (the server said no to this stream) or the network.
    case failed(String)
    case stopped
  }

  struct Stats {
    var bitrate: Int
    var framesSent: Int
    var micHeard: Bool
    var appAudioHeard: Bool
    var pendingBytes: Int
  }

  static let fps = 30
  static let startBitrate = 2_500_000
  static let minBitrate = 500_000

  let queue = DispatchQueue(label: "io.riftn.live-publish", qos: .userInitiated)
  private let url: String
  private var rtmp: RtmpPublisher?
  private var video: LiveVideoEncoder?
  private let renderer = LiveFrameRenderer()
  private let mixer = LiveAudioMixer()
  private var aac: LiveAacEncoder?
  private var audioTimer: DispatchSourceTimer?
  private var heartbeat: DispatchSourceTimer?

  private var state: State = .connecting
  private var stopping = false
  private var reconnects = 0
  private static let maxReconnects = 6

  // Per connection: the first video frame's time is zero on the wire.
  private var base: CFTimeInterval?
  private var headersSent = false
  private var lastVideoStamp: UInt32 = 0
  private var audioStart: CFTimeInterval = 0
  private var audioFrames = 0
  private var needKeyframe = true

  private var lastEncodeAt: CFTimeInterval = 0
  private var lastCanvasFrame: CVPixelBuffer?
  private var stableOrientation: CGImagePropertyOrientation?
  private var pendingOrientation: (CGImagePropertyOrientation, CFTimeInterval)?
  private var sourceSize: (width: Int, height: Int) = (0, 0)

  private var targetBitrate = LiveScreenPublisher.startBitrate
  private var lastRaise: CFTimeInterval = 0
  private var framesSent = 0

  var onState: ((State) -> Void)?
  var onStats: ((Stats) -> Void)?

  init?(url: String) {
    guard RtmpPublisher.Endpoint(url: url) != nil else { return nil }
    self.url = url
  }

  func start() {
    queue.async {
      self.aac = LiveAacEncoder()
      self.connect()
      let timer = DispatchSource.makeTimerSource(queue: self.queue)
      timer.schedule(deadline: .now() + .milliseconds(250), repeating: .milliseconds(250))
      timer.setEventHandler { [weak self] in self?.tick() }
      self.heartbeat = timer
      timer.resume()
    }
  }

  func stop() {
    queue.async {
      guard !self.stopping else { return }
      self.stopping = true
      self.teardown()
      self.set(.stopped)
    }
  }

  // MARK: Input

  func appendVideo(_ buffer: CVPixelBuffer, orientation: CGImagePropertyOrientation, at time: CFTimeInterval) {
    queue.async { self.handleVideo(buffer, orientation: orientation, at: time) }
  }

  func appendAudio(_ sample: CMSampleBuffer, fromMic: Bool) {
    queue.async { self.mixer.push(sample, from: fromMic ? .mic : .app) }
  }

  // MARK: Connection

  private func connect() {
    guard !stopping, let publisher = RtmpPublisher(url: url, queue: queue) else { return }
    rtmp = publisher
    base = nil; headersSent = false; lastVideoStamp = 0; needKeyframe = true
    audioTimer?.cancel(); audioTimer = nil
    publisher.onLive = { [weak self] in
      guard let self else { return }
      self.reconnects = 0
      self.set(.live)
    }
    publisher.onClosed = { [weak self] failure in
      guard let self, !self.stopping, self.rtmp === publisher else { return }
      self.rtmp = nil
      self.audioTimer?.cancel(); self.audioTimer = nil
      if case .refused(let code)? = failure {
        self.fail("refused:\(code)")
        return
      }
      self.reconnects += 1
      if self.reconnects > LiveScreenPublisher.maxReconnects {
        self.fail("network")
        return
      }
      self.set(.connecting)
      let delay = min(8.0, pow(2.0, Double(self.reconnects - 1)))
      self.queue.asyncAfter(deadline: .now() + delay) { [weak self] in self?.connect() }
    }
    publisher.start()
  }

  private func fail(_ reason: String) {
    stopping = true
    teardown()
    set(.failed(reason))
  }

  private func teardown() {
    audioTimer?.cancel(); audioTimer = nil
    heartbeat?.cancel(); heartbeat = nil
    rtmp?.close()
    rtmp = nil
    video?.invalidate()
    video = nil
    lastCanvasFrame = nil
  }

  private func set(_ next: State) {
    guard state != next else { return }
    state = next
    onState?(next)
  }

  // MARK: Video

  private func handleVideo(_ buffer: CVPixelBuffer, orientation: CGImagePropertyOrientation, at time: CFTimeInterval) {
    guard !stopping else { return }
    // 30 fps is plenty for a phone screen and halves the work at 60 Hz.
    if time - lastEncodeAt < 1.0 / Double(LiveScreenPublisher.fps) - 0.004 { return }
    sourceSize = (CVPixelBufferGetWidth(buffer), CVPixelBufferGetHeight(buffer))
    followOrientation(orientation, at: time)
    // Until the server takes the stream there is nowhere to send a frame.
    guard let rtmp, rtmp.isLive else { return }
    guard let frame = renderer.render(buffer, orientation: orientation) else { return }
    lastCanvasFrame = frame
    encode(frame, at: time)
  }

  /// The canvas turns with the phone, but only once the new way up has held
  /// for a moment, so a phone waved about does not restart the stream's
  /// picture size over and over. In between, the picture is fitted on black.
  private func followOrientation(_ orientation: CGImagePropertyOrientation, at time: CFTimeInterval) {
    let upright = { (o: CGImagePropertyOrientation) in
      LiveFrameRenderer.uprightSize(width: self.sourceSize.width, height: self.sourceSize.height, orientation: o)
    }
    guard let current = stableOrientation else {
      stableOrientation = orientation
      applyCanvas(upright(orientation))
      return
    }
    let currentSize = upright(current), nextSize = upright(orientation)
    let sameShape = (currentSize.width > currentSize.height) == (nextSize.width > nextSize.height)
    if sameShape { pendingOrientation = nil; stableOrientation = orientation; return }
    if let pending = pendingOrientation, pending.0 == orientation {
      if time - pending.1 >= 1.2 {
        stableOrientation = orientation
        pendingOrientation = nil
        applyCanvas(nextSize)
      }
    } else {
      pendingOrientation = (orientation, time)
    }
  }

  private func applyCanvas(_ upright: (width: Int, height: Int)) {
    let size = LiveFrameRenderer.canvasSize(width: upright.width, height: upright.height)
    guard size.width != renderer.canvas.width || size.height != renderer.canvas.height else { return }
    renderer.setCanvas(width: size.width, height: size.height)
    video?.invalidate()
    video = LiveVideoEncoder(width: Int32(size.width), height: Int32(size.height), fps: LiveScreenPublisher.fps, bitrate: targetBitrate) { [weak self] frame in
      self?.queue.async { self?.sendVideo(frame) }
    }
    needKeyframe = true
    if let rtmp, rtmp.isLive, headersSent {
      rtmp.sendMetadata(width: size.width, height: size.height, fps: LiveScreenPublisher.fps, videoKbps: targetBitrate / 1000, audioKbps: 128)
    }
  }

  private func encode(_ frame: CVPixelBuffer, at time: CFTimeInterval) {
    guard let video, let rtmp, rtmp.isLive else { return }
    // A backed-up uplink: skip frames rather than queue seconds of video, and
    // turn the bitrate down. The next frame sent is a keyframe so viewers'
    // decoders are never handed a frame that refers to one that was skipped.
    let backlog = rtmp.pendingBytes
    let budget = max(160_000, targetBitrate / 8)  // about a second of video
    if backlog > budget {
      needKeyframe = true
      lowerBitrate(at: time)
      return
    }
    lastEncodeAt = time
    let pts = CMTime(seconds: time, preferredTimescale: 90_000)
    video.encode(frame, pts: pts, forceKeyframe: needKeyframe)
    needKeyframe = false
  }

  private func sendVideo(_ frame: LiveVideoEncoder.Frame) {
    guard let rtmp, rtmp.isLive else { return }
    let time = CMTimeGetSeconds(frame.pts)
    if !headersSent {
      // Nothing goes out until the first keyframe: it carries the
      // parameters every player needs before it can show anything.
      guard frame.keyframe, let config = frame.config ?? currentConfig else { needKeyframe = true; return }
      base = time
      rtmp.sendMetadata(width: renderer.canvas.width, height: renderer.canvas.height, fps: LiveScreenPublisher.fps, videoKbps: targetBitrate / 1000, audioKbps: 128)
      rtmp.sendVideo(LiveScreenPublisher.videoHeader(config), timestamp: 0)
      var audioHeader = Data([0xAF, 0x00]); audioHeader.append(LiveAacEncoder.audioSpecificConfig)
      rtmp.sendAudio(audioHeader, timestamp: 0)
      headersSent = true
      startAudioClock(at: CACurrentMediaTime())
    } else if let config = frame.config {
      rtmp.sendVideo(LiveScreenPublisher.videoHeader(config), timestamp: stamp(time))
    }
    if let config = frame.config { currentConfig = config }
    var payload = Data([frame.keyframe ? 0x17 : 0x27, 0x01, 0x00, 0x00, 0x00])
    payload.append(frame.data)
    let ts = stamp(time)
    lastVideoStamp = ts
    rtmp.sendVideo(payload, timestamp: ts)
    framesSent += 1
  }

  private var currentConfig: Data?

  private func stamp(_ time: CFTimeInterval) -> UInt32 {
    guard let base else { return 0 }
    let ms = max(0, (time - base) * 1000)
    return max(lastVideoStamp, UInt32(min(ms, Double(UInt32.max - 1))))
  }

  static func videoHeader(_ config: Data) -> Data {
    var header = Data([0x17, 0x00, 0x00, 0x00, 0x00])
    header.append(config)
    return header
  }

  private func lowerBitrate(at time: CFTimeInterval) {
    guard time - lastRaise > 1 else { return }
    lastRaise = time
    targetBitrate = max(LiveScreenPublisher.minBitrate, Int(Double(targetBitrate) * 0.75))
    video?.setBitrate(targetBitrate)
  }

  // MARK: Audio

  private func startAudioClock(at time: CFTimeInterval) {
    audioStart = time
    audioFrames = 0
    audioTimer?.cancel()
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now(), repeating: .milliseconds(10), leeway: .milliseconds(2))
    timer.setEventHandler { [weak self] in self?.pumpAudio() }
    audioTimer = timer
    timer.resume()
  }

  private func pumpAudio() {
    guard let rtmp, rtmp.isLive, headersSent, let aac, let base else { return }
    let packet = LiveAacEncoder.framesPerPacket
    var due = Int((CACurrentMediaTime() - audioStart) * LiveAudioMixer.sampleRate) - audioFrames
    // The queue stalled (or the phone slept a moment): jump ahead instead of
    // sending a burst of old silence.
    if due > Int(LiveAudioMixer.sampleRate * 0.5) {
      audioFrames += due - packet
      due = packet
    }
    while due >= packet {
      let pcm = mixer.pull(frames: packet)
      let ms = (audioStart - base) * 1000 + Double(audioFrames) * 1000 / LiveAudioMixer.sampleRate
      audioFrames += packet
      due -= packet
      guard let encoded = aac.encode(pcm) else { continue }
      var payload = Data([0xAF, 0x01]); payload.append(encoded)
      rtmp.sendAudio(payload, timestamp: UInt32(max(0, ms)))
    }
  }

  // MARK: Upkeep

  private func tick() {
    guard !stopping else { return }
    let now = CACurrentMediaTime()
    // ReplayKit sends nothing while the screen is still. Repeat the last
    // picture so the stream keeps a steady keyframe rhythm and new viewers
    // get a picture straight away.
    if let frame = lastCanvasFrame, now - lastEncodeAt > 0.5 { encode(frame, at: now) }
    // Win the bitrate back slowly once the uplink has room again.
    if let rtmp, rtmp.isLive, rtmp.pendingBytes < 32_000, now - lastRaise > 6, targetBitrate < LiveScreenPublisher.startBitrate {
      lastRaise = now
      targetBitrate = min(LiveScreenPublisher.startBitrate, Int(Double(targetBitrate) * 1.15))
      video?.setBitrate(targetBitrate)
    }
    onStats?(Stats(
      bitrate: targetBitrate, framesSent: framesSent,
      micHeard: now - mixer.lastHeard[LiveAudioMixer.Source.mic.rawValue] < 2,
      appAudioHeard: now - mixer.lastHeard[LiveAudioMixer.Source.app.rawValue] < 2,
      pendingBytes: rtmp?.pendingBytes ?? 0))
  }
}
