import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { getDb } from "../firebase";
import {
  buildCourseSummaries,
  createCourseModule as createWorkspaceModule,
  createCourseQuiz as createWorkspaceQuiz,
  listAttendanceSessions as listWorkspaceAttendanceSessions,
  listCourseGradebook,
  listCourseMemberships,
  listCourseModules as listWorkspaceCourseModules,
  listCourseQuizzes as listWorkspaceCourseQuizzes,
  startAttendanceSession as startWorkspaceAttendanceSession,
  toDate,
  type CourseMembership,
} from "../services/courseWorkspace";
import type {
  AttendanceSession,
  AttendanceSummary,
  CourseGradebookData,
  CourseMaterial,
  CourseModule,
  CourseSpace,
  InboxTask,
  Quiz,
  Submission,
} from "./types";

function toCourseSpace(
  membership: CourseMembership,
  summary?: {
    assignmentCount: number;
    dueSoonCount: number;
    quizCount: number;
    moduleCount: number;
    activeSessionId: string | null;
    latestDueAt: Date | null;
  }
): CourseSpace {
  return {
    id: membership.groupId,
    groupId: membership.groupId,
    name: membership.name,
    role: membership.role,
    unreadCount: membership.unreadCount ?? 0,
    assignmentCount: summary?.assignmentCount ?? 0,
    dueSoonCount: summary?.dueSoonCount ?? 0,
    quizCount: summary?.quizCount ?? 0,
    moduleCount: summary?.moduleCount ?? 0,
    activeSessionId: summary?.activeSessionId ?? null,
    latestDueAt: summary?.latestDueAt ?? null,
    schoolId: membership.schoolId,
  };
}

function normalizeMaterialType(value: unknown): CourseMaterial["type"] {
  if (value === "file" || value === "video" || value === "document" || value === "external") {
    return value;
  }
  return "link";
}

export async function listCourseSpaces(userId: string, schoolId?: string): Promise<CourseSpace[]> {
  const db = getDb();
  const memberships = await listCourseMemberships(db, userId, schoolId);
  const summaries = await buildCourseSummaries(db, memberships);
  const summaryMap = new Map(summaries.map((summary) => [summary.groupId, summary]));

  return memberships.map((membership) => toCourseSpace(membership, summaryMap.get(membership.groupId)));
}

export async function getCourseSpace(
  courseSpaceId: string,
  userId: string,
  schoolId?: string
): Promise<CourseSpace | null> {
  const spaces = await listCourseSpaces(userId, schoolId);
  return spaces.find((space) => space.groupId === courseSpaceId) ?? null;
}

export async function listCourseModules(
  userId: string,
  courseSpaceId?: string,
  schoolId?: string
): Promise<CourseModule[]> {
  const db = getDb();
  const memberships = await listCourseMemberships(db, userId, schoolId);
  return listWorkspaceCourseModules(db, memberships, courseSpaceId);
}

export async function createCourseModule(input: {
  courseSpaceId: string;
  title: string;
  description?: string;
  week?: number;
  order?: number;
  estimatedMinutes?: number;
  resourceLabel?: string;
  resourceUrl?: string;
  createdBy: string;
  createdByEmail?: string | null;
  schoolId?: string;
}): Promise<{ id: string }> {
  const db = getDb();
  const id = await createWorkspaceModule(db, {
    groupId: input.courseSpaceId,
    title: input.title,
    description: input.description,
    week: input.week,
    order: input.order,
    estimatedMinutes: input.estimatedMinutes,
    resourceLabel: input.resourceLabel,
    resourceUrl: input.resourceUrl,
    createdBy: input.createdBy,
    createdByEmail: input.createdByEmail,
    schoolId: input.schoolId,
  });
  return { id };
}

export async function listCourseMaterials(
  courseSpaceId: string,
  moduleId?: string
): Promise<CourseMaterial[]> {
  const db = getDb();
  const moduleIds = moduleId
    ? [moduleId]
    : (
        await getDocs(collection(db, "groups", courseSpaceId, "modules")).catch(() => null)
      )?.docs.map((docSnap) => docSnap.id) ?? [];

  const rows = await Promise.all(
    moduleIds.map(async (currentModuleId) => {
      const snap = await getDocs(
        collection(db, "groups", courseSpaceId, "modules", currentModuleId, "materials")
      ).catch(() => null);

      return (
        snap?.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          return {
            id: docSnap.id,
            moduleId: currentModuleId,
            groupId: courseSpaceId,
            type: normalizeMaterialType(data.type),
            label: String(data.label ?? data.title ?? "教材"),
            description: (data.description as string | undefined) ?? undefined,
            url: (data.url as string | undefined) ?? null,
            createdAt: toDate(data.createdAt),
          } satisfies CourseMaterial;
        }) ?? []
      );
    })
  );

  return rows.flat();
}

