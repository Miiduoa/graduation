import SwiftUI
import WidgetKit

struct SavedClass: Decodable {
    let id: String
    let title: String
    let location: String
    let startAt: Double
    let endAt: Double
    let url: String
    let conflict: Bool
    var start: Date { Date(timeIntervalSince1970: startAt / 1000) }
    var end: Date { Date(timeIntervalSince1970: endAt / 1000) }
}
struct ClassSnapshot: Decodable {
    let version: Int
    let updatedAt: Double
    let expiresAt: Double
    let classes: [SavedClass]
    let incomplete: Bool
    static func read() -> ClassSnapshot? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "NextClassAppGroup") as? String,
              let value = UserDefaults(suiteName: group)?.string(forKey: "nextClassSnapshot"),
              let data = value.data(using: .utf8),
              let snapshot = try? JSONDecoder().decode(Self.self, from: data),
              snapshot.version == 1 else { return nil }
        return snapshot
    }
}
struct ClassEntry: TimelineEntry {
    let date: Date
    let snapshot: ClassSnapshot?
    // Read again when rendering: a cached timeline must never reveal a logged-out account.
    var readable: ClassSnapshot? {
        guard let current = ClassSnapshot.read(), current.updatedAt == snapshot?.updatedAt else { return nil }
        return current
    }
    var stale: Bool {
        guard let value = readable else { return false }
        return date.timeIntervalSince1970 * 1000 >= value.expiresAt || date.timeIntervalSince1970 * 1000 < value.updatedAt
    }
    var course: SavedClass? { stale ? nil : readable?.classes.first { $0.end > date } }
    var heading: String {
        guard let value = readable else { return "開啟 nuni 同步課表" }
        if stale { return "課表需要更新" }
        if let course = course {
            if course.start <= date { return "上課中" }
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "Asia/Taipei")!
            return calendar.isDate(course.start, inSameDayAs: date) ? "下一堂課" : "今天沒課了 · 下一堂"
        }
        return value.incomplete ? "有課程尚未排定時間" : "今天沒有課程"
    }
    var url: URL? { URL(string: course?.url ?? "campus://personal-timetable") }
}
struct ClassProvider: TimelineProvider {
    func placeholder(in context: Context) -> ClassEntry { ClassEntry(date: Date(), snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (ClassEntry) -> Void) {
        completion(ClassEntry(date: Date(), snapshot: ClassSnapshot.read()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<ClassEntry>) -> Void) {
        let now = Date()
        let snapshot = ClassSnapshot.read()
        var dates = [now]
        if let snapshot = snapshot {
            let expiry = Date(timeIntervalSince1970: snapshot.expiresAt / 1000)
            dates += snapshot.classes.flatMap { [$0.start, $0.end] }.filter { $0 > now && $0 < expiry }
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "Asia/Taipei")!
            for day in 1...7 {
                if let midnight = calendar.date(byAdding: .day, value: day, to: calendar.startOfDay(for: now)), midnight < expiry {
                    dates.append(midnight)
                }
            }
            if expiry > now { dates.append(expiry) }
        }
        let entries = Array(Set(dates)).sorted().map { ClassEntry(date: $0, snapshot: snapshot) }
        completion(Timeline(entries: entries, policy: .never))
    }
}
struct ClassView: View {
    let entry: ClassEntry
    @Environment(\.widgetFamily) var family
    private let ink = Color(red: 0.16, green: 0.34, blue: 0.28)
    var body: some View {
        Group {
            switch family {
            case .accessoryInline:
                Text(entry.course.map { "\(entry.heading) · \($0.title) · \($0.location)" } ?? entry.heading)
            case .accessoryCircular:
                VStack {
                    Image(systemName: entry.stale ? "arrow.clockwise" : "book.closed")
                    if let course = entry.course { Text(course.start, style: .time).font(.caption2) }
                    else { Text(entry.stale ? "更新" : "課表").font(.caption2) }
                }
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.heading).font(.caption)
                    Text(entry.course?.title ?? "點此查看課表").font(.headline).lineLimit(1)
                    if let course = entry.course {
                        HStack { Text(course.start, style: .time); Text(course.location).lineLimit(1) }.font(.caption)
                    }
                }
            default:
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("nuni / 課間").font(.caption2).tracking(2)
                        Spacer()
                        Image(systemName: "arrow.up.right")
                    }.foregroundStyle(ink)
                    Text(entry.heading).font(.caption).foregroundStyle(.secondary)
                    if let course = entry.course {
                        Text(course.title).font(.system(.title3, design: .rounded, weight: .semibold)).lineLimit(family == .systemSmall ? 1 : 2)
                        HStack(spacing: 3) {
                            Text(course.start, style: .time)
                            Text("–")
                            Text(course.end, style: .time)
                        }.font(.subheadline).monospacedDigit()
                        Text(course.location).font(.subheadline).foregroundStyle(ink).lineLimit(1)
                        if course.start > entry.date {
                            HStack(spacing: 4) {
                                Text("距上課")
                                Text(course.start, style: .timer).monospacedDigit()
                            }.font(.caption2).foregroundStyle(ink)
                        }
                        if course.conflict { Text("時段重疊，請核對課表").font(.caption2) }
                    } else {
                        Text(entry.stale ? "開啟 App，確認最近的安排。" : "把空下來的時間，留給自己。")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    if let snapshot = entry.readable {
                        HStack(spacing: 3) {
                            Text("週課表 ·")
                            Text(Date(timeIntervalSince1970: snapshot.updatedAt / 1000), style: .relative)
                            Text("前確認")
                        }.font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1)
                    }
                }.padding(12)
            }
        }
        .environment(\.timeZone, TimeZone(identifier: "Asia/Taipei")!)
        .widgetURL(entry.url)
        .privacySensitive()
        .modifier(WidgetPaper())
    }
}
struct WidgetPaper: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content.containerBackground(for: .widget) { Color(red: 0.96, green: 0.95, blue: 0.91) }
        } else { content }
    }
}
@main
struct CampusWidgets: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NextClassWidget", provider: ClassProvider()) { ClassView(entry: $0) }
            .configurationDisplayName("下一堂課")
            .description("課名、時間與教室，離線也能查看最近確認的週課表。")
            .supportedFamilies([.systemSmall, .systemMedium, .accessoryInline, .accessoryCircular, .accessoryRectangular])
    }
}
