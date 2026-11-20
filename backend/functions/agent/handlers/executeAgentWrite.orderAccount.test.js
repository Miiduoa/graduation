'use strict';

const mockDocuments = new Map();
const mockWrites = [];
const mockAccountReads = [];
let mockAfterClaim;
let mockAccountReadFailure = false;

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
  return { id: path.split('/').pop(), exists: documents.has(path), data: () => mockClone(data) };
}
function mockSet(reference, data, options) {
  mockWrites.push(reference.path);
  mockDocuments.set(reference.path, options?.merge
    ? mockMerge(mockDocuments.get(reference.path), data) : mockClone(data));
}
function mockRef(path, filters = [], maximum = Infinity) {
  return {
    path, filters, maximum, id: path.split('/').pop(),
    where: (field, operator, value) => mockRef(path, [...filters, { field, operator, value }], maximum),
    limit: (count) => mockRef(path, filters, count),
    collection: (name) => mockRef(`${path}/${name}`),
    doc: (id) => mockRef(`${path}/${id}`),
    get: async () => {
      if (path === 'users/alice') mockAccountReads.push('admission');
      return mockSnapshot(path);
    },
    set: async (data, options) => mockSet({ path }, data, options),
  };
}
const mockDb = {
  collection: mockRef,
  doc: mockRef,
  runTransaction: async (callback) => {
    const base = new Map([...mockDocuments].map(([path, data]) => [path, mockClone(data)]));
    const writes = [];
    const read = async (reference) => {
      if (reference.path === 'users/alice') {
        mockAccountReads.push('transaction');
        if (mockAccountReadFailure) throw new Error('account source unavailable');
      }
      if (reference.path.split('/').length % 2 === 0) return mockSnapshot(reference.path, base);
      const docs = [...base.keys()].filter((path) => path.startsWith(reference.path + '/') &&
        !path.slice(reference.path.length + 1).includes('/') &&
        reference.filters.every(({ field, operator, value }) => operator === '==' && base.get(path)[field] === value))
        .slice(0, reference.maximum).map((path) => mockSnapshot(path, base));
      return { docs, size: docs.length, empty: docs.length === 0 };
    };
    const result = await callback({
      get: read,
      getAll: async (...references) => Promise.all(references.map(read)),
      set: (...args) => writes.push(() => mockSet(...args)),
      create: (reference, data) => writes.push(() => {
        if (mockDocuments.has(reference.path)) throw new Error('already exists');
        mockSet(reference, data);
      }),
      update: (reference, data) => writes.push(() => mockSet(reference, data, { merge: true })),
    });
    for (const write of writes) write();
    // Deterministically change the source only after a real proposal claim commits.
    if (mockAfterClaim && mockDocuments.get(RUN_PATH)?.actionClaims?.['0']?.status === 'started') {
      const hook = mockAfterClaim;
      mockAfterClaim = undefined;
      hook();
    }
    return result;
  },
};

jest.mock('firebase-functions/v2/https', () => ({
  ...jest.requireActual('firebase-functions/v2/https'),
  onCall: (_, handler) => handler,
}));
jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: () => mockDb,
  FieldValue: { serverTimestamp: () => 'test-server-timestamp' },
}));

// Keep the actual callable, authorization, proposal claim, registry, tools and
// receipt checks. Only Firestore's transport and transaction storage are in memory.
const { Timestamp } = require('firebase-admin/firestore');
const executeAgentWrite = require('./executeAgentWrite');
const createOrder = require('../tools/createOrder');

const RUN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const RUN_PATH = `users/alice/agentRuns/${RUN_ID}`;
const orderInput = () => ({
  requestId: 'test-order-intent', cafeteriaId: 'cafe',
  items: [{ menuItemId: 'rice', quantity: 2 }], expectedTotal: 210, paymentMethod: 'onsite',
});
const isServicePath = (path) => path !== 'users/alice' && !path.startsWith('users/alice/agentRuns/');
function serviceSnapshot() {
  return [...mockDocuments].filter(([path]) => isServicePath(path))
    .map(([path, data]) => [path, mockClone(data)]);
}
function proposal() {
  const input = orderInput();
  mockDocuments.set(RUN_PATH, {
    userId: 'alice', schoolId: 'pu', status: 'completed', createdAt: Timestamp.now(),
    actionProposals: [{ toolName: 'createOrder', input }], steps: [],
  });
  return {
    auth: { uid: 'alice' },
    data: { toolName: 'createOrder', agentRunId: RUN_ID, input, context: { schoolId: 'pu' } },
  };
}
function expectNoServiceWrite(before) {
  expect(serviceSnapshot()).toEqual(before);
  expect(mockWrites.filter(isServicePath)).toEqual([]);
}
beforeEach(() => {
  mockDocuments.clear();
  mockWrites.length = 0;
  mockAccountReads.length = 0;
  mockAfterClaim = undefined;
  mockAccountReadFailure = false;
  for (const [path, data] of [
    ['users/alice', { schoolId: 'pu', status: 'active' }],
    ['schools/pu/members/alice', { status: 'active', role: 'student' }],
    ['users/alice/settings/assistantPermissions', { createOrder: true }],
    ['schools/pu/cafeterias/cafe', { name: 'Test cafe', orderingEnabled: true, pilotStatus: 'live' }],
    ['schools/pu/cafeterias/cafe/operators/operator', { status: 'active' }],
    ['schools/pu/menus/rice', { cafeteriaId: 'cafe', name: 'Test rice', price: 100,
      available: true, orderingEnabled: true, inventory: 10 }],
    ['users/alice/payments/untouched', { status: 'pending', amount: 100 }],
  ]) mockDocuments.set(path, data);
});

