import { describe, expect, it } from 'vitest';
import type { ImportIssue, PersonalImportRow } from '@campus/shared';
import { parsePersonalImport } from '@campus/shared';
import { periodTimes, slotIndexForLabel } from '@campus/shared/src/timetable/periods';
import { applyPortalRowDraft, createPortalRowDraft, portalReviewIssues, reconcilePortalRowIssues } from '@campus/shared/src/imports/portalRowReview';

const grade = (patch: Partial<PersonalImportRow> = {}): PersonalImportRow => ({
  id: 'original-id', kind: 'grades', schoolId: 'pu', title: '統計學', academicYear: '115', semester: '1', credits: 3,
  grade: '80', source: { type: 'paste', name: '校務網站', line: 2, rawText: '統計學,3,80' }, ...patch,
});
const course = (patch: Partial<PersonalImportRow> = {}): PersonalImportRow => grade({
  kind: 'timetable', title: '資料庫', dayOfWeek: 1, startPeriod: 3, endPeriod: 4,
  startTime: '10:10', endTime: '12:00', location: '主顧303', grade: undefined, ...patch,
});

describe('portal row form', () => {
  it('preserves zero credits and zero grade in both directions', () => {
    const row = grade({ credits: 0, grade: '0' });
    const draft = createPortalRowDraft(row);
    expect(draft.credits).toBe('0'); expect(draft.grade).toBe('0');
    const result = applyPortalRowDraft(row, draft);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row).toMatchObject({ credits: 0, grade: '0' });
  });
  it.each(['A+', '尚未公布', '通過'])('preserves original grade notation %s without conversion', (value) => {
    const row = grade(); const result = applyPortalRowDraft(row, { ...createPortalRowDraft(row), grade: value });
    expect(result.ok).toBe(true); if (result.ok) expect(result.row.grade).toBe(value);
  });
  it('does not turn empty numeric inputs into zero', () => {
    const row = grade();
    const result = applyPortalRowDraft(row, { ...createPortalRowDraft(row), credits: '' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.field === 'credits')).toBe(true);
  });
  it.each(['3O', '1e1', 'Infinity', '-1', '41', '1,5'])('rejects invalid credit input %s', (credits) => {
    const row = grade();
    expect(applyPortalRowDraft(row, { ...createPortalRowDraft(row), credits }).ok).toBe(false);
  });
  it('accepts explicit full-width decimal input', () => {
    const row = grade(); const result = applyPortalRowDraft(row, { ...createPortalRowDraft(row), credits: '１.５' });
    expect(result.ok).toBe(true); if (result.ok) expect(result.row.credits).toBe(1.5);
  });
  it('never accepts identity, school, authority or source fields from a draft', () => {
    const row = grade(); const draft = { ...createPortalRowDraft(row), id: 'evil', schoolId: 'ntu', kind: 'events', linkedCourseId: 'teacher', source: { rawText: 'changed' } };
    const result = applyPortalRowDraft(row, draft);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row).toMatchObject({ id: row.id, schoolId: 'pu', kind: 'grades' });
      expect(result.row.source).toBe(row.source); expect(result.row.linkedCourseId).toBeUndefined();
    }
  });
  it('does not mutate input or rewrite original evidence when applying a correction', () => {
    const row = grade(); const original = JSON.stringify(row);
    const result = applyPortalRowDraft(row, { ...createPortalRowDraft(row), title: '統計學修正', grade: '95' });
    expect(JSON.stringify(row)).toBe(original); expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.source.rawText).toBe('統計學,3,80');
  });
  it('maps school period labels rather than assuming numeric slot positions', () => {
    const row = course(); const result = applyPortalRowDraft(row, { ...createPortalRowDraft(row, 'pu'), startPeriod: '5', endPeriod: '6' }, 'pu');
    expect(result.ok).toBe(true);
    const start = slotIndexForLabel('5', 'pu')!, end = slotIndexForLabel('6', 'pu')!;
    if (result.ok) expect(result.row).toMatchObject({ startPeriod: start, endPeriod: end, startTime: periodTimes('pu')[start - 1][0], endTime: periodTimes('pu')[end - 1][1] });
  });
  it('requires valid school periods and does not guess a nearby slot', () => {
    const row = course();
    expect(applyPortalRowDraft(row, { ...createPortalRowDraft(row, 'pu'), startPeriod: '99' }, 'pu').ok).toBe(false);
  });
  it('retains original notation for schools without a configured period grid', () => {
    const row = course({ schoolId: 'other', startPeriod: undefined, endPeriod: undefined, periodLabel: 'N1–N2', startTime: undefined, endTime: undefined });
    const result = applyPortalRowDraft(row, createPortalRowDraft(row));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row).toMatchObject({ schoolId: 'other', periodLabel: 'N1–N2', startPeriod: undefined, startTime: undefined });
  });
  it('keeps a foreign numeric period range as source notation, not a Providence slot', () => {
    const row = course({ schoolId: 'other', startTime: undefined, endTime: undefined });
    const result = applyPortalRowDraft(row, createPortalRowDraft(row));
    expect(result.ok).toBe(true); if (result.ok) expect(result.row).toMatchObject({ periodLabel: '3–4', startPeriod: undefined, endPeriod: undefined });
  });
  it('rejects reversed times', () => {
    const row = course({ schoolId: 'other' });
    expect(applyPortalRowDraft(row, { ...createPortalRowDraft(row), startTime: '12:00', endTime: '10:00' }).ok).toBe(false);
  });
  it.each([6, 7])('preserves weekend day %s when reviewing a Providence course', (dayOfWeek) => {
    const row = course();
    const result = applyPortalRowDraft(row, { ...createPortalRowDraft(row, 'pu'), dayOfWeek: String(dayOfWeek) }, 'pu');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.dayOfWeek).toBe(dayOfWeek);
    expect(result.issues.some((issue) => issue.code === 'invalid-weekday')).toBe(false);
  });
  it.each(['0', '8'])('rejects day %s outside the seven-day timetable range', (dayOfWeek) => {
    const row = course();
    const result = applyPortalRowDraft(row, { ...createPortalRowDraft(row, 'pu'), dayOfWeek }, 'pu');
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.field === 'dayOfWeek')).toBe(true);
  });
  it('revalidates real parser errors after a malformed credit value is corrected', () => {
    const parsed = parsePersonalImport('課程名稱,學分,成績\n統計學,3O,90', { kind: 'grades', schoolId: 'pu', academicYear: '115', semester: '1' });
    const before = parsed.rows[0];
    expect(parsed.issues.some((issue) => issue.code === 'unrecognized-field')).toBe(true);
    const result = applyPortalRowDraft(before, { ...createPortalRowDraft(before), credits: '3' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const left = reconcilePortalRowIssues(parsed.issues, before, result.row);
      expect(portalReviewIssues([result.row], left).filter((issue) => issue.severity === 'error')).toEqual([]);
    }
  });
  it('never clears school mismatch, structural errors or another row’s issues', () => {
    const row = grade(); const result = applyPortalRowDraft(row, createPortalRowDraft(row));
    const issues: ImportIssue[] = [
      { code: 'school-mismatch', field: 'schoolId', severity: 'error', rowId: row.id, message: 'wrong school' },
      { code: 'column-count', severity: 'error', rowId: row.id, message: 'broken row' },
      { code: 'malformed-table', severity: 'error', message: 'broken table' },
      { code: 'invalid-credits', field: 'credits', severity: 'error', rowId: 'another', message: 'other row' },
    ];
    if (!result.ok) throw Error('fixture failed');
    expect(reconcilePortalRowIssues(issues, row, result.row)).toEqual(issues);
  });
  it('recomputes duplicate warnings after user corrections', () => {
    const a = grade(), b = grade({ id: 'two' });
    const issues = portalReviewIssues([a, b], []);
    expect(issues.filter((issue) => issue.code === 'duplicate-row')).toHaveLength(1);
    expect(portalReviewIssues([a, { ...b, title: '另一門課' }], issues).filter((issue) => issue.code === 'duplicate-row')).toHaveLength(0);
  });
  it('rejects event records instead of silently editing unrelated fields', () => {
    const row = grade({ kind: 'events' }); expect(applyPortalRowDraft(row, createPortalRowDraft(row)).ok).toBe(false);
  });
});
