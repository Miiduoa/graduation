import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  onSnapshot,
} from 'firebase/firestore';
import { getAuth, getDb, isFirebaseConfigured } from './firebase';

export type TeacherScope = { uid: string; schoolId: string; courseId: string };
export type TeacherView = 'workspace' | 'gradebook';
export type TeacherCourse = { id: string; name: string; description: string; role: string };
export type TeacherWorkspace = {
  course: TeacherCourse;
  modules: {
    id: string;
    title: string;
    description: string;
    resourceUrl: string | null;
    resourceLabel: string;
    order: number;
  }[];
  assignments: {
    id: string;
    title: string;
    description: string;
    dueAt: string | null;
    points: number | null;
  }[];
};
export type TeacherGradebook = {
  course: TeacherCourse;
  rows: {
    id: string;
    uid: string;
    name: string | null;
    finalScore: number | null;
    result: string | null;
    published: boolean | null;
    publishedAt: string | null;
  }[];
};
export class TeacherCourseError extends Error {}
const ROLES = ['admin', 'owner', 'instructor', 'moderator'];
const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
function iso(value: unknown): string | null {
  if (!value) return null;
  const stamp = value as { toDate?: () => Date };
  const date = typeof stamp.toDate === 'function' ? stamp.toDate() : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function teacherResourceUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function assertCurrent(scope: TeacherScope, isCurrent: () => boolean) {
  if (
    !isFirebaseConfigured() ||
    !isCurrent() ||
    !scope.uid ||
    getAuth()?.currentUser?.uid !== scope.uid
  ) {
    throw new TeacherCourseError('請登入課程教師帳號後再試。');
  }
  if ([scope.uid, scope.schoolId, scope.courseId].some((part) => !part || part.includes('/'))) {
    throw new TeacherCourseError('課程連結不完整，請回到課程列表重新選擇。');
  }
}
async function authorize(scope: TeacherScope, isCurrent: () => boolean): Promise<TeacherCourse> {
  assertCurrent(scope, isCurrent);
  const db = getDb();
  const [school, member, course] = await Promise.all([
    getDocFromServer(doc(db, 'schools', scope.schoolId, 'members', scope.uid)),
    getDocFromServer(doc(db, 'groups', scope.courseId, 'members', scope.uid)),
    getDocFromServer(doc(db, 'groups', scope.courseId)),
  ]);
  assertCurrent(scope, isCurrent);
  if (
    !school.exists() ||
    school.data().status !== 'active' ||
    !member.exists() ||
    member.data().status !== 'active' ||
    !ROLES.includes(member.data().role) ||
    !course.exists() ||
    course.data().schoolId !== scope.schoolId ||
    course.data().type !== 'course'
  ) {
    throw new TeacherCourseError('你目前沒有這門課的教師權限，或課程不屬於目前學校。');
  }
  return {
    id: scope.courseId,
    name: text(course.data().name, '未命名課程'),
    description: text(course.data().description),
    role: member.data().role,
  };
}
function isVisible(row: Record<string, unknown>) {
  return row.published !== false && row.status !== 'draft';
}

export async function loadTeacherWorkspace(
  scope: TeacherScope,
  isCurrent = () => true,
): Promise<TeacherWorkspace> {
  const course = await authorize(scope, isCurrent);
  const db = getDb();
  const [moduleSnap, assignmentSnap] = await Promise.all([
    getDocsFromServer(collection(db, 'groups', scope.courseId, 'modules')),
    getDocsFromServer(collection(db, 'groups', scope.courseId, 'assignments')),
  ]);
  await authorize(scope, isCurrent);
  return {
    course,
    modules: moduleSnap.docs
      .filter((entry) => isVisible(entry.data()))
      .map((entry) => {
        const row = entry.data();
        return {
          id: entry.id,
          title: text(row.title, '課程單元'),
          description: text(row.description),
          resourceUrl: teacherResourceUrl(row.resourceUrl),
          resourceLabel: text(row.resourceLabel, '開啟教材'),
          order: number(row.order) ?? number(row.week) ?? Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((a, b) => a.order - b.order),
    assignments: assignmentSnap.docs
      .filter((entry) => isVisible(entry.data()))
      .map((entry) => {
        const row = entry.data();
        return {
          id: entry.id,
          title: text(row.title, '未命名作業'),
          description: text(row.description),
          dueAt: iso(row.dueAt),
          points: number(row.points),
        };
      })
      .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999')),
  };
}

export async function loadTeacherGradebook(
  scope: TeacherScope,
  isCurrent = () => true,
): Promise<TeacherGradebook> {
  const course = await authorize(scope, isCurrent);
  const snapshot = await getDocsFromServer(
    collection(getDb(), 'groups', scope.courseId, 'gradebook'),
  );
  await authorize(scope, isCurrent);
  return {
    course,
    rows: snapshot.docs.map((entry) => {
      const row = entry.data();
      return {
        id: entry.id,
        uid: text(row.userId, entry.id),
        name: text(row.displayName) || text(row.studentName) || null,
        finalScore: number(row.finalScore),
        result: text(row.result) || null,
        published: typeof row.published === 'boolean' ? row.published : null,
        publishedAt: iso(row.publishedAt),
      };
    }),
  };
}

// These listeners only invalidate access; cached snapshots never grant permission.
export function watchTeacherAccess(scope: TeacherScope, invalidate: () => void) {
  const db = getDb();
  const stops: Array<() => void> = [];
  try {
    stops.push(
      onSnapshot(
        doc(db, 'schools', scope.schoolId, 'members', scope.uid),
        (snapshot) => {
          if (!snapshot.exists() || snapshot.data().status !== 'active') invalidate();
        },
        invalidate,
      ),
    );
    stops.push(
      onSnapshot(
        doc(db, 'groups', scope.courseId, 'members', scope.uid),
        (snapshot) => {
          if (
            !snapshot.exists() ||
            snapshot.data().status !== 'active' ||
            !ROLES.includes(snapshot.data().role)
          )
            invalidate();
        },
        invalidate,
      ),
    );
    stops.push(
      onSnapshot(
        doc(db, 'groups', scope.courseId),
        (snapshot) => {
          if (
            !snapshot.exists() ||
            snapshot.data().schoolId !== scope.schoolId ||
            snapshot.data().type !== 'course'
          )
            invalidate();
        },
        invalidate,
      ),
    );
  } catch (error) {
    stops.forEach((stop) => stop());
    throw error;
  }
  return () => stops.forEach((stop) => stop());
}
