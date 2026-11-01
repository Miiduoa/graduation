import {
  createNuniClasses,
  NuniError,
  type NuniTransport,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import {
  GRADE_COPY,
  type CourseGradeSection,
  type StudentGradebook,
  courseGradeFailure,
  gradeFromNuniAssignment,
  gradeFromNuniQuiz,
  mapInBatches,
  sortGradeItems,
} from './lmsStudentGrades';

const BATCH = 4;

function emptySection(
  course: NuniWorkspace,
  status: CourseGradeSection['status'],
  error: string | null,
): CourseGradeSection {
  return {
    source: 'nuni',
    courseId: course.id,
    courseName: course.title,
    href: `/classroom/course/${encodeURIComponent(course.id)}`,
    archived: course.state !== 'active',
    status,
    error,
    assignmentError: null,
    quizError: null,
    items: [],
  };
}

export async function loadNuniStudentGrades(
  transport: NuniTransport,
  platformAccountId: string,
  options: { online?: boolean | null } = {},
): Promise<StudentGradebook> {
  const classes = createNuniClasses(transport, platformAccountId);
  let memberships: NuniWorkspace[];
  try {
    memberships = await classes.list();
  } catch (error) {
    const failure = courseGradeFailure(error, options);
    return { teachingCount: 0, courses: [], listError: failure.message };
  }
  const studying = memberships.filter((course) => course.memberRole === 'student');
  const teachingCount = memberships.filter((course) => course.memberRole !== 'student').length;
  const courses = await mapInBatches(studying, BATCH, async (course) => {
    const [assignmentsResult, quizzesResult] = await Promise.allSettled([
      classes.assignments(course.id),
      classes.quizzes(course.id),
    ]);
    const assignmentError =
      assignmentsResult.status === 'rejected'
        ? courseGradeFailure(assignmentsResult.reason, options)
        : null;
    const quizError =
      quizzesResult.status === 'rejected' ? courseGradeFailure(quizzesResult.reason, options) : null;
    if (assignmentsResult.status === 'rejected' && quizzesResult.status === 'rejected') {
      return emptySection(course, assignmentError!.status, assignmentError!.message);
    }
    const items = sortGradeItems([
      ...(assignmentsResult.status === 'fulfilled'
        ? assignmentsResult.value.map((item) => gradeFromNuniAssignment(course, item))
        : []),
      ...(quizzesResult.status === 'fulfilled'
        ? quizzesResult.value.map((item) => gradeFromNuniQuiz(course, item))
        : []),
    ]);
    return {
      source: 'nuni' as const,
      courseId: course.id,
      courseName: course.title,
      href: `/classroom/course/${encodeURIComponent(course.id)}`,
      archived: course.state !== 'active',
      status: 'ready' as const,
      checkedAt: new Date().toISOString(),
      error: null,
      assignmentError: assignmentError ? GRADE_COPY.assignmentsFailed : null,
      quizError: quizError ? GRADE_COPY.quizzesFailed : null,
      items,
    };
  });
  return { teachingCount, courses, listError: null };
}

export function isNuniSessionError(error: unknown): boolean {
  return error instanceof NuniError && (error.status === 401 || error.code === 'SESSION_CHANGED');
}
