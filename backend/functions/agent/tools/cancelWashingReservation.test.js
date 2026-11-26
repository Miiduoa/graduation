'use strict';

const { transactionStore } = require('../../testSupport/transactionStore');
let mockStore;
jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: () => mockStore.db,
}));
const { Timestamp } = require('firebase-admin/firestore');
const { washingReservationVersion, projectWashingReservation } = require('../washingReservationSource');
const tool = require('./cancelWashingReservation');

const path = 'schools/pu/washingReservations/r1';
const machinePath = 'schools/pu/washingMachines/M1';
const settingsPath = 'users/alice/settings/assistantPermissions';
const scope = { uid: 'alice', schoolId: 'pu' };
const agent = { ...scope, agentActionKey: 'server-run:0' };
const source = {
  userId: 'alice', schoolId: 'pu', machineId: 'M1', dormitory: 'A棟',
  startTime: '20:00', status: 'reserved', reservedUntil: Timestamp.fromMillis(1893456600000),
};
const version = () => washingReservationVersion('r1', source);
const input = () => ({
  reservationId: 'r1', expectedReservationVersion: version(),
  machineId: source.machineId, dormitory: source.dormitory, startTime: source.startTime,
  reservedUntil: source.reservedUntil.toDate().toISOString(),
});

beforeEach(() => {
  mockStore = transactionStore([
    [path, { ...source }],
    [machinePath, { status: 'reserved', reservedBy: 'alice', activeReservationId: 'r1', reservedUntil: source.reservedUntil }],
    ['users/alice', { status: 'active' }],
    ['schools/pu/members/alice', { status: 'active' }],
    [settingsPath, { cancelWashingReservation: true }],
  ]);
  mockStore.db.doc = (documentPath) => {
    const slash = documentPath.lastIndexOf('/');
    return mockStore.db.collection(documentPath.slice(0, slash)).doc(documentPath.slice(slash + 1));
  };
});

test('ordinary cancellation returns the actual scoped source and cancellation result', async () => {
  const result = await tool.execute(scope, { reservationId: 'r1' });
  expect(result).toEqual({
    success: true, ...projectWashingReservation('r1', source), status: 'cancelled',
    schoolId: 'pu', userId: 'alice',
  });
  expect(mockStore.docs.get(path).status).toBe('cancelled');
  expect(mockStore.docs.get(machinePath)).toMatchObject({ status: 'available', activeReservationId: null });
  expect(result).not.toHaveProperty('cancelledAt');
});

test('a reviewed Agent source cancels only after the transaction verifies permission and version', async () => {
  expect(await tool.execute(agent, input())).toMatchObject({
    success: true, reservationId: 'r1', machineId: 'M1', status: 'cancelled', schoolId: 'pu', userId: 'alice',
  });
});

test.each([undefined, '0'.repeat(64)])('Agent cancellation rejects absent or stale source version %j', async (expectedReservationVersion) => {
  const before = new Map(mockStore.docs);
  await expect(tool.execute(agent, { reservationId: 'r1', expectedReservationVersion }))
    .rejects.toMatchObject({ code: 'failed-precondition' });
  expect(mockStore.docs).toEqual(before);
});

