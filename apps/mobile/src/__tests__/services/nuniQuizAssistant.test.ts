import type { NuniStudyAgenda, NuniStudyTask } from '@campus/shared/src/nuniStudyAgenda';
import {
  isNuniQuizQuestion, isNuniQuizStatusFollowUp, isNuniQuizDateFollowUp,
  isNuniQuizReferenceQuestion, queryNuniQuizzes,
} from '../../services/nuniQuizAssistant';

const now = Date.parse('2026-11-05T15:55:00Z'); // Taiwan 23:55
const midnight = '2026-11-06T00:00:00';
const task = (courseId: string, id: string, overrides: Partial<NuniStudyTask> = {}): NuniStudyTask => ({
  courseId, id, title: '單元測驗', courseTitle: courseId, kind: 'quiz',
  dueAt: midnight, state: 'open', feedback: null, submittedAt: null, reviewedAt: null, ...overrides,
});
const data: NuniStudyAgenda = {
  workspaces: [
    { id: 'design', title: '資料庫設計', state: 'active', memberRole: 'student' },
    { id: 'management', title: '資料庫管理', state: 'active', memberRole: 'student' },
    { id: 'english', title: '英語', state: 'active', memberRole: 'student' },
    { id: 'old', title: '資料庫', state: 'archived', memberRole: 'student' },
    { id: 'teacher', title: '資料庫', state: 'active', memberRole: 'co-teacher' },
  ],
  tasks: [
    task('design', 'a', { submittedAt: '2026-11-04T10:00:00', state: 'closed' }),
    task('management', 'b'), task('english', 'c'),
    task('management', 'later', { dueAt: '2026-11-09T00:00:00', submittedAt: midnight }),
    task('english', 'closed', { state: 'closed', dueAt: null, submittedAt: 'invalid' }),
    task('management', 'later-missing', { dueAt: '2026-11-10T00:00:00' }),
    task('old', 'old'), task('teacher', 'teacher'), task('private', 'private'),
    task('design', 'homework', { kind: 'assignment', submittedAt: midnight }),
  ],
  studiedCourseCount: 3, limitedCourseIds: ['design'], failedCourseIds: ['english'],
};

test('looks up due dates in Taipei for the requested course prefix and only scoped quizzes', () => {
  for (const question of ['資料庫明天有哪些測驗？', '資料庫明天有小考嗎？', '明天資料庫的單元測驗何時截止？']) {
    expect(queryNuniQuizzes(data, question, now)).toMatchObject({
      kind: 'results', rows: [
        { item: { id: 'a', groupName: '資料庫設計' }, due: Date.parse('2026-11-05T16:00:00Z') },
        { item: { id: 'b', groupName: '資料庫管理' } },
      ],
    });
  }
  const all = queryNuniQuizzes(data, '有哪些測驗？', now);
  expect(all).toMatchObject({ kind: 'results', undatedOutsideWindow: 0 });
  expect(queryNuniQuizzes(data, '明天有哪些測驗？', now))
    .toMatchObject({ kind: 'results', undatedOutsideWindow: 1 });
  if (all.kind === 'results') expect(all.rows.map((r) => r.item.id)).toEqual(['a', 'b', 'c', 'later', 'later-missing', 'closed']);
});

test('keeps a receipt time independent of the open state and never infers absence from an invalid timestamp', () => {
  expect(queryNuniQuizzes(data, '我已作答的測驗有哪些？', now)).toMatchObject({
    kind: 'results', rows: [
      { item: { id: 'a' }, state: 'closed', submittedAt: '2026-11-04T02:00:00.000Z' },
      { item: { id: 'later' }, state: 'open' },
    ],
  });
  expect(queryNuniQuizzes(data, '有哪些未作答的測驗？', now)).toMatchObject({ kind: 'results', rows: [
    { item: { id: 'b' }, submittedAt: null }, { item: { id: 'c' }, submittedAt: null }, { item: { id: 'later-missing' }, submittedAt: null },
    { item: { id: 'closed' }, state: 'closed', submittedAt: null },
  ] });
});

