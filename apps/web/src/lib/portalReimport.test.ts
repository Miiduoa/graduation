import { describe, expect, it } from 'vitest';
import { planPortalReimport, resolvePortalReimport } from '@campus/shared/src/imports/portalReimport';
import type { PersonalImportRecord, PersonalImportRow } from '@campus/shared';
const row = (patch: Partial<PersonalImportRow> = {}): PersonalImportRow => ({ id: 'new', kind: 'grades', schoolId: 'pu', academicYear: '115', semester: '1', title: '統計學', courseCode: 'S101', className: '三B', grade: '90', credits: 3, source: { type: 'paste', line: 2, rawText: 'original' }, ...patch });
const record = (patch: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({ ...row({ id: 'old' }), batchId: 'batch-old', importedAt: '2026-10-27T00:00:00Z', ...patch });
const plan = (old: PersonalImportRecord[], incoming: PersonalImportRow[]) => planPortalReimport(old, incoming, 'pu');
const entry = (old = record(), incoming = row()) => plan([old], [incoming]).entries[0];

describe('portal reimport comparison', () => {
  it('separates new records from exact duplicates', () => {
    expect(plan([], [row()]).entries[0].status).toBe('new');
    expect(entry().status).toBe('duplicate');
  });
  it('detects score changes without adding a second course', () => {
    const result = entry(record({ grade: '80' }));
    expect(result.status).toBe('change');
    expect(result.differences).toEqual([{ label: '成績', before: '80', after: '90' }]);
    expect(result.next?.id).toBe('old');
  });
  it('retains a zero score and fractional credits', () => {
    const result = entry(record(), row({ grade: '0', credits: 1.5 }));
    expect(result.next).toMatchObject({ grade: '0', credits: 1.5 });
    expect(result.differences).toHaveLength(2);
  });
  it('does not convert blank credits to zero', () => {
    expect(() => plan([], [row({ credits: undefined })])).toThrow(/學分/);
  });
  it('normalizes numeric score formatting, not letter-grade policy', () => {
    expect(entry(record({ grade: '90' }), row({ grade: '090.00' })).status).toBe('duplicate');
    expect(entry(record({ grade: 'B' }), row({ grade: 'A' })).next?.grade).toBe('A');
  });
  it('preserves missing optional metadata and personal course links', () => {
    const result = entry(record({ teacher: '王老師', linkedCourseId: 'old-link' }), row({ grade: '91', linkedCourseId: 'untrusted-link' }));
    expect(result.next).toMatchObject({ teacher: '王老師', linkedCourseId: 'old-link' });
  });
  it('retains the old record identifier but updates captured source evidence', () => {
    const result = entry(record({ source: { type: 'file', line: 5, rawText: 'old evidence' } }), row({ grade: '91' }));
    expect(result.next?.source.rawText).toBe('original');
    expect(result.next?.id).toBe('old');
  });
  it('does not mix semesters', () => {
    expect(entry(record({ semester: '2' })).status).toBe('new');
  });
  it('does not mix academic years', () => {
    expect(entry(record({ academicYear: '114' })).status).toBe('new');
  });
  it('rejects incoming rows from another school', () => {
    expect(() => plan([], [row({ schoolId: 'ntu' })])).toThrow(/校園/);
  });
  it('rejects existing rows from another school', () => {
    expect(() => plan([record({ schoolId: 'ntu' })], [row()])).toThrow(/校園/);
  });
  it('requires review for missing section identifiers', () => {
    expect(entry(record(), row({ className: undefined, grade: '91' })).status).toBe('ambiguous');
  });
  it('separates explicitly different sections', () => {
    expect(entry(record(), row({ className: '三A' })).status).toBe('new');
  });
  it('does not guess a match for duplicate existing course identities', () => {
    const result = plan([record(), record({ id: 'old2', grade: '70' })], [row({ grade: '91' })]);
    expect(result.entries[0].status).toBe('ambiguous');
  });
  it('does not infer new duplicate courses from conflicting incoming rows', () => {
    const result = plan([], [row(), row({ id: 'new2', grade: '91' })]);
    expect(result.entries.map((item) => item.status)).toEqual(['ambiguous', 'ambiguous']);
  });
  it('skips repeated identical incoming records without changing source arrays', () => {
    const incoming = [row(), row({ id: 'new2' })];
    const before = JSON.stringify(incoming);
    expect(plan([], incoming).entries.map((item) => item.status)).toEqual(['new', 'duplicate']);
    expect(JSON.stringify(incoming)).toBe(before);
  });
  it('does not merge distinct explicit course codes with a common title', () => {
    expect(entry(record(), row({ courseCode: 'S102' })).status).toBe('new');
  });
  it('keeps an existing course code when the new source omits it', () => {
    expect(entry(record(), row({ courseCode: undefined, grade: '91' })).next?.courseCode).toBe('S101');
  });
  it('handles a classroom change without creating a second meeting', () => {
    const meeting = row({ kind: 'timetable', dayOfWeek: 1, startPeriod: 3, endPeriod: 4, location: 'A101', grade: undefined });
    const before = { ...meeting, id: 'old', importedAt: '2026-10-27T00:00:00Z', batchId: 'old' };
    const result = entry(before, { ...meeting, location: 'A102' });
    expect(result.status).toBe('change');
    expect(result.differences).toEqual([{ label: '教室', before: 'A101', after: 'A102' }]);
  });
  it('does not keep old clock times when replacing a timetable schedule', () => {
    const incoming = row({ kind: 'timetable', dayOfWeek: 2, startPeriod: 5, endPeriod: 6, grade: undefined });
    const before = record({ ...incoming, id: 'old', dayOfWeek: 1, startPeriod: 3, endPeriod: 4, startTime: '10:10', endTime: '12:00' });
    expect(entry(before, incoming).next).toMatchObject({ dayOfWeek: 2, startPeriod: 5, endPeriod: 6 });
    expect(entry(before, incoming).next?.startTime).toBeUndefined();
  });
  it('requires review rather than pairing multi-meeting courses by array order', () => {
    const incoming = row({ kind: 'timetable', dayOfWeek: 2, startPeriod: 5, endPeriod: 6 });
    expect(plan([record({ ...incoming, id: 'a', dayOfWeek: 1 }), record({ ...incoming, id: 'b', dayOfWeek: 3 })], [incoming]).entries[0].status).toBe('ambiguous');
  });
  it('requires an explicit replacement decision', () => {
    const result = plan([record({ grade: '80' })], [row()]);
    expect(() => resolvePortalReimport(result, {})).toThrow(/逐筆/);
    expect(resolvePortalReimport(result, { new: 'replace' }).replacements).toHaveLength(1);
    expect(resolvePortalReimport(result, { new: 'keep' }).replacements).toHaveLength(0);
  });
  it('cannot replace an ambiguous match', () => {
    const result = plan([record(), record({ id: 'other' })], [row({ grade: '95' })]);
    expect(() => resolvePortalReimport(result, { new: 'replace' })).toThrow();
    expect(resolvePortalReimport(result, { new: 'keep' }).kept).toBe(1);
  });
  it('does not delete records absent from the incoming data', () => {
    const old = [record(), record({ id: 'unseen', courseCode: 'S102', title: '英文' })];
    const resolved = resolvePortalReimport(plan(old, [row()]), {});
    expect(resolved.added).toHaveLength(0); expect(resolved.replacements).toHaveLength(0);
    expect(old).toHaveLength(2);
  });
  it('bounds work and rejects duplicate identifiers', () => {
    expect(() => plan([], Array.from({ length: 501 }, (_, i) => row({ id: String(i) })))).toThrow();
    expect(() => plan([], [row(), row()])).toThrow(/識別碼/);
  });
});