test.each(['all', 'machineId', 'dormitory', 'startTime', 'reservedUntil'])(
  'Agent cancellation rejects omitted confirmation display fields: %s', async (omitted) => {
    const request = input();
    const fields = omitted === 'all' ? ['machineId', 'dormitory', 'startTime', 'reservedUntil'] : [omitted];
    for (const field of fields) delete request[field];
    const before = new Map(mockStore.docs);
    await expect(tool.execute(agent, request)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(mockStore.docs).toEqual(before);
  },
);

test('ordinary callable still verifies an explicitly supplied source version', async () => {
  const before = new Map(mockStore.docs);
  await expect(tool.execute(scope, { reservationId: 'r1', expectedReservationVersion: '0'.repeat(64) }))
    .rejects.toMatchObject({ code: 'failed-precondition' });
  expect(mockStore.docs).toEqual(before);
});

test.each([
  ['machineId', 'M2'], ['dormitory', 'B棟'], ['startTime', '21:00'], ['reservedUntil', null],
])('a changed displayed %s cannot be confirmed against a valid version', async (field, value) => {
  const before = new Map(mockStore.docs);
  await expect(tool.execute(agent, { ...input(), [field]: value }))
    .rejects.toMatchObject({ code: 'failed-precondition' });
  expect(mockStore.docs).toEqual(before);
});

test.each([undefined, {}, { cancelWashingReservation: false }, { cancelWashingReservation: 'true' }])(
  'Agent permission %j fails closed inside the service transaction', async (settings) => {
    if (settings === undefined) mockStore.docs.delete(settingsPath);
    else mockStore.docs.set(settingsPath, settings);
    const before = new Map(mockStore.docs);
    await expect(tool.execute(agent, input())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockStore.docs).toEqual(before);
  },
);

test('ordinary ID-only cancellation does not require Agent permission', async () => {
  mockStore.docs.delete(settingsPath);
  expect(await tool.execute(scope, { reservationId: 'r1' })).toMatchObject({ success: true });
});

test.each([
  ['wrong owner', { ...source, userId: 'bob' }, 'permission-denied'],
  ['wrong school metadata', { ...source, schoolId: 'nthu' }, 'failed-precondition'],
  ['source changed', { ...source, startTime: '21:00' }, 'failed-precondition'],
  ['already cancelled', { ...source, status: 'cancelled' }, 'failed-precondition'],
])('%s cannot change the reservation or machine', async (_label, row, code) => {
  mockStore.docs.set(path, row);
  const before = new Map(mockStore.docs);
  await expect(tool.execute(agent, input())).rejects.toMatchObject({ code });
  expect(mockStore.docs).toEqual(before);
});

test('a previous reservation cannot release a newer reservation on the same machine', async () => {
  const newer = { status: 'reserved', reservedBy: 'bob', activeReservationId: 'newer', reservedUntil: source.reservedUntil };
  mockStore.docs.set(machinePath, newer);
  expect(await tool.execute(agent, input())).toMatchObject({ success: true, status: 'cancelled' });
  expect(mockStore.docs.get(machinePath)).toEqual(newer);
});

test('a failed transaction commit leaves both source and machine unchanged', async () => {
  const before = new Map(mockStore.docs);
  mockStore.failNextCommit();
  await expect(tool.execute(agent, input())).rejects.toThrow('commit unavailable');
  expect(mockStore.docs).toEqual(before);
});

test.each([settingsPath, path, machinePath])('a failed canonical read of %s cannot become success', async (failedPath) => {
  const failure = new Error('source unavailable');
  const run = mockStore.db.runTransaction;
  mockStore.db.runTransaction = (callback) => run((tx) => callback({
    ...tx,
    get: async (ref) => {
      if (ref.path === failedPath) throw failure;
      return tx.get(ref);
    },
  }));
  const before = new Map(mockStore.docs);
  await expect(tool.execute(agent, input())).rejects.toBe(failure);
  expect(mockStore.docs).toEqual(before);
});

test('a source-bound cancellation has no second success after it was cancelled', async () => {
  await tool.execute(agent, input());
  const before = new Map(mockStore.docs);
  await expect(tool.execute(agent, input())).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(mockStore.docs).toEqual(before);
});


test('ordinary legacy ID-only cancellation keeps its old policy without inventing missing display values', async () => {
  const legacy = { userId: 'alice', machineId: 'M1', status: 'reserved', reservedUntil: 'unknown' };
  mockStore.docs.set(path, legacy);
  expect(await tool.execute(scope, { reservationId: 'r1' })).toMatchObject({
    success: true, reservationId: 'r1', status: 'cancelled', dormitory: null, startTime: null, reservedUntil: null,
  });
  expect(mockStore.docs.get(path).status).toBe('cancelled');
});

test('an Agent cannot turn the same incomplete legacy source into a confirmed cancellation', async () => {
  mockStore.docs.set(path, { userId: 'alice', machineId: 'M1', status: 'reserved' });
  const before = new Map(mockStore.docs);
  await expect(tool.execute(agent, input())).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(mockStore.docs).toEqual(before);
});
