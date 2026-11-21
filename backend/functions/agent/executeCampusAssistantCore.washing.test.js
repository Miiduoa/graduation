'use strict';

// Only Firestore transport/storage and external model calls are substituted.
// Classification, source reads, confirmation/proposal checks, authorization,
// the cancellation transaction and receipt verification are the real modules.
const mockDocuments = new Map();
const mockWrites = [];
const mockReads = [];
const mockModel = jest.fn();
const mockWebSearch = jest.fn(async () => null);

function mockClone(value) {
  if (Array.isArray(value)) return value.map(mockClone);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mockClone(item)]));
  }
  return value;
}
function mockMerge(previous, update) {
  const next = { ...previous };
  for (const [key, value] of Object.entries(update)) {
    next[key] = value && Object.getPrototypeOf(value) === Object.prototype
      ? mockMerge(previous?.[key], value) : mockClone(value);
  }
  return next;
}
function mockSnapshot(path, documents = mockDocuments) {
  const data = documents.get(path);
  if (data instanceof Error) throw data;
  return { id: path.split('/').pop(), exists: documents.has(path), data: () => mockClone(data) };
}
function mockSet(reference, data, options) {
  mockWrites.push(reference.path);
  mockDocuments.set(reference.path, options?.merge
    ? mockMerge(mockDocuments.get(reference.path), data) : mockClone(data));
}
function mockRef(path) {
  return {
    path, id: path.split('/').pop(),
    collection: (name) => mockCollection(`${path}/${name}`),
    get: async () => { mockReads.push(path); return mockSnapshot(path); },
    set: async (data, options) => mockSet({ path }, data, options),
  };
}
function mockCollection(path, filters = [], maximum = Infinity) {
  return {
    path, filters, maximum,
    doc: (id) => mockRef(`${path}/${id}`),
    where: (field, operator, value) => mockCollection(path, [...filters, { field, operator, value }], maximum),
    limit: (count) => mockCollection(path, filters, count),
    get: async () => mockQuery({ path, filters, maximum }),
  };
}
function mockQuery(query, documents = mockDocuments) {
  mockReads.push(query.path);
  if (documents.get(query.path) instanceof Error) throw documents.get(query.path);
  const docs = [...documents]
    .filter(([path, data]) => path.startsWith(`${query.path}/`) &&
      !path.slice(query.path.length + 1).includes('/') && query.filters.every(({ field, operator, value }) => {
        if (operator === '==') return data[field] === value;
        if (operator === 'in') return value.includes(data[field]);
        throw new Error(`Unsupported fixture query ${operator}`);
      }))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, query.maximum)
    .map(([path]) => mockSnapshot(path, documents));
  return { docs, size: docs.length, empty: docs.length === 0 };
}
const mockDb = {
  collection: mockCollection,
  doc: mockRef,
  runTransaction: async (callback) => {
    const base = new Map([...mockDocuments].map(([path, data]) => [path, mockClone(data)]));
    const writes = [];
    const result = await callback({
      get: async (reference) => {
        if (Array.isArray(reference.filters)) return mockQuery(reference, base);
        mockReads.push(reference.path);
        return mockSnapshot(reference.path, base);
      },
      set: (...args) => writes.push(() => mockSet(...args)),
      update: (reference, data) => writes.push(() => mockSet(reference, data, { merge: true })),
    });
    for (const write of writes) write();
    return result;
  },
};

jest.mock('firebase-functions/v2/https', () => ({
  ...jest.requireActual('firebase-functions/v2/https'),
  onCall: (_, handler) => handler,
}));
jest.mock('firebase-admin/firestore', () => {
  const actual = jest.requireActual('firebase-admin/firestore');
  return {
    ...actual, getFirestore: () => mockDb,
    FieldValue: { serverTimestamp: () => actual.Timestamp.now() },
  };
});
jest.mock('../assistantAgent', () => ({
  ...jest.requireActual('../assistantAgent'),
  callAssistantModelWithTools: (...args) => mockModel(...args),
  callAssistantModel: (...args) => mockModel(...args),
  answerWithServerWebSearch: (...args) => mockWebSearch(...args),
}));

