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
