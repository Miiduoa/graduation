import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { readPersonalImports } from '@/lib/personalImports';
import { Assistant } from './Assistant';
import type { V2Card } from './assistant/types';

const state = vi.hoisted(() => ({ context: 'a'.repeat(43), school: 'pu' }));
vi.mock('./Session', () => ({
  useNuniSession: () => ({ loading: false, error: '', pendingLogout: false,
    session: { context: state.context, platformAccountId: 'alice' } }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: state.school }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  sessionStorage.clear();
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
  state.context = 'a'.repeat(43);
  state.school = 'pu';
});

const json = (value: object) => new Response(JSON.stringify(value), {
  headers: { 'Content-Type': 'application/json' },
});
const calendarCard = (id: string, title: string, startTime: string, endTime: string): V2Card => ({
  tool: 'propose_personal_event', token: 'token-' + id, mutationId: id, schoolId: 'pu',
  destination: '個人行事曆', args: { title, date: '2030-11-04', allDay: false, startTime, endTime },
});
const originalCards = () => [
  calendarCard('original-event-1', '英文閱讀原安排', '19:00', '20:00'),
  calendarCard('original-event-2', '程式練習原安排', '20:00', '21:00'),
];
const revisedCards = () => [
  calendarCard('revised-event-1', '英文閱讀原安排', '19:00', '20:00'),
  calendarCard('revised-event-2', '程式練習原安排', '21:00', '22:00'),
];
const reply = (cards: V2Card[]) => ({ answer: '已整理確認卡', steps: [], cards });
const checkFor = (card: V2Card, status: 'revoked' | 'absent' | 'conflict' = 'revoked') => ({
  version: 1, operation: 'calendar.create', status, schoolId: card.schoolId,
  mutationId: card.mutationId, storage: 'synced', revision: 0,
  checkedAt: '2026-11-07T11:00:00.000Z', authorizationValid: false, retryable: false,
  ...(status === 'revoked' ? { alreadyRevoked: false } : {}),
});
const receiptFor = (card: V2Card) => createAssistantCalendarReceipt({
  schoolId: card.schoolId, mutationId: card.mutationId, event: card.args, storage: 'synced',
  revision: 1, verifiedAt: '2026-11-07T11:00:00.000Z', replay: true,
  record: { ...card.args, id: card.mutationId, batchId: card.mutationId, kind: 'events',
    schoolId: card.schoolId, academicYear: '', semester: '', importedAt: '2026-11-07T10:59:00.000Z',
    source: { type: 'paste', line: 1, rawText: '', name: '助理確認' } },
});
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
type Call = { action: string; body: Record<string, unknown>; signal: AbortSignal };
function fixture(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    const call = { action: url.split('/').at(-1)!, body: JSON.parse(String(init?.body)),
      signal: init?.signal as AbortSignal };
    calls.push(call);
    return handler(call);
  }));
  return calls;
}
const count = (calls: Call[], action: string) => calls.filter(call => call.action === action);
const instruction = '只把第二項程式練習改到 21:00–22:00，第一項英文閱讀保持原樣';
async function askForPlan() {
  const question = await screen.findByLabelText('問題') as HTMLTextAreaElement;
  fireEvent.click(screen.getByRole('checkbox', { name: /同意在本次對話/ }));
  fireEvent.change(question, { target: { value: '幫我排兩項讀書安排' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByRole('button', { name: '修改時間或條件' });
  return question;
}
function openEditor() {
  fireEvent.click(screen.getByRole('button', { name: '修改時間或條件' }));
  const editor = screen.getByLabelText('修改條件') as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: instruction } });
  return editor;
}
function submitRevision() {
  fireEvent.submit(screen.getByRole('form', { name: '修改安排再預覽' }));
}