const { Timestamp } = require('firebase-admin/firestore');
const { classifyIntent } = require('./classifyIntent');
const { executeCampusAssistantCore } = require('./executeCampusAssistantCore');
const executeAgentWrite = require('./handlers/executeAgentWrite');
const { washingReservationVersion } = require('./washingReservationSource');

const RUN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const RUN_PATH = `users/alice/agentRuns/${RUN_ID}`;
const SOURCE_PATH = 'schools/pu/washingReservations/reservation-1';
const MACHINE_PATH = 'schools/pu/washingMachines/A2';
const PERMISSION_PATH = 'users/alice/settings/assistantPermissions';
const NOW = Date.parse('2026-11-17T08:00:00Z');
const row = (extra = {}) => ({
  userId: 'alice', schoolId: 'pu', machineId: 'A2', dormitory: '信德宿舍',
  startTime: '2026-11-17T19:00:00+08:00', status: 'reserved',
  reservedUntil: Timestamp.fromMillis(NOW + 600000), ...extra,
});
function serviceSnapshot() {
  return [...mockDocuments].filter(([path]) => /\/(washingReservations|washingMachines)\//.test(path))
    .map(([path, data]) => [path, mockClone(data)]);
}
function expectNoServiceWrite(before) {
  expect(serviceSnapshot()).toEqual(before);
  expect(mockWrites.filter((path) => /\/(washingReservations|washingMachines)\//.test(path))).toEqual([]);
}
async function ask(message, { uid = 'alice', schoolId = 'pu' } = {}) {
  const intent = classifyIntent(message).name;
  return executeCampusAssistantCore({
    request: {
      auth: uid ? { uid, token: { role: 'student' } } : null,
      data: { messages: [{ role: 'user', content: message }], context: { schoolId } },
    },
    runId: RUN_ID, startedAt: NOW, routingIntent: intent,
  });
}
async function prepare(message = '取消今晚 A2 洗衣機預約') {
  const response = await ask(message);
  expect(response.actions).toHaveLength(1);
  const action = response.actions[0];
  expect(action).toMatchObject({ action: 'queue_action', requiresConfirmation: true, status: 'pending_confirmation' });
  const { toolName, input, agentRunId } = action.params;
  expect(toolName).toBe('cancelWashingReservation');
  expect(agentRunId).toBe(RUN_ID);
  // Store precisely the completed run's server proposal; no user-supplied action
  // or hand-built cancellation payload is substituted for the actual preview.
  mockDocuments.set(RUN_PATH, {
    userId: 'alice', schoolId: 'pu', status: 'completed', createdAt: Timestamp.now(),
    actionProposals: [{ toolName, input: mockClone(input) }], steps: [],
  });
  return { response, request: {
    auth: { uid: 'alice' }, data: { toolName, input, agentRunId, context: { schoolId: 'pu' } },
  } };
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW);
  mockDocuments.clear(); mockWrites.length = 0; mockReads.length = 0;
  mockModel.mockReset(); mockWebSearch.mockClear();
  for (const [path, data] of [
    ['users/alice', { schoolId: 'pu', role: 'student' }],
    ['schools/pu/members/alice', { status: 'active', role: 'student' }],
    [PERMISSION_PATH, { cancelWashingReservation: true }],
    [SOURCE_PATH, row()],
    [MACHINE_PATH, { status: 'reserved', reservedBy: 'alice', activeReservationId: 'reservation-1', reservedUntil: row().reservedUntil }],
  ]) mockDocuments.set(path, data);
});
afterEach(() => jest.useRealTimers());

test('reads the real private source, previews without writing, then confirms the matching cancellation receipt', async () => {
  const before = serviceSnapshot();
  const { response, request } = await prepare();
  expectNoServiceWrite(before);
  expect(response.content).toContain('A2');
  expect(response.content).toContain('信德宿舍');
  expect(response.content).toContain('確認後才會');
  expect(response.debug.permissionScope).toBe('user_private');
  expect(request.data.input.expectedReservationVersion).toBe(washingReservationVersion('reservation-1', mockDocuments.get(SOURCE_PATH)));
  expect(mockModel).not.toHaveBeenCalled();
  expect(mockWebSearch).not.toHaveBeenCalled();

  const result = await executeAgentWrite(request);
  expect(result).toMatchObject({ success: true, toolName: 'cancelWashingReservation',
    reservationId: 'reservation-1', machineId: 'A2', dormitory: '信德宿舍',
    startTime: row().startTime, status: 'cancelled', userId: 'alice', schoolId: 'pu',
  });
  expect(mockDocuments.get(SOURCE_PATH).status).toBe('cancelled');
  expect(mockDocuments.get(MACHINE_PATH)).toMatchObject({ status: 'available', reservedBy: null, activeReservationId: null });
  expect(mockDocuments.get(RUN_PATH).actionClaims['0'].status).toBe('completed');
});

test('dismissing a prepared action leaves all service records unchanged', async () => {
  const before = serviceSnapshot();
  await prepare();
  // The existing UI's "先不要" path never invokes executeAgentWrite.
  expectNoServiceWrite(before);
  expect(mockDocuments.get(RUN_PATH).actionClaims).toBeUndefined();
});

test.each(['取消 A999 洗衣機預約', '取消明天 A2 洗衣機預約', '取消洗衣預約 編號 unknown'])('does not substitute another reservation for %s', async (message) => {
  const before = serviceSnapshot();
  const result = await ask(message);
  expect(result.actions).toEqual([]);
  expect(result.content).toContain('沒有找到');
  expectNoServiceWrite(before);
});

test('requires clarification when two real reservations match', async () => {
  mockDocuments.set('schools/pu/washingReservations/reservation-2', row());
  const before = serviceSnapshot();
  const result = await ask('取消 A2 洗衣機預約');
  expect(result.actions).toEqual([]);
  expect(result.content).toContain('多筆');
  expect(result.content).toContain('reservation-1');
  expect(result.content).toContain('reservation-2');
  expectNoServiceWrite(before);
});

test.each(['不要取消 A2 洗衣機預約', '取消全部洗衣預約', '取消 A2 和 A3 洗衣機預約'])('does not turn an unclear or negative instruction into a write: %s', async (message) => {
  const before = serviceSnapshot();
  const result = await ask(message);
  expect(result.actions).toEqual([]);
  expect(result.content).toContain('明確指定');
  expectNoServiceWrite(before);
});

test('does not select from an incomplete bounded source', async () => {
  for (let i = 0; i < 21; i++) mockDocuments.set(`schools/pu/washingReservations/extra-${i}`, row({ machineId: `B${i}` }));
  const before = serviceSnapshot();
  const result = await ask('取消 A2 洗衣機預約');
  expect(result.actions).toEqual([]);
  expect(result.content).toContain('無法完整查核');
  expectNoServiceWrite(before);
});

test.each(['malformed', 'unavailable'])('does not present a %s source as empty or successful', async (state) => {
  if (state === 'malformed') mockDocuments.set(SOURCE_PATH, row({ machineId: '' }));
  else mockDocuments.set('schools/pu/washingReservations', new Error('transport unavailable'));
  const before = serviceSnapshot();
  const result = await ask('取消 A2 洗衣機預約');
  expect(result.actions).toEqual([]);
  expect(result.content).toContain('無法完整查核');
  expectNoServiceWrite(before);
});

test('does not read another person or campus while finding a cancellation target', async () => {
  mockDocuments.delete(SOURCE_PATH);
  mockDocuments.set('schools/pu/washingReservations/bob-1', row({ userId: 'bob' }));
  mockDocuments.set('schools/other/washingReservations/alice-1', row({ schoolId: 'other' }));
  const result = await ask('取消 A2 洗衣機預約');
  expect(result.actions).toEqual([]);
  expect(result.content).toContain('沒有找到');
  expect(result.content).not.toMatch(/bob-1|alice-1/);
  expect(mockReads.some((path) => path.includes('schools/other'))).toBe(false);
});

test('an explicit foreign reservation ID is not private source authority', async () => {
  mockDocuments.set('schools/pu/washingReservations/bob-1', row({ userId: 'bob' }));
  const before = serviceSnapshot();
  await expect(ask('取消洗衣預約 編號 bob-1')).rejects.toMatchObject({ code: 'permission-denied' });
  expectNoServiceWrite(before);
});

test('turning off the separate cancellation permission produces no draft', async () => {
  mockDocuments.set(PERMISSION_PATH, { reserveWashingMachine: true });
  const before = serviceSnapshot();
  const result = await ask('取消 A2 洗衣機預約');
  expect(result.actions.some((action) => action.action === 'queue_action')).toBe(false);
  expect(result.debug.writePermissionDenied).toBe('cancelWashingReservation');
  expect(mockReads).not.toContain('schools/pu/washingReservations');
  expectNoServiceWrite(before);
});

test.each([
  ['source', 'failed-precondition'], ['permission', 'permission-denied'],
  ['membership', 'permission-denied'], ['account', 'failed-precondition'],
])('rejects %s changes between preview and confirmation', async (change, code) => {
  const { request } = await prepare();
  if (change === 'source') mockDocuments.set(SOURCE_PATH, row({ startTime: '2026-11-17T20:00:00+08:00' }));
  if (change === 'permission') mockDocuments.set(PERMISSION_PATH, { cancelWashingReservation: false });
  if (change === 'membership') mockDocuments.set('schools/pu/members/alice', { status: 'suspended' });
  if (change === 'account') mockDocuments.set('users/alice', { schoolId: 'pu', status: 'disabled' });
  const before = serviceSnapshot();
  mockWrites.length = 0;
  await expect(executeAgentWrite(request)).rejects.toMatchObject({ code });
  expectNoServiceWrite(before);
});

test.each(['account', 'school', 'input'])('cannot reuse the confirmation after a %s switch', async (change) => {
  const { request } = await prepare();
  if (change === 'account') {
    mockDocuments.set('users/bob', { schoolId: 'pu' });
    mockDocuments.set('schools/pu/members/bob', { status: 'active' });
    mockDocuments.set('users/bob/settings/assistantPermissions', { cancelWashingReservation: true });
    request.auth.uid = 'bob';
  } else if (change === 'school') {
    mockDocuments.set('schools/other/members/alice', { status: 'active' });
    request.data.context.schoolId = 'other';
  } else request.data.input = { ...request.data.input, machineId: 'A999' };
  const before = serviceSnapshot();
  mockWrites.length = 0;
  await expect(executeAgentWrite(request)).rejects.toMatchObject({ code: 'permission-denied' });
  expectNoServiceWrite(before);
});

test('a lost client response is recovered through status read, not automatic re-execution', async () => {
  const { request } = await prepare();
  await executeAgentWrite(request); // The transport result is deliberately discarded.
  const before = serviceSnapshot();
  mockWrites.length = 0;
  await expect(executeAgentWrite(request)).rejects.toMatchObject({ code: 'already-exists' });
  mockDocuments.set(PERMISSION_PATH, { cancelWashingReservation: false });
  const status = await ask('洗衣預約 編號 reservation-1 取消成功了嗎？');
  expect(status.actions).toEqual([]);
  expect(status.content).toContain('已取消');
  expect(status.content).toContain('reservation-1');
  expectNoServiceWrite(before);
});
