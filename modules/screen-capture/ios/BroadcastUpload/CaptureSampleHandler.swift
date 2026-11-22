import CoreMedia
import Foundation
import ReplayKit

final class CaptureSampleHandler: RPBroadcastSampleHandler {
  private var ledger: CaptureLedger?
  private var ticket: CaptureTicket?
  private var movie: CaptureMovieWriter?
  private var control: DispatchSourceTimer?
  private var ending = false
  private var startedWall: TimeInterval = 0
  private let incoming = DispatchSemaphore(value: 3)
  /// Set when this broadcast is a screen share for a live stream rather than an editor recording.
  private var live: LiveShareUploader?
  /// A live screen share this extension publishes itself (the app left a ticket).
  private var publishing: LiveBroadcastSession?

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    // The editor always starts through the setup extension, which hands over a
    // session; the system picker on the live screen hands over nothing.
    if setupInfo?["sessionId"] == nil {
      if let session = LiveBroadcastSession.claim() {
        session.onFinished = { [weak self] message in
          self?.finishBroadcastWithError(NSError(domain: "io.dehub.screen-capture", code: 0,
            userInfo: [NSLocalizedDescriptionKey: message]))
        }
        publishing = session
        session.start()
        return
      }
      guard let uploader = LiveShareUploader() else {
        finishBroadcastWithError(NSError(domain: "io.dehub.screen-capture", code: 2,
          userInfo: [NSLocalizedDescriptionKey: "Start screen share from your live stream in RIFTN."]))
        return
      }
      uploader.onClosed = { [weak self] in
        self?.finishBroadcastWithError(NSError(domain: "io.dehub.screen-capture", code: 0,
          userInfo: [NSLocalizedDescriptionKey: "Screen share ended"]))
      }
      live = uploader
      return
    }
    do {
      guard let id = setupInfo?["sessionId"] as? String, let scope = setupInfo?["scopeKey"] as? String,
        let host = setupInfo?["hostInstanceId"] as? String else { throw CaptureLedgerError.invalidTicket }
      let ledger = try CaptureLedger()
      let ticket = try ledger.beginBroadcast(id, scopeKey: scope, hostInstanceId: host)
      self.ledger = ledger; self.ticket = ticket
      let writer = CaptureMovieWriter(file: try ledger.recordingURL(id), microphone: ticket.microphone, systemAudio: ticket.systemAudio) { [weak self] _ in
        self?.finish(cancel: true, notifySystem: true)
      }
      movie = writer; startedWall = ProcessInfo.processInfo.systemUptime
      let timer = DispatchSource.makeTimerSource(queue: writer.queue)
      timer.schedule(deadline: .now() + .milliseconds(250), repeating: .milliseconds(250))
      timer.setEventHandler { [weak self] in
        guard let self, !self.ending else { return }
        do {
          guard let current = try ledger.ticket(id, scopeKey: scope) else { throw CaptureLedgerError.wrongScope }
          if current.cancelRequested { self.finish(cancel: true, notifySystem: true) }
          else if current.stopRequested == true || ProcessInfo.processInfo.systemUptime - self.startedWall >= 600 {
            self.finish(cancel: false, notifySystem: true)
          }
        } catch { self.finish(cancel: true, notifySystem: true) }
      }
      control = timer; timer.resume()
    } catch {
      if let ledger, let ticket { try? ledger.fail(ticket.sessionId, scopeKey: ticket.scopeKey, cancelled: false) }
      finishBroadcastWithError(error)
    }
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with type: RPSampleBufferType) {
    if let publishing {
      switch type {
      case .video: publishing.video(sampleBuffer)
      case .audioApp: publishing.audio(sampleBuffer, fromMic: false)
      case .audioMic: publishing.audio(sampleBuffer, fromMic: true)
      @unknown default: break
      }
      return
    }
    if let live {
      if type == .video { live.send(sampleBuffer) }
      return
    }
    guard let movie, incoming.wait(timeout: .now()) == .success else { return }
    movie.queue.async {
      defer { self.incoming.signal() }
      guard !self.ending else { return }
      switch type {
      case .video:
        let orientation = (CMGetAttachment(sampleBuffer, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) as? NSNumber)?.int32Value ?? 1
        movie.appendVideo(sampleBuffer, orientation: orientation)
      case .audioApp: movie.appendAudio(sampleBuffer, source: "system")
      case .audioMic: movie.appendAudio(sampleBuffer, source: "microphone")
      @unknown default: break
      }
    }
  }

  override func broadcastFinished() {
    if let publishing { publishing.close(); self.publishing = nil; return }
    if let live { live.close(); self.live = nil; return }
    guard let movie else { return }
    // Keep finalization inside the extension's final callback rather than abandoning it.
    let completed = DispatchSemaphore(value: 0)
    movie.queue.async { self.finish(cancel: false, notifySystem: false) { completed.signal() } }
    _ = completed.wait(timeout: .now() + 15)
  }

  private func finish(cancel: Bool, notifySystem: Bool, completion: (() -> Void)? = nil) {
    guard !ending, let movie, let ledger, let ticket else { completion?(); return }
    ending = true; control?.cancel(); control = nil
    let discard = cancel || ((try? ledger.ticket(ticket.sessionId, scopeKey: ticket.scopeKey))?.cancelRequested == true)
    if discard { try? ledger.requestCancel(ticket.sessionId, scopeKey: ticket.scopeKey) }
    try? ledger.markFinishing(ticket.sessionId, scopeKey: ticket.scopeKey)
    movie.finish(cancel: discard) { result in
      do {
        let metadata = try result.get()
        try ledger.complete(ticket.sessionId, scopeKey: ticket.scopeKey, width: metadata.width, height: metadata.height, durationMs: metadata.durationMs)
      } catch { try? ledger.fail(ticket.sessionId, scopeKey: ticket.scopeKey, cancelled: discard) }
      completion?()
      if notifySystem {
        self.finishBroadcastWithError(NSError(domain: "io.dehub.screen-capture", code: discard ? 1 : 0,
          userInfo: [NSLocalizedDescriptionKey: (discard ? ticket.cancelLabel : ticket.saveLabel) ?? "Riftn"]))
      }
    }
  }
}
