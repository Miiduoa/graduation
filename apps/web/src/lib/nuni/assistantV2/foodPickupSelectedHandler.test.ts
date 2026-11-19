// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from '../api';
import { sealCookie, SESSION_COOKIE, sessionContext } from '../server';
import { createAdapter } from './adapter';
import { issueRoute } from './actions';
import { fixtureAdapter, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';

const providerCall = vi.hoisted(() => vi.fn());
vi.mock('./adapter', async original => ({ ...(await original<typeof import('./adapter')>()), createAdapter: vi.fn() }));
vi.mock('./groq', async original => ({ ...(await original<typeof import('./groq')>()), createProviderModel: () => providerCall }));
const session = { sessionHandle: 'ps_' + 'x'.repeat(43), expiresAt: now + 3600000 };
const schoolId = 'fixture-school';
const target = { tenantId: 'selected-realm', orderId: 'selected-order' };
let sequence = 0;
function request(action: string, input: object, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000/api/nuni/assistant/${action}`, {
    method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      'X-Campus-Session': sessionContext(session), Origin: 'http://localhost:3000',
      'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input),
  });
}
const send = (action: string, input: object, headers?: Record<string, string>) =>
  handleNuni(request(action, input, headers), ['assistant', action]);
function fixture() {
  const f = fixtureAdapter();
  const state = { account: 'pa_30000000-0000-4000-8000-' + String(++sequence).padStart(12, '0') };
  f.adapter.realms = vi.fn(async () => ['another-realm', target.tenantId].map(tenantId => ({ tenantId, schoolId })));
  f.adapter.orders = vi.fn(async () => { throw new Error('No latest-order query'); });
  const detail = { id: target.orderId, state: 'ready', locationId: 'selected-location',
    location: '選定餐廳', requestedPickupAt: '2026-11-04T12:00:00+08:00' };
  f.adapter.order = vi.fn(async () => ({ ...detail }));
  f.adapter.simulation = false;
  vi.mocked(createAdapter).mockReset().mockReturnValue({ adapter: f.adapter,
    principal: async () => ({ platformAccountId: state.account, isPlatformOperator: false }), apiCalls: () => 0 });
  const binding = { account: state.account, session: sessionContext(session), schoolId, conversationId: 'selected-handler-' + sequence };
  const input = { schoolId, conversationId: binding.conversationId, routeToken: issueRoute(binding, secret), target };
  return { ...f, input, binding, state, detail };
}
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  for (const key of ['CAMPUS_ASSISTANT_ENABLED', 'CAMPUS_ASSISTANT_V2_ENABLED', 'CAMPUS_ASSISTANT_V2_WRITES_ENABLED']) vi.stubEnv(key, 'true');
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  vi.stubEnv('BFF_SESSION_SECRET', secret);
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('GROQ_API_KEY', '');
  providerCall.mockReset().mockRejectedValue(new Error('Provider must not be called'));
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('bootstraps and executes a chosen order across workspaces without a model or chat consent', async () => {
  const f = fixture();
  const initial = { schoolId, conversationId: 'initial-selected-pickup', target };
  const bootstrap = await send('pickup-plan', initial);
  expect(bootstrap.status).toBe(200);
  const route = await bootstrap.json();
  expect(route).toMatchObject({ bootstrap: true, conversationId: expect.any(String), routeToken: expect.any(String) });
  expect(f.adapter.order).not.toHaveBeenCalled();
  const response = await send('pickup-plan', { ...initial, conversationId: route.conversationId, routeToken: route.routeToken });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ version: 2, dataRead: true, modelCalls: 0, simulation: false,
    pickupTarget: { ...target, durationMinutes: 15 }, stopReason: '', expiresAt: now + 300000 });
  expect(result.cards).toHaveLength(1);
  expect(f.adapter.order).toHaveBeenCalledExactlyOnceWith(target.tenantId, target.orderId);
  expect(f.adapter.orders).not.toHaveBeenCalled();
  expect(f.writes).toHaveLength(0);
  const card = result.cards[0], proof = { schoolId, conversationId: route.conversationId,
    token: card.token, args: card.args };
  const confirmed = await send('confirm', proof);
  expect(confirmed.status).toBe(200);
  expect(await confirmed.json()).toMatchObject({ status: 'verified', replay: false, storage: 'synced' });
  const replay = await send('confirm', proof);
  expect(await replay.json()).toMatchObject({ status: 'verified', replay: true });
  expect(f.writes).toHaveLength(1);
  expect(f.orderCalls).toHaveLength(0);
  expect(providerCall).not.toHaveBeenCalled();
});

it('rejects forged target fields and mixed task/chat inputs before reading private sources', async () => {
  const f = fixture();
  for (const input of [
    { ...f.input, target: { ...target, title: 'forged title' } },
    { ...f.input, target: { ...target, requestedPickupAt: '2026-11-04T12:00Z' } },
    { ...f.input, target: { ...target, role: 'operator' } },
    { ...f.input, target: { ...target, durationMinutes: '15' } },
    { ...f.input, target: { ...target, tenantId: '../../another' } },
    { ...f.input, question: '額外要求' }, { ...f.input, consent: true },
    { ...f.input, task: {} }, { ...f.input, planProtection: {} },
    { ...f.input, target: undefined },
  ]) expect((await send('pickup-plan', input)).status).toBe(422);
  expect(createAdapter).not.toHaveBeenCalled();
  expect(f.adapter.order).not.toHaveBeenCalled();
  expect(f.writes).toHaveLength(0);
  expect(providerCall).not.toHaveBeenCalled();
});

it('keeps origin, session, account and school bindings mandatory for structured selection', async () => {
  const f = fixture();
  for (const [headers, status] of [[{ cookie: '' }, 401], [{ Origin: 'https://example.invalid' }, 403],
    [{ 'X-Campus-Session': 'other-session' }, 409]] as [Record<string, string>, number][])
    expect((await send('pickup-plan', f.input, headers)).status).toBe(status);
  expect((await send('pickup-plan', { ...f.input, schoolId: 'other-school' })).status).toBe(409);
  f.state.account = 'pa_40000000-0000-4000-8000-000000000099';
  expect((await send('pickup-plan', f.input)).status).toBe(409);
  expect(f.adapter.order).not.toHaveBeenCalled();
  expect(f.writes).toHaveLength(0);
  expect(providerCall).not.toHaveBeenCalled();
});

it('shares bounded planning allowance while leaving ordinary model consent mandatory', async () => {
  const f = fixture();
  for (let attempt = 0; attempt < 3; attempt++) expect((await send('pickup-plan', f.input)).status).toBe(200);
  const limited = await send('pickup-plan', f.input);
  expect(limited.status).toBe(429);
  expect(await limited.json()).toMatchObject({ error: 'LOCAL_ACCOUNT_LIMIT' });
  expect((await send('ask', { schoolId, conversationId: f.binding.conversationId,
    routeToken: f.input.routeToken, question: '請幫我寫介紹', history: [], consent: false })).status).toBe(422);
  expect(f.writes).toHaveLength(0);
  expect(providerCall).not.toHaveBeenCalled();
});
