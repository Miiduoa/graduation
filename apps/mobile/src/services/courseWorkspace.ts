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
  type Firestore,
} from "firebase/firestore";
import { httpsCallable, type Functions } from "firebase/functions";
import { fetchSchoolDirectoryProfiles } from "./memberDirectory";

export type CourseMembership = {
  id: string;
  groupId: string;
  name: string;
  type?: string;
  status?: string;
  role?: string;
  unreadCount?: number;
  schoolId?: string;
};

export type CourseSummary = {
  groupId: string;
  assignmentCount: number;
  dueSoonCount: number;
  quizCount: number;
  moduleCount: number;
  activeSessionId: string | null;
  unreadCount: number;
  latestDueAt: Date | null;
  memberCount: number;
  activeLearnerCount: number;
  completedAssignmentCount: number;
  completionRate: number;
  socialProofUpdatedAt: Date | null;
};

export type CourseModule = {
  id: string;
  groupId: string;
  groupName: string;
  title?: string;
  description?: string;
  week?: number;
  order?: number;
  estimatedMinutes?: number;
  resourceCount?: number;
  published?: boolean;
  resourceUrl?: string | null;
  resourceLabel?: string | null;
};

export type CourseQuiz = {
  id: string;
  assignmentId: string;
  groupId: string;
  groupName: string;
  title: string;
  description?: string;
  dueAt?: unknown;
  type: "quiz" | "exam";
  gradesPublished?: boolean;
  questionCount?: number;
  durationMinutes?: number;
  points?: number;
  weight?: number;
  source: "quiz" | "assignment";
};

export type AttendanceSession = {
  id: string;
  groupId: string;
  groupName: string;
  active: boolean;
  attendeeCount?: number;
  startedAt: Date | null;
  endedAt: Date | null;
  source: "attendance" | "live";
  attendanceMode?: string | null;
};

export type CourseGradebookAssignment = {
  id: string;
  title: string;
  weight: number;
  dueAt: Date | null;
  gradesPublished: boolean;
  averageScore: number | null;
};

export type CourseGradebookEntry = {
  assignmentId: string;
  title: string;
  weight: number;
  dueAt: Date | null;
  grade: number | null;
  isLate: boolean;
  feedback?: string | null;
  submittedAt: Date | null;
};

export type CourseGradebookRow = {
  uid: string;
  displayName: string;
  email?: string | null;
  studentId?: string | null;
  department?: string | null;
  finalScore: number | null;
  passingScore: number;
  result: string;
  published: boolean;
  publishedAt: Date | null;
  gradedAssignments: number;
  totalAssignments: number;
  assignmentBreakdown: CourseGradebookEntry[];
};

export type CourseGradebookData = {
  groupName: string;
  finalScoresPublished: boolean;
  finalScoresPublishedAt: Date | null;
  assignments: CourseGradebookAssignment[];
  rows: CourseGradebookRow[];
};

type CreateModuleInput = {
  groupId: string;
  title: string;
  description?: string;
  week?: number;
  order?: number;
  estimatedMinutes?: number;
  resourceLabel?: string;
  resourceUrl?: string;
  published?: boolean;
  createdBy: string;
  createdByEmail?: string | null;
  schoolId?: string;
};

type CreateQuizInput = {
  groupId: string;
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
};

function sortByName<T extends { name: string }>(rows: T[]) {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
}

export function canManageCourse(role?: string | null) {
  return role === "owner" || role === "instructor" || role === "moderator";
}

export function toDate(value: unknown): Date | null {
  if (!value) return null;

  // Firestore Timestamp — prefer toMillis() (returns a plain number, no cross-realm risk)
  if (typeof (value as { toMillis?: unknown }).toMillis === "function") {
    const ms = (value as { toMillis: () => number }).toMillis();
    if (typeof ms === "number" && Number.isFinite(ms)) return new Date(ms);
  }

  // Firestore Timestamp.toDate() — re-wrap to avoid Hermes cross-realm Date issues
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      try { return new Date(d.getTime()); } catch { /* cross-realm */ }
      const parsed = Date.parse(String(d));
      return Number.isFinite(parsed) ? new Date(parsed) : null;
    } catch { return null; }
  }

  // Serialised Firestore Timestamp ({seconds, _seconds})
  if (typeof (value as { _seconds?: unknown })._seconds === "number") {
    return new Date((value as { _seconds: number })._seconds * 1000);
  }
  if (typeof (value as { seconds?: unknown }).seconds === "number") {
    return new Date((value as { seconds: number }).seconds * 1000);
  }

  // String, number, or Date — construct in current realm
  try {
    const date = new Date(value as string | number);
    const getTime = (date as { getTime?: unknown }).getTime;
    if (typeof getTime !== "function") return null;
    const t = (getTime as () => number).call(date);
    return Number.isNaN(t) ? null : date;
  } catch { return null; }
}

