// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getAssistantServiceCapability } from '@campus/shared/src/assistantTaskPlan';
import { handleNuni } from '../api';
import { sealCookie, SESSION_COOKIE, sessionContext } from '../server';
import { createAdapter } from './adapter';
import type { Card, ModelInput, ModelResult } from './contracts';
import { fixtureAdapter, FIXTURE_NOW, FIXTURE_SECRET } from './fixtures';

const providerCall = vi.hoisted(() => vi.fn());
vi.mock('./adapter', async original => ({
  ...(await original<typeof import('./adapter')>()),
  createAdapter: vi.fn(),
}));
vi.mock('./groq', async original => ({
  ...(await original<typeof import('./groq')>()),
  createProviderModel: () => providerCall,
}));

const account = 'pa_00000000-0000-4000-8000-000000000093';
const session = { sessionHandle: 'ps_' + 'j'.repeat(43), expiresAt: FIXTURE_NOW + 3600000 };
const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };
let testClock = FIXTURE_NOW;
function request(action: string, input: object, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000/api/nuni/assistant/${action}`, {
    method: 'POST', headers: {
      cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      'X-Campus-Session': sessionContext(session), Origin: 'http://localhost:3000',
      'Content-Type': 'application/json', ...headers,
    }, body: JSON.stringify(input),
  });
}
const tool = (name: string, args: object): ModelResult => ({ message: {
  role: 'assistant', tool_calls: [{ id: 'career-' + name, type: 'function',
    function: { name, arguments: JSON.stringify(args) } }],
}, usage });
const answer = (content: string): ModelResult => ({ message: { role: 'assistant', content }, usage });
function installAdapter() {
  const f = fixtureAdapter();
  // A synthetic transport fixture, with the real production runner path enabled.
  f.adapter.simulation = false;
  const principal = vi.fn(async () => ({ platformAccountId: account, isPlatformOperator: false }));
  const ledger = vi.spyOn(f.adapter, 'ledger'), courses = vi.spyOn(f.adapter, 'courses');
  const work = vi.spyOn(f.adapter, 'work'), orders = vi.spyOn(f.adapter, 'orders');
  const permissions = vi.spyOn(f.adapter, 'permissions');
  const write = vi.spyOn(f.adapter, 'write'), submit = vi.spyOn(f.adapter.food!, 'submit');
  vi.mocked(createAdapter).mockReturnValue({ adapter: f.adapter, principal, apiCalls: () => 0 });
  return { ...f, principal, ledger, courses, work, orders, permissions, write, submit };
}
function noBusinessAccess(f: ReturnType<typeof installAdapter>) {
  expect(f.writes).toEqual([]);
  expect(f.orderCalls).toEqual([]);
  for (const operation of [f.ledger, f.courses, f.work, f.orders, f.permissions, f.write, f.submit])
    expect(operation).not.toHaveBeenCalled();
}
async function ask(question: string, schoolId = 'pu') {
  const input = { schoolId, conversationId: 'career-entry', question, consent: true, history: [] };
  const bootstrap = await handleNuni(request('ask', input), ['assistant', 'ask']);
  expect(bootstrap.status).toBe(200);
  const route = await bootstrap.json();
  expect(route.bootstrap).toBe(true);
  const response = await handleNuni(request('ask', { ...input,
    conversationId: route.conversationId, routeToken: route.routeToken }), ['assistant', 'ask']);
  expect(response.status).toBe(200);
  return { result: await response.json(), conversationId: route.conversationId as string, schoolId };
}
function openingModel() {
  providerCall.mockResolvedValueOnce(tool('list_campus_services', { serviceId: 'career' }))
    .mockResolvedValueOnce(tool('propose_open_page', { page: 'career' }))
    .mockResolvedValueOnce(answer('職涯入口已準備，請核對並按確認卡；確認前尚未開啟。'));
}
function confirmation(prepared: Awaited<ReturnType<typeof ask>>) {
  const card = prepared.result.cards[0] as Card;
  return { schoolId: prepared.schoolId, conversationId: prepared.conversationId, token: card.token, args: card.args };
}
beforeEach(() => {
  // The handler's process-wide minute budget is real; isolate each test's clock.
  testClock += 60001;
  vi.spyOn(Date, 'now').mockReturnValue(testClock);
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  vi.stubEnv('CAMPUS_ASSISTANT_ENABLED', 'true');
  vi.stubEnv('CAMPUS_ASSISTANT_V2_ENABLED', 'true');
  vi.stubEnv('CAMPUS_ASSISTANT_V2_WRITES_ENABLED', 'false');
  vi.stubEnv('BFF_SESSION_SECRET', FIXTURE_SECRET);
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('GROQ_API_KEY', 'synthetic-provider-token-never-sent');
  providerCall.mockReset().mockRejectedValue(new Error('Unexpected provider request'));
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('loads the career directory through the real handler and keeps ordinary service requests working', async () => {
  const f = installAdapter();
  providerCall.mockResolvedValueOnce(tool('list_campus_services', { serviceId: 'career' }))
    .mockResolvedValueOnce(answer('職涯可提供服務入口，詳細處理方式請到原頁確認。'));
  const directory = await ask('有哪些職涯服務可以使用？');
  expect(directory.result).toMatchObject({ version: 2, simulation: false, cards: [],
    steps: [{ name: 'list_campus_services', status: 'ok' }] });
  expect(getAssistantServiceCapability('career')).toMatchObject({ serviceId: 'career', modes: ['handoff'],
    tools: ['list_campus_services', 'propose_open_page'] });
  const evidenceMessage = (providerCall.mock.calls[1][0] as ModelInput).messages
    .find(message => message.content?.startsWith('<results trust="untrusted">'))?.content;
  expect(evidenceMessage).toBeTruthy();
  const modelEvidence = JSON.parse(evidenceMessage!.split('</results>')[0].replace('<results trust="untrusted">', ''));
  expect(modelEvidence[0].tool).toBe('list_campus_services');
  const modelToolResult = modelEvidence[0].result;
  expect(modelToolResult.excerpt ?? JSON.stringify(modelToolResult)).toContain('"modes":["handoff"]');

  const ordinary = await ask('查學校電話');
  expect(ordinary.result.answer).toContain('靜宜大學');
  expect(ordinary.result.steps).toContainEqual(expect.objectContaining({ name: 'get_school_info', status: 'ok' }));
  expect(ordinary.result.cards).toEqual([]);
  expect(providerCall).toHaveBeenCalledTimes(2);
  noBusinessAccess(f);
});

it.each(['pu', 'nthu'])('prepares only a signed career handoff and confirms its fixed %s destination without business writes', async schoolId => {
  const f = installAdapter();
  openingModel();
  const prepared = await ask('開啟職涯', schoolId);
  expect(prepared.result.cards).toHaveLength(1);
  expect(prepared.result.cards[0]).toMatchObject({ tool: 'propose_open_page', schoolId,
    destination: '/career?schoolId=' + schoolId, args: { page: 'career' } });
  expect(prepared.result.steps.map((step: { name: string }) => step.name))
    .toEqual(['list_campus_services', 'propose_open_page']);
  expect(prepared.result.answer).toContain('確認');
  const offeredTools = (providerCall.mock.calls[0][0] as ModelInput).tools;
  expect(JSON.stringify(offeredTools)).toContain('career');
  noBusinessAccess(f);

  const saved = await handleNuni(request('confirm', confirmation(prepared)), ['assistant', 'confirm']);
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ href: '/career?schoolId=' + schoolId });
  expect(providerCall).toHaveBeenCalledTimes(3);
  noBusinessAccess(f);
});

it('rejects another account, school, session, conversation and altered signed destination at the actual confirmation endpoint', async () => {
  const f = installAdapter();
  openingModel();
  const prepared = await ask('開啟職涯');
  const payload = confirmation(prepared);
  const invoke = (value: object = payload, headers: Record<string, string> = {}) =>
    handleNuni(request('confirm', value, headers), ['assistant', 'confirm']);

  f.principal.mockResolvedValueOnce({ platformAccountId: 'pa_00000000-0000-4000-8000-000000000094', isPlatformOperator: false });
  expect((await invoke()).status).toBe(409);
  expect((await invoke({ ...payload, schoolId: 'nthu' })).status).toBe(409);
  expect((await invoke({ ...payload, conversationId: 'another-career-conversation' })).status).toBe(409);
  const nextSession = { ...session, sessionHandle: 'ps_' + 'l'.repeat(43) };
  expect((await invoke(payload, { cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, nextSession)}`,
    'X-Campus-Session': sessionContext(nextSession) })).status).toBe(409);
  expect((await invoke({ ...payload, args: { page: 'admin' } })).status).toBe(409);
  expect((await invoke({ ...payload, token: payload.token + 'x' })).status).toBe(409);
  expect((await invoke({ ...payload, args: { ...payload.args, href: 'https://example.invalid/career' } })).status).toBe(422);
  expect((await invoke(payload, { 'X-Campus-Session': 'stale-context' })).status).toBe(409);
  expect((await invoke(payload, { cookie: '' })).status).toBe(401);
  noBusinessAccess(f);
  expect(providerCall).toHaveBeenCalledTimes(3);
  // Rejected attempts do not change the original, still-valid handoff.
  const original = await invoke();
  expect(original.status).toBe(200);
  expect(await original.json()).toEqual({ href: '/career?schoolId=pu' });
});

