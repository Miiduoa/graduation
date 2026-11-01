'use strict';

jest.mock('../lib/assistantFetchers', () => ({ fetchAssistantPois: jest.fn() }));
const { fetchAssistantPois } = require('../lib/assistantFetchers');
const { createCloudNavigationTask } = require('./cloudNavigationTask');
const MODEL = 'openai/gpt-oss-120b';
const ENV = {
  CAMPUS_AGENT_GROQ_FREE_TIER_CONFIRMED: 'true',
  GROQ_API_KEY: 'synthetic-test-key',
  GROQ_MODEL: MODEL,
  GROQ_BASE_URL: 'https://api.groq.com/openai/v1',
};
const rows = [
  {
    id: 'a-library',
    schoolId: 'pu',
    name: '圖書館',
    category: '公共設施',
    aliases: ['總圖'],
    lat: 24.2,
    lng: 120.5,
  },
  {
    id: 'b-hall',
    schoolId: 'pu',
    name: '活動中心',
    category: '活動',
    aliases: [],
    lat: 24.21,
    lng: 120.51,
  },
];
let prior;
beforeEach(() => {
  prior = Object.fromEntries(Object.keys(ENV).map((key) => [key, process.env[key]]));
  Object.assign(process.env, ENV);
  fetchAssistantPois.mockReset().mockImplementation(async () => structuredClone(rows));
});
afterEach(() => {
  for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const request = (data) => ({
  auth: { uid: 'synthetic-member' },
  data: {
    task: 'public-campus-navigation',
    schoolId: 'pu',
    query: '從圖書館到活動中心',
    ...data,
  },
});
async function plan(task) {
  const preview = await task(request({ phase: 'preview' }));
  expect(preview.status).toBe('preview');
  return request({
    phase: 'execute',
    requestId: 'integration-one',
    consent: {
      provider: 'groq',
      version: 1,
      schoolId: 'pu',
      query: preview.query,
      fingerprint: preview.fingerprint,
    },
  });
}
function setup(fetchImpl) {
  return createCloudNavigationTask({
    assertMembership: async () => true,
    enforceLimit: () => {},
    modelDeps: { env: ENV, fetchImpl },
  });
}

test('consented task uses the real guarded legacy adapter and real route tool with only synthetic transport/data', async () => {
  const transport = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '{"fromRef":"p0","toRef":"p1"}',
              },
            },
          ],
        }),
        { status: 200 },
      ),
  );
  const task = setup(transport);
  const input = await plan(task);
  expect(transport).not.toHaveBeenCalled();
  const result = await task(input);
  expect(result).toMatchObject({
    status: 'completed',
    provider: 'groq',
    model: MODEL,
    route: { from: { id: 'a-library', name: '圖書館' }, to: { id: 'b-hall', name: '活動中心' } },
  });
  expect(transport).toHaveBeenCalledTimes(1);
  const [url, options] = transport.mock.calls[0];
  expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
  const body = JSON.parse(options.body);
  expect(body.model).toBe(MODEL);
  expect(body.messages.map((message) => message.content).join('\n')).toContain('圖書館');
  expect(options.body).not.toMatch(/synthetic-member|a-library|b-hall|24\.2|120\.5|tool_calls/);
  expect(fetchAssistantPois.mock.calls.length).toBeGreaterThanOrEqual(4);
  expect(await task(input)).toMatchObject({ status: 'completed' });
  expect(transport).toHaveBeenCalledTimes(1);
});

test('real adapter preserves quota failure without invoking route lookup or another provider', async () => {
  const transport = jest.fn(
    async () => new Response('', { status: 429, headers: { 'Retry-After': '99999' } }),
  );
  const task = setup(transport);
  const input = await plan(task);
  const before = fetchAssistantPois.mock.calls.length;
  expect(await task(input)).toMatchObject({
    status: 'unavailable',
    reason: 'rate_limited',
    retryAfterSeconds: 60,
  });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(fetchAssistantPois.mock.calls.length - before).toBe(1);
});
