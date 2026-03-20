/**
 * Campus App iOS Widget
 * 
 * 這是 iOS Widget Extension 的 Swift 程式碼範本。
 * 需要在 Xcode 中建立 Widget Extension target 並使用此程式碼。
 */

import WidgetKit
import SwiftUI

// MARK: - Widget Data Models

struct WidgetCourse: Codable, Identifiable {
    let id: String
    let name: String
    let time: String
    let location: String
    let color: String?
}

struct TodayScheduleEntry: TimelineEntry {
    let date: Date
    let courses: [WidgetCourse]
    let dayOfWeek: String
}

struct NextClassEntry: TimelineEntry {
    let date: Date
    let hasNextClass: Bool
    let courseName: String?
    let courseTime: String?
    let courseLocation: String?
    let minutesUntilStart: Int?
    let message: String?
}

struct BusArrivalEntry: TimelineEntry {
    let date: Date
    let stopName: String
    let arrivals: [(routeName: String, minutes: Int, crowdLevel: String)]
}

struct AnnouncementEntry: TimelineEntry {
    let date: Date
    let announcements: [(title: String, source: String, isUrgent: Bool)]
    let unreadCount: Int
}

// MARK: - Shared Data Manager

class WidgetDataManager {
    static let shared = WidgetDataManager()
    private let appGroupId = "group.com.campus.app"
    
    private var userDefaults: UserDefaults? {
        return UserDefaults(suiteName: appGroupId)
    }
    
    func getTodaySchedule() -> [WidgetCourse] {
        guard let data = userDefaults?.data(forKey: "widget.todaySchedule"),
              let courses = try? JSONDecoder().decode([WidgetCourse].self, from: data) else {
            return []
        }
        return courses
    }
    
    func getNextClass() -> (course: WidgetCourse?, minutesUntil: Int?, message: String?) {
        if let data = userDefaults?.data(forKey: "widget.nextClass"),
           let course = try? JSONDecoder().decode(WidgetCourse.self, from: data) {
            let minutesUntil = calculateMinutesUntilClass(courseTime: course.time)
            return (course, minutesUntil, nil)
        }
        return (nil, nil, userDefaults?.string(forKey: "widget.nextClass.message") ?? "今天沒有課程")
    }
    
    /// Calculate minutes until a class starts
    /// - Parameter courseTime: Time string in format "HH:mm" or "HH:mm-HH:mm"
    /// - Returns: Minutes until the class starts, or nil if time has passed
    func calculateMinutesUntilClass(courseTime: String) -> Int? {
        // Extract start time (handle both "HH:mm" and "HH:mm-HH:mm" formats)
        let startTimeString = courseTime.components(separatedBy: "-").first ?? courseTime
        let cleanedTime = startTimeString.trimmingCharacters(in: .whitespaces)
        
        guard let startDate = parseTimeString(cleanedTime) else {
            return nil
        }
        
        let now = Date()
        let calendar = Calendar.current
        
        // Create date components for today with the course time
        var courseComponents = calendar.dateComponents([.year, .month, .day], from: now)
        let timeComponents = calendar.dateComponents([.hour, .minute], from: startDate)
        courseComponents.hour = timeComponents.hour
        courseComponents.minute = timeComponents.minute
        
        guard let courseDate = calendar.date(from: courseComponents) else {
            return nil
        }
        
        let diffMinutes = Int(courseDate.timeIntervalSince(now) / 60)
        
        // Return nil if the class has already started
        if diffMinutes < 0 {
            return nil
        }
        
        return diffMinutes
    }
    
    /// Parse a time string in "HH:mm" format to a Date
    private func parseTimeString(_ timeString: String) -> Date? {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.date(from: timeString)
    }
    
    /// Get the next upcoming class from today's schedule
    func getUpcomingClass() -> (course: WidgetCourse?, minutesUntil: Int?, message: String?) {
        let courses = getTodaySchedule()
        let now = Date()
        let calendar = Calendar.current
        
        // Find the next class that hasn't started yet
        for course in courses {
            if let minutesUntil = calculateMinutesUntilClass(courseTime: course.time), minutesUntil > -50 {
                // Allow up to 50 minutes past start time (class might still be ongoing)
                return (course, max(0, minutesUntil), nil)
            }
        }
        
        // Check if there are any classes tomorrow
        if courses.isEmpty {
            return (nil, nil, "今天沒有課程")
        } else {
            return (nil, nil, "今天的課程已結束")
        }
    }
    
