import ActivityKit
import Foundation

@available(iOS 16.2, *)
struct NextClassActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let key: String
        let title: String
        let location: String
        let startAt: Double
        let endAt: Double
        let url: String
        let mapURL: String
        let conflict: Bool
        var start: Date { Date(timeIntervalSince1970: startAt / 1000) }
        var end: Date { Date(timeIntervalSince1970: endAt / 1000) }
    }
}
