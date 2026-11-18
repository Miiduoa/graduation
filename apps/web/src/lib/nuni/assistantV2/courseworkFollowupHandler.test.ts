// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from '../api';
import { sealCookie, SESSION_COOKIE, sessionContext } from '../server';
import { createAdapter } from './adapter';
import { confirm, signCard } from './actions';
import { prepareCourseworkStudyRequest } from './courseworkStudyRequest';
import { fixtureAdapter, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';

const modelCall = vi.hoisted(() => vi.fn());
vi.mock('./adapter', async original => ({ ...(await original<typeof import('./adapter')>()), createAdapter: vi.fn() }));
vi.mock('./groq', async original => ({ ...(await original<typeof import('./groq')>()), createProviderModel: () => modelCall }));

const issuedSession = { sessionHandle: 'ps_' + 'i'.repeat(43), expiresAt: now + 3600000 };
const currentSession = { sessionHandle: 'ps_' + 'c'.repeat(43), expiresAt: now + 7200000 };
const target = { workspaceId: 'course-a', taskId: 'task-urgent', kind: 'assignment' as const };
let counter = 700;
let account: string;
let f: ReturnType<typeof fixtureAdapter>;
const binding = () => ({ account, session: sessionContext(issuedSession), schoolId: 'fixture-school', conversationId: 'prior-login-study' });
const request = (action: string, input: object, headers: Record<string, string> = {}) => new NextRequest(
  `http://localhost:3000/api/nuni/assistant/${action}`, {
    method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, currentSession)}`,
      'X-Campus-Session': sessionContext(currentSession), Origin: 'http://localhost:3000',
      'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input),
  },
);
const send = (input: object, headers?: Record<string, string>) => handleNuni(request('followup', input, headers), ['assistant', 'followup']);
async function prepared() {
  const result = await prepareCourseworkStudyRequest({ target, binding: binding(), adapter: f.adapter, secret, now,
    writes: true, signal: new AbortController().signal });
  const card = result.cards[0];
  await confirm(binding(), { token: card.token, args: card.args }, secret, now, f.adapter, true, () => now);
  vi.spyOn(f.adapter, 'write');
  vi.spyOn(f.adapter, 'work');
  vi.spyOn(f.adapter, 'ledger');
  return { schoolId: binding().schoolId, conversationId: binding().conversationId,
    issuedContext: sessionContext(issuedSession), token: card.token, args: card.args };
}
async function plan() {
  const bootstrap = await handleNuni(request('plan', { schoolId: 'fixture-school', conversationId: 'new-home', task: target }), ['assistant', 'plan']);
  const route = await bootstrap.json();
  return handleNuni(request('plan', { schoolId: 'fixture-school', conversationId: route.conversationId, routeToken: route.routeToken, task: target }), ['assistant', 'plan']);
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  for (const [name, value] of Object.entries({ CAMPUS_BACKEND: 'nuni', CAMPUS_ASSISTANT_ENABLED: 'true',
    CAMPUS_ASSISTANT_V2_ENABLED: 'true', CAMPUS_ASSISTANT_V2_WRITES_ENABLED: 'true', BFF_SESSION_SECRET: secret,
    WEB_PUBLIC_ORIGIN: 'http://localhost:3000', GROQ_API_KEY: '', CAMPUS_ASSISTANT_V2_FALLBACK_ACCOUNT_ID: '',
    CAMPUS_ASSISTANT_V2_FALLBACK_API_TOKEN: '', FLY_MACHINE_ID: '' })) vi.stubEnv(name, value);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  modelCall.mockReset().mockRejectedValue(new Error('Followup must not call a model'));
  account = 'pa_00000000-0000-4000-8000-' + String(++counter).padStart(12, '0');
  f = fixtureAdapter();
  vi.mocked(createAdapter).mockReturnValue({ adapter: f.adapter,
    principal: async () => ({ platformAccountId: account, isPlatformOperator: false }), apiCalls: () => 0 });
});
afterEach(() => {
  expect(modelCall).not.toHaveBeenCalled();
  if (vi.isMockFunction(f.adapter.write)) expect(f.adapter.write).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('reads an expired signed task after the same account signs in again, with writes and model disabled', async () => {
  const input = await prepared();
  vi.mocked(Date.now).mockReturnValue(now + 360000);
  vi.stubEnv('CAMPUS_ASSISTANT_V2_WRITES_ENABLED', 'false');
  const response = await send(input);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ version: 1, operation: 'coursework.followup',
    status: 'in_progress', task: target, calendar: 'matching', event: input.args });
  // Reusing the old proof in the current session still cannot authorize a write.
  const action = { schoolId: input.schoolId, conversationId: input.conversationId, token: input.token, args: input.args };
  expect((await handleNuni(request('confirm', action), ['assistant', 'confirm'])).status).toBe(409);
});

it('can read on a different Fly machine without replaying to the old issuer', async () => {
  vi.stubEnv('FLY_MACHINE_ID', 'old-machine');
  const input = await prepared();
  vi.stubEnv('FLY_MACHINE_ID', 'new-machine');
  vi.mocked(Date.now).mockReturnValue(now + 360000);
  const response = await send(input);
  expect(response.status).toBe(200);
  expect(response.headers.get('fly-replay')).toBeNull();
  expect(await response.json()).toMatchObject({ calendar: 'matching', status: 'in_progress' });
});

it.each(['account', 'school', 'conversation', 'issued context', 'arguments', 'token'] as const)(
  'rejects a changed %s before reading private task or calendar data', async mode => {
    const input = await prepared();
    if (mode === 'account') account = 'another-platform-account';
    if (mode === 'school') input.schoolId = 'another-school';
    if (mode === 'conversation') input.conversationId = 'another-conversation';
    if (mode === 'issued context') input.issuedContext = 'x'.repeat(43);
    if (mode === 'arguments') input.args = { ...input.args, title: 'new unsignable title' };
    if (mode === 'token') {
      const [body, signature] = input.token.split('.');
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
      payload.studyGuard.taskId = 'another-task';
      input.token = Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + signature;
    }
    const response = await send(input);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'CONFIRMATION_INVALID' });
    expect(f.adapter.work).not.toHaveBeenCalled();
    expect(f.adapter.ledger).not.toHaveBeenCalled();
  },
);

it.each([{ task: target }, { accountId: 'other-account' }, { routeToken: 'route' },
  { issuedContext: 'short' }, { issuedContext: undefined }])('rejects unknown fields and malformed proof %j', async change => {
  const input = await prepared();
  expect((await send({ ...input, ...change })).status).toBe(422);
  expect(f.adapter.work).not.toHaveBeenCalled();
});

it('requires the current session context and same origin, not the old proof context header', async () => {
  const input = await prepared();
  expect((await send(input, { Origin: 'https://different.example' })).status).toBe(403);
  expect((await send(input, { 'X-Campus-Session': input.issuedContext })).status).toBe(409);
});

it('rejects signed non-calendar operations and classifies generic calendar proofs without source reads', async () => {
  const input = await prepared();
  const other = signCard(binding(), 'propose_open_page', { page: 'timetable' }, 0, secret, now);
  expect((await send({ ...input, token: other.token, args: other.args })).status).toBe(422);
  const generic = signCard(binding(), 'propose_personal_event', input.args, 1, secret, now);
  const response = await send({ ...input, token: generic.token, args: generic.args });
  expect(await response.json()).toMatchObject({ status: 'not_coursework', task: null, source: null, calendar: 'unavailable' });
  expect(f.adapter.work).not.toHaveBeenCalled();
  expect(f.adapter.ledger).not.toHaveBeenCalled();
});

it('limits followup reads independently and leaves the full planning allowance available', async () => {
  const input = await prepared();
  for (let index = 0; index < 60; index++) expect((await send(input)).status).toBe(200);
  const limited = await send(input);
  expect(limited.status).toBe(429);
  expect(await limited.json()).toMatchObject({ error: 'FOLLOWUP_READ_LIMIT' });
  expect(limited.headers.get('Retry-After')).toBe('60');
  for (let index = 0; index < 3; index++) expect((await plan()).status).toBe(200);
});

it('continues read-only followup after the planning allowance has been exhausted', async () => {
  const input = await prepared();
  for (let index = 0; index < 3; index++) expect((await plan()).status).toBe(200);
  expect((await plan()).status).toBe(429);
  expect((await send(input)).status).toBe(200);
});

it('bounds concurrent followup work and releases the read gate after completion', async () => {
  const input = await prepared();
  const tasks = await f.adapter.work(target.workspaceId);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  f.adapter.work = vi.fn(async () => { await held; return tasks; });
  const pending = [send(input), send(input), send(input)];
  await vi.waitFor(() => expect(f.adapter.work).toHaveBeenCalledTimes(3));
  const blocked = await send(input);
  expect(blocked.status).toBe(429);
  expect(await blocked.json()).toMatchObject({ error: 'FOLLOWUP_BUSY' });
  release();
  expect((await Promise.all(pending)).map(response => response.status)).toEqual([200, 200, 200]);
  expect((await send(input)).status).toBe(200);
});
