internal import Expo
import React
import ReactAppDependencyProvider
internal import RiftnMediaBridge

@main
class AppDelegate: ExpoAppDelegate, RiftnReactNativeFactoryProvider {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    // Camera looks have to exist in ProcessorProvider before the broadcaster
    // ever names one — react-native-webrtc resolves them by name at capture
    // time and silently drops anything it cannot find.
    DHBVideoLooks.registerAll()
    // The phone studio's processors (background removal, scene cards and
    // overlays), for the same reason.
    DHBStudio.registerProcessors()

    // The window and React Native start in SceneDelegate (below): iOS 27
    // builds only launch with the scene life cycle, and the iPhone Duo's
    // inner screen only gives the app the full display to builds that use it.

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    if url.isFileURL {
      SharedVideoImport.receive(url)
      return true
    }
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

// MARK: - Scene life cycle

/// Lets the scene delegate reach the React Native factory the app delegate
/// made at launch, and hand the window it creates back to the app delegate so
/// code reading `UIApplication.shared.delegate?.window` keeps working.
@MainActor
protocol RiftnReactNativeFactoryProvider: AnyObject {
  var window: UIWindow? { get set }
  var reactNativeFactory: RCTReactNativeFactory? { get }
}

/// Creates the app's window from the connecting window scene, starts React
/// Native in it, and passes scene events (links, universal links, foreground
/// and background) on to the app delegate, which UIKit no longer calls for
/// them once the app uses scenes. Named in Info.plist UIApplicationSceneManifest.
@objc(RiftnSceneDelegate)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private let forwarder = SceneEventForwarder()

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let provider = UIApplication.shared.delegate as? RiftnReactNativeFactoryProvider,
      let factory = provider.reactNativeFactory else {
      fatalError("SceneDelegate: the app delegate did not create the React Native factory at launch.")
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    provider.window = window

    // A link that cold-starts the app arrives in the connection options, not
    // in the launch options Linking.getInitialURL() reads, so rebuild them.
    let browsingWebActivity = connectionOptions.userActivities.first {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: Self.launchOptions(
        url: connectionOptions.urlContexts.first(where: { !$0.url.isFileURL })?.url,
        userActivity: browsingWebActivity
      )
    )

    connectionOptions.urlContexts.forEach {
      forwarder.open(url: $0.url, options: Self.openURLOptions(from: $0.options))
    }
    connectionOptions.userActivities.forEach { forwarder.continue($0) }
    if let shortcutItem = connectionOptions.shortcutItem {
      forwarder.perform(shortcutItem) { _ in }
    }
  }

  func sceneDidDisconnect(_ scene: UIScene) {
    window = nil
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    forwarder.didBecomeActive()
  }

  func sceneWillResignActive(_ scene: UIScene) {
    forwarder.willResignActive()
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    forwarder.willEnterForeground()
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    forwarder.didEnterBackground()
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    URLContexts.forEach { forwarder.open(url: $0.url, options: Self.openURLOptions(from: $0.options)) }
  }

  func scene(_ scene: UIScene, willContinueUserActivityWithType userActivityType: String) {
    forwarder.willContinueUserActivity(withType: userActivityType)
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    forwarder.continue(userActivity)
  }

  func scene(
    _ scene: UIScene,
    didFailToContinueUserActivityWithType userActivityType: String,
    error: Error
  ) {
    forwarder.didFailToContinueUserActivity(withType: userActivityType, error: error)
  }

  func scene(_ scene: UIScene, didUpdate userActivity: NSUserActivity) {
    forwarder.didUpdate(userActivity)
  }

  func windowScene(
    _ windowScene: UIWindowScene,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    forwarder.perform(shortcutItem, completionHandler: completionHandler)
  }

