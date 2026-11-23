'use strict';

let mockDocs;
let mockFailure;
const mockReads = [];
function mockRef(path, filters = [], maximum = Infinity, document = false) {
  return {
    path, filters, maximum, document,
    collection: (name) => mockRef(path + '/' + name),
    doc: (id) => mockRef(path + '/' + id, [], Infinity, true),
    where: (field, operator, value) => mockRef(path, [...filters, { field, operator, value }], maximum),
    limit: (count) => mockRef(path, filters, count),
  };
}
function mockSnapshot(path) {
  const data = mockDocs.get(path);
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => data };
}
const mockDb = {
  collection: (name) => mockRef(name),
  doc: (path) => mockRef(path, [], Infinity, true),
  runTransaction: async (callback) => callback({
    get: async (ref) => {
      mockReads.push(ref);
      if (mockFailure?.path === ref.path) throw mockFailure.error;
      if (ref.document) return mockSnapshot(ref.path);
      const docs = [...mockDocs.entries()]
        .filter(([path, row]) => path.startsWith(ref.path + '/') &&
          !path.slice(ref.path.length + 1).includes('/') &&
          ref.filters.every(({ field, operator, value }) => {
            if (operator === '==') return row[field] === value;
            if (operator === 'in') return value.includes(row[field]);
            throw new Error('Unsupported fixture query');
          }))
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, ref.maximum)
        .map(([path]) => mockSnapshot(path));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  }),
};
jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: () => mockDb,
}));
const { Timestamp } = require('firebase-admin/firestore');
const { washingReservationVersion } = require('../washingReservationSource');
const tool = require('./getMyWashingReservations');
const scope = { uid: 'alice', schoolId: 'pu' };
const collection = 'schools/pu/washingReservations';
const row = {
  userId: 'alice', schoolId: 'pu', machineId: 'M1', dormitory: 'A棟', startTime: '20:00',
  status: 'reserved', reservedUntil: Timestamp.fromMillis(1893456600000),
};

beforeEach(() => {
  mockReads.length = 0;
  mockFailure = undefined;
  mockDocs = new Map([
    ['users/alice', { status: 'active' }],
    ['schools/pu/members/alice', { status: 'active' }],
    [collection + '/r1', { ...row }],
  ]);
});

test('only the authenticated owner and selected school supply canonical source fields', async () => {
  mockDocs.set(collection + '/r1', { ...row, id: 'forged', privateNote: 'not returned' });
  mockDocs.set(collection + '/other-user', { ...row, userId: 'bob' });
  mockDocs.set('schools/nthu/washingReservations/foreign', { ...row, schoolId: 'nthu' });
  const result = await tool.execute(scope, {});
  expect(result).toEqual({
    ok: true, complete: true,
    reservations: [{
      reservationId: 'r1', machineId: 'M1', dormitory: 'A棟', startTime: '20:00',
      reservedUntil: '2030-01-01T00:10:00.000Z', status: 'reserved',
      reservationVersion: washingReservationVersion('r1', row),
    }],
  });
  expect(mockReads.find((ref) => !ref.document)).toMatchObject({
    path: collection, maximum: 21,
    filters: [
      { field: 'userId', operator: '==', value: 'alice' },
      { field: 'status', operator: 'in', value: ['reserved', 'active'] },
    ],
  });
});

test('cancelled historical records cannot hide the only active reservation behind the limit', async () => {
  for (let i = 0; i < 30; i++) {
    mockDocs.set(collection + '/old-' + i, { ...row, status: 'cancelled' });
  }
  expect((await tool.execute(scope, {})).reservations.map((item) => item.reservationId)).toEqual(['r1']);
});

test.each([20, 21])('%i active records preserve bounded completeness without a false empty list', async (count) => {
  mockDocs.delete(collection + '/r1');
  for (let i = 0; i < count; i++) mockDocs.set(collection + '/r' + String(i).padStart(2, '0'), { ...row });
  const result = await tool.execute(scope, {});
  expect(result.complete).toBe(count <= 20);
  expect(result.reservations).toHaveLength(20);
  expect(mockReads.find((ref) => !ref.document).maximum).toBe(21);
});

test('ID status lookup can verify cancellation while the active list excludes it', async () => {
  const cancelled = { ...row, status: 'cancelled' };
  mockDocs.set(collection + '/r1', cancelled);
  expect(await tool.execute(scope, {})).toEqual({ ok: true, complete: true, reservations: [] });
  const result = await tool.execute(scope, { reservationId: 'r1' });
  expect(result).toMatchObject({ ok: true, complete: true, reservations: [{ reservationId: 'r1', status: 'cancelled' }] });
  expect(result.reservations[0].reservationVersion).not.toBe(washingReservationVersion('r1', row));
});

test.each([
  ['owner', { ...row, userId: 'bob' }, 'permission-denied'],
  ['school', { ...row, schoolId: 'nthu' }, 'failed-precondition'],
  ['display source', { ...row, dormitory: '' }, 'failed-precondition'],
])('an invalid canonical %s cannot become a selectable or successful empty source', async (_label, changed, code) => {
  mockDocs.set(collection + '/r1', changed);
  await expect(tool.execute(scope, { reservationId: 'r1' })).rejects.toMatchObject({ code });
});

test('unknown IDs are not reported as cancelled or an empty success', async () => {
  await expect(tool.execute(scope, { reservationId: 'unknown' })).rejects.toMatchObject({ code: 'not-found' });
});

test.each([
  ['users/alice', { status: 'disabled' }, 'failed-precondition'],
  ['users/alice', { accountDeletionInProgress: true }, 'failed-precondition'],
  ['schools/pu/members/alice', { status: 'inactive' }, 'permission-denied'],
  ['schools/pu/members/alice', undefined, 'permission-denied'],
])('the private transaction rechecks %s state %j before returning reservations', async (path, state, code) => {
  if (state === undefined) mockDocs.delete(path);
  else mockDocs.set(path, state);
  await expect(tool.execute(scope, {})).rejects.toMatchObject({ code });
  expect(mockReads.some((ref) => ref.path === collection)).toBe(false);
});

test.each(['users/alice', 'schools/pu/members/alice', collection])('a failure reading %s propagates rather than becoming empty', async (path) => {
  const error = new Error('private source unavailable');
  mockFailure = { path, error };
  await expect(tool.execute(scope, {})).rejects.toBe(error);
});

test('model input cannot override account or campus scope', async () => {
  await expect(tool.execute(scope, { uid: 'bob', schoolId: 'nthu' })).rejects.toThrow();
  expect(mockReads).toEqual([]);
});

test.each(['pending', 'processing', 'cancellled'])(
  'ID lookup cannot turn unknown status %s into an ended reservation', async (status) => {
    mockDocs.set(collection + '/r1', { ...row, status });
    await expect(tool.execute(scope, { reservationId: 'r1' })).rejects.toMatchObject({ code: 'failed-precondition' });
  },
);

test.each(['inUse', 'completed', 'noshow'])(
  'ID lookup preserves documented non-cancellable status %s', async (status) => {
    mockDocs.set(collection + '/r1', { ...row, status });
    expect(await tool.execute(scope, {})).toEqual({ ok: true, complete: true, reservations: [] });
    expect(await tool.execute(scope, { reservationId: 'r1' })).toMatchObject({
      ok: true, complete: true, reservations: [{ reservationId: 'r1', status }],
    });
  },
);
