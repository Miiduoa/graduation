import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { NextRequest } from 'next/server';

// Only external identity/catalog, navigation, provider and database boundaries
// are fixtures. Assistant/SiteShell, handler, runner, tools and actions stay real.
const fixture = vi.hoisted(() => ({ context: '', account: '', school: 'fixture-school', provider: vi.fn(), adapter: vi.fn() }));
vi.mock('@/lib/nuni/assistantV2/adapter', () => ({ createAdapter: fixture.adapter }));
vi.mock('@/lib/nuni/assistantV2/groq', async importOriginal => ({
  ...await importOriginal(), createProviderModel: () => input => fixture.provider(input),
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({ loading: false, error: '', pendingLogout: false,
    session: { context: fixture.context, platformAccountId: fixture.account }, refresh: async () => {}, logout: async () => {},
  }),
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: null, loading: false, error: null, signOutUser: async () => {}, refreshUser: async () => {} }),
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: fixture.school }),
}));
vi.mock('@/components/SelectedSchoolProvider', () => {
  const value = () => {
    const selectedSchool = { id: fixture.school, name: '合成測試校園', code: 'FIXTURE' };
    return { schools: [selectedSchool], selectedSchool, selectedSchoolId: selectedSchool.id,
      loading: false, catalogStatus: 'ready', selectionError: null, requestedUnavailable: false, selectSchool: () => {} };
  };
  return { useSelectedSchool: value, useOptionalSelectedSchool: value };
});
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('schoolId=' + fixture.school), usePathname: () => '/ai-assistant',
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} }),
}));

let dom, testing, React, Assistant, handleV2, verifyCard, database, server, fixtures;
let secret, now, serial = 0, identitySerial = 0, fault;
const identitiesByContext = new Map(), identitiesByHandle = new Map();
const requests = [], deniedFetches = [];
const serverImportWithoutWindow = typeof window === 'undefined';
const proposed = [
  { title: '合成英文閱讀', date: '2026-11-04', allDay: false, startTime: '18:00', endTime: '19:00' },
  { title: '合成程式練習', date: '2026-11-04', allDay: false, startTime: '20:00', endTime: '21:00' },
];
const revised = [proposed[0], { ...proposed[1], startTime: '21:00', endTime: '22:00' }];
const revisionInstruction = '第一項保持原樣，第二項改成 21:00–22:00';
function registerIdentity(account) {
  const session = { sessionHandle: 'ps_' + ('fixture' + ++identitySerial).padEnd(43, 'x'), expiresAt: now + 3600000 };
  const context = server.sessionContext(session);
  const identity = { account, session, context, cookie: `${server.SESSION_COOKIE}=${server.sealCookie(server.SESSION_COOKIE, session)}` };
  identitiesByContext.set(context, identity);
  identitiesByHandle.set(session.sessionHandle, identity);
  return identity;
}
function useIdentity(identity) { fixture.account = identity.account; fixture.context = identity.context; }
const count = action => requests.filter(request => request.action === action);
const ui = () => testing.within(document.body);
const uiCards = () => ui().getAllByRole('article', { name: '行程確認卡' });
function assertRealCards(entry) {
  for (const card of entry.response.cards) {
    const checked = verifyCard({ account: entry.account, session: entry.context,
      schoolId: entry.body.schoolId, conversationId: entry.body.conversationId },
    { token: card.token, args: card.args }, secret, now);
    expect(checked.mutationId).toBe(card.mutationId);
  }
}
async function initialPlan() {
  const view = testing.render(React.createElement(Assistant));
  const composer = await ui().findByLabelText('問題');
  testing.fireEvent.click(ui().getByRole('checkbox', { name: /^同意在本次對話/ }));
  testing.fireEvent.change(composer, { target: { value: '新增個人行程：英文閱讀與程式練習，先提供確認卡' } });
  testing.fireEvent.click(ui().getByRole('button', { name: '送出' }));
  await testing.waitFor(() => expect(uiCards()).toHaveLength(2));
  const entry = requests.find(request => request.action === 'ask' && Array.isArray(request.response.cards));
  expect(entry.status).toBe(200);
  expect(entry.response.cards.map(card => card.args)).toEqual(proposed);
  assertRealCards(entry);
  return { view, composer, entry };
}
function openRevision() {
  testing.fireEvent.click(ui().getByRole('button', { name: '修改時間或條件' }));
  const editor = ui().getByLabelText('修改條件');
  testing.fireEvent.change(editor, { target: { value: revisionInstruction } });
  testing.fireEvent.click(ui().getByRole('checkbox', { name: /^保留原樣 第 1 項/ }));
  return editor;
}
const submitRevision = () => testing.fireEvent.submit(ui().getByRole('form', { name: '修改安排再預覽' }));