    /// Calculate ETA text based on minutes
    func formatTimeUntilClass(_ minutes: Int) -> String {
        if minutes <= 0 {
            return "現在開始"
        } else if minutes == 1 {
            return "1 分鐘後"
        } else if minutes < 60 {
            return "\(minutes) 分鐘後"
        } else {
            let hours = minutes / 60
            let remainingMinutes = minutes % 60
            if remainingMinutes == 0 {
                return "\(hours) 小時後"
            } else {
                return "\(hours) 小時 \(remainingMinutes) 分後"
            }
        }
    }
    
    /// Get urgency level based on minutes until class
    func getUrgencyLevel(_ minutes: Int?) -> UrgencyLevel {
        guard let minutes = minutes else { return .none }
        
        switch minutes {
        case 0...5:
            return .critical
        case 6...15:
            return .high
        case 16...30:
            return .medium
        default:
            return .low
        }
    }
}

enum UrgencyLevel {
    case critical   // 0-5 minutes
    case high       // 6-15 minutes
    case medium     // 16-30 minutes
    case low        // > 30 minutes
    case none       // No upcoming class
    
    var color: Color {
        switch self {
        case .critical: return .red
        case .high: return .orange
        case .medium: return .yellow
        case .low: return .green
        case .none: return .gray
        }
    }
    
    var backgroundColor: Color {
        switch self {
        case .critical: return Color.red.opacity(0.2)
        case .high: return Color.orange.opacity(0.2)
        case .medium: return Color.yellow.opacity(0.2)
        case .low: return Color.green.opacity(0.2)
        case .none: return Color.gray.opacity(0.1)
        }
    }
}

// MARK: - Today Schedule Widget

struct TodayScheduleProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayScheduleEntry {
        TodayScheduleEntry(
            date: Date(),
            courses: [
                WidgetCourse(id: "1", name: "微積分", time: "08:10", location: "理學院 101", color: "#4F46E5"),
                WidgetCourse(id: "2", name: "程式設計", time: "10:20", location: "資工系 302", color: "#059669")
            ],
            dayOfWeek: "週一"
        )
    }
    
    func getSnapshot(in context: Context, completion: @escaping (TodayScheduleEntry) -> Void) {
        let courses = WidgetDataManager.shared.getTodaySchedule()
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_TW")
        formatter.dateFormat = "EEEE"
        let dayOfWeek = formatter.string(from: Date())
        
        completion(TodayScheduleEntry(date: Date(), courses: courses, dayOfWeek: dayOfWeek))
    }
    
    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayScheduleEntry>) -> Void) {
        getSnapshot(in: context) { entry in
            let nextUpdate = Calendar.current.date(byAdding: .hour, value: 1, to: Date())!
            let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
            completion(timeline)
        }
    }
}

struct TodayScheduleWidgetView: View {
    var entry: TodayScheduleEntry
    @Environment(\.widgetFamily) var family
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "calendar")
                    .foregroundColor(.blue)
                Text("今日課表")
                    .font(.headline)
                    .fontWeight(.bold)
                Spacer()
                Text(entry.dayOfWeek)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            if entry.courses.isEmpty {
                Spacer()
                HStack {
                    Spacer()
                    VStack {
                        Image(systemName: "sun.max.fill")
                            .font(.largeTitle)
                            .foregroundColor(.yellow)
                        Text("今天沒有課程")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                }
                Spacer()
            } else {
                ForEach(entry.courses.prefix(family == .systemLarge ? 6 : 3)) { course in
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Color(hex: course.color ?? "#4F46E5"))
                            .frame(width: 4)
                        
                        VStack(alignment: .leading, spacing: 2) {
                            Text(course.name)
                                .font(.subheadline)
                                .fontWeight(.semibold)
                                .lineLimit(1)
                            
                            HStack(spacing: 4) {
                                Text(course.time)
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                                Text("·")
                                    .foregroundColor(.secondary)
                                Text(course.location)
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                                    .lineLimit(1)
                            }
                        }
                        Spacer()
                    }
                    .padding(.vertical, 4)
                    .background(Color(.systemGray6))
                    .cornerRadius(8)
                }
            }
        }
        .padding()
    }
}

struct TodayScheduleWidget: Widget {
    let kind: String = "TodayScheduleWidget"
    
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodayScheduleProvider()) { entry in
            TodayScheduleWidgetView(entry: entry)
        }
        .configurationDisplayName("今日課表")
        .description("顯示今天的課程安排")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// MARK: - Next Class Widget

struct NextClassProvider: TimelineProvider {
    func placeholder(in context: Context) -> NextClassEntry {
        NextClassEntry(
            date: Date(),
            hasNextClass: true,
            courseName: "程式設計",
            courseTime: "10:20",
            courseLocation: "資工系 302",
            minutesUntilStart: 15,
            message: nil
        )
    }
    
