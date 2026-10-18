import { beforeEach, expect, it } from 'vitest';
import {
  personalImportDraftKey,
  readPersonalImportDraft,
  writePersonalImportDraft,
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
