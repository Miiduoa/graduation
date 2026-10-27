import { isPeriodProfileId, periodLabelAt, periodTimes, slotIndexForLabel, type PeriodProfileId } from '../timetable/periods';
import type { ImportIssue, PersonalImportRow } from './types';
import { personalImportKey } from './records';
import { mapPersonalImportPeriods, normalizePersonalImportText, validatePersonalImportRow } from './validation';

export type PortalRowDraft = {
  title: string; academicYear: string; semester: string; courseCode: string;
  teacher: string; className: string; location: string; credits: string; grade: string;
  dayOfWeek: string; startPeriod: string; endPeriod: string;
  periodLabel: string; startTime: string; endTime: string;
};
export type PortalRowEditResult =
  | { ok: true; row: PersonalImportRow; issues: ImportIssue[] }
  | { ok: false; issues: ImportIssue[] };
const optional = (value: string) => normalizePersonalImportText(value) || undefined;
const valueOf = (value: unknown) => value === undefined || value === null ? '' : String(value);
const textFields = ['title', 'academicYear', 'semester', 'courseCode', 'teacher', 'className', 'location'] as const;

/** Draft only: never copy identity, course membership or source fields from user input. */
export function createPortalRowDraft(row: PersonalImportRow, profile?: PeriodProfileId): PortalRowDraft {
  const mapped = mapPersonalImportPeriods(row, { periodProfile: profile });
  const label = (value?: number) => value === undefined ? '' : isPeriodProfileId(profile) ? periodLabelAt(value, profile) : String(value);
  return {
    title: row.title, academicYear: row.academicYear, semester: row.semester,
    courseCode: row.courseCode ?? '', teacher: row.teacher ?? '', className: row.className ?? '',
    location: row.location ?? '', credits: valueOf(row.credits), grade: row.grade ?? '',
    dayOfWeek: valueOf(row.dayOfWeek), startPeriod: label(mapped.startPeriod), endPeriod: label(mapped.endPeriod),
    periodLabel: row.periodLabel ?? (row.startPeriod !== undefined && row.endPeriod !== undefined ? `${row.startPeriod}–${row.endPeriod}` : ''),
    startTime: row.startTime ?? '', endTime: row.endTime ?? '',
  };
}

export function applyPortalRowDraft(row: PersonalImportRow, draft: PortalRowDraft, profile?: PeriodProfileId): PortalRowEditResult {
  const issues: ImportIssue[] = [];
  const error = (field: keyof PersonalImportRow, message: string) => issues.push({
    code: 'portal-edit-invalid', rowId: row.id, severity: 'error' as const, field, message,
  });
  if (row.kind !== 'grades' && row.kind !== 'timetable') {
    error('kind', '此校務核對表單只支援課表與成績。');
    return { ok: false, issues };
  }
  // No spread of draft: even a malicious extra property cannot change the owner scope or source.
  const next: PersonalImportRow = { ...row };
  for (const key of textFields) {
    if (typeof draft[key] !== 'string') { error(key, '請使用文字欄位修正資料。'); continue; }
    if (key === 'title' || key === 'academicYear' || key === 'semester') next[key] = normalizePersonalImportText(draft[key]);
    else next[key] = optional(draft[key]);
  }
  const credits = typeof draft.credits === 'string' ? normalizePersonalImportText(draft.credits) : '';
  if (typeof draft.credits !== 'string') error('credits', '請使用文字欄位修正學分。');
  else if (!credits) next.credits = undefined;
  else if (!/^\d+(?:\.\d+)?$/.test(credits) || !Number.isFinite(Number(credits)) || Number(credits) > 40) {
    error('credits', '學分請填 0 至 40 的數字；不要使用科學記號或逗號。');
  } else next.credits = Number(credits);
  if (row.kind === 'grades') {
    if (typeof draft.grade !== 'string') error('grade', '請填寫原始成績。');
    else next.grade = optional(draft.grade);
  } else {
    const day = typeof draft.dayOfWeek === 'string' ? normalizePersonalImportText(draft.dayOfWeek) : '';
    if (!/^[1-7]$/.test(day)) error('dayOfWeek', '星期請填 1 至 7，星期日為 7。');
    else next.dayOfWeek = Number(day);
    if (isPeriodProfileId(profile)) {
      const start = typeof draft.startPeriod === 'string' ? slotIndexForLabel(normalizePersonalImportText(draft.startPeriod), profile) : undefined;
      const end = typeof draft.endPeriod === 'string' ? slotIndexForLabel(normalizePersonalImportText(draft.endPeriod), profile) : undefined;
      if (!start) error('startPeriod', '請選擇此校的有效開始節次。');
      if (!end) error('endPeriod', '請選擇此校的有效結束節次。');
      if (start && end) {
        next.startPeriod = start; next.endPeriod = end;
        next.periodLabel = `${periodLabelAt(start, profile)}–${periodLabelAt(end, profile)}`;
        // An explicit form application chooses the school's period times, not a nearby guess.
        const times = periodTimes(profile);
        next.startTime = times[start - 1]?.[0]; next.endTime = times[end - 1]?.[1];
      }
    } else {
      next.startPeriod = undefined; next.endPeriod = undefined;
      for (const key of ['periodLabel', 'startTime', 'endTime'] as const) {
        if (typeof draft[key] !== 'string') { error(key, '請使用文字欄位修正時間。'); continue; }
        next[key] = optional(draft[key]);
      }
    }
  }
  issues.push(...validatePersonalImportRow(next, { periodProfile: profile }));
  return issues.some((issue) => issue.severity === 'error') ? { ok: false, issues } : { ok: true, row: next, issues };
}

/** Remove only errors now answered by a validated form; preserve structural and school errors. */
export function reconcilePortalRowIssues(
  issues: ImportIssue[], before: PersonalImportRow, after: PersonalImportRow, profile?: PeriodProfileId,
): ImportIssue[] {
  const oldValidation = validatePersonalImportRow(before, { periodProfile: profile });
  const handled = new Set<keyof PersonalImportRow>([
    ...textFields, 'credits', ...(after.kind === 'grades' ? ['grade'] as const :
      ['dayOfWeek', 'startPeriod', 'endPeriod', 'periodLabel', 'startTime', 'endTime'] as const),
  ]);
  return issues.filter((issue) => {
    if (issue.rowId !== before.id) return true;
    if (issue.code === 'unrecognized-field' && issue.field && handled.has(issue.field)) return false;
    return !oldValidation.some((old) => old.code === issue.code && old.field === issue.field);
  });
}

export function portalReviewIssues(rows: PersonalImportRow[], parsed: ImportIssue[], profile?: PeriodProfileId): ImportIssue[] {
  const duplicates: ImportIssue[] = [];
  const keys = new Set<string>();
  for (const row of rows) {
    const key = personalImportKey(row);
    if (keys.has(key)) duplicates.push({ code: 'duplicate-row', severity: 'warning', rowId: row.id,
      message: '這筆資料與前面的資料重複，匯入時只會保留一筆。' });
    keys.add(key);
  }
  return [...new Map([...parsed.filter((issue) => issue.code !== 'duplicate-row'), ...duplicates,
    ...rows.flatMap((row) => validatePersonalImportRow(row, { periodProfile: profile }))]
    .map((issue) => [JSON.stringify(issue), issue])).values()];
}
