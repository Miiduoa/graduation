'use strict';

const mockDocuments = new Map();
const mockReads = [];
const mockWrite = jest.fn();
let mockReadHook;

function mockRef(path) {
  return {
    collection: (name) => mockRef(`${path}/${name}`),
    doc: (id) => mockRef(`${path}/${id}`),
    set: mockWrite,
    get: async () => {
      mockReads.push(path);
      if (mockReadHook) mockReadHook(path);
      const data = mockDocuments.get(path);
      return { exists: data !== undefined, data: () => data };
    },
  };
}

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: (name) => mockRef(name) }),
  FieldValue: { serverTimestamp: () => 'server-timestamp' },
}));
jest.mock('./lib/onlineOrdering', () => ({
  isOnlineOrderingEnabled: () => true,
  ONLINE_ORDERING_OFF_MESSAGE: 'online ordering off',
}));

// Keep the production registry, schema parsing, permission reader, and tools.
// Only Firestore and the model transport use synthetic, in-process fixtures.
const registry = require('./agent/tools/registry');
const { callAssistantModelWithTools } = require('./assistantAgent');
const originalEnv = { ...process.env };
const permissionPath = 'users/alice/settings/assistantPermissions';
const context = { uid: 'alice', schoolId: 'pu', role: 'student' };

function call(id, name, args) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function model(calls) {
  const response = (message) => new Response(JSON.stringify({ choices: [{ message }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  return jest.fn()
    .mockImplementationOnce(async () => response({ tool_calls: calls }))
    .mockImplementation(async () => response({ content: '請確認訂單草稿。' }));
}

function run(fetchImpl) {
  return callAssistantModelWithTools({
    messages: [{ role: 'user', content: '協助處理校園事項' }],
    toolCtx: context,
    providerOrder: ['groq'],
    maxRounds: 1,
    fetchImpl,
  });
}

beforeEach(() => {
  mockDocuments.clear();
  mockReads.length = 0;
  mockWrite.mockReset();
  mockReadHook = undefined;
  process.env.GROQ_API_KEY = 'synthetic-test-key';
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
});

afterEach(() => {
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

test('an actual role-denied tool stops the batch before another real tool can read data', async () => {
  const dispatch = jest.spyOn(registry, 'runTool');
  const fetchImpl = model([
    call('quiz', 'draftQuizFromBank', {
      schoolId: 'other-school',
      bankId: 'private-bank',
      courseSpaceId: 'private-course',
      title: 'private-draft-title',
      count: 1,
    }),
    call('menu', 'getCafeteriaMenu', { cafeteriaId: 'later-read' }),
  ]);

  const result = await run(fetchImpl);

  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(result.securityEvent).toEqual({ action: 'stop_tool_run', reason: 'authorization_denied' });
  expect(result.toolCallsTrace).toEqual([
    { name: 'draftQuizFromBank', args: {}, output: { success: false, errorCode: 'authorization_denied' } },
  ]);
  expect(result.transcriptMessages).toEqual([]);
  expect(result.cards).toEqual([]);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(mockReads).toEqual([permissionPath]);
  expect(mockWrite).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain('private-');
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('revoking order permission after tool publication stops dispatch and a later request can recover', async () => {
  mockDocuments.set(permissionPath, { createOrder: true });
  const draftArgs = {
    cafeteriaId: 'cafe',
    items: [{ menuItemId: 'rice', quantity: 1 }],
    note: 'private-order-note',
  };
  let permissionReads = 0;
  mockReadHook = (path) => {
    if (path === permissionPath && ++permissionReads === 2) {
      mockDocuments.set(permissionPath, { createOrder: false });
    }
  };
  const dispatch = jest.spyOn(registry, 'runTool');
  const fetchImpl = model([
    call('draft', 'proposeOrder', draftArgs),
    call('menu', 'getCafeteriaMenu', { cafeteriaId: 'later-read' }),
  ]);

  const result = await run(fetchImpl);

  expect(JSON.parse(fetchImpl.mock.calls[0][1].body).tools.map((tool) => tool.function.name)).toContain('proposeOrder');
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(result.securityEvent?.reason).toBe('authorization_denied');
  expect(result.toolCallsTrace[0]).toMatchObject({ args: {}, output: { errorCode: 'authorization_denied' } });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(result.transcriptMessages).toEqual([]);
  expect(result.cards).toEqual([]);
  expect(mockReads).toEqual([permissionPath, permissionPath]);
  expect(JSON.stringify(result)).not.toContain('private-order-note');
  expect(mockWrite).not.toHaveBeenCalled();

  // A blocked run does not poison another request after permission is restored.
  mockReadHook = undefined;
  mockDocuments.set(permissionPath, { createOrder: true });
  mockDocuments.set('schools/pu/cafeterias/cafe', { name: '校園餐廳', orderingEnabled: true });
  mockDocuments.set('schools/pu/cafeterias/cafe/menuItems/rice', {
    name: '雞腿飯', price: 90, available: true, stock: 10,
  });
  const nextFetch = model([call('allowed-draft', 'proposeOrder', { ...draftArgs, note: undefined })]);
  const next = await run(nextFetch);

  expect(next.securityEvent).toBeUndefined();
  expect(next.toolCallsTrace[0].output).toMatchObject({ success: true, draft: { cafeteriaId: 'cafe' } });
  expect(nextFetch).toHaveBeenCalledTimes(2);
  expect(mockWrite).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
