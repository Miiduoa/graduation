import type { SyncAllResult } from './puDataCache';

export type SchoolSyncItem = {
  key: 'timetable' | 'grades' | 'credits' | 'learning';
  title: string;
  source: string;
  state: 'received' | 'empty' | 'unavailable' | 'disabled';
  detail: string;
};

export type SchoolSyncSummary = { items: SchoolSyncItem[]; incomplete: boolean };

/** 每一項只根據本次完成讀取的回傳值，登入成功不等於全部來源同步成功。 */
export function buildSchoolSyncSummary(
  result: Partial<SyncAllResult> | null,
  learningEnabled: boolean,
): SchoolSyncSummary {
  const courses = result?.courses?.courses;
  const grades = result?.grades?.grades;
  const learning = result?.tcCourses;
  const item = (
    key: SchoolSyncItem['key'],
    title: string,
    source: string,
    rows: unknown[] | null | undefined,
    unit: string,
  ): SchoolSyncItem => ({
    key,
    title,
    source,
    state: !Array.isArray(rows) ? 'unavailable' : rows.length > 0 ? 'received' : 'empty',
    detail: !Array.isArray(rows)
      ? '尚未取得，請重新連線後再試'
      : rows.length > 0
        ? `已讀取 ${rows.length} ${unit}`
        : '已讀取，這次沒有資料',
  });
  const items: SchoolSyncItem[] = [
    item('timetable', '課表', 'E 校園', courses, '筆上課紀錄'),
    item('grades', '歷年成績', 'E 校園', grades, '筆成績'),
    result?.creditAudit
      ? {
          key: 'credits',
          title: '學分',
          source: 'E 校園學分試算表',
          state: 'received',
          detail: '已讀取學分資料，畢業資格仍以學校審核為準',
        }
      : {
          key: 'credits',
          title: '學分',
          source: '歷年修課紀錄',
          state: !Array.isArray(grades) ? 'unavailable' : grades.length > 0 ? 'received' : 'empty',
          detail: !Array.isArray(grades)
            ? '成績尚未取得，暫時無法試算'
            : grades.length > 0
              ? '可依修課紀錄試算，尚未取得校方完整畢業審核'
              : '尚無可用來試算的修課紀錄',
        },
    learningEnabled
      ? item('learning', '課程平台', '玩課雲', learning, '門課程')
      : {
          key: 'learning',
          title: '課程平台',
          source: '玩課雲',
          state: 'disabled',
          detail: '此版本尚未開啟課程平台連線',
        },
  ];
  return {
    items,
    incomplete: items.some((row) => row.state === 'unavailable' || row.state === 'disabled'),
  };
}
