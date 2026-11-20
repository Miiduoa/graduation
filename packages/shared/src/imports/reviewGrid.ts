import type { PersonalImportRow } from './types';
import { periodSlots, type PeriodProfileId } from '../timetable/schoolPeriods';
import { createPersonalImportId } from './records';

export const REVIEW_SPLIT_UNAVAILABLE =
  '此學校尚未設定節次時間表，無法可靠拆分；已保留原課程與手填時間，請逐筆新增單節課程並核對時間。';

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

function coversPeriod(row: PersonalImportRow, period: number) {
  return (
    !!row.startPeriod && row.startPeriod <= period && (row.endPeriod ?? row.startPeriod) >= period
  );
}

export function reviewCellRows(rows: PersonalImportRow[], day: number, period: number) {
  return rows.filter(
    (row) => row.kind === 'timetable' && row.dayOfWeek === day && coversPeriod(row, period),
  );
}

/** Keep clock-only and incomplete entries reachable even when no grid cell can display them. */
export function rowsOutsideReviewGrid(
  rows: PersonalImportRow[],
  periods: { index: number; label: string }[],
) {
  return rows
    .filter(
      (row) =>
        row.kind === 'timetable' &&
        (!REVIEW_DAYS[(row.dayOfWeek ?? 0) - 1] ||
          !periods.some((period) => coversPeriod(row, period.index))),
    )
    .map((row) => {
      const day = REVIEW_DAYS[(row.dayOfWeek ?? 0) - 1];
      const label = (index: number) =>
        periods.find((period) => period.index === index)?.label ?? String(index);
      let time = row.periodLabel?.trim();
      if (row.startTime || row.endTime) {
        time = `${row.startTime || '開始待補'}–${row.endTime || '結束待補'}`;
      } else if (!time && row.startPeriod) {
        time =
          row.endPeriod && row.endPeriod !== row.startPeriod
            ? `第 ${label(row.startPeriod)}–${label(row.endPeriod)} 節`
            : `第 ${label(row.startPeriod)} 節`;
      }
      return {
        row,
        detail: [day ? `星期${day}` : '星期待補', time || '時段待補', row.location]
          .filter(Boolean)
          .join(' · '),
      };
    });
}

/** Each resulting row owns its own period and can be corrected independently. */
export function splitReviewRow(
  row: PersonalImportRow,
  profile?: PeriodProfileId,
): PersonalImportRow[] {
  const start = row.startPeriod;
  const end = row.endPeriod;
  if (
    !profile ||
    !start ||
    start < 1 ||
    !end ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    end <= start ||
    end > 99 ||
    !periodSlots(profile)
      .slice(start - 1, end)
      .every((slot) => slot?.start && slot?.end) ||
    end > periodSlots(profile).length
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
  if (
    !rows.some((item) => item.id === row.id) ||
    !row.startPeriod ||
    !row.dayOfWeek ||
    (row.endPeriod ?? row.startPeriod) < row.startPeriod
  )
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
