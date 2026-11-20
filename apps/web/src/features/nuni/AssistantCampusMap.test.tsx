import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { AssistantTaskStep } from '@campus/shared/src/assistantTaskPlan';
import { Assistant } from './Assistant';
import type { V2Card } from './assistant/types';

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
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  Object.assign(auth, { context: 'a'.repeat(43), account: 'alice', school: 'pu', authenticated: true });
});
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const mapHref = '/map?schoolId=pu&query=%E4%BB%BB%E5%9E%A3%E6%A8%93&focus=renyuan';
const mapStep = (partial = false): AssistantTaskStep => ({ id: 'map', label: '查校園地點', serviceId: 'map', dependsOn: [],
  status: partial ? 'partial' : 'completed', summary: partial ? '目前只有部分地點，尚不能確認唯一位置。' : '任垣樓的位置已核對，座標與來源如下。', href: mapHref });
const mapReply = (partial = false) => ({ version: 2, dataRead: true, modelCalls: 0, answer: '地點查詢完成。',
  cards: [], steps: [{ name: 'get_campus_map', status: 'ok', summary: '已核對地點來源' }],
  taskPlan: { version: 1, steps: [mapStep(partial)] },
  ...(partial ? { taskRetry: { version: 1, token: 'map_query.' + 'A'.repeat(43), stepIds: ['map'], expiresAt: Date.now() + 60_000 } } : {}),
});
const oldCard: V2Card = { tool: 'propose_personal_event', token: 'old-card', mutationId: 'av2_' + 'a'.repeat(32),
  schoolId: 'pu', destination: '個人行事曆',
  args: { title: '原先待確認的讀書安排', date: '2030-11-17', allDay: false, startTime: '20:00', endTime: '20:30' } };
type Request = { action: string; body: Record<string, unknown>; signal?: AbortSignal };
function mockServer(options: { ready?: boolean; asks?: object[]; override?: (request: Request) => Response | Promise<Response> | undefined } = {}) {
  const requests: Request[] = []; let asks = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ version: 2, enabled: true, ready: options.ready === true });
    const request: Request = { action: url.split('/').at(-1)!, body: JSON.parse(String(init?.body)), signal: init?.signal as AbortSignal };
    requests.push(request);
    const override = options.override?.(request); if (override) return override;
    if (request.action === 'map-read') return json(mapReply());
    if (request.action === 'retry') return json(mapReply());
    if (request.action === 'ask' && !request.body.routeToken)
      return json({ bootstrap: true, conversationId: 'main-conversation', routeToken: 'main-route' });
    if (request.action === 'ask') return json(options.asks?.[asks++] ?? { version: 2, answer: '一般回答完成。', steps: [], cards: [] });
    throw new Error('Unexpected action ' + request.action);
  }));
  return requests;
}
async function submit(question: string) {
  const field = await screen.findByLabelText('問題'); fireEvent.change(field, { target: { value: question } });
  await waitFor(() => expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '送出' })); return field;
}

it.each([
  ['任垣樓在哪裡', { kind: 'place', query: '任垣樓' }],
  ['下一堂課教室在哪裡', { kind: 'next-class' }],
  ['查下一堂課，教室在哪裡', { kind: 'next-class' }],
])('sends a small read command for %s with no provider or model consent', async (question, task) => {
  const requests = mockServer(); render(<Assistant />); await submit(question as string);
  await screen.findByText(mapStep().summary);
  expect(requests.map(request => request.action)).toEqual(['map-read']);
  expect(requests[0].body).toEqual({ schoolId: 'pu', conversationId: expect.any(String), task });
  expect(JSON.stringify(requests[0].body)).not.toMatch(/history|consent|routeToken|question/);
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect(screen.getByRole('link', { name: '查看來源' }).getAttribute('href')).toBe(mapHref);
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
});

