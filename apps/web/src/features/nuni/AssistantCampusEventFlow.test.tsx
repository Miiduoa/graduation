import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { Assistant } from './Assistant';
import type { V2Card } from './assistant/types';
import type { AssistantCampusEventTarget } from '@/lib/assistantCampusEvent';

const auth = vi.hoisted(() => ({ context: 'a'.repeat(43), account: 'alice', school: 'pu', authenticated: true }));
vi.mock('./Session', () => ({
  browserRequest: vi.fn(),
  useNuniSession: () => ({ loading: false, error: '', pendingLogout: false,
    session: auth.authenticated ? { context: auth.context, platformAccountId: auth.account } : null }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: auth.school }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  let lock = Promise.resolve();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: (_key: string, action: () => unknown) => {
      const task = lock.then(action);
      lock = task.then(() => undefined, () => undefined);
      return task;
    },
  } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'locks');
  Object.assign(auth, { context: 'a'.repeat(43), account: 'alice', school: 'pu', authenticated: true });
});

const target = (id: string, title: string): AssistantCampusEventTarget => ({
  schoolId: 'pu', source: 'school-club-events', id, title,
  startsAt: '2030-11-16T06:00:00.000Z', endsAt: '2030-11-16T08:00:00.000Z',
  checkedAt: '2026-11-16T06:00:00.000Z', location: '活動中心',
  href: `/events/${id}?schoolId=pu&source=school-club-events`,
});
const targets = [target('photo', '校園攝影講座'), target('music', '校園音樂工作坊')];
const cardFor = (item = targets[1]): V2Card => ({
  tool: 'propose_personal_event', token: 'signed-source-event', mutationId: 'av2_' + 'e'.repeat(32),
  schoolId: 'pu', destination: '個人行事曆（無推播提醒）',
  args: { title: item.title, date: '2030-11-16', allDay: false, startTime: '14:00', endTime: '16:00' },
});
const original = (): V2Card => ({ ...cardFor(), token: 'original-study-token', mutationId: 'av2_' + 'a'.repeat(32),
  args: { title: '原本已備妥的讀書安排', date: '2030-11-17', allDay: false, startTime: '20:00', endTime: '20:30' } });
