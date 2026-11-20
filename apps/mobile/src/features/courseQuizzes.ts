import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  query,
} from 'firebase/firestore';
import { getDb, isFirebaseMockMode } from '../firebase';

export type CourseQuizNotice = {
  id: string;
  title: string;
  description: string;
  dueAt: string | null;
  type: 'quiz' | 'exam';
};
export type CourseQuizNotices = {
  groupId: string;
  groupName: string;
  notices: CourseQuizNotice[];
  hasMore: boolean;
};

function identifier(value: string) {
  if (!value || value.length > 200 || /[\s/]/.test(value) || value === '.' || value === '..')
    throw new Error('請從我的課程重新開啟測驗。');
  return value;
}
function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function date(value: unknown): string | null {
  try {
    const raw =
      value && typeof (value as { toMillis?: unknown }).toMillis === 'function'
        ? (value as { toMillis: () => number }).toMillis()
        : value;
    if (typeof raw !== 'number' && typeof raw !== 'string') return null;
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  } catch {
    return null;
  }
}

export async function loadCourseQuizNotices(
  uid: string,
  schoolId: string,
  groupId: string,
): Promise<CourseQuizNotices> {
  [uid, schoolId, groupId].forEach(identifier);
  if (isFirebaseMockMode()) throw new Error('請連線後重新載入課程測驗。');
  const db = getDb();
  const verifyAccess = async () => {
    const [schoolMember, member, group] = await Promise.all([
      getDocFromServer(doc(db, 'schools', schoolId, 'members', uid)),
      getDocFromServer(doc(db, 'groups', groupId, 'members', uid)),
      getDocFromServer(doc(db, 'groups', groupId)),
    ]);
    const data = group.data();
    if (
      !schoolMember.exists() ||
      schoolMember.data().status !== 'active' ||
      !member.exists() ||
      member.data().status !== 'active' ||
      !group.exists() ||
      data?.schoolId !== schoolId ||
      data.type !== 'course' ||
      data.isDemo === true
    )
      throw new Error('目前無法查看這門課程，請確認學校與課程成員資格。');
    return text(data.name, 200) || '課程測驗';
  };
  await verifyAccess();
  const [quizzes, assignments] = await Promise.all([
    getDocsFromServer(query(collection(db, 'groups', groupId, 'quizzes'), limit(201))),
    getDocsFromServer(query(collection(db, 'groups', groupId, 'assignments'), limit(201))),
  ]);
  const notices = new Map<string, CourseQuizNotice>();
  for (const [snapshot, kind] of [
    [quizzes, 'quiz'],
    [assignments, 'assignment'],
  ] as const) {
    for (const row of snapshot.docs.slice(0, 200)) {
      const raw = row.data();
      if (raw.type !== 'quiz' && raw.type !== 'exam') continue;
      if (raw.isDemo === true || raw.source === 'demo' || /^(demo-|q-mock-)/i.test(row.id))
        continue;
      if (raw.schoolId != null && raw.schoolId !== schoolId) continue;
      if (
        raw.published === false ||
        (raw.published !== true && !(kind === 'quiz' && raw.status === 'scheduled'))
      )
        continue;
      const title = text(raw.title, 240);
      if (!title) continue;
      const id = text(raw.assignmentId, 200) || row.id;
      if (notices.has(id)) continue;
      notices.set(id, {
        id,
        title,
        description: text(raw.description, 8000),
        dueAt: date(raw.dueAt),
        type: raw.type,
      });
    }
  }
  // Recheck membership after the content read so a revocation during loading is not displayed.
  const groupName = await verifyAccess();
  return {
    groupId,
    groupName,
    notices: [...notices.values()].sort((a, b) =>
      (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'),
    ),
    hasMore: quizzes.size > 200 || assignments.size > 200,
  };
}
