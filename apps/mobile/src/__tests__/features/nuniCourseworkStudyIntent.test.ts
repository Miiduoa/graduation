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
