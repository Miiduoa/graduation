import type { Course, CrowdReport, ImportedArtifact } from "../../data/types";
import type { ICalEvent } from "../../services/ical";
import {
  buildCampusSignals,
  createImportedArtifactFromEvents,
  getFreshnessLabel,
  getTodaySourceLabel,
} from "../../services/studentOs";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  multiRemove: jest.fn(),
  getAllKeys: jest.fn(),
}));

describe("studentOs service", () => {
  const now = new Date("2026-03-20T08:20:00.000Z");

  it("builds signals with user-import data ranked ahead of public data", () => {
    const courses: Course[] = [
      {
        id: "manual-1",
        code: "MANUAL",
        name: "英文聽講",
        instructor: "張老師",
        credits: 0,
        semester: "自訂",
        dayOfWeek: now.getDay(),
        startTime: "08:30",
        endTime: "09:20",
        location: "伯鐸樓 201",
        schedule: [
          {
            dayOfWeek: now.getDay(),
            startTime: "08:30",
            endTime: "09:20",
            location: "伯鐸樓 201",
          },
        ],
      },
    ];

    const importedArtifacts: ImportedArtifact[] = [
      {
        id: "artifact-1",
        artifactType: "ical",
        confidence: 0.9,
        createdAt: now.toISOString(),
        userConfirmedAt: now.toISOString(),
        parsedEntities: [
          {
            id: "event-1",
            entityType: "event",
            title: "系學會會議",
            date: new Date("2026-03-20T10:00:00.000Z").toISOString(),
            startTime: "10:00",
            endTime: "11:00",
            location: "主顧樓",
          },
        ],
      },
    ];

    const crowdReports: CrowdReport[] = [
      {
        id: "crowd-1",
        schoolId: "pu",
        signalType: "cafeteria_queue",
        placeId: "cafeteria",
        placeName: "學餐",
        value: "high",
        evidenceType: "self_report",
        reporterReputation: 0.8,
        createdAt: new Date("2026-03-20T08:10:00.000Z").toISOString(),
        expiresAt: new Date("2026-03-20T09:40:00.000Z").toISOString(),
        trustScore: 0.8,
      },
    ];

    const signals = buildCampusSignals({
      schoolId: "pu",
      now,
      courses,
      importedArtifacts,
      crowdReports,
      announcements: [
        {
          id: "ann-1",
          title: "停車場維修公告",
          body: "請改道通行",
          publishedAt: new Date("2026-03-20T07:30:00.000Z").toISOString(),
        },
      ],
    });

    expect(signals.some((signal) => signal.source === "user_import" && signal.type === "course")).toBe(true);
    expect(signals.some((signal) => signal.type === "crowd")).toBe(true);
    expect(signals.some((signal) => signal.type === "announcement")).toBe(true);
  });

  it("creates imported artifacts from iCal events", () => {
    const events: ICalEvent[] = [
      {
        id: "ical-1",
        title: "微積分",
        location: "理學院 101",
        startDate: new Date("2026-03-20T09:00:00.000Z"),
        endDate: new Date("2026-03-20T10:00:00.000Z"),
      },
    ];

    const artifact = createImportedArtifactFromEvents(events);

    expect(artifact.artifactType).toBe("ical");
    expect(artifact.parsedEntities).toHaveLength(1);
    expect(artifact.parsedEntities[0].title).toBe("微積分");
    expect(artifact.parsedEntities[0].location).toBe("理學院 101");
  });

  it("returns stable labels for source and freshness", () => {
    expect(getTodaySourceLabel("crowd_verified")).toBe("同學回報");
    expect(getFreshnessLabel("today")).toBe("今日");
  });
});