it('revokes both original cards serially before one new preview, preserving the exact first event and composer draft', async () => {
  const originals = originalCards(), revised = revisedCards();
  const firstCancellation = deferred();
  let asks = 0;
  const calls = fixture(({ action, body }) => {
    if (action === 'ask') return json(reply(++asks === 1 ? originals : revised));
    if (action === 'cancel') return body.token === originals[0].token
      ? firstCancellation.promise : json(checkFor(originals[1]));
    if (action === 'confirm') return json(receiptFor(revised.find(card => card.token === body.token)!));
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  const composer = await askForPlan();
  expect(screen.queryByRole('heading', { name: '這次提議改了什麼' })).toBeNull();
  fireEvent.change(composer, { target: { value: '下一個問題先留在這裡' } });
  openEditor();
  const snapshot = screen.getByRole('list', { name: '原提議行程' });
  expect(snapshot.textContent).toContain('英文閱讀原安排');
  expect(snapshot.textContent).toContain('19:00–20:00');
  expect(snapshot.textContent).toContain('程式練習原安排');
  expect(snapshot.textContent).toContain('2030-11-04');
  submitRevision();
  submitRevision();
  await waitFor(() => expect(count(calls, 'cancel')).toHaveLength(1));
  expect(count(calls, 'ask')).toHaveLength(1);
  expect(count(calls, 'confirm')).toHaveLength(0);
  await act(async () => firstCancellation.resolve(json(checkFor(originals[0]))));
  await waitFor(() => expect(screen.getAllByRole('article', { name: '行程確認卡' })).toHaveLength(4));
  expect(calls.map(call => call.action)).toEqual(['ask', 'cancel', 'cancel', 'ask']);
  expect(screen.getByRole('heading', { name: '這次提議改了什麼' })).toBeTruthy();
  expect(count(calls, 'cancel').map(call => call.body.token)).toEqual(originals.map(card => card.token));
  const revision = count(calls, 'ask')[1].body;
  expect(revision.history).toEqual([]);
  expect(revision.question).toContain(instruction);
  const serialized = String(revision.question).split('原安排：')[1].split('\n修改條件：')[0];
  expect(JSON.parse(serialized)).toEqual(originals.map(card => card.args));
  for (const privateValue of [...originals.flatMap(card => [card.token, card.mutationId]),
    'schoolId', 'conversationId', 'routeToken', 'platform:alice', state.context]) {
    expect(String(revision.question)).not.toContain(privateValue);
  }
  expect(composer.value).toBe('下一個問題先留在這裡');
  const cards = screen.getAllByRole('article', { name: '行程確認卡' });
  for (const retired of cards.slice(0, 2)) {
    expect(within(retired).getByText('已撤銷未執行提議')).toBeTruthy();
    expect(within(retired).queryByRole('button', { name: '確認' })).toBeNull();
  }
  expect(cards[2].textContent).toContain('19:00');
  expect(cards[2].textContent).toContain('20:00');
  expect(cards[3].textContent).toContain('21:00');
  expect(cards[3].textContent).toContain('22:00');
  expect(count(calls, 'confirm')).toHaveLength(0);
  expect(readPersonalImports({ owner: 'platform:alice', schoolId: 'pu' })).toEqual([]);
  fireEvent.click(within(cards[2]).getByRole('button', { name: '確認' }));
  await screen.findByText('已核對並加入個人行事曆');
  expect(count(calls, 'confirm').map(call => call.body.token)).toEqual([revised[0].token]);
});

it.each(['error', 'empty', 'mixed', 'reused', 'duplicate'] as const)('preserves revision conditions after an %s response and retries without cancelling the original cards twice', async outcome => {
  const originals = originalCards(), revised = revisedCards();
  let asks = 0;
  const calls = fixture(({ action, body }) => {
    if (action === 'cancel') return json(checkFor(originals.find(card => card.token === body.token)!));
    if (action !== 'ask') throw new Error('Unexpected action: ' + action);
    if (++asks === 1) return json(reply(originals));
    if (asks > 2) return json(reply(revised));
    if (outcome === 'error') return new Response(JSON.stringify({ message: '模型暫時無法產生新提議' }), { status: 503 });
    if (outcome === 'empty') return json(reply([]));
    if (outcome === 'reused') return json(reply(originals));
    if (outcome === 'duplicate') return json(reply([revised[0], { ...revised[1], mutationId: revised[0].mutationId }]));
    return json(reply([revised[0], { ...revised[1], tool: 'propose_open_page', destination: '/map', args: { page: 'map' } }]));
  });
  render(<Assistant />);
  const composer = await askForPlan();
  fireEvent.change(composer, { target: { value: '保留我的其他問題草稿' } });
  const editor = openEditor();
  submitRevision();
  await screen.findByRole('alert');
  expect(editor.value).toBe(instruction);
  expect(composer.value).toBe('保留我的其他問題草稿');
  expect(screen.getAllByText('已撤銷未執行提議')).toHaveLength(2);
  expect(screen.getAllByRole('article', { name: '行程確認卡' })).toHaveLength(2);
  expect(screen.queryByRole('article', { name: '頁面確認卡' })).toBeNull();
  expect(count(calls, 'confirm')).toHaveLength(0);
  submitRevision();
  await waitFor(() => expect(screen.getAllByRole('article', { name: '行程確認卡' })).toHaveLength(4));
  expect(count(calls, 'ask')).toHaveLength(3);
  expect(count(calls, 'cancel').map(call => call.body.token)).toEqual(originals.map(card => card.token));
  expect(count(calls, 'confirm')).toHaveLength(0);
});

it('uses the original read-only recovery after a lost revocation response and resumes only after strict revoked evidence', async () => {
  const originals = originalCards();
  let asks = 0, recovered = false;
  const calls = fixture(({ action, body }) => {
    if (action === 'ask') return json(reply(++asks === 1 ? originals : revisedCards()));
    if (action === 'cancel') {
      if (body.token === originals[1].token) throw new TypeError('lost cancellation response');
      return json(checkFor(originals[0]));
    }
    if (action === 'reconcile') {
      if (!recovered) throw new TypeError('read-back unavailable');
      return json(checkFor(originals[1]));
    }
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  await askForPlan();
  const editor = openEditor();
  submitRevision();
  await screen.findByText(/尚未核對執行結果/);
  await waitFor(() => expect(screen.getByRole('button', { name: '重新預覽' })).toBeTruthy());
  expect(editor.value).toBe(instruction);
  expect(count(calls, 'reconcile')).toHaveLength(1);
  expect(count(calls, 'ask')).toHaveLength(1);
  expect(count(calls, 'confirm')).toHaveLength(0);
  expect((screen.getByRole('button', { name: '重新預覽' }) as HTMLButtonElement).disabled).toBe(true);
  submitRevision();
  expect(count(calls, 'ask')).toHaveLength(1);
  recovered = true;
  fireEvent.click(screen.getByRole('button', { name: '重新核對結果' }));
  await waitFor(() => expect(screen.getAllByText('已撤銷未執行提議')).toHaveLength(2));
  submitRevision();
  await waitFor(() => expect(screen.getAllByRole('article', { name: '行程確認卡' })).toHaveLength(4));
  expect(count(calls, 'cancel').map(call => call.body.token)).toEqual(originals.map(card => card.token));
  expect(count(calls, 'reconcile').map(call => call.body.token)).toEqual([originals[1].token, originals[1].token]);
  expect(count(calls, 'ask')).toHaveLength(2);
  expect(count(calls, 'confirm')).toHaveLength(0);
});

it.each(['absent', 'conflict'] as const)('does not create a revised plan from a %s cancellation result', async result => {
  const original = originalCards()[0];
  const calls = fixture(({ action }) => {
    if (action === 'ask') return json(reply([original]));
    if (action === 'cancel') return json(checkFor(original, result));
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  await askForPlan();
  openEditor();
  submitRevision();
  await screen.findByRole('button', { name: '重新核對結果' });
  await waitFor(() => expect(screen.getByRole('button', { name: '重新預覽' })).toBeTruthy());
  submitRevision();
  expect(count(calls, 'ask')).toHaveLength(1);
  expect(count(calls, 'confirm')).toHaveLength(0);
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe(instruction);
});

it('stops replanning when cancellation discovers an already verified event', async () => {
  const original = originalCards()[0];
  const calls = fixture(({ action }) => {
    if (action === 'ask') return json(reply([original]));
    if (action === 'cancel') return json(receiptFor(original));
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  await askForPlan();
  openEditor();
  submitRevision();
  await screen.findByText('已核對並加入個人行事曆');
  await waitFor(() => expect(screen.getByRole('button', { name: '重新預覽' })).toBeTruthy());
  submitRevision();
  expect(count(calls, 'ask')).toHaveLength(1);
  expect(count(calls, 'confirm')).toHaveLength(0);
  expect(readPersonalImports({ owner: 'platform:alice', schoolId: 'pu' }).map(event => event.id)).toEqual([original.mutationId]);
});

it('does not ask for a new preview if model consent is withdrawn while revocation is pending', async () => {
  const original = originalCards()[0];
  const cancellation = deferred();
  const calls = fixture(({ action }) => {
    if (action === 'ask') return json(reply([original]));
    if (action === 'cancel') return cancellation.promise;
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  await askForPlan();
  const editor = openEditor();
  submitRevision();
  await waitFor(() => expect(count(calls, 'cancel')).toHaveLength(1));
  fireEvent.click(screen.getByRole('checkbox', { name: /同意在本次對話/ }));
  await act(async () => cancellation.resolve(json(checkFor(original))));
  await screen.findByText('已撤銷未執行提議');
  expect(editor.value).toBe(instruction);
  expect(count(calls, 'ask')).toHaveLength(1);
  expect(count(calls, 'confirm')).toHaveLength(0);
  expect((screen.getByRole('button', { name: '重新預覽' }) as HTMLButtonElement).disabled).toBe(true);
});

it('aborts a scoped revision and discards its late answer and cards after switching school/account context', async () => {
  const originals = originalCards();
  const response = deferred();
  let asks = 0;
  const calls = fixture(({ action, body }) => {
    if (action === 'ask') return ++asks === 1 ? json(reply(originals)) : response.promise;
    if (action === 'cancel') return json(checkFor(originals.find(card => card.token === body.token)!));
    throw new Error('Unexpected action: ' + action);
  });
  const view = render(<Assistant />);
  await askForPlan();
  openEditor();
  submitRevision();
  await waitFor(() => expect(count(calls, 'ask')).toHaveLength(2));
  const signal = count(calls, 'ask')[1].signal;
  state.school = 'nthu';
  state.context = 'b'.repeat(43);
  view.rerender(<Assistant />);
  expect(signal.aborted).toBe(true);
  await act(async () => response.resolve(json({ answer: '不可落在新學校的舊回答', steps: [], cards: revisedCards() })));
  await screen.findByLabelText('問題');
  expect(screen.queryByText('不可落在新學校的舊回答')).toBeNull();
  expect(screen.queryByRole('article', { name: '行程確認卡' })).toBeNull();
  expect(screen.queryByLabelText('修改條件')).toBeNull();
  expect(count(calls, 'confirm')).toHaveLength(0);
});
