import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { Assistant } from './Assistant';
import type { V2Card } from './assistant/types';
import { readAssistantExecutionJournal, saveAssistantExecutionJournal } from '@/lib/assistantExecutionJournal';

const state = vi.hoisted(() => ({
  accountId: 'alice', context: 'a'.repeat(43), schoolId: 'pu', authenticated: true,
}));
vi.mock('./Session', () => ({
  useNuniSession: () => ({ loading: false, error: '', pendingLogout: false,
    session: state.authenticated ? { context: state.context, platformAccountId: state.accountId } : null }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: state.schoolId }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const questionText = '把我最近一筆訂單的取餐時間加入行事曆，預留15分鐘';
const card: V2Card = {
  tool: 'propose_personal_event', token: 'signed-pickup.token', mutationId: 'pickup-order-one',
  schoolId: 'pu', destination: '個人行事曆（無推播提醒）', sourceBound: 'food-pickup',
  args: { title: '取餐：本人門市', date: '2099-11-18', allDay: false, startTime: '12:00', endTime: '12:15' },
};
const json = (value: object) => new Response(JSON.stringify(value), {
  headers: { 'Content-Type': 'application/json' },
});
const reply = () => ({ answer: '已核對本人門市的取餐時間，請確認後再加入行事曆。', dataRead: true,
  steps: [{ name: 'get_food_order', status: 'ok', summary: '已核對本人訂單' }], cards: [card] });
let requests: Array<{ action: string; body: Record<string, unknown> }>;
let capability: { enabled: boolean; ready: boolean; version: number; planning?: boolean };
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear(); sessionStorage.clear();
  state.accountId = 'alice'; state.context = 'a'.repeat(43); state.schoolId = 'pu'; state.authenticated = true;
  requests = [];
  capability = { enabled: true, ready: false, version: 2, planning: true };
  let lock = Promise.resolve();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: (_key: string, action: () => unknown) => {
      const task = lock.then(action);
      lock = task.then(() => undefined, () => undefined);
      return task;
    },
  } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json(capability);
    const action = url.split('/').at(-1)!;
    const body = JSON.parse(String(init?.body));
    requests.push({ action, body });
    if (action === 'ask' && !body.routeToken)
      return json({ bootstrap: true, conversationId: 'pickup-conversation', routeToken: 'pickup-route' });
    return json(reply());
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function sendPickup() {
  const input = await screen.findByLabelText('問題');
  fireEvent.change(input, { target: { value: questionText } });
  expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByText(reply().answer);
  return input;
}

it('reaches the scoped server planner without model readiness or consent, preserving exact source cards', async () => {
  render(<Assistant />);
  await sendPickup();
  expect(requests).toHaveLength(2);
  expect(requests.map(item => item.action)).toEqual(['ask', 'ask']);
  for (const { body } of requests) expect(body).toMatchObject({
    question: questionText, schoolId: 'pu', consent: false, history: [],
  });
  expect(requests[1].body).toMatchObject({ conversationId: 'pickup-conversation', routeToken: 'pickup-route' });
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText('取餐：本人門市')).toBeTruthy();
  expect(screen.getByRole('button', { name: '確認' })).toBeTruthy();
  for (const name of ['精確時間調整', '修改行程提議', '整組時間調整', '選擇待建立的提議項目'])
    expect(screen.queryByRole('region', { name })).toBeNull();
  expect(requests.some(item => item.action === 'confirm')).toBe(false);
});

it.each([
  '請問昨天訂單的取餐時間有沒有記到日曆？',
  '請問最新訂單的取餐時間是幾點？我想知道有沒有記到日曆。',
])('submits the existing read question with consent when pickup planning is disabled: %s', async question => {
  capability = { enabled: true, ready: true, version: 2, planning: false };
  const answer = '可以在個人日曆查看已記錄的取餐時間。';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json(capability);
    requests.push({ action: url.split('/').at(-1)!, body: JSON.parse(String(init?.body)) });
    return json({ answer, steps: [], cards: [] });
  }));
  render(<Assistant />);
  fireEvent.change(await screen.findByLabelText('問題'), { target: { value: question } });
  const submit = screen.getByRole('button', { name: '送出' }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() => expect(submit.disabled).toBe(false));
  fireEvent.click(submit);
  await screen.findByText(answer);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ action: 'ask', body: { question, consent: true } });
});

it.each([
  { enabled: false, ready: false, version: 2, planning: true },
  { enabled: true, ready: false, version: 2, planning: false },
  { enabled: true, ready: true, version: 2 },
  { enabled: true, ready: false, version: 1, planning: true },
])('requires an explicitly enabled V2 planning capability: %j', async (value) => {
  capability = value;
  render(<Assistant />);
  fireEvent.change(await screen.findByLabelText('問題'), { target: { value: questionText } });
  expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(screen.getByLabelText('問題'), { key: 'Enter' });
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  expect(requests).toHaveLength(0);
});

