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
let secret, now, serial = 0, identitySerial = 0, fault, planEvents, nativeStorageRead;
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
async function initialPlan(existingView) {
  const view = existingView ?? testing.render(React.createElement(Assistant));
  const composer = await ui().findByLabelText('問題');
  testing.fireEvent.click(ui().getByRole('checkbox', { name: /^同意在本次對話/ }));
  testing.fireEvent.change(composer, { target: { value: '新增個人行程：英文閱讀與程式練習，先提供確認卡' } });
  testing.fireEvent.click(ui().getByRole('button', { name: '送出' }));
  await testing.waitFor(() => expect(uiCards()).toHaveLength(planEvents.length));
  const entry = requests.filter(request => request.action === 'ask' && Array.isArray(request.response.cards)).at(-1);
  expect(entry.status).toBe(200);
  expect(entry.response.cards.map(card => card.args)).toEqual(planEvents);
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

function setExactTime(form, values) {
  for (const [field, value] of Object.entries(values)) {
    const label = { date: '開始日期', endDate: '結束日期', startTime: '開始時間', endTime: '結束時間' }[field];
    testing.fireEvent.change(testing.within(form).getByLabelText(label), { target: { value } });
  }
}
function openExactTime(entry, index = 1, values = { startTime: '21:00', endTime: '22:00' }) {
  testing.fireEvent.click(ui().getByRole('button', { name: '精確調整時間' }));
  const form = ui().getByRole('form', { name: '精確調整行程時間' });
  testing.fireEvent.change(testing.within(form).getByLabelText('要調整的行程'), {
    target: { value: entry.response.cards[index].mutationId },
  });
  setExactTime(form, values);
  return form;
}
const submitExactTime = form => testing.fireEvent.submit(form);

function threeSameNameEvents() {
  return [
    { ...proposed[0], title: '同名合成待建行程' },
    { ...proposed[1], title: '同名合成待建行程' },
    { ...proposed[1], title: '同名合成待建行程', startTime: '22:00', endTime: '23:00' },
  ];
}
function openSelection() {
  testing.fireEvent.click(ui().getByRole('button', { name: '選擇要建立的行程' }));
  return ui().getByRole('form', { name: '選擇待建立行程' });
}
const retainedCheckbox = (form, index) => testing.within(form).getByRole('checkbox', { name: new RegExp('^保留 第 ' + (index + 1) + ' 項') });
const submitSelection = form => testing.fireEvent.submit(form);

const TIME_DRAFT_PREFIX = 'campus.assistant-time-draft.v1:';
const FREE_DRAFT_PREFIX = 'campus.assistant-plan-draft.v1:';
function storedDrafts(prefix) {
  const rows = [];
  for (let index = 0; index < sessionStorage.length; index++) {
    const key = sessionStorage.key(index);
    if (prefix ? key.startsWith(prefix) : key.startsWith(TIME_DRAFT_PREFIX) || key.startsWith(FREE_DRAFT_PREFIX)) {
      // Evidence reads bypass only our injected storage faults, never product logic.
      const raw = nativeStorageRead.call(sessionStorage, key);
      rows.push({ key, raw, value: JSON.parse(raw) });
    }
  }
  return rows.sort((left, right) => left.key.localeCompare(right.key));
}
const sentActions = () => requests.filter(request => request.action !== 'capability').map(request => request.action);
const timeRecovery = () => ui().getByRole('region', { name: '未送出的時間草稿' });
function auditTimeDraft() {
  const rows = storedDrafts(TIME_DRAFT_PREFIX);
  expect(rows).toHaveLength(1);
  const row = rows[0];
  expect(row.key).toMatch(/^campus\.assistant-time-draft\.v1:[a-f0-9]{64}$/);
  expect(row.value.source.events).toEqual(planEvents);
  for (const forbidden of ['token', 'mutationId', 'context', 'conversationId', 'consent', 'accountId', 'schoolId', 'turn'])
    expect(row.raw).not.toContain('"' + forbidden + '"');
  for (const card of requests.flatMap(request => request.response?.cards ?? [])) {
    expect(row.raw).not.toContain(card.token);
    expect(row.raw).not.toContain(card.mutationId);
  }
  return row;
}
async function remountAssistant(view, extraActions = []) {
  const before = sentActions(), capabilities = count('capability').length, writes = structuredClone(database.writes);
  view.unmount();
  const next = testing.render(React.createElement(Assistant));
  await ui().findByLabelText('問題');
  await testing.waitFor(() => expect(count('capability')).toHaveLength(capabilities + 1));
  await testing.waitFor(() => expect(sentActions()).toEqual([...before, ...extraActions]));
  await testing.act(async () => { await Promise.resolve(); });
  expect(sentActions()).toEqual([...before, ...extraActions]);
  expect(database.writes).toEqual(writes);
  expect(ui().getByRole('checkbox', { name: /^同意在本次對話/ }).checked).toBe(false);
  return next;
}
function restoreTimeDraft() {
  const before = sentActions();
  const panel = timeRecovery();
  expect(testing.within(panel).queryByRole('list', { name: '草稿的時間修改欄位' })).toBeNull();
  expect(testing.within(panel).queryByRole('list', { name: '時間草稿的原提議內容' })).toBeNull();
  testing.fireEvent.click(testing.within(panel).getByRole('button', { name: '恢復時間草稿' }));
  expect(ui().getByRole('region', { name: '已恢復的時間草稿內容' })).toBeTruthy();
  expect(sentActions()).toEqual(before);
  expect(database.writes).toHaveLength(0);
}
function exactFields(form) {
  const within = testing.within(form);
  return { date: within.getByLabelText('開始日期').value, endDate: within.getByLabelText('結束日期').value,
    startTime: within.getByLabelText('開始時間').value, endTime: within.getByLabelText('結束時間').value };
}
function selectExactTarget(form, entry, index) {
  testing.fireEvent.change(testing.within(form).getByLabelText('要調整的行程'), {
    target: { value: entry.response.cards[index].mutationId },
  });
}
function assertNoAdditionalModel() {
  expect(count('ask')).toHaveLength(2); // Route bootstrap plus the one original model request.
  expect(fixture.provider).toHaveBeenCalledTimes(2);
  expect(deniedFetches).toEqual([]);
}
async function assertOriginalCannotExecute(entry) {
  const identity = identitiesByContext.get(entry.context);
  for (const card of entry.response.cards) {
    // Explicit server security probe, separate from user confirmation requests.
    // Real handler/actions must reject the original authorization after revision.
    const response = await handleV2(new NextRequest('http://localhost:3000/api/nuni/assistant/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3000',
        cookie: identity.cookie, 'X-Campus-Session': entry.context },
      body: JSON.stringify({ schoolId: entry.body.schoolId, conversationId: entry.body.conversationId,
        token: card.token, args: card.args }),
    }), 'confirm');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'CONFIRMATION_REVOKED' });
  }
  expect(database.writes).toHaveLength(0);
}

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
  nativeStorageRead = dom.window.Storage.prototype.getItem;
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
    if (typeof url !== 'string' || !/^\/api\/nuni\/assistant\/(capability|ask|revise|confirm|cancel|reconcile)$/.test(url)) {
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
    const draftsAtDispatch = storedDrafts();
    const response = await handleV2(request, action);
    const entry = { action, body, context, account: identity.account, signal: init.signal, draftsAtDispatch,
      status: response.status, response: await response.clone().json() };
    requests.push(entry);
    if (action === 'cancel' && fault.dropNextCancel) {
      fault.dropNextCancel = false;
      fault.failLedger = true;
      expect(entry.status).toBe(200);
      expect(entry.response.status).toBe('revoked');
      throw new TypeError('Synthetic lost response after real revocation');
    }
    if ((action === 'ask' && body.planProtection && fault.holdRevision) || (action === 'revise' && fault.holdPrecise)) {
      if (action === 'revise') fault.holdPrecise = false;
      else fault.holdRevision = false;
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
  fault = { dropNextCancel: false, failLedger: false, holdRevision: false, holdPrecise: false, held: null };
  planEvents = structuredClone(proposed);
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
      message: !hasResults ? { role: 'assistant', content: '', tool_calls: (revision ? revised : planEvents).map((event, index) => ({
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


it('previews one exact time change without another model call and confirms only fresh signed cards once', async () => {
  const { entry } = await initialPlan();
  const form = openExactTime(entry);
  const ledgerBefore = database.snapshot();
  fault.holdPrecise = true;
  submitExactTime(form); submitExactTime(form);
  await testing.waitFor(() => expect(fault.held).not.toBeNull());
  const held = fault.held;
  submitExactTime(form); submitExactTime(form);
  await testing.act(async () => { await Promise.resolve(); });
  expect(count('revise')).toHaveLength(1);
  expect(count('cancel').map(request => request.body.token)).toEqual(entry.response.cards.map(card => card.token));
  expect(count('confirm')).toHaveLength(0);
  expect(database.writes).toHaveLength(0);
  assertNoAdditionalModel();
  await testing.act(async () => { held.release(); await Promise.resolve(); });
  await testing.waitFor(() => expect(uiCards()).toHaveLength(4));
  const replacement = count('revise')[0];
  expect(replacement.status).toBe(200);
  expect(replacement.body.originalCards).toEqual(entry.response.cards.map(({ token, args }) => ({ token, args })));
  expect(replacement.body.change).toEqual({ mutationId: entry.response.cards[1].mutationId,
    date: proposed[1].date, endDate: proposed[1].date, startTime: '21:00', endTime: '22:00' });
  expect(typeof replacement.body.routeToken).toBe('string');
  expect(replacement.response.cards.map(card => card.args)).toEqual(revised);
  assertRealCards(replacement);
  expect(replacement.response.cards.every(card => !entry.response.cards.some(original => original.mutationId === card.mutationId || original.token === card.token))).toBe(true);
  await assertOriginalCannotExecute(entry);
  expect(database.snapshot()).toEqual(ledgerBefore);
  for (let index = 0; index < 2; index++) {
    testing.fireEvent.click(testing.within(uiCards()[index + 2]).getByRole('button', { name: '確認' }));
    await testing.waitFor(() => expect(ui().getAllByText('已核對並加入個人行事曆')).toHaveLength(index + 1));
    expect(database.writes).toHaveLength(index + 1);
    expect(count('confirm')[index]).toMatchObject({ status: 200,
      body: { token: replacement.response.cards[index].token, args: replacement.response.cards[index].args },
      response: { status: 'verified', mutationId: replacement.response.cards[index].mutationId } });
  }
  expect(count('confirm')).toHaveLength(2);
  expect(database.writes.map(write => write.mutationId)).toEqual(replacement.response.cards.map(card => card.mutationId));
  assertNoAdditionalModel();
});

it('keeps exact inputs after a full-plan conflict and retries without cancelling the original cards twice', async () => {
  const { entry } = await initialPlan();
  const form = openExactTime(entry, 1, { startTime: '18:30', endTime: '19:30' });
  const ledgerBefore = database.snapshot();
  submitExactTime(form);
  await testing.waitFor(() => expect(count('revise')).toHaveLength(1));
  expect(count('revise')[0].status).toBe(409);
  expect(count('revise')[0].response).toMatchObject({ error: 'EVENT_CONFLICT' });
  expect(count('revise')[0].response.cards).toBeUndefined();
  expect(database.snapshot()).toEqual(ledgerBefore);
  await testing.waitFor(() => expect(testing.within(form).getByRole('button', { name: '預覽時間調整' }).disabled).toBe(false));
  expect(testing.within(form).getByLabelText('開始時間').value).toBe('18:30');
  expect(testing.within(form).getByLabelText('結束時間').value).toBe('19:30');
  expect(uiCards()).toHaveLength(2);
  expect(count('cancel')).toHaveLength(2);
  expect(count('confirm')).toHaveLength(0);
  await assertOriginalCannotExecute(entry);
  setExactTime(form, { startTime: '21:00', endTime: '22:00' });
  submitExactTime(form);
  await testing.waitFor(() => expect(uiCards()).toHaveLength(4));
  expect(count('revise')).toHaveLength(2);
  expect(count('revise')[1].status).toBe(200);
  expect(count('revise')[1].response.cards.map(card => card.args)).toEqual(revised);
  assertRealCards(count('revise')[1]);
  expect(database.snapshot()).toEqual(ledgerBefore);
  expect(count('cancel')).toHaveLength(2);
  expect(database.writes).toHaveLength(0);
  assertNoAdditionalModel();
});

it('rejects unchanged or invalid exact time input without dispatch and preserves it when collapsed', async () => {
  const { entry } = await initialPlan();
  let form = openExactTime(entry, 1, {});
  const before = requests.length;
  submitExactTime(form);
  expect(testing.within(form).getByRole('status').textContent).toContain('時間沒有變更');
  expect(requests).toHaveLength(before);
  setExactTime(form, { startTime: '22:00', endTime: '21:00' });
  submitExactTime(form);
  expect(testing.within(form).getByRole('alert').textContent).toContain('結束時間必須晚於開始時間');
  expect(document.activeElement).toBe(testing.within(form).getByLabelText('結束時間'));
  expect(requests).toHaveLength(before);
  testing.fireEvent.click(testing.within(form).getByRole('button', { name: '收起時間調整' }));
  expect(ui().queryByRole('form', { name: '精確調整行程時間' })).toBeNull();
  testing.fireEvent.click(ui().getByRole('button', { name: '精確調整時間' }));
  form = ui().getByRole('form', { name: '精確調整行程時間' });
  expect(testing.within(form).getByLabelText('要調整的行程').value).toBe(entry.response.cards[1].mutationId);
  expect(testing.within(form).getByLabelText('開始時間').value).toBe('22:00');
  expect(testing.within(form).getByLabelText('結束時間').value).toBe('21:00');
  await testing.act(async () => { await Promise.resolve(); });
  expect(requests).toHaveLength(before);
  expect(count('cancel')).toHaveLength(0);
  expect(count('revise')).toHaveLength(0);
  expect(database.writes).toHaveLength(0);
  expect(ui().getAllByRole('button', { name: '確認' })).toHaveLength(2);
  assertNoAdditionalModel();
});

it('changes the selected same-name event across midnight using its signed identity and retains the other event exactly', async () => {
  planEvents = proposed.map(event => ({ ...event, title: '同名合成讀書安排' }));
  const { entry } = await initialPlan();
  const form = openExactTime(entry, 1, { date: '2026-11-04', endDate: '2026-11-05', startTime: '23:00', endTime: '01:00' });
  submitExactTime(form);
  await testing.waitFor(() => expect(uiCards()).toHaveLength(4));
  const replacement = count('revise')[0];
  expect(replacement.status).toBe(200);
  expect(replacement.body.change.mutationId).toBe(entry.response.cards[1].mutationId);
  expect(replacement.response.cards.map(card => card.args)).toEqual([
    planEvents[0], { ...planEvents[1], endDate: '2026-11-05', startTime: '23:00', endTime: '01:00' },
  ]);
  assertRealCards(replacement);
  expect(count('confirm')).toHaveLength(0);
  expect(database.writes).toHaveLength(0);
  assertNoAdditionalModel();
});

it('does not dispatch exact revision while a lost cancellation remains unknown, then resumes after reconciliation', async () => {
  const { entry } = await initialPlan();
  const form = openExactTime(entry);
  fault.dropNextCancel = true;
  submitExactTime(form);
  await testing.waitFor(() => expect(count('reconcile')).toHaveLength(1));
  await ui().findByRole('button', { name: '重新核對結果' });
  expect(count('cancel')[0].response.status).toBe('revoked');
  expect(count('reconcile')[0].status).toBe(503);
  expect(testing.within(form).getByRole('button', { name: '預覽時間調整' }).disabled).toBe(true);
  submitExactTime(form); submitExactTime(form);
  await testing.act(async () => { await Promise.resolve(); });
  expect(count('revise')).toHaveLength(0);
  expect(count('cancel')).toHaveLength(1);
  expect(count('confirm')).toHaveLength(0);
  expect(database.writes).toHaveLength(0);
  assertNoAdditionalModel();
  fault.failLedger = false;
  testing.fireEvent.click(ui().getByRole('button', { name: '重新核對結果' }));
  await ui().findByText('已撤銷未執行提議');
  submitExactTime(form);
  await testing.waitFor(() => expect(uiCards()).toHaveLength(4));
  expect(count('revise')).toHaveLength(1);
  expect(count('revise')[0].response.cards.map(card => card.args)).toEqual(revised);
  expect(count('cancel').map(request => request.body.token)).toEqual(entry.response.cards.map(card => card.token));
  expect(database.writes).toHaveLength(0);
  assertNoAdditionalModel();
});

it.each(['account', 'school'])('discards a held exact revision after a %s switch without applying its original scope to the new UI', async target => {
  const { view, entry } = await initialPlan();
  const originalContext = fixture.context, originalAccount = fixture.account, originalSchool = fixture.school;
  const form = openExactTime(entry);
  fault.holdPrecise = true;
  submitExactTime(form);
  await testing.waitFor(() => expect(fault.held).not.toBeNull());
  const held = fault.held;
  expect(held.entry.status).toBe(200);
  expect(held.entry.response.cards.map(card => card.args)).toEqual(revised);
  assertRealCards(held.entry);
  expect(held.entry.context).toBe(originalContext);
  expect(held.entry.account).toBe(originalAccount);
  expect(held.entry.body.schoolId).toBe(originalSchool);
  if (target === 'account') useIdentity(registerIdentity('inprocess-exact-other-account-' + serial));
  else fixture.school = 'other-fixture-school';
  view.rerender(React.createElement(Assistant));
  await ui().findByLabelText('問題');
  expect(held.entry.signal.aborted).toBe(true);
  await testing.act(async () => { held.release(); await Promise.resolve(); });
  expect(ui().queryByRole('article', { name: '行程確認卡' })).toBeNull();
  expect(ui().queryByRole('form', { name: '精確調整行程時間' })).toBeNull();
  expect(ui().getByRole('checkbox', { name: /^同意在本次對話/ }).checked).toBe(false);
  expect(held.entry.context).toBe(originalContext);
  expect(held.entry.account).toBe(originalAccount);
  expect(held.entry.body.schoolId).toBe(originalSchool);
  expect(count('revise')).toHaveLength(1);
  expect(count('confirm')).toHaveLength(0);
  expect(database.writes).toHaveLength(0);
  assertNoAdditionalModel();
});

it('restores content-only multi-target time drafts after remount, binds fresh same-name cards explicitly and confirms only the selected change', async () => {
  planEvents = proposed.map(event => ({ ...event, title: '同名但不同時段的合成安排' }));
  const original = await initialPlan();
  const free = openRevision();
  testing.fireEvent.click(ui().getByRole('button', { name: '收起修改' }));
  const form = openExactTime(original.entry, 0, { startTime: '', endTime: '19:15' });
  selectExactTarget(form, original.entry, 1);
  setExactTime(form, { startTime: '23:00', endDate: '2026-11-05', endTime: '01:00' });
  const saved = auditTimeDraft();
  expect(saved.value.selectedIndex).toBe(1);
  expect(saved.value.edits).toEqual([
    { index: 0, date: '2026-11-04', endDate: '2026-11-04', startTime: '', endTime: '19:15' },
    { index: 1, date: '2026-11-04', endDate: '2026-11-05', startTime: '23:00', endTime: '01:00' },
  ]);
  expect(storedDrafts(FREE_DRAFT_PREFIX)).toHaveLength(1);
  testing.fireEvent.click(ui().getByRole('button', { name: '修改時間或條件' }));
  testing.fireEvent.change(ui().getByLabelText('修改條件'), { target: { value: free.value + '，此文字草稿獨立保留' } });
  testing.fireEvent.click(ui().getByRole('button', { name: '收起修改' }));
  expect(auditTimeDraft()).toEqual(saved);
  const savedFree = storedDrafts(FREE_DRAFT_PREFIX);
  const view = await remountAssistant(original.view);
  expect(ui().queryByRole('article', { name: '行程確認卡' })).toBeNull();
  expect(ui().getByRole('region', { name: '未送出的修訂草稿' })).toBeTruthy();
  restoreTimeDraft();
  const recovered = ui().getByRole('region', { name: '已恢復的時間草稿內容' });
  expect(recovered.textContent).toContain('未填');
  expect(recovered.textContent).toContain('最後編輯：第 2 項');
  expect(document.activeElement).toBe(recovered);
  expect(storedDrafts(FREE_DRAFT_PREFIX)).toEqual(savedFree);
  const fresh = await initialPlan(view);
  expect(fresh.entry.response.cards.every(card => original.entry.response.cards.every(old => old.mutationId !== card.mutationId))).toBe(true);
  const editor = openExactTime(fresh.entry, 0, {});
  const beforeApply = sentActions();
  testing.fireEvent.click(testing.within(editor).getByRole('button', { name: '套用已恢復的時間草稿' }));
  expect(testing.within(editor).getByLabelText('要調整的行程').value).toBe(fresh.entry.response.cards[1].mutationId);
  expect(exactFields(editor)).toEqual({ date: '2026-11-04', endDate: '2026-11-05', startTime: '23:00', endTime: '01:00' });
  selectExactTarget(editor, fresh.entry, 0);
  expect(exactFields(editor).startTime).toBe('');
  selectExactTarget(editor, fresh.entry, 1);
  expect(sentActions()).toEqual(beforeApply);
  const applied = auditTimeDraft();
  expect(applied.value.source.key).not.toBe(saved.value.source.key);
  expect(applied.value.edits).toEqual(saved.value.edits);
  // The old free-text draft is a different source until the user explicitly
  // applies it to these fresh cards. Only then must one dispatch clear both modes.
  testing.fireEvent.click(ui().getByRole('button', { name: '恢復修訂草稿' }));
  testing.fireEvent.click(ui().getByRole('button', { name: '修改時間或條件' }));
  testing.fireEvent.click(ui().getByRole('button', { name: '套用已恢復的草稿' }));
  expect(storedDrafts(FREE_DRAFT_PREFIX)[0].value.source.key).toBe(applied.value.source.key);
  testing.fireEvent.click(ui().getByRole('button', { name: '收起修改' }));
  expect(auditTimeDraft()).toEqual(applied);
  expect(sentActions()).toEqual(beforeApply);
  expect(database.writes).toHaveLength(0);
  const dispatchStart = requests.length;
  submitExactTime(editor);
  await testing.waitFor(() => expect(uiCards()).toHaveLength(4));
  const replacement = count('revise').at(-1);
  expect(replacement.body.change.mutationId).toBe(fresh.entry.response.cards[1].mutationId);
  expect(replacement.response.cards.map(card => card.args)).toEqual([
    planEvents[0], { ...planEvents[1], endDate: '2026-11-05', startTime: '23:00', endTime: '01:00' },
  ]);
  assertRealCards(replacement);
  expect(storedDrafts()).toEqual([]);
  expect(requests.slice(dispatchStart).map(request => request.action)).toEqual(['cancel', 'cancel', 'revise']);
  for (const request of requests.slice(dispatchStart)) expect(request.draftsAtDispatch).toEqual([]);
  expect(database.writes).toHaveLength(0);
  expect(fixture.provider).toHaveBeenCalledTimes(4); // Two explicit asks, never recovery/apply/revise.
  for (let index = 0; index < 2; index++) {
    testing.fireEvent.click(testing.within(uiCards()[index + 2]).getByRole('button', { name: '確認' }));
    await testing.waitFor(() => expect(ui().getAllByText('已核對並加入個人行事曆')).toHaveLength(index + 1));
    expect(database.writes).toHaveLength(index + 1);
    expect(count('confirm')[index]).toMatchObject({ status: 200,
      body: { token: replacement.response.cards[index].token, args: replacement.response.cards[index].args },
      response: { status: 'verified', mutationId: replacement.response.cards[index].mutationId } });
  }
  expect(database.writes.map(write => write.mutationId)).toEqual(replacement.response.cards.map(card => card.mutationId));
  expect(count('confirm')).toHaveLength(2);
  expect(fixture.provider).toHaveBeenCalledTimes(4);
  expect(deniedFetches).toEqual([]);
});

it('keeps newly typed time fields separate from recovered content until an explicit replacement choice', async () => {
  const original = await initialPlan();
  openExactTime(original.entry);
  const saved = auditTimeDraft();
  const view = await remountAssistant(original.view);
  restoreTimeDraft();
  const fresh = await initialPlan(view);
  const form = openExactTime(fresh.entry, 1, { startTime: '22:00', endTime: '23:00' });
  const before = sentActions();
  expect(storedDrafts(TIME_DRAFT_PREFIX)[0]).toEqual(saved);
  testing.fireEvent.click(testing.within(form).getByRole('button', { name: '保留目前時間欄位' }));
  expect(exactFields(form)).toEqual({ date: '2026-11-04', endDate: '2026-11-04', startTime: '22:00', endTime: '23:00' });
  expect(storedDrafts(TIME_DRAFT_PREFIX)[0]).toEqual(saved);
  expect(sentActions()).toEqual(before);
  testing.fireEvent.click(testing.within(form).getByRole('button', { name: '以恢復草稿取代目前時間欄位' }));
  expect(exactFields(form)).toEqual({ date: '2026-11-04', endDate: '2026-11-04', startTime: '21:00', endTime: '22:00' });
  expect(testing.within(form).getByLabelText('要調整的行程').value).toBe(fresh.entry.response.cards[1].mutationId);
  expect(sentActions()).toEqual(before);
  expect(database.writes).toHaveLength(0);
  expect(count('cancel')).toHaveLength(0);
  expect(count('revise')).toHaveLength(0);
  expect(count('confirm')).toHaveLength(0);
});

it.each(['changed', 'reordered', 'missing'])('keeps recovered time content read-only when the fresh source is %s', async mode => {
  const original = await initialPlan();
  openExactTime(original.entry);
  const saved = auditTimeDraft();
  const view = await remountAssistant(original.view);
  restoreTimeDraft();
  planEvents = mode === 'changed' ? [proposed[0], { ...proposed[1], startTime: '22:00', endTime: '23:00' }]
    : mode === 'reordered' ? [...proposed].reverse() : [proposed[0]];
  const fresh = await initialPlan(view);
  const form = openExactTime(fresh.entry, 0, {});
  expect(form.textContent).toContain('目前提議的內容或順序已變更，不能直接套用時間草稿');
  expect(testing.within(form).queryByRole('button', { name: '套用已恢復的時間草稿' })).toBeNull();
  expect(testing.within(form).queryByRole('button', { name: '以恢復草稿取代目前時間欄位' })).toBeNull();
  expect(ui().getByRole('list', { name: '草稿的時間修改欄位' }).textContent).toContain('21:00');
  expect(storedDrafts(TIME_DRAFT_PREFIX)[0]).toEqual(saved);
  expect(count('cancel')).toHaveLength(0);
  expect(count('revise')).toHaveLength(0);
  expect(count('confirm')).toHaveLength(0);
  expect(database.writes).toHaveLength(0);
});

it.each(['account', 'school'])('isolates saved time content through a %s remount and requires explicit recovery on return', async target => {
  const identity = identitiesByContext.get(fixture.context), school = fixture.school;
  const original = await initialPlan();
  openExactTime(original.entry);
  const saved = auditTimeDraft();
  if (target === 'account') useIdentity(registerIdentity('time-draft-other-account-' + serial));
  else fixture.school = 'other-fixture-school';
  const other = await remountAssistant(original.view);
  expect(ui().queryByRole('region', { name: '未送出的時間草稿' })).toBeNull();
  expect(ui().queryByRole('region', { name: '已恢復的時間草稿內容' })).toBeNull();
  expect(document.body.textContent).not.toContain(proposed[1].title);
  useIdentity(identity); fixture.school = school;
  await remountAssistant(other);
  expect(timeRecovery()).toBeTruthy();
  expect(ui().queryByRole('region', { name: '已恢復的時間草稿內容' })).toBeNull();
  expect(auditTimeDraft()).toEqual(saved);
  restoreTimeDraft();
  expect(count('ask')).toHaveLength(2);
  expect(count('cancel')).toHaveLength(0);
  expect(count('revise')).toHaveLength(0);
  expect(count('confirm')).toHaveLength(0);
});

it('preserves time draft data after read denial and blocks dispatch when draft removal cannot be verified', async () => {
  const original = await initialPlan();
  openExactTime(original.entry);
  const saved = auditTimeDraft();
  const prototype = dom.window.Storage.prototype;
  const read = vi.spyOn(prototype, 'getItem').mockImplementation(function(key) {
    if (key.startsWith(TIME_DRAFT_PREFIX)) throw new dom.window.DOMException('Synthetic time-draft read denied', 'SecurityError');
    return nativeStorageRead.call(this, key);
  });
  let view;
  try {
    view = await remountAssistant(original.view);
    expect(ui().queryByRole('region', { name: '未送出的時間草稿' })).toBeNull();
    expect(storedDrafts(TIME_DRAFT_PREFIX)[0]).toEqual(saved);
    expect(count('cancel')).toHaveLength(0);
  } finally { read.mockRestore(); }
  view = await remountAssistant(view);
  restoreTimeDraft();
  const fresh = await initialPlan(view);
  const form = openExactTime(fresh.entry, 0, {});
  testing.fireEvent.click(testing.within(form).getByRole('button', { name: '套用已恢復的時間草稿' }));
  const before = sentActions(), beforeFields = exactFields(form), durable = storedDrafts(TIME_DRAFT_PREFIX);
  const removeItem = prototype.removeItem;
  const remove = vi.spyOn(prototype, 'removeItem').mockImplementation(function(key) {
    if (key.startsWith(TIME_DRAFT_PREFIX)) throw new dom.window.DOMException('Synthetic time-draft removal denied', 'SecurityError');
    return removeItem.call(this, key);
  });
  try {
    submitExactTime(form);
    await testing.waitFor(() => expect(testing.within(form).getAllByRole('alert').some(node => node.textContent.includes('清除'))).toBe(true));
    expect(sentActions()).toEqual(before);
    expect(exactFields(form)).toEqual(beforeFields);
    expect(storedDrafts(TIME_DRAFT_PREFIX)).toEqual(durable);
    expect(count('cancel')).toHaveLength(0);
    expect(count('revise')).toHaveLength(0);
    expect(count('confirm')).toHaveLength(0);
    expect(database.writes).toHaveLength(0);
  } finally { remove.mockRestore(); }
});

it('clears both input modes before cancellation and remounts an unknown result only through the execution journal', async () => {
  const original = await initialPlan();
  openRevision();
  const form = openExactTime(original.entry);
  expect(storedDrafts(FREE_DRAFT_PREFIX)).toHaveLength(1);
  expect(storedDrafts(TIME_DRAFT_PREFIX)).toHaveLength(1);
  fault.dropNextCancel = true;
  submitExactTime(form);
  await testing.waitFor(() => expect(count('reconcile')).toHaveLength(1));
  await ui().findByRole('button', { name: '重新核對結果' });
  expect(count('cancel')).toHaveLength(1);
  expect(count('cancel')[0].draftsAtDispatch).toEqual([]);
  expect(storedDrafts()).toEqual([]);
  // After dispatch, changed retry fields may live in memory only.
  setExactTime(form, { startTime: '22:00', endTime: '23:00' });
  expect(storedDrafts()).toEqual([]);
  fault.failLedger = false;
  await remountAssistant(original.view, ['reconcile']);
  await ui().findByText('已撤銷未執行提議');
  expect(uiCards()).toHaveLength(1);
  expect(count('reconcile')).toHaveLength(2);
  expect(count('reconcile').at(-1).body.token).toBe(original.entry.response.cards[0].token);
  expect(count('cancel')).toHaveLength(1);
  expect(count('revise')).toHaveLength(0);
  expect(count('confirm')).toHaveLength(0);
  expect(count('ask')).toHaveLength(2);
  expect(fixture.provider).toHaveBeenCalledTimes(2);
  expect(database.writes).toHaveLength(0);
  expect(storedDrafts()).toEqual([]);
  expect(ui().queryByRole('region', { name: '未送出的時間草稿' })).toBeNull();
  expect(ui().queryByRole('region', { name: '未送出的修訂草稿' })).toBeNull();
  expect(ui().queryByRole('form', { name: '精確調整行程時間' })).toBeNull();
  expect(deniedFetches).toEqual([]);
});


it('offers an explicit draft replacement when a later proposal is edited in the same mounted Assistant', async () => {
  const original = await initialPlan();
  openExactTime(original.entry);
  const savedA = auditTimeDraft(), capabilities = count('capability').length;
  planEvents = [proposed[0], { ...proposed[1], title: '合成另一份程式安排', startTime: '21:00', endTime: '22:00' }];
  testing.fireEvent.change(original.composer, { target: { value: '另外提出一份英文與程式行程，仍只提供待確認提議' } });
  testing.fireEvent.click(ui().getByRole('button', { name: '送出' }));
  await testing.waitFor(() => expect(uiCards()).toHaveLength(4));
  const fresh = count('ask').at(-1);
  expect(fresh.status).toBe(200);
  expect(fresh.response.cards.map(card => card.args)).toEqual(planEvents);
  assertRealCards(fresh);
  expect(count('capability')).toHaveLength(capabilities); // No remount or recovery shortcut.
  const editorRegion = ui().getAllByRole('region', { name: '精確時間調整' }).at(-1);
  testing.fireEvent.click(testing.within(editorRegion).getByRole('button', { name: '精確調整時間' }));
  const form = testing.within(editorRegion).getByRole('form', { name: '精確調整行程時間' });
  selectExactTarget(form, fresh, 1);
  const before = sentActions();
  setExactTime(form, { startTime: '22:00', endTime: '23:00' });
  expect(storedDrafts(TIME_DRAFT_PREFIX)).toEqual([savedA]);
  expect(timeRecovery()).toBeTruthy();
  const replace = testing.within(form).getByRole('button', { name: '改存目前時間欄位' });
  expect(replace.disabled).toBe(false);
  expect(exactFields(form)).toEqual({ date: '2026-11-04', endDate: '2026-11-04', startTime: '22:00', endTime: '23:00' });
  expect(sentActions()).toEqual(before);
  testing.fireEvent.click(replace);
  const savedB = auditTimeDraft();
  expect(savedB.value.source.key).not.toBe(savedA.value.source.key);
  expect(savedB.value.selectedIndex).toBe(1);
  expect(savedB.value.edits).toEqual([{ index: 1, date: '2026-11-04', endDate: '2026-11-04', startTime: '22:00', endTime: '23:00' }]);
  expect(sentActions()).toEqual(before);
  expect(count('ask')).toHaveLength(3);
  expect(fixture.provider).toHaveBeenCalledTimes(4);
  expect(count('cancel')).toHaveLength(0);
  expect(count('revise')).toHaveLength(0);
  expect(count('confirm')).toHaveLength(0);
  expect(database.writes).toHaveLength(0);
  expect(deniedFetches).toEqual([]);
});


it('retains the first and third same-name proposals with three edit clicks, no model request and two separate confirmations', async () => {
  planEvents = threeSameNameEvents();
  const { entry } = await initialPlan();
  const baseline = database.snapshot(), clicks = [];
  const click = (control, description) => { clicks.push(description); testing.fireEvent.click(control); };
  click(ui().getByRole('button', { name: '選擇要建立的行程' }), 'open selection');
  const form = ui().getByRole('form', { name: '選擇待建立行程' });
  expect([0, 1, 2].map(index => retainedCheckbox(form, index).checked)).toEqual([true, true, true]);
  click(retainedCheckbox(form, 1), 'exclude original item 2');
  fault.holdPrecise = true; // Hold only the shared revise transport after the real handler returns.
  click(testing.within(form).getByRole('button', { name: '預覽所選行程' }), 'preview retained items');
  submitSelection(form); // Controlled duplicate submit, not an additional benchmark user step.
  await testing.waitFor(() => expect(fault.held).not.toBeNull());
  const held = fault.held;
  submitSelection(form);
  await testing.act(async () => { await Promise.resolve(); });
  expect(count('revise')).toHaveLength(1);
  expect(count('cancel').map(request => request.body.token)).toEqual(entry.response.cards.map(card => card.token));
  expect(database.snapshot()).toEqual(baseline);
  expect(database.writes).toHaveLength(0);
  expect(count('confirm')).toHaveLength(0);
  assertNoAdditionalModel();
  await testing.act(async () => { held.release(); await Promise.resolve(); });
  await testing.waitFor(() => expect(uiCards()).toHaveLength(5));
  const replacement = count('revise')[0], retained = [planEvents[0], planEvents[2]];
  expect(replacement.status).toBe(200);
  expect(replacement.body.keepMutationIds).toEqual([entry.response.cards[0].mutationId, entry.response.cards[2].mutationId]);
  expect(replacement.body).not.toHaveProperty('change');
  expect(replacement.body.originalCards).toEqual(entry.response.cards.map(({ token, args }) => ({ token, args })));
  expect(replacement.response.cards.map(card => card.args)).toEqual(retained);
  expect(new Set(replacement.response.cards.map(card => card.mutationId)).size).toBe(2);
  expect(replacement.response.cards.every(card => entry.response.cards.every(old => old.mutationId !== card.mutationId && old.token !== card.token))).toBe(true);
  assertRealCards(replacement);
  const summary = ui().getByRole('region', { name: '行程選擇摘要' });
  expect(testing.within(testing.within(summary).getByRole('list', { name: '保留的原提議行程' })).getAllByRole('listitem')).toHaveLength(2);
  expect(testing.within(testing.within(summary).getByRole('list', { name: '排除的原提議行程' })).getAllByRole('listitem')).toHaveLength(1);
  await assertOriginalCannotExecute(entry);
  expect(database.snapshot()).toEqual(baseline);
  expect(clicks).toEqual(['open selection', 'exclude original item 2', 'preview retained items']);
  for (let index = 0; index < 2; index++) {
    click(testing.within(uiCards()[index + 3]).getByRole('button', { name: '確認' }), 'confirm retained item ' + (index + 1));
    await testing.waitFor(() => expect(ui().getAllByText('已核對並加入個人行事曆')).toHaveLength(index + 1));
    expect(database.writes).toHaveLength(index + 1);
    expect(count('confirm')[index]).toMatchObject({ status: 200,
      body: { token: replacement.response.cards[index].token, args: retained[index] },
      response: { status: 'verified', mutationId: replacement.response.cards[index].mutationId } });
  }
  expect(database.writes.map(write => write.mutationId)).toEqual(replacement.response.cards.map(card => card.mutationId));
  expect(count('confirm')).toHaveLength(2);
  assertNoAdditionalModel();
  console.log('ASSISTANT_SUBSET_FLOW_OK', JSON.stringify({ environment: 'Node/JSDOM in-process, not browser timing',
    startingProposalItems: 3, retainedOriginalIndices: [0, 2], editClicks: clicks.slice(0, 3),
    confirmationClicks: clicks.slice(3), controlledDuplicateSubmits: 2, previewWrites: 0,
    confirmedWrites: database.writes.length, providerFixtureCalls: fixture.provider.mock.calls.length }));
});

it('keeps selection choices when closed and leaves all-selected proposals untouched', async () => {
  planEvents = threeSameNameEvents();
  const { entry } = await initialPlan();
  let form = openSelection();
  const before = sentActions();
  submitSelection(form);
  await testing.act(async () => { await Promise.resolve(); });
  expect(sentActions()).toEqual(before);
  testing.fireEvent.click(retainedCheckbox(form, 1));
  testing.fireEvent.click(testing.within(form).getByRole('button', { name: '收起行程選擇' }));
  expect(ui().queryByRole('form', { name: '選擇待建立行程' })).toBeNull();
  form = openSelection();
  expect([0, 1, 2].map(index => retainedCheckbox(form, index).checked)).toEqual([true, false, true]);
  testing.fireEvent.click(retainedCheckbox(form, 1));
  submitSelection(form);
  await testing.act(async () => { await Promise.resolve(); });
  expect(sentActions()).toEqual(before);
  expect(count('cancel')).toHaveLength(0);
  expect(count('revise')).toHaveLength(0);
  expect(count('confirm')).toHaveLength(0);
  expect(database.writes).toHaveLength(0);
  assertRealCards(entry);
  assertNoAdditionalModel();
});

it('requires explicit acknowledgement before cancelling an entirely excluded proposal and never requests replacements', async () => {
  planEvents = threeSameNameEvents();
  const { entry } = await initialPlan();
  const form = openSelection(), before = sentActions();
  for (const index of [0, 1, 2]) testing.fireEvent.click(retainedCheckbox(form, index));
  const acknowledgement = testing.within(form).getByRole('checkbox', { name: '我確認不建立任何項目，並撤銷整份待確認提議' });
  expect(acknowledgement.checked).toBe(false);
  submitSelection(form);
  await testing.act(async () => { await Promise.resolve(); });
  expect(sentActions()).toEqual(before);
  expect(count('cancel')).toHaveLength(0);
  testing.fireEvent.click(acknowledgement);
  testing.fireEvent.click(testing.within(form).getByRole('button', { name: '撤銷整份待確認提議' }));
  submitSelection(form);
  await testing.waitFor(() => expect(ui().getAllByText('已撤銷未執行提議')).toHaveLength(3));
  expect(count('cancel').map(request => request.body.token)).toEqual(entry.response.cards.map(card => card.token));
  expect(count('revise')).toHaveLength(0);
  expect(count('confirm')).toHaveLength(0);
  expect(uiCards()).toHaveLength(3);
  expect(database.writes).toHaveLength(0);
  await assertOriginalCannotExecute(entry);
  assertNoAdditionalModel();
});

it('withholds retained replacement cards while partial cancellation is unknown and resumes only after reconciliation', async () => {
  planEvents = threeSameNameEvents();
  const { entry } = await initialPlan();
  const form = openSelection();
  testing.fireEvent.click(retainedCheckbox(form, 1));
  fault.dropNextCancel = true;
  submitSelection(form);
  await testing.waitFor(() => expect(count('reconcile')).toHaveLength(1));
  await ui().findByRole('button', { name: '重新核對結果' });
  expect(count('cancel')[0].response.status).toBe('revoked');
  expect(count('reconcile')[0].status).toBe(503);
  submitSelection(form); submitSelection(form);
  await testing.act(async () => { await Promise.resolve(); });
  expect(count('cancel')).toHaveLength(1);
  expect(count('revise')).toHaveLength(0);
  expect(count('confirm')).toHaveLength(0);
  expect(uiCards()).toHaveLength(3);
  expect(database.writes).toHaveLength(0);
  assertNoAdditionalModel();
  fault.failLedger = false;
  testing.fireEvent.click(ui().getByRole('button', { name: '重新核對結果' }));
  await ui().findByText('已撤銷未執行提議');
  submitSelection(form);
  await testing.waitFor(() => expect(uiCards()).toHaveLength(5));
  expect(count('revise')).toHaveLength(1);
  expect(count('revise')[0].body.keepMutationIds).toEqual([entry.response.cards[0].mutationId, entry.response.cards[2].mutationId]);
  expect(count('revise')[0].response.cards.map(card => card.args)).toEqual([planEvents[0], planEvents[2]]);
  expect(count('cancel').map(request => request.body.token)).toEqual(entry.response.cards.map(card => card.token));
  expect(database.writes).toHaveLength(0);
  assertNoAdditionalModel();
});

it.each(['account', 'school'])('ignores retained cards from a held selection response after a %s switch', async target => {
  planEvents = threeSameNameEvents();
  const { view, entry } = await initialPlan();
  const originalContext = fixture.context, originalAccount = fixture.account, originalSchool = fixture.school;
  const form = openSelection();
  testing.fireEvent.click(retainedCheckbox(form, 1));
  fault.holdPrecise = true;
  submitSelection(form);
  await testing.waitFor(() => expect(fault.held).not.toBeNull());
  const held = fault.held;
  expect(held.entry.status).toBe(200);
  expect(held.entry.body.keepMutationIds).toEqual([entry.response.cards[0].mutationId, entry.response.cards[2].mutationId]);
  expect(held.entry.response.cards.map(card => card.args)).toEqual([planEvents[0], planEvents[2]]);
  assertRealCards(held.entry);
  if (target === 'account') useIdentity(registerIdentity('inprocess-subset-other-account-' + serial));
  else fixture.school = 'other-fixture-school';
  view.rerender(React.createElement(Assistant));
  await ui().findByLabelText('問題');
  expect(held.entry.signal.aborted).toBe(true);
  await testing.act(async () => { held.release(); await Promise.resolve(); });
  expect(ui().queryByRole('article', { name: '行程確認卡' })).toBeNull();
  expect(ui().queryByRole('region', { name: '行程選擇摘要' })).toBeNull();
  expect(ui().queryByRole('form', { name: '選擇待建立行程' })).toBeNull();
  expect(ui().getByRole('checkbox', { name: /^同意在本次對話/ }).checked).toBe(false);
  expect(held.entry.context).toBe(originalContext);
  expect(held.entry.account).toBe(originalAccount);
  expect(held.entry.body.schoolId).toBe(originalSchool);
  expect(count('revise')).toHaveLength(1);
  expect(count('confirm')).toHaveLength(0);
  expect(database.writes).toHaveLength(0);
  assertNoAdditionalModel();
});

it('does not claim whole-proposal cancellation when the real cancel receipt reveals an event already written elsewhere in the synthetic fixture', async () => {
  planEvents = threeSameNameEvents();
  const { entry } = await initialPlan();
  const first = entry.response.cards[0], identity = identitiesByContext.get(entry.context);
  // Authorized fixed-fixture boundary: another synthetic client confirms through
  // the real handler, leaving this Assistant's UI stale. No real account is used.
  const external = await handleV2(new NextRequest('http://localhost:3000/api/nuni/assistant/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3000',
      cookie: identity.cookie, 'X-Campus-Session': entry.context },
    body: JSON.stringify({ schoolId: entry.body.schoolId, conversationId: entry.body.conversationId,
      token: first.token, args: first.args }),
  }), 'confirm');
  expect(external.status).toBe(200);
  expect(await external.json()).toMatchObject({ status: 'verified', mutationId: first.mutationId });
  expect(database.writes).toHaveLength(1);
  const committed = database.snapshot();
  expect(committed.records.some(record => record.id === first.mutationId)).toBe(true);
  expect(ui().queryByText('已核對並加入個人行事曆')).toBeNull();
  const form = openSelection();
  for (const index of [0, 1, 2]) testing.fireEvent.click(retainedCheckbox(form, index));
  testing.fireEvent.click(testing.within(form).getByRole('checkbox', { name: '我確認不建立任何項目，並撤銷整份待確認提議' }));
  testing.fireEvent.click(testing.within(form).getByRole('button', { name: '撤銷整份待確認提議' }));
  await testing.waitFor(() => expect(testing.within(form).getByRole('alert').textContent).toContain('尚未全部確認撤銷'));
  expect(ui().getAllByText('已核對並加入個人行事曆')).toHaveLength(1);
  expect(ui().getAllByText('已撤銷未執行提議')).toHaveLength(2);
  expect(count('cancel').map(request => request.response.status)).toEqual(['verified', 'revoked', 'revoked']);
  expect(count('cancel').map(request => request.body.token)).toEqual(entry.response.cards.map(card => card.token));
  expect(testing.within(form).getByRole('alert').textContent).toContain('不會刪除已存在的行程');
  expect(ui().queryByText(/^整份待確認提議已確認撤銷/)).toBeNull();
  expect(ui().queryByRole('region', { name: '行程選擇摘要' })).toBeNull();
  expect(uiCards()).toHaveLength(3);
  expect(count('revise')).toHaveLength(0);
  expect(count('confirm')).toHaveLength(0); // The only confirmation was the explicit external fixture call above.
  expect(database.writes).toHaveLength(1);
  expect(database.writes[0].mutationId).toBe(first.mutationId);
  expect(database.snapshot()).toEqual(committed);
  assertNoAdditionalModel();
});

it('does not claim whole-proposal cancellation or request an empty plan while an all-excluded result remains unknown', async () => {
  planEvents = threeSameNameEvents();
  const { entry } = await initialPlan();
  const baseline = database.snapshot(), form = openSelection();
  for (const index of [0, 1, 2]) testing.fireEvent.click(retainedCheckbox(form, index));
  testing.fireEvent.click(testing.within(form).getByRole('checkbox', { name: '我確認不建立任何項目，並撤銷整份待確認提議' }));
  fault.dropNextCancel = true;
  testing.fireEvent.click(testing.within(form).getByRole('button', { name: '撤銷整份待確認提議' }));
  await testing.waitFor(() => expect(count('reconcile')).toHaveLength(1));
  await testing.waitFor(() => expect(testing.within(form).getByRole('alert').textContent).toContain('尚未全部確認撤銷'));
  expect(count('cancel')).toHaveLength(1);
  expect(count('cancel')[0]).toMatchObject({ body: { token: entry.response.cards[0].token }, response: { status: 'revoked' } });
  expect(count('reconcile')[0].status).toBe(503);
  expect(ui().getByRole('button', { name: '重新核對結果' })).toBeTruthy();
  expect(ui().queryByText(/^整份待確認提議已確認撤銷/)).toBeNull();
  expect(ui().queryByText('已撤銷未執行提議')).toBeNull();
  expect(ui().queryByRole('region', { name: '行程選擇摘要' })).toBeNull();
  expect(uiCards()).toHaveLength(3);
  const beforeRetry = sentActions();
  submitSelection(form); submitSelection(form);
  await testing.act(async () => { await Promise.resolve(); });
  expect(sentActions()).toEqual(beforeRetry);
  expect(count('cancel')).toHaveLength(1);
  expect(count('revise')).toHaveLength(0);
  expect(count('confirm')).toHaveLength(0);
  expect(database.writes).toHaveLength(0);
  expect(database.snapshot()).toEqual(baseline);
  assertNoAdditionalModel();
});
