// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { parseAssistantTaskRetry } from '@campus/shared/src/assistantTaskRetry';
import { handleNuni } from '../api';
import { sealCookie, SESSION_COOKIE, sessionContext } from '../server';
import { issueRoute } from './actions';
import { createAdapter } from './adapter';
import { fixtureAdapter, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { run } from './runner';

const model = vi.hoisted(() => vi.fn());
vi.mock('./adapter', async original => ({ ...(await original<typeof import('./adapter')>()), createAdapter: vi.fn() }));
vi.mock('./groq', async original => ({ ...(await original<typeof import('./groq')>()), createProviderModel: () => model }));
const session = { sessionHandle: 'ps_' + 'r'.repeat(43), expiresAt: now + 3600000 };
let account: string, serial = 1900;
let fixture: ReturnType<typeof fixtureAdapter>;
const binding = () => ({ account, session: sessionContext(session), schoolId: 'fixture-school', conversationId: 'retry-handler' });
function request(action: string, input: object, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new NextRequest('http://localhost:3000/api/nuni/assistant/' + action, {
    method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      'X-Campus-Session': sessionContext(session), Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(input), signal,
  });
}
const send = (input: object, headers?: Record<string, string>, signal?: AbortSignal) =>
  handleNuni(request('retry', input, headers, signal), ['assistant', 'retry']);
async function prepared() {
  const transit = fixture.adapter.transit;
  vi.spyOn(fixture.adapter, 'transit').mockRejectedValueOnce(new Error('Offline'));
  const reply = await run({ question: '查今天課表，查公車', history: [], binding: binding(), adapter: fixture.adapter,
    secret, now, writes: true, signal: new AbortController().signal, model, log: () => {} });
  const proof = parseAssistantTaskRetry('taskRetry' in reply ? reply.taskRetry : undefined);
  expect(proof).not.toBeNull();
  vi.mocked(fixture.adapter.transit).mockImplementation(transit).mockClear();
  vi.spyOn(fixture.adapter, 'ledger');
  return { schoolId: binding().schoolId, conversationId: binding().conversationId, token: proof!.token, stepIds: proof!.stepIds };
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  for (const [name, value] of Object.entries({ CAMPUS_BACKEND: 'nuni', CAMPUS_ASSISTANT_ENABLED: 'true',
    CAMPUS_ASSISTANT_V2_ENABLED: 'true', CAMPUS_ASSISTANT_V2_WRITES_ENABLED: 'false', BFF_SESSION_SECRET: secret,
    WEB_PUBLIC_ORIGIN: 'http://localhost:3000', GROQ_API_KEY: '', CAMPUS_ASSISTANT_V2_FALLBACK_ACCOUNT_ID: '',
    CAMPUS_ASSISTANT_V2_FALLBACK_API_TOKEN: '', FLY_MACHINE_ID: '' })) vi.stubEnv(name, value);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  model.mockReset().mockRejectedValue(new Error('Read retry must not call a model'));
  account = 'pa_00000000-0000-4000-8000-' + String(++serial).padStart(12, '0');
  fixture = fixtureAdapter();
  vi.spyOn(fixture.adapter, 'write');
  vi.mocked(createAdapter).mockReset().mockReturnValue({ adapter: fixture.adapter,
    principal: async () => ({ platformAccountId: account, isPlatformOperator: false }), apiCalls: () => 0 });
});
afterEach(() => {
  expect(model).not.toHaveBeenCalled();
  expect(fixture.adapter.write).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('uses the real authenticated BFF retry route with writes and models disabled', async () => {
  const input = await prepared();
  const response = await send(input);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ version: 2, dataRead: true, modelCalls: 0, cards: [],
    taskPlan: { version: 1, steps: [{ id: 'task-2', serviceId: 'bus', status: 'completed' }] } });
  expect(fixture.adapter.transit).toHaveBeenCalledOnce();
  expect(fixture.adapter.ledger).not.toHaveBeenCalled();
});

it.each([
  [{ cookie: '' }, 401], [{ Origin: 'https://other.example' }, 403], [{ 'X-Campus-Session': 'wrong' }, 409],
] as [Record<string, string>, number][])('validates the current login, origin and session before source access: %j', async (headers, status) => {
  const input = await prepared();
  vi.mocked(createAdapter).mockClear();
  expect((await send(input, headers)).status).toBe(status);
  expect(createAdapter).not.toHaveBeenCalled();
  expect(fixture.adapter.transit).not.toHaveBeenCalled();
});

it.each(['account', 'school', 'conversation', 'token', 'step', 'expired'])('rejects a changed %s at the BFF boundary', async mode => {
  const input = await prepared();
  if (mode === 'account') account = 'pa_00000000-0000-4000-8000-999999999999';
  if (mode === 'school') input.schoolId = 'another-school';
  if (mode === 'conversation') input.conversationId = 'another-conversation';
  if (mode === 'token') input.token = 'A' + input.token.slice(1);
  if (mode === 'step') input.stepIds = ['task-1'];
  if (mode === 'expired') vi.mocked(Date.now).mockReturnValue(now + 900000);
  const response = await send(input);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: mode === 'expired' ? 'TASK_RETRY_EXPIRED' : 'TASK_RETRY_INVALID', message: expect.any(String) });
  expect(fixture.adapter.transit).not.toHaveBeenCalled();
  expect(fixture.adapter.ledger).not.toHaveBeenCalled();
});

it.each([{ question: '重新下單' }, { routeToken: 'route' }, { args: {} }, { consent: true }, { stepIds: [] }])(
  'does not accept a new instruction or substitute proof %j', async change => {
    const input = await prepared();
    const response = await send({ ...input, ...change });
    expect([409, 422]).toContain(response.status);
    expect(fixture.adapter.transit).not.toHaveBeenCalled();
  },
);

it('can perform a read on another instance without taking over the original card issuer', async () => {
  vi.stubEnv('FLY_MACHINE_ID', 'old-machine');
  const input = await prepared();
  vi.stubEnv('FLY_MACHINE_ID', 'new-machine');
  const response = await send(input);
  expect(response.status).toBe(200);
  expect(response.headers.get('fly-replay')).toBeNull();
  expect(await response.json()).toMatchObject({ cards: [], dataRead: true });
});

it('bounds retries independently without spending the chat allowance', async () => {
  const input = await prepared();
  for (let index = 0; index < 3; index++) expect((await send(input)).status).toBe(200);
  const limited = await send(input);
  expect(limited.status).toBe(429);
  expect(limited.headers.get('Retry-After')).toBe('60');
  expect(await limited.json()).toMatchObject({ error: 'TASK_RETRY_LIMIT' });
  const scope = binding();
  const response = await handleNuni(request('ask', { schoolId: scope.schoolId, conversationId: scope.conversationId,
    routeToken: issueRoute(scope, secret), consent: true, question: '查今天課表', history: [] }), ['assistant', 'ask']);
  expect(response.status).toBe(200);
});

it('returns 499 for a cancelled retry and releases its in-flight limit', async () => {
  const input = await prepared(), original = fixtureAdapter().adapter.transit;
  let resolve!: (value: unknown) => void;
  vi.mocked(fixture.adapter.transit).mockImplementation(() => new Promise(done => { resolve = done; }));
  const controller = new AbortController(), response = send(input, {}, controller.signal);
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  expect((await send(input)).status).toBe(429);
  controller.abort();
  expect((await response).status).toBe(499);
  resolve({ status: 'ready', kind: 'arrivals', arrivals: [] });
  vi.mocked(fixture.adapter.transit).mockImplementation(original);
  expect((await send(input)).status).toBe(200);
});
