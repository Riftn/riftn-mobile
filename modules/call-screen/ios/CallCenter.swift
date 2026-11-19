import AVFoundation
import CallKit
import Foundation
import PushKit
import UIKit

/**
 * Incoming calls on the iPhone call screen.
 *
 * The server sends a VoIP push (PushKit) for each incoming call. iOS wakes or
 * launches the app for it, and the push is reported to CallKit straight away,
 * which rings with the Riftn ringtone and shows the system call screen, also
 * on the lock screen. iOS requires every VoIP push to be reported to CallKit,
 * so even an "end" push or a push while the app is open reports a call and
 * ends it at once.
 *
 * Answer and Decline are handed to JS (hooks/useNativeCallScreen.ts), which
 * joins or declines the call. Actions taken before JS is listening wait in
 * `pending` until JS takes them.
 *
 * Everything here runs on the main queue.
 */
final class CallCenter: NSObject, PKPushRegistryDelegate, CXProviderDelegate {
  static let shared = CallCenter()

  private var registry: PKPushRegistry?
  private lazy var provider: CXProvider = {
    let config: CXProviderConfiguration
    if #available(iOS 14.0, *) {
      config = CXProviderConfiguration()
    } else {
      config = CXProviderConfiguration(localizedName: "Riftn")
    }
    config.supportsVideo = true
    config.maximumCallGroups = 1
    config.maximumCallsPerCallGroup = 1
    config.supportedHandleTypes = [.generic]
    config.includesCallsInRecents = false
    if Bundle.main.url(forResource: "call_ring", withExtension: "wav") != nil {
      config.ringtoneSound = "call_ring.wav"
    }
    let provider = CXProvider(configuration: config)
    provider.setDelegate(self, queue: nil)
    return provider
  }()

  private(set) var voipToken: String?
  /** Calls on the call screen: session id and call type. */
  private var calls: [UUID: [String: String]] = [:]
  private var answered = Set<UUID>()
  private var timers: [UUID: DispatchWorkItem] = [:]
  private var pending: [[String: String]] = []
  /** Set while JS listens; otherwise call actions wait in `pending`. */
  var onEvent: (([String: String]) -> Void)?

  func start() {
    guard registry == nil else { return }
    let registry = PKPushRegistry(queue: .main)
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
    self.registry = registry
    _ = provider
  }

  func takePending() -> [[String: String]] {
    let actions = pending
    pending.removeAll()
    return actions
  }

  /** The app ended or answered this call itself: close the call screen without a decline. */
  func end(sessionId: String) {
    guard let uuid = UUID(uuidString: sessionId), calls[uuid] != nil else { return }
    provider.reportCall(with: uuid, endedAt: nil, reason: answered.contains(uuid) ? .remoteEnded : .answeredElsewhere)
    forget(uuid)
  }

  // MARK: PushKit

  func pushRegistry(_ registry: PKPushRegistry, didUpdate credentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else { return }
    let token = credentials.token.map { String(format: "%02x", $0) }.joined()
    voipToken = token
    onEvent?(["action": "token", "token": token])
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    if type == .voIP { voipToken = nil }
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    let data = payload.dictionaryPayload
    let sessionId = data["sessionId"] as? String ?? ""
    let callerName = (data["callerName"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Riftn"
    let video = (data["callType"] as? String) == "video"
    let known = UUID(uuidString: sessionId)

    if (data["action"] as? String) == "end" {
      if let uuid = known, calls[uuid] != nil, !answered.contains(uuid) {
        provider.reportCall(with: uuid, endedAt: nil, reason: .remoteEnded)
        forget(uuid)
        completion()
      } else {
        report(uuid: UUID(), name: callerName, video: video, endAtOnce: true, completion: completion)
      }
      return
    }

    guard let uuid = known, calls[uuid] == nil else {
      // A repeat of a call already on screen, or a malformed push.
      report(uuid: UUID(), name: callerName, video: video, endAtOnce: true, completion: completion)
      return
    }
    // While the app is open it rings the call on its own screen.
    let foreground = UIApplication.shared.applicationState == .active
    report(uuid: uuid, name: callerName, video: video, endAtOnce: foreground, completion: completion) { [weak self] in
      guard let self else { return }
      self.calls[uuid] = ["sessionId": sessionId, "callType": video ? "video" : "audio"]
      // Same 45 s limit as the app's own ring.
      let timeout = DispatchWorkItem { [weak self] in
        guard let self, self.calls[uuid] != nil, !self.answered.contains(uuid) else { return }
        self.provider.reportCall(with: uuid, endedAt: nil, reason: .unanswered)
        self.forget(uuid)
      }
      self.timers[uuid] = timeout
      DispatchQueue.main.asyncAfter(deadline: .now() + 45, execute: timeout)
    }
  }

  private func report(
    uuid: UUID,
    name: String,
    video: Bool,
    endAtOnce: Bool,
    completion: @escaping () -> Void,
    ringing: (() -> Void)? = nil
  ) {
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: name)
    update.localizedCallerName = name
    update.hasVideo = video
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false
    provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
      DispatchQueue.main.async {
        defer { completion() }
        guard let self, error == nil else { return }
        if endAtOnce {
          self.provider.reportCall(with: uuid, endedAt: nil, reason: .remoteEnded)
        } else {
          ringing?()
        }
      }
    }
  }

  private func forget(_ uuid: UUID) {
    calls.removeValue(forKey: uuid)
    answered.remove(uuid)
    timers.removeValue(forKey: uuid)?.cancel()
  }

  private func hand(_ event: [String: String]) {
    if let onEvent {
      onEvent(event)
    } else {
      pending.append(event)
    }
  }

  // MARK: CallKit

  func providerDidReset(_ provider: CXProvider) {
    calls.keys.forEach { timers.removeValue(forKey: $0)?.cancel() }
    calls.removeAll()
    answered.removeAll()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    let uuid = action.callUUID
    timers.removeValue(forKey: uuid)?.cancel()
    answered.insert(uuid)
    if let call = calls[uuid] {
      hand(["action": "answer", "sessionId": call["sessionId"] ?? "", "callType": call["callType"] ?? "audio"])
    }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    let uuid = action.callUUID
    if let call = calls[uuid] {
      hand(["action": answered.contains(uuid) ? "hangup" : "decline", "sessionId": call["sessionId"] ?? ""])
    }
    forget(uuid)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {}

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {}
}
