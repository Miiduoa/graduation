import type { NuniStudyAgenda, NuniStudyTask } from '@campus/shared/src/nuniStudyAgenda';
import { isNuniReceiptQuestion, isNuniReceiptReferenceQuestion, isNuniReceiptStatusFollowUp, queryNuniReceipts } from '../../services/nuniReceiptQuery';

const task = (id: string, courseId: string, submittedAt: string | null = null,
  state: NuniStudyTask['state'] = 'open'): NuniStudyTask => ({
  id, courseId, courseTitle: courseId, title: '期中報告', kind: 'assignment',
  dueAt: '2026-11-10T10:00:00+08:00', state, submittedAt, feedback: null, reviewedAt: null,
});

const agenda: NuniStudyAgenda = {
  workspaces: [
    { id: 'design', title: '資料庫設計', state: 'active', memberRole: 'student' },
    { id: 'management', title: '資料庫管理', state: 'active', memberRole: 'student' },
    { id: 'teacher', title: '資料庫教學', state: 'active', memberRole: 'owner-teacher' },
    { id: 'archived', title: '資料庫歷史', state: 'archived', memberRole: 'student' },
  ],
  tasks: [
    task('pending', 'design'),
    task('submitted', 'management', '2026-11-04T05:00:00Z'),
    task('teacher-only', 'teacher', '2026-11-04T05:00:00Z'),
    task('archived', 'archived', '2026-11-04T05:00:00Z'),
    task('closed', 'design', null, 'closed'),
    { ...task('quiz', 'design'), kind: 'quiz' },
  ],
  studiedCourseCount: 2, failedCourseIds: ['management'], limitedCourseIds: ['design'],
};

test('distinguishes a receipt read from an actual homework write', () => {
  expect(isNuniReceiptQuestion('資料庫的期中報告交了嗎？')).toBe(true);
  expect(isNuniReceiptQuestion('我已繳交的作業有哪些？')).toBe(true);
  expect(isNuniReceiptQuestion('幫我直接送出這份作業')).toBe(false);
  expect(isNuniReceiptQuestion('幫我寫期中報告')).toBe(false);
});

test('keeps same-title student courses but never includes teacher, archived or quiz rows', () => {
  const result = queryNuniReceipts(agenda, '資料庫的期中報告交了嗎？');
  expect(result.kind).toBe('results');
  if (result.kind !== 'results') return;
  expect(result.rows.map((row) => row.item.id)).toEqual(['closed', 'pending', 'submitted']);
  expect(result.rows.find((row) => row.item.id === 'submitted')?.submittedAt)
    .toBe('2026-11-04T05:00:00Z');
  expect(result.rows.find((row) => row.item.id === 'pending')?.submittedAt).toBeNull();
});

test('shows only loaded receipt evidence when asking for completed submissions', () => {
  const result = queryNuniReceipts(agenda, '我已繳交的作業有哪些？');
  expect(result.kind).toBe('results');
  if (result.kind !== 'results') return;
  expect(result.rows.map((row) => row.item.id)).toEqual(['submitted']);
  expect(result.rows[0].receiptStatus).toBe('submitted');
});

test('does not infer the referenced row or substitute a different course', () => {
  expect(queryNuniReceipts(agenda, '這份作業交了嗎？')).toMatchObject({
    kind: 'clarify', message: expect.stringContaining('課程或作業名稱'),
  });
  expect(queryNuniReceipts(agenda, '高等數學的期中報告交了嗎？')).toMatchObject({
    kind: 'results', rows: [],
  });
});


test('a receipt status follow-up keeps the previous exact course and title scope', () => {
  const previous = '資料庫的期中報告交了嗎？';
  expect(isNuniReceiptStatusFollowUp('那已交的呢？')).toBe(true);
  expect(isNuniReceiptStatusFollowUp('那還沒交的呢？')).toBe(true);
  expect(isNuniReceiptStatusFollowUp('這份作業幫我繳交')).toBe(false);
  expect(queryNuniReceipts(agenda, '那已交的呢？', previous)).toMatchObject({
    kind: 'results', rows: [{ item: { id: 'submitted', courseId: 'management' } }],
  });
  const missing = queryNuniReceipts(agenda, '那還沒交的呢？', previous);
  expect(missing.kind).toBe('results');
  if (missing.kind !== 'results') return;
  expect(missing.rows.map((row) => row.item.id)).toEqual(['closed', 'pending']);
  // A follow-up never silently turns one course into the whole account.
  expect(queryNuniReceipts(agenda, '那已交的呢？', '資料庫管理的期中報告交了嗎？'))
    .toMatchObject({ kind: 'results', rows: [{ item: { id: 'submitted', courseId: 'management' } }] });
  expect(queryNuniReceipts(agenda, '那已交的呢？', '高等數學的期中報告交了嗎？'))
    .toMatchObject({ kind: 'results', rows: [] });
});

