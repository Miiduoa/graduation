import { describe, expect, it } from 'vitest';
import { auditPersonalImportAiTable, personalImportAiTableAuditMessage } from '@campus/shared/src/imports/aiTableAudit';
import type { PersonalImportKind, PersonalImportRow } from '@campus/shared/src/imports/types';

const row = (title: string, evidence: string, values: Partial<PersonalImportRow> = {}): PersonalImportRow => ({
  id: title, kind: 'grades', title, schoolId: 'pu', academicYear: '115', semester: '1',
  credits: 3, grade: '85', source: { type: 'paste', line: 1, rawText: evidence }, ...values,
});
const audit = (text: string, rows: PersonalImportRow[], kind: PersonalImportKind = 'grades', context = '') =>
  auditPersonalImportAiTable(text, rows, kind, context);
const header = '課程名稱,學分,成績';
const first = '資料庫,3,85';
const second = '統計學,2,90';

describe('source table coverage, not model self-reported completeness', () => {
  it('detects a missing record despite a valid, nonempty result', () => {
    expect(audit(`${header}\n${first}\n${second}`, [row('資料庫', first)])).toMatchObject({
      status: 'mismatch', expectedRecords: 2, matchedRecords: 1, missingLines: [3],
    });
  });
  it('does not let a duplicated course compensate for a missing one', () => {
    expect(audit(`${header}\n${first}\n${second}`, [
      row('資料庫', first), row('資料庫', first, { id: 'duplicate' }),
    ])).toMatchObject({ status: 'mismatch', matchedRecords: 1, missingLines: [3], unexpectedRowIds: ['duplicate'] });
  });
  it('preserves identical source rows and assigns distinct original lines in source order', () => {
    const result = audit(`${header}\n${first}\n${first}`, [
      row('資料庫', first, { id: 'a' }), row('資料庫', first, { id: 'b' }),
    ]);
    expect(result).toMatchObject({ status: 'matched', expectedRecords: 2, sourceLines: { a: 2, b: 3 } });
    expect(audit(`${header}\n${first}\n${first}`, [row('資料庫', first)])).toMatchObject({
      status: 'mismatch', matchedRecords: 1,
    });
  });
  it('matches rows regardless of model output ordering and does not mutate them', () => {
    const rows = [row('統計學', second, { credits: 2, grade: '90' }), row('資料庫', first)];
    const before = JSON.stringify(rows);
    expect(audit(`${header}\n${first}\n${second}`, rows)).toMatchObject({
      status: 'matched', sourceLines: { 統計學: 3, 資料庫: 2 },
    });
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('detects swapped grade and credits even when both numbers occur in the same row', () => {
    expect(audit(`${header}\n${first}`, [row('資料庫', first, { credits: 85, grade: '3' })]))
      .toMatchObject({ status: 'mismatch', missingLines: [2], unexpectedRowIds: ['資料庫'] });
  });
  it('cannot borrow credits or grades from another column or another row', () => {
    const text = '課程名稱,課號,學分,成績\n資料庫,CS3,2,85\n統計學,ST2,3,90';
    expect(audit(text, [row('資料庫', '資料庫,CS3,2,85'), row('統計學', '統計學,ST2,3,90', { grade: '90' })]))
      .toMatchObject({ status: 'mismatch', missingLines: [2] });
  });
  it('leaves deliberately blank uncertain fields for manual correction', () => {
    expect(audit(`${header}\n${first}`, [row('資料庫', first, { title: '', credits: undefined, grade: undefined })]))
      .toMatchObject({ status: 'matched', matchedRecords: 1 });
  });
  it('rejects inventing a value in an explicitly blank source column', () => {
    expect(audit(`${header}\n資料庫,,85`, [row('資料庫', '資料庫,,85')]))
      .toMatchObject({ status: 'mismatch' });
  });
  it('requires evidence containing the record identity, not just a common number', () => {
    expect(audit(`${header}\n${first}`, [row('資料庫', '3', { title: '' })]))
      .toMatchObject({ status: 'mismatch' });
  });
  it('refuses an evidence excerpt spanning two logical records', () => {
    expect(audit(`${header}\n${first}\n${second}`, [row('資料庫', `${first}\n${second}`)]))
      .toMatchObject({ status: 'mismatch', matchedRecords: 0 });
  });
  it('uses inherited columns but never accepts header context as evidence', () => {
    expect(audit(first, [row('資料庫', first)], 'grades', `【成績】\n${header}`))
      .toMatchObject({ status: 'matched', sourceLines: { 資料庫: 1 } });
    expect(audit(first, [row('課程名稱', header)], 'grades', header))
      .toMatchObject({ status: 'mismatch' });
  });
  it('detects explicit same-name weekday mistakes instead of collapsing course names', () => {
    const text = '課程名稱\t星期\t開始時間\n資料庫\t星期一\t09:00\n資料庫\t星期三\t13:00';
    const rows = [
      row('資料庫', '資料庫\t星期一\t09:00', { kind: 'timetable', id: 'mon', dayOfWeek: 1, startTime: '09:00' }),
      row('資料庫', '資料庫\t星期三\t13:00', { kind: 'timetable', id: 'wed', dayOfWeek: 1, startTime: '13:00' }),
    ];
    expect(audit(text, rows, 'timetable')).toMatchObject({ status: 'mismatch', missingLines: [3] });
    rows[1].dayOfWeek = 3;
    expect(audit(text, rows, 'timetable')).toMatchObject({ status: 'matched', expectedRecords: 2 });
  });
  it('compares special period labels using the selected school profile, not printed numbers', () => {
    const text = '課程名稱,星期,開始節次,結束節次\n資料庫,三,N,5';
    const course = row('資料庫', '資料庫,三,N,5', {
      kind: 'timetable', dayOfWeek: 3, startPeriod: 6, endPeriod: 7,
    });
    expect(auditPersonalImportAiTable(text, [course], 'timetable', '', 'ncku'))
      .toMatchObject({ status: 'matched' });
    expect(auditPersonalImportAiTable(text, [{ ...course, endPeriod: 5 }], 'timetable', '', 'ncku'))
      .toMatchObject({ status: 'mismatch' });
  });
  it('allows one multi-session timetable record to yield several sessions, without certifying every session', () => {
    const text = '課程名稱,星期\n資料庫,一、三';
    expect(audit(text, [
      row('資料庫', '資料庫,一、三', { kind: 'timetable', id: 'a', dayOfWeek: 1 }),
      row('資料庫', '資料庫,一、三', { kind: 'timetable', id: 'b', dayOfWeek: 3 }),
    ], 'timetable')).toMatchObject({ status: 'matched', expectedRecords: 1, matchedRecords: 1 });
  });
  it('checks explicit event dates while leaving inclusive/exclusive end-date rules alone', () => {
    const text = '活動名稱,日期,開始時間\n校園講座,115/10/28,9:00';
    const event = row('校園講座', '校園講座,115/10/28,9:00', {
      kind: 'events', date: '2026-10-28', startTime: '09:00', endDate: '2026-10-29',
    });
    expect(audit(text, [event], 'events')).toMatchObject({ status: 'matched' });
    expect(audit(text, [{ ...event, date: '2026-10-29' }], 'events')).toMatchObject({ status: 'mismatch' });
  });
  it.each(['\n', '\r\n'])('counts a quoted multiline course as one record with %j', (newline) => {
    const first = `"資料庫${newline}${newline}與""分析""",3,85`;
    const title = `資料庫${newline}${newline}與"分析"`;
    const text = `\uFEFF${header}${newline}${first}${newline}${second}`;
    expect(audit(text, [row(title, first), row('統計學', second, { credits: 2, grade: '90' })]))
      .toMatchObject({ status: 'matched', expectedRecords: 2, sourceLines: { [title]: 2, 統計學: 5 } });
  });
  it('retains zero credits and full-width numeric source values', () => {
    expect(audit(`${header}\n實習,０．０,通過`, [row('實習', '實習,０．０,通過', { credits: 0, grade: '通過' })]))
      .toMatchObject({ status: 'matched' });
  });
  it('does not silently disable coverage when the source has more than eighty records', () => {
    const text = `${header}\n${Array.from({ length: 90 }, (_, i) => `課程${i},3,85`).join('\n')}`;
    const rows = Array.from({ length: 80 }, (_, i) => row(`課程${i}`, `課程${i},3,85`));
    expect(audit(text, rows)).toMatchObject({ status: 'mismatch', expectedRecords: 90, matchedRecords: 80 });
  });
  it('finds a maximum matching rather than depending on a greedy choice', () => {
    const text = '課程名稱,學分,成績,備註\n資料庫,3,85,甲\n資料庫,3,85,乙';
    const rows = [row('資料庫', '資料庫,3,85', { id: 'general' }), row('資料庫', '資料庫,3,85,甲', { id: 'specific' })];
    expect(audit(text, rows)).toMatchObject({ status: 'matched', sourceLines: { specific: 2, general: 3 } });
  });
  it.each([
    '資料庫，三學分，八十五分',
    '資料庫,3,85',
    '課程名稱,學分,學分\n資料庫,3,3',
    '課程名稱,學分,成績\n資料庫,3',
    '課程名稱,學分,成績\n"資料庫,3,85',
    '課程名稱,學分,成績\n資料庫,3,85\n總計,3,85',
    '【工作表一】\n課程名稱,學分,成績\n資料庫,3,85\n\n【工作表二】\n課程名稱,學分,成績\n統計學,2,90',
  ])('does not certify unknown or ambiguous source structure: %s', (text) => {
    expect(audit(text, [])).toEqual({ status: 'unavailable' });
  });
  it('reports only source line numbers, not private course names or grades', () => {
    const result = audit(`${header}\n${first}\n${second}`, []);
    expect(personalImportAiTableAuditMessage(result, 10)).toContain('11、12');
    expect(personalImportAiTableAuditMessage(result)).not.toContain('資料庫');
    expect(personalImportAiTableAuditMessage({ status: 'unavailable' })).toBe('');
  });
});
