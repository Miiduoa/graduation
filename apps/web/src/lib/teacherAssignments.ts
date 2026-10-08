import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  runTransaction,
  serverTimestamp,
  type Transaction,
} from 'firebase/firestore';
import { getAuth, getDb } from './firebase';
import {
  authorizeTeacherCourse,
  TeacherCourseError,
  type TeacherScope,
} from './teacherCourse';

export type AssignmentDraft = {
  title: string;
  description: string;
  dueAt: string;
  points: number;
  allowLateSubmission: boolean;
};

export type ReviewedSubmission = {
  uid: string;
  content: string;
  submittedAt: string | null;
  score: number | null;
  feedback: string;
  gradedAt: string | null;
  revisionCount: number;
};

export type GradeRevision = {
  id: string;
  beforeScore: number;
  afterScore: number;
  beforeFeedback: string;
  afterFeedback: string;
  reason: string;
  changedBy: string;
  changedAt: string | null;
};

export type GradeExpectation = { score: number; feedback: string; gradedAt: string | null };

export type AssignmentReview = {
  title: string;
  points: number;
  submissions: ReviewedSubmission[];
};

function requireCurrentTeacher(scope: TeacherScope) {
  if (getAuth()?.currentUser?.uid !== scope.uid) {
    throw new TeacherCourseError('登入身分已變更，請重新開啟課程。');
  }
}