export function formatDateTime(date: Date | null, fallback = "未設定時間") {
  if (!date) return fallback;
  return date.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function parseDateTimeInput(raw: string) {
  const text = raw.trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0,
    0
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function listCourseMemberships(db: Firestore, uid: string, schoolId?: string) {
  const snap = await getDocs(collection(db, "users", uid, "groups"));
  const memberships = snap.docs
    .map((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      return {
        id: docSnap.id,
        groupId: String(data.groupId ?? docSnap.id),
        name: String(data.name ?? "未命名課程"),
        type: data.type as string | undefined,
        status: data.status as string | undefined,
        role: data.role as string | undefined,
        unreadCount: typeof data.unreadCount === "number" ? data.unreadCount : 0,
        schoolId: data.schoolId as string | undefined,
      } satisfies CourseMembership;
    })
    .filter((row) => row.type === "course" && row.status === "active" && (!schoolId || row.schoolId === schoolId));

  return sortByName(memberships);
}

export async function buildCourseSummaries(db: Firestore, memberships: CourseMembership[]) {
  if (memberships.length === 0) return [];

  return Promise.all(
    memberships.map(async (membership) => {
      const [groupSnap, assignmentSnap, moduleSnap, quizSnap, attendanceActiveSnap, liveActiveSnap] = await Promise.all([
        getDoc(doc(db, "groups", membership.groupId)).catch(() => null),
        getDocs(collection(db, "groups", membership.groupId, "assignments")).catch(() => null),
        getDocs(collection(db, "groups", membership.groupId, "modules")).catch(() => null),
        getDocs(collection(db, "groups", membership.groupId, "quizzes")).catch(() => null),
        getDocs(
          query(collection(db, "groups", membership.groupId, "attendanceSessions"), where("active", "==", true), limit(1))
        ).catch(() => null),
        getDocs(
          query(collection(db, "groups", membership.groupId, "liveSessions"), where("active", "==", true), limit(1))
        ).catch(() => null),
      ]);

      const assignments = assignmentSnap?.docs.map((docSnap) => docSnap.data() as Record<string, unknown>) ?? [];
      const groupData = groupSnap?.data() as Record<string, unknown> | undefined;
      const dueDates = assignments
        .map((assignment) => toDate(assignment.dueAt))
        .filter((date): date is Date => !!date)
        .sort((a, b) => a.getTime() - b.getTime());
      const socialAssignments = [...assignments].sort((left, right) => {
        const leftTime = toDate(left.updatedAt ?? left.createdAt ?? left.dueAt)?.getTime() ?? 0;
        const rightTime = toDate(right.updatedAt ?? right.createdAt ?? right.dueAt)?.getTime() ?? 0;
        return rightTime - leftTime;
      });
      const socialAssignment =
        socialAssignments.find((assignment) => typeof assignment.submissionCount === "number") ?? socialAssignments[0] ?? null;
      const memberCount =
        typeof groupData?.memberCount === "number" && groupData.memberCount > 0
          ? groupData.memberCount
          : 0;
      const attendanceDoc = attendanceActiveSnap?.docs[0]?.data() as Record<string, unknown> | undefined;
      const liveDoc = liveActiveSnap?.docs[0]?.data() as Record<string, unknown> | undefined;
      const activeDoc = attendanceDoc ?? liveDoc;
      const activeLearnerCount =
        typeof activeDoc?.attendeeCount === "number" && activeDoc.attendeeCount > 0
          ? activeDoc.attendeeCount
          : 0;
      const completedAssignmentCount =
        typeof socialAssignment?.submissionCount === "number" && socialAssignment.submissionCount > 0
          ? socialAssignment.submissionCount
          : 0;
      const completionRate =
        memberCount > 0 && completedAssignmentCount > 0
          ? Math.min(Math.round((completedAssignmentCount / memberCount) * 100), 100)
          : 0;
      const socialProofUpdatedAt =
        toDate(activeDoc?.updatedAt ?? activeDoc?.startedAt) ??
        toDate(socialAssignment?.updatedAt ?? socialAssignment?.createdAt ?? socialAssignment?.dueAt) ??
        null;

      const now = Date.now();
      const sevenDaysLater = now + 7 * 24 * 60 * 60 * 1000;
      const dueSoonCount = dueDates.filter((date) => {
        const gt = (date as unknown as { getTime?: unknown }).getTime;
        const ms = typeof gt === "function" ? (gt as (this: Date) => number).call(date as unknown as Date) : undefined;
        if (typeof ms !== "number" || Number.isNaN(ms)) return false;
        const time = ms;
        return time >= now && time <= sevenDaysLater;
      }).length;

      return {
        groupId: membership.groupId,
        assignmentCount: assignments.length,
        dueSoonCount,
        quizCount:
          quizSnap && quizSnap.size > 0
            ? quizSnap.size
            : assignments.filter((assignment) => assignment.type === "quiz" || assignment.type === "exam").length,
        moduleCount: moduleSnap?.size ?? 0,
        activeSessionId:
          !attendanceActiveSnap?.empty
            ? attendanceActiveSnap?.docs[0]?.id ?? null
            : liveActiveSnap?.empty
              ? null
              : liveActiveSnap?.docs[0]?.id ?? null,
        unreadCount: membership.unreadCount ?? 0,
        latestDueAt: dueDates[0] ?? null,
        memberCount,
        activeLearnerCount,
        completedAssignmentCount,
        completionRate,
        socialProofUpdatedAt,
      } satisfies CourseSummary;
    })
  );
}

export async function listCourseModules(
  db: Firestore,
  memberships: CourseMembership[],
  routeGroupId?: string
) {
  const targetGroups = routeGroupId
    ? memberships.filter((membership) => membership.groupId === routeGroupId)
    : memberships;

  if (targetGroups.length === 0) return [];

  const rows = await Promise.all(
    targetGroups.map(async (membership) => {
      const [moduleSnap, primaryMaterials] = await Promise.all([
        getDocs(collection(db, "groups", membership.groupId, "modules")).catch(() => null),
        Promise.resolve<Record<string, { label?: string; url?: string }>>({}),
      ]);

      const modules = moduleSnap?.docs.map((docSnap) => ({
        id: docSnap.id,
        groupId: membership.groupId,
        groupName: membership.name,
        ...(docSnap.data() as Record<string, unknown>),
      })) ?? [];

      return modules.map((module) => ({
        id: String(module.id),
        groupId: String(module.groupId),
        groupName: String(module.groupName),
        title: module.title as string | undefined,
        description: module.description as string | undefined,
        week: typeof module.week === "number" ? module.week : undefined,
        order: typeof module.order === "number" ? module.order : undefined,
        estimatedMinutes: typeof module.estimatedMinutes === "number" ? module.estimatedMinutes : undefined,
        resourceCount: typeof module.resourceCount === "number" ? module.resourceCount : undefined,
        published: typeof module.published === "boolean" ? module.published : undefined,
        resourceUrl: (module.resourceUrl as string | undefined) ?? primaryMaterials[String(module.id)]?.url ?? null,
        resourceLabel: (module.resourceLabel as string | undefined) ?? primaryMaterials[String(module.id)]?.label ?? null,
      } satisfies CourseModule));
    })
  );

  return rows
    .flat()
    .sort((a, b) => {
      const left = a.order ?? a.week ?? Number.MAX_SAFE_INTEGER;
      const right = b.order ?? b.week ?? Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
      return a.title?.localeCompare(b.title ?? "", "zh-Hant") ?? 0;
    });
}

export async function createCourseModule(db: Firestore, input: CreateModuleInput) {
  const moduleRef = doc(collection(db, "groups", input.groupId, "modules"));
  await setDoc(moduleRef, {
    title: input.title.trim(),
    description: input.description?.trim() ?? "",
    week: input.week ?? null,
    order: input.order ?? null,
    estimatedMinutes: input.estimatedMinutes ?? null,
    published: input.published ?? true,
    resourceCount: input.resourceUrl?.trim() ? 1 : 0,
    resourceLabel: input.resourceLabel?.trim() || null,
    resourceUrl: input.resourceUrl?.trim() || null,
    createdAt: serverTimestamp(),
    createdBy: input.createdBy,
    createdByEmail: input.createdByEmail ?? null,
    schoolId: input.schoolId ?? null,
  });

  if (input.resourceUrl?.trim()) {
    await setDoc(doc(db, "groups", input.groupId, "modules", moduleRef.id, "materials", "primary"), {
      type: "link",
      label: input.resourceLabel?.trim() || "外部教材",
      url: input.resourceUrl.trim(),
      createdAt: serverTimestamp(),
      createdBy: input.createdBy,
    });
  }

  return moduleRef.id;
}

export async function listCourseQuizzes(
  db: Firestore,
  memberships: CourseMembership[],
  routeGroupId?: string
) {
  const targetGroups = routeGroupId
    ? memberships.filter((membership) => membership.groupId === routeGroupId)
    : memberships;

  if (targetGroups.length === 0) return [];

  const rows = await Promise.all(
    targetGroups.map(async (membership) => {
      const [quizSnap, assignmentSnap] = await Promise.all([
        getDocs(collection(db, "groups", membership.groupId, "quizzes")).catch(() => null),
        getDocs(collection(db, "groups", membership.groupId, "assignments")).catch(() => null),
      ]);

      const merged = new Map<string, CourseQuiz>();

      for (const docSnap of quizSnap?.docs ?? []) {
        const data = docSnap.data() as Record<string, unknown>;
        merged.set(docSnap.id, {
          id: docSnap.id,
          assignmentId: String(data.assignmentId ?? docSnap.id),
          groupId: membership.groupId,
          groupName: membership.name,
          title: String(data.title ?? "未命名評量"),
          description: data.description as string | undefined,
          dueAt: data.dueAt,
          type: (data.type as "quiz" | "exam") ?? "quiz",
          gradesPublished: Boolean(data.gradesPublished),
          questionCount: typeof data.questionCount === "number" ? data.questionCount : undefined,
          durationMinutes: typeof data.durationMinutes === "number" ? data.durationMinutes : undefined,
          points: typeof data.points === "number" ? data.points : undefined,
          weight: typeof data.weight === "number" ? data.weight : undefined,
          source: "quiz",
        });
      }

      for (const docSnap of assignmentSnap?.docs ?? []) {
        const data = docSnap.data() as Record<string, unknown>;
        if (data.type !== "quiz" && data.type !== "exam") continue;
        if (merged.has(docSnap.id)) continue;
        const quizConfig = (data.quizConfig ?? {}) as Record<string, unknown>;
        merged.set(docSnap.id, {
          id: docSnap.id,
          assignmentId: docSnap.id,
          groupId: membership.groupId,
          groupName: membership.name,
          title: String(data.title ?? "未命名評量"),
          description: data.description as string | undefined,
          dueAt: data.dueAt,
          type: data.type as "quiz" | "exam",
          gradesPublished: Boolean(data.gradesPublished),
          questionCount:
            typeof quizConfig.questionCount === "number"
              ? quizConfig.questionCount
              : typeof data.questionCount === "number"
                ? (data.questionCount as number)
                : undefined,
          durationMinutes:
            typeof quizConfig.durationMinutes === "number"
              ? quizConfig.durationMinutes
              : typeof data.durationMinutes === "number"
                ? (data.durationMinutes as number)
                : undefined,
          points: typeof data.points === "number" ? data.points : undefined,
          weight: typeof data.weight === "number" ? data.weight : undefined,
          source: "assignment",
        });
      }

      return [...merged.values()];
    })
  );

  return rows.flat().sort((a, b) => {
    const timeA = toDate(a.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const timeB = toDate(b.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return timeA - timeB;
  });
}

export async function createCourseQuiz(db: Firestore, input: CreateQuizInput) {
  const quizRef = doc(collection(db, "groups", input.groupId, "quizzes"));
  const dueAt = input.dueAt ?? null;
  const normalizedQuestionCount = input.questionCount && input.questionCount > 0 ? input.questionCount : 10;
  const normalizedDuration = input.durationMinutes && input.durationMinutes > 0 ? input.durationMinutes : 20;
  const normalizedPoints = input.points && input.points > 0 ? input.points : 100;
  const normalizedWeight = input.weight && input.weight > 0 ? input.weight : 10;

  await Promise.all([
    setDoc(quizRef, {
      assignmentId: quizRef.id,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      type: input.type,
      dueAt,
      questionCount: normalizedQuestionCount,
      durationMinutes: normalizedDuration,
      points: normalizedPoints,
      weight: normalizedWeight,
      status: "scheduled",
      gradesPublished: false,
      questionBankReady: false,
      createdAt: serverTimestamp(),
      createdBy: input.createdBy,
      createdByEmail: input.createdByEmail ?? null,
      schoolId: input.schoolId ?? null,
    }),
    setDoc(doc(db, "groups", input.groupId, "assignments", quizRef.id), {
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      dueAt,
      type: input.type,
      allowLate: false,
      points: normalizedPoints,
      weight: normalizedWeight,
      gradesPublished: false,
      quizConfig: {
        questionCount: normalizedQuestionCount,
        durationMinutes: normalizedDuration,
      },
      createdAt: serverTimestamp(),
      createdBy: input.createdBy,
      createdByEmail: input.createdByEmail ?? null,
      schoolId: input.schoolId ?? null,
    }),
  ]);

  return quizRef.id;
}

export async function listAttendanceSessions(
  db: Firestore,
  memberships: CourseMembership[],
  routeGroupId?: string
) {
  const targetGroups = routeGroupId
    ? memberships.filter((membership) => membership.groupId === routeGroupId)
    : memberships;

  if (targetGroups.length === 0) return [];

  const rows = await Promise.all(
    targetGroups.map(async (membership) => {
      const attendanceSnap = await getDocs(collection(db, "groups", membership.groupId, "attendanceSessions")).catch(() => null);
      const sourceDocs = attendanceSnap && attendanceSnap.size > 0
        ? { source: "attendance" as const, docs: attendanceSnap.docs }
        : {
            source: "live" as const,
            docs: (await getDocs(collection(db, "groups", membership.groupId, "liveSessions")).catch(() => null))?.docs ?? [],
          };

      return sourceDocs.docs.map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        return {
          id: docSnap.id,
          groupId: membership.groupId,
          groupName: membership.name,
          active: Boolean(data.active),
          attendeeCount: typeof data.attendeeCount === "number" ? data.attendeeCount : 0,
          startedAt: toDate(data.startedAt),
          endedAt: toDate(data.endedAt),
          source: sourceDocs.source,
          attendanceMode: (data.attendanceMode as string | undefined) ?? null,
        } satisfies AttendanceSession;
      });
    })
  );

  return rows
    .flat()
    .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0));
}

