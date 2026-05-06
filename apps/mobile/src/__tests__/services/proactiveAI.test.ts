jest.mock("../../firebase", () => ({
  getDb: jest.fn(() => ({})),
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

import { buildProactiveAIReports } from "../../services/proactiveAI";

describe("proactive AI reports", () => {
  const now = new Date("2026-04-30T08:10:00+08:00");
  const today = now.getDay();

  it("creates a class-soon report from the user's real course schedule", () => {
    const reports = buildProactiveAIReports({
      courses: [
        {
          id: "course-db",
          code: "DB",
          name: "資料庫系統",
          instructor: "王真實",
          credits: 3,
          semester: "2026-2",
          schedule: [
            { dayOfWeek: today, startTime: "08:40", endTime: "10:00", location: "DB201" },
          ],
        },
      ],
    }, { now });

    const classReport = reports.find((report) => report.kind === "class_soon");
    expect(classReport?.title).toContain("30 分鐘後");
    expect(classReport?.body).toContain("資料庫系統");
    expect(classReport?.body).toContain("DB201");
  });

  it("reports due and late assignments without inventing course data", () => {
    const reports = buildProactiveAIReports({
      pendingAssignments: [
        {
          id: "asn-due",
          groupId: "group-db",
          groupName: "資料庫系統",
          title: "資料庫期末專題",
          dueAt: { seconds: Math.floor(new Date("2026-04-30T18:00:00+08:00").getTime() / 1000) },
          isLate: false,
        },
        {
          id: "asn-late",
          groupId: "group-ux",
          groupName: "人機互動",
          title: "訪談紀錄整理",
          dueAt: { seconds: Math.floor(new Date("2026-04-29T18:00:00+08:00").getTime() / 1000) },
          isLate: true,
        },
      ],
    }, { now });

    expect(reports.some((report) => report.kind === "assignment_due" && report.body.includes("資料庫期末專題"))).toBe(true);
    expect(reports.some((report) => report.kind === "assignment_late" && report.body.includes("訪談紀錄整理"))).toBe(true);
    expect(reports.some((report) => report.body.includes("人工智慧概論"))).toBe(false);
  });

  it("includes important announcements in the daily proactive report", () => {
    const reports = buildProactiveAIReports({
      announcements: [
        {
          id: "ann-important",
          title: "重要：獎學金申請截止提醒",
          body: "申請截止日為 5 月 3 日。",
          publishedAt: "2026-04-30",
        },
      ],
    }, { now });

    expect(reports.some((report) => report.kind === "daily_brief" && report.body.includes("獎學金申請截止"))).toBe(true);
    expect(reports.some((report) => report.kind === "announcement" && report.title.includes("重要公告"))).toBe(true);
  });
});
