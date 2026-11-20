import type { NuniStudyAgenda, NuniStudyTask } from '@campus/shared/src/nuniStudyAgenda';
import { isNuniReceiptQuestion, isNuniReceiptReferenceQuestion, isNuniReceiptStatusFollowUp, queryNuniReceipts } from '../../services/nuniReceiptQuery';
import { parseAssignmentDeadlineWindow } from '../../services/assignmentDeadlineWindow';

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

test.each(['我交了哪些作業？', '我繳交的作業有哪些？', '我提交的作業有哪些？', '我交的作業有哪些？', '我繳過哪些作業？'])(
  'completed-submission list wording reaches the receipt reader and includes only submitted records: %s', (question) => {
    expect(isNuniReceiptQuestion(question)).toBe(true);
    expect(queryNuniReceipts(agenda, question)).toMatchObject({ kind: 'results',
      rows: [{ item: { id: 'submitted' }, receiptStatus: 'submitted' }] });
  },
);

test.each([
  '明天要交的作業有哪些？', '下週待繳交的作業有哪些？', '我要繳交的作業有哪些？',
  '我需要繳交的作業有哪些？',
])('a future obligation is not mistaken for a completed receipt list: %s', (question) => {
  expect(isNuniReceiptQuestion(question)).toBe(false);
});

test.each(['我未繳交的作業有哪些？', '我尚未繳交的作業有哪些？', '我還沒交的作業有哪些？'])(
  'negative submission wording stays in the missing-record subset: %s', (question) => {
    expect(isNuniReceiptQuestion(question)).toBe(true);
    const result = queryNuniReceipts(agenda, question);
    expect(result.kind).toBe('results');
    if (result.kind !== 'results') throw new Error(result.message);
    expect(result.rows.map((row) => row.item.id)).toEqual(['closed', 'pending']);
  },
);

test.each([
  '我已繳交的作業有哪些？', '我的已交作業哪些？', '我還沒交的作業有哪些？',
])('a complete first-person receipt list resets the previous query scope: %s', (question) => {
  expect(isNuniReceiptQuestion(question)).toBe(true);
  expect(isNuniReceiptStatusFollowUp(question)).toBe(false);
});

test.each(['那已交的呢？', '那還沒交的呢？', '那我已交的作業有哪些？', '改查我的未繳交作業有哪些？'])(
  'an explicit contextual status question continues the previous scope: %s', (question) => {
    expect(isNuniReceiptStatusFollowUp(question)).toBe(true);
  },
);

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

