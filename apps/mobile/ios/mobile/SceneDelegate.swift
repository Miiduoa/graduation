import React
import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    guard let factory = appDelegate.reactNativeFactory else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window

    let launchOptions = appDelegate.mergedLaunchOptions(connectionOptions: connectionOptions)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions
    )

    window.makeKeyAndVisible()
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let url = URLContexts.first?.url else { return }
    _ = RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }
}
