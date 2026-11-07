import { compareCampusPlans, type CampusPlanComparisonBasis } from '../../services/campusPlanComparison';
import type { CampusEvidencePlan } from '../../services/offlineCampusPlanner';

type Assignment = CampusPlanComparisonBasis['assignments']['items'][number];

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    identity: ['course-a', 'report-a'], title: '期末報告', groupName: '資料庫',
    dueAt: '2026-11-06T15:59:00.000Z', ...overrides,
  };
}

function plan(items: Assignment[] = [assignment()]): CampusEvidencePlan {
  return {
    title: '接下來七天的學習行動', overview: '手機課表與已授權作業摘要',
    checkedAt: '2026-11-06T01:00:00.000Z',
    steps: [{ id: 'assignment-0', title: '期末報告', detail: '請到作業頁核對。',
      evidence: 'authorized-assignments', priority: 'urgent', route: '/classroom' }],
    limitations: [], content: '學習行動',
    agenda: {
      timetableAvailable: true, assignmentsAvailable: true, ignoredCourses: 0, outsideWindow: [],
      days: [
        { date: '2026-11-06', label: '11/6（週五）',
          courses: [{ name: '資料庫', day: 5, start: 1, end: 2, room: 'A301' }],
          gaps: [], conflicts: [], deadlines: [] },
        { date: '2026-11-07', label: '11/7（週六）', courses: [], gaps: [], conflicts: [], deadlines: [] },
      ],
    },
    comparisonBasis: {
      assignments: { status: 'complete', total: items.length, checkedAt: '2026-11-06T01:00:00.000Z', items },
      timetableUpdatedAt: '2026-11-05T08:00:00.000Z',
    },
  };
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function later(before: CampusEvidencePlan): CampusEvidencePlan {
  const after = clone(before);
  after.checkedAt = '2026-11-06T02:00:00.000Z';
  if (after.comparisonBasis) after.comparisonBasis.assignments.checkedAt = after.checkedAt;
  return after;
}

function assignmentChanges(before: CampusEvidencePlan, after: CampusEvidencePlan) {
  return compareCampusPlans(before, after).changes.filter((change) => change.category === 'assignment');
}

function clockPlan(): CampusEvidencePlan {
  const result = plan([]);
  for (const day of result.agenda!.days) {
    day.courses = [];
    day.scheduledClasses = [];
  }
  result.agenda!.days[0].scheduledClasses = [{ name: '資料庫', room: 'A301',
    startAt: '2026-11-06T01:10:00Z', endAt: '2026-11-06T03:00:00Z' }];
  return result;
}

function quizPlan(): CampusEvidencePlan {
  const result = plan();
  result.agenda!.quizzesAvailable = true;
  result.comparisonBasis!.quizzes = {
    status: 'complete', checkedAt: result.checkedAt, total: 1,
    // A colliding tuple deliberately verifies that activity types remain distinct.
    items: [assignment({ title: '資料庫小考' })],
  };
  return result;
}

function laterWithQuizzes(before: CampusEvidencePlan): CampusEvidencePlan {
  const after = later(before);
  after.comparisonBasis!.quizzes!.checkedAt = after.checkedAt;
  return after;
}

test('assignment and quiz source identities never collide and use separate deadline language', () => {
  const before = quizPlan();
  const after = laterWithQuizzes(before);
  after.comparisonBasis!.assignments.items[0].dueAt = '2026-11-07T15:59:00Z';
  after.comparisonBasis!.quizzes!.items[0].dueAt = '2026-11-06T12:00:00Z';
  const result = compareCampusPlans(before, after);
  const changes = result.changes.filter((change) => change.category === 'assignment' || change.category === 'quiz');
  expect(changes).toHaveLength(2);
  expect(new Set(changes.map((change) => change.id)).size).toBe(2);
  expect(changes[0]).toMatchObject({ category: 'quiz', kind: 'changed',
    before: expect.stringContaining('參考期限 2026/11/6 23:59'),
    after: expect.stringContaining('參考期限 2026/11/6 20:00'),
    detail: '測驗參考期限有變動。請開啟測驗頁核對。' });
  expect(changes[1]).toMatchObject({ category: 'assignment', kind: 'changed',
    detail: '截止時間有變動。請開啟作業頁核對。' });
  expect(result.unchangedAssignments).toBe(0);
  expect(result.unchangedQuizzes).toBe(0);
});

test('upgrading a plan without quiz history does not call observed quizzes newly published', () => {
  const before = plan();
  const after = laterWithQuizzes(quizPlan());
  const result = compareCampusPlans(before, after);
  expect(result.changes.filter((change) => change.category === 'quiz')).toEqual([]);
  expect(result.changes).toContainEqual(expect.objectContaining({ id: 'source:quiz-history', kind: 'unverifiable',
    detail: expect.stringContaining('原計畫未保存測驗來源，這次開始納入') }));
  expect(result.unchangedAssignments).toBe(1);
  expect(compareCampusPlans(before, later(before)).changes).toEqual([]);
  expect(compareCampusPlans(before, later(before)).unchangedQuizzes).toBeUndefined();
});

test('a failed quiz read cannot turn quizzes into removed or completed work and does not block assignment comparisons', () => {
  const before = quizPlan();
  const after = laterWithQuizzes(before);
  after.comparisonBasis!.assignments.items[0].title = '作業名稱更新';
  after.comparisonBasis!.quizzes = { status: 'unavailable', checkedAt: null, total: null, items: [] };
  after.agenda!.quizzesAvailable = false;
  const result = compareCampusPlans(before, after);
  expect(result.changes.filter((change) => change.category === 'quiz')).toEqual([]);
  expect(result.changes).toContainEqual(expect.objectContaining({ id: 'source:quiz-coverage', kind: 'unverifiable',
    detail: '這次無法讀取測驗，未出現的項目不能視為已完成。' }));
  expect(result.changes).toContainEqual(expect.objectContaining({ category: 'assignment', kind: 'changed', title: '作業名稱更新' }));
});

test.each(['assignment', 'quiz'] as const)('an older %s snapshot only stops that source from being compared', (older) => {
  const before = quizPlan();
  const after = laterWithQuizzes(before);
  const previousSource = older === 'quiz' ? after.comparisonBasis!.quizzes! : after.comparisonBasis!.assignments;
  previousSource.checkedAt = '2026-11-06T00:00:00Z';
  after.comparisonBasis!.assignments.items[0].title = '新作業名稱';
  after.comparisonBasis!.quizzes!.items[0].title = '新測驗名稱';
  const result = compareCampusPlans(before, after);
  expect(result.changes.filter((change) => change.category === older)).toEqual([]);
  expect(result.changes).toContainEqual(expect.objectContaining({ id: 'source:' + older + '-time', kind: 'unverifiable' }));
  expect(result.changes).toContainEqual(expect.objectContaining({ category: older === 'quiz' ? 'assignment' : 'quiz', kind: 'changed' }));
});

test('partial quiz coverage never borrows complete assignment coverage to infer missing or added quizzes', () => {
  const before = quizPlan();
  before.comparisonBasis!.quizzes!.status = 'partial';
  before.comparisonBasis!.quizzes!.total = null;
  const after = laterWithQuizzes(before);
  after.comparisonBasis!.quizzes!.items = [assignment({ identity: ['course-a', 'other-quiz'], title: '另一份測驗' })];
  const changes = compareCampusPlans(before, after).changes.filter((change) => change.category === 'quiz');
  expect(changes).toHaveLength(2);
  expect(changes.every((change) => change.kind === 'unverifiable')).toBe(true);
  expect(changes.every((change) => change.detail.includes('測驗'))).toBe(true);
});

test('a quiz absent from a complete current summary remains unproven as completed', () => {
  const before = quizPlan();
  const after = laterWithQuizzes(before);
  after.comparisonBasis!.quizzes!.items = [];
  after.comparisonBasis!.quizzes!.total = 0;
  expect(compareCampusPlans(before, after).changes).toContainEqual(expect.objectContaining({
    category: 'quiz', kind: 'missing', detail: '本次摘要未列出這項測驗；這不能證明已作答或完成，請到課程頁核對。',
  }));
});

test('missing and duplicate quiz identifiers do not affect matching assignment identities', () => {
  const before = quizPlan();
  const after = laterWithQuizzes(before);
  after.comparisonBasis!.quizzes!.items.push(assignment(), assignment({ identity: null }));
  after.comparisonBasis!.quizzes!.total = 3;
  const result = compareCampusPlans(before, after);
  expect(result.unchangedAssignments).toBe(1);
  expect(result.unchangedQuizzes).toBe(0);
  expect(result.changes.filter((change) => change.category === 'assignment' || change.category === 'quiz')).toEqual([]);
  expect(result.changes).toContainEqual(expect.objectContaining({ id: 'source:quiz-identities', kind: 'unverifiable' }));
});

test('quiz freshness warnings and unchanged counts are tracked independently', () => {
  const before = quizPlan();
  const after = later(before);
  const result = compareCampusPlans(before, after);
  expect(result).toMatchObject({ unchangedAssignments: 1, unchangedQuizzes: 1, changes: [] });
  expect(result.limitations).toContain('本次沿用同一次測驗同步資料，尚未取得較新的校方摘要。');
  expect(result.limitations).not.toContain('本次沿用同一次作業同步資料，尚未取得較新的校方摘要。');
});

test('a missing quiz reference deadline is not a cancelled deadline', () => {
  const before = quizPlan();
  const after = laterWithQuizzes(before);
  after.comparisonBasis!.quizzes!.items[0].dueAt = null;
  expect(compareCampusPlans(before, after).changes).toContainEqual(expect.objectContaining({
    category: 'quiz', kind: 'unverifiable', after: expect.stringContaining('參考期限未確認'),
    detail: '本次測驗參考期限未確認，不能視為取消期限。請開啟測驗頁核對。',
  }));
});

test('compares every source row, including tasks omitted from the summary steps', () => {
  const before = plan(Array.from({ length: 7 }, (_, index) => assignment({
    identity: ['course-a', 'report-' + index], title: '報告 ' + index,
  })));
  const after = later(before);
  after.comparisonBasis!.assignments.items[6].dueAt = '2026-11-08T15:59:00Z';
  const result = compareCampusPlans(before, after);
  expect(result.changes.filter((change) => change.category === 'assignment')).toEqual([
    expect.objectContaining({ kind: 'changed', title: '報告 6', before: expect.stringContaining('2026/11/6 23:59'),
      after: expect.stringContaining('2026/11/8 23:59') }),
  ]);
  expect(result.unchangedAssignments).toBe(6);
});

test('changing source order or summary priority does not invent a task change', () => {
  const before = plan([
    assignment(), assignment({ identity: ['course-a', 'report-b'], title: '第二份報告' }),
    assignment({ identity: ['course-b', 'report-a'], groupName: '程式設計' }),
  ]);
  const after = later(before);
  after.comparisonBasis!.assignments.items.reverse();
  after.steps[0] = { ...after.steps[0], id: 'assignment-2', priority: 'overdue' };
  const result = compareCampusPlans(before, after);
  expect(result.unchangedAssignments).toBe(3);
  expect(result.changes).toEqual([]);
});

test('same-name tasks with reversed deadlines are paired by their exact source tuple', () => {
  const before = plan([
    assignment(), assignment({ identity: ['course-a', 'report-b'], dueAt: '2026-11-07T15:59:00Z' }),
  ]);
  const after = later(before);
  after.comparisonBasis!.assignments.items = [
    assignment({ identity: ['course-a', 'report-b'], dueAt: '2026-11-06T15:59:00Z' }),
    assignment({ dueAt: '2026-11-07T15:59:00Z' }),
  ];
  const changes = assignmentChanges(before, after);
  expect(changes).toHaveLength(2);
  expect(changes.every((change) => change.kind === 'changed')).toBe(true);
  expect(changes.find((change) => change.id.endsWith('["course-a","report-a"]')))
    .toMatchObject({ before: expect.stringContaining('2026/11/6'), after: expect.stringContaining('2026/11/7') });
  expect(changes.find((change) => change.id.endsWith('["course-a","report-b"]')))
    .toMatchObject({ before: expect.stringContaining('2026/11/7'), after: expect.stringContaining('2026/11/6') });
  expect(new Set(changes.map((change) => change.id)).size).toBe(2);
});

test.each([
  ['course-b', 'report-a'], ['course-a', 'report-b'],
])('a different source tuple stays distinct even when its title and deadline match: %j', (groupId, assignmentId) => {
  const before = plan();
  const after = later(plan([assignment({ identity: [groupId, assignmentId] })]));
  const changes = assignmentChanges(before, after);
  expect(changes.map((change) => change.kind).sort()).toEqual(['added', 'missing']);
  expect(changes.find((change) => change.kind === 'missing')?.detail).toContain('不能證明已繳交');
});

test('a title and course-name update retains the same task identity', () => {
  const before = plan();
  const after = later(before);
  Object.assign(after.comparisonBasis!.assignments.items[0], { title: '期末專題', groupName: '資料庫系統' });
  expect(assignmentChanges(before, after)).toEqual([
    expect.objectContaining({ kind: 'changed', title: '期末專題',
      before: expect.stringContaining('資料庫｜期末報告'), after: expect.stringContaining('資料庫系統｜期末專題') }),
  ]);
});

test('an earlier deadline stays ahead of many new tasks and partial-source notices', () => {
  const before = plan([
    assignment({ identity: ['z-course', 'early'], title: '提前截止的報告' }),
    assignment({ identity: ['a-course', 'later'], title: '延後截止的報告' }),
  ]);
  const after = later(before);
  after.comparisonBasis!.assignments.items[0].dueAt = '2026-11-06T07:00:00Z';
  after.comparisonBasis!.assignments.items[1].dueAt = '2026-11-10T15:59:00Z';
  after.comparisonBasis!.assignments.items.unshift(...Array.from({ length: 15 }, (_, index) =>
    assignment({ identity: ['a-course', 'added-' + index], title: '新列出的作業 ' + index })));
  after.comparisonBasis!.assignments.status = 'partial';
  after.comparisonBasis!.assignments.total = 50;
  const result = compareCampusPlans(before, after);
  expect(result.changes[0]).toMatchObject({ kind: 'changed', title: '提前截止的報告' });
  expect(result.changes[1]).toMatchObject({ kind: 'changed', title: '延後截止的報告' });
  expect(result.changes[2]).toMatchObject({ category: 'source', kind: 'unverifiable' });
  expect(result.changes.filter((change) => change.kind === 'added')).toHaveLength(15);
});

test('equivalent timezone offsets compare as one deadline, with no change from the clock advancing', () => {
  const before = plan();
  const after = later(before);
  after.comparisonBasis!.assignments.items[0].dueAt = '2026-11-06T23:59:00+08:00';
  after.steps[0].priority = 'overdue';
  expect(assignmentChanges(before, after)).toEqual([]);
  expect(compareCampusPlans(before, after).unchangedAssignments).toBe(1);
});

test('a deadline change within one minute remains visible in the comparison', () => {
  const before = plan();
  const after = later(before);
  after.comparisonBasis!.assignments.items[0].dueAt = '2026-11-06T15:59:15.500Z';
  expect(assignmentChanges(before, after)[0]).toMatchObject({ kind: 'changed',
    before: expect.stringContaining('23:59'), after: expect.stringContaining('23:59:15.500') });
});

test.each([null, '2026-11-06', '2026-11-06T23:59:00'])('an unconfirmed current deadline is not a cancelled deadline: %s', (dueAt) => {
  const before = plan();
  const after = later(before);
  after.comparisonBasis!.assignments.items[0].dueAt = dueAt;
  expect(assignmentChanges(before, after)).toEqual([
    expect.objectContaining({ kind: 'unverifiable', after: expect.stringContaining('截止時間未確認'),
      detail: expect.stringContaining('不能視為取消期限') }),
  ]);
});

test('obtaining the first confirmed deadline is reported without inventing an earlier deadline', () => {
  const before = plan([assignment({ dueAt: null })]);
  const after = later(before);
  after.comparisonBasis!.assignments.items[0].dueAt = '2026-11-06T15:59:00Z';
  expect(assignmentChanges(before, after)).toEqual([
    expect.objectContaining({ kind: 'changed', before: expect.stringContaining('截止時間未確認'),
      detail: expect.stringContaining('本次取得') }),
  ]);
});

test('missing identities do not pair by the same title, course or summary position', () => {
  const before = plan([assignment({ identity: null })]);
  const after = later(before);
  after.comparisonBasis!.assignments.items[0].dueAt = '2026-11-09T15:59:00Z';
  const result = compareCampusPlans(before, after);
  expect(result.unchangedAssignments).toBe(0);
  expect(result.changes.filter((change) => change.category === 'assignment')).toEqual([]);
  expect(result.changes).toContainEqual(expect.objectContaining({ category: 'source', kind: 'unverifiable', title: '部分作業無法一一對照' }));
});

test.each(['before', 'after'] as const)('duplicate identities in %s invalidate both sides of that pairing', (side) => {
  const before = plan([assignment(), assignment({ identity: ['course-b', 'report-b'], title: '另一課的報告' })]);
  const after = later(before);
  const duplicate = (side === 'before' ? before : after).comparisonBasis!.assignments;
  duplicate.items.push(assignment({ dueAt: '2026-11-10T15:59:00Z' }));
  duplicate.total = duplicate.items.length;
  const result = compareCampusPlans(before, after);
  expect(result.unchangedAssignments).toBe(1);
  expect(result.changes.filter((change) => change.category === 'assignment')).toEqual([]);
  expect(result.changes).toContainEqual(expect.objectContaining({ category: 'source', detail: expect.stringContaining('識別重複') }));
});

test('newly visible tasks from a previously partial source are not declared newly added', () => {
  const before = plan();
  before.comparisonBasis!.assignments.status = 'partial';
  before.comparisonBasis!.assignments.total = 2;
  const after = later(plan([assignment(), assignment({ identity: ['course-b', 'report-b'], title: '之前未讀到的報告' })]));
  expect(assignmentChanges(before, after)).toEqual([
    expect.objectContaining({ kind: 'unverifiable', title: '之前未讀到的報告', detail: expect.stringContaining('無法判定是否新增') }),
  ]);
});

test('tasks omitted from a partial current read are not reported as removed or completed', () => {
  const before = plan();
  const after = later(plan([]));
  after.comparisonBasis!.assignments.status = 'partial';
  after.comparisonBasis!.assignments.total = 50;
  expect(assignmentChanges(before, after)).toEqual([
    expect.objectContaining({ kind: 'unverifiable', detail: expect.stringContaining('未判定為移除或完成') }),
  ]);
});

test.each(['before', 'after'] as const)('an unavailable %s source produces a source warning, never fabricated additions or removals', (side) => {
  const before = plan();
  const after = later(plan([]));
  Object.assign((side === 'before' ? before : after).comparisonBasis!.assignments,
    { status: 'unavailable', total: null, checkedAt: null, items: [] });
  const result = compareCampusPlans(before, after);
  expect(result.changes.filter((change) => change.category === 'assignment')).toEqual([]);
  expect(result.changes).toContainEqual(expect.objectContaining({ category: 'source', kind: 'unverifiable', title: '作業資料仍有待核對' }));
});

test('even a complete empty read cannot prove an old task was submitted', () => {
  const changes = assignmentChanges(plan(), later(plan([])));
  expect(changes).toEqual([expect.objectContaining({ kind: 'missing',
    detail: '本次摘要未列出；這不能證明已繳交，請到課程頁核對。', route: '/classroom' })]);
});

test('a complete label with inconsistent totals cannot establish an absence', () => {
  const before = plan();
  const after = later(plan([]));
  after.comparisonBasis!.assignments.total = 1;
  const result = compareCampusPlans(before, after);
  expect(result.changes.filter((change) => change.category === 'assignment')).toEqual([
    expect.objectContaining({ kind: 'unverifiable' }),
  ]);
  expect(result.limitations).toContain('本次的作業總數與已讀內容不一致，未據此判定新增或未列出項目。');
});

test('an unidentified item in an otherwise complete list can still be the old task', () => {
  const before = plan();
  const after = later(plan([assignment({ identity: null })]));
  expect(assignmentChanges(before, after)).toEqual([expect.objectContaining({ kind: 'unverifiable' })]);
  const reverse = assignmentChanges(after, { ...before, comparisonBasis: {
    ...before.comparisonBasis!, assignments: { ...before.comparisonBasis!.assignments, checkedAt: after.checkedAt },
  } });
  expect(reverse).toEqual([expect.objectContaining({ kind: 'unverifiable' })]);
});

test.each(['before', 'after'] as const)('legacy %s plans without comparison metadata remain readable without guessed task matches', (side) => {
  const before = plan();
  const after = later(before);
  delete (side === 'before' ? before : after).comparisonBasis;
  const result = compareCampusPlans(before, after);
  expect(result.changes.filter((change) => change.category === 'assignment')).toEqual([]);
  expect(result.changes).toContainEqual(expect.objectContaining({ category: 'source', kind: 'unverifiable', title: '作業來源無法完整比對' }));
  expect(result.comparableDates).toBe(2);
});

test('a newer plan timestamp does not turn the same source snapshot into a new synchronization', () => {
  const before = plan();
  const after = clone(before);
  after.checkedAt = '2026-11-06T02:00:00Z';
  const result = compareCampusPlans(before, after);
  expect(result.currentCheckedAt).toBe(after.checkedAt);
  expect(result.previousCheckedAt).toBe(before.checkedAt);
  expect(result.limitations).toContain('本次沿用同一次作業同步資料，尚未取得較新的校方摘要。');
  expect(result.unchangedAssignments).toBe(1);
});

test('an older source is not used to announce a deadline change, despite a newer plan timestamp', () => {
  const before = plan();
  const after = later(before);
  after.comparisonBasis!.assignments.checkedAt = '2026-11-05T01:00:00Z';
  after.comparisonBasis!.assignments.items[0].dueAt = '2026-11-10T15:59:00Z';
  const result = compareCampusPlans(before, after);
  expect(result.changes.filter((change) => change.category === 'assignment')).toEqual([]);
  expect(result.unchangedAssignments).toBe(0);
  expect(result.changes).toContainEqual(expect.objectContaining({ title: '本次作業資料較舊', kind: 'unverifiable' }));
});

test('a rolling planning window compares only shared dates, without turning the past day into a cancellation', () => {
  const before = plan();
  const after = later(before);
  after.agenda!.days = [clone(before.agenda!.days[1]),
    { date: '2026-11-08', label: '11/8（週日）', courses: [], gaps: [], conflicts: [], deadlines: [] }];
  const result = compareCampusPlans(before, after);
  expect(result.comparableDates).toBe(1);
  expect(result.changes).toEqual([expect.objectContaining({ category: 'scope', kind: 'window',
    before: '2026/11/06–2026/11/07', after: '2026/11/07–2026/11/08' })]);
});

test('nonoverlapping planning dates are explicitly incomparable rather than unchanged', () => {
  const before = plan();
  const after = later(before);
  after.agenda!.days = [{ date: '2026-11-13', label: '11/13（週五）',
    courses: clone(before.agenda!.days[0].courses), gaps: [], conflicts: [], deadlines: [] }];
  const result = compareCampusPlans(before, after);
  expect(result.comparableDates).toBe(0);
  expect(result.changes).toContainEqual(expect.objectContaining({ kind: 'window',
    detail: '兩份計畫沒有重疊日期，無法逐日比較課程。' }));
  expect(result.changes.some((change) => change.category === 'timetable')).toBe(false);
});

test('course order and derived gap order do not change a day; room changes show both complete copies', () => {
  const before = plan();
  before.agenda!.days[0].courses.push({ name: '程式設計', day: 5, start: 5, end: 6, room: 'B301' });
  const after = later(before);
  after.agenda!.days[0].courses.reverse();
  after.agenda!.days[0].gaps = [{ start: 3, end: 4 }];
  expect(compareCampusPlans(before, after).changes).toEqual([]);
  after.agenda!.days[0].courses[0].room = 'B501';
  expect(compareCampusPlans(before, after).changes).toEqual([
    expect.objectContaining({ category: 'timetable', kind: 'changed',
      title: '2026/11/06 課表有差異', before: expect.stringContaining('第 5–6 節｜程式設計 · B301'),
      after: expect.stringContaining('第 5–6 節｜程式設計 · B501') }),
  ]);
});

test('same-name class duplicates retain their multiplicity when comparing a date', () => {
  const before = plan();
  before.agenda!.days[0].courses.push(clone(before.agenda!.days[0].courses[0]));
  const after = later(before);
  after.agenda!.days[0].courses.pop();
  const changes = compareCampusPlans(before, after).changes;
  expect(changes).toHaveLength(1);
  expect(changes[0].category).toBe('timetable');
  expect(changes[0].before?.split('\n')).toHaveLength(2);
  expect(changes[0].after?.split('\n')).toHaveLength(1);
});

test('clock meetings with equivalent offsets and reordered copies remain unchanged', () => {
  const before = clockPlan();
  before.agenda!.days[0].scheduledClasses!.push({ name: '資料庫', room: 'B301',
    startAt: '2026-11-06T05:10:00Z', endAt: '2026-11-06T07:00:00Z' });
  const after = later(before);
  after.agenda!.days[0].scheduledClasses = [
    { name: '資料庫', room: 'B301', startAt: '2026-11-06T13:10:00+08:00', endAt: '2026-11-06T15:00:00+08:00' },
    { name: '資料庫', room: 'A301', startAt: '2026-11-05T20:10:00-05:00', endAt: '2026-11-06T11:00:00+08:00' },
  ];
  expect(compareCampusPlans(before, after)).toMatchObject({ changes: [], comparableDates: 2 });
});

test('clock time and room changes display actual times, including changes within a minute', () => {
  const before = clockPlan();
  const after = later(before);
  Object.assign(after.agenda!.days[0].scheduledClasses![0], {
    startAt: '2026-11-06T01:40:00Z', endAt: '2026-11-06T03:00:15.500Z', room: 'B501',
  });
  expect(compareCampusPlans(before, after).changes).toEqual([
    expect.objectContaining({ category: 'timetable', kind: 'changed',
      before: '09:10–11:00｜資料庫 · A301', after: '09:40–11:00:15.500｜資料庫 · B501' }),
  ]);
});

test('identical clock meetings retain duplicate counts rather than matching by name', () => {
  const before = clockPlan();
  before.agenda!.days[0].scheduledClasses!.push(clone(before.agenda!.days[0].scheduledClasses![0]));
  const after = later(before);
  after.agenda!.days[0].scheduledClasses!.pop();
  const changes = compareCampusPlans(before, after).changes;
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ category: 'timetable', kind: 'changed' });
  expect(changes[0].before?.split('\n')).toHaveLength(2);
  expect(changes[0].after?.split('\n')).toHaveLength(1);
});