it('rechecks principal revocation before opening a previously prepared career card', async () => {
  const f = installAdapter();
  openingModel();
  const prepared = await ask('開啟職涯');
  f.principal.mockRejectedValueOnce(Object.assign(new Error('Session revoked'), { status: 401, code: 'SESSION_EXPIRED' }));
  const response = await handleNuni(request('confirm', confirmation(prepared)), ['assistant', 'confirm']);
  expect(response.status).toBe(401);
  noBusinessAccess(f);
  expect(providerCall).toHaveBeenCalledTimes(3);
});

it.each(['工讀申請', '實習學分進度'])('describes %s as unconnected rather than advertising a reader or execution tool', async subject => {
  const f = installAdapter();
  providerCall.mockResolvedValueOnce(tool('list_campus_services', { serviceId: 'career' }))
    .mockResolvedValueOnce(answer('本助理尚未讀取這項資料；請在職涯頁核對，沒有送出任何申請。'));
  const prepared = await ask(`職涯服務能代查我的${subject}嗎？`);
  const capability = getAssistantServiceCapability('career')!;
  expect(capability.modes).toEqual(['handoff']);
  expect(capability.tools).toEqual(['list_campus_services', 'propose_open_page']);
  expect(capability.summary).toContain('尚未代查');
  expect(capability.summary).toContain(subject);
  expect(prepared.result.steps).toEqual([expect.objectContaining({ name: 'list_campus_services', status: 'ok' })]);
  expect(prepared.result.cards).toEqual([]);
  noBusinessAccess(f);
});
