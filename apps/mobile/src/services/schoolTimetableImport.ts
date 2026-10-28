import {
  createPersonalImportId,
  mapPersonalImportPeriods,
  PERSONAL_IMPORT_MAX_ROWS,
  validatePersonalImportRow,
  type PersonalImportRow,
} from '@campus/shared';
import type { PUCourse, PUCourseResult } from './puDirectScraper';

export type SchoolTimetableCoursePreview = {
  id: string;
  sourceIndex: number;
  course: PUCourse;
  row: PersonalImportRow;
  reasons: string[];
};

export type SchoolTimetablePreview = {
  sourceSemester: string | null;
  termKey: string | null;
  listedCredits: number;
  courses: SchoolTimetableCoursePreview[];
};

function schoolTerm(value: string | null): { academicYear: string; semester: string } | null {
  if (!value) return null;
  const text = value.normalize('NFKC').trim();
  const match = /^(\d{2,4})([1-3])$/.exec(text)
    ?? /^(\d{2,4})\s*[/-]\s*([1-3])$/.exec(text)
    ?? /^(\d{2,4})\s*學年度\s*第?\s*([1-3])\s*學期$/.exec(text);
  return match ? { academicYear: match[1], semester: match[2] } : null;
}

function assertCourse(value: unknown): asserts value is PUCourse {
  if (!value || typeof value !== 'object') throw new Error('校方課表格式不完整，請重新讀取。');
  const row = value as Record<string, unknown>;
  if (typeof row.name !== 'string' || !row.name.trim()
    || !Array.isArray(row.periods)
    || typeof row.credits !== 'number' || !Number.isFinite(row.credits) || row.credits < 0) {
    throw new Error('校方課程缺少名稱、節次或學分資訊，請重新讀取。');
  }
  for (const field of ['code', 'classOffered', 'nameEn', 'courseType', 'location', 'timePlaceRaw', 'teacherEmail', 'teacherName']) {
    if (row[field] !== undefined && row[field] !== null && typeof row[field] !== 'string')
      throw new Error('校方課程欄位格式不完整，請重新讀取。');
  }
  for (const field of ['startTime', 'endTime']) {
    if (row[field] !== undefined && row[field] !== null && typeof row[field] !== 'string')
      throw new Error('校方課程時間格式不完整，請重新讀取。');
  }
}

/** A reviewable personal copy. Keep every source row; missing evidence never becomes a default time. */
export function previewSchoolTimetable(result: PUCourseResult): SchoolTimetablePreview {
  if (!result || !Array.isArray(result.courses) || result.courses.length > PERSONAL_IMPORT_MAX_ROWS
    || typeof result.totalCredits !== 'number' || !Number.isFinite(result.totalCredits) || result.totalCredits < 0
    || result.semester !== null && typeof result.semester !== 'string') {
    throw new Error('校方課表格式或筆數不符，請重新讀取。');
  }
  const term = schoolTerm(result.semester);
  const courses = result.courses.map((course, index): SchoolTimetableCoursePreview => {
    assertCourse(course);
    const original = { ...course, periods: [...course.periods] };
    const id = createPersonalImportId();
    const reasons: string[] = [];
    if (!term) reasons.push('校方未提供可辨識的學期，請先核對來源學期。');
    if (!Number.isInteger(course.dayOfWeek) || course.dayOfWeek! < 1 || course.dayOfWeek! > 7)
      reasons.push('校方未提供可辨識的上課日，請依校方資料補齊後再帶入。');
    const periods = [...course.periods].sort((a, b) => a - b);
    const validPeriods = periods.length > 0 && periods.every((period, offset) =>
      Number.isInteger(period) && period >= 1 && period <= 13
      && (!offset || period === periods[offset - 1] + 1));
    if (periods.length && !validPeriods)
      reasons.push('原始節次不連續或無法辨識，請在個人匯入分開核對時段。');
    if (!periods.length && (!course.startTime || !course.endTime))
      reasons.push('校方尚未提供完整上課時間，原始資料保留在此。');
    const row = mapPersonalImportPeriods({
      id,
      kind: 'timetable',
      schoolId: 'pu',
      academicYear: term?.academicYear ?? '',
      semester: term?.semester ?? '',
      title: course.name,
      ...(course.code ? { courseCode: course.code } : {}),
      ...(course.classOffered ? { className: course.classOffered } : {}),
      ...(course.teacherName ? { teacher: course.teacherName } : {}),
      ...(course.location ? { location: course.location } : {}),
      credits: course.credits,
      ...(course.dayOfWeek !== null ? { dayOfWeek: course.dayOfWeek } : {}),
      ...(validPeriods ? { startPeriod: periods[0], endPeriod: periods[periods.length - 1] } : {}),
      // Bounds around a non-contiguous period list are not one meeting. Keep
      // them in source evidence, never prefill a continuous personal class.
      ...(!periods.length || validPeriods ? {
        ...(course.startTime ? { startTime: course.startTime } : {}),
        ...(course.endTime ? { endTime: course.endTime } : {}),
      } : {}),
      source: {
        type: 'paste',
        name: 'e 校園課表 · 本人學校連線',
        line: index + 1,
        rawText: JSON.stringify({ ...original, sourceSemester: result.semester }),
      },
    }, { periodProfile: 'pu' });
    if (!reasons.length) {
      reasons.push(...validatePersonalImportRow(row, { periodProfile: 'pu' })
        .filter((issue) => issue.severity === 'error').map((issue) => issue.message));
    }
    return { id, sourceIndex: index + 1, course: original, row, reasons: [...new Set(reasons)] };
  });
  return {
    sourceSemester: result.semester,
    termKey: term ? `${term.academicYear}|${term.semester}` : null,
    listedCredits: courses.reduce((total, item) => total + item.course.credits, 0),
    courses,
  };
}

export function schoolCourseTimeLabel(course: PUCourse): string {
  const day = Number.isInteger(course.dayOfWeek) && course.dayOfWeek! >= 1 && course.dayOfWeek! <= 7
    ? `週${'一二三四五六日'[course.dayOfWeek! - 1]}` : '上課日未提供';
  const clock = course.startTime && course.endTime ? `${course.startTime}–${course.endTime}` : '';
  const time = [course.periods.length ? `第 ${course.periods.join('、')} 節` : '', clock].filter(Boolean).join(' · ') || '時間未提供';
  return `${day} · ${time}`;
}
