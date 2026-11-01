import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { getDb, isFirebaseConfigured } from './firebase';
import type { MaterialSearchSeed } from './courseMaterials';

export interface HomeCourse {
  id: string;
  name: string;
  role: string;
  unreadCount: number;
  href?: string;
}
export interface HomeTask {
  kind?: 'assignment' | 'quiz';
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  dueAt: string | null;
  href?: string;
  acceptsLate?: boolean;
}
export interface HomeMaterial {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  unitTitle: string | null;
  createdAt: string;
  href: string;
}
/** Published teacher feedback visible to the signed-in student. */
export interface HomeFeedback {
  kind: 'assignment' | 'quiz';
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  feedback: string;
  score: number | null;
  reviewedAt: string | null;
  /** Student submission time; used to warn when published feedback predates a later resubmit. */
  submittedAt?: string | null;
  href: string;
}

export function isPublishedHomeGrade(row: {
  gradePublished?: unknown;
  gradeFeedback?: unknown;
  gradeScore?: unknown;
}): boolean {
  if (row.gradePublished !== true) return false;
  const hasFeedback =
    typeof row.gradeFeedback === 'string' && row.gradeFeedback.trim().length > 0;
  const hasScore = typeof row.gradeScore === 'number' && Number.isFinite(row.gradeScore);
  return hasFeedback || hasScore;
}

export function feedbackPredatesSubmission(
  reviewedAt: string | null | undefined,
  submittedAt: string | null | undefined,
): boolean {
  if (!reviewedAt || !submittedAt) return false;
  const reviewed = parseTaipeiInstant(reviewedAt);
  const submitted = parseTaipeiInstant(submittedAt);
  return reviewed !== null && submitted !== null && reviewed < submitted;
}
export interface HomeData {
  tasksError?: string | null;
  courses: HomeCourse[];
  tasks: HomeTask[];
  /** Newest published teacher feedback across enrolled courses (student view). */
  recentFeedback?: HomeFeedback[];
  materials?: HomeMaterial[];
  /** Set when materials could not be read; assignments and feedback may still be present. */
  materialsError?: string | null;
  /** Successful material reads the today-page search box can reuse without another round-trip. */
  materialSearchSeed?: MaterialSearchSeed;
  unreadCount: number;
  archivedCount?: number;
}

const FEEDBACK_LIMIT = 8;

function dateString(value: unknown): string | null {
  if (!value) return null;
  const timestamp = value as { toDate?: () => Date };
  const date =
    typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function coursePath(courseId: string): string {
  return `/course/${encodeURIComponent(courseId)}`;
}

function assignmentHref(courseId: string, assignmentId: string, quizLike: boolean): string {
  const hash = quizLike ? 'quiz' : 'assignment';
  return `${coursePath(courseId)}#${hash}-${encodeURIComponent(assignmentId)}`;
}

function sortFeedback(rows: HomeFeedback[]): HomeFeedback[] {
  return rows
    .sort(
      (a, b) =>
        (b.reviewedAt ? parseTaipeiInstant(b.reviewedAt) ?? 0 : 0) -
        (a.reviewedAt ? parseTaipeiInstant(a.reviewedAt) ?? 0 : 0),
    )
    .slice(0, FEEDBACK_LIMIT);
}

export async function loadHomeData(uid: string): Promise<HomeData> {
  if (!uid || !isFirebaseConfigured()) throw new Error('校園服務尚未連線，請稍後再試。');
  const db = getDb();
  const memberships = await getDocs(collection(db, 'users', uid, 'groups'));
  const courses = memberships.docs.flatMap((entry): HomeCourse[] => {
    const row = entry.data();
    if (row.type !== 'course' || row.status !== 'active') return [];
    const id = String(row.groupId ?? entry.id);
    return [
      {
        id,
        name: String(row.name ?? '未命名課程'),
        role: String(row.role ?? 'member'),
        unreadCount: Number(row.unreadCount) || 0,
        href: coursePath(id),
      },
    ];
  });
  const tasks: HomeTask[] = [];
  const recentFeedback: HomeFeedback[] = [];
  await Promise.all(
    courses.map(async (course) => {
      if (['owner', 'instructor', 'moderator'].includes(course.role)) return;
      const assignments = await getDocs(collection(db, 'groups', course.id, 'assignments'));
      await Promise.all(
        assignments.docs.map(async (entry) => {
          const assignment = entry.data();
          if (assignment.published === false || assignment.status === 'draft') return;
          const quizLike = ['quiz', 'exam'].includes(String(assignment.type ?? ''));
          const kind: HomeTask['kind'] = quizLike ? 'quiz' : 'assignment';
          const href = assignmentHref(course.id, entry.id, quizLike);
          const title = String(assignment.title ?? '未命名作業');
          const submission = await getDoc(
            doc(db, 'groups', course.id, 'assignments', entry.id, 'submissions', uid),
          );
          if (submission.exists()) {
            const row = submission.data();
            const submittedAt = dateString(row.submittedAt);
            if (isPublishedHomeGrade(row)) {
              recentFeedback.push({
                kind,
                id: entry.id,
                courseId: course.id,
                courseName: course.name,
                title,
                feedback: typeof row.gradeFeedback === 'string' ? row.gradeFeedback : '',
                score:
                  typeof row.gradeScore === 'number' && Number.isFinite(row.gradeScore)
                    ? row.gradeScore
                    : null,
                reviewedAt: dateString(row.gradePublishedAt),
                submittedAt,
                href,
              });
            }
            if (row.submittedAt) return;
          }
          tasks.push({
            kind,
            id: entry.id,
            courseId: course.id,
            courseName: course.name,
            title,
            dueAt: dateString(assignment.dueAt),
            href,
            acceptsLate: assignment.allowLateSubmission === true,
          });
        }),
      );
    }),
  );
  tasks.sort(
    (a, b) =>
      (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity),
  );
  return {
    courses,
    tasks,
    recentFeedback: sortFeedback(recentFeedback),
    unreadCount: courses.reduce((sum, course) => sum + course.unreadCount, 0),
  };
}