describe('direct deadline-scoped receipt questions', () => {
  const now = Date.parse('2026-11-05T15:55:00Z'); // Thursday, Taiwan 23:55.
  const dated = (id: string, dueAt: string | null, submittedAt: string | null = null) => ({
    ...task(id, 'design', submittedAt), dueAt,
  });
  const data: NuniStudyAgenda = {
    ...agenda,
    tasks: [
      dated('earlier-today', '2026-11-05T10:00:00+08:00'),
      dated('tonight', '2026-11-05T23:59:59+08:00'),
      dated('tomorrow', '2026-11-06T00:00:00+08:00'),
      dated('sunday', '2026-11-08T20:00:00+08:00'),
      dated('next-week', '2026-11-09T09:00:00+08:00'),
      dated('beyond-seven-days', '2026-11-12T00:00:00+08:00'),
      dated('undated', null),
      dated('submitted-tomorrow', '2026-11-06T00:00:00+08:00', '2026-11-04T05:00:00Z'),
      dated('submitted-later', '2026-11-09T09:00:00+08:00', '2026-11-04T05:00:00Z'),
      dated('submitted-undated', null, '2026-11-04T05:00:00Z'),
      { ...dated('teacher-only', '2026-11-06T00:00:00+08:00'), courseId: 'teacher' },
      { ...dated('archived', '2026-11-06T00:00:00+08:00'), courseId: 'archived' },
      { ...dated('quiz', '2026-11-06T00:00:00+08:00'), kind: 'quiz' },
    ],
  };
  const query = (question: string, scope = question, at = now) =>
    queryNuniReceipts(data, question, scope, undefined, undefined, at);

  test.each<[string, string[]]>([
    ['我明天還沒交的作業有哪些？', ['tomorrow']],
    ['明天還沒交的作業有哪些？', ['tomorrow']],
    ['我本週還沒交的作業有哪些？', ['earlier-today', 'tonight', 'tomorrow', 'sunday']],
    ['我未來7天還沒交的作業有哪些？', ['tonight', 'tomorrow', 'sunday', 'next-week']],
    ['我未來７天還沒交的作業有哪些？', ['tonight', 'tomorrow', 'sunday', 'next-week']],
    ['我週日還沒交的作業有哪些？', ['sunday']],
  ])('applies the actual deadline window before pagination: %s', (question, ids) => {
    const result = query(question);
    expect(result).toMatchObject({ kind: 'results', total: ids.length, undatedOutsideWindow: 1,
      deadlineScope: { checkedAt: now } });
    if (result.kind !== 'results') throw new Error(result.message);
    expect(result.rows.map((row) => row.item.id)).toEqual(ids);
    expect(result.deadlineScope!.window).toEqual(parseAssignmentDeadlineWindow(question.normalize('NFKC'), now));
  });

  test('a deadline-qualified submitted list filters by deadline rather than by submission date', () => {
    const result = query('我明天截止的作業有哪些已繳交？');
    expect(result).toMatchObject({ kind: 'results', total: 1, undatedOutsideWindow: 1,
      rows: [{ item: { id: 'submitted-tomorrow' }, submittedAt: '2026-11-04T05:00:00Z' }] });
  });

  test('an explicit inherited deadline takes priority and keeps its Taiwan date after midnight', () => {
    const initial = query('明天還沒交的作業有哪些？');
    if (initial.kind !== 'results') throw new Error(initial.message);
    const result = queryNuniReceipts(data, '那已交的呢？', '我明天已交的作業有哪些？',
      initial.deadlineScope, undefined, now + 10 * 60_000);
    expect(result).toMatchObject({ kind: 'results', rows: [{ item: { id: 'submitted-tomorrow' } }],
      deadlineScope: initial.deadlineScope });
    expect(query('我今天還沒交的作業有哪些？', undefined, now + 10 * 60_000))
      .toMatchObject({ kind: 'results', rows: [{ item: { id: 'tomorrow' } }] });
  });

  test('a date correction keeps the current receipt filter independently of the older scope wording', () => {
    const missing = query('那還沒交的呢？', '我明天截止的已繳交作業有哪些？');
    expect(missing).toMatchObject({ kind: 'results', rows: [{ item: { id: 'tomorrow' } }] });
    const submitted = query('那已交的呢？', '下週 我還沒交的作業有哪些？');
    expect(submitted).toMatchObject({ kind: 'results', rows: [{ item: { id: 'submitted-later' } }] });
  });

  test.each(['從今天到明天', '明天早上', '下下週', '11/8', '未來3天'])('an unsupported date asks for clarification without broadening the scope: %s', (period) => {
    const result = query('資料庫的期中報告' + period + '還沒交的有哪些？');
    expect(result).toMatchObject({ kind: 'clarify', dateClarification: 'deadline-window',
      scope: expect.stringContaining('資料庫的期中報告'),
      message: expect.stringContaining('作業參考期限') });
    if (result.kind !== 'clarify') throw new Error('expected date clarification');
    expect(result.scope).toContain('還沒交');
    expect(parseAssignmentDeadlineWindow(result.scope, now)).toBeNull();
    expect(query('那還沒交的呢？', '明天 ' + result.scope))
      .toMatchObject({ kind: 'results', rows: [{ item: { id: 'tomorrow' } }] });
  });

  test.each([
    '我昨天繳交的作業有哪些？', '我昨天已交的作業有哪些？', '昨天有哪些繳交紀錄？',
    '我昨天交了哪些作業？', '我明天已繳交的作業有哪些？',
  ])('submission-date wording is never silently interpreted as a deadline: %s', (question) => {
    expect(isNuniReceiptQuestion(question)).toBe(true);
    expect(query(question)).toMatchObject({ kind: 'clarify', dateClarification: 'submission-date',
      message: expect.stringContaining('不能按繳交時間篩選'), scope: expect.any(String) });
  });

  test('a submission-date clarification remains unresolved until the deadline meaning is explicit', () => {
    const first = query('我昨天繳交的作業有哪些？');
    if (first.kind !== 'clarify') throw new Error('expected submission-date clarification');
    expect(query('我繳交的作業有哪些？', '明天 ' + first.scope))
      .toMatchObject({ kind: 'clarify', dateClarification: 'submission-date' });
    for (const status of ['那已交的呢？', '那還沒交的呢？']) {
      expect(query(status, '我昨天繳交的作業有哪些？'))
        .toMatchObject({ kind: 'clarify', dateClarification: 'submission-date' });
    }
    expect(query('我明天截止的作業有哪些已繳交？'))
      .toMatchObject({ kind: 'results', rows: [{ item: { id: 'submitted-tomorrow' } }] });
  });

  test('calendar and submission words inside quoted names remain literal task names', () => {
    const named: NuniStudyAgenda = { ...data, tasks: [
      { ...dated('named-tomorrow', '2026-11-06T00:00:00+08:00'), title: '昨天繳交心得' },
      { ...dated('named-later', '2026-11-09T09:00:00+08:00'), title: '昨天繳交心得' },
    ] };
    expect(queryNuniReceipts(named, '「昨天繳交心得」交了嗎？', undefined, undefined, undefined, now))
      .toMatchObject({ kind: 'results', total: 2, undatedOutsideWindow: 0 });
    expect(queryNuniReceipts(named, '我明天還沒交的「昨天繳交心得」有哪些？', undefined, undefined, undefined, now))
      .toMatchObject({ kind: 'results', rows: [{ item: { id: 'named-tomorrow' } }] });
  });

  test.each<[string, string, string[]]>([
    ['未交報告', '有哪些已繳交', ['done']],
    ['未交報告', '有哪些', ['done', 'pending']],
    ['已交報告', '有哪些還沒交', ['pending']],
    ['已交報告', '有哪些', ['done', 'pending']],
  ])('status words inside the literal title %s do not change the requested filter %s', (title, suffix, ids) => {
    const named: NuniStudyAgenda = { ...data, tasks: [
      { ...dated('done', '2026-11-06T00:00:00+08:00', '2026-11-04T05:00:00Z'), title },
      { ...dated('pending', '2026-11-06T00:00:00+08:00'), title },
    ] };
    const result = queryNuniReceipts(named, '我明天截止的「' + title + '」' + suffix + '？', undefined, undefined, undefined, now);
    expect(result.kind).toBe('results');
    if (result.kind !== 'results') throw new Error(result.message);
    expect(result.rows.map((row) => row.item.id)).toEqual(ids);
    expect(result.rows.every((row) => row.item.title === title)).toBe(true);
  });

  test('deadline-qualified course prefixes preserve every matching course without including unrelated courses', () => {
    const bothCourses: NuniStudyAgenda = { ...data, tasks: [
      dated('design-done', '2026-11-06T00:00:00+08:00', '2026-11-04T05:00:00Z'),
      { ...dated('management-done', '2026-11-06T00:00:00+08:00', '2026-11-04T05:00:00Z'), courseId: 'management' },
      { ...dated('teacher-done', '2026-11-06T00:00:00+08:00', '2026-11-04T05:00:00Z'), courseId: 'teacher' },
    ] };
    const result = queryNuniReceipts(bothCourses, '資料庫的明天截止的作業有哪些已繳交？', undefined, undefined, undefined, now);
    expect(result).toMatchObject({ kind: 'results', total: 2 });
    if (result.kind !== 'results') throw new Error(result.message);
    expect(result.rows.map((row) => row.item.courseId).sort()).toEqual(['design', 'management']);
  });
});
