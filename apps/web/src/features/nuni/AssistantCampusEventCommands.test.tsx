import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { Assistant } from './Assistant';
import type { V2Card } from './assistant/types';
import type { AssistantCampusEventTarget } from '@/lib/assistantCampusEvent';

const auth = vi.hoisted(() => ({ context: 'a'.repeat(43), account: 'alice', school: 'pu', authenticated: true }));
vi.mock('./Session', () => ({ browserRequest: vi.fn(),
  useNuniSession: () => ({ loading: false, error: '', pendingLogout: false,
    session: auth.authenticated ? { context: auth.context, platformAccountId: auth.account } : null }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/useCampusBrowseContext', () => ({ useCampusBrowseContext: () => ({ status: 'ready', schoolId: auth.school }) }));
vi.mock('@/components/SiteShell', () => ({ SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); Element.prototype.scrollIntoView = vi.fn();
  let lock = Promise.resolve();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_key: string, action: () => unknown) => {
    const task = lock.then(action); lock = task.then(() => undefined, () => undefined); return task;
  } } });
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks(); Reflect.deleteProperty(navigator, 'locks');
  Object.assign(auth, { context: 'a'.repeat(43), account: 'alice', school: 'pu', authenticated: true });
});
const targets: AssistantCampusEventTarget[] = Array.from({ length: 5 }, (_, index) => ({
  schoolId: 'pu', source: 'school-club-events', id: `activity-${index + 1}`, title: `來源活動 ${index + 1}`,
  startsAt: '2030-11-16T06:00:00.000Z', endsAt: '2030-11-16T08:00:00.000Z',
  checkedAt: '2026-11-16T06:00:00.000Z', location: '活動中心',
  href: `/events/activity-${index + 1}?schoolId=pu&source=school-club-events`,
}));
const cardFor = (target = targets[1]): V2Card => ({ tool: 'propose_personal_event', token: 'signed-event',
  mutationId: 'av2_' + 'e'.repeat(32), schoolId: 'pu', destination: '個人行事曆（無推播提醒）',
  args: { title: target.title, date: '2030-11-16', allDay: false, startTime: '14:00', endTime: '16:00' },
});
const original = (): V2Card => ({ ...cardFor(), token: 'original-token', mutationId: 'av2_' + 'a'.repeat(32),
  args: { title: '保留原本的讀書安排', date: '2030-11-17', allDay: false, startTime: '20:00', endTime: '20:30' } });
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const listReply = (eventTargets: unknown = targets) => ({ version: 2, answer: '本次清單有五筆，摘要只展開前三筆。', steps: [], cards: [], dataRead: true, eventTargets });
const previewReply = (target = targets[1]) => ({ version: 2, campusEventPreview: true, dataRead: true,
  answer: '已重新核對選定的活動，等待確認。', steps: [], cards: [cardFor(target)], eventTargets: [target] });
