import ExpoModulesCore
import WidgetKit
import ActivityKit

public class CampusNextClassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CampusNextClass")
    OnCreate {
      if #available(iOS 16.2, *) {
        Task { await NextClassActivityController.shared.endExpired() }
      }
    }
    OnAppEntersForeground {
      if #available(iOS 16.2, *) {
        Task { await NextClassActivityController.shared.endExpired() }
      }
    }
    AsyncFunction("liveActivityStatus") { () -> [String: Bool] in
      if #available(iOS 16.2, *) {
        return ["supported": true, "allowed": ActivityAuthorizationInfo().areActivitiesEnabled,
                "enabled": UserDefaults.standard.bool(forKey: "nextClassLiveEnabled")]
      }
      return ["supported": false, "allowed": false, "enabled": false]
    }
    AsyncFunction("setLiveActivityEnabled") { (enabled: Bool) async throws in
      UserDefaults.standard.set(enabled, forKey: "nextClassLiveEnabled")
      if #available(iOS 16.2, *), !enabled {
        try await NextClassActivityController.shared.sync(nil)
      }
    }
    AsyncFunction("setLiveActivity") { (value: [String: Any]?) async throws in
      if #available(iOS 16.2, *) {
        var content: NextClassActivityAttributes.ContentState?
        if let value = value {
          let data = try JSONSerialization.data(withJSONObject: value)
          guard data.count < 4096 else { throw NSError(domain: "CampusNextClass", code: 2) }
          content = try JSONDecoder().decode(NextClassActivityAttributes.ContentState.self, from: data)
        }
        try await NextClassActivityController.shared.sync(content)
      }
    }
    AsyncFunction("setSnapshot") { (value: String?) in
      guard let group = Bundle.main.object(forInfoDictionaryKey: "NextClassAppGroup") as? String,
            let defaults = UserDefaults(suiteName: group) else { return }
      if let value = value {
        guard value.utf8.count <= 1_000_000,
              let data = value.data(using: .utf8),
              (try? JSONSerialization.jsonObject(with: data)) != nil else {
          throw NSError(domain: "CampusNextClass", code: 1)
        }
        defaults.set(value, forKey: "nextClassSnapshot")
      } else {
        defaults.removeObject(forKey: "nextClassSnapshot")
      }
      defaults.synchronize()
      WidgetCenter.shared.reloadTimelines(ofKind: "NextClassWidget")
    }
  }
}
