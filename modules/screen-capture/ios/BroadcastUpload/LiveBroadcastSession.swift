import CoreMedia
import Foundation
import ImageIO
import QuartzCore
import ReplayKit

/**
 * A live screen share the app asked for, published by this extension itself.
 *
 * The app writes a ticket into the shared app group just before it opens the
 * broadcast picker: where to publish (the stream's RTMP ingest URL) and when
 * it asked. The extension claims it when the creator taps Start Broadcast,
 * publishes, and keeps a status file up to date so the app knows when to take
 * its camera off the stream and when to put it back. The app stops a share by
 * setting `stop` on the ticket.
 *
 *   live-share/ticket.json  app -> extension  { id, url, createdAt, stop }
 *   live-share/status.json  extension -> app  { id, state, reason, mic, appAudio, bitrate, frames, at }
 */
final class LiveBroadcastSession {
  static let appGroup = "group.io.dehub.mobile.screen-capture"
  /// How long a ticket waits for the creator to tap Start Broadcast.
  private static let ticketLifetime: TimeInterval = 15 * 60

  private let id: String
  private let folder: URL
  private let publisher: LiveScreenPublisher
  private let control = DispatchQueue(label: "io.riftn.live-share.control")
  private var timer: DispatchSourceTimer?
  private var finished = false
  private var lastStats: LiveScreenPublisher.Stats?
  private var state = "connecting"
  private var reason: String?
  /// Called once, with the line iOS shows when the broadcast ends.
  var onFinished: ((String) -> Void)?

  /// The Core Image orientation that stands a ReplayKit frame upright.
  ///
  /// ReplayKit's sideways tags point the other way from what
  /// `CIImage.oriented` expects: a frame tagged `.left` needs turning as if it
  /// were `.right`, and the other way round. Passed straight through, every
  /// landscape share (games) reached viewers upside down. Portrait and
  /// upside-down portrait are their own inverse, so they pass through.
  static func upright(replayKit raw: UInt32) -> CGImagePropertyOrientation {
    switch CGImagePropertyOrientation(rawValue: raw) ?? .up {
    case .left: return .right
    case .right: return .left
    case let other: return other
    }
  }

  /// The waiting ticket, or nil when the app did not ask for a live share.
  static func claim() -> LiveBroadcastSession? {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
    let folder = container.appendingPathComponent("live-share", isDirectory: true)
    guard let ticket = read(folder.appendingPathComponent("ticket.json")),
      let id = ticket["id"] as? String, let url = ticket["url"] as? String,
      let created = ticket["createdAt"] as? Double,
      ticket["stop"] as? Bool != true,
      Date().timeIntervalSince1970 - created < ticketLifetime else { return nil }
    // A ticket is good for one broadcast.
    if let status = read(folder.appendingPathComponent("status.json")), status["id"] as? String == id { return nil }
    guard let publisher = LiveScreenPublisher(url: url) else { return nil }
    return LiveBroadcastSession(id: id, folder: folder, publisher: publisher)
  }

  private init(id: String, folder: URL, publisher: LiveScreenPublisher) {
    self.id = id
    self.folder = folder
    self.publisher = publisher
  }

  func start() {
    writeStatus()
    publisher.onState = { [weak self] state in
      self?.control.async { self?.publisherChanged(state) }
    }
    publisher.onStats = { [weak self] stats in
      self?.control.async { self?.lastStats = stats }
    }
    publisher.start()
    let timer = DispatchSource.makeTimerSource(queue: control)
    timer.schedule(deadline: .now() + .milliseconds(500), repeating: .milliseconds(500))
    timer.setEventHandler { [weak self] in self?.poll() }
    self.timer = timer
    timer.resume()
  }

  func video(_ sample: CMSampleBuffer) {
    guard let image = CMSampleBufferGetImageBuffer(sample) else { return }
    let raw = (CMGetAttachment(sample, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) as? NSNumber)?.uint32Value ?? 1
    let orientation = LiveBroadcastSession.upright(replayKit: raw)
    let pts = CMSampleBufferGetPresentationTimeStamp(sample)
    let time = pts.isValid ? CMTimeGetSeconds(pts) : CACurrentMediaTime()
    publisher.appendVideo(image, orientation: orientation, at: time)
  }

  func audio(_ sample: CMSampleBuffer, fromMic: Bool) {
    publisher.appendAudio(sample, fromMic: fromMic)
  }

  /// The broadcast ended on the system's side (Control Center, the red bar, the phone locking).
  func close() {
    control.sync {
      guard !finished else { return }
      finished = true
      timer?.cancel(); timer = nil
      state = "ended"; reason = "system"
      writeStatus()
    }
    publisher.stop()
  }

  private func poll() {
    guard !finished else { return }
    if let ticket = LiveBroadcastSession.read(folder.appendingPathComponent("ticket.json")),
      ticket["id"] as? String != id || ticket["stop"] as? Bool == true {
      end(state: "ended", reason: "app", message: "Screen share ended. Your camera is back on the live.")
      return
    }
    writeStatus()
  }

  private func publisherChanged(_ next: LiveScreenPublisher.State) {
    guard !finished else { return }
    switch next {
    case .connecting: state = "connecting"; writeStatus()
    case .live: state = "live"; writeStatus()
    case .stopped: break
    case .failed(let why):
      if why.hasPrefix("refused") {
        end(state: "failed", reason: why, message: "This live has ended, so the screen share stopped.")
      } else {
        end(state: "failed", reason: why, message: "Couldn't reach the live server. Check your connection and share again.")
      }
    }
  }

  private func end(state: String, reason: String, message: String) {
    finished = true
    timer?.cancel(); timer = nil
    self.state = state
    self.reason = reason
    writeStatus()
    publisher.stop()
    let done = onFinished
    onFinished = nil
    done?(message)
  }

  private func writeStatus() {
    var status: [String: Any] = ["id": id, "state": state, "at": Date().timeIntervalSince1970]
    if let reason { status["reason"] = reason }
    if let stats = lastStats {
      status["mic"] = stats.micHeard
      status["appAudio"] = stats.appAudioHeard
      status["bitrate"] = stats.bitrate
      status["frames"] = stats.framesSent
    }
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    guard let data = try? JSONSerialization.data(withJSONObject: status) else { return }
    try? data.write(to: folder.appendingPathComponent("status.json"), options: .atomic)
  }

  private static func read(_ file: URL) -> [String: Any]? {
    guard let data = try? Data(contentsOf: file) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }
}