test('an overnight Sunday meeting remains dated in both daily comparisons', () => {
  const before = clockPlan();
  const overnight = { name: '跨夜實作', room: 'A301', startAt: '2026-11-08T15:30:00Z', endAt: '2026-11-08T17:00:00Z' };
  before.agenda!.days = [
    { date: '2026-11-08', label: '11/8（週日）', courses: [], gaps: [], conflicts: [], deadlines: [], scheduledClasses: [{ ...overnight }] },
    { date: '2026-11-09', label: '11/9（週一）', courses: [], gaps: [], conflicts: [], deadlines: [], scheduledClasses: [{ ...overnight }] },
  ];
  const after = later(before);
  for (const day of after.agenda!.days) day.scheduledClasses![0].endAt = '2026-11-09T01:30:00+08:00';
  const result = compareCampusPlans(before, after);
  expect(result.comparableDates).toBe(2);
  expect(result.changes).toEqual(['2026/11/08', '2026/11/09'].map((date) => expect.objectContaining({
    category: 'timetable', title: date + ' 課表有差異',
    before: '11/8 23:30–11/9 01:00｜跨夜實作 · A301', after: '11/8 23:30–11/9 01:30｜跨夜實作 · A301',
  })));
});

test.each([false, true])('legacy period and clock schemas are incomparable, including empty days (%s)', (empty) => {
  const before = plan([]);
  if (empty) before.agenda!.days[0].courses = [];
  const after = later(clockPlan());
  if (empty) after.agenda!.days[0].scheduledClasses = [];
  const result = compareCampusPlans(before, after);
  expect(result.comparableDates).toBe(0);
  expect(result.changes).toEqual([expect.objectContaining({ category: 'source', kind: 'unverifiable',
    title: '課表時間格式無法對照', detail: expect.stringContaining('未以同名猜測同一堂課') })]);
});

