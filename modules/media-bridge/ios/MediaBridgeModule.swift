import AVFoundation
import ExpoModulesCore
import ReplayKit
import UIKit

/**
 * Small native capabilities that arrived together in one store build:
 *
 * - Volume key presses. iOS has no key event for them, so a press is read off
 *   the audio session's output volume: a rise is "up", a fall is "down". KVO
 *   only reports while the session is active, so it is activated here when
 *   that is harmless (the category already mixes with other audio, so it
 *   cannot stop the viewer's music). At full volume a press changes nothing
 *   and is not seen.
 * - Screen share while live: opens the system broadcast picker on the app's
 *   broadcast extension, which streams frames back to react-native-webrtc
 *   (modules/screen-capture/ios/BroadcastUpload/LiveShareUploader.swift).
 */
public class MediaBridgeModule: Module {
  private var observation: NSKeyValueObservation?
  private var activeObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("RiftnMediaBridge")
    Events("onVolumeKey")

    Constant("liveScreenShare") {
      Bundle.main.object(forInfoDictionaryKey: "RTCScreenSharingExtension") is String
        && Bundle.main.object(forInfoDictionaryKey: "RTCAppGroupIdentifier") is String
    }

    AsyncFunction("showBroadcastPicker") { () -> Bool in
      guard let extensionId = Bundle.main.object(forInfoDictionaryKey: "RTCScreenSharingExtension") as? String else { return false }
      let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 44, height: 44))
      picker.preferredExtension = extensionId
      picker.showsMicrophoneButton = false
      guard let button = picker.subviews.compactMap({ $0 as? UIButton }).first else { return false }
      button.sendActions(for: .touchUpInside)
      return true
    }.runOnQueue(.main)

    // Watched from the moment the module loads, not only once JS subscribes,
    // so the first press after launch is not missed.
    OnCreate {
      self.startObserving()
    }

    OnStartObserving {
      self.startObserving()
    }

    OnDestroy {
      self.stopObserving()
    }
  }

  private func startObserving() {
    DispatchQueue.main.async {
      guard self.observation == nil else { return }
      let session = AVAudioSession.sharedInstance()
      self.activateIfHarmless(session)
      self.observation = session.observe(\.outputVolume, options: [.old, .new]) { [weak self] _, change in
        guard let old = change.oldValue, let new = change.newValue, old != new else { return }
        self?.sendEvent("onVolumeKey", ["direction": new > old ? "up" : "down"])
      }
      // Coming back to the app can leave the session inactive again.
      self.activeObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
      ) { [weak self] _ in
        self?.activateIfHarmless(AVAudioSession.sharedInstance())
      }
    }
  }

  private func stopObserving() {
    DispatchQueue.main.async {
      self.observation?.invalidate()
      self.observation = nil
      if let observer = self.activeObserver { NotificationCenter.default.removeObserver(observer) }
      self.activeObserver = nil
    }
  }

  private func activateIfHarmless(_ session: AVAudioSession) {
    let mixes = session.category == .ambient || session.categoryOptions.contains(.mixWithOthers)
    if mixes { try? session.setActive(true) }
  }
}
