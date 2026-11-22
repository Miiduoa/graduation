import { parseCampusAssignmentSource } from '../../services/campusAssignmentSource';
import { campusAssignmentDisplayTitle, resolveCampusAssignmentTarget } from '../../services/campusAssignmentTarget';
import { refreshCampusSenseSnapshot, type CampusSenseSnapshot } from '../../services/campusSenseSnapshot';

const mockCallable = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCallable }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: { uid: 'A' } }),
  getFunctionsInstance: () => ({}),
  isFirebaseMockMode: () => false,
}));

const now = Date.parse('2026-10-27T06:00:00Z');
const source = { kind: 'group-assignment' as const, groupId: 'course_1', assignmentId: 'work_1' };
const assignment = { title: '資料庫報告', groupName: '資料庫', dueAt: '2026-10-30T09:00:00Z' };
const scope = { uid: 'A', schoolId: 'pu' };
function snapshot(): CampusSenseSnapshot {
  return {
    userId: 'A', schoolId: 'pu', checkedAt: new Date(now).toISOString(),
    schedule: { status: 'unavailable', count: null },
    assignments: { status: 'available', count: 1, items: [{ ...assignment, source }] },
    announcements: { status: 'unavailable', items: [] },
  };
}
const resolve = (value = snapshot()) => resolveCampusAssignmentTarget({ assignment, snapshot: value, scope, now });

afterEach(() => { jest.restoreAllMocks(); mockCallable.mockReset(); });

test('resolves only a fixed internal destination with server-provided identifiers', () => {
  expect(resolve()).toEqual({ route: 'HomeworkSubmit', params: { groupId: 'course_1', assignmentId: 'work_1' } });
  expect(mockCallable).not.toHaveBeenCalled();
});

test.each([null, [], {}, { kind: 'url', groupId: 'course_1', assignmentId: 'work_1' },
  { ...source, groupId: '../other' }, { ...source, assignmentId: 'https://evil.example' },
  { ...source, assignmentId: '%2f' }, { ...source, groupId: '' },
  { ...source, assignmentId: 'a'.repeat(129) }])('rejects unsupported or malformed source %j', (value) => {
  expect(parseCampusAssignmentSource(value)).toBeNull();
});

test('strips extra URL, route and mutation fields from a source reference', () => {
  expect(parseCampusAssignmentSource({ ...source, url: 'https://invalid.example', route: 'Payment', submit: true }))
    .toEqual(source);
});

test.each(['account', 'school', 'expired', 'future', 'unavailable'])(
  'does not create an assignment handoff from %s data', (kind) => {
    const value = snapshot();
    if (kind === 'account') value.userId = 'B';
    if (kind === 'school') value.schoolId = 'other';
    if (kind === 'expired') value.checkedAt = new Date(now - 900_001).toISOString();
    if (kind === 'future') value.checkedAt = new Date(now + 30_001).toISOString();
    if (kind === 'unavailable') value.assignments.status = 'unavailable';
    expect(resolve(value)).toBeNull();
  },
);

test('old snapshots remain readable but do not invent assignment identifiers', () => {
  const value = snapshot();
  delete value.assignments.items[0].source;
  expect(resolve(value)).toBeNull();
});

test('ambiguous same-title tasks never choose the first row', () => {
  const value = snapshot();
  value.assignments.items.push({ ...assignment, source: { ...source, assignmentId: 'work_2' } });
  value.assignments.count = 2;
  expect(resolve(value)).toBeNull();
});

test.each(['title', 'groupName', 'dueAt'] as const)('a modified %s cannot point at a different task', (field) => {
  expect(resolveCampusAssignmentTarget({
    assignment: { ...assignment, [field]: 'changed' }, snapshot: snapshot(), scope, now,
  })).toBeNull();
});

test('a known task without a due date can still open for inspection', () => {
  const value = snapshot();
  value.assignments.items[0].dueAt = null;
  expect(resolveCampusAssignmentTarget({ assignment: { ...assignment, dueAt: null }, snapshot: value, scope, now }))
    .toEqual({ route: 'HomeworkSubmit', params: { groupId: 'course_1', assignmentId: 'work_1' } });
});