export async function startAttendanceSession(functions: Functions, input: {
  groupId: string;
  classroomLat?: number;
  classroomLng?: number;
  qrExpiryMinutes?: number;
}) {
  const startLiveSession = httpsCallable<
    {
      groupId: string;
      classroomLat?: number;
      classroomLng?: number;
      qrExpiryMinutes?: number;
    },
    {
      success: boolean;
      sessionId: string;
      qrToken?: string;
      qrExpiresAt?: string;
    }
  >(functions, "startLiveSession");

  const result = await startLiveSession(input);
  return result.data;
}

export async function listCourseGradebook(db: Firestore, groupId: string) {
  const [groupSnap, assignmentSnap, gradebookSnap, memberSnap] = await Promise.all([
    getDoc(doc(db, "groups", groupId)),
    getDocs(collection(db, "groups", groupId, "assignments")).catch(() => null),
    getDocs(collection(db, "groups", groupId, "gradebook")).catch(() => null),
    getDocs(collection(db, "groups", groupId, "members")).catch(() => null),
  ]);

  const assignments = (assignmentSnap?.docs ?? [])
    .map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Record<string, unknown>),
    }))
    .sort((a, b) => {
      const timeA = toDate(a.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const timeB = toDate(b.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return timeA - timeB;
    });

  const submissionGroups = await Promise.all(
    assignments.map(async (assignment) => {
      const submissionsSnap = await getDocs(collection(db, "groups", groupId, "assignments", assignment.id, "submissions")).catch(() => null);
      return {
        assignmentId: assignment.id,
        submissions: (submissionsSnap?.docs ?? []).map((docSnap) => ({
          uid: docSnap.id,
          ...(docSnap.data() as Record<string, unknown>),
        })),
      };
    })
  );

  const submissionMap: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const group of submissionGroups) {
    submissionMap[group.assignmentId] = {};
    for (const submission of group.submissions) {
      submissionMap[group.assignmentId][String(submission.uid)] = submission;
    }
  }

  const studentMembers = (memberSnap?.docs ?? [])
    .map((docSnap) => ({
      uid: docSnap.id,
      ...(docSnap.data() as Record<string, unknown>),
    }))
    .filter((member) => member.status === "active" && !canManageCourse(member.role as string | undefined));
  const groupData = groupSnap.exists() ? (groupSnap.data() as Record<string, unknown>) : {};
  const groupSchoolId = typeof groupData.schoolId === "string" ? groupData.schoolId : null;
  const directoryProfiles = groupSchoolId
    ? await fetchSchoolDirectoryProfiles(
        groupSchoolId,
        studentMembers.map((member) => String(member.uid)),
        db,
      ).catch(() => [])
    : [];
  const directoryProfileMap = Object.fromEntries(
    directoryProfiles.map((profile) => [profile.uid, profile]),
  );

  const gradebookMap = Object.fromEntries(
    (gradebookSnap?.docs ?? []).map((docSnap) => [docSnap.id, docSnap.data() as Record<string, unknown>])
  );

  const assignmentSummaries = assignments.map((assignment) => {
    const grades = submissionGroups
      .find((group) => group.assignmentId === assignment.id)
      ?.submissions.map((submission) => submission.grade)
      .filter((grade): grade is number => typeof grade === "number") ?? [];

    return {
      id: assignment.id,
      title: String(assignment.title ?? "未命名作業"),
      weight: typeof assignment.weight === "number" ? assignment.weight : 0,
      dueAt: toDate(assignment.dueAt),
      gradesPublished: Boolean(assignment.gradesPublished),
      averageScore: grades.length > 0 ? Math.round((grades.reduce((sum, grade) => sum + grade, 0) / grades.length) * 10) / 10 : null,
    } satisfies CourseGradebookAssignment;
  });

  const rows = studentMembers.map((member) => {
    const uid = String(member.uid);
    const profile = directoryProfileMap[uid] ?? null;
    const gradebookRow = gradebookMap[uid] ?? {};
    const assignmentBreakdown = assignments.map((assignment) => {
      const submission = submissionMap[assignment.id]?.[uid] ?? {};
      return {
        assignmentId: assignment.id,
        title: String(assignment.title ?? "未命名作業"),
        weight: typeof assignment.weight === "number" ? assignment.weight : 0,
        dueAt: toDate(assignment.dueAt),
        grade: typeof submission.grade === "number" ? submission.grade : null,
        isLate: Boolean(submission.isLate),
        feedback: (submission.feedback as string | undefined) ?? null,
        submittedAt: toDate(submission.submittedAt),
      } satisfies CourseGradebookEntry;
    });

    const gradedAssignments = assignmentBreakdown.filter((entry) => typeof entry.grade === "number").length;

    return {
      uid,
      displayName:
        String(profile?.displayName ?? member.displayName ?? member.email ?? uid),
      email: null,
      studentId: null,
      department: profile?.department ?? null,
      finalScore: typeof gradebookRow.finalScore === "number" ? gradebookRow.finalScore : null,
      passingScore: typeof gradebookRow.passingScore === "number" ? gradebookRow.passingScore : 60,
      result: (gradebookRow.result as string | undefined) ?? "incomplete",
      published: Boolean(gradebookRow.published),
      publishedAt: toDate(gradebookRow.publishedAt),
      gradedAssignments,
      totalAssignments: assignments.length,
      assignmentBreakdown,
    } satisfies CourseGradebookRow;
  });
  const finalScores = (groupData.finalScores ?? {}) as Record<string, unknown>;

  return {
    groupName: String(groupData.name ?? "課程成績簿"),
    finalScoresPublished: Boolean(finalScores.published),
    finalScoresPublishedAt: toDate(finalScores.publishedAt),
    assignments: assignmentSummaries,
    rows: rows.sort((a, b) => {
      const scoreA = a.finalScore ?? -1;
      const scoreB = b.finalScore ?? -1;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return a.displayName.localeCompare(b.displayName, "zh-Hant");
    }),
  } satisfies CourseGradebookData;
}
