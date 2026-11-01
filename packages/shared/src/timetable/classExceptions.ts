import type { PersonalImportRecord } from '../imports/types';

import { periodProfileForSchool, periodTimes } from './schoolPeriods';
import type { ClassException } from '../imports/types';
export type { ClassException } from '../imports/types';

export function classDate(now: Date): string {
  return new Date(now.getTime() + 28800000).toISOString().slice(0, 10);
}

export function validClassDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00+08:00`)) &&
    classDate(new Date(`${value}T00:00:00+08:00`)) === value
  );
}

/** Identifies a meeting independently of import batch and generated row identifiers. */
function legacyClassMeetingKey(row: PersonalImportRecord): string {
  return JSON.stringify([
    row.schoolId,
    row.academicYear,
    row.semester,
    row.courseCode || row.title,
    row.teacher || '',
    row.className || '',
    row.dayOfWeek,
    row.startPeriod ?? row.startTime,
    row.endPeriod ?? row.endTime,
  ]);
}

export function classMeetingKey(row: PersonalImportRecord): string {
  const parts = JSON.parse(legacyClassMeetingKey(row)) as unknown[];
  const [start, end] = classMeetingTimes(row);
  parts[7] = start ?? row.startPeriod ?? row.startTime;
  parts[8] = end ?? row.endPeriod ?? row.endTime;
  return JSON.stringify(parts);
}

const sameText = (left?: string, right?: string) =>
  (left ?? '').trim().normalize('NFKC') === (right ?? '').trim().normalize('NFKC');

export function classMeetingTimes(row: PersonalImportRecord) {
  const profile = periodProfileForSchool(row.schoolId);
  const times = profile ? periodTimes(profile) : [];
  const explicit = !!(row.startTime || row.endTime);
  return [
    explicit ? row.startTime : times[(row.startPeriod ?? 0) - 1]?.[0],
    explicit ? row.endTime : times[(row.endPeriod ?? 0) - 1]?.[1],
  ] as const;
}

/** Same equivalence for exception attachment and manual/import display deduplication. */
export function sameClassMeeting(left: PersonalImportRecord, right: PersonalImportRecord): boolean {
  const [start, end] = classMeetingTimes(left);
  const [otherStart, otherEnd] = classMeetingTimes(right);
  return !!start && !!end && start === otherStart && end === otherEnd &&
    left.schoolId === right.schoolId && left.academicYear === right.academicYear &&
    left.semester === right.semester && left.dayOfWeek === right.dayOfWeek &&
    sameText(left.title, right.title) && sameText(left.teacher, right.teacher) &&
    sameText(left.location, right.location);
}

export function matchesClassException(row: PersonalImportRecord, original: PersonalImportRecord): boolean {
  return classMeetingKey(row) === classMeetingKey(original) ||
    ((row.id.startsWith('manual:') || original.id.startsWith('manual:')) && sameClassMeeting(row, original));
}

/** Only meeting identity and display fields; never copy imported source text or filenames. */
export function classExceptionOriginal(row: PersonalImportRecord): PersonalImportRecord {
  const result: PersonalImportRecord = {
    id: row.id, batchId: '', importedAt: '', kind: 'timetable',
    schoolId: row.schoolId, academicYear: row.academicYear, semester: row.semester,
    title: row.title, source: { type: 'paste', line: 1, rawText: '' },
  };
  for (const key of ['courseCode', 'teacher', 'className', 'location', 'dayOfWeek',
    'startPeriod', 'endPeriod', 'startTime', 'endTime'] as const) {
    if (row[key] !== undefined) Object.assign(result, { [key]: row[key] });
  }
  return result;
}

export function classExceptionsForStorage(values: readonly ClassException[]): ClassException[] {
  const result = values.map((item) => {
    const value: ClassException = {
      id: item.id, courseKey: item.courseKey, originalDate: item.originalDate,
      kind: item.kind, createdAt: item.createdAt, original: classExceptionOriginal(item.original),
    };
    for (const key of ['date', 'startTime', 'endTime', 'endDate', 'location'] as const) {
      if (item[key] !== undefined) value[key] = item[key];
    }
    return value;
  });
  assertClassExceptions(result);
  return result;
}

export function assertTimetableStorageSize(value: unknown): void {
  // Leave ample space for Firestore field names, indexes and serialization overhead.
  const bytes = encodeURIComponent(JSON.stringify(value)).replace(/%[A-F\d]{2}/g, 'x').length;
  if (bytes > 200_000) throw new Error('課表調整資料過大，請縮短內容或整理紀錄後重試。');
}

export function validateClassException(value: ClassException): void {
  const clock = (text?: string) => !!text && /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
  if (
    !value.id ||
    !validClassDate(value.originalDate) ||
    !value.original ||
    (value.courseKey !== classMeetingKey(value.original) && value.courseKey !== legacyClassMeetingKey(value.original)) ||
    !['cancel', 'move', 'room'].includes(value.kind)
  )
    throw new Error('請確認原上課日期與課程。');
  const weekday = new Date(`${value.originalDate}T12:00:00+08:00`).getUTCDay() || 7;
  if (weekday !== value.original.dayOfWeek) throw new Error('原上課日期與星期不符。');
  if (value.kind === 'room' && !value.location?.trim()) throw new Error('請填寫這次上課的教室。');
  if (value.kind === 'move') {
    if (
      !value.date ||
      !validClassDate(value.date) ||
      !clock(value.startTime) ||
      !clock(value.endTime)
    )
      throw new Error('請填寫補課日期與完整時間。');
    const endDate = value.endDate || value.date;
    const start = Date.parse(`${value.date}T${value.startTime}:00+08:00`);
    const end = Date.parse(`${endDate}T${value.endTime}:00+08:00`);
    if (!validClassDate(endDate) || end <= start || end - start > 86400000)
      throw new Error('結束時間須晚於開始時間，且不超過一天；跨日請填隔天日期。');
  }
}

/** Retains meeting identity when reimport changes or removes the matching meeting. */
export function withClassExceptions(
  records: readonly PersonalImportRecord[],
  exceptions: readonly ClassException[] = [],
): PersonalImportRecord[] {
  return records.map((row) => ({
    ...row,
    classExceptions: exceptions.filter(
      (item) =>
        matchesClassException(row, item.original),
    ),
  }));
}

export function saveClassException(
  existing: readonly ClassException[],
  value: ClassException,
): ClassException[] {
  validateClassException(value);
  if (
    existing.length >= 200 &&
    !existing.some(
      (item) =>
        item.id === value.id ||
        (matchesClassException(item.original, value.original) && item.originalDate === value.originalDate),
    )
  )
    throw new Error('已達 200 筆調整，請先整理不再需要的紀錄。');
  return classExceptionsForStorage([
    ...existing.filter(
      (item) =>
        item.id !== value.id &&
        !(matchesClassException(item.original, value.original) && item.originalDate === value.originalDate),
    ),
    value,
  ]);
}

export function manualClassRecords(timetable: {
  courses: import('./course').PersonalCourse[];
  schoolId: string;
  meta: { year: string; semester: string };
  updatedAt: string;
}): PersonalImportRecord[] {
  return timetable.courses.map((course) => ({
    id: `manual:${course.id}`,
    batchId: 'manual',
    importedAt: timetable.updatedAt,
    kind: 'timetable',
    schoolId: timetable.schoolId,
    academicYear: timetable.meta.year || '未填',
    semester: timetable.meta.semester || '未填',
    title: course.name,
    teacher: course.teacher,
    location: course.room,
    dayOfWeek: course.day,
    startPeriod: course.start,
    endPeriod: course.end,
    source: { type: 'paste', line: 1, rawText: '' },
  }));
}

export function classReminderPlan(
  entries: readonly {
    row: PersonalImportRecord;
    startAt: number;
    endAt: number;
    conflict: boolean;
  }[],
  now: number,
  minutesBefore = 10,
) {
  return entries
    .filter((entry) => entry.startAt - minutesBefore * 60000 > now)
    .map((entry) => ({
      courseId: entry.row.id,
      title: entry.row.title,
      location: entry.row.location || '',
      startAt: entry.startAt,
      endAt: entry.endAt,
      conflict: entry.conflict,
      remindAt: entry.startAt - minutesBefore * 60000,
    }));
}

export function previewClassException(
  records: readonly PersonalImportRecord[],
  exceptions: readonly ClassException[],
  value: ClassException,
): PersonalImportRecord[] | null {
  try {
    return withClassExceptions(records, saveClassException(exceptions, value));
  } catch {
    return null;
  }
}

export function assertClassExceptions(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 200) throw new Error('單次調整資料格式異常，請保留原始課表後重試。');
  assertTimetableStorageSize(value);
  for (const item of value) {
    if (!item || typeof item !== 'object' || !item.original?.source || typeof item.original.id !== 'string')
      throw new Error('單次調整的來源資料不完整，請保留原始課表後重試。');
    validateClassException(item as ClassException);
  }
}