it('does not use the pickup exception for an unrelated question or an empty account', async () => {
  const view = render(<Assistant />);
  const input = await screen.findByLabelText('問題');
  fireEvent.change(input, { target: { value: '請幫我寫社團介紹稿' } });
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  expect(requests).toHaveLength(0);
  state.accountId = '';
  view.rerender(<Assistant />);
  fireEvent.change(await screen.findByLabelText('問題'), { target: { value: questionText } });
  expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  expect(requests).toHaveLength(0);
});

it('keeps an anonymous visitor outside the private order planner', async () => {
  state.authenticated = false;
  render(<Assistant />);
  expect(screen.queryByLabelText('問題')).toBeNull();
  expect(requests).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
});

it('preserves the source-bound card in recovery storage before a single confirmed write', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json(capability);
    const action = url.split('/').at(-1)!;
    requests.push({ action, body: JSON.parse(String(init?.body)) });
    if (action !== 'confirm') return json(reply());
    const saved = readAssistantExecutionJournal({ owner: 'platform:alice', schoolId: 'pu', context: state.context });
    expect(saved[0].card).toMatchObject({ token: card.token, args: card.args, sourceBound: 'food-pickup' });
    return json(createAssistantCalendarReceipt({
      schoolId: card.schoolId, mutationId: card.mutationId, event: card.args, storage: 'synced',
      revision: 1, verifiedAt: '2026-11-18T10:00:00.000Z', replay: false,
      record: { ...card.args, id: card.mutationId, batchId: card.mutationId, kind: 'events',
        schoolId: card.schoolId, academicYear: '', semester: '', importedAt: '2026-11-18T09:59:00.000Z',
        source: { type: 'paste', line: 1, rawText: '', name: '助理確認' } },
    }));
  }));
  render(<Assistant />);
  await sendPickup();
  fireEvent.click(screen.getByRole('button', { name: '確認' }));
  await screen.findByText('已核對並加入個人行事曆');
  expect(requests.filter(item => item.action === 'confirm')).toHaveLength(1);
  expect(requests.find(item => item.action === 'confirm')?.body).toMatchObject({ token: card.token, args: card.args });
});

it('omits the pickup question and private result from the next model request', async () => {
  capability.ready = true;
  render(<Assistant />);
  const input = await sendPickup();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(input, { target: { value: '請幫我寫社團介紹稿' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await waitFor(() => expect(requests).toHaveLength(3));
  expect(requests[2].body).toMatchObject({ consent: true, history: [] });
  expect(JSON.stringify(requests[2].body)).not.toMatch(/本人門市|最近一筆訂單|2099-11-18/);
});

it('recovers a pickup card by reading its original result and keeps restored details out of model history', async () => {
  capability.ready = true;
  saveAssistantExecutionJournal({ owner: 'platform:alice', schoolId: 'pu', context: state.context },
    { conversationId: 'original-conversation', card }, () => true);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json(capability);
    const action = url.split('/').at(-1)!;
    requests.push({ action, body: JSON.parse(String(init?.body)) });
    if (action === 'reconcile') return json({
      version: 1, operation: 'calendar.create', status: 'absent', schoolId: 'pu',
      mutationId: card.mutationId, storage: 'synced', revision: 0,
      checkedAt: '2026-11-18T10:00:00.000Z', authorizationValid: false, retryable: false,
    });
    return json({ answer: '社團介紹可從活動內容開始。', steps: [], cards: [] });
  }));
  render(<Assistant />);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ action: 'reconcile', body: {
    conversationId: 'original-conversation', token: card.token, args: card.args,
  } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('問題'), { target: { value: '請幫我寫社團介紹稿' } });
  await waitFor(() => expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByText('社團介紹可從活動內容開始。');
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({ action: 'ask', body: { history: [] } });
  expect(requests.some(item => item.action === 'confirm')).toBe(false);
  expect(JSON.stringify(requests[1])).not.toMatch(/本人門市|2099-11-18|signed-pickup/);
});

it('discards a late pickup response after changing account or campus', async () => {
  let complete!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json(capability);
    requests.push({ action: 'ask', body: JSON.parse(String(init?.body)) });
    return new Promise<Response>(resolve => { complete = resolve; });
  }));
  const view = render(<Assistant />);
  fireEvent.change(await screen.findByLabelText('問題'), { target: { value: questionText } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await waitFor(() => expect(requests).toHaveLength(1));
  state.accountId = 'bob'; state.context = 'b'.repeat(43); state.schoolId = 'nthu';
  view.rerender(<Assistant />);
  await screen.findByLabelText('問題');
  await act(async () => { complete(json(reply())); });
  expect(screen.queryByText(reply().answer)).toBeNull();
  expect(screen.queryByText('取餐：本人門市')).toBeNull();
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
});
