import AVFoundation
import ExpoModulesCore
import StoreKit
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
  private var storefrontUpdates: Task<Void, Never>?
  private var observation: NSKeyValueObservation?
  private var activeObserver: NSObjectProtocol?
  private var sharedVideoObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("RiftnMediaBridge")
    Events("onVolumeKey", "onStorefrontChange", "onSharedVideo")

    Function("takeSharedPhoto") { SharedPhotoImport.take() }

    Function("takeSharedVideo") { SharedVideoImport.take() }
    Function("discardSharedVideo") { (id: String) in SharedVideoImport.discard(id) }

    Function("storefrontCountry") {
      SKPaymentQueue.default().storefront?.countryCode
    }

    // What iOS counts against the app's memory limit (Xcode's memory gauge),
    // in MB: read when a Short gets stuck, to see whether a long scroll is
    // running the phone out of memory.
    Function("memoryFootprintMB") { () -> Double? in
      var info = task_vm_info_data_t()
      var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
      let result = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
          task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
      }
      guard result == KERN_SUCCESS else { return nil }
      return (Double(info.phys_footprint) / 1_048_576).rounded()
    }

    Constant("liveScreenShare") {
      Bundle.main.object(forInfoDictionaryKey: "RTCScreenSharingExtension") is String
        && Bundle.main.object(forInfoDictionaryKey: "RTCAppGroupIdentifier") is String
    }

    AsyncFunction("showBroadcastPicker") { (microphone: Bool?) -> Bool in
      guard let extensionId = Bundle.main.object(forInfoDictionaryKey: "RTCScreenSharingExtension") as? String else { return false }
      let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 44, height: 44))
      picker.preferredExtension = extensionId
      // When the extension publishes the share itself it also carries the
      // voice, so the picker offers the Microphone switch.
      picker.showsMicrophoneButton = microphone == true
      guard let button = picker.subviews.compactMap({ $0 as? UIButton }).first else { return false }
      button.sendActions(for: .touchUpInside)
      return true
    }.runOnQueue(.main)

    // Live screen share published by the broadcast extension itself (see
    // modules/screen-capture/ios/BroadcastUpload/LiveBroadcastSession.swift):
    // the app leaves a ticket with the stream's RTMP ingest URL, reads the
    // extension's status, and sets `stop` to end the share.
    Constant("liveBroadcastPublish") { LiveShareFiles.folder() != nil }
    // This build's extension turns landscape frames the right way up itself.
    // 1.20.1 did not, and the app marks its shares so the ingest fixes them.
    Constant("liveBroadcastUpright") { true }

    Function("prepareLiveBroadcast") { (url: String) -> String? in
      guard let folder = LiveShareFiles.folder() else { return nil }
      let id = UUID().uuidString
      let ticket: [String: Any] = ["id": id, "url": url, "createdAt": Date().timeIntervalSince1970, "stop": false]
      guard LiveShareFiles.write(ticket, to: folder.appendingPathComponent("ticket.json")) else { return nil }
      return id
    }

    Function("liveBroadcastStatus") { (id: String) -> [String: Any]? in
      guard let folder = LiveShareFiles.folder(),
        let status = LiveShareFiles.read(folder.appendingPathComponent("status.json")),
        status["id"] as? String == id else { return nil }
      return status
    }

    Function("stopLiveBroadcast") { (id: String) in
      guard let folder = LiveShareFiles.folder() else { return }
      let file = folder.appendingPathComponent("ticket.json")
      guard var ticket = LiveShareFiles.read(file), ticket["id"] as? String == id else { return }
      ticket["stop"] = true
      _ = LiveShareFiles.write(ticket, to: file)
    }

    // Watched from the moment the module loads, not only once JS subscribes,
    // so the first press after launch is not missed.
    OnCreate {
      self.sharedVideoObserver = NotificationCenter.default.addObserver(forName: SharedVideoImport.changed, object: nil, queue: .main) { [weak self] _ in
        self?.sendEvent("onSharedVideo", [:])
      }
      self.storefrontUpdates = Task { [weak self] in
        for await _ in Storefront.updates {
          if Task.isCancelled { return }
          self?.sendEvent("onStorefrontChange")
        }
      }
      self.startObserving()
    }

    OnStartObserving {
      self.startObserving()
    }

    OnDestroy {
      if let observer = self.sharedVideoObserver { NotificationCenter.default.removeObserver(observer) }
      self.storefrontUpdates?.cancel()
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

/// The app group folder the app and the broadcast extension share for a live screen share.
enum LiveShareFiles {
  static func folder() -> URL? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "RTCAppGroupIdentifier") as? String,
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { return nil }
    let folder = container.appendingPathComponent("live-share", isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    return folder
  }

  static func read(_ file: URL) -> [String: Any]? {
    guard let data = try? Data(contentsOf: file) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }

  static func write(_ object: [String: Any], to file: URL) -> Bool {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return false }
    return (try? data.write(to: file, options: .atomic)) != nil
  }
}
