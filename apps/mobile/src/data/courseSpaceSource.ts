import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { getAuthInstance, getDb, getFunctionsInstance, isFirebaseMockMode } from '../firebase';
import { joinClassroomAttendance } from '../services/liveAttendance';
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
} from '../services/courseWorkspace';
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
} from './types';

function toCourseSpace(
  membership: CourseMembership,
  summary?: {
    assignmentCount: number;
    dueSoonCount: number;
    quizCount: number;
    moduleCount: number;
    activeSessionId: string | null;
    latestDueAt: Date | null;
    memberCount: number;
    activeLearnerCount: number;
    completedAssignmentCount: number;
    completionRate: number;
    socialProofUpdatedAt: Date | null;
  },
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
    memberCount: summary?.memberCount ?? 0,
    activeLearnerCount: summary?.activeLearnerCount ?? 0,
    completedAssignmentCount: summary?.completedAssignmentCount ?? 0,
    completionRate: summary?.completionRate ?? 0,
    socialProofUpdatedAt: summary?.socialProofUpdatedAt ?? null,
    schoolId: membership.schoolId,
  };
}

function normalizeMaterialType(value: unknown): CourseMaterial['type'] {
  if (value === 'file' || value === 'video' || value === 'document' || value === 'external') {
    return value;
  }
  return 'link';
}

function canManageMembership(role?: string) {
  return role === 'owner' || role === 'instructor' || role === 'moderator';
}

export async function listCourseSpaces(userId: string, schoolId?: string): Promise<CourseSpace[]> {
  if (isFirebaseMockMode()) return [];
  const db = getDb();
  const memberships = await listCourseMemberships(db, userId, schoolId);
  const summaries = await buildCourseSummaries(db, memberships);
  const summaryMap = new Map(summaries.map((summary) => [summary.groupId, summary]));

  return memberships.map((membership) =>
    toCourseSpace(membership, summaryMap.get(membership.groupId)),
  );
}

export async function getCourseSpace(
  courseSpaceId: string,
  userId: string,
  schoolId?: string,
): Promise<CourseSpace | null> {
  const spaces = await listCourseSpaces(userId, schoolId);
  return spaces.find((space) => space.groupId === courseSpaceId) ?? null;
}

export async function listCourseModules(
  userId: string,
  courseSpaceId?: string,
  schoolId?: string,
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
  moduleId?: string,
): Promise<CourseMaterial[]> {
  const db = getDb();
  const moduleIds = moduleId
    ? [moduleId]
    : ((
        await getDocs(collection(db, 'groups', courseSpaceId, 'modules')).catch(() => null)
      )?.docs.map((docSnap) => docSnap.id) ?? []);

  const rows = await Promise.all(
    moduleIds.map(async (currentModuleId) => {
      const snap = await getDocs(
        collection(db, 'groups', courseSpaceId, 'modules', currentModuleId, 'materials'),
      ).catch(() => null);

      return (
        snap?.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          return {
            id: docSnap.id,
            moduleId: currentModuleId,
            groupId: courseSpaceId,
            type: normalizeMaterialType(data.type),
            label: String(data.label ?? data.title ?? '教材'),
            description: (data.description as string | undefined) ?? undefined,
            url: (data.url as string | undefined) ?? null,
            createdAt: toDate(data.createdAt),
          } satisfies CourseMaterial;
        }) ?? []
      );
    }),
  );

  return rows.flat();
}

export async function listQuizzes(
  userId: string,
  courseSpaceId?: string,
  schoolId?: string,
): Promise<Quiz[]> {
  const db = getDb();
  const memberships = await listCourseMemberships(db, userId, schoolId);
  const quizzes = await listWorkspaceCourseQuizzes(db, memberships, courseSpaceId);
  return quizzes.map((quiz) => ({
    ...quiz,
    dueAt: toDate(quiz.dueAt),
  }));
}

export async function getQuiz(
  quizId: string,
  userId: string,
  courseSpaceId?: string,
  schoolId?: string,
): Promise<Quiz | null> {
  const quizzes = await listQuizzes(userId, courseSpaceId, schoolId);
  return quizzes.find((quiz) => quiz.id === quizId || quiz.assignmentId === quizId) ?? null;
}

