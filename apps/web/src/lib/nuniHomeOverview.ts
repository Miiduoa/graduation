import {
  createNuniClasses,
  NuniError,
  nuniErrorMessage,
  type NuniTransport,
} from '@campus/shared/src/nuni';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import type { HomeCourse, HomeData, HomeFeedback, HomeMaterial, HomeTask } from './homeOverview';
import {
  courseMaterialHref,
  MATERIAL_HOME_WINDOW_MS,
  toSearchableMaterial,
  type MaterialSearchSeed,
  type SearchableMaterial,
} from './courseMaterials';

export const HOME_MATERIALS_UNAVAILABLE = '教材暫時載入不了';

const FEEDBACK_LIMIT = 8;

function sortFeedback(rows: HomeFeedback[]): HomeFeedback[] {
  return rows
    .sort(
      (a, b) =>
        (b.reviewedAt ? (parseTaipeiInstant(b.reviewedAt) ?? 0) : 0) -
        (a.reviewedAt ? (parseTaipeiInstant(a.reviewedAt) ?? 0) : 0),
    )
    .slice(0, FEEDBACK_LIMIT);
}

type MaterialRead = {
  home: HomeMaterial[];
  searchable: SearchableMaterial[];
  sourceId: string | null;
  error: string | null;
  truncated: boolean;
  /** Legacy latest-100 is complete only when the cap was not hit. */
  seedComplete: boolean;
};

const emptyMaterialRead: MaterialRead = {
  home: [],
  searchable: [],
  sourceId: null,
  error: null,
  truncated: false,
  seedComplete: false,
};

function mergeMaterialReads(rows: MaterialRead[]): {
  materials: HomeMaterial[];
  materialsError: string | null;
  materialSearchSeed: MaterialSearchSeed;
} {
  const materials = rows.flatMap((row) => row.home);
  materials.sort(
    (first, second) =>
      Date.parse(second.createdAt) - Date.parse(first.createdAt) ||
      first.title.localeCompare(second.title, 'zh-TW'),
  );
  const error = rows.find((row) => row.error)?.error ?? null;
  const completeRows = rows.filter((row) => row.seedComplete && row.sourceId);
  return {
    materials,
    materialsError: error,
    materialSearchSeed: {
      // Truncated legacy reads stay on the home feed, but must not seed search as complete.
      items: completeRows.flatMap((row) => row.searchable),
      courseIds: completeRows.map((row) => row.sourceId!),
      truncated: rows.some((row) => row.truncated),
    },
  };
}

async function readCourseMaterials(
  classes: ReturnType<typeof createNuniClasses>,
  course: HomeCourse,
): Promise<MaterialRead> {
  try {
    const items = await classes.materials(course.id);
    const searchable = items.map((item) =>
      toSearchableMaterial({ id: course.id, title: course.name }, item),
    );
    const since = Date.now() - MATERIAL_HOME_WINDOW_MS;
    const home = items
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
    const truncated = items.length >= 100;
    return {
      home,
      searchable,
      sourceId: course.id,
      error: null,
      truncated,
      seedComplete: !truncated,
    };
  } catch (error) {
    if (error instanceof NuniError && [403, 404].includes(error.status)) {
      return emptyMaterialRead;
    }
    return { ...emptyMaterialRead, error: nuniErrorMessage(error) };
  }
}

export async function loadNuniHomeMaterials(
  transport: NuniTransport,
  platformAccountId: string,
  courses: HomeCourse[],
): Promise<{
  materials: HomeMaterial[];
  materialsError: string | null;
  materialSearchSeed: MaterialSearchSeed;
}> {
  const classes = createNuniClasses(transport, platformAccountId);
  const studying = courses.filter((course) => course.role === 'student');
  const rows: MaterialRead[] = [];
  const batchSize = 4;
  for (let start = 0; start < studying.length; start += batchSize) {
    rows.push(
      ...(await Promise.all(
        studying
          .slice(start, start + batchSize)
          .map((course) => readCourseMaterials(classes, course)),
      )),
    );
  }
  return mergeMaterialReads(rows);
}

export async function loadNuniHomeData(
  transport: NuniTransport,
  platformAccountId: string,
): Promise<HomeData> {
  return readNuniHomeData(transport, platformAccountId);
}

/** Homepage does not display materials; publish course navigation before pending work. */
export async function loadNuniHomeSections(
  transport: NuniTransport,
  platformAccountId: string,
  onCourses: (data: HomeData) => void,
): Promise<HomeData> {
  return readNuniHomeData(transport, platformAccountId, onCourses);
}

async function readNuniHomeData(
  transport: NuniTransport,
  platformAccountId: string,
  onCourses?: (data: HomeData) => void,
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
  onCourses?.({ courses, tasks: [], unreadCount: 0 });
  const tasks: HomeTask[] = [];
  let tasksError: string | null = null;
  const recentFeedback: HomeFeedback[] = [];
  const materialRows: MaterialRead[] = [];
  // Bound requests and retain successful sources. An incomplete read carries
  // an error so the overview cannot claim all work is done.
  const studying = courses.filter((course) => course.role === 'student');
  const batchSize = 4;
  for (let start = 0; start < studying.length; start += batchSize) {
    const batch = await Promise.all(
      studying.slice(start, start + batchSize).map(async (course) => {
        const [assignments, quizzes, materials] = await Promise.all([
          classes.assignments(course.id).catch((error) => {
            if (
              error instanceof NuniError &&
              (error.status === 401 ||
                error.code === 'SESSION_CHANGED' ||
                error.code === 'INVALID_RESPONSE')
            )
              throw error;
            tasksError = '部分作業還沒讀到，請重新讀取；已讀到的項目仍可查看。';
            return [];
          }),
          classes.quizzes(course.id).catch((error) => {
            if (
              error instanceof NuniError &&
              (error.status === 401 ||
                error.code === 'SESSION_CHANGED' ||
                error.code === 'INVALID_RESPONSE')
            )
              throw error;
            tasksError = '部分測驗還沒讀到，請重新讀取；已讀到的項目仍可查看。';
            return [];
          }),
          onCourses ? Promise.resolve(emptyMaterialRead) : readCourseMaterials(classes, course),
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
        return { work: [...assignmentTasks, ...quizTasks], materials };
      }),
    );
    tasks.push(...batch.flatMap((entry) => entry.work));
    materialRows.push(...batch.map((entry) => entry.materials));
  }
  tasks.sort(
    (first, second) =>
      (first.dueAt ? Date.parse(first.dueAt) : Infinity) -
      (second.dueAt ? Date.parse(second.dueAt) : Infinity),
  );
  const loaded = mergeMaterialReads(materialRows);
  return {
    courses,
    tasks,
    ...(tasksError ? { tasksError } : {}),
    ...loaded,
    recentFeedback: sortFeedback(recentFeedback),
    unreadCount: 0,
    archivedCount: memberships.length - active.length,
  };
}