test('different groups distinguish otherwise identical task titles', () => {
  const value = snapshot();
  value.assignments.items.push({ ...assignment, groupName: '另一門課', source: { ...source, groupId: 'course_2' } });
  expect(resolve(value)?.params.groupId).toBe('course_1');
});

test('a complete long title opens only its verified source, ignoring fabricated candidate IDs', () => {
  const value = snapshot();
  const fullTitle = '長'.repeat(130) + '原始作業';
  value.assignments.items[0].title = fullTitle;
  const candidate = { ...assignment, title: fullTitle, source: { ...source, assignmentId: 'fake' } };
  expect(resolveCampusAssignmentTarget({ assignment: candidate, snapshot: value, scope, now }))
    .toEqual({ route: 'HomeworkSubmit', params: { groupId: 'course_1', assignmentId: 'work_1' } });
});

test('does not use a 130-character display prefix to open a different original assignment', () => {
  const value = snapshot();
  const prefix = '長'.repeat(130);
  value.assignments.items[0].title = prefix + '期末報告';
  const target = (title: string) => resolveCampusAssignmentTarget({
    assignment: { ...assignment, title }, snapshot: value, scope, now,
  });
  // Previously both a truncated plan title and a different full title opened work_1.
  expect(target(prefix)).toBeNull();
  expect(target(prefix + '另一份作業')).toBeNull();
  expect(target(prefix + '期末報告')).toEqual({
    route: 'HomeworkSubmit', params: { groupId: 'course_1', assignmentId: 'work_1' },
  });
  value.assignments.items.push({ ...assignment, title: prefix, source: { ...source, assignmentId: 'work_2' } });
  value.assignments.count = 2;
  expect(target(prefix)).toBeNull();
  expect(target(prefix + ' ')).toBeNull();
  expect(target(prefix + '期末報告')?.params.assignmentId).toBe('work_1');
});

test.each([false, true])('preserves a trailing display space when checking collisions (reverse: %s)', (reverse) => {
  const value = snapshot();
  const title = '長'.repeat(129);
  const longerTitle = title + ' 後綴';
  const displayTitle = campusAssignmentDisplayTitle(longerTitle);
  value.assignments.items[0].title = title;
  value.assignments.items.push({ ...assignment, title: longerTitle, source: { ...source, assignmentId: 'work_2' } });
  value.assignments.count = 2;
  if (reverse) value.assignments.items.reverse();
  const target = (candidate: string) => resolveCampusAssignmentTarget({
    assignment: { ...assignment, title: candidate }, snapshot: value, scope, now,
  });
  expect(displayTitle).toBe(title + ' ');
  expect(target(title)?.params.assignmentId).toBe('work_1');
  expect(target(longerTitle)?.params.assignmentId).toBe('work_2');
  expect(target(displayTitle)).toBeNull();
});

test('the live snapshot parser retains only valid handoff references', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(now);
  mockCallable.mockResolvedValueOnce({ data: snapshot() });
  const value = await refreshCampusSenseSnapshot({ scope, isCurrent: () => true });
  expect(value.assignments.items[0].source).toEqual(source);
  expect(mockCallable).toHaveBeenCalledWith({ schoolId: 'pu' });
});

test('the parser fails closed on malformed supplied identifiers but accepts old payloads', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(now);
  const value = snapshot();
  mockCallable.mockResolvedValueOnce({ data: {
    ...value, assignments: { ...value.assignments, items: [{ ...assignment, source: { ...source, groupId: 'a/b' } }] },
  } });
  await expect(refreshCampusSenseSnapshot({ scope, isCurrent: () => true })).rejects.toThrow('invalid-sense-response');
  mockCallable.mockResolvedValueOnce({ data: {
    ...value, assignments: { ...value.assignments, items: [assignment] },
  } });
  const old = await refreshCampusSenseSnapshot({ scope, isCurrent: () => true });
  expect(old.assignments.items[0].source).toBeUndefined();
});
