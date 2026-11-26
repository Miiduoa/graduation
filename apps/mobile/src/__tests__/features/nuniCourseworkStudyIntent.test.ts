import { answerCourseworkStudyIntent } from '../../features/nuniCourseworkStudyIntent';
import type { CourseworkRead } from '../../features/nuniCourseworkFollowUp';

const read: CourseworkRead = {
  anchor: { uid: '', owner: 'nuni:student-a', schoolId: 'pu', updatedAt: null, classes: [{
    courseId: 'db', name: '資料庫', date: '2026-11-08', term: '115|1', room: '305', startTime: '09:00', endTime: '10:00',
  }] },
  checkedAt: '2026-11-08T05:00:00Z',
  result: { kind: 'assignments', workspace: { id: 'workspace-a', title: '資料庫' }, limited: false,
    assignments: [
      { id: 'first', title: '期末報告', dueAt: '2026-11-12T10:00:00Z', state: 'open', submittedAt: null },
      { id: 'second', title: '期末報告', dueAt: '2026-11-13T10:00:00Z', state: 'open', submittedAt: null },
    ],
  },
};
const now = Date.parse('2026-11-08T15:30:00Z');
const input = (question: string) => ({ question, read, accountId: 'student-a', schoolId: 'pu', isCurrent: () => true, now });

test.each([
  '幫這份作業找 30 分鐘準備時間', '幫我這份作業找三十分鐘準備時段',
  '幫這份作業找空堂', '幫我找這份作業的準備空堂',
  '替第二份作業尋找30分鐘準備時間', '找「期末報告」的空堂',
  '幫這份作業，找 30 分鐘空堂。', '幫剛才那份作業找半小時準備時間',
  '那就幫我找半小時空堂',
])('finding time retains an exact source selection without inventing a clock: %s', (question) => {
  const result = answerCourseworkStudyIntent(input(question));
  expect(result?.courseworkStudy?.assignmentIds).toEqual(question.includes('第二份') ? ['second'] : ['first', 'second']);
  expect(result?.courseworkStudy?.time).toBeUndefined();
  expect(result?.courseworkStudy?.suggestTime).toBe(true);
  expect(result?.courseworkRead).toBe(read);
});

test.each([
  ['明天要交，今天哪 30 分鐘能準備？', '2026-11-08'],
  ['幫這份作業今天找半小時空堂', '2026-11-08'],
  ['幫這份作業找明天的30分鐘空堂', '2026-11-09'],
  ['幫我找後天的半小時準備時間', '2026-11-10'],
])('an explicit preparation day stays attached to the selected assignment: %s', (question, suggestDate) => {
  const result = answerCourseworkStudyIntent({ ...input(question), read: { ...read, openedAssignmentId: 'second' } });
  expect(result?.courseworkStudy).toEqual({ assignmentIds: ['second'], suggestTime: true, suggestDate });
  expect(result?.courseworkRead).toBeDefined();
});

test('choosing among results keeps the requested day but manual clocks replace that search condition', () => {
  const first = answerCourseworkStudyIntent(input('幫這份作業找明天的半小時空堂'));
  const chosen = answerCourseworkStudyIntent({ ...input('第二份'), previous: first?.courseworkStudy });
  expect(chosen?.courseworkStudy).toEqual({ assignmentIds: ['second'], suggestTime: true, suggestDate: '2026-11-09' });
  const manual = answerCourseworkStudyIntent({ ...input('後天 19:00 到 19:30'), previous: chosen?.courseworkStudy });
  expect(manual?.courseworkStudy).toEqual({ assignmentIds: ['second'],
    time: { date: '2026-11-10', startTime: '19:00', endTime: '19:30' } });
});

test('changing the search day retains the already chosen exact assignment instead of asking for a new one', () => {
  const result = answerCourseworkStudyIntent({ ...input('那明天呢？'),
    previous: { assignmentIds: ['second'], suggestTime: true, suggestDate: '2026-11-08' } });
  expect(result?.courseworkStudy).toEqual({ assignmentIds: ['second'], suggestTime: true, suggestDate: '2026-11-09' });
  expect(answerCourseworkStudyIntent(input('那明天呢？'))).toBeNull();
});

test('a generic half-hour follow-up has no coursework meaning without the immediate source', () => {
  expect(answerCourseworkStudyIntent({ ...input('幫我找半小時空堂'), read: undefined })).toBeNull();
});

