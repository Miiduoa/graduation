'use strict';

const mockRecords = new Map();
const mockReads = jest.fn();
let mockFailure;

function mockCollection(name, filters = [], ordering, maximum = Infinity) {
  return {
    where: (field, operator, value) => mockCollection(name, [...filters, { field, operator, value }], ordering, maximum),
    orderBy: (field, direction) => mockCollection(name, filters, { field, direction }, maximum),
    limit: (limit) => mockCollection(name, filters, ordering, limit),
    get: async () => {
      mockReads({ name, filters, ordering, maximum });
      if (mockFailure) throw mockFailure;
      const rows = [...mockRecords].filter(([, data]) =>
        filters.every(({ field, operator, value }) => operator === '==' && data[field] === value) &&
        (!ordering || data[ordering.field] !== undefined));
      if (ordering) rows.sort(([, a], [, b]) => ordering.direction === 'desc'
        ? b[ordering.field] - a[ordering.field] : a[ordering.field] - b[ordering.field]);
      return { docs: rows.slice(0, maximum).map(([id, data]) => ({ id, data: () => data })) };
    },
  };
}
const mockGetFirestore = jest.fn(() => ({ collection: mockCollection }));
jest.mock('firebase-admin/firestore', () => ({ getFirestore: () => mockGetFirestore() }));
const getLeaveRequestStatus = require('./getLeaveRequestStatus');
const scope = { uid: 'u1', schoolId: 's1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockRecords.clear();
  mockFailure = null;
  mockRecords.set('legacy', {
    uid: 'u1', schoolId: 's1', date: '2026-05-11', type: '事假', status: 'pending',
    courseId: 'c1', groupId: 'g1', createdAt: new Date('2026-05-10T00:00:00Z'),
  });
});

test('preserves a same-school legacy record without source and maps its status', async () => {
  const out = await getLeaveRequestStatus.execute(scope, { limit: 5 });
  expect(out).toEqual({ count: 1, items: [{
    requestId: 'legacy', date: '2026-05-11', type: '事假', status: 'pending', courseId: 'c1',
    groupId: 'g1', createdAt: '2026-05-10T00:00:00.000Z',
  }] });
});

test('filters the current school and user before applying the newest-row limit', async () => {
  for (let i = 0; i < 60; i++) mockRecords.set(`other-school-${i}`, {
    uid: 'u1', schoolId: 's2', date: 'foreign', createdAt: new Date(`2030-01-01T00:00:${String(i).padStart(2, '0')}Z`),
  });
  mockRecords.set('other-user', { uid: 'u2', schoolId: 's1', date: 'foreign-user', createdAt: new Date('2031-01-01') });
  const out = await getLeaveRequestStatus.execute(scope, { limit: 1 });
  expect(out.items.map((row) => row.requestId)).toEqual(['legacy']);
  expect(out.count).toBe(1);
});

test('selecting another school shows only that schools own records', async () => {
  mockRecords.set('s2-request', { uid: 'u1', schoolId: 's2', date: '2026-11-18', type: '病假', createdAt: new Date('2026-11-17') });
  const out = await getLeaveRequestStatus.execute({ ...scope, schoolId: 's2' }, {});
  expect(out.items.map((row) => row.requestId)).toEqual(['s2-request']);
});

test('does not guess a campus for historical rows without a school binding', async () => {
  for (const [id, schoolId] of [['missing', undefined], ['null', null], ['empty', '']]) {
    mockRecords.set(id, { uid: 'u1', schoolId, date: 'unbound', createdAt: new Date('2030-01-01') });
  }
  expect((await getLeaveRequestStatus.execute(scope, {})).items.map((row) => row.requestId)).toEqual(['legacy']);
});

test('keeps current and historical source formats, sorted newest first within the school', async () => {
  mockRecords.set('current', {
    uid: 'u1', schoolId: 's1', source: 'campus-one',
    startDate: '2026-10-28', endDate: '2026-10-29', kind: 'sick', status: 'partial',
    courses: [{ courseId: 'c2', reviewStatus: 'approved' }], createdAt: new Date('2026-10-27'),
  });
  const out = await getLeaveRequestStatus.execute(scope, {});
  expect(out.items.map((row) => row.requestId)).toEqual(['current', 'legacy']);
  expect(out.items[0]).toMatchObject({ date: '2026-10-28 至 2026-10-29', type: '病假', status: 'partial', courseId: 'c2' });
});

test('retains default and bounded explicit limits within the selected school', async () => {
  for (let i = 0; i < 55; i++) mockRecords.set(`local-${i}`, {
    uid: 'u1', schoolId: 's1', date: '2026-11-18', createdAt: new Date(1900000000000 + i * 1000),
  });
  expect((await getLeaveRequestStatus.execute(scope, {})).count).toBe(10);
  expect((await getLeaveRequestStatus.execute(scope, { limit: 50 })).count).toBe(50);
});

test.each([{}, { schoolId: 's1' }, { uid: '', schoolId: 's1' }, { uid: 7, schoolId: 's1' }, { uid: 'u/1', schoolId: 's1' }])('invalid actor %j fails before any database access', async (ctx) => {
  await expect(getLeaveRequestStatus.execute(ctx, {})).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(mockGetFirestore).not.toHaveBeenCalled();
});

test.each([undefined, null, '', ' ', 123, '../s1', 's/1', 's'.repeat(81)])('invalid school %s fails before any database access', async (schoolId) => {
  await expect(getLeaveRequestStatus.execute({ uid: 'u1', schoolId }, {})).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(mockGetFirestore).not.toHaveBeenCalled();
});

test('absent context fails closed', async () => {
  await expect(getLeaveRequestStatus.execute(undefined, {})).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(mockGetFirestore).not.toHaveBeenCalled();
});

test.each([0, 51, 1.5, '10'])('invalid limit %s never reads data', async (limit) => {
  await expect(getLeaveRequestStatus.execute(scope, { limit })).rejects.toThrow();
  expect(mockGetFirestore).not.toHaveBeenCalled();
});

test('a source failure is not returned as an empty list and never falls back to a broader query', async () => {
  mockFailure = new Error('source unavailable');
  await expect(getLeaveRequestStatus.execute(scope, {})).rejects.toBe(mockFailure);
  expect(mockReads).toHaveBeenCalledTimes(1);
});

test('returns an empty list when this school has no records', async () => {
  expect(await getLeaveRequestStatus.execute({ ...scope, schoolId: 'empty-school' }, {})).toEqual({ items: [], count: 0 });
});

test('preserves a null historical createdAt while keeping the existing orderBy exclusion for absent dates', async () => {
  mockRecords.set('legacy-null', { uid: 'u1', schoolId: 's1', date: '2026-01-01', createdAt: null });
  mockRecords.set('legacy-absent', { uid: 'u1', schoolId: 's1', date: '2026-01-02' });
  const out = await getLeaveRequestStatus.execute(scope, {});
  expect(out.items.map((row) => row.requestId)).toEqual(['legacy', 'legacy-null']);
  expect(out.items[1].createdAt).toBeNull();
});

test('read-only status queries require no confirmation', () => {
  expect(getLeaveRequestStatus.requiresConfirmation).toBe(false);
});