  /// The launch options React Native's Linking.getInitialURL() reads, keyed by
  /// their raw strings (the UIApplication accessors are deprecated in iOS 26).
  static func launchOptions(
    url: URL?,
    userActivity: NSUserActivity?
  ) -> [UIApplication.LaunchOptionsKey: Any]? {
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url {
      launchOptions[UIApplication.LaunchOptionsKey(rawValue: "UIApplicationLaunchOptionsURLKey")] = url
    }
    if let userActivity {
      launchOptions[UIApplication.LaunchOptionsKey(rawValue: "UIApplicationLaunchOptionsUserActivityDictionaryKey")] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": userActivity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": userActivity
      ]
    }
    return launchOptions.isEmpty ? nil : launchOptions
  }

  private static func openURLOptions(
    from sceneOptions: UIScene.OpenURLOptions
  ) -> [UIApplication.OpenURLOptionsKey: Any] {
    var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    if let sourceApplication = sceneOptions.sourceApplication {
      options[.sourceApplication] = sourceApplication
    }
    if let annotation = sceneOptions.annotation {
      options[.annotation] = annotation
    }
    options[.openInPlace] = sceneOptions.openInPlace
    return options
  }
}

/// Passes scene events to the app delegate. ExpoAppDelegate hands each one to
/// every Expo module subscriber, so one call reaches both them and the
/// AppDelegate overrides above.
@MainActor
private struct SceneEventForwarder {
  private var appDelegate: ExpoAppDelegate? { UIApplication.shared.delegate as? ExpoAppDelegate }

  func open(url: URL, options: [UIApplication.OpenURLOptionsKey: Any]) {
    if url.isFileURL {
      SharedVideoImport.receive(url)
      return
    }
    let application = UIApplication.shared
    let delegate = appDelegate
    notifyLinkingManagerUnlessAlreadyNotified(of: url) {
      _ = delegate?.application(application, open: url, options: options)
    } notify: {
      RCTLinkingManager.application(application, open: url, options: options)
    }
  }

  func `continue`(_ userActivity: NSUserActivity) {
    let application = UIApplication.shared
    let delegate = appDelegate
    notifyLinkingManagerUnlessAlreadyNotified(of: userActivity.webpageURL) {
      _ = delegate?.application(application, continue: userActivity, restorationHandler: { _ in })
    } notify: {
      RCTLinkingManager.application(application, continue: userActivity, restorationHandler: { _ in })
    }
  }

  func willContinueUserActivity(withType userActivityType: String) {
    _ = appDelegate?.application(UIApplication.shared, willContinueUserActivityWithType: userActivityType)
  }

  func didFailToContinueUserActivity(withType userActivityType: String, error: Error) {
    appDelegate?.application(UIApplication.shared, didFailToContinueUserActivityWithType: userActivityType, error: error)
  }

  func didUpdate(_ userActivity: NSUserActivity) {
    appDelegate?.application(UIApplication.shared, didUpdate: userActivity)
  }

  func didBecomeActive() {
    appDelegate?.applicationDidBecomeActive(UIApplication.shared)
  }

  func willResignActive() {
    appDelegate?.applicationWillResignActive(UIApplication.shared)
  }

  func willEnterForeground() {
    appDelegate?.applicationWillEnterForeground(UIApplication.shared)
  }

  func didEnterBackground() {
    appDelegate?.applicationDidEnterBackground(UIApplication.shared)
  }

  func perform(
    _ shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    guard let delegate = appDelegate else {
      completionHandler(false)
      return
    }
    delegate.application(UIApplication.shared, performActionFor: shortcutItem, completionHandler: completionHandler)
  }

  /// The AppDelegate overrides above already call RCTLinkingManager; only call
  /// it here when they did not, so JS never gets the same link twice.
  private func notifyLinkingManagerUnlessAlreadyNotified(
    of url: URL?,
    during body: () -> Void,
    notify: () -> Void
  ) {
    guard let url else {
      body()
      notify()
      return
    }
    let observer = LinkingManagerObserver(url: url)
    body()
    if !observer.wasNotified {
      notify()
    }
  }
}

/// Watches the notification RCTLinkingManager posts for each link it handles.
private final class LinkingManagerObserver: NSObject {
  private let expectedURL: String
  private(set) var wasNotified = false

  init(url: URL) {
    expectedURL = url.absoluteString
    super.init()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(linkingManagerDidOpenURL(_:)),
      name: Notification.Name("RCTOpenURLNotification"),
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  @objc private func linkingManagerDidOpenURL(_ notification: Notification) {
    wasNotified = wasNotified || notification.userInfo?["url"] as? String == expectedURL
  }
}
