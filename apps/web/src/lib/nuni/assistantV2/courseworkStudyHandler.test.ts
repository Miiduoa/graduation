// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from '../api';
import { sealCookie, SESSION_COOKIE, sessionContext } from '../server';
import { createAdapter } from './adapter';
import { issueRoute } from './actions';
import { fixtureAdapter, FIXTURE_NOW, FIXTURE_SECRET } from './fixtures';

const providerCall = vi.hoisted(() => vi.fn());
vi.mock('./adapter', async (original) => ({
  ...(await original<typeof import('./adapter')>()),
  createAdapter: vi.fn(),
}));
vi.mock('./groq', async (original) => ({
  ...(await original<typeof import('./groq')>()),
  createProviderModel: () => providerCall,
}));
const session = { sessionHandle: 'ps_' + 'k'.repeat(43), expiresAt: FIXTURE_NOW + 3600000 };
const account = 'pa_00000000-0000-4000-8000-000000000091';
const target = { workspaceId: 'course-a', taskId: 'task-urgent', kind: 'assignment' };
function request(action: string, input: object, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000/api/nuni/assistant/${action}`, {
    method: 'POST',
    headers: {
      cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      'X-Campus-Session': sessionContext(session),
      Origin: 'http://localhost:3000',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(input),
  });
}
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(FIXTURE_NOW);
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  vi.stubEnv('CAMPUS_ASSISTANT_ENABLED', 'true');
  vi.stubEnv('CAMPUS_ASSISTANT_V2_ENABLED', 'true');
  vi.stubEnv('CAMPUS_ASSISTANT_V2_WRITES_ENABLED', 'true');
  vi.stubEnv('BFF_SESSION_SECRET', FIXTURE_SECRET);
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('GROQ_API_KEY', '');
  providerCall.mockReset().mockRejectedValue(new Error('Provider must not be called'));
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('bootstraps and completes the selected-source preview with no model consent or provider, then confirms normally', async () => {
  const f = fixtureAdapter();
  vi.mocked(createAdapter).mockReturnValue({
    adapter: f.adapter,
    principal: async () => ({ platformAccountId: account, isPlatformOperator: false }),
    apiCalls: () => 0,
  });
  const input = {
    schoolId: 'fixture-school',
    conversationId: 'first-study',
    question: '安排這份作業 30 分鐘',
    history: [],
    consent: false,
    studyTarget: target,
  };
  const bootstrap = await handleNuni(request('ask', input), ['assistant', 'ask']);
  expect(bootstrap.status).toBe(200);
  const route = await bootstrap.json();
  expect(route.bootstrap).toBe(true);
  const response = await handleNuni(
    request('ask', {
      ...input,
      conversationId: route.conversationId,
      routeToken: route.routeToken,
    }),
    ['assistant', 'ask'],
  );
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ dataRead: true, modelCalls: 0, stopReason: '' });
  expect(result.cards).toHaveLength(1);
  expect(f.writes).toHaveLength(0);
  const card = result.cards[0];
  const saved = await handleNuni(
    request('confirm', {
      schoolId: input.schoolId,
      conversationId: route.conversationId,
      token: card.token,
      args: card.args,
    }),
    ['assistant', 'confirm'],
  );
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ status: 'verified', storage: 'synced' });
  expect(f.writes).toHaveLength(1);
  expect(providerCall).not.toHaveBeenCalled();
});

it('requires normal model consent when no selected source exists and rejects malformed or cross-scope hints', async () => {
  const f = fixtureAdapter();
  const principal = async () => ({ platformAccountId: account, isPlatformOperator: false });
  vi.mocked(createAdapter).mockReturnValue({ adapter: f.adapter, principal, apiCalls: () => 0 });
  const binding = {
    account,
    session: sessionContext(session),
    schoolId: 'fixture-school',
    conversationId: 'study-validation',
  };
  const input = {
    schoolId: binding.schoolId,
    conversationId: binding.conversationId,
    question: '寫一份讀書計畫',
    history: [],
    consent: false,
    routeToken: issueRoute(binding, FIXTURE_SECRET),
  };
  expect((await handleNuni(request('ask', input), ['assistant', 'ask'])).status).toBe(422);
  for (const bad of [
    { ...target, kind: 'admin' },
    { ...target, accountId: 'another-account' },
    { ...target, date: '2026-02-30' },
    { ...target, workspaceId: '../course' },
  ]) {
    expect(
      (await handleNuni(request('ask', { ...input, studyTarget: bad }), ['assistant', 'ask']))
        .status,
    ).toBe(422);
  }
  for (const [headers, status] of [
    [{ cookie: '' }, 401],
    [{ Origin: 'https://example.invalid' }, 403],
    [{ 'X-Campus-Session': 'another-session' }, 409],
  ] as [Record<string, string>, number][]) {
    expect(
      (
        await handleNuni(request('ask', { ...input, studyTarget: target }, headers), [
          'assistant',
          'ask',
        ])
      ).status,
    ).toBe(status);
  }
  expect(f.writes).toHaveLength(0);
  expect(providerCall).not.toHaveBeenCalled();
});