export async function listQuizzes(
  userId: string,
  courseSpaceId?: string,
  schoolId?: string
): Promise<Quiz[]> {
  const db = getDb();
  const memberships = await listCourseMemberships(db, userId, schoolId);
  return listWorkspaceCourseQuizzes(db, memberships, courseSpaceId);
}

export async function getQuiz(
  quizId: string,
  userId: string,
  courseSpaceId?: string,
  schoolId?: string
): Promise<Quiz | null> {
  const quizzes = await listQuizzes(userId, courseSpaceId, schoolId);
  return quizzes.find((quiz) => quiz.id === quizId || quiz.assignmentId === quizId) ?? null;
}

export async function createQuiz(input: {
  courseSpaceId: string;
  title: string;
  description?: string;
  dueAt?: Date | null;
  type: "quiz" | "exam";
  questionCount?: number;
  durationMinutes?: number;
  points?: number;
  weight?: number;
  createdBy: string;
  createdByEmail?: string | null;
  schoolId?: string;
}): Promise<{ id: string }> {
  const db = getDb();
  const id = await createWorkspaceQuiz(db, {
    groupId: input.courseSpaceId,
    title: input.title,
    description: input.description,
    dueAt: input.dueAt,
    type: input.type,
    questionCount: input.questionCount,
    durationMinutes: input.durationMinutes,
    points: input.points,
    weight: input.weight,
    createdBy: input.createdBy,
    createdByEmail: input.createdByEmail,
    schoolId: input.schoolId,
  });
  return { id };
}

export async function submitQuiz(input: {
  courseSpaceId: string;
  quizId: string;
  userId: string;
  content?: string;
  answers?: Record<string, string | string[]>;
  attachments?: Submission["attachments"];
}): Promise<Submission> {
  const db = getDb();
  const now = new Date().toISOString();
  const status: Submission["status"] = "submitted";
  const ref = doc(
    db,
    "groups",
    input.courseSpaceId,
    "assignments",
    input.quizId,
    "submissions",
    input.userId
  );

  await setDoc(
    ref,
    {
      assignmentId: input.quizId,
      userId: input.userId,
      content: input.content ?? "",
      answers: input.answers ?? {},
      attachments: input.attachments ?? [],
      status,
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      source: "quiz_center",
    },
    { merge: true }
  );

  return {
    id: input.userId,
    assignmentId: input.quizId,
    userId: input.userId,
    content: input.content,
    attachments: input.attachments,
    submittedAt: now,
    status,
  };
}

export async function listAttendanceSessions(
  userId: string,
  courseSpaceId?: string,
  schoolId?: string
): Promise<AttendanceSession[]> {
  const db = getDb();
  const memberships = await listCourseMemberships(db, userId, schoolId);
  return listWorkspaceAttendanceSessions(db, memberships, courseSpaceId);
}

export async function startAttendanceSession(input: {
  courseSpaceId: string;
  classroomLat?: number;
  classroomLng?: number;
  qrExpiryMinutes?: number;
}): Promise<{ success: boolean; sessionId: string; qrToken?: string; qrExpiresAt?: string }> {
  return startWorkspaceAttendanceSession(getFunctions(), {
    groupId: input.courseSpaceId,
    classroomLat: input.classroomLat,
    classroomLng: input.classroomLng,
    qrExpiryMinutes: input.qrExpiryMinutes,
  });
}

export async function checkInAttendance(input: {
  courseSpaceId: string;
  sessionId: string;
  qrToken?: string;
}): Promise<{ success: boolean }> {
  const joinLiveSession = httpsCallable<
    { groupId: string; sessionId: string; qrToken?: string },
    { success: boolean }
  >(getFunctions(), "joinLiveSession");

  const result = await joinLiveSession({
    groupId: input.courseSpaceId,
    sessionId: input.sessionId,
    qrToken: input.qrToken,
  });

  return result.data;
}