it('keeps the old confirmation and main route valid, and excludes map results from later model history', async () => {
  const requests = mockServer({ ready: true, asks: [
    { version: 2, answer: '原先的行程提議。', steps: [], cards: [oldCard], dataRead: true },
    { version: 2, answer: '一般回答完成。', steps: [], cards: [] },
  ] });
  render(<Assistant />); await screen.findByLabelText('問題'); fireEvent.click(screen.getByRole('checkbox'));
  await submit('幫我安排讀書'); const card = await screen.findByRole('article', { name: '行程確認卡' });
  fireEvent.click(screen.getByRole('checkbox')); await submit('任垣樓在哪裡'); await screen.findByText(mapStep().summary);
  expect((within(card).getByRole('button', { name: '確認' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText('已被新提議取代')).toBeNull();
  const read = requests.find(request => request.action === 'map-read')!;
  expect(read.body.conversationId).not.toBe('main-conversation');
  fireEvent.click(screen.getByRole('checkbox')); await submit('介紹校園服務'); await screen.findByText('一般回答完成。');
  expect(requests.at(-1)?.body).toMatchObject({ conversationId: 'main-conversation', routeToken: 'main-route', history: [] });
  expect(requests.filter(request => request.action === 'map-read')).toHaveLength(1);
  expect(requests.some(request => ['confirm', 'cancel', 'reconcile'].includes(request.action))).toBe(false);
});

it('continues a partial map query with the read conversation instead of the current chat identity', async () => {
  const requests = mockServer({ override: request => request.action === 'map-read' ? json(mapReply(true)) : undefined });
  render(<Assistant />); await submit('任垣樓在哪裡'); await screen.findByText(mapStep(true).summary);
  fireEvent.click(screen.getByRole('button', { name: '重查未完成項目' })); await screen.findByText(mapStep().summary);
  expect(requests.map(request => request.action)).toEqual(['map-read', 'retry']);
  expect(requests[1].body).toEqual({ schoolId: 'pu', conversationId: requests[0].body.conversationId,
    token: 'map_query.' + 'A'.repeat(43), stepIds: ['map'] });
});

it.each(['card', 'wrong-service', 'model', 'unsafe-link'] as const)('rejects a map response with %s instead of granting action authority', async mode => {
  const reply = mapReply();
  const altered = mode === 'card' ? { ...reply, cards: [oldCard] }
    : mode === 'wrong-service' ? { ...reply, taskPlan: { version: 1, steps: [{ ...mapStep(), serviceId: 'calendar' }] } }
    : mode === 'model' ? { ...reply, modelCalls: 1 }
    : { ...reply, taskPlan: { version: 1, steps: [{ ...mapStep(), href: 'https://other.invalid' }] } };
  mockServer({ override: request => request.action === 'map-read' ? json(altered) : undefined });
  render(<Assistant />); await submit('任垣樓在哪裡');
  expect((await screen.findByRole('alert')).textContent).toContain('地點查詢結果尚未通過核對');
  expect(screen.queryByText(mapStep().summary)).toBeNull();
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
});

it.each(['school', 'account', 'logout', 'stop'] as const)('aborts the old map read and discards its late result on %s', async change => {
  let finish!: (response: Response) => void, readSignal: AbortSignal | undefined;
  const requests = mockServer({ override: request => {
    if (request.action !== 'map-read') return;
    readSignal = request.signal; return new Promise<Response>(resolve => { finish = resolve; });
  } });
  const view = render(<Assistant />); await submit('任垣樓在哪裡');
  await waitFor(() => expect(readSignal).toBeDefined());
  if (change === 'stop') fireEvent.click(screen.getByRole('button', { name: '停止這次回答' }));
  else {
    if (change === 'school') auth.school = 'nthu';
    if (change === 'account') { auth.account = 'bob'; auth.context = 'b'.repeat(43); }
    if (change === 'logout') auth.authenticated = false;
    view.rerender(<Assistant />);
  }
  expect(readSignal?.aborted).toBe(true);
  await act(async () => finish(json(mapReply())));
  expect(screen.queryByText(mapStep().summary)).toBeNull();
  expect(requests.map(request => request.action)).toEqual(['map-read']);
  if (change === 'stop') expect(screen.getByRole('alert').textContent).toContain('已停止這次地點查詢');
});

it('preserves a newly typed draft while a slow map request completes', async () => {
  let finish!: (response: Response) => void;
  const requests = mockServer({ override: request => request.action === 'map-read'
    ? new Promise<Response>(resolve => { finish = resolve; }) : undefined });
  render(<Assistant />); const field = await submit('任垣樓在哪裡');
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  fireEvent.change(field, { target: { value: '圖書館在哪裡' } });
  expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish(json(mapReply()))); await screen.findByText(mapStep().summary);
  expect((field as HTMLTextAreaElement).value).toBe('圖書館在哪裡');
  expect(requests).toHaveLength(1);
});
