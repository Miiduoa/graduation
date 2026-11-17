'use strict';

const { transactionStore } = require('../testSupport/transactionStore');
let mockStore;
const mockReads = [];
const mockModel = jest.fn();
const mockWebSearch = jest.fn(async () => null);

function mockSnapshot(path) {
  const data = mockStore.docs.get(path);
  if (data instanceof Error) throw data;
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => data };
}

function mockDoc(path) {
  return {
    path, id: path.split('/').pop(),
    collection: (name) => mockCollection(`${path}/${name}`),
    get: async () => { mockReads.push(path); return mockSnapshot(path); },
  };
}

function mockCollection(path, filters = [], maximum = Infinity) {
  return {
    path, filters, maximum,
    doc: (id) => mockDoc(`${path}/${id}`),
    where: (field, operator, value) => mockCollection(path, [...filters, { field, operator, value }], maximum),
    limit: (count) => mockCollection(path, filters, count),
    get: async () => {
      mockReads.push(path);
      const docs = [...mockStore.docs]
        .filter(([key, data]) => key.startsWith(`${path}/`) &&
          !key.slice(path.length + 1).includes('/') && filters.every(({ field, operator, value }) => {
            if (operator === '==') return data[field] === value;
            throw new Error(`Unsupported fixture query: ${operator}`);
          }))
        .slice(0, maximum)
        .map(([key]) => mockSnapshot(key));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  };
}

const mockDb = {
  doc: mockDoc,
  collection: mockCollection,
  runTransaction: jest.fn(() => { throw new Error('Planning must not execute a reservation'); }),
};

jest.mock('firebase-admin/firestore', () => {
  const actual = jest.requireActual('firebase-admin/firestore');
  return {
    ...actual,
    getFirestore: () => mockDb,
    FieldValue: { serverTimestamp: () => actual.Timestamp.fromMillis(Date.now()) },
  };
});
jest.mock('../assistantAgent', () => ({
  ...jest.requireActual('../assistantAgent'),
  callAssistantModelWithTools: (...args) => mockModel(...args),
  callAssistantModel: (...args) => mockModel(...args),
  answerWithServerWebSearch: (...args) => mockWebSearch(...args),
}));

const { executeCampusAssistantCore } = require('./executeCampusAssistantCore');

async function run(message = '幫我預約 A棟洗衣機 A2 明天晚上八點', {
  uid = 'alice', schoolId = 'pu', prefetched,
} = {}) {
  return executeCampusAssistantCore({
    request: {
      auth: uid ? { uid, token: { role: 'student' } } : null,
      data: { messages: [{ role: 'user', content: message }], context: { schoolId } },
    },
    runId: 'laundry-fixture-run', startedAt: Date.now(), routingIntent: 'wash_reserve', prefetched,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00Z'));
  mockModel.mockImplementation(() => { throw new Error('Unexpected provider call'); });
  mockReads.length = 0;
  mockStore = transactionStore([
    ['users/alice', { schoolId: 'pu', role: 'student' }],
    ['users/alice/settings/assistantPermissions', { reserveWashingMachine: true }],
    ['schools/pu/members/alice', { status: 'active' }],
    ['schools/pu/washingMachines/A1', { dormitory: 'A棟', status: 'available' }],
    ['schools/pu/washingMachines/A2', { dormitory: 'A棟', status: 'available' }],
    ['schools/ntu/washingMachines/A999', { dormitory: 'A棟', status: 'available' }],
  ]);
});

afterEach(() => {
  expect(mockDb.runTransaction).not.toHaveBeenCalled();
  expect(mockModel).not.toHaveBeenCalled();
  expect(mockWebSearch).not.toHaveBeenCalled();
  expect([...mockStore.docs.keys()].some((path) => path.includes('/washingReservations/'))).toBe(false);
  jest.useRealTimers();
});

test('the real resolver drafts the requested A2 and requires confirmation without reserving it', async () => {
  const before = new Map(mockStore.docs);
  const result = await run();
  expect(result.actions).toEqual([expect.objectContaining({
    action: 'queue_action', requiresConfirmation: true, status: 'pending_confirmation',
    params: expect.objectContaining({
      toolName: 'reserveWashingMachine', agentRunId: 'laundry-fixture-run',
      input: { machineId: 'A2', dormitory: 'A棟', startTime: expect.any(String) },
    }),
  })]);
  expect(result.content).toContain('機台：A2');
  expect(result.citations).toContainEqual(expect.objectContaining({ id: 'campus-agent-confirmation' }));
  expect(mockStore.docs).toEqual(before);
});

test.each(['A999', 'A2 或 A1', 'A20'])('unresolved selector %s asks for clarification with no action', async (selector) => {
  const before = new Map(mockStore.docs);
  const result = await run(`幫我預約 A棟洗衣機 ${selector} 明天晚上八點`);
  expect(result.actions).toEqual([]);
  expect(result.content).toContain('單一機台編號');
  expect(mockStore.docs).toEqual(before);
  expect(mockReads.some((path) => path.startsWith('schools/ntu/'))).toBe(false);
});

test('a busy explicit machine does not create a draft for another available machine', async () => {
  mockStore.docs.set('schools/pu/washingMachines/A2', { dormitory: 'A棟', status: 'reserved' });
  const result = await run();
  expect(result.actions).toEqual([]);
  expect(result.content).toContain('單一機台編號');
  expect(mockStore.docs.get('schools/pu/washingMachines/A1').status).toBe('available');
});

test('an unspecified machine retains the existing available-machine draft', async () => {
  const result = await run('幫我預約 A棟洗衣機 明天晚上八點');
  expect(result.actions).toEqual([expect.objectContaining({
    requiresConfirmation: true,
    params: expect.objectContaining({ input: expect.objectContaining({ machineId: 'A1' }) }),
  })]);
});

test('foreign prefetched machines cannot substitute for the selected campus source', async () => {
  const result = await run('幫我預約洗衣機 A999 明天晚上八點', {
    prefetched: { scope: { uid: 'alice', schoolId: 'ntu' }, washingMachines: [{ id: 'A999', status: 'available' }] },
  });
  expect(result.actions).toEqual([]);
  expect(mockReads.some((path) => path.startsWith('schools/ntu/'))).toBe(false);
});

test('an unauthorized selected campus fails before reading machine inventory', async () => {
  await expect(run(undefined, { schoolId: 'ntu' })).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mockReads.some((path) => path.includes('/washingMachines'))).toBe(false);
});

test('sign-in is required before reading machine inventory', async () => {
  const result = await run(undefined, { uid: null });
  expect(result.actions).toEqual([]);
  expect(result.content).toContain('先登入');
  expect(mockReads.some((path) => path.includes('/washingMachines'))).toBe(false);
});

test.each([undefined, false, new Error('unavailable')])('closed or unavailable permission fails before resolving inventory: %s', async (permission) => {
  if (permission === undefined) mockStore.docs.delete('users/alice/settings/assistantPermissions');
  else mockStore.docs.set('users/alice/settings/assistantPermissions', permission instanceof Error
    ? permission : { reserveWashingMachine: permission });
  const result = await run();
  expect(result.debug.writePermissionDenied).toBe('reserveWashingMachine');
  expect(result.actions.some((action) => action.action === 'queue_action')).toBe(false);
  expect(mockReads.some((path) => path.includes('/washingMachines'))).toBe(false);
});
