import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { readPersonalImports } from '@/lib/personalImports';
import { Assistant } from './Assistant';
import type { V2Card } from './assistant/types';

// Fixed proposal/receipt fixtures exercise the real Assistant UI; no model or account is contacted.
const state = vi.hoisted(() => ({ context: 'a'.repeat(43), account: 'alice', school: 'pu' }));
vi.mock('./Session', () => ({
  useNuniSession: () => ({ loading: false, error: '', pendingLogout: false,
    session: { context: state.context, platformAccountId: state.account } }),
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
  state.account = 'alice';
  state.school = 'pu';
});

const json = (value: object) => new Response(JSON.stringify(value), {
  headers: { 'Content-Type': 'application/json' },
});
const card = (id: string, title: string, startTime: string, endTime: string): V2Card => ({
  tool: 'propose_personal_event', token: 'token-' + id, mutationId: id, schoolId: 'pu',
  destination: '個人行事曆', args: { title, date: '2030-11-04', allDay: false, startTime, endTime },
});
const originals = () => [
  card('original-1', '英文閱讀', '19:00', '20:00'),
  card('original-2', '程式練習', '20:00', '21:00'),
];
const revised = (prefix = 'revised') => [
  card(prefix + '-1', '英文閱讀', '19:00', '20:00'),
  card(prefix + '-2', '程式練習', '21:00', '22:00'),
];
const reply = (cards: V2Card[], answer = '固定測試提議') => ({ answer, steps: [], cards });
const revoked = (event: V2Card) => ({
  version: 1, operation: 'calendar.create', status: 'revoked', schoolId: event.schoolId,
  mutationId: event.mutationId, storage: 'synced', revision: 0,
  checkedAt: '2026-11-07T11:00:00.000Z', authorizationValid: false, retryable: false,
  alreadyRevoked: false,
});
const receipt = (event: V2Card) => createAssistantCalendarReceipt({
  schoolId: event.schoolId, mutationId: event.mutationId, event: event.args, storage: 'synced',
  revision: 1, verifiedAt: '2026-11-07T11:00:00.000Z', replay: true,
  record: { ...event.args, id: event.mutationId, batchId: event.mutationId, kind: 'events',
    schoolId: event.schoolId, academicYear: '', semester: '', importedAt: '2026-11-07T10:59:00.000Z',
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
const callsFor = (calls: Call[], action: string) => calls.filter(call => call.action === action);
const instruction = '把未保留的程式練習改到 21:00–22:00';
async function start() {
  const composer = await screen.findByLabelText('問題') as HTMLTextAreaElement;
  fireEvent.click(screen.getByRole('checkbox', { name: /^同意在本次對話/ }));
  fireEvent.change(composer, { target: { value: '幫我安排讀書時間' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  fireEvent.click(await screen.findByRole('button', { name: '修改時間或條件' }));
  const editor = screen.getByLabelText('修改條件') as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: instruction } });
  return { composer, editor };
}
const protection = (ordinal: number) => screen.getByRole('checkbox', {
  name: new RegExp('^保留原樣 第 ' + ordinal + ' 項 '),
}) as HTMLInputElement;
const submit = () => fireEvent.submit(screen.getByRole('form', { name: '修改安排再預覽' }));
const cards = () => screen.getAllByRole('article', { name: '行程確認卡' });
const imports = () => readPersonalImports({ owner: 'platform:alice', schoolId: 'pu' });
const expectProtection = (call: Call, old: V2Card[], indices: number[]) => {
  expect(call.body.planProtection).toEqual({ originalEvents: old.map(event => event.args), protectedIndices: indices });
};

it('preserves one event, freezes controls while cancelling, and writes only the new card manually confirmed', async () => {
  const old = originals(), next = revised();
  const cancellation = deferred();
  let asks = 0;
  const calls = fixture(({ action, body }) => {
    if (action === 'ask') return json(reply(++asks === 1 ? old : next));
    if (action === 'cancel') return body.token === old[0].token ? cancellation.promise : json(revoked(old[1]));
    if (action === 'confirm') return json(receipt(next.find(event => event.token === body.token)!));
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  const { editor } = await start();
  fireEvent.click(protection(1));
  submit();
  await waitFor(() => expect(callsFor(calls, 'cancel')).toHaveLength(1));
  expect(protection(1).checked).toBe(true);
  expect(protection(1).disabled).toBe(true);
  expect(protection(2).disabled).toBe(true);
  expect(editor.disabled).toBe(true);
  expect((screen.getByRole('button', { name: '收起修改' }) as HTMLButtonElement).disabled).toBe(true);
  submit();
  expect(callsFor(calls, 'ask')).toHaveLength(1);
  await act(async () => cancellation.resolve(json(revoked(old[0]))));
  await waitFor(() => expect(cards()).toHaveLength(4));
  expect(calls.map(call => call.action)).toEqual(['ask', 'cancel', 'cancel', 'ask']);
  expectProtection(callsFor(calls, 'ask')[1], old, [0]);
  expect(callsFor(calls, 'confirm')).toHaveLength(0);
  expect(imports()).toEqual([]);
  for (const retired of cards().slice(0, 2)) {
    expect(within(retired).getByText('已撤銷未執行提議')).toBeTruthy();
    expect(within(retired).queryByRole('button', { name: '確認' })).toBeNull();
  }
  fireEvent.click(within(cards()[2]).getByRole('button', { name: '確認' }));
  await screen.findByText('已核對並加入個人行事曆');
  expect(callsFor(calls, 'confirm').map(call => call.body.token)).toEqual([next[0].token]);
  expect(imports().map(event => event.id)).toEqual([next[0].mutationId]);
  expect(within(cards()[3]).getByRole('button', { name: '確認' })).toBeTruthy();
});

it('keeps multiple same-name events and raw cross-day fields intact when the model reorders rows', async () => {
  const old = [
    { ...card('old-night', '讀書', '23:00', '01:00'), args: {
      title: '讀書', date: '2030-11-04', endDate: '2030-11-05', allDay: false, startTime: '23:00', endTime: '01:00',
    } },
    card('old-code', '程式練習', '20:00', '21:00'),
    card('old-reading', '讀書', '18:00', '19:00'),
  ];
  const next = [
    { ...old[2], token: 'new-reading-token', mutationId: 'new-reading' },
    card('new-code', '程式練習', '21:00', '22:00'),
    { ...old[0], token: 'new-night-token', mutationId: 'new-night' },
  ];
  let asks = 0;
  const calls = fixture(({ action, body }) => {
    if (action === 'ask') return json(reply(++asks === 1 ? old : next));
    if (action === 'cancel') return json(revoked(old.find(event => event.token === body.token)!));
    if (action === 'confirm') return json(receipt(next.find(event => event.token === body.token)!));
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  await start();
  fireEvent.click(protection(3));
  fireEvent.click(protection(1));
  submit();
  await waitFor(() => expect(cards()).toHaveLength(6));
  expectProtection(callsFor(calls, 'ask')[1], old, [0, 2]);
  expect(callsFor(calls, 'confirm')).toHaveLength(0);
  expect(imports()).toEqual([]);
  expect((within(cards()[5]).getByRole('button', { name: '確認' }) as HTMLButtonElement).disabled).toBe(true);
  for (let index = 0; index < next.length; index++) {
    fireEvent.click(within(cards()[index + 3]).getByRole('button', { name: '確認' }));
    await waitFor(() => expect(screen.getAllByText('已核對並加入個人行事曆')).toHaveLength(index + 1));
    expect(callsFor(calls, 'confirm')).toHaveLength(index + 1);
  }
  expect(callsFor(calls, 'confirm').map(call => call.body.token)).toEqual(next.map(event => event.token));
  expect(imports().find(event => event.id === 'new-night')).toMatchObject({
    title: '讀書', date: '2030-11-04', endDate: '2030-11-05', startTime: '23:00', endTime: '01:00',
  });
});

it.each(['missing', 'changed-time', 'duplicate', 'unknown-field', 'added-end-date'] as const)(
  'rejects the entire %s reply, retains the selection and draft, and retries with fresh manually confirmable cards',
  async failure => {
    const old = originals(), bad = revised('bad'), good = revised('retry');
    let invalid: V2Card[];
    if (failure === 'missing') invalid = [bad[1]];
    else if (failure === 'changed-time') invalid = [{ ...bad[0], args: { ...bad[0].args, startTime: '18:30' } }, bad[1]];
    else if (failure === 'duplicate') invalid = [...bad, { ...bad[0], mutationId: 'bad-copy', token: 'bad-copy-token' }];
    else if (failure === 'unknown-field') invalid = [{ ...bad[0], args: { ...bad[0].args, description: '未經同意新增' } }, bad[1]];
    else invalid = [{ ...bad[0], args: { ...bad[0].args, endDate: '2030-11-04' } }, bad[1]];
    let asks = 0;
    const calls = fixture(({ action, body }) => {
      if (action === 'cancel') return json(revoked(old.find(event => event.token === body.token)!));
      if (action === 'ask') {
        ++asks;
        return json(reply(asks === 1 ? old : asks === 2 ? invalid : good,
          asks === 2 ? '不合格回覆不可顯示為可用預覽' : '固定測試提議'));
      }
      throw new Error('Unexpected action: ' + action);
    });
    render(<Assistant />);
    const { composer, editor } = await start();
    fireEvent.change(composer, { target: { value: '下一個問題草稿' } });
    fireEvent.click(protection(1));
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('保留');
    expect(editor.value).toBe(instruction);
    expect(composer.value).toBe('下一個問題草稿');
    expect(protection(1).checked).toBe(true);
    expect(protection(2).checked).toBe(false);
    expect(cards()).toHaveLength(2);
    expect(screen.queryByText('不合格回覆不可顯示為可用預覽')).toBeNull();
    expect(screen.getAllByText('已撤銷未執行提議')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
    expect(imports()).toEqual([]);
    submit();
    await waitFor(() => expect(cards()).toHaveLength(4));
    expect(callsFor(calls, 'ask')).toHaveLength(3);
    expectProtection(callsFor(calls, 'ask')[1], old, [0]);
    expectProtection(callsFor(calls, 'ask')[2], old, [0]);
    expect(callsFor(calls, 'cancel').map(call => call.body.token)).toEqual(old.map(event => event.token));
    expect(callsFor(calls, 'confirm')).toHaveLength(0);
    expect(imports()).toEqual([]);
    expect(cards().slice(2).every(item => within(item).getByRole('button', { name: '確認' }))).toBe(true);
  },
);

it('rejects selecting only part of an identical duplicate group before revocation or another model request', async () => {
  const first = originals()[0];
  const old = [first, { ...first, mutationId: 'identical-original', token: 'identical-token' }, originals()[1]];
  const calls = fixture(({ action }) => {
    if (action === 'ask') return json(reply(old));
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  const { editor } = await start();
  fireEvent.click(protection(1));
  submit();
  expect((await screen.findByRole('alert')).textContent).toContain('完全相同的行程需一起標記保留');
  expect(calls.map(call => call.action)).toEqual(['ask']);
  expect(protection(1).checked).toBe(true);
  expect(protection(2).checked).toBe(false);
  expect(editor.value).toBe(instruction);
  expect(screen.getAllByRole('button', { name: '確認' })).toHaveLength(3);
  expect(imports()).toEqual([]);
});

it('returns an entirely protected fresh proposal without replanning and keeps its original confirmations usable', async () => {
  const old = originals();
  const calls = fixture(({ action, body }) => {
    if (action === 'ask') return json(reply(old));
    if (action === 'confirm') return json(receipt(old.find(event => event.token === body.token)!));
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  const { editor } = await start();
  fireEvent.click(protection(1));
  fireEvent.click(protection(2));
  fireEvent.change(editor, { target: { value: '' } });
  expect(screen.getByText(/全部項目已勾選保留原樣，不需重新預覽/)).toBeTruthy();
  expect((screen.getByRole('button', { name: '重新預覽' }) as HTMLButtonElement).disabled).toBe(true);
  submit();
  expect(calls.map(call => call.action)).toEqual(['ask']);
  fireEvent.click(screen.getByRole('button', { name: '回到原提議' }));
  expect(screen.queryByLabelText('修改條件')).toBeNull();
  expect(cards()).toHaveLength(2);
  fireEvent.click(within(cards()[0]).getByRole('button', { name: '確認' }));
  await screen.findByText('已核對並加入個人行事曆');
  expect(callsFor(calls, 'confirm').map(call => call.body.token)).toEqual([old[0].token]);
  expect(callsFor(calls, 'cancel')).toHaveLength(0);
  expect(imports().map(event => event.id)).toEqual([old[0].mutationId]);
});

it('does not restore cancelled cards when all items are protected after a rejected preview', async () => {
  const old = originals();
  let asks = 0;
  const calls = fixture(({ action, body }) => {
    if (action === 'ask') return json(reply(++asks === 1 ? old : [revised('bad')[1]]));
    if (action === 'cancel') return json(revoked(old.find(event => event.token === body.token)!));
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  await start();
  fireEvent.click(protection(1));
  submit();
  await screen.findByRole('alert');
  fireEvent.click(protection(2));
  expect(screen.getByText(/舊提議已有項目撤銷，不能恢復原確認卡/)).toBeTruthy();
  submit();
  expect(calls.map(call => call.action)).toEqual(['ask', 'cancel', 'cancel', 'ask']);
  fireEvent.click(screen.getByRole('button', { name: '回到原提議' }));
  expect(cards()).toHaveLength(2);
  expect(screen.getAllByText('已撤銷未執行提議')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  expect(imports()).toEqual([]);
});

it.each(['account', 'school'] as const)('discards a protected revision arriving after a %s switch', async target => {
  const old = originals(), pending = deferred();
  let asks = 0;
  const calls = fixture(({ action, body }) => {
    if (action === 'ask') return ++asks === 1 ? json(reply(old)) : pending.promise;
    if (action === 'cancel') return json(revoked(old.find(event => event.token === body.token)!));
    throw new Error('Unexpected action: ' + action);
  });
  const view = render(<Assistant />);
  await start();
  fireEvent.click(protection(1));
  submit();
  await waitFor(() => expect(callsFor(calls, 'ask')).toHaveLength(2));
  expectProtection(callsFor(calls, 'ask')[1], old, [0]);
  if (target === 'account') {
    state.account = 'bob';
    state.context = 'b'.repeat(43);
  } else state.school = 'nthu';
  view.rerender(<Assistant />);
  expect(callsFor(calls, 'ask')[1].signal.aborted).toBe(true);
  await act(async () => pending.resolve(json(reply(revised(), '另一個範圍不可看見的回答'))));
  await screen.findByLabelText('問題');
  expect(screen.queryByText('另一個範圍不可看見的回答')).toBeNull();
  expect(screen.queryByRole('article', { name: '行程確認卡' })).toBeNull();
  expect(screen.queryByLabelText('修改條件')).toBeNull();
  expect(callsFor(calls, 'confirm')).toHaveLength(0);
  expect(imports()).toEqual([]);
});

it('never offers a previously rejected proposal again even if its arguments are corrected on retry', async () => {
  const old = originals(), reused = revised('rejected'), fresh = revised('fresh');
  const changed = [{ ...reused[0], args: { ...reused[0].args, startTime: '18:00' } }, reused[1]];
  let asks = 0;
  const calls = fixture(({ action, body }) => {
    if (action === 'cancel') return json(revoked(old.find(event => event.token === body.token)!));
    if (action === 'ask') return json(reply([old, changed, reused, fresh][asks++]));
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  await start();
  fireEvent.click(protection(1));
  submit();
  await screen.findByRole('alert');
  expect(cards()).toHaveLength(2);
  submit();
  await waitFor(() => expect(callsFor(calls, 'ask')).toHaveLength(3));
  await screen.findByRole('alert');
  expect(cards()).toHaveLength(2);
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  expect(protection(1).checked).toBe(true);
  submit();
  await waitFor(() => expect(cards()).toHaveLength(4));
  expect(callsFor(calls, 'cancel').map(call => call.body.token)).toEqual(old.map(event => event.token));
  expect(callsFor(calls, 'confirm')).toHaveLength(0);
  expect(imports()).toEqual([]);
});
