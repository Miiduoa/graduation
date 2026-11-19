'use strict';

const { transactionStore } = require('../../testSupport/transactionStore');
let mockStore;
let mockNextId = 0;
let mockFailServiceCommit = false;

function mockSnapshot(path) {
  const value = mockStore.docs.get(path);
  return { id: path.split('/').pop(), exists: value !== undefined, data: () => value };
}
function mockDoc(path) {
  return {
    path, id: path.split('/').pop(),
    collection: name => mockCollection(`${path}/${name}`),
    get: async () => mockSnapshot(path),
    set: async (value, options) => mockStore.docs.set(path,
      options?.merge ? { ...mockStore.docs.get(path), ...value } : value),
  };
}
function mockCollection(path, filters = [], maximum = Infinity) {
  return {
    path, filters, maximum,
    doc: (id = `seat-fixture-${++mockNextId}`) => mockDoc(`${path}/${id}`),
    where: (field, operator, value) => mockCollection(path, [...filters, { field, operator, value }], maximum),
    limit: count => mockCollection(path, filters, count),
  };
}
const mockDb = {
  doc: mockDoc,
  collection: mockCollection,
  runTransaction: callback => mockStore.db.runTransaction(tx => callback({
    ...tx,
    set: (ref, value, options) => tx.set(ref, options?.merge ? { ...mockStore.docs.get(ref.path), ...value } : value),
    create: (ref, value) => {
      if (mockFailServiceCommit && ref.path.startsWith('schools/pu/seatReservations/')) {
        mockFailServiceCommit = false;
        mockStore.failNextCommit();
      }
      tx.create(ref, value);
    },
  })),
};
jest.mock('firebase-functions/v2/https', () => ({
  ...jest.requireActual('firebase-functions/v2/https'),
  onCall: (_options, handler) => handler,
}));
jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: () => mockDb,
}));

const executeAgentWrite = require('./executeAgentWrite');
const runId = '11111111-2222-4333-8444-555555555555';
const now = Date.parse('2026-11-17T04:00:00Z');
const input = { seatId: 'lib-3F-A15', date: '2026-11-20', startTime: '14:00', endTime: '16:30' };
const runPath = `users/alice/agentRuns/${runId}`;
const request = (patch = {}) => ({ auth: { uid: 'alice' }, data: {
  toolName: 'reserveSeat', agentRunId: runId, context: { schoolId: 'pu', timezone: 'Asia/Taipei' },
  input, ...patch,
} });
const serviceRows = () => [...mockStore.docs].filter(([path]) => /\/(?:seatReservations|serviceWriteGuards)\//.test(path));

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(now);
  mockNextId = 0;
  mockFailServiceCommit = false;
  mockStore = transactionStore([
    ['users/alice', { schoolId: 'pu', role: 'student' }],
    ['schools/pu/members/alice', { status: 'active', role: 'student' }],
    ['users/alice/settings/assistantPermissions', { reserveSeat: true }],
    ['schools/pu/librarySeats/lib-3F-A15', { available: true, status: 'available' }],
    [runPath, { userId: 'alice', schoolId: 'pu', status: 'completed', createdAt: now,
      actionProposals: [{ toolName: 'reserveSeat', input }] }],
  ]);
});
afterEach(() => jest.restoreAllMocks());

test('the real callable commits the reviewed interval to the canonical row and mirror before returning verified success', async () => {
  const receipt = await executeAgentWrite(request());
  expect(receipt).toEqual({ success: true, toolName: 'reserveSeat', reservationId: 'seat-fixture-1', ...input });
  const canonical = mockStore.docs.get('schools/pu/seatReservations/seat-fixture-1');
  expect(canonical).toMatchObject({ ...input, userId: 'alice', schoolId: 'pu', status: 'active' });
  expect(mockStore.docs.get('users/alice/schools/pu/seatReservations/seat-fixture-1')).toEqual(canonical);
  expect(mockStore.docs.get(runPath).actionClaims['0'].status).toBe('completed');
});

test('a changed end time cannot use the reviewed proposal and makes no claim or reservation', async () => {
  await expect(executeAgentWrite(request({ input: { ...input, endTime: '16:00' } })))
    .rejects.toMatchObject({ code: 'permission-denied' });
  expect(serviceRows()).toEqual([]);
  expect(mockStore.docs.get(runPath).actionClaims).toBeUndefined();
});

test('the original claim blocks a repeated confirmation without a second reservation', async () => {
  await executeAgentWrite(request());
  const before = serviceRows();
  await expect(executeAgentWrite(request())).rejects.toMatchObject({ code: 'already-exists' });
  expect(serviceRows()).toEqual(before);
});

test('a failed service commit leaves no canonical, mirror or guard writes and no successful receipt', async () => {
  mockFailServiceCommit = true;
  await expect(executeAgentWrite(request())).rejects.toMatchObject({ code: 'invalid-argument', message: 'commit unavailable' });
  expect(serviceRows()).toEqual([]);
  const run = mockStore.docs.get(runPath);
  expect(run.actionClaims['0'].status).toBe('unverified');
  expect(run.steps.some(step => step.output.success === true)).toBe(false);
});

test('a seat removed after preparation cannot become a successful reservation', async () => {
  mockStore.docs.delete('schools/pu/librarySeats/lib-3F-A15');
  await expect(executeAgentWrite(request())).rejects.toMatchObject({ code: 'not-found' });
  expect(serviceRows()).toEqual([]);
  expect(mockStore.docs.get(runPath).actionClaims['0'].status).toBe('unverified');
});
