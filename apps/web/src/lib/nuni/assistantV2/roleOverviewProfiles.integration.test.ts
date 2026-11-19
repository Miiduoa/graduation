// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handleNuni } from '../api';
import { SESSION_COOKIE, sealCookie, sessionContext } from '../server';
import { issueRoute } from './actions';
import { createAdapter } from './adapter';
import { fixtureAdapter, FIXTURE_SECRET } from './fixtures';
import { readTeachingOverview } from './teacherWorkspaceAdapter';
import { readMerchantOverview } from './merchantWorkspaceAdapter';

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
  model.mockReset().mockRejectedValue(new Error('Explicit reads must not call the model'));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function setup(taskProfile: 'teacher' | 'merchant', consent: boolean) {
  const { adapter } = fixtureAdapter();
  const session = { sessionHandle: 'ps_' + randomUUID().replaceAll('-', '').padEnd(43, 'x'), expiresAt: Date.now() + 3600000 };
  const binding = { account: 'pa_' + randomUUID(), session: sessionContext(session), conversationId: randomUUID(), schoolId: 'pu' };
  const guard = () => {};
  adapter.teachingOverview = vi.fn(args => readTeachingOverview({ args, schoolId: binding.schoolId,
    accountId: binding.account, now: Date.now(), guard: { beforeRead: guard, afterRead: guard },
    remainingApiCalls: () => 20, request: async () => ({ workspaces: [] }) }));
  adapter.merchantOverview = vi.fn(args => readMerchantOverview({ args, schoolId: binding.schoolId,
    now: Date.now(), guard, scopedRealm: raw => ({ tenantId: String(raw.tenantId), schoolId: String(raw.schoolId) }),
    request: async () => ({ workspaces: [] }) }));
  const privateReads = [vi.spyOn(adapter, 'courses'), vi.spyOn(adapter, 'work'), vi.spyOn(adapter, 'orders'),
    vi.spyOn(adapter, 'order'), vi.spyOn(adapter, 'write')];
  vi.mocked(createAdapter).mockReturnValue({ adapter, apiCalls: () => 0,
    principal: async () => ({ platformAccountId: binding.account, isPlatformOperator: false }) });
  const question = taskProfile === 'teacher' ? '查我的授課概況' : '查我的門市營運概況，查學校電話';
  const request = new NextRequest('http://localhost:3000/api/nuni/assistant/ask', {
    method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json',
      'X-Campus-Session': sessionContext(session), cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}` },
    body: JSON.stringify({ taskProfile, question, consent, history: [], schoolId: binding.schoolId,
      conversationId: binding.conversationId, routeToken: issueRoute(binding, FIXTURE_SECRET) }),
  });
  return { adapter, privateReads, request };
}

it.each(['teacher', 'merchant'] as const)('%s overview reaches its dedicated source through the BFF', async profile => {
  const { adapter, privateReads, request } = setup(profile, true);
  const response = await handleNuni(request, ['assistant', 'ask']);
  expect(response.status).toBe(200);
  const reply = await response.json();
  expect(reply).not.toHaveProperty('roleGuide');
  const tool = profile === 'teacher' ? 'get_teaching_overview' : 'get_merchant_overview';
  expect(reply.steps).toContainEqual(expect.objectContaining({ name: tool, status: 'ok' }));
  if (profile === 'merchant') expect(reply.steps).toContainEqual(expect.objectContaining({ name: 'get_school_info', status: 'ok' }));
  expect(profile === 'teacher' ? adapter.teachingOverview : adapter.merchantOverview).toHaveBeenCalledOnce();
  expect(profile === 'teacher' ? adapter.merchantOverview : adapter.teachingOverview).not.toHaveBeenCalled();
  privateReads.forEach(read => expect(read).not.toHaveBeenCalled());
  expect(model).not.toHaveBeenCalled();
});

it.each(['teacher', 'merchant'] as const)('%s context retains the existing consent boundary before reading', async profile => {
  const { adapter, privateReads, request } = setup(profile, false);
  const response = await handleNuni(request, ['assistant', 'ask']);
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: 'CONSENT_REQUIRED' });
  expect(adapter.teachingOverview).not.toHaveBeenCalled();
  expect(adapter.merchantOverview).not.toHaveBeenCalled();
  privateReads.forEach(read => expect(read).not.toHaveBeenCalled());
  expect(model).not.toHaveBeenCalled();
});
