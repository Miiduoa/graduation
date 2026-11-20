// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handleNuni } from '../api';
import { SESSION_COOKIE, sealCookie, sessionContext } from '../server';
import { issueRoute } from './actions';
import { createAdapter } from './adapter';
import { fixtureAdapter, FIXTURE_SECRET } from './fixtures';

const model = vi.hoisted(() => vi.fn());
vi.mock('./adapter', async original => {
  const value = await original<typeof import('./adapter')>();
  return { ...value, createAdapter: vi.fn(value.createAdapter) };
});
vi.mock('./groq', async original => {
  const value = await original<typeof import('./groq')>();
  return { ...value, createProviderModel: () => model };
});

beforeEach(() => {
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  vi.stubEnv('CAMPUS_ASSISTANT_ENABLED', 'true');
  vi.stubEnv('CAMPUS_ASSISTANT_V2_ENABLED', 'true');
  vi.stubEnv('CAMPUS_ASSISTANT_V2_WRITES_ENABLED', 'true');
  vi.stubEnv('BFF_SESSION_SECRET', FIXTURE_SECRET);
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'http://localhost:3000');
  vi.spyOn(console, 'info').mockImplementation(() => {});
  model.mockReset().mockResolvedValue({ message: { role: 'assistant', content: '不應呼叫這個模型。' },
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function setup(taskProfile: string, separator: string) {
  const { adapter } = fixtureAdapter();
  const session = { sessionHandle: 'ps_' + randomUUID().replaceAll('-', '').padEnd(43, 'x'), expiresAt: Date.now() + 3600000 };
  const binding = { account: 'pa_' + randomUUID(), session: sessionContext(session),
    conversationId: randomUUID(), schoolId: 'fixture-school' };
  vi.mocked(createAdapter).mockReturnValue({ adapter, apiCalls: () => 0,
    principal: async () => ({ platformAccountId: binding.account, isPlatformOperator: false }) });
  const reads = [vi.spyOn(adapter, 'ledger'), vi.spyOn(adapter, 'courses'), vi.spyOn(adapter, 'orders'),
    vi.spyOn(adapter, 'order'), vi.spyOn(adapter, 'work'), vi.spyOn(adapter, 'write')];
  const request = new NextRequest('http://localhost:3000/api/nuni/assistant/ask', {
    method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json',
      'X-Campus-Session': sessionContext(session), cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}` },
    body: JSON.stringify({ taskProfile, consent: false, history: [], schoolId: binding.schoolId,
      conversationId: binding.conversationId, routeToken: issueRoute(binding, FIXTURE_SECRET),
      question: '把最近一筆訂單的取餐時間加入行事曆，預留15分鐘' + separator + '請說一個笑話' }),
  });
  return { request, reads };
}

it.each(['teacher', 'merchant', 'club', 'school', 'platform'].flatMap(profile =>
  ['\n', '\t', '\u2028'].map(separator => [profile, separator] as const),
))('an unsupported pickup request cannot send %s data to a model without consent (%j)', async (profile, separator) => {
  const { request, reads } = setup(profile, separator);
  const response = await handleNuni(request, ['assistant', 'ask']);
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: 'CONSENT_REQUIRED' });
  expect(model).not.toHaveBeenCalled();
  reads.forEach(read => expect(read).not.toHaveBeenCalled());
});

it('keeps unsupported student pickup guidance on its existing zero-model path', async () => {
  const { request, reads } = setup('student', '\n');
  const response = await handleNuni(request, ['assistant', 'ask']);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ cards: [], modelCalls: 0, stopReason: 'INVALID_FOOD_PICKUP_REQUEST' });
  expect(model).not.toHaveBeenCalled();
  reads.forEach(read => expect(read).not.toHaveBeenCalled());
});