export async function createQuiz(input: {
  courseSpaceId: string;
  title: string;
  description?: string;
  dueAt?: Date | null;
  type: 'quiz' | 'exam';
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
  attachments?: Submission['attachments'];
}): Promise<Submission & { autoScore?: { earned: number; total: number; percentage: number | null; needsManualGrading: boolean } }> {
  const content = input.content?.trim() ?? '';
  const answers = input.answers ?? {};
  if (!input.courseSpaceId || !input.quizId || !input.userId) {
    throw new Error('找不到這份評量。');
  }
  if (!content && Object.keys(answers).length === 0) {
    throw new Error('請先作答再送出。');
  }
  if (content.length > 20000) {
    throw new Error('請輸入 1 至 20,000 字的作答內容。');
  }
  if (getAuthInstance().currentUser?.uid !== input.userId) {
    throw new Error('登入身分已變更，請重新開啟課程。');
  }
  const db = getDb();
  const now = new Date().toISOString();
  const status: Submission['status'] = 'submitted';
  const assignmentRef = doc(db, 'groups', input.courseSpaceId, 'assignments', input.quizId);
  const ref = doc(
    db,
    'groups',
    input.courseSpaceId,
    'assignments',
    input.quizId,
    'submissions',
    input.userId,
  );

  // ── 自動計分（TronClass parity 測驗引擎，packages/shared/src/lms/quizScoring）──
  let autoScore:
    | { earned: number; total: number; percentage: number | null; needsManualGrading: boolean }
    | undefined;
  try {
    const { scoreQuizAttempt } = await import('@campus/shared');
    const quiz = await getQuiz(input.quizId, input.userId, input.courseSpaceId);
    const questions = Array.isArray(quiz?.questions) ? quiz!.questions! : [];
    if (questions.length > 0 && input.answers) {
      const userAnswers = Object.entries(input.answers).map(([qid, val]) => ({
        questionId: qid,
        value: val,
      }));
      const attempt = scoreQuizAttempt(
        questions.map((q) => ({
          id: q.id,
          type: q.type,
          prompt: q.prompt,
          points: q.points ?? 1,
          options: q.options?.map((o) => ({
            id: o.id,
            label: o.label,
            value: o.value,
            // 由 Firestore questions 直接帶 isCorrect 旗標
            isCorrect: (o as unknown as { isCorrect?: boolean }).isCorrect === true,
          })),
        })),
        userAnswers,
        { submittedAt: now },
      );
      autoScore = {
        earned: attempt.earnedPoints,
        total: attempt.totalPoints,
        percentage: attempt.percentage,
        needsManualGrading: attempt.needsManualGrading,
      };
    }
  } catch (e) {
    // 計分失敗仍應允許提交（人工評分 fallback）
    console.warn('[submitQuiz] auto-score failed', e);
  }

  await runTransaction(db, async (transaction) => {
    const assignmentSnap = await transaction.get(assignmentRef);
    if (!assignmentSnap.exists()) throw new Error('此評量已不存在。');
    const assignment = assignmentSnap.data() as Record<string, unknown>;
    if (assignment.published === false || ['draft', 'closed'].includes(String(assignment.status ?? ''))) {
      throw new Error('此評量尚未開放。');
    }
    if (!['quiz', 'exam'].includes(String(assignment.type ?? ''))) {
      throw new Error('請透過作業頁面繳交。');
    }
    const due = toDate(assignment.dueAt);
    if (due && due.getTime() < Date.now() && assignment.allowLateSubmission !== true) {
      throw new Error('評量已截止，請聯絡授課教師。');
    }
    const existing = await transaction.get(ref);
    if (existing.exists() && existing.data()?.submittedAt) {
      throw new Error('這份評量已有繳交紀錄，請重新整理確認。');
    }
    if (getAuthInstance().currentUser?.uid !== input.userId) {
      throw new Error('登入身分已變更，請重新開啟課程。');
    }
    transaction.set(ref, {
      groupId: input.courseSpaceId,
      assignmentId: input.quizId,
      userId: input.userId,
      content,
      answers,
      status,
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });

  // ── Campus Companion 信號 ──
  try {
    const { onQuizAttempt } = await import('../services/companionHooks');
    onQuizAttempt({
      uid: input.userId,
      quizId: input.quizId,
      percentage: autoScore?.percentage ?? null,
      isPerfect: autoScore?.percentage === 100,
    });
  } catch {
    /* swallow */
  }

  return {
    id: input.userId,
    assignmentId: input.quizId,
    userId: input.userId,
    content: input.content,
    attachments: input.attachments,
    submittedAt: now,
    status,
    ...(autoScore && { autoScore, grade: autoScore.percentage ?? undefined }),
  };
}

export async function listAttendanceSessions(
  userId: string,
  courseSpaceId?: string,
  schoolId?: string,
): Promise<AttendanceSession[]> {
  const db = getDb();
  const memberships = await listCourseMemberships(db, userId, schoolId);
  return listWorkspaceAttendanceSessions(db, memberships, courseSpaceId);
}

export async function startAttendanceSession(input: {
  courseSpaceId: string;
  requestId?: string;
  classroomLat?: number;
  classroomLng?: number;
  qrExpiryMinutes?: number;
}): Promise<{
  success: boolean;
  sessionId: string;
  qrToken?: string;
  qrExpiresAt?: string;
  active?: boolean;
  reused?: boolean;
}> {
  return startWorkspaceAttendanceSession(getFunctionsInstance(), {
    groupId: input.courseSpaceId,
    requestId: input.requestId,
    classroomLat: input.classroomLat,
    classroomLng: input.classroomLng,
    qrExpiryMinutes: input.qrExpiryMinutes,
  });
}

export async function checkInAttendance(input: {
  courseSpaceId: string;
  sessionId: string;
  qrToken: string;
  uid?: string;
}): Promise<{ success: boolean }> {
  const result = await joinClassroomAttendance(getFunctionsInstance(), {
    groupId: input.courseSpaceId,
    sessionId: input.sessionId,
    qrToken: input.qrToken,
  });

  // ── Campus Companion 信號：成功簽到 → onAttendanceCheckin ──
  if (result.success) {
    try {
      const { onAttendanceCheckin } = await import('../services/companionHooks');
      onAttendanceCheckin({
        uid: input.uid,
        sessionId: input.sessionId,
        courseSpaceId: input.courseSpaceId,
      });
    } catch {
      /* swallow — 不影響主流程 */
    }
  }

  return result;
}

export async function getAttendanceSummary(courseSpaceId: string): Promise<AttendanceSummary> {
  const db = getDb();
  const attendanceSnap = await getDocs(
    query(
      collection(db, 'groups', courseSpaceId, 'attendanceSessions'),
      where('schemaVersion', '==', 2),
    ),
  );
  const liveSnap =
    attendanceSnap && attendanceSnap.size > 0
      ? null
      : await getDocs(
          query(
            collection(db, 'groups', courseSpaceId, 'liveSessions'),
            where('schemaVersion', '==', 2),
          ),
        );

  const docs = attendanceSnap?.docs ?? liveSnap?.docs ?? [];
  const sessions = docs.map((docSnap) => {
    const data = docSnap.data() as Record<string, unknown>;
    return {
      id: docSnap.id,
      groupId: courseSpaceId,
      groupName: '',
      active: Boolean(data.active),
      attendeeCount: typeof data.attendeeCount === 'number' ? data.attendeeCount : 0,
      startedAt: toDate(data.startedAt),
      endedAt: toDate(data.endedAt),
      source: attendanceSnap && attendanceSnap.size > 0 ? 'attendance' : 'live',
      attendanceMode: (data.attendanceMode as string | undefined) ?? null,
    } satisfies AttendanceSession;
  });

  const latestSession =
    [...sessions].sort(
      (left, right) => (right.startedAt?.getTime() ?? 0) - (left.startedAt?.getTime() ?? 0),
    )[0] ?? null;

  return {
    groupId: courseSpaceId,
    totalSessions: sessions.length,
    activeSessions: sessions.filter((session) => session.active).length,
    totalAttendees: sessions.reduce((sum, session) => sum + (session.attendeeCount ?? 0), 0),
    latestSession,
  };
}

async function listActionQueueInboxTasks(userId: string): Promise<InboxTask[]> {
  if (isFirebaseMockMode()) return [];
  const db = getDb();
  const snap = await getDocs(query(collection(db, 'users', userId, 'actionQueue'), limit(30)));
  const rows = snap?.docs ?? [];
  const out: InboxTask[] = [];
  for (const docSnap of rows) {
    const data = docSnap.data() as Record<string, unknown>;
    const status = String(data.status || '');
    if (!['pending_confirmation', 'draft'].includes(status)) continue;
    const action = String(data.action || '');
    const title = String(data.title || data.label || '待確認動作').slice(0, 120);
    const sourceRunId = typeof data.sourceRunId === 'string' ? data.sourceRunId : undefined;
    const urgency = String(data.urgency || '');
    const priority = urgency === 'critical' || urgency === 'high' ? 0 : 1;
    out.push({
      id: `aq-${docSnap.id}`,
      kind: 'assistant_queue',
      groupId: 'campus-assistant',
      groupName: '校園助理',
      title,
      subtitle:
        action === 'review_ai_suggestion' ? '請確認助理建議' : sourceRunId ? '等待你確認' : '待辦',
      priority,
      dueAt: data.dueAt ? toDate(data.dueAt as any) : null,
      preferredIntent: 'verify',
      actionLabel: '查看待辦',
      sourceRunId,
      actionQueueId: docSnap.id,
      queueAction: action,
    });
  }
  return out;
}

type StudentTaskWindow = { dueAt: Date | null; lateSubmissionOpen: boolean };

function studentTaskWindow(
  assignment: Record<string, unknown>,
  mode: 'inbox' | 'learning',
  now: number,
): StudentTaskWindow | null {
  if (assignment.published === false || assignment.status === 'draft' || assignment.status === 'closed') {
    return null;
  }
  const parsed = toDate(assignment.dueAt);
  const dueAt = parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
  const diff = dueAt ? dueAt.getTime() - now : null;
  const week = 7 * 24 * 60 * 60 * 1000;
  const lateSubmissionOpen = diff !== null && diff < 0 && assignment.allowLateSubmission === true;
  if (diff !== null && diff < 0 && !lateSubmissionOpen) return null;
  if (mode === 'inbox' && (diff === null || diff < -week || diff > week)) return null;
  return { dueAt, lateSubmissionOpen };
}

export async function listInboxTasks(
  userId: string,
  schoolId?: string,
  mode: 'inbox' | 'learning' = 'inbox',
): Promise<InboxTask[]> {
  if (isFirebaseMockMode()) return [];
  const db = getDb();
  const memberships = await listCourseMemberships(db, userId, schoolId);
  if (memberships.length === 0) {
    return mode === 'learning' ? [] : (await listActionQueueInboxTasks(userId)).slice(0, 14);
  }

  const now = Date.now();
  const tasks = await Promise.all(
    memberships.map(async (membership) => {
      const groupTasks: InboxTask[] = [];
      const teachingMembership = canManageMembership(membership.role);

      if ((membership.unreadCount ?? 0) > 0) {
        groupTasks.push({
          id: `group-${membership.groupId}`,
          kind: 'group',
          groupId: membership.groupId,
          groupName: membership.name,
          title: teachingMembership
            ? `${membership.name} 有新的課程動態`
            : `${membership.name} 有未讀更新`,
          subtitle: teachingMembership
            ? `有 ${membership.unreadCount} 則貼文、提問或課務異動待你確認`
            : `有 ${membership.unreadCount} 則未讀課程動態`,
          priority: 4,
          unreadCount: membership.unreadCount,
          preferredIntent: 'read',
          actionLabel: teachingMembership ? '查看動態' : undefined,
          reason: teachingMembership
            ? '新的課程動態可能包含學生提問、課務異動或需要你回應的內容'
            : undefined,
          consequence: teachingMembership ? '可能延後回覆學生，或漏掉課堂安排的變更' : undefined,
          nextStep: teachingMembership ? '先看最新動態，再決定是否需要回覆或發布' : undefined,
        });
      }

      const attendanceActiveSnap = await getDocs(
        query(
          collection(db, 'groups', membership.groupId, 'attendanceSessions'),
          where('schemaVersion', '==', 2),
          where('active', '==', true),
          limit(1),
        ),
      );
      const liveActiveSnap =
        attendanceActiveSnap && !attendanceActiveSnap.empty
          ? null
          : await getDocs(
              query(
                collection(db, 'groups', membership.groupId, 'liveSessions'),
                where('schemaVersion', '==', 2),
                where('active', '==', true),
                limit(1),
              ),
            );
      const activeDoc = attendanceActiveSnap?.docs[0] ?? liveActiveSnap?.docs[0];

      if (activeDoc) {
        groupTasks.push({
          id: `live-${membership.groupId}-${activeDoc.id}`,
          kind: 'live',
          groupId: membership.groupId,
          groupName: membership.name,
          title: teachingMembership
            ? `${membership.name} 課堂正在進行`
            : `${membership.name} 課堂互動進行中`,
          subtitle: teachingMembership
            ? '可直接查看點名、互動與學生提問狀態'
            : '可直接進入點名、投票與課堂提問',
          sessionId: activeDoc.id,
          priority: 0,
          preferredIntent: 'join',
          actionLabel: teachingMembership ? '進入課堂' : undefined,
          reason: teachingMembership
            ? '課堂進行中時，教師最需要掌握簽到、互動與現場節奏'
            : undefined,
          consequence: teachingMembership ? '可能錯過簽到窗口，或無法即時回應課堂問題' : undefined,
          nextStep: teachingMembership ? '進入課堂模式，確認點名與互動狀態' : undefined,
        });
      }

      const assignmentSnap = await getDocs(
        collection(db, 'groups', membership.groupId, 'assignments'),
      );
      const assignments: Array<{ id: string } & Record<string, unknown>> =
        assignmentSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Record<string, unknown>),
        })) ?? [];

      // A full semester can contain hundreds of assignments. Read only
      // actionable rows, in small parallel batches, while preserving every
      // authorization error instead of turning failures into empty results.
      const studentWindows = new Map<string, StudentTaskWindow>();
      const submitted = new Set<string>();
      if (!teachingMembership) {
        const eligible = assignments.filter((assignment) => {
          const window = studentTaskWindow(assignment, mode, now);
          if (!window) return false;
          studentWindows.set(assignment.id, window);
          return true;
        });
        const batchSize = 8;
        for (let start = 0; start < eligible.length; start += batchSize) {
          const batch = eligible.slice(start, start + batchSize);
          const results = await Promise.all(
            batch.map((assignment) =>
              getDoc(
                doc(db, 'groups', membership.groupId, 'assignments', assignment.id, 'submissions', userId),
              ),
            ),
          );
          for (const [index, snapshot] of results.entries()) {
            const assignment = batch[index];
            if (assignment && snapshot.exists() && snapshot.data()?.submittedAt) {
              submitted.add(assignment.id);
            }
          }
        }
      }

      for (const assignment of assignments) {
        if (assignment.published === false || assignment.status === 'draft') continue;
        const rawDue = toDate(assignment.dueAt);
        const dueAt = rawDue && Number.isFinite(rawDue.getTime()) ? rawDue : null;
        const kind: InboxTask['kind'] =
          assignment.type === 'quiz' || assignment.type === 'exam' ? 'quiz' : 'assignment';
        const label = kind === 'quiz' ? '評量' : '作業';

        if (teachingMembership) {
          const submissionsSnap = await getDocs(
            collection(
              db,
              'groups',
              membership.groupId,
              'assignments',
              assignment.id,
              'submissions',
            ),
          );
          const submissions =
            submissionsSnap?.docs.map((docSnap) => docSnap.data() as Record<string, unknown>) ?? [];
          const submittedRows = submissions.filter(
            (submission) => !!toDate(submission.submittedAt),
          );
          const ungradedCount = submittedRows.filter(
            (submission) => typeof submission.grade !== 'number',
          ).length;
          const gradedCount = submittedRows.filter(
            (submission) => typeof submission.grade === 'number',
          ).length;

          if (ungradedCount > 0) {
            groupTasks.push({
              id: `review-${membership.groupId}-${assignment.id}`,
              kind,
              groupId: membership.groupId,
              groupName: membership.name,
              title: `${String(assignment.title ?? '未命名任務')} 待批改 ${ungradedCount} 份`,
              subtitle:
                submittedRows.length > 0
                  ? `${membership.name} · 已收 ${submittedRows.length} 份繳交`
                  : `${membership.name} · 有新的學生繳交待處理`,
              assignmentId: assignment.id,
              priority: 1,
              dueAt,
              preferredIntent: 'review',
              actionLabel: '前往批改',
              reason: '學生已提交內容，現在批改最能維持課程回饋節奏',
              consequence: '回饋延後會讓學生不清楚是否需要修正或補強',
              nextStep: '打開作業詳情，先處理未評分提交',
            });
          } else if (gradedCount > 0 && assignment.gradesPublished !== true) {
            groupTasks.push({
              id: `publish-${membership.groupId}-${assignment.id}`,
              kind,
              groupId: membership.groupId,
              groupName: membership.name,
              title: `${String(assignment.title ?? '未命名任務')} 可發布成績`,
              subtitle: `${membership.name} · ${gradedCount} 份評分已完成，等待正式發布`,
              assignmentId: assignment.id,
              priority: 2,
              dueAt,
              preferredIntent: 'review',
              actionLabel: '前往發布',
              reason: '這份作業的評分已整理完成，下一步應正式發布給學生',
              consequence: '學生看不到成績與回饋，後續學習調整會被延後',
              nextStep: '確認評分內容後，切換成績發布狀態',
            });
          }

          continue;
        }

        const studentWindow = studentWindows.get(assignment.id);
        if (!studentWindow || submitted.has(assignment.id)) continue;
        const lateSubmissionOpen = studentWindow.lateSubmissionOpen;

        groupTasks.push({
          id: `${kind}-${membership.groupId}-${assignment.id}`,
          kind,
          groupId: membership.groupId,
          groupName: membership.name,
          title: String(assignment.title ?? '未命名任務'),
          subtitle: lateSubmissionOpen
            ? '已過截止時間 · 教師允許補交'
            : dueAt
              ? `${label}將於 ${dueAt.toLocaleString('zh-TW', {
                  timeZone: 'Asia/Taipei',
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })} 截止`
              : '尚未設定截止時間 · 請查看作業說明',
          assignmentId: assignment.id,
          priority: lateSubmissionOpen ? 0 : dueAt === null ? 3 : kind === 'quiz' ? 2 : 1,
          dueAt,
          ...(lateSubmissionOpen ? { lateSubmissionAllowed: true } : {}),
        });
      }

      return groupTasks;
    }),
  );

  const fromGroups = tasks.flat();
  const fromAssistantQueue =
    mode === 'learning' ? [] : await listActionQueueInboxTasks(userId);

  const sorted = [...fromAssistantQueue, ...fromGroups].sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    const timeA = left.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const timeB = right.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return timeA - timeB;
  });
  // The compact Today inbox remains bounded. The learning workspace needs the
  // complete enrolled-course task list for accurate filters and summary counts.
  return mode === 'learning' ? sorted : sorted.slice(0, 14);
}

export async function getCourseGradebook(
  courseSpaceId: string,
): Promise<CourseGradebookData | null> {
  const db = getDb();
  const groupSnap = await getDoc(doc(db, 'groups', courseSpaceId));
  if (!groupSnap?.exists()) {
    return null;
  }
  const uid = getAuthInstance().currentUser?.uid;
  if (!uid) throw new Error('請先登入');
  return listCourseGradebook(db, courseSpaceId, uid);
}
