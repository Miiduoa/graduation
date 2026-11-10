'use strict';

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => {
    const ref = {
      collection: () => ref,
      doc: () => ref,
      get: async () => ({ exists: false }),
    };
    return ref;
  },
}));

const registry = require('./agent/tools/registry');
const { callAssistantModel, callAssistantModelWithTools } = require('./assistantAgent');
const originalEnv = { ...process.env };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function reply(message) {
  return new Response(JSON.stringify({ choices: [{ message }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function call(id, name) {
  return { id, type: 'function', function: { name, arguments: '{}' } };
}

function run(fetchImpl, signal) {
  return callAssistantModelWithTools({
    messages: [{ role: 'user', content: '查詢今天的校園安排' }],
    toolCtx: { uid: 'alice', schoolId: 'pu' },
    providerOrder: ['groq'],
    maxRounds: 1,
    fetchImpl,
    signal,
  });
}

beforeEach(() => {
  process.env.GROQ_API_KEY = 'synthetic-test-key';
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
});

afterEach(() => {
  process.env = { ...originalEnv };
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('an already cancelled run cannot reach a provider or tool', async () => {
  const controller = new AbortController();
  const reason = new Error('cancelled-before-start');
  controller.abort(reason);
  const fetchImpl = jest.fn(async () => reply({ content: 'late-answer' }));
  const dispatch = jest.spyOn(registry, 'runTool');

  await expect(run(fetchImpl, controller.signal)).rejects.toBe(reason);
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});

test('a provider that ignores abort cannot start tools from a late response', async () => {
  const controller = new AbortController();
  const arrived = deferred();
  const response = deferred();
  const dispatch = jest.spyOn(registry, 'runTool').mockResolvedValue({ status: 'available' });
  const fetchImpl = jest.fn(() => { arrived.resolve(); return response.promise; });
  const result = run(fetchImpl, controller.signal).catch((error) => error);
  await arrived.promise;
  const reason = new Error('model-timeout');
  controller.abort(reason);
  const lateResponse = reply({ tool_calls: [call('late-read', 'getTodaySchedule')] });
  const cancelBody = jest.spyOn(lateResponse.body, 'cancel');
  response.resolve(lateResponse);

  expect(await result).toBe(reason);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][1].signal).toBe(controller.signal);
  expect(dispatch).not.toHaveBeenCalled();
  expect(cancelBody).toHaveBeenCalledTimes(1);
});

test('cancellation during a tool prevents its sibling and the final model round', async () => {
  const controller = new AbortController();
  const arrived = deferred();
  const firstTool = deferred();
  const dispatch = jest.spyOn(registry, 'runTool')
    .mockImplementationOnce(() => { arrived.resolve(); return firstTool.promise; })
    .mockResolvedValue({ status: 'available' });
  const fetchImpl = jest.fn()
    .mockResolvedValueOnce(reply({ tool_calls: [call('one', 'getTodaySchedule'), call('two', 'getAssignments')] }))
    .mockImplementation(async () => reply({ content: 'late-answer' }));
  const result = run(fetchImpl, controller.signal).catch((error) => error);
  await arrived.promise;
  const reason = new Error('model-timeout');
  controller.abort(reason);
  firstTool.resolve({ privateData: 'late-private-result' });

  expect(await result).toBe(reason);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('a cancelled provider failure cannot fall back to another provider', async () => {
  const controller = new AbortController();
  const arrived = deferred();
  const response = deferred();
  const fetchImpl = jest.fn()
    .mockImplementationOnce(() => { arrived.resolve(); return response.promise; })
    .mockImplementation(async () => reply({ content: 'fallback-answer' }));
  const result = callAssistantModel({
    messages: [{ role: 'user', content: '查校園公告' }],
    providerOrder: ['groq'],
    fetchImpl,
    signal: controller.signal,
  }).catch((error) => error);
  await arrived.promise;
  const reason = new Error('model-timeout');
  controller.abort(reason);
  response.reject(new Error('provider-disconnected'));

  expect(await result).toBe(reason);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('cancellation clears a provider retry wait without another attempt', async () => {
  jest.useFakeTimers();
  const controller = new AbortController();
  const reason = new Error('model-timeout');
  const fetchImpl = jest.fn(async () => new Response('', {
    status: 429, headers: { 'Retry-After': '60' },
  }));
  const result = callAssistantModel({
    messages: [{ role: 'user', content: '查校園公告' }],
    providerOrder: ['groq'],
    fetchImpl,
    signal: controller.signal,
  }).catch((error) => error);
  await jest.advanceTimersByTimeAsync(0);
  controller.abort(reason);
  await jest.advanceTimersByTimeAsync(60_000);

  expect(await result).toBe(reason);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