test('normalizing a conversational comma does not erase punctuation from an exact assignment title', () => {
  if (read.result.kind !== 'assignments') throw new Error('fixture');
  const snapshot: CourseworkRead = { ...read, result: { ...read.result, assignments: [
    { ...read.result.assignments[0]!, title: '資料,模型' },
  ] } };
  const result = answerCourseworkStudyIntent({ ...input('找「資料,模型」的半小時準備時間'), read: snapshot });
  expect(result?.courseworkStudy).toEqual({ assignmentIds: ['first'], suggestTime: true });
});

test.each(['2026-02-30', '2026-11-07', '2026-11-15'])(
  'an invalid or out-of-window day never becomes an unrestricted search: %s', (day) => {
    const result = answerCourseworkStudyIntent(input(`幫這份作業找${day}的半小時空堂`));
    expect(result?.courseworkStudy?.suggestTime).toBeUndefined();
    expect(result?.courseworkStudy?.suggestDate).toBeUndefined();
    expect(result?.content).toContain('重新指定有效日期');
  },
);

test('an exact follow-up keeps read-only finding intent while explicit clocks return to manual review', () => {
  const previous = { assignmentIds: ['first', 'second'], suggestTime: true as const };
  const choice = answerCourseworkStudyIntent({ ...input('第二份'), previous });
  expect(choice?.courseworkStudy).toEqual({ assignmentIds: ['second'], suggestTime: true });
  const dated = answerCourseworkStudyIntent({ ...input('明天 19:00 到 19:30'), previous: choice?.courseworkStudy });
  expect(dated?.courseworkStudy).toEqual({ assignmentIds: ['second'],
    time: { date: '2026-11-09', startTime: '19:00', endTime: '19:30' } });
});

test('an unsupported duration remains a manual choice without silently starting a thirty-minute search', () => {
  const result = answerCourseworkStudyIntent(input('幫這份作業找 60 分鐘準備時間'));
  expect(result?.courseworkStudy?.assignmentIds).toEqual(['first', 'second']);
  expect(result?.courseworkStudy?.suggestTime).toBeUndefined();
  expect(result?.courseworkStudy?.time).toBeUndefined();
});

test('a missing ordinal does not automatically search a different remaining assignment', () => {
  const result = answerCourseworkStudyIntent({ ...input('替第十一份作業找空堂'), previous: { assignmentIds: ['first'] } });
  expect(result?.content).toContain('找不到指定的作業');
  expect(result?.courseworkStudy?.assignmentIds).toEqual(['first']);
  expect(result?.courseworkStudy?.suggestTime).toBeUndefined();
});

test('a source-free time request cannot borrow an assignment or become a literal calendar event', () => {
  expect(answerCourseworkStudyIntent({ ...input('幫這份作業找空堂'), read: undefined })?.courseworkStudy).toBeUndefined();
});

test.each(['不要幫這份作業找空堂', '幫這份作業找空堂然後提交', '幫這份作業找空堂並且通知老師'])(
  'finding time does not grant compound or negated actions: %s', (question) => {
    expect(answerCourseworkStudyIntent(input(question))?.courseworkStudy).toBeUndefined();
  },
);

test.each([
  '幫這份作業明天 19:00 到 19:30 安排準備',
  '幫我明天 19:00 到 19:30 安排這份作業的準備時間',
  '幫我安排明天 19:00 到 19:30 這份作業的準備時間',
  '安排這份作業的準備時間在明天 19:00 到 19:30',
])('uses one Taiwan date for explicit source time and leaves same-name choices unresolved: %s', (question) => {
  const result = answerCourseworkStudyIntent(input(question));
  expect(result?.courseworkStudy).toEqual({ assignmentIds: ['first', 'second'],
    time: { date: '2026-11-09', startTime: '19:00', endTime: '19:30' } });
  expect(result?.courseworkRead).toBe(read);
  expect(read.openedAssignmentId).toBeUndefined();
});

test('keeps the proposed time when an exact ID is chosen, without substituting the first same-name assignment', () => {
  const result = answerCourseworkStudyIntent({ ...input('選擇第二份'), choice: { assignmentId: 'second' },
    previous: { assignmentIds: ['first', 'second'], time: { date: '2026-11-09', startTime: '19:00', endTime: '19:30' } } });
  expect(result?.courseworkStudy).toEqual({ assignmentIds: ['second'],
    time: { date: '2026-11-09', startTime: '19:00', endTime: '19:30' } });
});

