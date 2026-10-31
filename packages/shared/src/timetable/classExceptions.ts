import type { PersonalImportRecord } from '../imports/types';

export type ClassException = {
  id: string;
  courseKey: string;
  originalDate: string;
  kind: 'cancel' | 'move' | 'room';
  date?: string;
  startTime?: string;
  endTime?: string;
  endDate?: string;
  location?: string;
  createdAt: string;
  original: PersonalImportRecord;
};

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
export function classMeetingKey(row: PersonalImportRecord): string {
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

export function validateClassException(value: ClassException): void {
  const clock = (text?: string) => !!text && /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
  if (
    !value.id ||
    !validClassDate(value.originalDate) ||
    !value.original ||
    value.courseKey !== classMeetingKey(value.original) ||
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

/** Retains the source snapshot even when reimport changes or removes the matching meeting. */
export function withClassExceptions(
  records: readonly PersonalImportRecord[],
  exceptions: readonly ClassException[] = [],
): PersonalImportRecord[] {
  return records.map((row) => ({
    ...row,
    classExceptions: exceptions.filter(
      (item) =>
        item.courseKey === classMeetingKey(row) ||
        ((row.id.startsWith('manual:') || item.original.id.startsWith('manual:')) &&
          row.schoolId === item.original.schoolId &&
          row.academicYear === item.original.academicYear &&
          row.semester === item.original.semester &&
          row.title === item.original.title &&
          (row.teacher || '') === (item.original.teacher || '') &&
          (row.location || '') === (item.original.location || '') &&
          row.dayOfWeek === item.original.dayOfWeek &&
          row.startPeriod === item.original.startPeriod &&
          row.endPeriod === item.original.endPeriod &&
          row.startTime === item.original.startTime &&
          row.endTime === item.original.endTime),
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
        (item.courseKey === value.courseKey && item.originalDate === value.originalDate),
    )
  )
    throw new Error('已達 200 筆調整，請先整理不再需要的紀錄。');
  return [
    ...existing.filter(
      (item) =>
        item.id !== value.id &&
        !(item.courseKey === value.courseKey && item.originalDate === value.originalDate),
    ),
    value,
  ];
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
  for (const item of value) {
    if (!item || typeof item !== 'object' || !item.original?.source || typeof item.original.id !== 'string')
      throw new Error('單次調整的來源資料不完整，請保留原始課表後重試。');
    validateClassException(item as ClassException);
  }
}
