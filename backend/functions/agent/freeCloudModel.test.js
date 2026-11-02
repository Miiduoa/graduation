'use strict';

const {
  requestFreeCloudPlan,
  resolveFreeCloudPolicy,
  getFreeCloudReadiness,
  GROQ_MODEL,
  GROQ_CHAT_URL,
  DEADLINE_MS,
  MAX_MESSAGE_CHARS,
  MAX_RESPONSE_BYTES,
  MAX_TOKENS,
} = require('./freeCloudModel');
const { callAssistantModel } = require('../assistantAgent');

const messages = [{ role: 'user', content: '查詢圖書館位置' }];
const configured = {
  CAMPUS_AGENT_GROQ_FREE_TIER_CONFIRMED: 'true',
  GROQ_API_KEY: 'fake-free-key',
  GROQ_MODEL,
};
const envNames = [
  ...Object.keys(configured),
  'GROQ_BASE_URL',
  'OPENAI_COMPAT_MODEL',
  'ASSISTANT_MODEL_PROVIDERS',
  'ASSISTANT_MODEL_MAX_TOKENS',
  'ASSISTANT_MODEL_TEMPERATURE',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'OLLAMA_API_KEY',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
];
let previousEnv;

beforeEach(() => {
  previousEnv = new Map(envNames.map((name) => [name, process.env[name]]));
  envNames.forEach((name) => {
    delete process.env[name];
  });
  Object.assign(process.env, configured);
});
afterEach(() => {
  for (const [name, value] of previousEnv) {
    if (value == null) delete process.env[name];
    else process.env[name] = value;
  }
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function okResponse(content = '圖書館位置請參考已核實的校園地圖。', extra = {}) {
  return new Response(JSON.stringify({ choices: [{ message: { content, ...extra } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 16; i += 1) await Promise.resolve();
}

async function directAdapter({ messages: input, fetchImpl }, overrides = {}, url = GROQ_CHAT_URL) {
  const response = await fetchImpl(url, {
    method: 'POST',
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: input,
      max_tokens: 900,
      temperature: 0.4,
      stream: false,
      ...overrides,
    }),
  });
  const data = await response.json();
  return { provider: 'groq', model: GROQ_MODEL, content: data.choices[0].message.content };
}

test.each([
  {},
  { ...configured, CAMPUS_AGENT_GROQ_FREE_TIER_CONFIRMED: 'false' },
  { ...configured, CAMPUS_AGENT_GROQ_FREE_TIER_CONFIRMED: true },
  { ...configured, GROQ_MODEL: 'llama-3.3-70b-versatile' },
  { ...configured, GROQ_MODEL: ` ${GROQ_MODEL}` },
  { ...configured, GROQ_API_KEY: '  ' },
  { ...configured, GROQ_BASE_URL: 'https://paid.example/openai/v1' },
  { ...configured, GROQ_BASE_URL: 'http://api.groq.com/openai/v1' },
])('keeps unconfirmed or unsupported configuration disabled: %j', async (env) => {
  const fetchImpl = jest.fn();
  const modelCall = jest.fn();
  expect(resolveFreeCloudPolicy(env)).toEqual({ status: 'unavailable', reason: 'not_configured' });
  expect(getFreeCloudReadiness(env)).toBe(false);
  await expect(requestFreeCloudPlan({ messages }, { env, fetchImpl, modelCall })).resolves.toEqual({
    status: 'unavailable',
    reason: 'not_configured',
  });
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(modelCall).not.toHaveBeenCalled();
});

test('uses the real legacy adapter but sends only the approved model and official endpoint', async () => {
  expect(getFreeCloudReadiness(configured)).toBe(true);
  process.env.ASSISTANT_MODEL_PROVIDERS = 'gemini,ollama';
  process.env.GEMINI_API_KEY = 'fake-gemini-key';
  process.env.OLLAMA_BASE_URL = 'https://paid.example/v1';
  process.env.ASSISTANT_MODEL_MAX_TOKENS = '50000';
  const fetchImpl = jest.fn().mockResolvedValue(okResponse());
  const result = await requestFreeCloudPlan(
    {
      messages: [
        { ...messages[0], privateField: 'must-not-be-sent', tool_calls: [{ id: 'ignored' }] },
      ],
    },
    { fetchImpl },
  );
  expect(result).toMatchObject({ status: 'ok', provider: 'groq', model: GROQ_MODEL });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const [url, request] = fetchImpl.mock.calls[0];
  expect(url).toBe(GROQ_CHAT_URL);
  expect(request.redirect).toBe('error');
  expect(request.headers).toEqual({
    Authorization: 'Bearer fake-free-key',
    'Content-Type': 'application/json',
  });
  expect(JSON.parse(request.body)).toEqual({
    model: GROQ_MODEL,
    messages,
    max_tokens: MAX_TOKENS,
    temperature: 0.4,
    stream: false,
  });
  expect(request.signal).toBeInstanceOf(AbortSignal);
  expect(request.signal.aborted).toBe(true);
});

test('an injected policy cannot silently change the legacy process model or endpoint', async () => {
  const fetchImpl = jest.fn();
  process.env.GROQ_MODEL = 'paid-model';
  await expect(requestFreeCloudPlan({ messages }, { env: configured, fetchImpl })).resolves.toEqual(
    {
      status: 'unavailable',
      reason: 'invalid_response',
    },
  );
  expect(process.env.GROQ_MODEL).toBe('paid-model');
  expect(fetchImpl).not.toHaveBeenCalled();
  process.env.GROQ_MODEL = GROQ_MODEL;
  process.env.GROQ_BASE_URL = 'https://paid.example/v1';
  await expect(requestFreeCloudPlan({ messages }, { env: configured, fetchImpl })).resolves.toEqual(
    {
      status: 'unavailable',
      reason: 'provider_error',
    },
  );
  expect(process.env.GROQ_BASE_URL).toBe('https://paid.example/v1');
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('uses an injected key only in the fixed official request without mutating process env', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(okResponse());
  await expect(
    requestFreeCloudPlan(
      { messages },
      {
        env: { ...configured, GROQ_API_KEY: 'fake-injected-key' },
        fetchImpl,
      },
    ),
  ).resolves.toMatchObject({ status: 'ok' });
  expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer fake-injected-key');
  expect(process.env.GROQ_API_KEY).toBe('fake-free-key');
});

test.each([401, 403, 500, 503])(
  'stops after one HTTP %s, before legacy retries or fallback',
  async (status) => {
    jest.useFakeTimers();
    process.env.GEMINI_API_KEY = 'fake-gemini-key';
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434/v1';
    const fetchImpl = jest.fn().mockResolvedValue(new Response('not exposed', { status }));
    const result = await requestFreeCloudPlan({ messages }, { fetchImpl });
    expect(result).toEqual({ status: 'unavailable', reason: 'provider_error' });
    await jest.runAllTimersAsync();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  },
);

test('429 never enters the legacy sleep, bounds retry-after, and cancels its error body', async () => {
  jest.useFakeTimers();
  const cancel = jest.fn();
  const fetchImpl = jest.fn().mockResolvedValue({
    ok: false,
    status: 429,
    headers: new Headers({ 'retry-after': '999999999999' }),
    body: { cancel },
  });
  const result = await requestFreeCloudPlan({ messages }, { fetchImpl });
  expect(result).toEqual({ status: 'unavailable', reason: 'rate_limited', retryAfterSeconds: 60 });
  await jest.runAllTimersAsync();
  expect(cancel).toHaveBeenCalled();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test.each(['nonsense', '-3', '0'])('omits invalid retry-after %s', async (retryAfter) => {
  const fetchImpl = jest
    .fn()
    .mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': retryAfter } }));
  await expect(requestFreeCloudPlan({ messages }, { fetchImpl })).resolves.toEqual({
    status: 'unavailable',
    reason: 'rate_limited',
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('supports a future HTTP-date retry hint without waiting or retrying', async () => {
  jest.useFakeTimers({ now: new Date('2026-11-01T00:00:00Z') });
  const fetchImpl = jest.fn().mockResolvedValue(
    new Response('', {
      status: 429,
      headers: { 'retry-after': 'Sun, 01 Nov 2026 00:00:12 GMT' },
    }),
  );
  await expect(requestFreeCloudPlan({ messages }, { fetchImpl })).resolves.toEqual({
    status: 'unavailable',
    reason: 'rate_limited',
    retryAfterSeconds: 12,
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('network failures cannot trigger another outbound request', async () => {
  const fetchImpl = jest.fn().mockRejectedValue(new Error('secret transport detail'));
  await expect(requestFreeCloudPlan({ messages }, { fetchImpl })).resolves.toEqual({
    status: 'unavailable',
    reason: 'provider_error',
  });
  await flush();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test.each([
  'http://localhost:11434/v1/chat/completions',
  'https://api.openai.com/v1/chat/completions',
  'https://api.groq.com.evil.example/openai/v1/chat/completions',
  `${GROQ_CHAT_URL}?model=paid`,
])('blocks an adapter trying an unapproved outbound URL %s', async (url) => {
  const fetchImpl = jest.fn();
  const modelCall = (input) => directAdapter(input, {}, url);
  await expect(requestFreeCloudPlan({ messages }, { fetchImpl, modelCall })).resolves.toEqual({
    status: 'unavailable',
    reason: 'provider_error',
  });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test.each([
  { model: 'paid-model' },
  { tools: [] },
  { tool_choice: 'auto' },
  { response_format: { type: 'json_schema' } },
  { max_tokens: null },
  { temperature: -1 },
  { stream: true },
  { messages: [{ role: 'user', content: 'different request' }] },
])('rejects unsupported actual request fields: %j', async (overrides) => {
  const fetchImpl = jest.fn();
  await expect(
    requestFreeCloudPlan(
      { messages },
      {
        fetchImpl,
        modelCall: (input) => directAdapter(input, overrides),
      },
    ),
  ).resolves.toEqual({ status: 'unavailable', reason: 'invalid_response' });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test.each(
  [
    [],
    [{ role: 'tool', content: 'untrusted tool output' }],
    [{ role: 'user', content: {} }],
    [{ role: 'user', content: 'x'.repeat(MAX_MESSAGE_CHARS + 1) }],
    Array.from({ length: 21 }, () => messages[0]),
    Array.from({ length: 5 }, () => ({ role: 'user', content: 'x'.repeat(MAX_MESSAGE_CHARS) })),
  ].map((input) => ({ input })),
)('rejects unbounded or non-text input before invoking a model', async ({ input }) => {
  const fetchImpl = jest.fn();
  const modelCall = jest.fn();
  await expect(
    requestFreeCloudPlan({ messages: input }, { fetchImpl, modelCall }),
  ).resolves.toEqual({
    status: 'unavailable',
    reason: 'invalid_response',
  });
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(modelCall).not.toHaveBeenCalled();
});

test.each([
  () => new Response('', { status: 302, headers: { location: 'https://paid.example/' } }),
  () => ({ ok: true, status: 200, redirected: true, body: { cancel: jest.fn() } }),
  () => ({ ok: true, status: 200, url: 'https://paid.example/', body: { cancel: jest.fn() } }),
])('rejects redirect responses without following them', async (makeResponse) => {
  const fetchImpl = jest.fn().mockResolvedValue(makeResponse());
  await expect(requestFreeCloudPlan({ messages }, { fetchImpl })).resolves.toEqual({
    status: 'unavailable',
    reason: 'provider_error',
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][1].redirect).toBe('error');
});

test.each([
  () => new Response('not-json'),
  () => okResponse(''),
  () => okResponse('x'.repeat(8001)),
  () =>
    okResponse('text', {
      tool_calls: [{ function: { name: 'submitLeaveRequest', arguments: '{}' } }],
    }),
  () => okResponse('text', { function_call: { name: 'submitLeaveRequest' } }),
  () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)),
])('rejects invalid provider content and never runs model tool calls', async (makeResponse) => {
  const fetchImpl = jest.fn().mockResolvedValue(makeResponse());
  await expect(requestFreeCloudPlan({ messages }, { fetchImpl })).resolves.toEqual({
    status: 'unavailable',
    reason: 'invalid_response',
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body).tools).toBeUndefined();
});

test('does not accept an injected model response that skipped the guarded transport', async () => {
  const fetchImpl = jest.fn();
  await expect(
    requestFreeCloudPlan(
      { messages },
      {
        fetchImpl,
        modelCall: jest
          .fn()
          .mockResolvedValue({ provider: 'groq', model: GROQ_MODEL, content: 'pretend success' }),
      },
    ),
  ).resolves.toEqual({ status: 'unavailable', reason: 'invalid_response' });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('already canceled requests invoke neither model nor transport', async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchImpl = jest.fn();
  const modelCall = jest.fn();
  await expect(
    requestFreeCloudPlan({ messages, signal: controller.signal }, { fetchImpl, modelCall }),
  ).resolves.toEqual({
    status: 'unavailable',
    reason: 'canceled',
  });
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(modelCall).not.toHaveBeenCalled();
});

test('canceling in-flight fetch aborts it and discards a transport that resolves late', async () => {
  const pending = deferred();
  const controller = new AbortController();
  const cancel = jest.fn();
  const fetchImpl = jest.fn(() => pending.promise);
  const result = requestFreeCloudPlan({ messages, signal: controller.signal }, { fetchImpl });
  await flush();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  controller.abort();
  await expect(result).resolves.toEqual({ status: 'unavailable', reason: 'canceled' });
  expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  pending.resolve({ ok: true, status: 200, body: { cancel } });
  await flush();
  expect(cancel).toHaveBeenCalled();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('the total deadline covers a never-resolving model call', async () => {
  jest.useFakeTimers();
  const fetchImpl = jest.fn();
  const result = requestFreeCloudPlan(
    { messages },
    { fetchImpl, modelCall: () => new Promise(() => {}) },
  );
  await jest.advanceTimersByTimeAsync(DEADLINE_MS);
  await expect(result).resolves.toEqual({ status: 'unavailable', reason: 'timeout' });
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('the total deadline aborts a pending fetch even when the transport ignores its signal', async () => {
  jest.useFakeTimers();
  const pending = deferred();
  const cancel = jest.fn();
  const fetchImpl = jest.fn(() => pending.promise);
  const result = requestFreeCloudPlan({ messages }, { fetchImpl });
  await flush();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(DEADLINE_MS);
  await expect(result).resolves.toEqual({ status: 'unavailable', reason: 'timeout' });
  expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  pending.resolve({ ok: true, status: 200, body: { cancel } });
  await flush();
  expect(cancel).toHaveBeenCalled();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test.each(['timeout', 'canceled'])(
  '%s covers body reads, cancels the reader and ignores late chunks',
  async (reason) => {
    jest.useFakeTimers();
    const pendingRead = deferred();
    const cancel = jest.fn();
    const read = jest.fn(() => pendingRead.promise);
    const controller = new AbortController();
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: { getReader: () => ({ read, cancel }) },
    });
    const result = requestFreeCloudPlan({ messages, signal: controller.signal }, { fetchImpl });
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    if (reason === 'timeout') await jest.advanceTimersByTimeAsync(DEADLINE_MS);
    else controller.abort();
    await expect(result).resolves.toEqual({ status: 'unavailable', reason });
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalled();
    pendingRead.resolve({
      done: false,
      value: Buffer.from(JSON.stringify({ choices: [{ message: { content: 'late' } }] })),
    });
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  },
);

test('a late adapter fallback cannot send another request after success', async () => {
  jest.useFakeTimers();
  const fetchImpl = jest.fn().mockResolvedValue(okResponse());
  let fallback;
  const modelCall = async (input) => {
    const result = await callAssistantModel(input);
    fallback = () =>
      directAdapter(input, {}, 'http://localhost:11434/v1/chat/completions').catch(() => {});
    return result;
  };
  await expect(requestFreeCloudPlan({ messages }, { fetchImpl, modelCall })).resolves.toMatchObject(
    { status: 'ok' },
  );
  await fallback();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('blocks a second valid official request within the same adapter call', async () => {
  const fetchImpl = jest.fn().mockImplementation(() => okResponse());
  const modelCall = async (input) => {
    await directAdapter(input);
    return directAdapter(input);
  };
  await expect(requestFreeCloudPlan({ messages }, { fetchImpl, modelCall })).resolves.toEqual({
    status: 'unavailable',
    reason: 'provider_error',
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('blocks a concurrent second official request while the first fetch is pending', async () => {
  const pending = deferred();
  const cancel = jest.fn();
  const fetchImpl = jest.fn(() => pending.promise);
  const modelCall = async (input) => {
    const first = directAdapter(input);
    await flush();
    await Promise.allSettled([first, directAdapter(input)]);
    return { provider: 'groq', model: GROQ_MODEL, content: 'must not succeed' };
  };
  await expect(requestFreeCloudPlan({ messages }, { fetchImpl, modelCall })).resolves.toEqual({
    status: 'unavailable',
    reason: 'provider_error',
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  pending.resolve({ ok: true, status: 200, body: { cancel } });
  await flush();
  expect(cancel).toHaveBeenCalled();
});