beforeAll(async () => {
  expect(typeof window).toBe('undefined');
  // Load server-only modules in their intended Node environment, once. No guard
  // is mocked, deleted, temporarily hidden or changed after installing the DOM.
  server = await import('@/lib/nuni/server');
  fixtures = await import('@/lib/nuni/assistantV2/fixtures');
  ({ handleV2 } = await import('@/lib/nuni/assistantV2/handler'));
  ({ verifyCard } = await import('@/lib/nuni/assistantV2/actions'));
  expect(typeof window).toBe('undefined');
  secret = fixtures.FIXTURE_SECRET;
  now = fixtures.FIXTURE_NOW;
  for (const [name, value] of Object.entries({
    CAMPUS_BACKEND: 'nuni', CAMPUS_ASSISTANT_ENABLED: 'true', CAMPUS_ASSISTANT_V2_ENABLED: 'true',
    CAMPUS_ASSISTANT_V2_WRITES_ENABLED: 'true', BFF_SESSION_SECRET: secret,
    WEB_PUBLIC_ORIGIN: 'http://localhost:3000', GROQ_API_KEY: 'synthetic-provider-not-a-credential', FLY_MACHINE_ID: '',
  })) vi.stubEnv(name, value);
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:3000/ai-assistant?schoolId=fixture-school', pretendToBeVisual: true,
  });
  for (const name of ['window', 'self', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement',
    'HTMLTextAreaElement', 'HTMLIFrameElement', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
    'StorageEvent', 'MutationObserver', 'localStorage', 'sessionStorage'])
    vi.stubGlobal(name, name === 'window' || name === 'self' ? dom.window : dom.window[name]);
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window));
  vi.stubGlobal('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dom.window.Element.prototype.scrollIntoView = () => {};
  dom.window.matchMedia = query => ({ matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  // Keep Node Request/Response, AbortSignal.any/timeout and crypto for real server work.
  expect(typeof AbortSignal.any).toBe('function');
  vi.stubGlobal('fetch', async (url, init = {}) => {
    if (typeof url !== 'string' || !/^\/api\/nuni\/assistant\/(capability|ask|confirm|cancel|reconcile)$/.test(url)) {
      deniedFetches.push(String(url));
      throw new Error('External fetch forbidden by in-process integration test');
    }
    const action = url.split('/').at(-1), headers = new Headers(init.headers);
    // Capture identity from the originating request, never from mutable current UI
    // identity after an awaited/held response or a subsequent scope change.
    const context = headers.get('X-Campus-Session'), identity = identitiesByContext.get(context);
    if (!identity) throw new Error('Unknown synthetic request session');
    headers.set('cookie', identity.cookie);
    headers.set('origin', 'http://localhost:3000');
    const request = new NextRequest('http://localhost:3000' + url, { ...init, headers });
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const response = await handleV2(request, action);
    const entry = { action, body, context, account: identity.account, signal: init.signal,
      status: response.status, response: await response.clone().json() };
    requests.push(entry);
    if (action === 'cancel' && fault.dropNextCancel) {
      fault.dropNextCancel = false;
      fault.failLedger = true;
      expect(entry.status).toBe(200);
      expect(entry.response.status).toBe('revoked');
      throw new TypeError('Synthetic lost response after real revocation');
    }
    if (action === 'ask' && body.planProtection && fault.holdRevision) {
      fault.holdRevision = false;
      await new Promise(resolve => { fault.held = { entry, release: resolve }; });
    }
    return response;
  });
  React = await import('react');
  testing = await import('@testing-library/react/pure');
  ({ Assistant } = await import('@/features/nuni/Assistant'));
});

beforeEach(() => {
  now = fixtures.FIXTURE_NOW + ++serial * 60000;
  requests.length = 0; deniedFetches.length = 0;
  localStorage.clear(); sessionStorage.clear();
  // JSDOM has no Web Locks. Model only this platform API's per-name exclusive
  // queue; the real local preflight, receipt validation and mirror still run.
  const locks = new Map();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request(name, callback) {
      const task = (locks.get(name) || Promise.resolve()).then(() => callback({ name, mode: 'exclusive' }));
      locks.set(name, task.catch(() => undefined));
      return task;
    },
  } });
  identitiesByContext.clear(); identitiesByHandle.clear();
  fault = { dropNextCancel: false, failLedger: false, holdRevision: false, held: null };
  fixture.school = 'fixture-school';
  useIdentity(registerIdentity('inprocess-fixture-account-' + serial));
  database = fixtures.fixtureAdapter();
  const ledger = database.adapter.ledger;
  database.adapter.ledger = async () => {
    if (fault.failLedger) throw new Error('Synthetic database read unavailable');
    return ledger();
  };
  fixture.adapter.mockReset();
  fixture.adapter.mockImplementation(session => {
    const identity = identitiesByHandle.get(session.sessionHandle);
    if (!identity) throw new Error('Unknown synthetic server session');
    return { adapter: database.adapter,
      principal: async () => ({ platformAccountId: identity.account, isPlatformOperator: false }), apiCalls: () => 0 };
  });
  fixture.provider.mockReset();
  fixture.provider.mockImplementation(async input => {
    const hasResults = input.messages.some(message => message.role === 'user' && message.content?.startsWith('<results trust="untrusted">'));
    const revision = input.messages[0].content.includes('這次只重新預覽原行程');
    if (!hasResults) expect(input.tools?.some(tool => tool.function.name === 'propose_personal_event')).toBe(true);
    return {
      message: !hasResults ? { role: 'assistant', content: '', tool_calls: (revision ? revised : proposed).map((event, index) => ({
        id: 'fixture-tool-' + index, type: 'function', function: { name: 'propose_personal_event', arguments: JSON.stringify(event) },
      })) } : { role: 'assistant', content: revision ? '合成修訂已供預覽，尚未寫入。' : '合成模型回覆：兩項行程僅供預覽，請核對確認卡。' },
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    };
  });
});
afterEach(() => { fault.held?.release(); testing.cleanup(); });
afterAll(() => { dom?.window.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('renders the real Assistant and receives real signed cards through handler/runner/tools without sockets', async () => {
  expect(serverImportWithoutWindow).toBe(true);
  expect(typeof window).toBe('object');
  const { entry } = await initialPlan();
  expect(entry.response.steps.filter(step => step.name === 'propose_personal_event').map(step => step.status)).toEqual(['ok', 'ok']);
  expect(fixture.provider).toHaveBeenCalledTimes(2);
  expect(requests.map(request => request.action)).toEqual(['capability', 'ask', 'ask']);
  expect(requests.find(request => request.response.bootstrap)?.response.bootstrap).toBe(true);
  expect(database.writes).toHaveLength(0);
  expect(database.orderCalls).toHaveLength(0);
  expect(deniedFetches).toEqual([]);
  expect(ui().getAllByRole('button', { name: '確認' })).toHaveLength(2);
  console.log('ASSISTANT_SERVICE_FLOW_OK', JSON.stringify({ serverImportedWithoutWindow: true,
    realAssistantAndSiteShell: true, handledActions: requests.map(request => request.action),
    signedCards: entry.response.cards.length, providerFixtureCalls: fixture.provider.mock.calls.length,
    databaseWrites: database.writes.length, deniedExternalFetches: deniedFetches.length }));
});

it('blocks repeated revision after a real lost cancellation and failed ledger read until real reconciliation proves revocation', async () => {
  const { composer, entry } = await initialPlan();
  testing.fireEvent.change(composer, { target: { value: '保留另一個尚未送出的問題' } });
  const editor = openRevision();
  fault.dropNextCancel = true;
  submitRevision();
  await testing.waitFor(() => expect(count('reconcile')).toHaveLength(1));
  await ui().findByRole('button', { name: '重新核對結果' });
  expect(count('cancel')[0].response.status).toBe('revoked');
  expect(count('reconcile')[0].status).toBe(503);
  expect(ui().getByRole('button', { name: '重新預覽' }).disabled).toBe(true);
  const before = { asks: count('ask').length, models: fixture.provider.mock.calls.length };
  submitRevision(); submitRevision();
  await testing.act(async () => { await Promise.resolve(); });
  expect(count('ask')).toHaveLength(before.asks);
  expect(fixture.provider).toHaveBeenCalledTimes(before.models);
  expect(count('confirm')).toHaveLength(0);
  expect(database.writes).toHaveLength(0);
  expect(editor.value).toBe(revisionInstruction);
  expect(composer.value).toBe('保留另一個尚未送出的問題');
  expect(ui().getByRole('checkbox', { name: /^保留原樣 第 1 項/ }).checked).toBe(true);
  expect(uiCards()).toHaveLength(2);

  fault.failLedger = false;
  testing.fireEvent.click(ui().getByRole('button', { name: '重新核對結果' }));
  await ui().findByText('已撤銷未執行提議');
  expect(count('reconcile').at(-1).response.status).toBe('revoked');
  submitRevision();
  await testing.waitFor(() => expect(uiCards()).toHaveLength(4));
  const replacement = count('ask').at(-1);
  expect(replacement.body.planProtection).toEqual({ originalEvents: proposed, protectedIndices: [0] });
  expect(replacement.response.cards.map(card => card.args)).toEqual(revised);
  assertRealCards(replacement);
  expect(count('cancel').map(request => request.body.token)).toEqual(entry.response.cards.map(card => card.token));
  expect(count('ask')).toHaveLength(3);
  expect(fixture.provider).toHaveBeenCalledTimes(4);
  expect(count('confirm')).toHaveLength(0);
  expect(database.writes).toHaveLength(0);
  expect(deniedFetches).toEqual([]);

  // Preview alone performed no write. Each separate user confirmation now
  // traverses the actual local preflight, handler/actions, database and receipt.
  for (let index = 0; index < 2; index++) {
    const card = replacement.response.cards[index];
    testing.fireEvent.click(testing.within(uiCards()[index + 2]).getByRole('button', { name: '確認' }));
    await testing.waitFor(() => expect(ui().getAllByText('已核對並加入個人行事曆')).toHaveLength(index + 1));
    expect(count('confirm')).toHaveLength(index + 1);
    expect(database.writes).toHaveLength(index + 1);
    expect(count('confirm')[index]).toMatchObject({ status: 200,
      body: { token: card.token, args: card.args }, response: { status: 'verified', mutationId: card.mutationId } });
    expect(database.writes[index].mutationId).toBe(card.mutationId);
  }
  expect(database.writes.map(write => write.mutationId)).toEqual(replacement.response.cards.map(card => card.mutationId));
  expect(new Set(database.writes.map(write => write.mutationId)).size).toBe(2);
  expect(deniedFetches).toEqual([]);
});

it.each(['account', 'school'])('discards a real held revision response after a %s change without rebinding its original request', async target => {
  const { view, entry } = await initialPlan();
  const originalContext = fixture.context, originalAccount = fixture.account, originalSchool = fixture.school;
  openRevision();
  fault.holdRevision = true;
  submitRevision();
  await testing.waitFor(() => expect(fault.held).not.toBeNull());
  const held = fault.held;
  expect(held.entry.status).toBe(200);
  expect(held.entry.response.cards.map(card => card.args)).toEqual(revised);
  assertRealCards(held.entry);
  expect(held.entry.context).toBe(originalContext);
  expect(held.entry.account).toBe(originalAccount);
  expect(held.entry.body.schoolId).toBe(originalSchool);
  expect(count('cancel').map(request => request.body.token)).toEqual(entry.response.cards.map(card => card.token));
  if (target === 'account') useIdentity(registerIdentity('inprocess-other-account-' + serial));
  else fixture.school = 'other-fixture-school';
  view.rerender(React.createElement(Assistant));
  await ui().findByLabelText('問題');
  expect(held.entry.signal.aborted).toBe(true);
  await testing.act(async () => { held.release(); await Promise.resolve(); });
  expect(ui().queryByText('合成修訂已供預覽，尚未寫入。')).toBeNull();
  expect(ui().queryByRole('article', { name: '行程確認卡' })).toBeNull();
  expect(ui().queryByLabelText('修改條件')).toBeNull();
  expect(ui().getByRole('checkbox', { name: /^同意在本次對話/ }).checked).toBe(false);
  expect(held.entry.context).toBe(originalContext);
  expect(held.entry.account).toBe(originalAccount);
  expect(held.entry.body.schoolId).toBe(originalSchool);
  expect(fixture.provider).toHaveBeenCalledTimes(4);
  expect(count('confirm')).toHaveLength(0);
  expect(database.writes).toHaveLength(0);
  expect(deniedFetches).toEqual([]);
});
