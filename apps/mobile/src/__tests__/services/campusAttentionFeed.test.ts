import { buildCampusAttentionFeed, buildCampusAttentionReminderStep } from '../../services/campusAttentionFeed';
import { CAMPUS_SENSE_MAX_AGE_MS, type CampusSenseSnapshot } from '../../services/campusSenseSnapshot';

const NOW = Date.parse('2026-10-29T08:00:00Z');
const scope = { uid: 'student-one', schoolId: 'pu' };

function snapshot(): CampusSenseSnapshot {
  return {
    userId: scope.uid, schoolId: scope.schoolId,
    checkedAt: new Date(NOW - 30_000).toISOString(),
    schedule: { status: 'unavailable', count: null },
    assignments: {
      status: 'available', count: 7,
      coverage: { complete: false, reason: 'read-budget', pages: 1 },
      items: [
        { title: '稍後期限', groupName: '資料庫', dueAt: new Date(NOW + 12 * 86_400_000).toISOString() },
        { title: '同名作業', groupName: '資料庫', dueAt: new Date(NOW - 4 * 3600_000).toISOString(),
          source: { kind: 'group-assignment', groupId: 'db', assignmentId: 'a1' } },
        { title: '沒有日期', groupName: '程式設計', dueAt: null },
        { title: '三天後', groupName: '英文', dueAt: new Date(NOW + 3 * 86_400_000).toISOString() },
        { title: '同名作業', groupName: '資料庫', dueAt: new Date(NOW + 3600_000).toISOString(),
          source: { kind: 'group-assignment', groupId: 'db', assignmentId: 'a2' } },
        { title: '昨天截止', groupName: '統計', dueAt: new Date(NOW - 86_400_000).toISOString() },
      ],
    },
    announcements: { status: 'unavailable', items: [] },
  };
}

test('puts imminent verified dates first, then recently expired and upcoming; never deduplicates names', () => {
  const original = snapshot();
  const before = JSON.stringify(original);
  const feed = buildCampusAttentionFeed({ snapshot: original, scope, now: NOW })!;
  expect(feed.items.map((item) => item.assignment.title)).toEqual([
    '同名作業', '同名作業', '昨天截止',
  ]);
  expect(feed.items.map((item) => item.priority)).toEqual([
    'due-soon', 'past-due', 'past-due',
  ]);
  expect(feed.items[0].assignment.source?.assignmentId).toBe('a2');
  expect(feed.items[1].assignment.source?.assignmentId).toBe('a1');
  expect(new Set(feed.items.map((item) => item.key)).size).toBe(3);
  expect(feed.remainingVisible).toBe(3);
  expect(feed.missingFromSource).toBe(1);
  expect(feed.incomplete).toBe(true);
  expect(JSON.stringify(original)).toBe(before);
});

test('invalid timestamps are unknown, never invented as overdue or urgent', () => {
  const source = snapshot();
  source.assignments.items = [
    { title: '無日期', groupName: '統計', dueAt: null },
    { title: '格式不正確', groupName: '英文', dueAt: 'not-a-real-date' },
    { title: '下週', groupName: '計概', dueAt: new Date(NOW + 10 * 86_400_000).toISOString() },
  ];
  source.assignments.count = 3;
  source.assignments.coverage = { complete: true, reason: 'complete', pages: 1 };
  const feed = buildCampusAttentionFeed({ snapshot: source, scope, now: NOW })!;
  expect(feed.items.map((item) => item.priority)).toEqual(['unknown-date', 'unknown-date', 'later']);
  expect(feed.incomplete).toBe(false);
});

test('account changes, school changes, expiry and unavailable sources fail closed', () => {
  const source = snapshot();
  expect(buildCampusAttentionFeed({ snapshot: source, scope: { uid: 'other', schoolId: 'pu' }, now: NOW })).toBeNull();
  expect(buildCampusAttentionFeed({ snapshot: source, scope: { uid: scope.uid, schoolId: 'other' }, now: NOW })).toBeNull();
  expect(buildCampusAttentionFeed({
    snapshot: source, scope,
    now: Date.parse(source.checkedAt) + CAMPUS_SENSE_MAX_AGE_MS + 1,
  })).toBeNull();
  expect(buildCampusAttentionFeed({ snapshot: source, scope, now: NaN })).toBeNull();
  source.assignments = { status: 'unavailable', count: null, items: [] };
  expect(buildCampusAttentionFeed({ snapshot: source, scope, now: NOW })).toBeNull();
});

test('complete empty snapshots have zero items, not a fabricated task', () => {
  const source = snapshot();
  source.assignments = { status: 'available', count: 0, items: [], coverage: {
    complete: true, reason: 'complete', pages: 1,
  } };
  expect(buildCampusAttentionFeed({ snapshot: source, scope, now: NOW })).toMatchObject({
    items: [], remainingVisible: 0, missingFromSource: 0, incomplete: false,
  });
});

test('only real source IDs with timezone-bound deadlines can enter the confirmed local reminder flow', () => {
  const original = snapshot();
  const feed = buildCampusAttentionFeed({ snapshot: original, scope, now: NOW })!;
  const imminent = feed.items[0];
  expect(buildCampusAttentionReminderStep(imminent, original)).toMatchObject({
    title: '同名作業',
    dueAt: original.assignments.items[4].dueAt,
    groupName: '資料庫',
    evidence: 'authorized-assignments',
    route: '/classroom',
    priority: 'urgent',
  });
  expect(buildCampusAttentionReminderStep(feed.items[1], original)).toBeNull(); // past deadline

  const missingIdentity = {
    ...imminent, assignment: { ...imminent.assignment, source: undefined },
  };
  expect(buildCampusAttentionReminderStep(missingIdentity, original)).toBeNull();
  const withoutTimezone = {
    ...imminent, assignment: { ...imminent.assignment, dueAt: '2026-10-30' },
  };
  expect(buildCampusAttentionReminderStep(withoutTimezone, original)).toBeNull();
  const malformedIdentity = {
    ...imminent, assignment: {
      ...imminent.assignment,
      source: { kind: 'group-assignment' as const, groupId: 'https://evil.test', assignmentId: 'id' },
    },
  };
  expect(buildCampusAttentionReminderStep(malformedIdentity, original)).toBeNull();
});

test('same title and deadline across distinct source IDs cannot create a colliding reminder', () => {
  const source = snapshot();
  const near = source.assignments.items[4];
  source.assignments.items.push({
    ...near,
    source: { kind: 'group-assignment', groupId: 'db', assignmentId: 'a3' },
  });
  source.assignments.count = source.assignments.items.length;
  const feed = buildCampusAttentionFeed({ snapshot: source, scope, now: NOW })!;
  expect(feed.items[0].priority).toBe('due-soon');
  expect(buildCampusAttentionReminderStep(feed.items[0], source)).toBeNull();
});
