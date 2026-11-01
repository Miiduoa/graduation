import {
  NuniError,
  type NuniMaterial,
  type NuniMaterialPage,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import {
  materialFailureMessage,
  readMaterialWithDeadline,
} from '@campus/shared/src/materialAccess';
import {
  appendMaterialPage,
  emptyMaterialPageProgress,
  type MaterialPageProgress,
} from './materialDiscovery';

export type SearchCourse = MaterialPageProgress<NuniMaterial> & {
  id: string;
  title: string;
  complete: boolean;
  error: string | null;
};
export type MaterialSearchClient = {
  list(): Promise<NuniWorkspace[]>;
  materialsPage(id: string, pageToken?: string): Promise<NuniMaterialPage>;
};
export async function startMaterialSearch(
  api: MaterialSearchClient,
  cancelled: () => boolean,
  progress?: (courses: SearchCourse[]) => void,
) {
  const courses = await readMaterialWithDeadline(api.list());
  if (cancelled()) return [];
  return readSearchRound(
    api,
    courses
      .filter((course) => course.state === 'active')
      .map((course) => ({
        ...emptyMaterialPageProgress<NuniMaterial>(),
        id: course.id,
        title: course.title,
        complete: false,
        error: null,
      })),
    cancelled,
    progress,
  );
}

export async function readSearchRound(
  api: MaterialSearchClient,
  courses: SearchCourse[],
  cancelled: () => boolean,
  progress?: (courses: SearchCourse[]) => void,
  onlyCourseId?: string,
  validateOnly = false,
): Promise<SearchCourse[]> {
  const next = courses.map((course) => ({ ...course }));
  const pending = next.filter(
    (course) => (validateOnly || !course.complete) && (!onlyCourseId || course.id === onlyCourseId),
  );
  const publish = () => {
    if (!cancelled()) progress?.(next.map((course) => ({ ...course })));
  };
  publish();
  for (let offset = 0; offset < pending.length; offset += 2) {
    if (cancelled()) return [];
    await Promise.all(
      pending.slice(offset, offset + 2).map(async (course) => {
        const restart = course.cycleDetected;
        const pageToken = validateOnly || restart ? undefined : (course.nextCursor ?? undefined);
        try {
          const page = await readMaterialWithDeadline(api.materialsPage(course.id, pageToken));
          if (cancelled()) return;
          if (validateOnly) {
            course.error = null;
            return;
          }
          const progress = appendMaterialPage(
            restart ? emptyMaterialPageProgress<NuniMaterial>() : course,
            page,
            pageToken,
          );
          Object.assign(course, progress, {
            complete: !progress.nextCursor && !progress.cycleDetected,
            error: progress.cycleDetected ? '教材分頁暫時卡住了，請重試這門課。' : null,
          });
        } catch (failure) {
          if (cancelled()) return;
          if (failure instanceof NuniError && [401, 403, 404].includes(failure.status))
            Object.assign(course, emptyMaterialPageProgress<NuniMaterial>(), { complete: false });
          if (
            failure instanceof NuniError &&
            failure.code === 'CLASS_WORKSPACE_MATERIAL_CURSOR_INVALID'
          )
            course.cycleDetected = true;
          course.complete = false;
          course.error = materialFailureMessage(failure);
        } finally {
          publish();
        }
      }),
    );
  }
  return cancelled() ? [] : next;
}

export function crossCourseSearchCopy(courses: SearchCourse[], count: number) {
  if (!courses.length) return '目前沒有可搜尋的課程，請加入未封存的課程。';
  const incomplete = courses.some((course) => !course.complete);
  if (incomplete) return `目前找到 ${count} 筆，還有課程尚未搜完。`;
  return count ? `找到 ${count} 筆教材。` : '這次搜尋沒有相符教材，換個關鍵字試試看。';
}
