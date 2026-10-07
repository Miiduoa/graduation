import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from './firebase';

export interface HomeCourse {
  id: string;
  name: string;
  role: string;
  unreadCount: number;
}
export interface HomeTask {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  dueAt: string | null;
}
export interface HomeData {
  courses: HomeCourse[];
  tasks: HomeTask[];
  unreadCount: number;
}

function dateString(value: unknown): string | null {
  if (!value) return null;
  const timestamp = value as { toDate?: () => Date };
  const date =
    typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function loadHomeData(uid: string): Promise<HomeData> {
  if (!uid || !isFirebaseConfigured()) throw new Error('校園服務尚未連線，請稍後再試。');
  const db = getDb();
  const memberships = await getDocs(collection(db, 'users', uid, 'groups'));
  const courses = memberships.docs.flatMap((entry): HomeCourse[] => {
    const row = entry.data();
    if (row.type !== 'course' || row.status !== 'active') return [];
    return [
      {
        id: String(row.groupId ?? entry.id),
        name: String(row.name ?? '未命名課程'),
        role: String(row.role ?? 'member'),
        unreadCount: Number(row.unreadCount) || 0,
      },
    ];
  });
  const tasks = (
    await Promise.all(
      courses.map(async (course) => {
        if (['owner', 'instructor', 'moderator'].includes(course.role)) return [];
        const assignments = await getDocs(collection(db, 'groups', course.id, 'assignments'));
        const rows = await Promise.all(
          assignments.docs.map(async (entry): Promise<HomeTask | null> => {
            const assignment = entry.data();
            if (assignment.published === false || assignment.status === 'draft') return null;
            const submission = await getDoc(
              doc(db, 'groups', course.id, 'assignments', entry.id, 'submissions', uid),
            );
            if (submission.exists() && submission.data().submittedAt) return null;
            return {
              id: entry.id,
              courseId: course.id,
              courseName: course.name,
              title: String(assignment.title ?? '未命名作業'),
              dueAt: dateString(assignment.dueAt),
            };
          }),
        );
        return rows.filter((row): row is HomeTask => row !== null);
      }),
    )
  )
    .flat()
    .sort(
      (a, b) =>
        (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity),
    );
  return {
    courses,
    tasks,
    unreadCount: courses.reduce((sum, course) => sum + course.unreadCount, 0),
  };
}