test('status-only follow-up after a broad receipt list remains broad but read-only', () => {
  const result = queryNuniReceipts(agenda, '那還沒交的呢？', '我已繳交的作業有哪些？');
  expect(result.kind).toBe('results');
  if (result.kind !== 'results') return;
  expect(result.rows.map((row) => row.item.id)).toEqual(['closed', 'pending']);
});


test('keeps the prior Taiwan-time deadline window when switching from due dates to receipt status', () => {
  const tomorrow = '2026-11-05T00:00:00+08:00';
  const later = '2026-11-06T00:00:00+08:00';
  const dates: NuniStudyAgenda = {
    ...agenda,
    tasks: [
      { ...task('submitted-tomorrow', 'management', '2026-11-04T05:00:00Z'), dueAt: tomorrow },
      { ...task('submitted-later', 'management', '2026-11-04T05:00:00Z'), dueAt: later },
      { ...task('pending-tomorrow', 'design'), dueAt: tomorrow },
      { ...task('undated', 'design'), dueAt: null },
      { ...task('other-course', 'teacher', '2026-11-04T05:00:00Z'), dueAt: tomorrow },
    ],
  };
  const startDay = Date.UTC(2026, 10, 5) / 86_400_000;
  const deadlineScope = {
    window: { startDay, endDay: startDay + 1, label: '明天' },
    checkedAt: Date.parse('2026-11-04T09:00:00Z'),
  };
  const scopeQuestion = '資料庫的期中報告什麼時候交？';
  const done = queryNuniReceipts(dates, '那已交的呢？', scopeQuestion, deadlineScope);
  expect(done).toMatchObject({
    kind: 'results', rows: [{ item: { id: 'submitted-tomorrow', courseId: 'management' } }],
  });
  const missing = queryNuniReceipts(dates, '那還沒交的呢？', scopeQuestion, deadlineScope);
  expect(missing.kind).toBe('results');
  if (missing.kind !== 'results') return;
  expect(missing.rows.map((row) => row.item.id)).toEqual(['pending-tomorrow']);
  expect(missing.rows.every((row) => row.receiptStatus !== 'submitted')).toBe(true);
});

test('future-seven-day receipt status never includes an earlier deadline or an undated assignment', () => {
  const dates: NuniStudyAgenda = {
    ...agenda,
    tasks: [
      { ...task('already-due', 'management', '2026-11-04T05:00:00Z'), dueAt: '2026-11-04T09:00:00Z' },
      { ...task('within-week', 'management', '2026-11-04T05:00:00Z'), dueAt: '2026-11-06T09:00:00Z' },
      { ...task('undated', 'management', '2026-11-04T05:00:00Z'), dueAt: null },
    ],
  };
  const startDay = Date.UTC(2026, 10, 4) / 86_400_000;
  const result = queryNuniReceipts(dates, '那已交的呢？', '我有哪些作業？', {
    window: { startDay, endDay: startDay + 7, label: '未來七天' },
    checkedAt: Date.parse('2026-11-04T10:00:00Z'),
  });
  expect(result.kind).toBe('results');
  if (result.kind !== 'results') return;
  expect(result.rows.map((row) => row.item.id)).toEqual(['within-week']);
});


test('a singular reference needs an explicit selected source, checked against current student courses', () => {
  expect(isNuniReceiptReferenceQuestion('這份作業交了嗎？')).toBe(true);
  expect(isNuniReceiptReferenceQuestion('那個報告已交了嗎？')).toBe(true);
  expect(isNuniReceiptReferenceQuestion('那已交的呢？')).toBe(false);
  expect(queryNuniReceipts(agenda, '這份作業交了嗎？')).toMatchObject({
    kind: 'clarify', message: expect.stringContaining('課程或作業名稱'),
  });
  const read = (courseId: string, id: string) =>
    queryNuniReceipts(agenda, '這份作業交了嗎？', '這份作業交了嗎？',
      undefined, { courseId, id });
  expect(read('management', 'submitted')).toMatchObject({
    kind: 'results', rows: [{ item: { courseId: 'management', id: 'submitted' }, receiptStatus: 'submitted' }],
  });
  expect(read('design', 'pending')).toMatchObject({
    kind: 'results', rows: [{ item: { courseId: 'design', id: 'pending' }, receiptStatus: 'pending' }],
  });
  expect(read('design', 'closed')).toMatchObject({
    kind: 'results', rows: [{ item: { courseId: 'design', id: 'closed' }, receiptStatus: 'closed' }],
  });
  for (const [courseId, id] of [['teacher', 'teacher-only'], ['archived', 'archived'],
    ['design', 'quiz'], ['design', 'nonexistent'], ['wrong-course', 'submitted']]) {
    expect(read(courseId, id)).toMatchObject({ kind: 'results', rows: [] });
  }
});