export async function getAttendanceSummary(courseSpaceId: string): Promise<AttendanceSummary> {
  const db = getDb();
  const attendanceSnap = await getDocs(
    collection(db, "groups", courseSpaceId, "attendanceSessions")
  ).catch(() => null);
  const liveSnap =
    attendanceSnap && attendanceSnap.size > 0
      ? null
      : await getDocs(collection(db, "groups", courseSpaceId, "liveSessions")).catch(() => null);

  const docs = attendanceSnap?.docs ?? liveSnap?.docs ?? [];
  const sessions = docs.map((docSnap) => {
    const data = docSnap.data() as Record<string, unknown>;
    return {
      id: docSnap.id,
      groupId: courseSpaceId,
      groupName: "",
      active: Boolean(data.active),
      attendeeCount: typeof data.attendeeCount === "number" ? data.attendeeCount : 0,
      startedAt: toDate(data.startedAt),
      endedAt: toDate(data.endedAt),
      source: attendanceSnap && attendanceSnap.size > 0 ? "attendance" : "live",
      attendanceMode: (data.attendanceMode as string | undefined) ?? null,
    } satisfies AttendanceSession;
  });

  const latestSession =
    [...sessions].sort((left, right) => (right.startedAt?.getTime() ?? 0) - (left.startedAt?.getTime() ?? 0))[0] ??
    null;

  return {
    groupId: courseSpaceId,
    totalSessions: sessions.length,
    activeSessions: sessions.filter((session) => session.active).length,
    totalAttendees: sessions.reduce((sum, session) => sum + (session.attendeeCount ?? 0), 0),
    latestSession,
  };
}

export async function listInboxTasks(userId: string, schoolId?: string): Promise<InboxTask[]> {
  const db = getDb();
  const memberships = await listCourseMemberships(db, userId, schoolId);
  if (memberships.length === 0) return [];

  const now = Date.now();
  const tasks = await Promise.all(
    memberships.map(async (membership) => {
      const groupTasks: InboxTask[] = [];

      if ((membership.unreadCount ?? 0) > 0) {
        groupTasks.push({
          id: `group-${membership.groupId}`,
          kind: "group",
          groupId: membership.groupId,
          groupName: membership.name,
          title: `${membership.name} 有未讀更新`,
          subtitle: `有 ${membership.unreadCount} 則未讀課程動態`,
          priority: 4,
          unreadCount: membership.unreadCount,
        });
      }

      const attendanceActiveSnap = await getDocs(
        query(
          collection(db, "groups", membership.groupId, "attendanceSessions"),
          where("active", "==", true),
          limit(1)
        )
      ).catch(() => null);
      const liveActiveSnap =
        attendanceActiveSnap && !attendanceActiveSnap.empty
          ? null
          : await getDocs(
              query(collection(db, "groups", membership.groupId, "liveSessions"), where("active", "==", true), limit(1))
            ).catch(() => null);
      const activeDoc = attendanceActiveSnap?.docs[0] ?? liveActiveSnap?.docs[0];

      if (activeDoc) {
        groupTasks.push({
          id: `live-${membership.groupId}-${activeDoc.id}`,
          kind: "live",
          groupId: membership.groupId,
          groupName: membership.name,
          title: `${membership.name} 課堂互動進行中`,
          subtitle: "可直接進入點名、投票與課堂提問",
          sessionId: activeDoc.id,
          priority: 0,
        });
      }

      const assignmentSnap = await getDocs(collection(db, "groups", membership.groupId, "assignments")).catch(() => null);
      const assignments =
        assignmentSnap?.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Record<string, unknown>) })) ?? [];

      for (const assignment of assignments) {
        const dueAt = toDate(assignment.dueAt);
        if (!dueAt) continue;
        const diff = dueAt.getTime() - now;
        if (diff < 0 || diff > 7 * 24 * 60 * 60 * 1000) continue;

        const kind: InboxTask["kind"] =
          assignment.type === "quiz" || assignment.type === "exam" ? "quiz" : "assignment";
        const label = kind === "quiz" ? "評量" : "作業";

        groupTasks.push({
          id: `${kind}-${membership.groupId}-${assignment.id}`,
          kind,
          groupId: membership.groupId,
          groupName: membership.name,
          title: String(assignment.title ?? "未命名任務"),
          subtitle: `${label}將於 ${dueAt.toLocaleString("zh-TW", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })} 截止`,
          assignmentId: assignment.id,
          priority: kind === "quiz" ? 2 : 1,
          dueAt,
        });
      }

      return groupTasks;
    })
  );

  return tasks
    .flat()
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      const timeA = left.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const timeB = right.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return timeA - timeB;
    })
    .slice(0, 12);
}

export async function getCourseGradebook(courseSpaceId: string): Promise<CourseGradebookData | null> {
  const db = getDb();
  const groupSnap = await getDoc(doc(db, "groups", courseSpaceId)).catch(() => null);
  if (!groupSnap?.exists()) {
    return null;
  }
  return listCourseGradebook(db, courseSpaceId);
}
