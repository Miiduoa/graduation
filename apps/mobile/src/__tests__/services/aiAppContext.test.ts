import {
  buildAIAppContext,
  emptyAIAppRuntimeData,
  loadAIAppRuntimeData,
} from "../../services/aiAppContext";
import type { DataSource } from "../../data/source";

describe("aiAppContext", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("builds a whole-app pulse summary from app data, risks, actions, and memory", () => {
    const now = new Date("2026-05-05T08:00:00+08:00");
    const context = buildAIAppContext({
      schoolId: "tw-pu",
      userId: "u1",
      userName: "測試同學",
      role: "student",
      isOnline: true,
      now,
      courses: [
        {
          id: "course-1",
          code: "CS101",
          name: "資料庫系統",
          instructor: "王老師",
          credits: 3,
          semester: "114-2",
          schedule: [{ dayOfWeek: 2, startTime: "09:10", endTime: "12:00", location: "DB201" }],
        },
      ],
      pendingAssignments: [
        { id: "a-late", title: "訪談紀錄整理", groupName: "人機互動", isLate: true },
        { id: "a-soon", title: "資料庫期末專題", groupName: "資料庫系統", dueAt: "2026-05-06T10:00:00+08:00" },
      ],
      announcements: [{ id: "ann-1", title: "重要公告", body: "", publishedAt: "2026-05-05" }],
      events: [{ id: "evt-1", title: "職涯講座", startsAt: "2026-05-06", location: "伯鐸樓" }],
      menus: [{ id: "menu-1", name: "蛋餅", cafeteria: "靜園餐廳", availableOn: "today" }],
      pois: [{ id: "poi-1", name: "蓋夏圖書館", category: "library", lat: 0, lng: 0 }],
      runtimeData: {
        ...emptyAIAppRuntimeData(),
        nextBestActions: [{
          id: "nba-1",
          title: "先補交逾期作業",
          description: "人機互動作業逾期",
          priority: 1,
          urgency: "high",
          reason: "逾期會影響平時成績",
          nextStep: "打開作業頁補交",
          actionLabel: "前往作業",
          evidenceRefs: [],
          requiresConfirmation: false,
          source: "risk",
        }],
        riskSnapshots: [{
          id: "risk-1",
          userId: "u1",
          schoolId: "tw-pu",
          level: "warning",
          score: 68,
          summary: "作業逾期且近期有截止項目。",
          signals: [],
          recommendedActions: [],
          generatedAt: now,
        }],
        pulseAggregates: [{
          id: "pulse-1",
          schoolId: "tw-pu",
          locationId: "lib_main",
          locationName: "蓋夏圖書館",
          category: "library",
          currentLevel: 5,
          confidence: 0.9,
          sampleSize: 20,
          reportCount24h: 20,
          trend: "rising",
          bestTimeToVisit: "14:00-15:00",
          updatedAt: now,
        }],
      },
      agentMemory: {
        userId: "u1",
        version: 1,
        createdAt: now.toISOString(),
        lastActiveAt: now.toISOString(),
        preferences: {
          foodPreferences: ["清淡"],
          allergens: ["花生"],
          frequentLocations: ["圖書館"],
          communicationStyle: "casual",
          reminderLeadTime: 10,
          quietHours: { start: "22:00", end: "07:00" },
        },
        recentActions: [{ toolId: "set_reminder", params: {}, timestamp: now.toISOString(), wasSuccessful: true }],
        conversationPatterns: [],
        knownSchedule: [],
        learnedFacts: [{ id: "fact-1", fact: "使用者偏好短回答", confidence: 0.9, category: "personal", learnedAt: now.toISOString(), source: "explicit" }],
        conversationSummaries: [],
      },
    });

    expect(context.appPulseSummary).toContain("學習/生活風險：warning");
    expect(context.appPulseSummary).toContain("逾期作業");
    expect(context.appPulseSummary).toContain("72 小時內截止");
    expect(context.appPulseSummary).toContain("Next Best Actions");
    expect(context.appPulseSummary).toContain("校園即時脈動");
    expect(context.appPulseSummary).toContain("長期偏好");
    expect(context.appDataCoverage?.find((row) => row.key === "courses")?.count).toBe(1);
    expect(context.role).toBe("student");
  });

  it("loads runtime data best-effort without failing the whole AI context", async () => {
    const ds = {
      listPulseAggregates: jest.fn(async () => [{ id: "pulse-1" }]),
      listNextBestActions: jest.fn(async () => [{ id: "nba-1" }]),
      listRiskSnapshots: jest.fn(async () => { throw new Error("risk backend unavailable"); }),
      listCalendarEvents: jest.fn(async () => [{ id: "cal-1" }]),
      listNotifications: jest.fn(async () => [{ id: "notif-1" }]),
      listOrders: jest.fn(async () => [{ id: "order-1" }]),
      listRepairRequests: jest.fn(async () => [{ id: "repair-1" }]),
      listHealthAppointments: jest.fn(async () => [{ id: "health-1" }]),
      listSeatReservations: jest.fn(async () => [{ id: "seat-1" }]),
      listPrintJobs: jest.fn(async () => [{ id: "print-1" }]),
      listDormPackages: jest.fn(async () => [{ id: "pkg-1" }]),
      listConversations: jest.fn(async () => [{ id: "conv-1" }]),
      listLoans: jest.fn(async () => [{ id: "loan-1" }]),
      listWashingReservations: jest.fn(async () => [{ id: "wash-1" }]),
    } as unknown as DataSource;

    const data = await loadAIAppRuntimeData({
      dataSource: ds,
      userId: "u1",
      schoolId: "tw-pu",
      now: new Date("2026-05-05T08:00:00+08:00"),
    });

    expect(data.pulseAggregates).toHaveLength(1);
    expect(data.nextBestActions).toHaveLength(1);
    expect(data.riskSnapshots).toEqual([]);
    expect(data.calendarEvents).toHaveLength(1);
    expect(data.washingReservations).toHaveLength(1);
  });
});
