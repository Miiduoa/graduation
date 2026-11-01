import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from './firebase';
import {
  GRADE_COPY,
  type StudentGradebook,
  courseGradeFailure,
  gradeFromSchoolAssignment,
  mapInBatches,
  sortGradeItems,
} from './lmsStudentGrades';

const BATCH = 4;
const TEACHING = ['owner', 'instructor', 'moderator'];

function iso(value: unknown): string | null {
  if (!value) return null;
  const stamp = value as { toDate?: () => Date };
  const date = typeof stamp.toDate === 'function' ? stamp.toDate() : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function loadSchoolStudentGrades(
  uid: string,
  options: { online?: boolean | null } = {},
): Promise<StudentGradebook> {
  if (!uid || !isFirebaseConfigured()) {
    return { teachingCount: 0, courses: [], listError: GRADE_COPY.unsigned };
  }
  const db = getDb();
  let memberships: Array<{ id: string; name: string; role: string }>;
  try {
    const rows = await getDocs(collection(db, 'users', uid, 'groups'));
    memberships = rows.docs.flatMap((entry) => {
      const row = entry.data();
      if (row.type !== 'course' || row.status !== 'active') return [];
      return [
        {
          id: String(row.groupId ?? entry.id),
          name: String(row.name ?? '未命名課程'),
          role: String(row.role ?? 'member'),
        },
      ];
    });
  } catch (error) {
    const failure = courseGradeFailure(error, options);
    return { teachingCount: 0, courses: [], listError: failure.message };
  }
  const studying = memberships.filter((course) => !TEACHING.includes(course.role));
  const teachingCount = memberships.filter((course) => TEACHING.includes(course.role)).length;
  const courses = await mapInBatches(studying, BATCH, async (course) => {
    try {
      const assignments = await getDocs(collection(db, 'groups', course.id, 'assignments'));
      const items = sortGradeItems(
        await Promise.all(
          assignments.docs
            .filter((entry) => entry.data().published !== false && entry.data().status !== 'draft')
            .map(async (entry) => {
              const assignment = entry.data();
              const submission = await getDoc(
                doc(db, 'groups', course.id, 'assignments', entry.id, 'submissions', uid),
              );
              const row = submission.exists() ? submission.data() : {};
              return gradeFromSchoolAssignment({
                courseId: course.id,
                courseName: course.name,
                assignmentId: entry.id,
                title: String(assignment.title ?? '未命名作業'),
                type: String(assignment.type ?? 'assignment'),
                closed:
                  assignment.status === 'closed' ||
                  (!!assignment.dueAt &&
                    Date.parse(String(iso(assignment.dueAt))) < Date.now() &&
                    assignment.allowLateSubmission !== true),
                points:
                  typeof assignment.points === 'number' && Number.isFinite(assignment.points)
                    ? assignment.points
                    : null,
                submittedAt: submission.exists() ? iso(row.submittedAt) : null,
                submittedText: submission.exists()
                  ? String(row.content ?? row.text ?? '')
                  : null,
                gradePublished: row.gradePublished,
                gradeScore: row.gradeScore,
                gradeFeedback: row.gradeFeedback,
                gradePublishedAt: iso(row.gradePublishedAt),
              });
            }),
        ),
      );
      return {
        source: 'school' as const,
        courseId: course.id,
        courseName: course.name,
        href: `/course/${encodeURIComponent(course.id)}`,
        archived: false,
        status: 'ready' as const,
      checkedAt: new Date().toISOString(),
        error: null,
        assignmentError: null,
        quizError: null,
        items,
      };
    } catch (error) {
      const failure = courseGradeFailure(error, options);
      return {
        source: 'school' as const,
        courseId: course.id,
        courseName: course.name,
        href: `/course/${encodeURIComponent(course.id)}`,
        archived: false,
        status: failure.status,
        error: failure.message,
        assignmentError: null,
        quizError: null,
        items: [],
      };
    }
  });
  return { teachingCount, courses, listError: null };
}