    func getSnapshot(in context: Context, completion: @escaping (NextClassEntry) -> Void) {
        // Use getUpcomingClass which properly calculates time
        let (course, minutesUntil, message) = WidgetDataManager.shared.getUpcomingClass()
        
        if let course = course {
            completion(NextClassEntry(
                date: Date(),
                hasNextClass: true,
                courseName: course.name,
                courseTime: course.time,
                courseLocation: course.location,
                minutesUntilStart: minutesUntil,
                message: nil
            ))
        } else {
            completion(NextClassEntry(
                date: Date(),
                hasNextClass: false,
                courseName: nil,
                courseTime: nil,
                courseLocation: nil,
                minutesUntilStart: nil,
                message: message
            ))
        }
    }
    
    func getTimeline(in context: Context, completion: @escaping (Timeline<NextClassEntry>) -> Void) {
        let (course, minutesUntil, message) = WidgetDataManager.shared.getUpcomingClass()
        var entries: [NextClassEntry] = []
        let now = Date()
        
        if let course = course, let minutes = minutesUntil {
            // Create entries for the countdown
            // More frequent updates when class is approaching
            let updateIntervals: [Int]
            if minutes <= 5 {
                updateIntervals = [0, 1, 2, 3, 4, 5]  // Every minute
            } else if minutes <= 15 {
                updateIntervals = [0, 5, 10, 15]  // Every 5 minutes
            } else if minutes <= 60 {
                updateIntervals = Array(stride(from: 0, through: min(minutes, 60), by: 15))  // Every 15 minutes
            } else {
                updateIntervals = Array(stride(from: 0, through: min(minutes, 120), by: 30))  // Every 30 minutes
            }
            
            for interval in updateIntervals {
                let entryDate = Calendar.current.date(byAdding: .minute, value: interval, to: now)!
                let remainingMinutes = max(0, minutes - interval)
                
                entries.append(NextClassEntry(
                    date: entryDate,
                    hasNextClass: true,
                    courseName: course.name,
                    courseTime: course.time,
                    courseLocation: course.location,
                    minutesUntilStart: remainingMinutes,
                    message: nil
                ))
            }
            
            // Schedule next update based on urgency
            let nextUpdateMinutes: Int
            if minutes <= 5 {
                nextUpdateMinutes = 1
            } else if minutes <= 15 {
                nextUpdateMinutes = 5
            } else if minutes <= 60 {
                nextUpdateMinutes = 15
            } else {
                nextUpdateMinutes = 30
            }
            
            let nextUpdate = Calendar.current.date(byAdding: .minute, value: nextUpdateMinutes, to: now)!
            let timeline = Timeline(entries: entries, policy: .after(nextUpdate))
            completion(timeline)
        } else {
            // No upcoming class, check again in 30 minutes
            entries.append(NextClassEntry(
                date: now,
                hasNextClass: false,
                courseName: nil,
                courseTime: nil,
                courseLocation: nil,
                minutesUntilStart: nil,
                message: message
            ))
            
            let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: now)!
            let timeline = Timeline(entries: entries, policy: .after(nextUpdate))
            completion(timeline)
        }
    }
}

struct NextClassWidgetView: View {
    var entry: NextClassEntry
    @Environment(\.widgetFamily) var family
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "clock.fill")
                    .foregroundColor(.orange)
                Text("下一堂課")
                    .font(.headline)
                    .fontWeight(.bold)
            }
            
            if entry.hasNextClass, let name = entry.courseName {
                VStack(alignment: .leading, spacing: 4) {
                    Text(name)
                        .font(.title3)
                        .fontWeight(.bold)
                        .lineLimit(1)
                    
                    if let time = entry.courseTime {
                        HStack(spacing: 4) {
                            Image(systemName: "clock")
                                .font(.caption)
                            Text(time)
                                .font(.subheadline)
                        }
                        .foregroundColor(.secondary)
                    }
                    
                    if let location = entry.courseLocation {
                        HStack(spacing: 4) {
                            Image(systemName: "location.fill")
                                .font(.caption)
                            Text(location)
                                .font(.subheadline)
                        }
                        .foregroundColor(.secondary)
                    }
                    
                    if let minutes = entry.minutesUntilStart {
                        let urgency = WidgetDataManager.shared.getUrgencyLevel(minutes)
                        let timeText = WidgetDataManager.shared.formatTimeUntilClass(minutes)
                        
                        Text(timeText)
                            .font(.caption)
                            .fontWeight(urgency == .critical ? .bold : .regular)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(urgency.backgroundColor)
                            .foregroundColor(urgency.color)
                            .cornerRadius(8)
                    }
                }
            } else {
                Spacer()
                HStack {
                    Spacer()
                    VStack {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.largeTitle)
                            .foregroundColor(.green)
                        Text(entry.message ?? "今天沒有課程")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    Spacer()
                }
                Spacer()
            }
        }
        .padding()
    }
}