test('an unread clock source cannot be treated as an empty schedule', () => {
  const before = clockPlan();
  const after = later(before);
  after.agenda!.timetableAvailable = false;
  for (const day of after.agenda!.days) delete day.scheduledClasses;
  expect(compareCampusPlans(before, after)).toMatchObject({ comparableDates: 0,
    changes: [expect.objectContaining({ category: 'source', kind: 'unverifiable', title: '課表來源無法核對' })] });
});

test('a missing timetable source never becomes an empty or cancelled class day', () => {
  const before = plan();
  const after = later(before);
  after.agenda!.timetableAvailable = false;
  after.agenda!.days[0].courses = [];
  const result = compareCampusPlans(before, after);
  expect(result.comparableDates).toBe(0);
  expect(result.changes).toEqual([expect.objectContaining({ category: 'source', kind: 'unverifiable',
    title: '課表來源無法核對', detail: expect.stringContaining('不能當作課程已取消') })]);
});

test('missing agendas and unplaced courses keep their limitations visible', () => {
  const before = plan();
  const after = later(before);
  delete before.agenda;
  expect(compareCampusPlans(before, after).limitations).toContain('原計畫沒有逐日課表，無法按日期核對課程。');
  before.agenda = clone(after.agenda!);
  before.agenda.ignoredCourses = 1;
  expect(compareCampusPlans(before, after).limitations).toContain('課表含未排時段或格式不完整的課程，只核對已列出的課程。');
});

test('comparison is read-only and does not carry positional progress into the new plan', () => {
  const before = plan();
  const after = later(before);
  after.comparisonBasis!.assignments.items[0].title = '更新後報告';
  const oldJson = JSON.stringify(before);
  const newJson = JSON.stringify(after);
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(before); freeze(after);
  const first = compareCampusPlans(before, after);
  expect(compareCampusPlans(before, after)).toEqual(first);
  expect(JSON.stringify(before)).toBe(oldJson);
  expect(JSON.stringify(after)).toBe(newJson);
  expect(JSON.stringify(first)).not.toContain('assignment-0');
});