test('status follow-ups retain course and original Taiwan date after midnight; date follow-ups explicitly change it', () => {
  const first = queryNuniQuizzes(data, '明天資料庫的測驗有哪些？', now);
  if (first.kind !== 'results') throw Error(first.message);
  const after = now + 10 * 60_000;
  const attempted = queryNuniQuizzes(data, '那已作答的呢？', after, undefined, first.context);
  expect(attempted).toMatchObject({ kind: 'results', rows: [{ item: { id: 'a' } }] });
  const changed = queryNuniQuizzes(data, '那下週呢？', after, undefined, attempted.context);
  expect(changed).toMatchObject({ kind: 'results', rows: [{ item: { id: 'later' } }] });
  expect(isNuniQuizDateFollowUp('那下週呢？', after)).toBe(true);
  expect(isNuniQuizStatusFollowUp('那還沒作答的呢？')).toBe(true);
});

test('singular references require the matching authorized quiz; IDs cannot resolve to assignments or other courses', () => {
  const q = '這個測驗我有作答嗎？';
  expect(isNuniQuizReferenceQuestion(q)).toBe(true);
  expect(queryNuniQuizzes(data, q, now)).toMatchObject({ kind: 'clarify' });
  for (const source of [{ id: 'homework', courseId: 'design' }, { id: 'teacher', courseId: 'teacher' }, { id: 'a', courseId: 'management' }]) {
    expect(queryNuniQuizzes(data, q, now, source)).toMatchObject({ kind: 'clarify' });
  }
  expect(queryNuniQuizzes(data, q, now, { courseId: 'management', id: 'b' }))
    .toMatchObject({ kind: 'results', rows: [{ item: { id: 'b' }, submittedAt: null }] });
});

test('binds “this course” to a unique selected student workspace', () => {
  const q = '這門課明天有小考嗎？';
  expect(queryNuniQuizzes(data, q, now).kind).toBe('clarify');
  expect(queryNuniQuizzes({ ...data, workspaces: data.workspaces.slice(0, 1) }, q, now))
    .toMatchObject({ kind: 'results', rows: [{ item: { id: 'a' } }] });
});

test.each(['微積分小考何時開始考？', '明天考試在哪個教室？', '幫我寫小考答案', '請直接提交測驗', '幫我設測驗提醒', '翻譯測驗給我', '替我作答這個測驗', '查作業和測驗有哪些？'])(
  'does not invent an exam schedule, action or an unscoped answer to %s', (q) => {
    expect(isNuniQuizQuestion(q)).toBe(true);
    expect(queryNuniQuizzes(data, q, now)).toMatchObject({ kind: 'clarify' });
  },
);
test('a quoted quiz word in an assignment title does not take over its route', () => {
  expect(isNuniQuizQuestion('「小考心得」這份作業何時交？')).toBe(false);
});

test('open quizzes without a recorded attempt are a distinct subset from all missing receipts', () => {
  for (const question of ['有哪些待答測驗？', '有哪些待作答的小考？']) {
    const result = queryNuniQuizzes(data, question, now);
    expect(result).toMatchObject({ kind: 'results', rows: [
      { item: { id: 'b' } }, { item: { id: 'c' } }, { item: { id: 'later-missing' } },
    ] });
  }
});
test('a clarified date carries the original course, and an unknown title never falls back to all courses', () => {
  const first = queryNuniQuizzes(data, '從今天到明天資料庫的測驗有哪些？', now);
  expect(first.kind).toBe('clarify');
  expect(queryNuniQuizzes(data, '明天', now, undefined, first.context))
    .toMatchObject({ kind: 'results', rows: [{item: {id: 'a'}}, {item: {id: 'b'}}] });
  const missing = queryNuniQuizzes(data, '「找不到的單元」測驗何時截止？', now);
  expect(missing).toMatchObject({ kind: 'results', rows: [] });
});
