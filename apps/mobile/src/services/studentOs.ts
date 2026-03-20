import AsyncStorage from "@react-native-async-storage/async-storage";

import type {
  Announcement,
  AIActionSuggestion,
  CampusSignal,
  ClubEvent,
  Course,
  CrowdReport,
  CrowdSignalValue,
  FreshnessState,
  ImportedArtifact,
  ImportedEntity,
  MenuItem,
  TodayCardSource,
} from "../data/types";
import type { ICalEvent, ParsedCalendar } from "./ical";
import { getFreshnessState } from "../utils/campusOs";
import { getFirstStorageValue, getScopedStorageKey, type TenantContext } from "./scopedStorage";

const IMPORTED_ARTIFACTS_FEATURE = "student-os-imported-artifacts";
const CROWD_REPORTS_FEATURE = "student-os-crowd-reports";

type BuildCampusSignalsParams = {
  schoolId: string;
  announcements?: Announcement[];
  events?: ClubEvent[];
  menus?: MenuItem[];
  courses?: Course[];
  importedArtifacts?: ImportedArtifact[];
  crowdReports?: CrowdReport[];
  now?: Date;
};

const CROWD_VALUE_SCORE: Record<CrowdSignalValue, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

function toIso(value?: string | Date | null): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function normalizeFreshness(value?: string | Date | null, _now: Date = new Date()): FreshnessState {
  if (!value) return "stale";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "stale";
  return getFreshnessState(parsed);
}