function validId(value: string) {
  return value.length > 0 && value.length <= 150 && !value.includes('/');
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const stamp = value as { toDate?: () => Date };
  const date = typeof stamp.toDate === 'function' ? stamp.toDate() : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function checkWriteAccess(scope: TeacherScope, transaction: Transaction) {
  requireCurrentTeacher(scope);
  const db = getDb();
  const [school, member, course] = await Promise.all([
    transaction.get(doc(db, 'schools', scope.schoolId, 'members', scope.uid)),
    transaction.get(doc(db, 'groups', scope.courseId, 'members', scope.uid)),
    transaction.get(doc(db, 'groups', scope.courseId)),
  ]);
  requireCurrentTeacher(scope);
  if (
    !school.exists() || school.data().status !== 'active' ||
    !member.exists() || member.data().status !== 'active' ||
    !['admin', 'owner', 'instructor', 'moderator'].includes(member.data().role) ||
    !course.exists() || course.data().type !== 'course' ||
    course.data().schoolId !== scope.schoolId
  ) {
    throw new TeacherCourseError('教師權限或課程歸屬已變更，這次操作沒有寫入。');
  }
}

export function newTeacherAssignmentId(courseId: string): string {
  if (!validId(courseId)) throw new TeacherCourseError('無效的課程編號。');
  return doc(collection(getDb(), 'groups', courseId, 'assignments')).id;
}

export async function publishTeacherAssignment(
  scope: TeacherScope,
  assignmentId: string,
  draft: AssignmentDraft,
): Promise<void> {
  if (!validId(assignmentId)) throw new TeacherCourseError('無效的作業編號。');
  const title = draft.title.trim();
  const description = draft.description.trim();
  const due = draft.dueAt.trim() ? new Date(draft.dueAt) : null;
  if (!title || title.length > 120 || description.length > 10000) {
    throw new TeacherCourseError('標題限 1–120 字，作業說明最多 10,000 字。');
  }
  if (!Number.isInteger(draft.points) || draft.points < 1 || draft.points > 1000) {
    throw new TeacherCourseError('配分請輸入 1–1,000 的整數。');
  }
  if (due && (!Number.isFinite(due.getTime()) || due.getTime() <= Date.now())) {
    throw new TeacherCourseError('截止時間必須晚於目前時間。');
  }
  await authorizeTeacherCourse(scope, () => getAuth()?.currentUser?.uid === scope.uid);
  requireCurrentTeacher(scope);
  const db = getDb();
  const ref = doc(db, 'groups', scope.courseId, 'assignments', assignmentId);
  const dueAt = due ? due.toISOString() : null;
  await runTransaction(db, async (transaction) => {
    await checkWriteAccess(scope, transaction);
    const existing = await transaction.get(ref);
    requireCurrentTeacher(scope);
    if (existing.exists()) {
      const row = existing.data();
      // A retry after an uncertain network response must not create or edit a second assignment.
      if (row.createdBy !== scope.uid || row.title !== title ||
          row.description !== description || row.points !== draft.points ||
          row.dueAt !== dueAt || row.allowLateSubmission !== draft.allowLateSubmission) {
        throw new TeacherCourseError('作業可能已建立。請更新列表確認後，再編輯或新增。');
      }
      return;
    }
    transaction.set(ref, {
      title,
      description,
      type: 'assignment',
      groupId: scope.courseId,
      schoolId: scope.schoolId,
      dueAt,
      points: draft.points,
      allowLateSubmission: draft.allowLateSubmission,
      published: true,
      status: 'published',
      createdBy: scope.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  requireCurrentTeacher(scope);
  const confirmed = await getDocFromServer(ref);
  if (!confirmed.exists() || confirmed.data().createdBy !== scope.uid) {
    throw new TeacherCourseError('尚未確認作業已發布，請更新列表檢查。');
  }
}

export async function loadTeacherSubmissions(
  scope: TeacherScope,
  assignmentId: string,
): Promise<AssignmentReview> {
  if (!validId(assignmentId)) throw new TeacherCourseError('無效的作業編號。');
  await authorizeTeacherCourse(scope);
  const db = getDb();
  const ref = doc(db, 'groups', scope.courseId, 'assignments', assignmentId);
  const assignment = await getDocFromServer(ref);
  if (!assignment.exists()) throw new TeacherCourseError('這份作業已不存在。');
  const data = assignment.data();
  const snapshot = await getDocsFromServer(collection(ref, 'submissions'));
  await authorizeTeacherCourse(scope);
  requireCurrentTeacher(scope);
  return {
    title: typeof data.title === 'string' ? data.title : '未命名作業',
    points: typeof data.points === 'number' && Number.isFinite(data.points) ? data.points : 0,
    submissions: snapshot.docs
      .filter((entry) => entry.data().userId === entry.id && entry.data().submittedAt)
      .map((entry) => {
        const row = entry.data();
        return {
          uid: entry.id,
          content: typeof row.content === 'string' ? row.content : '',
          submittedAt: toIso(row.submittedAt),
          score: row.gradePublished === true && typeof row.gradeScore === 'number'
            && Number.isFinite(row.gradeScore) ? row.gradeScore : null,
          feedback: row.gradePublished === true && typeof row.gradeFeedback === 'string'
            ? row.gradeFeedback : '',
          gradedAt: row.gradePublished === true ? toIso(row.gradePublishedAt) : null,
          revisionCount: Number.isInteger(row.gradeRevisionCount) && row.gradeRevisionCount >= 0
            ? row.gradeRevisionCount : 0,
        };
      })
      .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '')),
  };
}

export async function publishSubmissionGrade(
  scope: TeacherScope,
  assignmentId: string,
  studentUid: string,
  score: number,
  feedback: string,
): Promise<void> {
  if (!validId(assignmentId) || !validId(studentUid)) {
    throw new TeacherCourseError('無效的作業或學生編號。');
  }
  const comment = feedback.trim();
  if (!Number.isFinite(score) || score < 0 ||
      Math.abs(score * 100 - Math.round(score * 100)) > 0.0000001 ||
      comment.length > 4000) {
    throw new TeacherCourseError('請確認分數為非負數、最多兩位小數，評語不超過 4,000 字。');
  }
  await authorizeTeacherCourse(scope);
  requireCurrentTeacher(scope);
  const db = getDb();
  const assignmentRef = doc(db, 'groups', scope.courseId, 'assignments', assignmentId);
  const submissionRef = doc(assignmentRef, 'submissions', studentUid);
  await runTransaction(db, async (transaction) => {
    await checkWriteAccess(scope, transaction);
    const assignment = await transaction.get(assignmentRef);
    const submission = await transaction.get(submissionRef);
    requireCurrentTeacher(scope);
    if (!assignment.exists() || assignment.data().type !== 'assignment') {
      throw new TeacherCourseError('作業已移除或不是文字作業。');
    }
    const points = assignment.data().points;
    if (typeof points !== 'number' || !Number.isFinite(points) || points <= 0 || score > points) {
      throw new TeacherCourseError('分數超過作業配分，或這份作業尚未設定配分。');
    }
    if (!submission.exists() || submission.data().userId !== studentUid ||
        !submission.data().submittedAt) {
      throw new TeacherCourseError('這位學生尚未繳交作業。');
    }
    const row = submission.data();
    if (row.gradePublished === true) {
      if (row.gradePublishedBy === scope.uid &&
          row.gradeScore === score && row.gradeFeedback === comment) return;
      throw new TeacherCourseError('此作業已有已發布成績；為避免覆蓋，請先核對原始紀錄。');
    }
    transaction.update(submissionRef, {
      gradeScore: score,
      gradeFeedback: comment,
      gradePublished: true,
      gradePublishedBy: scope.uid,
      gradePublishedAt: serverTimestamp(),
    });
  });
  requireCurrentTeacher(scope);
  const confirmed = await getDocFromServer(submissionRef);
  if (!confirmed.exists() || confirmed.data().gradePublished !== true ||
      confirmed.data().gradeScore !== score ||
      confirmed.data().gradePublishedBy !== scope.uid) {
    throw new TeacherCourseError('尚未確認評分已發布，請重新讀取繳交紀錄。');
  }
}


export function newGradeRevisionId(courseId: string, assignmentId: string, studentUid: string) {
  if (![courseId, assignmentId, studentUid].every(validId)) {
    throw new TeacherCourseError('無效的作業或學生編號。');
  }
  return doc(collection(getDb(), 'groups', courseId, 'assignments', assignmentId,
    'submissions', studentUid, 'gradeRevisions')).id;
}

export async function reviseSubmissionGrade(
  scope: TeacherScope,
  assignmentId: string,
  studentUid: string,
  revisionId: string,
  expected: GradeExpectation,
  score: number,
  feedback: string,
  reason: string,
): Promise<void> {
  if (![assignmentId, studentUid, revisionId].every(validId)) {
    throw new TeacherCourseError('無效的成績更正編號。');
  }
  const comment = feedback.trim();
  const explanation = reason.trim();
  if (!Number.isFinite(score) || score < 0 ||
      Math.abs(score * 100 - Math.round(score * 100)) > 0.0000001 ||
      comment.length > 4000 || explanation.length < 5 || explanation.length > 500) {
    throw new TeacherCourseError('分數限兩位小數；更正原因請寫 5–500 字，評語最多 4,000 字。');
  }
  if (score === expected.score && comment === expected.feedback) {
    throw new TeacherCourseError('新分數與評語均未改變，不需要建立更正紀錄。');
  }
  await authorizeTeacherCourse(scope);
  requireCurrentTeacher(scope);
  const db = getDb();
  const assignmentRef = doc(db, 'groups', scope.courseId, 'assignments', assignmentId);
  const submissionRef = doc(assignmentRef, 'submissions', studentUid);
  const revisionRef = doc(submissionRef, 'gradeRevisions', revisionId);
  await runTransaction(db, async (transaction) => {
    await checkWriteAccess(scope, transaction);
    const [assignment, submission, recorded] = await Promise.all([
      transaction.get(assignmentRef),
      transaction.get(submissionRef),
      transaction.get(revisionRef),
    ]);
    requireCurrentTeacher(scope);
    if (!assignment.exists() || assignment.data().type !== 'assignment') {
      throw new TeacherCourseError('作業不存在，或不是文字作業。');
    }
    const points = assignment.data().points;
    if (typeof points !== 'number' || !Number.isFinite(points) || points <= 0 || score > points) {
      throw new TeacherCourseError('新成績超過作業配分，或此作業沒有有效配分。');
    }
    if (!submission.exists() || submission.data().userId !== studentUid ||
        !submission.data().submittedAt || submission.data().gradePublished !== true) {
      throw new TeacherCourseError('尚未找到已發布的學生繳交成績。');
    }
    const row = submission.data();
    if (recorded.exists()) {
      const history = recorded.data();
      if (history.changedBy === scope.uid && history.beforeScore === expected.score &&
          history.afterScore === score && history.beforeFeedback === expected.feedback &&
          history.afterFeedback === comment && history.reason === explanation &&
          row.gradeRevisionId === revisionId && row.gradeScore === score &&
          row.gradeFeedback === comment) return;
      throw new TeacherCourseError('這次更正編號已有不同紀錄，請重新讀取成績。');
    }
    if (row.gradeScore !== expected.score ||
        row.gradeFeedback !== expected.feedback ||
        toIso(row.gradePublishedAt) !== expected.gradedAt) {
      throw new TeacherCourseError('成績已被其他教師更新，請重新讀取後再更正。');
    }
    const nextVersion = (Number.isInteger(row.gradeRevisionCount) &&
      row.gradeRevisionCount >= 0 ? row.gradeRevisionCount : 0) + 1;
    transaction.update(submissionRef, {
      gradeScore: score,
      gradeFeedback: comment,
      gradePublishedBy: scope.uid,
      gradePublishedAt: serverTimestamp(),
      gradeRevisionId: revisionId,
      gradeRevisionCount: nextVersion,
      gradeRevisedAt: serverTimestamp(),
      gradeRevisionReason: explanation,
    });
    transaction.set(revisionRef, {
      beforeScore: expected.score,
      afterScore: score,
      beforeFeedback: expected.feedback,
      afterFeedback: comment,
      reason: explanation,
      changedBy: scope.uid,
      changedAt: serverTimestamp(),
      revision: nextVersion,
    });
  });
  requireCurrentTeacher(scope);
  const [confirmed, history] = await Promise.all([
    getDocFromServer(submissionRef),
    getDocFromServer(revisionRef),
  ]);
  if (!confirmed.exists() || !history.exists() ||
      confirmed.data().gradeRevisionId !== revisionId ||
      confirmed.data().gradeScore !== score ||
      history.data().afterScore !== score ||
      history.data().changedBy !== scope.uid) {
    throw new TeacherCourseError('無法確認更正紀錄與最新成績一致，請重新讀取。');
  }
}

export async function loadGradeRevisions(
  scope: TeacherScope,
  assignmentId: string,
  studentUid: string,
): Promise<GradeRevision[]> {
  if (![assignmentId, studentUid].every(validId)) {
    throw new TeacherCourseError('無效的作業或學生編號。');
  }
  await authorizeTeacherCourse(scope);
  const db = getDb();
  const revisions = await getDocsFromServer(collection(db, 'groups', scope.courseId,
    'assignments', assignmentId, 'submissions', studentUid, 'gradeRevisions'));
  await authorizeTeacherCourse(scope);
  requireCurrentTeacher(scope);
  return revisions.docs.map((entry) => {
    const row = entry.data();
    return {
      id: entry.id,
      beforeScore: typeof row.beforeScore === 'number' ? row.beforeScore : 0,
      afterScore: typeof row.afterScore === 'number' ? row.afterScore : 0,
      beforeFeedback: typeof row.beforeFeedback === 'string' ? row.beforeFeedback : '',
      afterFeedback: typeof row.afterFeedback === 'string' ? row.afterFeedback : '',
      reason: typeof row.reason === 'string' ? row.reason : '',
      changedBy: typeof row.changedBy === 'string' ? row.changedBy : '',
      changedAt: toIso(row.changedAt),
    };
  }).sort((a, b) => (b.changedAt ?? '').localeCompare(a.changedAt ?? ''));
}
