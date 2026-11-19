import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { AssistantTaskStep } from '@campus/shared/src/assistantTaskPlan';
import { Assistant } from './Assistant';
import type { V2Card } from './assistant/types';

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
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.assign(auth, { context: 'a'.repeat(43), account: 'alice', school: 'pu', authenticated: true });
});

const json = (value: object) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const token = 'original_query.' + 'A'.repeat(43);
const card: V2Card = {
  tool: 'propose_personal_event', token: 'original-calendar-card', mutationId: 'calendar-original-study',
  schoolId: 'pu', destination: '個人行事曆',
  args: { title: '原本的作業準備行程', date: '2030-11-16', allDay: false, startTime: '20:00', endTime: '20:30' },
};
const unresolved = (id: 'materials' | 'transit'): AssistantTaskStep => ({
  id, label: id === 'transit' ? '查公車資訊' : '找課程教材', serviceId: id === 'transit' ? 'bus' : 'classroom',
  dependsOn: [], status: id === 'transit' ? 'blocked' : 'partial',
  summary: id === 'transit' ? '公車來源未完成。' : '一門課的教材來源未完成。',
});
function initialReply(expiresAt = Date.now() + 60_000) {
  return { version: 2, answer: '這次課務已安排並保留未完成查詢。', steps: [], cards: [card], dataRead: true,
    taskPlan: { version: 1, steps: [
      { id: 'work', label: '查未交作業', serviceId: 'classroom', dependsOn: [], status: 'completed', summary: '私人作業清單已核對。' },
      unresolved('materials'), unresolved('transit'),
      { id: 'study', label: '安排讀書', serviceId: 'calendar', dependsOn: ['work'], status: 'ready',
        summary: '這筆行程仍等待本人確認。', cardIds: [card.mutationId] },
    ] },
    taskRetry: { version: 1, token, stepIds: ['materials', 'transit'], expiresAt },
  };
}
function retriedReply(stepIds: string[], partial = false) {
  const selected = stepIds.map(id => ({ ...unresolved(id as 'materials' | 'transit'),
    status: partial ? 'blocked' : 'completed', summary: partial ? '來源仍未回應。' : `${id} 已重新核對的私人資料。` }));
  return { version: 2, answer: '已重新核對指定資料。', steps: [{ name: 'get_transit', status: 'ok', summary: '來源核對' }],
    cards: [], taskPlan: { version: 1, steps: selected },
    ...(partial ? { taskRetry: { version: 1, token: 'next_query.' + 'B'.repeat(43), stepIds, expiresAt: Date.now() + 60_000 } } : {}),
  };
}
async function beginTask() {
  const question = await screen.findByLabelText('問題');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(question, { target: { value: '查未交作業，查公車，安排今天讀書30分鐘' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByRole('button', { name: '重查未完成項目' });
  return question;
}

it.each(['button', 'single', 'phrase'] as const)('retries exact unfinished reads via %s without repeating or replacing an action card', async (method) => {
  const requests: { action: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ version: 2, enabled: true, ready: true });
    const action = url.split('/').at(-1)!, body = JSON.parse(String(init?.body));
    requests.push({ action, body });
    if (action === 'ask' && !body.routeToken) return json({ bootstrap: true,
      conversationId: 'original-server-conversation', routeToken: 'original-route' });
    if (action === 'retry') return json(retriedReply(body.stepIds));
    return json(initialReply());
  }));
  render(<Assistant />);
  const question = await beginTask();
  // A deterministic re-read needs no model consent and must not send any private prose.
  fireEvent.click(screen.getByRole('checkbox'));
  if (method === 'phrase') {
    fireEvent.change(question, { target: { value: '重試沒完成的' } });
    expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
  } else fireEvent.click(screen.getByRole('button', { name: method === 'single' ? '重新查詢查公車資訊' : '重查未完成項目' }));
  await screen.findByText('transit 已重新核對的私人資料。');
  const read = requests.filter(request => request.action === 'retry');
  expect(read).toHaveLength(1);
  expect(read[0].body).toEqual({ schoolId: 'pu', conversationId: 'original-server-conversation', token,
    stepIds: method === 'single' ? ['transit'] : ['materials', 'transit'] });
  expect(requests.map(request => request.action)).toEqual(['ask', 'ask', 'retry']);
  expect(screen.getAllByRole('button', { name: '確認' })).toHaveLength(1);
  expect((screen.getByRole('button', { name: '確認' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText(/提議已被新內容取代/)).toBeNull();
  expect(screen.queryByRole('button', { name: '重新查詢查公車資訊' })).toBeNull();
  if (method === 'single') expect(screen.getByRole('button', { name: '重新查詢找課程教材' })).toBeTruthy();
  else {
    fireEvent.change(question, { target: { value: '繼續查沒完成的' } });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    expect(screen.getByRole('alert').textContent).toContain('目前沒有可接續的未完成資料查詢');
    expect(requests.filter(request => request.action === 'retry')).toHaveLength(1);
  }
});

it('continues from the latest failed re-read token and excludes both source turns from model history', async () => {
  const requests: { action: string; body: Record<string, unknown> }[] = [];
  let retries = 0, asks = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ version: 2, enabled: true, ready: true });
    const action = url.split('/').at(-1)!, body = JSON.parse(String(init?.body));
    requests.push({ action, body });
    if (action === 'retry') return json(retriedReply(body.stepIds, ++retries === 1));
    return json(++asks === 1 ? initialReply() : { answer: '可以從課程或生活服務開始。', steps: [], cards: [] });
  }));
  render(<Assistant />);
  const question = await beginTask();
  fireEvent.click(screen.getByRole('button', { name: '重查未完成項目' }));
  await screen.findAllByText('來源仍未回應。');
  expect(screen.getAllByRole('button', { name: '重查未完成項目' })).toHaveLength(1);
  fireEvent.change(question, { target: { value: '重新查詢未完成項目' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByText('transit 已重新核對的私人資料。');
  const readRequests = requests.filter(request => request.action === 'retry');
  expect(readRequests[1].body.token).toBe('next_query.' + 'B'.repeat(43));
  fireEvent.change(question, { target: { value: '幫我簡單介紹校園服務' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByText('可以從課程或生活服務開始。');
  const last = requests.at(-1)!;
  expect(last.action).toBe('ask');
  expect(last.body.history).toEqual([]);
  expect(JSON.stringify(last.body)).not.toMatch(/私人資料|私人作業|original_query|next_query|original-calendar-card/);
});

it('leaves the original continuation available if the read-only response tries to inject a card', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ version: 2, enabled: true, ready: true });
    if (url.endsWith('retry')) return json({ ...retriedReply(JSON.parse(String(init?.body)).stepIds),
      cards: [{ ...card, mutationId: 'injected-card', args: { ...card.args, title: '未授權的新行程' } }] });
    return json(initialReply());
  }));
  render(<Assistant />);
  await beginTask();
  fireEvent.click(screen.getByRole('button', { name: '重查未完成項目' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('重查結果尚未通過核對');
  expect(screen.getAllByRole('button', { name: '確認' })).toHaveLength(1);
  expect(screen.queryByText('未授權的新行程')).toBeNull();
  expect(screen.getByRole('button', { name: '重查未完成項目' })).toBeTruthy();
});

it.each(['school', 'account', 'logout', 'stop'] as const)('aborts a re-read and discards its late data on %s', async (change) => {
  let finish!: (response: Response) => void;
  let retrySignal: AbortSignal | undefined;
  const actions: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ version: 2, enabled: true, ready: true });
    actions.push(url.split('/').at(-1)!);
    if (url.endsWith('retry')) {
      retrySignal = init?.signal as AbortSignal;
      return new Promise<Response>(resolve => { finish = resolve; });
    }
    return json(initialReply());
  }));
  const view = render(<Assistant />);
  await beginTask();
  fireEvent.click(screen.getByRole('button', { name: '重查未完成項目' }));
  await waitFor(() => expect(retrySignal).toBeDefined());
  if (change === 'stop') fireEvent.click(screen.getByRole('button', { name: '停止這次回答' }));
  else {
    if (change === 'school') auth.school = 'nthu';
    if (change === 'account') { auth.account = 'bob'; auth.context = 'b'.repeat(43); }
    if (change === 'logout') auth.authenticated = false;
    view.rerender(<Assistant />);
  }
  expect(retrySignal?.aborted).toBe(true);
  await act(async () => finish(json(retriedReply(['materials', 'transit']))));
  expect(screen.queryByText('transit 已重新核對的私人資料。')).toBeNull();
  expect(actions).toEqual(['ask', 'retry']);
  if (change === 'stop') {
    expect(screen.getByRole('alert').textContent).toContain('已停止這次重查');
    expect(screen.getAllByRole('button', { name: '確認' })).toHaveLength(1);
    expect((screen.getByRole('button', { name: '重查未完成項目' }) as HTMLButtonElement).disabled).toBe(false);
  } else expect(screen.queryByRole('button', { name: '重查未完成項目' })).toBeNull();
});

it('rejects an expired natural-language retry instead of resending the original task', async () => {
  const actions: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('capability')) return json({ version: 2, enabled: true, ready: true });
    actions.push(url.split('/').at(-1)!);
    return json(initialReply(Date.now() - 1000));
  }));
  render(<Assistant />);
  const question = await beginTask();
  expect((screen.getByRole('button', { name: '重查未完成項目' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(question, { target: { value: '重試沒完成的' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  expect(screen.getByRole('alert').textContent).toContain('目前沒有可接續');
  expect(actions).toEqual(['ask']);
});

it('asks for a concrete source when no prior retry exists, even without a model or consent', async () => {
  const fetcher = vi.fn(async () => json({ version: 2, enabled: true, ready: false }));
  vi.stubGlobal('fetch', fetcher);
  render(<Assistant />);
  fireEvent.change(await screen.findByLabelText('問題'), { target: { value: '繼續查沒完成的' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  expect(screen.getByRole('alert').textContent).toContain('目前沒有可接續');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