function toDateOnly(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getCourseStart(course: Course, now: Date): Date | null {
  const dayOfWeek = course.dayOfWeek ?? course.schedule?.[0]?.dayOfWeek;
  const startTime = course.startTime ?? course.schedule?.[0]?.startTime;
  if (dayOfWeek == null || !startTime) return null;

  const candidate = new Date(now);
  candidate.setHours(0, 0, 0, 0);
  const delta = dayOfWeek - candidate.getDay();
  candidate.setDate(candidate.getDate() + delta);

  const [hours, minutes] = startTime.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  candidate.setHours(hours, minutes, 0, 0);
  return candidate;
}

function getCourseEnd(course: Course, startDate: Date): Date | null {
  const endTime = course.endTime ?? course.schedule?.[0]?.endTime;
  if (!endTime) return null;
  const [hours, minutes] = endTime.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  const endDate = new Date(startDate);
  endDate.setHours(hours, minutes, 0, 0);
  return endDate;
}

function scoreSignal(signal: CampusSignal, now: Date) {
  const freshnessWeight =
    signal.freshness === "live"
      ? 20
      : signal.freshness === "new"
        ? 14
        : signal.freshness === "today"
          ? 8
          : 0;
  const sourceWeight =
    signal.source === "user_import"
      ? 22
      : signal.source === "crowd_verified"
        ? 16
        : signal.source === "official_public"
          ? 12
          : 10;

  let timeWeight = 0;
  if (signal.startAt) {
    const startDate = new Date(signal.startAt);
    if (!Number.isNaN(startDate.getTime())) {
      const diff = startDate.getTime() - now.getTime();
      if (diff <= 0 && Math.abs(diff) <= 1000 * 60 * 90) {
        timeWeight = 24;
      } else if (diff > 0 && diff <= 1000 * 60 * 60) {
        timeWeight = 20;
      } else if (diff > 0 && diff <= 1000 * 60 * 60 * 6) {
        timeWeight = 14;
      } else if (diff > 0 && diff <= 1000 * 60 * 60 * 24) {
        timeWeight = 8;
      }
    }
  }

  return Math.round(signal.trustScore * 100) + freshnessWeight + sourceWeight + timeWeight;
}

function buildCourseSignals(courses: Course[], schoolId: string, now: Date): CampusSignal[] {
  return courses
    .map((course) => {
      const startDate = getCourseStart(course, now);
      if (!startDate) return null;
      const endDate = getCourseEnd(course, startDate);

      return {
        id: `course-${course.id}`,
        schoolId,
        type: "course",
        title: course.name,
        description: [course.teacher ?? course.instructor, course.location].filter(Boolean).join(" · "),
        source: "user_import" as const,
        startAt: toIso(startDate),
        endAt: toIso(endDate),
        location: course.location ?? course.schedule?.[0]?.location,
        freshness: normalizeFreshness(startDate, now),
        trustScore: 0.95,
        meta: course.startTime ?? course.schedule?.[0]?.startTime,
        actionTarget: {
          tab: "課程",
          screen: "CourseSchedule",
        },
      } satisfies CampusSignal;
    })
    .filter(Boolean)
    .filter((signal) => isSameDay(new Date(signal.startAt ?? now.toISOString()), now))
    .sort((left, right) => scoreSignal(right, now) - scoreSignal(left, now));
}

function buildAnnouncementSignals(announcements: Announcement[], schoolId: string, now: Date): CampusSignal[] {
  return announcements.map((announcement) => ({
    id: `announcement-${announcement.id}`,
    schoolId,
    type: "announcement",
    title: announcement.title,
    description: announcement.body.slice(0, 80),
    source: "official_public" as const,
    startAt: announcement.publishedAt,
    freshness: normalizeFreshness(announcement.publishedAt, now),
    trustScore: announcement.pinned ? 0.92 : 0.84,
    meta: announcement.source ?? "校方公告",
    actionTarget: {
      screen: "公告詳情",
      params: { id: announcement.id },
    },
    updatedAt: announcement.publishedAt,
  }));
}

function buildEventSignals(events: ClubEvent[], schoolId: string, now: Date): CampusSignal[] {
  return events
    .filter((event) => {
      const startsAt = toDateOnly(event.startsAt);
      return startsAt ? startsAt.getTime() >= now.getTime() - 1000 * 60 * 60 : true;
    })
    .map((event) => ({
      id: `event-${event.id}`,
      schoolId,
      type: "event",
      title: event.title,
      description: event.description.slice(0, 80),
      source: "official_public" as const,
      startAt: event.startsAt,
      endAt: event.endsAt,
      location: event.location,
      freshness: normalizeFreshness(event.startsAt, now),
      trustScore: 0.8,
      meta: event.location ?? "校園活動",
      actionTarget: {
        screen: "活動詳情",
        params: { id: event.id },
      },
      updatedAt: event.startsAt,
    }));
}

function buildMenuSignals(menus: MenuItem[], schoolId: string, now: Date): CampusSignal[] {
  return menus.map((menu) => ({
    id: `menu-${menu.id}`,
    schoolId,
    type: "menu",
    title: menu.name,
    description: `${menu.cafeteria}${menu.description ? ` · ${menu.description.slice(0, 30)}` : ""}`,
    source: "official_public" as const,
    startAt: toIso(menu.availableOn),
    location: menu.cafeteria,
    freshness: normalizeFreshness(menu.availableOn, now),
    trustScore: menu.popular ? 0.78 : 0.72,
    meta: menu.price != null ? `NT$${menu.price}` : "今日供應",
    actionTarget: {
      tab: "校園",
      screen: "餐廳總覽",
    },
    updatedAt: toIso(menu.availableOn),
  }));
}

function entityToSignal(entity: ImportedEntity, artifact: ImportedArtifact, schoolId: string, now: Date): CampusSignal | null {
  const date = entity.date ? new Date(entity.date) : null;
  const freshDate =
    date && entity.startTime
      ? (() => {
          const next = new Date(date);
          const [hours, minutes] = entity.startTime.split(":").map(Number);
          if (Number.isNaN(hours) || Number.isNaN(minutes)) return date;
          next.setHours(hours, minutes, 0, 0);
          return next;
        })()
      : date;

  if (date && !isSameDay(date, now)) {
    return null;
  }

  return {
    id: `${artifact.id}-${entity.id}`,
    schoolId,
    type: entity.entityType === "course" ? "course" : entity.entityType === "task" ? "task" : "imported_event",
    title: entity.title,
    description: [entity.location, entity.description].filter(Boolean).join(" · "),
    source: "user_import",
    startAt: toIso(freshDate),
    location: entity.location,
    freshness: normalizeFreshness(freshDate ?? artifact.userConfirmedAt ?? artifact.createdAt, now),
    trustScore: Math.min(Math.max(artifact.confidence, 0.35), 1),
    meta:
      entity.startTime && entity.endTime
        ? `${entity.startTime} - ${entity.endTime}`
        : entity.startTime ?? "已匯入",
    actionTarget: {
      tab: "課程",
      screen: "Calendar",
    },
    updatedAt: artifact.userConfirmedAt ?? artifact.createdAt,
  };
}

function buildImportedSignals(artifacts: ImportedArtifact[], schoolId: string, now: Date): CampusSignal[] {
  return artifacts
    .filter((artifact) => Boolean(artifact.userConfirmedAt))
    .flatMap((artifact) =>
      artifact.parsedEntities
        .map((entity) => entityToSignal(entity, artifact, schoolId, now))
        .filter((signal): signal is CampusSignal => signal !== null)
    );
}

function resolveCrowdValue(reports: CrowdReport[], now: Date): CrowdSignalValue {
  const weighted = reports.reduce(
    (acc, report) => {
      const createdAt = new Date(report.createdAt);
      const ageMs = Math.max(now.getTime() - createdAt.getTime(), 0);
      const decay = Math.max(0.25, 1 - ageMs / (1000 * 60 * 90));
      const weight = Math.max(report.reporterReputation, 0.35) * decay;
      return {
        score: acc.score + CROWD_VALUE_SCORE[report.value] * weight,
        weight: acc.weight + weight,
      };
    },
    { score: 0, weight: 0 }
  );

  const average = weighted.weight > 0 ? weighted.score / weighted.weight : 2;
  if (average >= 2.4) return "high";
  if (average <= 1.4) return "low";
  return "medium";
}

export function getTodaySourceLabel(source: TodayCardSource) {
  switch (source) {
    case "official_public":
      return "公開資料";
    case "user_import":
      return "你的匯入";
    case "crowd_verified":
      return "同學回報";
    case "ai_synthesized":
      return "AI 綜合";
    default:
      return "未知來源";
  }
}

export function getFreshnessLabel(freshness: FreshnessState) {
  switch (freshness) {
    case "live":
      return "剛更新";
    case "new":
      return "近期";
    case "today":
      return "今日";
    case "stale":
    default:
      return "較舊";
  }
}

export function buildCampusSignals(params: BuildCampusSignalsParams): CampusSignal[] {
  const now = params.now ?? new Date();
  const activeCrowdReports = getActiveCrowdReports(params.crowdReports ?? [], now);

  const crowdSignals = Array.from(
    activeCrowdReports.reduce((map, report) => {
      const key = `${report.signalType}:${report.placeId}`;
      const existing = map.get(key) ?? [];
      existing.push(report);
      map.set(key, existing);
      return map;
    }, new Map<string, CrowdReport[]>())
  ).map(([, reports]) => {
    const sample = reports[0];
    const lastUpdated = reports
      .map((report) => new Date(report.createdAt))
      .sort((left, right) => right.getTime() - left.getTime())[0];
    const value = resolveCrowdValue(reports, now);
    const trustScore = Math.min(
      0.95,
      reports.reduce((acc, report) => acc + (report.trustScore ?? report.reporterReputation), 0) / reports.length
    );

    return {
      id: `crowd-${sample.signalType}-${sample.placeId}`,
      schoolId: sample.schoolId,
      type: "crowd",
      title: sample.placeName ?? sample.placeId,
      description:
        value === "high"
          ? "目前人潮偏高，建議預留更多移動或排隊時間"
          : value === "low"
            ? "目前相對順暢，適合現在前往"
            : "目前人流中等，建議先看下一步安排",
      source: "crowd_verified",
      freshness: normalizeFreshness(lastUpdated, now),
      trustScore,
      location: sample.placeName ?? sample.placeId,
      meta:
        sample.signalType === "cafeteria_queue"
          ? "排隊"
          : sample.signalType === "library_seat"
            ? "座位"
            : sample.signalType === "bus_crowd"
              ? "車況"
              : "現場",
      actionTarget: {
        tab: "校園",
        screen: sample.signalType === "bus_crowd" ? "BusSchedule" : "Map",
      },
      updatedAt: lastUpdated?.toISOString(),
    } satisfies CampusSignal;
  });

  const signals = [
    ...buildCourseSignals(params.courses ?? [], params.schoolId, now),
    ...buildImportedSignals(params.importedArtifacts ?? [], params.schoolId, now),
    ...buildAnnouncementSignals(params.announcements ?? [], params.schoolId, now),
    ...buildEventSignals(params.events ?? [], params.schoolId, now),
    ...buildMenuSignals(params.menus ?? [], params.schoolId, now),
    ...crowdSignals,
  ];

  return signals
    .sort((left, right) => scoreSignal(right, now) - scoreSignal(left, now))
    .slice(0, 12);
}

export function getImportedArtifactsStorageKey(context: TenantContext = {}) {
  return getScopedStorageKey(IMPORTED_ARTIFACTS_FEATURE, context);
}

export function getCrowdReportsStorageKey(context: TenantContext = {}) {
  return getScopedStorageKey(CROWD_REPORTS_FEATURE, context);
}

export async function listImportedArtifacts(context: TenantContext = {}): Promise<ImportedArtifact[]> {
  const value = await getFirstStorageValue([getImportedArtifactsStorageKey(context)]);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as ImportedArtifact[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveImportedArtifacts(
  artifacts: ImportedArtifact[],
  context: TenantContext = {}
): Promise<void> {
  await AsyncStorage.setItem(getImportedArtifactsStorageKey(context), JSON.stringify(artifacts));
}

export async function appendImportedArtifact(
  artifact: ImportedArtifact,
  context: TenantContext = {}
): Promise<ImportedArtifact[]> {
  const existing = await listImportedArtifacts(context);
  const next = [...existing.filter((item) => item.id !== artifact.id), artifact];
  await saveImportedArtifacts(next, context);
  return next;
}

export async function listCrowdReports(context: TenantContext = {}): Promise<CrowdReport[]> {
  const value = await getFirstStorageValue([getCrowdReportsStorageKey(context)]);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as CrowdReport[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveCrowdReports(reports: CrowdReport[], context: TenantContext = {}): Promise<void> {
  await AsyncStorage.setItem(getCrowdReportsStorageKey(context), JSON.stringify(reports));
}

export async function appendCrowdReport(report: CrowdReport, context: TenantContext = {}): Promise<CrowdReport[]> {
  const existing = await listCrowdReports(context);
  const next = [...existing.filter((item) => item.id !== report.id), report];
  await saveCrowdReports(next, context);
  return next;
}

export function getActiveCrowdReports(reports: CrowdReport[], now: Date = new Date()) {
  return reports.filter((report) => {
    if (report.revokedAt) return false;
    const expiresAt = new Date(report.expiresAt);
    return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > now.getTime();
  });
}

export function createImportedArtifactFromCalendar(
  calendar: ParsedCalendar,
  rawInputRef?: string
): ImportedArtifact {
  return createImportedArtifactFromEvents(calendar.events, {
    artifactType: "ical",
    rawInputRef,
    name: calendar.name,
  });
}

export function createImportedArtifactFromEvents(
  events: ICalEvent[],
  options?: { artifactType?: ImportedArtifact["artifactType"]; rawInputRef?: string; name?: string }
): ImportedArtifact {
  const parsedEntities: ImportedEntity[] = events.map((event, index) => ({
    id: event.id || `imported-${index}`,
    entityType: "event",
    title: event.title,
    description: event.description,
    date: event.startDate.toISOString(),
    dayOfWeek: event.startDate.getDay(),
    startTime: event.allDay
      ? undefined
      : `${String(event.startDate.getHours()).padStart(2, "0")}:${String(event.startDate.getMinutes()).padStart(2, "0")}`,
    endTime:
      event.endDate && !event.allDay
        ? `${String(event.endDate.getHours()).padStart(2, "0")}:${String(event.endDate.getMinutes()).padStart(2, "0")}`
        : undefined,
    location: event.location,
  }));

  const confidence =
    events.length === 0
      ? 0
      : events.every((event) => Boolean(event.location))
        ? 0.92
        : 0.78;

  return {
    id: `artifact-${Date.now()}`,
    artifactType: options?.artifactType ?? "ical",
    rawInputRef: options?.rawInputRef,
    parsedEntities,
    confidence,
    createdAt: new Date().toISOString(),
    metadata: options?.name ? { name: options.name } : undefined,
  };
}

export function createManualCourseArtifact(params: {
  title: string;
  location?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}) {
  return {
    id: `artifact-${Date.now()}`,
    artifactType: "manual_course" as const,
    parsedEntities: [
      {
        id: `manual-course-${Date.now()}`,
        entityType: "course" as const,
        title: params.title,
        location: params.location,
        dayOfWeek: params.dayOfWeek,
        startTime: params.startTime,
        endTime: params.endTime,
      },
    ],
    confidence: 1,
    createdAt: new Date().toISOString(),
  } satisfies ImportedArtifact;
}

export function createCrowdReport(params: {
  schoolId: string;
  signalType: CrowdReport["signalType"];
  placeId: string;
  placeName?: string;
  value: CrowdReport["value"];
  reporterReputation?: number;
  expiresInMinutes?: number;
}) {
  const now = Date.now();
  return {
    id: `crowd-${now}-${Math.random().toString(36).slice(2, 8)}`,
    schoolId: params.schoolId,
    signalType: params.signalType,
    placeId: params.placeId,
    placeName: params.placeName,
    value: params.value,
    evidenceType: "self_report" as const,
    reporterReputation: params.reporterReputation ?? 0.7,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (params.expiresInMinutes ?? 90) * 60000).toISOString(),
    trustScore: Math.min(0.95, Math.max(params.reporterReputation ?? 0.7, 0.35)),
  } satisfies CrowdReport;
}

export function createSuggestedActionsFromSignals(signals: CampusSignal[]): AIActionSuggestion[] {
  return signals
    .filter((signal) => signal.actionTarget)
    .slice(0, 3)
    .map((signal) => ({
      id: `action-${signal.id}`,
      label:
        signal.type === "course"
          ? "看課表"
          : signal.type === "announcement"
            ? "看公告"
            : signal.type === "event"
              ? "看活動"
              : signal.type === "crowd"
                ? "看現場"
                : "前往查看",
      reason: signal.title,
      signalId: signal.id,
      actionTarget: signal.actionTarget,
    }));
}
