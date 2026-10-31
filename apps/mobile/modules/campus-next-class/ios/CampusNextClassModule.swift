import ExpoModulesCore
import WidgetKit

public class CampusNextClassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CampusNextClass")
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
