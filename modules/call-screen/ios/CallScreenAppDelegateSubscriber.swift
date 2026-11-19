import ExpoModulesCore
import UIKit

/**
 * Starts listening for VoIP pushes as the app launches. iOS launches the app
 * in the background for an incoming call push, and the push is only delivered
 * once a PKPushRegistry exists, so this cannot wait for JS.
 */
public class CallScreenAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    CallCenter.shared.start()
    return true
  }
}
