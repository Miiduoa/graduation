import { beforeEach, expect, it } from 'vitest';
import {
  personalImportDraftKey,
  personalImportPartialDraftKey,
  clearPersonalImportDraft,
  clearPersonalImportPartialDraft,
  readPersonalImportDraft,
  readPersonalImportPartialDraft,
  writePersonalImportDraft,
  writePersonalImportPartialDraft,
  type PersonalImportDraft,
} from './personalImportDrafts';

const scope = { owner: 'platform:one', schoolId: 'pu' };
const draft = (): PersonalImportDraft => ({
  kind: 'timetable',
  year: '115',
  semester: '1',
  text: '',
  source: { type: 'paste' },
  rows: [
    {
      id: 'draft-row',
      kind: 'timetable',
      schoolId: 'pu',
      title: '',
      academicYear: '115',
      semester: '1',
      source: { type: 'paste', line: 1, rawText: '' },
    },
  ],
  excluded: [],
  parseIssues: [],
  backup: null,
});

beforeEach(() => sessionStorage.clear());

it('retains an incomplete manual row so required fields can be completed after recovery', () => {
  const input = draft();
  writePersonalImportDraft(scope, input);
  expect(readPersonalImportDraft(scope)).toEqual(input);
});

it('stores partial replacements separately and isolates their recovery by account and school', () => {
  const original = draft();
  original.rows[0].grade = '88';
  const partial = draft();
  partial.rows[0].grade = '85';
  writePersonalImportDraft(scope, original);
  writePersonalImportPartialDraft(scope, partial);
  expect(readPersonalImportDraft(scope)).toEqual(original);
  expect(readPersonalImportPartialDraft(scope)).toEqual(partial);
  expect(readPersonalImportPartialDraft({ ...scope, owner: 'platform:two' })).toBeNull();
  expect(readPersonalImportPartialDraft({ ...scope, schoolId: 'ntu' })).toBeNull();
  clearPersonalImportPartialDraft(scope);
  expect(readPersonalImportDraft(scope)).toEqual(original);
  expect(readPersonalImportPartialDraft(scope)).toBeNull();
  writePersonalImportPartialDraft(scope, partial);
  clearPersonalImportDraft(scope);
  expect(readPersonalImportDraft(scope)).toBeNull();
  expect(readPersonalImportPartialDraft(scope)).toBeNull();
});

it('rejects damaged partial results without changing the edited original', () => {
  const original = draft();
  original.rows[0].grade = '88';
  writePersonalImportDraft(scope, original);
  const partial = draft();
  partial.rows[0].schoolId = 'ntu';
  const key = personalImportPartialDraftKey(scope);
  const raw = JSON.stringify({ version: 1, draft: partial });
  sessionStorage.setItem(key, raw);
  expect(() => readPersonalImportPartialDraft(scope)).toThrow('上次的暫存草稿無法還原');
  expect(sessionStorage.getItem(key)).toBe(raw);
  expect(readPersonalImportDraft(scope)).toEqual(original);
});

it('counts multibyte text toward the 8 MiB limit and preserves the previous draft on failure', () => {
  const input = draft();
  writePersonalImportDraft(scope, input);
  const key = personalImportDraftKey(scope);
  const previous = sessionStorage.getItem(key);
  input.text = '課'.repeat(3 * 1024 * 1024);
  expect(() => writePersonalImportDraft(scope, input)).toThrow('草稿暫存沒有成功');
  expect(sessionStorage.getItem(key)).toBe(previous);
});

it.each([
  (input: PersonalImportDraft) => {
    input.rows[0].schoolId = 'ntu';
  },
  (input: PersonalImportDraft) => {
    input.rows.push({ ...input.rows[0] });
  },
  (input: PersonalImportDraft) => {
    input.rows[0].source = null as never;
  },
  (input: PersonalImportDraft) => {
    input.rows[0].teacher = {} as never;
  },
  (input: PersonalImportDraft) => {
    input.parseIssues = [null as never];
  },
  (input: PersonalImportDraft) => {
    input.backup = { counts: null } as never;
  },
])('rejects damaged or cross-school drafts without changing the original storage', (damage) => {
  const input = draft();
  damage(input);
  const raw = JSON.stringify({ version: 1, draft: input });
  const key = personalImportDraftKey(scope);
  sessionStorage.setItem(key, raw);
  expect(() => readPersonalImportDraft(scope)).toThrow('上次的暫存草稿無法還原');
  expect(sessionStorage.getItem(key)).toBe(raw);
});

it('keeps backup restore mode and proposed links across recovery', () => {
  const input = draft();
  input.backup = {
    schoolId: 'pu',
    exportedAt: '2026-10-18T00:00:00.000Z',
    counts: { timetable: 1, grades: 0, events: 0 },
    proposedLinks: { 'draft-row': 'previous-course' },
  };
  writePersonalImportDraft(scope, input);
  expect(readPersonalImportDraft(scope)?.backup).toEqual(input.backup);
});

it.each(['invalid-document', 'unknown-section', 'missing-header', 'unknown-header'])(
  'retains the original draft when document selection is corrupt: %s',
  (damage) => {
    const input = draft();
    input.rows = [];
    input.document = {
      name: 'grades.xlsx',
      format: 'xlsx',
      warnings: [],
      sections: [{
        id: 'sheet-1', label: '成績', needsOcr: false, warnings: [],
        rows: [{ line: 1, cells: ['課程名稱', '學分', '成績'] }],
      }],
    };
    input.documentSelection = { selected: ['sheet-1'], headers: { 'sheet-1': 1 } };
    if (damage === 'invalid-document') input.document.sections[0].rows[0].cells = [null as never];
    if (damage === 'unknown-section') input.documentSelection.selected = ['sheet-2'];
    if (damage === 'missing-header') input.documentSelection.headers = {};
    if (damage === 'unknown-header') input.documentSelection.headers['sheet-1'] = 9;
    const raw = JSON.stringify({ version: 1, draft: input });
    const key = personalImportDraftKey(scope);
    sessionStorage.setItem(key, raw);
    expect(() => readPersonalImportDraft(scope)).toThrow('上次的暫存草稿無法還原');
    expect(sessionStorage.getItem(key)).toBe(raw);
  },
);