struct NextClassWidget: Widget {
    let kind: String = "NextClassWidget"
    
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NextClassProvider()) { entry in
            NextClassWidgetView(entry: entry)
        }
        .configurationDisplayName("下一堂課")
        .description("顯示即將到來的課程")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Bus Arrival Widget

struct BusArrivalProvider: TimelineProvider {
    func placeholder(in context: Context) -> BusArrivalEntry {
        BusArrivalEntry(
            date: Date(),
            stopName: "校門口站",
            arrivals: [
                ("校園環線", 3, "medium"),
                ("火車站接駁", 8, "low")
            ]
        )
    }
    
    func getSnapshot(in context: Context, completion: @escaping (BusArrivalEntry) -> Void) {
        completion(placeholder(in: context))
    }
    
    func getTimeline(in context: Context, completion: @escaping (Timeline<BusArrivalEntry>) -> Void) {
        getSnapshot(in: context) { entry in
            let nextUpdate = Calendar.current.date(byAdding: .minute, value: 5, to: Date())!
            let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
            completion(timeline)
        }
    }
}

struct BusArrivalWidgetView: View {
    var entry: BusArrivalEntry
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "bus.fill")
                    .foregroundColor(.green)
                Text(entry.stopName)
                    .font(.headline)
                    .fontWeight(.bold)
            }
            
            ForEach(entry.arrivals.prefix(3), id: \.routeName) { arrival in
                HStack {
                    Text(arrival.routeName)
                        .font(.subheadline)
                    Spacer()
                    Text("\(arrival.minutes) 分")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(arrival.minutes <= 3 ? .red : .primary)
                    
                    Circle()
                        .fill(crowdColor(arrival.crowdLevel))
                        .frame(width: 8, height: 8)
                }
                .padding(.vertical, 4)
            }
        }
        .padding()
    }
    
    func crowdColor(_ level: String) -> Color {
        switch level {
        case "low": return .green
        case "medium": return .yellow
        case "high": return .orange
        case "full": return .red
        default: return .gray
        }
    }
}

struct BusArrivalWidget: Widget {
    let kind: String = "BusArrivalWidget"
    
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BusArrivalProvider()) { entry in
            BusArrivalWidgetView(entry: entry)
        }
        .configurationDisplayName("公車到站")
        .description("顯示公車即時到站時間")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Announcement Widget

struct AnnouncementProvider: TimelineProvider {
    func placeholder(in context: Context) -> AnnouncementEntry {
        AnnouncementEntry(
            date: Date(),
            announcements: [
                ("113 學年度第二學期選課公告", "教務處", true),
                ("圖書館暑假開放時間調整", "圖書館", false)
            ],
            unreadCount: 2
        )
    }
    
    func getSnapshot(in context: Context, completion: @escaping (AnnouncementEntry) -> Void) {
        completion(placeholder(in: context))
    }
    
    func getTimeline(in context: Context, completion: @escaping (Timeline<AnnouncementEntry>) -> Void) {
        getSnapshot(in: context) { entry in
            let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: Date())!
            let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
            completion(timeline)
        }
    }
}

struct AnnouncementWidgetView: View {
    var entry: AnnouncementEntry
    @Environment(\.widgetFamily) var family
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "megaphone.fill")
                    .foregroundColor(.purple)
                Text("最新公告")
                    .font(.headline)
                    .fontWeight(.bold)
                Spacer()
                if entry.unreadCount > 0 {
                    Text("\(entry.unreadCount)")
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.red)
                        .clipShape(Capsule())
                }
            }
            
            ForEach(entry.announcements.prefix(family == .systemLarge ? 5 : 2), id: \.title) { announcement in
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        if announcement.isUrgent {
                            Image(systemName: "exclamationmark.circle.fill")
                                .font(.caption)
                                .foregroundColor(.red)
                        }
                        Text(announcement.title)
                            .font(.subheadline)
                            .fontWeight(announcement.isUrgent ? .bold : .regular)
                            .lineLimit(2)
                    }
                    Text(announcement.source)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.vertical, 4)
            }
        }
        .padding()
    }
}

struct AnnouncementWidget: Widget {
    let kind: String = "AnnouncementWidget"
    
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: AnnouncementProvider()) { entry in
            AnnouncementWidgetView(entry: entry)
        }
        .configurationDisplayName("最新公告")
        .description("顯示最新校園公告")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

// MARK: - Widget Bundle

@main
struct CampusWidgets: WidgetBundle {
    var body: some Widget {
        TodayScheduleWidget()
        NextClassWidget()
        BusArrivalWidget()
        AnnouncementWidget()
    }
}

// MARK: - Color Extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (1, 1, 1, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue:  Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
