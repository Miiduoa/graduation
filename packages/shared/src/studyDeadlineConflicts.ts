import type { PersonalImportRecord } from './imports/types';
import { buildPersonalToday } from './imports/today';
import { classDate, validClassDate, validateClassException } from './timetable/classExceptions';
import type { NuniStudyTask } from './nuniStudyAgenda';
import { studyDeadline } from './studyAgendaCalendar';

/** Caller-owned, authorized snapshots only. Coverage is explicit; rows alone do not prove completeness. */
export type StudyDeadlineSource = {
  kind: 'timetable' | 'events';
  records: readonly PersonalImportRecord[];
  schoolId: string;
  termKey: string;
  /** Taiwan dates, inclusive. Omitted only for partial weekly templates with no proven term bounds. */
  start?: string;
  end?: string;
  status: 'complete' | 'partial' | 'unsynced';
};

export type StudyDeadlineConflict = {
  kind: StudyDeadlineSource['kind'];
  titles: string[];
  unknown: boolean;
};

/** Point deadline intersects [start, end); an event ending at the deadline does not overlap. */
export function studyDeadlineConflicts(
  task: NuniStudyTask,
  sources: readonly StudyDeadlineSource[] = [],
): StudyDeadlineConflict[] {
  const instant = studyDeadline(task);
  return (['timetable', 'events'] as const).map((kind) => {
    const titles = new Set<string>();
    let covered = false;
    let incomplete = false;
    if (instant === null) return { kind, titles: [], unknown: true };
    const date = classDate(new Date(instant));
    for (const source of sources.filter((item) => item.kind === kind)) {
      const inRange =
        source.start !== undefined &&
        source.end !== undefined &&
        validClassDate(source.start) &&
        validClassDate(source.end) &&
        source.start <= date &&
        date <= source.end;
      // Undated weekly templates can reveal possible clashes, but never prove date coverage.
      const weeklyTemplate =
        kind === 'timetable' &&
        source.status !== 'complete' &&
        source.start === undefined &&
        source.end === undefined;
      if (!inRange && !weeklyTemplate) continue;
      covered ||= inRange;
      incomplete ||= source.status !== 'complete';
      const rows = source.records.filter(
        (row) =>
          row.kind === kind &&
          row.schoolId === source.schoolId &&
          `${row.academicYear}|${row.semester}` === source.termKey,
      );
      if (kind === 'timetable') {
        for (const row of rows) {
          for (const exception of row.classExceptions ?? []) {
            try {
              validateClassException(exception);
            } catch {
              incomplete = true;
            }
          }
        }
        const result = buildPersonalToday(rows, {
          schoolId: source.schoolId,
          termKey: source.termKey,
          now: new Date(instant),
        });
        incomplete ||= result.unplacedCount > 0;
        for (const entry of result.today) {
          if (entry.startAt <= instant && instant < entry.endAt) titles.add(entry.row.title);
        }
      } else {
        for (const row of rows) {
          if (
            !row.date ||
            !validClassDate(row.date) ||
            (row.endDate !== undefined && !validClassDate(row.endDate))
          ) {
            incomplete = true;
            continue;
          }
          const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
          if (!row.allDay && (!clock.test(row.startTime ?? '') || !clock.test(row.endTime ?? ''))) {
            incomplete = true;
            continue;
          }
          const start = Date.parse(`${row.date}T${row.allDay ? '00:00' : row.startTime}:00+08:00`);
          const end = row.allDay
            ? row.endDate
              ? Date.parse(`${row.endDate}T00:00:00+08:00`)
              : start + 86400000
            : Date.parse(`${row.endDate || row.date}T${row.endTime}:00+08:00`);
          if (!Number.isFinite(end) || end <= start) {
            incomplete = true;
            continue;
          }
          if (start <= instant && instant < end) titles.add(row.title);
        }
      }
    }
    return { kind, titles: [...titles], unknown: !covered || incomplete };
  });
}

/** Shared preview copy keeps both clients consistent, including known conflicts in partial snapshots. */
export function studyDeadlineConflictText(
  task: NuniStudyTask,
  sources?: readonly StudyDeadlineSource[],
): string {
  return studyDeadlineConflicts(task, sources)
    .map(({ kind, titles, unknown }) => {
      const label = kind === 'timetable' ? '課表' : '個人事件';
      const conflict = titles.length ? `與${label}衝突：${titles.join('、')}` : '';
      const status = unknown ? `${label}未知（無覆蓋、來源不完整或未同步）` : '';
      const template =
        kind === 'timetable' &&
        sources?.some(
          (source) =>
            source.kind === kind &&
            source.start === undefined &&
            source.end === undefined &&
            source.status !== 'complete',
        )
          ? '課表衝突依每週時段推估，實際開課日期待確認'
          : '';
      return (
        [conflict, status, template].filter(Boolean).join('；') || `${label}：已載入範圍內無衝突`
      );
    })
    .join('；');
}

/** Local imports have no completeness/term-boundary metadata. Never invent full-term coverage. */
export function personalImportDeadlineSources(
  records: readonly PersonalImportRecord[],
  schoolId: string,
): StudyDeadlineSource[] {
  return records.flatMap((row): StudyDeadlineSource[] => {
    if (row.schoolId !== schoolId || (row.kind !== 'timetable' && row.kind !== 'events')) return [];
    const record: PersonalImportRecord = {
      ...row,
      source: {
        type: row.source?.type ?? 'paste',
        line: row.source?.line ?? 1,
        rawText: '',
      },
    };
    delete record.grade;
    const base = {
      kind: row.kind,
      records: [record],
      schoolId,
      termKey: `${row.academicYear}|${row.semester}`,
      status: 'partial' as const,
    };
    if (row.kind === 'timetable') return [base];
    if (!row.date || !validClassDate(row.date)) return [];
    // Only the event's explicit dates are known; gaps between records are not coverage.
    return [{ ...base, start: row.date, end: row.endDate || row.date }];
  });
}
