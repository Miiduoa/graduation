import ExpoModulesCore
import GoogleSignIn
import UIKit

public class CampusGoogleCredentialModule: Module {
  // GoogleSignIn is a process-wide singleton. Serialize even across JS reloads.
  private static var signInInProgress = false

  public func definition() -> ModuleDefinition {
    Name("CampusGoogleCredential")

    Function("isConfigured") { Self.configuredClientID() != nil }

    AsyncFunction("getIdToken") { (serverClientId: String, nonce: String, promise: Promise) in
      guard !Self.signInInProgress else {
        promise.reject("GOOGLE_CREDENTIAL_BUSY", "Google sign-in is already in progress.")
        return
      }
      guard let clientId = Self.configuredClientID(),
            Self.validClientID(serverClientId),
            clientId != serverClientId,
            nonce.count >= 32, nonce.count <= 512,
            nonce.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else {
        promise.reject("GOOGLE_CREDENTIAL_CONFIGURATION", "Google sign-in configuration is unavailable.")
        return
      }
      guard let presenter = appContext?.utilities?.currentViewController(), presenter.view.window != nil else {
        promise.reject("GOOGLE_CREDENTIAL_ACTIVITY_UNAVAILABLE", "Google sign-in cannot be presented.")
        return
      }
      Self.signInInProgress = true
      let google = GIDSignIn.sharedInstance
      // Never reuse an old ID token: every attempt must carry this API transaction's nonce.
      google.signOut()
      google.configuration = GIDConfiguration(clientID: clientId, serverClientID: serverClientId)
      google.signIn(withPresenting: presenter, hint: nil, additionalScopes: nil, nonce: nonce) { result, error in
        defer {
          google.signOut()
          Self.signInInProgress = false
        }
        if let error = error as NSError? {
          // kGIDSignInErrorCodeCanceled is -5 in the pinned SDK's NSError domain.
          let code = error.domain == kGIDSignInErrorDomain && error.code == -5
            ? "GOOGLE_CREDENTIAL_CANCELLED" : "GOOGLE_CREDENTIAL_FAILED"
          promise.reject(code, "Google sign-in did not complete.")
          return
        }
        guard let token = result?.user.idToken?.tokenString, !token.isEmpty else {
          promise.reject("GOOGLE_CREDENTIAL_FAILED", "Google sign-in did not return an ID token.")
          return
        }
        // No access/refresh token or user profile crosses the bridge.
        promise.resolve(["idToken": token])
      }
    }.runOnQueue(.main)

    AsyncFunction("clearCredentialState") { (promise: Promise) in
      guard !Self.signInInProgress else {
        promise.reject("GOOGLE_CREDENTIAL_BUSY", "Google sign-in is still in progress.")
        return
      }
      GIDSignIn.sharedInstance.signOut()
      promise.resolve(true)
    }.runOnQueue(.main)
  }

  private static func configuredClientID() -> String? {
    guard let clientId = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String,
          validClientID(clientId) else { return nil }
    let reversedClientId = clientId.components(separatedBy: ".").reversed().joined(separator: ".")
    let urlTypes = Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] ?? []
    guard urlTypes.contains(where: { ($0["CFBundleURLSchemes"] as? [String])?.contains(reversedClientId) == true }) else {
      return nil
    }
    return clientId
  }

  private static func validClientID(_ value: String) -> Bool {
    value.range(of: "^[0-9]+-[a-z0-9]+\\.apps\\.googleusercontent\\.com$", options: .regularExpression) != nil
  }
}
