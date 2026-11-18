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
const session = { sessionHandle: 'ps_' + 'p'.repeat(43), expiresAt: now + 3600000 };
const account = 'pa_00000000-0000-4000-8000-000000000095';
const question = '把最近一筆訂單的取餐時間加入行事曆，預留15分鐘';
function request(action: string, input: object, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000/api/nuni/assistant/${action}`, {
    method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      'X-Campus-Session': sessionContext(session), Origin: 'http://localhost:3000',
      'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input),
  });
}
function fixture() {
  const f = fixtureAdapter();
  const detail = { id: 'order-a', state: 'preparing', locationId: 'dining-a',
    location: '合成蔬食餐廳', requestedPickupAt: '2026-11-04T12:00:00+08:00' };
  f.adapter.order = async () => ({ ...detail });
  vi.mocked(createAdapter).mockReturnValue({ adapter: f.adapter,
    principal: async () => ({ platformAccountId: account, isPlatformOperator: false }), apiCalls: () => 0 });
  return { ...f, detail };
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

it('bootstraps without model consent, previews with no write and confirms the same signed pickup source', async () => {
  const f = fixture();
  const input = { schoolId: 'fixture-school', conversationId: 'initial-pickup', question, history: [], consent: false };
  const bootstrap = await handleNuni(request('ask', input), ['assistant', 'ask']);
  expect(bootstrap.status).toBe(200);
  const route = await bootstrap.json();
  const response = await handleNuni(request('ask', { ...input, conversationId: route.conversationId, routeToken: route.routeToken }), ['assistant', 'ask']);
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ dataRead: true, modelCalls: 0, stopReason: '' });
  expect(result.cards).toHaveLength(1);
  expect(f.writes).toHaveLength(0);
  const card = result.cards[0], proof = { schoolId: input.schoolId,
    conversationId: route.conversationId, token: card.token, args: card.args };
  f.detail.state = 'canceled';
  const stale = await handleNuni(request('confirm', proof), ['assistant', 'confirm']);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: 'FOOD_PICKUP_CHANGED', message: expect.stringContaining('原訂單') });
  expect(f.writes).toHaveLength(0);
  f.detail.state = 'ready';
  const saved = await handleNuni(request('confirm', proof), ['assistant', 'confirm']);
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ status: 'verified', storage: 'synced' });
  expect(f.writes).toHaveLength(1);
  expect(providerCall).not.toHaveBeenCalled();
});

it('does not turn pickup recognition into an exemption from session, origin, scope or general consent checks', async () => {
  const f = fixture(), binding = { account, session: sessionContext(session), schoolId: 'fixture-school', conversationId: 'pickup-security' };
  const input = { schoolId: binding.schoolId, conversationId: binding.conversationId,
    routeToken: issueRoute(binding, secret), question, history: [], consent: false };
  for (const [headers, status] of [[{ cookie: '' }, 401], [{ Origin: 'https://example.invalid' }, 403],
    [{ 'X-Campus-Session': 'wrong-session' }, 409]] as [Record<string, string>, number][]) {
    expect((await handleNuni(request('ask', input, headers), ['assistant', 'ask'])).status).toBe(status);
  }
  expect((await handleNuni(request('ask', { ...input, schoolId: 'other-school' }), ['assistant', 'ask'])).status).toBe(409);
  expect((await handleNuni(request('ask', { ...input, question: '幫我規劃明天讀書' }), ['assistant', 'ask'])).status).toBe(422);
  expect(f.writes).toHaveLength(0);
  expect(providerCall).not.toHaveBeenCalled();
});
