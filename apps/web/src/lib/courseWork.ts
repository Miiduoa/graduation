import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { getAuth, getDb, isFirebaseConfigured } from './firebase';

export interface CourseAssignment {
  id: string;
  title: string;
  type: string;
  description: string;
  dueAt: string | null;
  allowLateSubmission: boolean;
  closed: boolean;
  submittedText: string | null;
  submittedAt: string | null;
  points: number | null;
  grade: { score: number; feedback: string; publishedAt: string | null; revisionCount: number } | null;
}
export interface CourseWork {
  id: string;
  name: string;
  description: string;
  canTeach: boolean;
  assignments: CourseAssignment[];
  modules: {
    id: string;
    title: string;
    description: string;
    order: number;
    resourceUrl: string | null;
    resourceLabel: string;
  }[];
}
function iso(value: unknown): string | null {
  if (!value) return null;
  const stamp = value as { toDate?: () => Date };
  const date = typeof stamp.toDate === 'function' ? stamp.toDate() : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function assertCurrentUser(uid: string) {
  if (!uid || getAuth()?.currentUser?.uid !== uid) {
    throw new Error('登入身分已變更，請重新開啟課程。');
  }
}

export async function loadCourseWork(courseId: string, uid: string): Promise<CourseWork> {
  if (!isFirebaseConfigured()) throw new Error('請先登入。');
  assertCurrentUser(uid);
  const db = getDb();
  const [course, member] = await Promise.all([
    getDocFromServer(doc(db, 'groups', courseId)),
    getDocFromServer(doc(db, 'groups', courseId, 'members', uid)),
  ]);
  assertCurrentUser(uid);
  if (!course.exists() || course.data().type !== 'course' ||
      !member.exists() || member.data().status !== 'active')
    throw new Error('找不到課程，或你尚未加入這門課。');
  const canTeach = ['owner', 'instructor', 'moderator'].includes(member.data().role);
  const [snap, moduleSnap] = await Promise.all([
    getDocsFromServer(collection(db, 'groups', courseId, 'assignments')),
    getDocsFromServer(collection(db, 'groups', courseId, 'modules')),
  ]);
  assertCurrentUser(uid);
  const modules = moduleSnap.docs
    .filter((entry) => entry.data().published !== false)
    .map((entry) => {
      const row = entry.data();
      let resourceUrl: string | null = null;
      try {
        const url = new URL(String(row.resourceUrl));
        if (['https:', 'http:'].includes(url.protocol)) resourceUrl = url.href;
      } catch {
        /* A module may have no external resource. */
      }
      return {
        id: entry.id,
        title: String(row.title ?? '課程單元'),
        description: String(row.description ?? ''),
        order: Number(row.order ?? row.week ?? 999),
        resourceUrl,
        resourceLabel: String(row.resourceLabel ?? '開啟教材'),
      };
    })
    .sort((a, b) => a.order - b.order);
  const assignments = await Promise.all(
    snap.docs
      .filter((entry) => entry.data().published !== false && entry.data().status !== 'draft')
      .map(async (entry): Promise<CourseAssignment> => {
        const assignment = entry.data();
        const submission = canTeach
          ? null
          : await getDocFromServer(doc(db, 'groups', courseId, 'assignments', entry.id, 'submissions', uid));
        return {
          id: entry.id,
          type: String(assignment.type ?? 'assignment'),
          title: String(assignment.title ?? '未命名作業'),
          description: String(assignment.description ?? ''),
          closed: assignment.status === 'closed',
          dueAt: iso(assignment.dueAt),
          allowLateSubmission: assignment.allowLateSubmission === true,
          submittedText: submission?.exists()
            ? String(submission.data().content ?? submission.data().text ?? '')
            : null,
          submittedAt: submission?.exists() ? iso(submission.data().submittedAt) : null,
          points: typeof assignment.points === 'number' && Number.isFinite(assignment.points)
            ? assignment.points : null,
          grade: submission?.exists() && submission.data().gradePublished === true &&
            typeof submission.data().gradeScore === 'number' &&
            Number.isFinite(submission.data().gradeScore)
            ? {
                score: submission.data().gradeScore,
                feedback: typeof submission.data().gradeFeedback === 'string'
                  ? submission.data().gradeFeedback : '',
                publishedAt: iso(submission.data().gradePublishedAt),
                revisionCount: Number.isInteger(submission.data().gradeRevisionCount) &&
                  submission.data().gradeRevisionCount >= 0
                  ? submission.data().gradeRevisionCount : 0,
              }
            : null,
        };
      }),
  );
  assertCurrentUser(uid);
  return {
    id: courseId,
    name: String(course.data().name ?? '課程'),
    description: String(course.data().description ?? ''),
    canTeach,
    assignments,
    modules,
  };
}

export async function submitCourseText(
  courseId: string,
  assignmentId: string,
  uid: string,
  text: string,
): Promise<void> {
  const answer = text.trim();
  if (!uid || !answer || answer.length > 20000)
    throw new Error('請輸入 1 至 20,000 字的作業內容。');
  if (!isFirebaseConfigured()) throw new Error('無法連線，請稍後重試。');
  assertCurrentUser(uid);
  const db = getDb();
  await runTransaction(db, async (transaction) => {
    const assignment = await transaction.get(
      doc(db, 'groups', courseId, 'assignments', assignmentId),
    );
    if (!assignment.exists()) throw new Error('此作業已不存在。');
    const data = assignment.data();
    if (data.published === false || ['draft', 'closed'].includes(data.status))
      throw new Error('此作業尚未開放。');
    if (['quiz', 'exam'].includes(data.type)) throw new Error('請透過評量頁面作答。');
    const due = iso(data.dueAt);
    if (due && Date.parse(due) < Date.now() && data.allowLateSubmission !== true)
      throw new Error('作業已截止，請聯絡授課教師。');
    const ref = doc(db, 'groups', courseId, 'assignments', assignmentId, 'submissions', uid);
    const existing = await transaction.get(ref);
    if (existing.exists() && existing.data().submittedAt)
      throw new Error('這份作業已有繳交紀錄，請重新整理確認。');
    assertCurrentUser(uid);
    transaction.set(
      ref,
      {
        userId: uid,
        groupId: courseId,
        assignmentId,
        content: answer,
        status: 'submitted',
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
}
