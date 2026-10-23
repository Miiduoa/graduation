import { createNuniClasses, type NuniTransport } from '@campus/shared/src/nuni';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import type { HomeData, HomeFeedback, HomeMaterial, HomeTask } from './homeOverview';
import { courseMaterialHref, MATERIAL_HOME_WINDOW_MS } from './courseMaterials';

const FEEDBACK_LIMIT = 8;

function sortFeedback(rows: HomeFeedback[]): HomeFeedback[] {
  return rows
    .sort(
      (a, b) =>
        (b.reviewedAt ? parseTaipeiInstant(b.reviewedAt) ?? 0 : 0) -
        (a.reviewedAt ? parseTaipeiInstant(a.reviewedAt) ?? 0 : 0),
    )
    .slice(0, FEEDBACK_LIMIT);
}

export async function loadNuniHomeData(
  transport: NuniTransport,
  platformAccountId: string,
): Promise<HomeData> {
  const classes = createNuniClasses(transport, platformAccountId);
  const memberships = await classes.list();
  const active = memberships.filter((course) => course.state === 'active');
  const courses = active.map((course) => ({
    id: course.id,
    name: course.title,
    role: course.memberRole,
    unreadCount: 0,
    href: `/classroom/course/${encodeURIComponent(course.id)}`,
  }));
  const tasks: HomeTask[] = [];
  const recentFeedback: HomeFeedback[] = [];
  const materials: HomeMaterial[] = [];
  const since = Date.now() - MATERIAL_HOME_WINDOW_MS;
  // Bound requests when an account belongs to many courses. A failed course read
  // rejects the overview so an incomplete list never claims all work is done.
  // Four at a time keeps the home first screen inside a couple of seconds for a
  // typical student without opening every course in one burst.
  const studying = courses.filter((course) => course.role === 'student');
  const batchSize = 4;
  for (let start = 0; start < studying.length; start += batchSize) {
    const batch = await Promise.all(
      studying.slice(start, start + batchSize).map(async (course) => {
        const [assignments, quizzes, courseMaterials] = await Promise.all([
          classes.assignments(course.id),
          classes.quizzes(course.id),
          classes.materials(course.id),
        ]);
        const assignmentTasks: HomeTask[] = [];
        for (const assignment of assignments) {
          const href = `${course.href}#assignment-${encodeURIComponent(assignment.id)}`;
          if (assignment.mySubmission?.teacherFeedback) {
            recentFeedback.push({
              kind: 'assignment',
              id: assignment.id,
              courseId: course.id,
              courseName: course.name,
              title: assignment.title,
              feedback: assignment.mySubmission.teacherFeedback,
              score: null,
              reviewedAt: assignment.mySubmission.reviewedAt,
              submittedAt: assignment.mySubmission.submittedAt,
              href,
            });
          }
          if (assignment.state === 'open' && !assignment.mySubmission) {
            assignmentTasks.push({
              kind: 'assignment',
              id: assignment.id,
              courseId: course.id,
              courseName: course.name,
              title: assignment.title,
              dueAt: assignment.dueAt,
              href,
              acceptsLate: true,
            });
          }
        }
        const quizTasks: HomeTask[] = [];
        for (const quiz of quizzes) {
          const href = `${course.href}#quiz-${encodeURIComponent(quiz.id)}`;
          if (quiz.myResponse?.teacherFeedback) {
            recentFeedback.push({
              kind: 'quiz',
              id: quiz.id,
              courseId: course.id,
              courseName: course.name,
              title: quiz.title,
              feedback: quiz.myResponse.teacherFeedback,
              score: null,
              reviewedAt: quiz.myResponse.reviewedAt,
              submittedAt: quiz.myResponse.submittedAt,
              href,
            });
          }
          if (quiz.state === 'open' && !quiz.myResponse) {
            quizTasks.push({
              kind: 'quiz',
              id: quiz.id,
              courseId: course.id,
              courseName: course.name,
              title: quiz.title,
              dueAt: quiz.dueAt,
              href,
              acceptsLate: true,
            });
          }
        }
        const recentMaterials: HomeMaterial[] = courseMaterials
          .filter((item) => {
            const created = Date.parse(item.createdAt);
            return Number.isFinite(created) && created >= since;
          })
          .map((item) => ({
            id: item.id,
            courseId: course.id,
            courseName: course.name,
            title: item.title,
            unitTitle: item.unitTitle,
            createdAt: item.createdAt,
            href: courseMaterialHref(course.id, item.id),
          }));
        return { work: [...assignmentTasks, ...quizTasks], materials: recentMaterials };
      }),
    );
    tasks.push(...batch.flatMap((entry) => entry.work));
    materials.push(...batch.flatMap((entry) => entry.materials));
  }
  tasks.sort(
    (first, second) =>
      (first.dueAt ? Date.parse(first.dueAt) : Infinity) -
      (second.dueAt ? Date.parse(second.dueAt) : Infinity),
  );
  materials.sort(
    (first, second) =>
      Date.parse(second.createdAt) - Date.parse(first.createdAt) ||
      first.title.localeCompare(second.title, 'zh-TW'),
  );
  return {
    courses,
    tasks,
    materials,
    recentFeedback: sortFeedback(recentFeedback),
    unreadCount: 0,
    archivedCount: memberships.length - active.length,
  };
}
