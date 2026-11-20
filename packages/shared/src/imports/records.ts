import type {
  ImportIssue,
  PersonalImportCatalogCourse,
  PersonalImportOptions,
  PersonalImportRecord,
  PersonalImportRow,
} from './types';
import {
  isPersonalImportDate,
  mapPersonalImportPeriods,
  normalizePersonalImportText,
  validatePersonalImportRow,
} from './validation';

let nextImportId = 0;
export function createPersonalImportId(): string {
  // Works in browsers and React Native without requiring a crypto polyfill.
  nextImportId += 1;
  return `import-${Date.now().toString(36)}-${nextImportId.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
const normalized = (value: unknown) =>
  typeof value === 'string'
    ? normalizePersonalImportText(value).replace(/\s+/g, ' ').toLowerCase()
    : (value ?? '');

/** Canonical personal identity: source name, random IDs and OCR formatting do not create duplicates. */
export function personalImportKey(row: PersonalImportRow): string {
  const common = [
    row.kind,
    row.schoolId,
    row.academicYear,
    row.semester,
    row.courseCode || row.title,
    row.teacher,
    row.className,
  ].map(normalized);
  let eventEnd = row.endDate || row.date;
  if (row.allDay && !row.endDate && row.date && isPersonalImportDate(row.date)) {
    const nextDay = new Date(`${row.date}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    eventEnd = nextDay.toISOString().slice(0, 10);
  }
  const specific =
    row.kind === 'timetable'
      ? [
          row.dayOfWeek,
          row.startPeriod,
          row.endPeriod,
          row.periodLabel,
          row.startPeriod ? '' : row.startTime,
          row.endPeriod ? '' : row.endTime,
        ]
      : row.kind === 'events'
        ? [row.date, row.startTime, eventEnd, row.endTime, !!row.allDay]
        : [];
  return JSON.stringify([...common, ...specific.map(normalized)]);
}

export function planPersonalImport(
  existing: readonly PersonalImportRecord[],
  incoming: readonly PersonalImportRow[],
  options: {
    batchId: string;
    importedAt: string;
    periodProfile?: NonNullable<PersonalImportOptions['periodProfile']>;
  },
): {
  records: PersonalImportRecord[];
  added: PersonalImportRecord[];
  duplicates: PersonalImportRow[];
  issues: ImportIssue[];
} {
  const issues: ImportIssue[] = [];
  const duplicates: PersonalImportRow[] = [];
  const added: PersonalImportRecord[] = [];
  const byKey = new Map(existing.map((row) => [personalImportKey(row), row]));
  const ids = new Set(existing.map((row) => row.id));
  if (!options.batchId.trim() || !Number.isFinite(Date.parse(options.importedAt)))
    issues.push({
      code: 'invalid-batch',
      severity: 'error',
      message: '匯入批次資訊無效，請重新匯入。',
    });
  if (existing.some((row) => row.batchId === options.batchId))
    issues.push({
      code: 'reused-batch',
      severity: 'error',
      message: '這個匯入批次已使用，請重新建立批次。',
    });
  for (const incomingRow of incoming) {
    const row = mapPersonalImportPeriods(incomingRow, options);
    issues.push(...validatePersonalImportRow(row, options));
    const key = personalImportKey(row);
    const previous = byKey.get(key);
    if (previous) {
      if (
        row.kind === 'grades' &&
        (normalized(previous.grade) !== normalized(row.grade) || previous.credits !== row.credits)
      )
        issues.push({
          code: 'grade-conflict',
          severity: 'error',
          rowId: row.id,
          field: 'grade',
          message: '同一學期已有這門課，但成績或學分不同。請先核對原有資料，這次不會覆蓋。',
        });
      else {
        duplicates.push(row);
        const metadataChanged =
          normalized(previous.location) !== normalized(row.location) ||
          normalized(previous.title) !== normalized(row.title) ||
          normalized(previous.linkedCourseId) !== normalized(row.linkedCourseId);
        issues.push({
          code: metadataChanged ? 'duplicate-metadata-conflict' : 'duplicate-row',
          severity: 'warning',
          rowId: row.id,
          message: metadataChanged
            ? '已有相同課程或活動，但名稱、地點或課班連結不同；已保留原有資料，請另外核對這些差異。'
            : '已有相同資料，這筆不會重複加入。',
        });
      }
      continue;
    }
    if (ids.has(row.id)) {
      issues.push({
        code: 'duplicate-id',
        severity: 'error',
        rowId: row.id,
        message: '資料識別碼重複，請重新建立草稿。',
      });
      continue;
    }
    const record: PersonalImportRecord = {
      ...row,
      source: { ...row.source },
      batchId: options.batchId,
      importedAt: options.importedAt,
    };
    byKey.set(key, record);
    ids.add(row.id);
    added.push(record);
  }
  if (issues.some((issue) => issue.severity === 'error'))
    return { records: [...existing], added: [], duplicates, issues };
  return { records: [...existing, ...added], added, duplicates, issues };
}

/** Imported records are immutable. Undo removes only records owned by the selected batch. */
export function undoPersonalImportBatch(
  existing: readonly PersonalImportRecord[],
  batchId: string,
): PersonalImportRecord[] {
  return existing.filter((row) => row.batchId !== batchId);
}

export function resolvePersonalImportCourse(
  row: PersonalImportRow,
  catalog: readonly PersonalImportCatalogCourse[],
): {
  status: 'linked' | 'suggestions' | 'unmatched';
  linkedCourseId?: string;
  suggestions: PersonalImportCatalogCourse[];
} {
  if (
    ![row.schoolId, row.academicYear, row.semester].every(
      (value) => typeof value === 'string' && value.trim(),
    )
  )
    return { status: 'unmatched', suggestions: [] };
  const scoped = catalog.filter(
    (course) =>
      course.verified &&
      normalized(course.schoolId) === normalized(row.schoolId) &&
      normalized(course.academicYear) === normalized(row.academicYear) &&
      normalized(course.semester) === normalized(row.semester),
  );
  const exact = row.courseCode?.trim()
    ? scoped.filter((course) => normalized(course.courseCode) === normalized(row.courseCode))
    : [];
  const exactMatch = exact.length === 1 ? exact[0] : undefined;
  if (exactMatch) {
    const contradictory =
      (row.teacher?.trim() && normalized(row.teacher) !== normalized(exactMatch.teacher)) ||
      (row.className?.trim() && normalized(row.className) !== normalized(exactMatch.className));
    if (!contradictory) return { status: 'linked', linkedCourseId: exactMatch.id, suggestions: [] };
  }
  // A shared course code can describe multiple sections. Even teacher/name matches require confirmation.
  const suggestions = exact.length
    ? exact
    : scoped.filter(
        (course) =>
          normalized(course.title) === normalized(row.title) &&
          !!row.teacher?.trim() &&
          normalized(course.teacher) === normalized(row.teacher),
      );
  return { status: suggestions.length ? 'suggestions' : 'unmatched', suggestions };
}
