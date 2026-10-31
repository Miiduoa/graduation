import { compareCampusAssignments } from '../../services/campusSenseChanges';
import type { CampusSenseSnapshot } from '../../services/campusSenseSnapshot';
jest.mock('../../firebase', () => ({}));

const now = Date.parse('2026-10-28T02:00:00.000Z');
const scope = { uid: 'A', schoolId: 'pu' };
type Row = CampusSenseSnapshot['assignments']['items'][number];
const row = (id: string, overrides: Partial<Row> = {}): Row => ({
  title: '資料庫報告', groupName: '資料庫', dueAt: '2026-10-30T09:00:00Z',
  source: { kind: 'group-assignment', groupId: 'g', assignmentId: id }, ...overrides,
});
const snapshot = (items: Row[], age = 0): CampusSenseSnapshot => ({
  userId: 'A', schoolId: 'pu', checkedAt: new Date(now - age).toISOString(),
  schedule: { status: 'unavailable', count: null },
  announcements: { status: 'available', items: [] },
  assignments: { status: 'available', count: items.length, items, coverage: { complete: true, reason: 'complete', pages: 1 } },
});
function compare(previous: CampusSenseSnapshot | null, next: CampusSenseSnapshot) {
  return compareCampusAssignments({ previous, next, scope, now });
}

test('the first sync establishes a baseline instead of claiming every task is newly assigned', () => {
  expect(compare(null, snapshot([row('a')]))).toMatchObject({ status: 'baseline', reason: 'first-sync', changes: [] });
});

test.each([
  ['2026-10-30T09:00:00Z', '2026-10-29T09:00:00Z', 'deadline-earlier'],
  ['2026-10-30T09:00:00Z', '2026-10-31T09:00:00Z', 'deadline-later'],
  [null, '2026-10-30T09:00:00Z', 'deadline-added'],
  ['2026-10-30T09:00:00Z', null, 'deadline-removed'],
] as const)('classifies deadline %s → %s as %s', (before, after, kind) => {
  const result = compare(snapshot([row('a', { dueAt: before })], 60000), snapshot([row('a', { dueAt: after })]));
  expect(result.status).toBe('compared');
  expect(result.changes).toHaveLength(1);
  expect(result.changes[0]).toMatchObject({ kind, previousDueAt: before, assignment: { dueAt: after } });
});

test('same-title assignments remain distinct and earlier deadlines rank before additions', () => {
  const previous = snapshot([row('a'), row('b')], 60000);
  const next = snapshot([row('a', { dueAt: '2026-10-29T00:00:00Z' }), row('new'), row('b')]);
  const result = compare(previous, next);
  expect(result.changes.map((change) => change.kind)).toEqual(['deadline-earlier', 'added']);
  expect(result.changes[1].assignment.source?.assignmentId).toBe('new');
});

test('an absent row is only no-longer-listed, never proof of submission or completion', () => {
  const result = compare(snapshot([row('a')], 60000), snapshot([]));
  expect(result.changes[0].kind).toBe('no-longer-listed');
  expect(JSON.stringify(result)).not.toMatch(/completed|submitted|success/);
});

test('a rename uses source identity and equivalent timezone notation is not a deadline change', () => {
  const before = snapshot([row('a')], 60000);
  expect(compare(before, snapshot([row('a', { dueAt: '2026-10-30T17:00:00+08:00' })])).changes).toEqual([]);
  const changed = compare(before, snapshot([row('a', { title: '更新報告題目' })]));
  expect(changed.changes[0].kind).toBe('details-updated');
});

test.each(['previous', 'next'] as const)('partial %s data cannot prove additions or removals', (side) => {
  const previous = snapshot([row('a')], 60000);
  const next = snapshot([row('b')]);
  const target = side === 'previous' ? previous : next;
  target.assignments.count = 100;
  target.assignments.coverage = { complete: false, reason: 'read-budget', pages: 8 };
  expect(compare(previous, next)).toMatchObject({ status: 'not-comparable', reason: 'partial-data', changes: [] });
});

test('an explicit incomplete flag is respected even when displayed counts match', () => {
  const next = snapshot([row('a')]);
  next.assignments.coverage = { complete: false, reason: 'legacy-partial', pages: 1 };
  expect(compare(snapshot([], 60000), next).reason).toBe('partial-data');
});

test.each(['missing-id', 'duplicate-id', 'invalid-date'])(
  'ambiguous %s rows fail closed without comparing names', (kind) => {
    const next = snapshot([row('a')]);
    if (kind === 'missing-id') delete next.assignments.items[0].source;
    if (kind === 'duplicate-id') { next.assignments.items.push(row('a')); next.assignments.count = 2; }
    if (kind === 'invalid-date') next.assignments.items[0].dueAt = 'not a date';
    expect(compare(snapshot([], 60000), next)).toMatchObject({ reason: 'identity-unavailable', changes: [] });
  },
);

test.each(['account', 'school', 'expired', 'future', 'invalid-clock'])(
  'rejects %s history without disclosing old task titles', (kind) => {
    const previous = snapshot([row('old', { title: '私人的舊作業' })], 60000);
    if (kind === 'account') previous.userId = 'B';
    if (kind === 'school') previous.schoolId = 'other';
    if (kind === 'expired') previous.checkedAt = new Date(now - 16 * 60000).toISOString();
    if (kind === 'future') previous.checkedAt = new Date(now + 60000).toISOString();
    if (kind === 'invalid-clock') previous.checkedAt = 'invalid';
    const result = compare(previous, snapshot([]));
    expect(result).toMatchObject({ status: 'not-comparable', reason: 'scope-or-age', changes: [] });
    expect(JSON.stringify(result)).not.toContain('私人的舊作業');
  },
);

test('time reversal and unavailable source never produce a false all-clear', () => {
  expect(compare(snapshot([row('a')]), snapshot([], 60000)).reason).toBe('out-of-order');
  const unavailable = snapshot([]);
  unavailable.assignments = { status: 'unavailable', count: null, items: [] };
  expect(compare(snapshot([row('a')], 60000), unavailable)).toMatchObject({ reason: 'source-unavailable', changes: [] });
});

test('ordering alone is not a change and comparison never mutates input', () => {
  const previous = snapshot([row('a'), row('b')], 60000);
  const next = snapshot([row('b'), row('a')]);
  const serialized = JSON.stringify([previous, next]);
  expect(compare(previous, next)).toMatchObject({ status: 'compared', changes: [] });
  expect(JSON.stringify([previous, next])).toBe(serialized);
});