for (const mode of ['new order', 'existing order replay']) {
  test.each(['disabled', 'suspended', 'inactive', 'deleted', 'deleting', 'unreadable'])(
    `createOrder refuses ${mode} when the account becomes %s after claim`, async (state) => {
      if (mode === 'existing order replay') {
        const existing = await createOrder.execute({ uid: 'alice', schoolId: 'pu' }, orderInput());
        expect(existing).toMatchObject({ success: true, queueStatus: 'assigned' });
        mockDocuments.delete(`users/alice/schools/pu/orders/${existing.orderId}`);
      }
      mockWrites.length = 0;
      mockAccountReads.length = 0;
      const request = proposal();
      const before = serviceSnapshot();
      let changedAfterClaim = false;
      mockAfterClaim = () => {
        expect(mockAccountReads).toContain('admission');
        expect(mockAccountReads).not.toContain('transaction');
        expect(mockDocuments.get(RUN_PATH).actionClaims['0'].status).toBe('started');
        changedAfterClaim = true;
        if (state === 'unreadable') mockAccountReadFailure = true;
        else mockDocuments.set('users/alice', {
          ...mockDocuments.get('users/alice'),
          ...(state === 'deleting' ? { accountDeletionInProgress: true } : { status: state }),
        });
      };

      const result = await executeAgentWrite(request);
      expect(result).toMatchObject({ success: false, toolName: 'createOrder',
        errorCode: state === 'unreadable' ? 'write_failed' : 'failed-precondition' });
      expect(changedAfterClaim).toBe(true);
      expect(mockAccountReads).toContain('transaction');
      expectNoServiceWrite(before);
      const saved = mockDocuments.get(RUN_PATH);
      expect(saved.actionClaims['0'].status).toBe('failed');
      expect(saved.steps).toEqual([expect.objectContaining({ output: expect.objectContaining({ success: false }) })]);

      mockDocuments.set('users/alice', { schoolId: 'pu', status: 'active' });
      mockAccountReadFailure = false;
      await expect(executeAgentWrite(request)).rejects.toMatchObject({ code: 'already-exists' });
      expectNoServiceWrite(before);
    },
  );
}

test.each(['active', 'legacy', 'missing'])('normal %s account can create one priced order and obtain its queue number', async (state) => {
  const request = proposal();
  mockAfterClaim = () => {
    if (state === 'missing') mockDocuments.delete('users/alice');
    else mockDocuments.set('users/alice', { schoolId: 'pu', ...(state === 'active' ? { status: 'active' } : {}) });
  };
  const result = await executeAgentWrite(request);
  expect(result).toMatchObject({ success: true, toolName: 'createOrder', userId: 'alice', schoolId: 'pu',
    total: 210, paymentStatus: 'pending', queueStatus: 'assigned', queueNumber: 1 });
  const order = mockDocuments.get(`schools/pu/orders/${result.orderId}`);
  expect(mockDocuments.get(`users/alice/schools/pu/orders/${result.orderId}`)).toEqual(order);
  expect(mockDocuments.get('users/alice/payments/untouched')).toEqual({ status: 'pending', amount: 100 });
  expect(mockDocuments.get('schools/pu/menus/rice').inventory).toBe(10);
  expect(mockDocuments.get(RUN_PATH).actionClaims['0'].status).toBe('completed');
  const before = serviceSnapshot();
  mockWrites.length = 0;
  await expect(executeAgentWrite(request)).rejects.toMatchObject({ code: 'already-exists' });
  expectNoServiceWrite(before);
});