test('an ordinal follows the displayed order and a typed time follows the chosen ID', () => {
  const result = answerCourseworkStudyIntent({ ...input('第二份'), previous: { assignmentIds: ['second', 'first'] } });
  expect(result?.courseworkStudy?.assignmentIds).toEqual(['first']);
  const timed = answerCourseworkStudyIntent({ ...input('明天 19:00 到 19:30'), previous: result!.courseworkStudy });
  expect(timed?.courseworkStudy).toEqual({ assignmentIds: ['first'],
    time: { date: '2026-11-09', startTime: '19:00', endTime: '19:30' } });
});

test.each(['幫我明天安排這份作業', '安排這份作業', '幫這份作業安排明天晚上準備', '安排第十一份作業的準備時間'])(
  'an incomplete source instruction remains a source-selection form: %s', (question) => {
    const result = answerCourseworkStudyIntent(input(question));
    expect(result?.courseworkStudy?.assignmentIds).toEqual(['first', 'second']);
    expect(result?.courseworkStudy?.time).toBeUndefined();
  },
);

test('quoted duplicate names require a choice even when a different same-name assignment was opened', () => {
  const result = answerCourseworkStudyIntent({ ...input('安排「期末報告」的準備時間'), read: { ...read, openedAssignmentId: 'first' } });
  expect(result?.courseworkStudy?.assignmentIds).toEqual(['first', 'second']);
});

test('an unsupported ordinal never silently substitutes the previously opened assignment', () => {
  const result = answerCourseworkStudyIntent({ ...input('安排第十一份作業的準備時間'), read: { ...read, openedAssignmentId: 'first' } });
  expect(result?.content).toContain('找不到指定的作業');
  expect(result?.courseworkStudy?.assignmentIds).toEqual(['first', 'second']);
});

test('words inside an exact quoted assignment title are data rather than an extra action', () => {
  if (read.result.kind !== 'assignments') throw new Error('fixture');
  const snapshot: CourseworkRead = { ...read, result: { ...read.result, assignments: [
    { ...read.result.assignments[0]!, title: '提交與通知協定' },
  ] } };
  expect(answerCourseworkStudyIntent({ ...input('安排「提交與通知協定」的準備時間'), read: snapshot })?.courseworkStudy)
    .toEqual({ assignmentIds: ['first'] });
});

test.each([
  { owner: 'nuni:student-b' }, { schoolId: 'ncku' }, { uid: 'campus-a' }, { classes: [] },
])('foreign or incomplete anchors cannot become a preparation selection: %j', (anchor) => {
  const result = answerCourseworkStudyIntent({ ...input('安排這份作業的準備時間'), read: { ...read, anchor: { ...read.anchor, ...anchor } } });
  expect(result?.courseworkStudy).toBeUndefined();
});

test('a stale source or an unlisted exact ID cannot authorize a replacement', () => {
  expect(answerCourseworkStudyIntent({ ...input('安排這份作業的準備時間'), read: { ...read, changedAssignmentId: 'second' } })?.courseworkStudy).toBeUndefined();
  expect(answerCourseworkStudyIntent({ ...input('選擇'), previous: { assignmentIds: ['first'] }, choice: { assignmentId: 'second' } })?.courseworkStudy).toBeUndefined();
});

test.each(['幫我明天 19:00 到 20:00 安排英文作業複習', '幫我明天 19:00 到 20:00 安排英文讀書', '明天的作業有哪些？'])(
  'literal events and unrelated coursework remain with their existing handlers: %s', (question) => {
    expect(answerCourseworkStudyIntent(input(question))).toBeNull();
  },
);

test.each(['幫這份作業明天 19:00 到 19:30 安排準備，順便提交', '不要安排這份作業的準備時間', '安排這份作業的準備時間\n並且通知老師'])(
  'a compound or negated request cannot become a reviewable action: %s', (question) => {
    expect(answerCourseworkStudyIntent(input(question))?.courseworkStudy).toBeUndefined();
  },
);

test.each(['今天 19:00 到 19:30', '2026-02-30 19:00 到 19:30', '明天 20:00 到 19:00'])(
  'invalid or elapsed times keep selection but require explicit correction: %s', (question) => {
    const result = answerCourseworkStudyIntent({ ...input(question), previous: { assignmentIds: ['second'] } });
    expect(result?.courseworkStudy).toEqual({ assignmentIds: ['second'] });
  },
);