type Request = { action: string; body: Record<string, unknown>; signal?: AbortSignal };
function mockServer(options: { ready?: boolean; asks?: object[]; override?: (request: Request) => Response | Promise<Response> | undefined } = {}) {
  const requests: Request[] = []; let asks = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ version: 2, enabled: true, ready: options.ready !== false });
    const request: Request = { action: url.split('/').at(-1)!, body: JSON.parse(String(init?.body)), signal: init?.signal as AbortSignal };
    requests.push(request); const overridden = options.override?.(request); if (overridden) return overridden;
    const { action, body } = request;
    if (action === 'ask' && !body.routeToken) return json({ bootstrap: true, conversationId: 'main-conversation', routeToken: 'main-route' });
    if (action === 'ask') return json(options.asks?.[asks++] ?? listReply());
    if (action === 'event-preview' && !body.routeToken) return json({ bootstrap: true, conversationId: 'event-conversation', routeToken: 'event-route' });
    if (action === 'event-preview') {
      const event = body.event as { id: string } | undefined, discovery = body.discovery as { index: number } | undefined;
      return json(previewReply(event ? targets.find(target => target.id === event.id) : targets[(discovery?.index ?? 1) - 1]));
    }
    if (action === 'confirm') {
      const card = cardFor(targets.find(target => target.title === (body.args as Record<string, unknown>).title));
      return json(createAssistantCalendarReceipt({ schoolId: 'pu', mutationId: card.mutationId, event: card.args,
        storage: 'synced', verifiedAt: '2026-11-16T06:01:00.000Z', revision: 1, replay: false,
        record: { ...card.args, id: card.mutationId, batchId: card.mutationId, kind: 'events', schoolId: 'pu',
          academicYear: '', semester: '', importedAt: '2026-11-16T06:00:00.000Z',
          source: { type: 'paste', name: '助理確認', line: 1, rawText: '' } } }));
    }
    if (action === 'cancel') return json({ version: 1, operation: 'calendar.create', status: 'revoked', schoolId: 'pu',
      mutationId: body.token === 'original-token' ? original().mutationId : cardFor().mutationId,
      storage: 'synced', checkedAt: '2026-11-16T06:01:00.000Z', revision: 0,
      authorizationValid: false, retryable: false, alreadyRevoked: false });
    throw new Error('Unexpected action ' + action);
  }));
  return requests;
}
async function submit(question: string) {
  const input = await screen.findByLabelText('問題'); fireEvent.change(input, { target: { value: question } });
  await waitFor(() => expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '送出' })); return input;
}
async function readEvents() {
  await screen.findByLabelText('問題'); fireEvent.click(screen.getByRole('checkbox')); await submit('查近期活動');
  await screen.findByRole('button', { name: '將來源活動 5加入個人行事曆' });
}
it('discovers the requested ordinal without a model or consent, then waits for explicit confirmation', async () => {
  const requests = mockServer({ ready: false }); render(<Assistant />);
  const prompt = '查近期活動，並把第二個加入行事曆'; await submit(prompt);
  const card = await screen.findByRole('article', { name: '行程確認卡' });
  expect(within(card).getByRole('heading', { name: targets[1].title })).toBeTruthy(); expect(screen.getByText(prompt)).toBeTruthy();
  expect(requests.map(request => request.action)).toEqual(['event-preview', 'event-preview']);
  expect(requests[0].body).toEqual({ schoolId: 'pu', conversationId: expect.any(String), discovery: { index: 2 } });
  expect(requests[1].body).toEqual({ schoolId: 'pu', conversationId: 'event-conversation', routeToken: 'event-route', discovery: { index: 2 } });
  expect(JSON.stringify(requests)).not.toMatch(/history|consent|startsAt|來源活動/);
  expect(screen.queryByText('已核對並加入個人行事曆')).toBeNull(); fireEvent.click(within(card).getByRole('button', { name: '確認' }));
  await screen.findByText('已核對並加入個人行事曆'); expect(requests.filter(request => request.action === 'confirm')).toHaveLength(1);
  expect(requests.at(-1)?.body.conversationId).toBe('event-conversation');
});
it('selects the fifth visible row instead of the three-item excerpt and leaves the main route intact', async () => {
  const requests = mockServer({ asks: [listReply(), { version: 2, answer: '普通問答完成。', steps: [], cards: [] }] });
  render(<Assistant />); await readEvents(); fireEvent.click(screen.getByRole('checkbox')); await submit('把第五個加入行程');
  const card = await screen.findByRole('article', { name: '行程確認卡' });
  expect(within(card).getByRole('heading', { name: targets[4].title })).toBeTruthy();
  const preparations = requests.filter(request => request.action === 'event-preview'); expect(preparations).toHaveLength(2);
  expect(preparations[1].body.event).toEqual({ schoolId: 'pu', source: 'school-club-events', id: targets[4].id });
  expect(requests.filter(request => request.action === 'ask')).toHaveLength(2);
  fireEvent.click(screen.getByRole('checkbox')); await submit('幫我介紹校園服務'); await screen.findByText('普通問答完成。');
  expect(requests.at(-1)?.body).toMatchObject({ conversationId: 'main-conversation', routeToken: 'main-route', history: [] });
  expect((within(card).getByRole('button', { name: '確認' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText('已被新提議取代')).toBeNull();
});
it('keeps ambiguous references as choices rather than choosing the first row', async () => {
  const requests = mockServer(); render(<Assistant />); await readEvents(); fireEvent.click(screen.getByRole('checkbox'));
  await submit('把上面那個活動加入行事曆'); await screen.findByText(/目前有多筆可能的活動/);
  expect(requests.some(request => request.action === 'event-preview')).toBe(false);
  const lists = screen.getAllByRole('region', { name: '選擇活動加入行事曆' }); expect(within(lists.at(-1)!).getAllByRole('button')).toHaveLength(5);
  await submit('把第二筆活動加入行程'); const card = await screen.findByRole('article', { name: '行程確認卡' });
  expect(within(card).getByRole('heading', { name: targets[1].title })).toBeTruthy();
});
it.each(['empty', 'malformed'] as const)('does not resurrect an old list after a newer %s result', async kind => {
  const newer = { ...listReply(kind === 'empty' ? [] : [{ ...targets[0], schoolId: 'nthu' }]), answer: '最新查詢沒有可選的完整活動。' };
  const requests = mockServer({ asks: [listReply(), newer] }); render(<Assistant />); await readEvents();
  await submit('再查近期活動'); await screen.findByText(newer.answer); fireEvent.click(screen.getByRole('checkbox'));
  await submit('把第二個活動加入行程'); await screen.findByText(/目前沒有可承接的活動清單/);
  expect(requests.some(request => request.action === 'event-preview')).toBe(false);
});
it.each([false, true])('does not carry an unqualified ordinal across other topics, explicit: %s', async explicit => {
  const requests = mockServer({ asks: [listReply(), { version: 2, answer: '另一個話題的回答。', steps: [], cards: [] }] });
  render(<Assistant />); await readEvents(); await submit('介紹校園服務'); await screen.findByText('另一個話題的回答。');
  fireEvent.click(screen.getByRole('checkbox')); await submit(explicit ? '把第二個活動加入行程' : '把第二個加入行程');
  if (explicit) expect(within(await screen.findByRole('article', { name: '行程確認卡' })).getByRole('heading', { name: targets[1].title })).toBeTruthy();
  else { await screen.findByText(/目前沒有可承接的活動清單/); expect(requests.some(request => request.action === 'event-preview')).toBe(false); }
});
it.each(['把第二個加入行程', '查近期活動並把第一個加入行程'])('preserves pending cards and the typed request: %s', async prompt => {
  const requests = mockServer({ asks: [{ ...listReply(), cards: [original()] }] }); render(<Assistant />); await readEvents();
  fireEvent.click(screen.getByRole('checkbox')); const input = await submit(prompt); await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('原確認卡會保留'); expect((input as HTMLTextAreaElement).value).toBe(prompt);
  expect(requests.some(request => request.action === 'event-preview')).toBe(false);
  const card = screen.getByRole('article', { name: '行程確認卡' });
  expect(within(card).getByRole('heading', { name: original().args.title as string })).toBeTruthy();
  expect((within(card).getByRole('button', { name: '確認' }) as HTMLButtonElement).disabled).toBe(false);
});
it('turns incomplete discovery into choices and allows selecting the exact second source', async () => {
  const requests = mockServer({ ready: false, override: request => request.action === 'event-preview' && request.body.routeToken && request.body.discovery
    ? json({ ...listReply(), campusEventPreview: false, answer: '來源尚未完整，請選擇一筆活動。' }) : undefined });
  render(<Assistant />); await submit('查近期活動並把第二個加入行程'); await screen.findByText('來源尚未完整，請選擇一筆活動。');
  expect(screen.queryByRole('article', { name: '行程確認卡' })).toBeNull(); await submit('把第二個加入行程');
  expect(within(await screen.findByRole('article', { name: '行程確認卡' })).getByRole('heading', { name: targets[1].title })).toBeTruthy();
  expect(requests.at(-1)?.body.event).toEqual({ schoolId: 'pu', source: 'school-club-events', id: targets[1].id });
});
it('does not use the single source of a completed preview as a new activity list', async () => {
  const requests = mockServer({ ready: false }); render(<Assistant />);
  await submit('查近期活動並把第二個加入行程');
  const card = await screen.findByRole('article', { name: '行程確認卡' });
  fireEvent.click(within(card).getByRole('button', { name: '取消' }));
  await within(card).findByText('已撤銷未執行提議');
  await submit('把第一個活動加入行程');
  await screen.findByText(/目前沒有可承接的活動清單/);
  expect(requests.filter(request => request.action === 'event-preview')).toHaveLength(2);
  expect(screen.getAllByRole('article', { name: '行程確認卡' })).toHaveLength(1);
});
it.each([
  ['success', false], ['success', true], ['unavailable', false], ['unavailable', true],
] as const)('does not cross a fresh %s discovery to an older activity list, explicit reference: %s', async (outcome, explicit) => {
  const fresh = { ...targets[1], id: 'new-list-event-2', title: '新清單的第二場活動',
    href: '/events/new-list-event-2?schoolId=pu&source=school-club-events' };
  const requests = mockServer({ override: request => {
    if (request.action === 'event-preview' && request.body.routeToken && request.body.discovery)
      return json({ ...previewReply(fresh), campusEventDiscovery: false,
        ...(outcome === 'unavailable' ? { cards: [], eventTargets: [], answer: '新查詢的活動來源暫時無法核對。' } : {}) });
  } });
  render(<Assistant />); await readEvents(); fireEvent.click(screen.getByRole('checkbox'));
  await submit('查近期活動並把第二個加入行程');
  if (outcome === 'success') {
    const card = await screen.findByRole('article', { name: '行程確認卡' });
    expect(within(card).getByRole('heading', { name: fresh.title })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: '取消' }));
    await within(card).findByText('已撤銷未執行提議');
  } else await screen.findByText('新查詢的活動來源暫時無法核對。');
  await submit(explicit ? '把第一個活動加入行程' : '把第一個加入行程');
  await screen.findByText(/目前沒有可承接的活動清單/);
  const previews = requests.filter(request => request.action === 'event-preview');
  expect(previews).toHaveLength(2);
  expect(previews.every(request => request.body.event === undefined)).toBe(true);
  expect(requests.filter(request => request.action === 'ask')).toHaveLength(2);
  expect(screen.getAllByRole('region', { name: '選擇活動加入行事曆' })).toHaveLength(1);
});
it('keeps original visible ordering after an exact preview, ignoring server discovery flags', async () => {
  let preparations = 0;
  const requests = mockServer({ override: request => {
    if (request.action === 'event-preview' && request.body.routeToken) {
      preparations++;
      const source = targets.find(target => target.id === (request.body.event as { id: string }).id)!;
      return json({ ...previewReply(source), campusEventDiscovery: true,
        ...(preparations === 2 ? { cards: [{ ...cardFor(source), mutationId: 'av2_' + 'f'.repeat(32) }] } : {}) });
    }
  } });
  render(<Assistant />); await readEvents(); fireEvent.click(screen.getByRole('checkbox'));
  await submit('把第二個加入行程');
  const card = await screen.findByRole('article', { name: '行程確認卡' });
  fireEvent.click(within(card).getByRole('button', { name: '取消' }));
  await within(card).findByText('已撤銷未執行提議');
  await submit('把第三個加入行程');
  await waitFor(() => expect(screen.getAllByRole('article', { name: '行程確認卡' })).toHaveLength(2));
  expect(within(screen.getAllByRole('article', { name: '行程確認卡' })[1]).getByRole('heading', { name: targets[2].title })).toBeTruthy();
  expect(requests.at(-1)?.body.event).toEqual({ schoolId: 'pu', source: 'school-club-events', id: targets[2].id });
});
it.each(['school', 'account', 'logout', 'stop'] as const)('discards a late discovery on %s and preserves a stopped question', async change => {
  let finish!: (response: Response) => void, signal: AbortSignal | undefined;
  const requests = mockServer({ ready: false, override: request => {
    if (request.action === 'event-preview' && request.body.routeToken) { signal = request.signal; return new Promise<Response>(resolve => { finish = resolve; }); }
  } });
  const view = render(<Assistant />), prompt = '查近期活動並把第二個加入行程'; await submit(prompt); await waitFor(() => expect(signal).toBeDefined());
  if (change === 'stop') { fireEvent.change(screen.getByLabelText('問題'), { target: { value: '接著想問的新問題' } }); fireEvent.click(screen.getByRole('button', { name: '停止這次回答' })); }
  else { if (change === 'school') auth.school = 'nthu'; if (change === 'account') { auth.account = 'bob'; auth.context = 'b'.repeat(43); }
    if (change === 'logout') auth.authenticated = false; view.rerender(<Assistant />); }
  expect(signal?.aborted).toBe(true); await act(async () => finish(json(previewReply())));
  expect(screen.queryByRole('article', { name: '行程確認卡' })).toBeNull(); expect(requests.some(request => ['confirm', 'cancel', 'reconcile'].includes(request.action))).toBe(false);
  if (change === 'stop') {
    expect(within(screen.getByRole('group', { name: '未完成的問題' })).getByText(prompt)).toBeTruthy();
    expect((screen.getByLabelText('問題') as HTMLTextAreaElement).value).toBe('接著想問的新問題');
    fireEvent.click(screen.getByRole('button', { name: '切換到這個問題' })); expect((screen.getByLabelText('問題') as HTMLTextAreaElement).value).toBe(prompt);
    expect(within(screen.getByRole('group', { name: '未完成的問題' })).getByText('接著想問的新問題')).toBeTruthy();
  }
});
it.each(['unmarked-list', 'foreign-source', 'list-with-card', 'mismatched-time'] as const)('rejects an invalid discovery response: %s', async problem => {
  const reply = problem === 'unmarked-list' ? { ...listReply() }
    : problem === 'foreign-source' ? { ...previewReply(), eventTargets: [{ ...targets[1], schoolId: 'nthu' }] }
    : problem === 'list-with-card' ? { ...previewReply(), campusEventPreview: false }
    : { ...previewReply(), cards: [{ ...cardFor(), args: { ...cardFor().args, startTime: '15:00' } }] };
  const requests = mockServer({ ready: false, override: request => request.action === 'event-preview' && request.body.routeToken ? json(reply) : undefined });
  render(<Assistant />); await submit('查近期活動並把第二個加入行程'); await screen.findByRole('alert');
  expect(screen.queryByRole('article', { name: '行程確認卡' })).toBeNull(); expect(screen.getByRole('group', { name: '未完成的問題' })).toBeTruthy();
  expect(requests.some(request => request.action === 'confirm')).toBe(false);
});
