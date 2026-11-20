import type { PersonalCourse } from '@campus/shared';

type CourseField = 'name' | 'day' | 'start' | 'end';
export type CourseIssues = Partial<Record<CourseField, string>>;

function validPeriod(value: number, periodCount: number) {
  return Number.isInteger(value) && value >= 1 && value <= periodCount;
}

export function validateCourseDraft(course: PersonalCourse, periodCount: number, weekdayCount: number): CourseIssues {
  const issues: CourseIssues = {};
  if (!course.name.trim()) issues.name = '請填寫課程名稱。';
  else if (course.name.length > 100) issues.name = '課程名稱請控制在 100 字以內。';
  if (!Number.isInteger(course.day) || course.day < 0 || course.day > weekdayCount) {
    issues.day = '請選擇有效的上課日，或選擇未排定。';
  }
  if (course.day === 0) return issues;
  if (!validPeriod(course.start, periodCount)) issues.start = `請選擇第 1～${periodCount} 節。`;
  if (!validPeriod(course.end, periodCount)) issues.end = `請選擇第 1～${periodCount} 節。`;
  else if (!issues.start && course.end < course.start) issues.end = '結束節次不能早於開始節次。';
  return issues;
}

export function isPlacedCourse(course: PersonalCourse, periodCount: number, weekdayCount: number): boolean {
  return Number.isInteger(course.day) && course.day >= 1 && course.day <= weekdayCount &&
    validPeriod(course.start, periodCount) && validPeriod(course.end, periodCount) && course.end >= course.start;
}

export function coursesAtSlot(courses: PersonalCourse[], day: number, period: number, periodCount: number, weekdayCount: number) {
  return courses.filter((course) => isPlacedCourse(course, periodCount, weekdayCount) &&
    course.day === day && course.start <= period && course.end >= period);
}

export function draftConflicts(course: PersonalCourse, courses: PersonalCourse[], periodCount: number, weekdayCount: number) {
  if (!isPlacedCourse(course, periodCount, weekdayCount)) return [];
  return courses.filter((other) => other.id !== course.id && isPlacedCourse(other, periodCount, weekdayCount) &&
    other.day === course.day && other.start <= course.end && other.end >= course.start);
}

export function hasCourseChanges(initial: PersonalCourse, current: PersonalCourse): boolean {
  return initial.name !== current.name || initial.day !== current.day || initial.start !== current.start ||
    initial.end !== current.end || initial.teacher !== current.teacher || initial.room !== current.room;
}
