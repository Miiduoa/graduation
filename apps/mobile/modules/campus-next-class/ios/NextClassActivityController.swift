import ActivityKit
import Foundation
import UIKit

@available(iOS 16.2, *)
actor NextClassActivityController {
    static let shared = NextClassActivityController()
    private var expiry: Task<Void, Never>?
    private var revision = 0

    func sync(_ value: NextClassActivityAttributes.ContentState?) async throws {
        revision += 1
        let expected = revision
        expiry?.cancel()
        let enabled = UserDefaults.standard.bool(forKey: "nextClassLiveEnabled")
        let permitted = ActivityAuthorizationInfo().areActivitiesEnabled
        let content = enabled && permitted && (value?.end ?? .distantPast) > Date() ? value : nil
        let activities = Activity<NextClassActivityAttributes>.activities
        var current = activities.first { $0.content.state.key == content?.key }
        for activity in activities where activity.id != current?.id || content == nil {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        guard expected == revision, let content = content, content.end > Date() else { return }
        let update = ActivityContent(state: content, staleDate: content.end)
        if let activity = current {
            await activity.update(update)
        } else {
            let foreground = await MainActor.run { UIApplication.shared.applicationState == .active }
            guard expected == revision, foreground,
                  UserDefaults.standard.bool(forKey: "nextClassLiveEnabled"),
                  ActivityAuthorizationInfo().areActivitiesEnabled else { return }
            current = try Activity.request(attributes: NextClassActivityAttributes(), content: update, pushType: nil)
        }
        guard expected == revision, let activity = current else { return }
        let delay = max(0, content.end.timeIntervalSinceNow)
        expiry = Task {
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}
