import type { PersonalCourse } from '@campus/shared';
import { isPlacedCourse } from './courseEditorModel';

export type CourseMove =
  | { ok: true; course: PersonalCourse; changed: boolean }
  | { ok: false; message: string };

/** Move a whole course, never silently shorten it to fit the last period. */
export function moveCourseToSlot(
  course: PersonalCourse,
  day: number,
  start: number,
  periodCount: number,
  weekdayCount: number,
): CourseMove {
  if (!isPlacedCourse(course, periodCount, weekdayCount)) {
    return { ok: false, message: '這門課的時間還不完整，請先開啟課程補上時間。' };
  }
  if (!Number.isInteger(day) || day < 1 || day > weekdayCount || !Number.isInteger(start) || start < 1) {
    return { ok: false, message: '請選擇課表內的上課時段。' };
  }
  const end = start + course.end - course.start;
  if (end > periodCount) {
    return { ok: false, message: `這門課有 ${course.end - course.start + 1} 節，這個位置放不下；請往前選擇時段。` };
  }
  return { ok: true, course: { ...course, day, start, end }, changed: course.day !== day || course.start !== start };
}

export function planningReadiness(courses: PersonalCourse[], periodCount: number, weekdayCount: number) {
  const pending = courses.filter((course) => !isPlacedCourse(course, periodCount, weekdayCount)).length;
  return {
    ready: courses.length > 0 && pending === 0,
    message: courses.length === 0
      ? '還沒有課程資料，不能把空白課表當成整天有空。先新增或匯入課程，再安排時間。'
      : pending > 0
        ? `還有 ${pending} 門課的時間不完整。請先到「待排時間」補齊，再計算空堂或安排邀約。`
        : '',
  };
}