const json = (value: object, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
function previewReply(item = targets[1]) {
  return { version: 2, campusEventPreview: true, dataRead: true, modelCalls: 0,
    answer: '活動已重新核對，確認後才會加入個人行事曆。',
    steps: [{ name: 'get_campus_event', status: 'ok', summary: '已重新核對所選活動' }],
    cards: [cardFor(item)], eventTargets: [item] };
}
function receipt(card: V2Card) {
  return createAssistantCalendarReceipt({ schoolId: card.schoolId, mutationId: card.mutationId, event: card.args,
    storage: 'synced', verifiedAt: '2026-11-16T06:01:00.000Z', revision: 1, replay: false,
    record: { ...card.args, id: card.mutationId, batchId: card.mutationId, kind: 'events', schoolId: card.schoolId,
      academicYear: '', semester: '', importedAt: '2026-11-16T06:00:00.000Z',
      source: { type: 'paste', name: '助理確認', line: 1, rawText: '' } },
  });
}
function checked(card: V2Card, status: 'revoked' | 'conflict') {
  return { version: 1, operation: 'calendar.create', status, schoolId: card.schoolId, mutationId: card.mutationId,
    storage: 'synced', checkedAt: '2026-11-16T06:01:00.000Z', revision: 0,
    authorizationValid: false, retryable: false, ...(status === 'revoked' ? { alreadyRevoked: false } : {}) };
}
type Request = { action: string; body: Record<string, unknown>; signal?: AbortSignal };
function mockServer(options: {
  initialCards?: V2Card[];
  override?: (request: Request) => Response | Promise<Response> | undefined;
} = {}) {
  const requests: Request[] = [];
  let asks = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ version: 2, enabled: true, ready: true });
    const request = { action: url.split('/').at(-1)!, body: JSON.parse(String(init?.body)), signal: init?.signal as AbortSignal };
    requests.push(request);
    const override = options.override?.(request);
    if (override) return override;
    const { action, body } = request;
    if (action === 'ask' && !body.routeToken)
      return json({ bootstrap: true, conversationId: 'main-conversation', routeToken: 'main-route' });
    if (action === 'ask') return json(++asks === 1 ? {
      version: 2, answer: '已核對這次活動清單。', steps: [], cards: options.initialCards ?? [], eventTargets: targets,
    } : { version: 2, answer: '一般服務介紹。', steps: [], cards: [] });
    if (action === 'event-preview' && !body.routeToken)
      return json({ bootstrap: true, conversationId: 'event-conversation', routeToken: 'event-route' });
    if (action === 'event-preview') {
      const identity = body.event as { id: string };
      return json(previewReply(targets.find(item => item.id === identity.id)));
    }
    const card = body.token === 'original-study-token' ? original() : cardFor();
    if (action === 'confirm' || action === 'reconcile') return json(receipt(card));
    if (action === 'cancel') return json(checked(card, 'revoked'));
    throw new Error('Unexpected action ' + action);
  }));
  return requests;
}
async function readEvents() {
  const question = await screen.findByLabelText('問題');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(question, { target: { value: '查校園公告，查近期活動，查公車' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByRole('button', { name: '將校園音樂工作坊加入個人行事曆' });
  return question;
}
const selectEvent = () => fireEvent.click(screen.getByRole('button', { name: '將校園音樂工作坊加入個人行事曆' }));

it('previews only the selected event in an independent conversation, then confirms with its original card', async () => {
  const requests = mockServer();
  render(<Assistant />);
  const question = await readEvents();
  expect(requests.filter(request => request.action === 'event-preview')).toHaveLength(0);
  fireEvent.click(screen.getByRole('checkbox')); // Deterministic preparation does not require model consent.
  selectEvent(); selectEvent();
  const confirm = await screen.findByRole('button', { name: '確認' });
  expect(screen.queryByText('已核對並加入個人行事曆')).toBeNull();
  expect(screen.queryByRole('button', { name: '修改時間或條件' })).toBeNull();
  expect(screen.queryByRole('button', { name: /調整.*時間/ })).toBeNull();
  const previews = requests.filter(request => request.action === 'event-preview');
  expect(previews).toHaveLength(2);
  expect(previews[0].body).toEqual({ schoolId: 'pu', conversationId: expect.any(String),
    event: { schoolId: 'pu', source: 'school-club-events', id: 'music' } });
  expect(previews[0].body.conversationId).not.toBe('main-conversation');
  expect(previews[1].body).toEqual({ schoolId: 'pu', conversationId: 'event-conversation', routeToken: 'event-route',
    event: { schoolId: 'pu', source: 'school-club-events', id: 'music' } });
  expect(JSON.stringify(previews)).not.toMatch(/history|consent|校園音樂工作坊|startsAt|signed-source-event/);
  expect(requests.some(request => request.action === 'confirm')).toBe(false);
  fireEvent.click(confirm);
  await screen.findByText('已核對並加入個人行事曆');
  expect(requests.find(request => request.action === 'confirm')?.body).toEqual({ schoolId: 'pu',
    conversationId: 'event-conversation', token: cardFor().token, args: cardFor().args });
  fireEvent.click(screen.getByRole('button', { name: '重新核對結果' }));
  await waitFor(() => expect(requests.filter(request => request.action === 'reconcile')).toHaveLength(1));
  expect(requests.at(-1)?.body.conversationId).toBe('event-conversation');
  await waitFor(() => expect((screen.getByRole('button', { name: '重新核對結果' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(question, { target: { value: '幫我簡單介紹校園服務' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByText('一般服務介紹。');
  expect(requests.at(-1)?.body).toMatchObject({ conversationId: 'main-conversation', routeToken: 'main-route', history: [] });
  expect(JSON.stringify(requests.at(-1)?.body)).not.toMatch(/校園音樂工作坊|校園攝影講座|signed-source-event|event-route/);
});

it.each(['calendar', 'food'] as const)('protects an untouched %s card before event bootstrap and keeps the original confirmation', async kind => {
  const originalCard = kind === 'calendar' ? original() : { ...original(), tool: 'propose_food_order',
    args: { mode: 'page', reason: '先核對原點餐內容', href: '/cafeteria?schoolId=pu' } };
  const requests = mockServer({ initialCards: [originalCard] });
  render(<Assistant />);
  await readEvents();
  const select = screen.getByRole('button', { name: '將校園音樂工作坊加入個人行事曆' });
  expect((select as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/原確認卡會保留，不會被活動預覽取代/)).toBeTruthy();
  fireEvent.click(select);
  expect(requests.map(request => request.action)).toEqual(['ask', 'ask']);
  expect(screen.queryByText('已被新提議取代')).toBeNull();
  expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
});

it('allows a separate event preview only after explicit cancellation, preserving the cancelled card', async () => {
  const requests = mockServer({ initialCards: [original()] });
  render(<Assistant />);
  await readEvents();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await screen.findByText('已撤銷未執行提議');
  selectEvent();
  await screen.findByRole('region', { name: '活動來源行程' });
  expect(screen.getByText('已撤銷未執行提議')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: '確認' })).toHaveLength(1);
  expect(screen.queryByText('已被新提議取代')).toBeNull();
  expect(requests.find(request => request.action === 'cancel')?.body.conversationId).toBe('main-conversation');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.getAllByText('已撤銷未執行提議')).toHaveLength(2));
  expect(requests.filter(request => request.action === 'cancel').at(-1)?.body.conversationId).toBe('event-conversation');
});

it.each(['confirm', 'cancel'] as const)('preserves an independent pending event when ordinary chat issues another card, then uses its route to %s', async action => {
  let firstRead = true;
  const requests = mockServer({ override: request => {
    if (request.action === 'ask' && request.body.routeToken) {
      if (firstRead) { firstRead = false; return; }
      return json({ version: 2, answer: '普通對話準備了另一筆安排。', steps: [], cards: [original()] });
    }
  } });
  render(<Assistant />);
  const question = await readEvents();
  selectEvent();
  await screen.findByRole('region', { name: '活動來源行程' });
  fireEvent.change(question, { target: { value: '幫我另外安排讀書計畫' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByText('普通對話準備了另一筆安排。');
  const cards = screen.getAllByRole('article', { name: '行程確認卡' });
  expect(cards).toHaveLength(2);
  const eventCard = cards.find(card => within(card).queryByRole('heading', { name: targets[1].title }))!;
  const mainCard = cards.find(card => within(card).queryByRole('heading', { name: '原本已備妥的讀書安排' }))!;
  expect((within(eventCard).getByRole('button', { name: '確認' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText('已被新提議取代')).toBeNull();
  expect(requests.filter(request => request.action === 'ask').at(-1)?.body)
    .toMatchObject({ conversationId: 'main-conversation', routeToken: 'main-route', history: [] });
  fireEvent.click(within(eventCard).getByRole('button', { name: action === 'confirm' ? '確認' : '取消' }));
  await within(eventCard).findByText(action === 'confirm' ? '已核對並加入個人行事曆' : '已撤銷未執行提議');
  expect(requests.filter(request => request.action === action).at(-1)?.body.conversationId).toBe('event-conversation');
  await waitFor(() => expect((within(mainCard).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(within(mainCard).getByRole('button', { name: '取消' }));
  await within(mainCard).findByText('已撤銷未執行提議');
  expect(requests.filter(request => request.action === 'cancel').at(-1)?.body.conversationId).toBe('main-conversation');
});

it('keeps event preparation blocked after a local confirmation preflight fails', async () => {
  const requests = mockServer({ initialCards: [original()] });
  render(<Assistant />);
  await readEvents();
  Reflect.deleteProperty(navigator, 'locks');
  fireEvent.click(screen.getByRole('button', { name: '確認' }));
  await screen.findByRole('button', { name: '重試原確認' });
  const select = screen.getByRole('button', { name: '將校園音樂工作坊加入個人行事曆' });
  expect((select as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(select);
  expect(requests.some(request => ['event-preview', 'confirm'].includes(request.action))).toBe(false);
});

it('checks preview contents against the freshly read source instead of copying stale display hints', async () => {
  const fresh = { ...targets[1], title: '音樂工作坊：更新時段', startsAt: '2030-11-16T07:00:00.000Z',
    endsAt: '2030-11-16T09:00:00.000Z', checkedAt: '2026-11-16T06:01:00.000Z' };
  const reply = previewReply(fresh);
  reply.cards[0].args.startTime = '15:00';
  reply.cards[0].args.endTime = '17:00';
  mockServer({ override: request => request.action === 'event-preview' && request.body.routeToken ? json(reply) : undefined });
  render(<Assistant />);
  await readEvents();
  selectEvent();
  const card = await screen.findByRole('article', { name: '行程確認卡' });
  expect(within(card).getByRole('heading', { name: fresh.title })).toBeTruthy();
  expect(within(card).getByText(/15:00.*17:00/)).toBeTruthy();
  expect(screen.queryByText('已核對並加入個人行事曆')).toBeNull();
});

it.each(['unknown', 'conflict'] as const)('keeps event preparation blocked while the original execution is %s', async state => {
  const requests = mockServer({ initialCards: [original()], override: request => {
    if (request.action === 'confirm') return json({ error: 'UPSTREAM_UNAVAILABLE' }, 503);
    if (request.action === 'reconcile') return state === 'unknown'
      ? json({ error: 'UPSTREAM_UNAVAILABLE' }, 503) : json(checked(original(), 'conflict'));
  } });
  render(<Assistant />);
  await readEvents();
  fireEvent.click(screen.getByRole('button', { name: '確認' }));
  await screen.findByRole('button', { name: '重新核對結果' });
  const select = screen.getByRole('button', { name: '將校園音樂工作坊加入個人行事曆' });
  expect((select as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(select);
  expect(requests.filter(request => request.action === 'event-preview')).toHaveLength(0);
  expect(screen.queryByText('已核對並加入個人行事曆')).toBeNull();
});

it.each(['school', 'account', 'logout', 'stop'] as const)('aborts event preparation and discards late cards on %s', async change => {
  let finish!: (response: Response) => void;
  let pendingSignal: AbortSignal | undefined;
  const requests = mockServer({ override: request => {
    if (request.action === 'event-preview' && request.body.routeToken) {
      pendingSignal = request.signal;
      return new Promise<Response>(resolve => { finish = resolve; });
    }
  } });
  const view = render(<Assistant />);
  await readEvents();
  selectEvent();
  await waitFor(() => expect(pendingSignal).toBeDefined());
  if (change === 'stop') fireEvent.click(screen.getByRole('button', { name: '停止這次回答' }));
  else {
    if (change === 'school') auth.school = 'nthu';
    if (change === 'account') { auth.account = 'bob'; auth.context = 'b'.repeat(43); }
    if (change === 'logout') auth.authenticated = false;
    view.rerender(<Assistant />);
  }
  expect(pendingSignal?.aborted).toBe(true);
  await act(async () => finish(json(previewReply())));
  expect(screen.queryByRole('region', { name: '活動來源行程' })).toBeNull();
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  expect(requests.some(request => ['confirm', 'cancel', 'reconcile'].includes(request.action))).toBe(false);
  if (change === 'stop') expect(screen.getByRole('alert').textContent).toContain('已停止這次活動預覽');
});

it('stops a late event bootstrap without sending the second preparation request', async () => {
  let finish!: (response: Response) => void;
  const requests = mockServer({ override: request => request.action === 'event-preview'
    ? new Promise<Response>(resolve => { finish = resolve; }) : undefined });
  render(<Assistant />);
  await readEvents();
  selectEvent();
  await waitFor(() => expect(requests.filter(request => request.action === 'event-preview')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: '停止這次回答' }));
  await act(async () => finish(json({ bootstrap: true, conversationId: 'event-conversation', routeToken: 'event-route' })));
  expect(requests.filter(request => request.action === 'event-preview')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
});

it.each(['foreign-school', 'wrong-source', 'wrong-time', 'extra-card', 'missing-marker'] as const)('rejects an inconsistent event-preview response: %s', async problem => {
  const reply = previewReply();
  if (problem === 'foreign-school') reply.cards[0].schoolId = 'nthu';
  if (problem === 'wrong-source') reply.eventTargets = [targets[0]];
  if (problem === 'wrong-time') reply.cards[0].args.startTime = '15:00';
  if (problem === 'extra-card') reply.cards.push({ ...cardFor(), tool: 'propose_food_order' });
  if (problem === 'missing-marker') reply.campusEventPreview = false;
  const requests = mockServer({ override: request => request.action === 'event-preview' && request.body.routeToken ? json(reply) : undefined });
  render(<Assistant />);
  await readEvents();
  selectEvent();
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  expect(screen.queryByRole('region', { name: '活動來源行程' })).toBeNull();
  expect(requests.some(request => request.action === 'confirm')).toBe(false);
});

it('shows a source conflict as an uncreated preview, without a fake success or replacement card', async () => {
  mockServer({ override: request => request.action === 'event-preview' && request.body.routeToken
    ? json({ ...previewReply(), answer: '這段時間與既有行程重疊，尚未加入。', cards: [] }) : undefined });
  render(<Assistant />);
  await readEvents();
  selectEvent();
  await screen.findByText('這段時間與既有行程重疊，尚未加入。');
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  expect(screen.queryByText('已核對並加入個人行事曆')).toBeNull();
  expect(within(screen.getByRole('region', { name: '活動來源行程' })).getByRole('link', { name: '重新查看活動來源' })).toBeTruthy();
});
