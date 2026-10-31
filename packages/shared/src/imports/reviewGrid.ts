import type { PersonalImportRow } from './types';
import { periodSlots, type PeriodProfileId } from '../timetable/schoolPeriods';
import { createPersonalImportId } from './records';

export const REVIEW_DAYS = ['一', '二', '三', '四', '五', '六', '日'];

export function reviewPeriods(rows: PersonalImportRow[], profile?: PeriodProfileId) {
  if (profile)
    return periodSlots(profile).map((slot) => ({ index: slot.index, label: slot.label }));
  const last = Math.min(
    99,
    Math.max(13, ...rows.flatMap((r) => [r.startPeriod || 0, r.endPeriod || 0])),
  );
  return Array.from({ length: last }, (_, i) => ({ index: i + 1, label: String(i + 1) }));
}

export function reviewCellRows(rows: PersonalImportRow[], day: number, period: number) {
  return rows.filter(
    (row) =>
      row.kind === 'timetable' &&
      row.dayOfWeek === day &&
      !!row.startPeriod &&
      row.startPeriod <= period &&
      (row.endPeriod ?? row.startPeriod) >= period,
  );
}

/** Each resulting row owns its own period and can be corrected independently. */
export function splitReviewRow(
  row: PersonalImportRow,
  profile?: PeriodProfileId,
): PersonalImportRow[] {
  const start = row.startPeriod;
  const end = row.endPeriod;
  if (
    !start ||
    !end ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    end <= start ||
    end > 99
  )
    return [row];
  return Array.from({ length: end - start + 1 }, (_, offset) => {
    const period = start + offset;
    const slot = profile ? periodSlots(profile)[period - 1] : undefined;
    return {
      ...row,
      id: offset === 0 ? row.id : createPersonalImportId(),
      startPeriod: period,
      endPeriod: period,
      periodLabel: undefined,
      startTime: slot?.start,
      endTime: slot?.end,
    };
  });
}

/** Only adjacent matching classes can be merged, preserving their course metadata. */
export function nextReviewRow(rows: PersonalImportRow[], row: PersonalImportRow) {
  if (!row.startPeriod || !row.dayOfWeek || (row.endPeriod ?? row.startPeriod) < row.startPeriod)
    return undefined;
  return rows.find(
    (next) =>
      next.id !== row.id &&
      next.kind === 'timetable' &&
      next.startPeriod === (row.endPeriod ?? row.startPeriod ?? 0) + 1 &&
      [
        'schoolId',
        'title',
        'dayOfWeek',
        'academicYear',
        'semester',
        'location',
        'teacher',
        'courseCode',
        'className',
        'linkedCourseId',
      ].every(
        (key) => next[key as keyof PersonalImportRow] === row[key as keyof PersonalImportRow],
      ),
  );
}
