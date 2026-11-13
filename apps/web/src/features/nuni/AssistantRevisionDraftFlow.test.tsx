import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { readPersonalImports } from '@/lib/personalImports';
import { saveRevisionDraft, revisionDraftSource } from '@/lib/assistantPlanRevisionDraft';
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

const DRAFT_PREFIX = 'campus.assistant-plan-draft.v1:';
const JOURNAL_PREFIX = 'campus.assistant-execution.v1:';
const draftEntries = () => Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)!)
  .filter(key => key.startsWith(DRAFT_PREFIX)).map(key => ({ key, raw: sessionStorage.getItem(key)! }));
const draftScope = () => ({ accountId: state.account, schoolId: state.school, context: state.context });
function seedDraft() {
  const saved = saveRevisionDraft(draftScope(), revisionDraftSource(originals()), {
    instruction, protectedIndices: [0],
  }, () => true);
  expect(saved.ok).toBe(true);
}
async function askFresh() {
  const composer = await screen.findByLabelText('問題');
  fireEvent.click(screen.getByRole('checkbox', { name: /^同意在本次對話/ }));
  fireEvent.change(composer, { target: { value: '重新提供兩項讀書安排' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByRole('button', { name: '修改時間或條件' });
}
function openFreshEditor() {
  fireEvent.click(screen.getByRole('button', { name: '修改時間或條件' }));
  return screen.getByLabelText('修改條件') as HTMLTextAreaElement;
}
const freshCards = () => originals().map((event, index) => ({
  ...event, mutationId: 'fresh-original-' + index, token: 'fresh-original-token-' + index,
}));
const recovery = () => screen.getByRole('region', { name: '未送出的修訂草稿' });
const restore = () => fireEvent.click(screen.getByRole('button', { name: '恢復修訂草稿' }));
const apply = () => fireEvent.click(screen.getByRole('button', { name: '套用已恢復的草稿' }));
function denyStorage(method: 'getItem' | 'setItem' | 'removeItem', prefix = DRAFT_PREFIX) {
  const target: Storage = Object.hasOwn(sessionStorage, method) ? sessionStorage : Object.getPrototypeOf(sessionStorage);
  const original = sessionStorage[method];
  return vi.spyOn(target, method).mockImplementation(function (this: Storage, key: string, value?: string) {
    if (this === sessionStorage && key.startsWith(prefix)) throw new DOMException('denied fixture', 'QuotaExceededError');
    return Reflect.apply(original, this, value === undefined ? [key] : [key, value]);
  });
}

it('restores input after a real unmount without authority, then explicitly applies to fresh exact cards and previews only on request', async () => {
  const old = originals(), fresh = freshCards(), next = revised();
  let asks = 0;
  const calls = fixture(({ action, body }) => {
    if (action === 'ask') {
      ++asks;
      if (asks === 3) expect(draftEntries()).toEqual([]);
      return json(reply(asks === 1 ? old : asks === 2 ? fresh : next));
    }
    if (action === 'cancel') {
      expect(draftEntries()).toEqual([]);
      return json(revoked(fresh.find(event => event.token === body.token)!));
    }
    if (action === 'confirm') {
      expect(draftEntries()).toEqual([]);
      return json(receipt(next.find(event => event.token === body.token)!));
    }
    throw new Error('Unexpected action: ' + action);
  });
  const first = render(<Assistant />);
  await start();
  fireEvent.click(protection(1));
  await waitFor(() => expect(draftEntries()).toHaveLength(1));
  const saved = draftEntries()[0];
  expect(saved.key).toMatch(/^campus\.assistant-plan-draft\.v1:[a-f0-9]{64}$/);
  expect(JSON.parse(saved.raw)).toMatchObject({ instruction, protectedIndices: [0], source: { events: old.map(event => event.args) } });
  for (const secret of ['token-', 'original-1', 'original-2', state.context, 'platform:alice', 'conversationId', 'routeToken', '"consent"', '"turn"'])
    expect(saved.raw + saved.key).not.toContain(secret);
  fireEvent.click(screen.getByRole('button', { name: '收起修改' }));
  expect(draftEntries()).toHaveLength(1);
  first.unmount();
  render(<Assistant />);
  await screen.findByRole('region', { name: '未送出的修訂草稿' });
  expect(screen.queryByRole('article', { name: '行程確認卡' })).toBeNull();
  expect(screen.queryByDisplayValue(instruction)).toBeNull();
  expect(within(recovery()).queryByText('英文閱讀')).toBeNull();
  expect((screen.getByRole('checkbox', { name: /^同意在本次對話/ }) as HTMLInputElement).checked).toBe(false);
  expect(calls.map(call => call.action)).toEqual(['ask']);
  restore();
  expect((screen.getByLabelText('已恢復的修改條件') as HTMLTextAreaElement).value).toBe(instruction);
  expect(calls.map(call => call.action)).toEqual(['ask']);
  await askFresh();
  const editor = openFreshEditor();
  expect(editor.value).toBe('');
  expect(protection(1).checked).toBe(false);
  apply();
  expect(editor.value).toBe(instruction);
  expect(protection(1).checked).toBe(true);
  expect(protection(2).checked).toBe(false);
  expect(calls.map(call => call.action)).toEqual(['ask', 'ask']);
  submit();
  await waitFor(() => expect(cards()).toHaveLength(4));
  expect(calls.map(call => call.action)).toEqual(['ask', 'ask', 'cancel', 'cancel', 'ask']);
  expect(callsFor(calls, 'ask')[2].body.planProtection).toEqual({
    originalEvents: fresh.map(event => event.args), protectedIndices: [0],
  });
  expect(draftEntries()).toEqual([]);
  expect(imports()).toEqual([]);
  fireEvent.click(within(cards()[2]).getByRole('button', { name: '確認' }));
  await screen.findByText('已核對並加入個人行事曆');
  expect(callsFor(calls, 'confirm').map(call => call.body.token)).toEqual([next[0].token]);
});

it.each([false, true])('discards a saved draft with restored=%s without sending any request', async restored => {
  seedDraft();
  const calls = fixture(({ action }) => { throw new Error('Unexpected action: ' + action); });
  const view = render(<Assistant />);
  await screen.findByRole('region', { name: '未送出的修訂草稿' });
  if (restored) restore();
  fireEvent.click(screen.getByRole('button', { name: '捨棄修訂草稿' }));
  expect(draftEntries()).toEqual([]);
  expect(screen.queryByRole('region', { name: '未送出的修訂草稿' })).toBeNull();
  expect(calls).toEqual([]);
  view.unmount();
  render(<Assistant />);
  await screen.findByLabelText('問題');
  expect(screen.queryByRole('region', { name: '未送出的修訂草稿' })).toBeNull();
});

it('clears text, protection and persistence locally without cancelling original cards', async () => {
  const calls = fixture(({ action }) => {
    if (action === 'ask') return json(reply(originals()));
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  const { editor } = await start();
  fireEvent.click(protection(1));
  expect(draftEntries()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '清除修改內容' }));
  expect(editor.value).toBe('');
  expect(protection(1).checked).toBe(false);
  expect(draftEntries()).toEqual([]);
  expect(calls.map(call => call.action)).toEqual(['ask']);
  expect(screen.getAllByRole('button', { name: '確認' })).toHaveLength(2);
});

it.each(['time', 'order', 'field-presence'] as const)('applies only text when fresh proposal differs in %s', async difference => {
  seedDraft();
  let fresh = freshCards();
  if (difference === 'time') fresh[0] = { ...fresh[0], args: { ...fresh[0].args, startTime: '18:30' } };
  if (difference === 'order') fresh = fresh.toReversed();
  if (difference === 'field-presence') fresh[0] = { ...fresh[0], args: { ...fresh[0].args, endDate: '2030-11-04' } };
  const calls = fixture(({ action }) => {
    if (action === 'ask') return json(reply(fresh));
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  await screen.findByRole('region', { name: '未送出的修訂草稿' });
  restore();
  await askFresh();
  const editor = openFreshEditor();
  expect(screen.getByText('只帶入文字，保留項目須重新選擇。')).toBeTruthy();
  apply();
  expect(editor.value).toBe(instruction);
  expect(protection(1).checked).toBe(false);
  expect(protection(2).checked).toBe(false);
  expect(calls.map(call => call.action)).toEqual(['ask']);
  expect(JSON.parse(draftEntries()[0].raw).protectedIndices).toEqual([]);
});

it.each(['confirm', 'cancel'] as const)('invalidates the saved draft before directly dispatching %s', async actionToSend => {
  const old = originals();
  const targetIndex = actionToSend === 'cancel' ? old.length - 1 : 0;
  const draftsAtDispatch: string[][] = [];
  const calls = fixture(({ action }) => {
    if (action === 'ask') return json(reply(old));
    if (action === actionToSend) {
      draftsAtDispatch.push(draftEntries().map(entry => entry.raw));
      return json(action === 'confirm' ? receipt(old[targetIndex]) : revoked(old[targetIndex]));
    }
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  await start();
  fireEvent.click(protection(1));
  expect(draftEntries()).toHaveLength(1);
  fireEvent.click(within(cards()[targetIndex]).getByRole('button', { name: actionToSend === 'confirm' ? '確認' : '取消' }));
  await screen.findByText(actionToSend === 'confirm' ? '已核對並加入個人行事曆' : '已撤銷未執行提議');
  expect(callsFor(calls, actionToSend)).toHaveLength(1);
  expect(draftsAtDispatch).toEqual([[]]);
  expect(draftEntries()).toEqual([]);
  expect(callsFor(calls, actionToSend === 'confirm' ? 'cancel' : 'confirm')).toHaveLength(0);
});

it('keeps the current edit and explains a save quota failure', async () => {
  const calls = fixture(({ action }) => {
    if (action === 'ask') return json(reply(originals()));
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  await askFresh();
  const editor = openFreshEditor();
  const denied = denyStorage('setItem');
  fireEvent.change(editor, { target: { value: instruction } });
  fireEvent.click(protection(1));
  expect(editor.value).toBe(instruction);
  expect(protection(1).checked).toBe(true);
  expect(screen.getAllByText(/草稿.*(?:尚未|無法|未儲存)/).length).toBeGreaterThan(0);
  expect(draftEntries()).toEqual([]);
  expect(calls.map(call => call.action)).toEqual(['ask']);
  denied.mockRestore();
});

it.each((['getItem', 'removeItem'] as const).flatMap(method =>
  (['preview', 'confirm', 'cancel'] as const).map(action => ({ method, action })),
))('keeps the edit and blocks $action when $method prevents draft invalidation', async ({ method, action }) => {
  const calls = fixture(({ action }) => {
    if (action === 'ask') return json(reply(originals()));
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  const { editor } = await start();
  fireEvent.click(protection(1));
  const saved = draftEntries()[0].raw;
  const denied = denyStorage(method);
  fireEvent.click(screen.getByRole('button', { name: '清除修改內容' }));
  await screen.findByRole('alert');
  expect(editor.value).toBe(instruction);
  expect(protection(1).checked).toBe(true);
  if (action === 'preview') {
    submit();
    await waitFor(() => expect((screen.getByRole('button', { name: '重新預覽' }) as HTMLButtonElement).disabled).toBe(false));
  } else {
    const button = within(cards()[0]).getByRole('button', { name: action === 'confirm' ? '確認' : '取消' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await act(async () => {});
  }
  expect(calls.map(call => call.action)).toEqual(['ask']);
  expect(editor.value).toBe(instruction);
  expect(protection(1).checked).toBe(true);
  expect(imports()).toEqual([]);
  denied.mockRestore();
  expect(draftEntries()[0].raw).toBe(saved);
});

it.each(['expired', 'corrupt'] as const)('does not expose %s saved content after reload', async condition => {
  seedDraft();
  const { key, raw } = draftEntries()[0];
  sessionStorage.setItem(key, condition === 'expired'
    ? JSON.stringify({ ...JSON.parse(raw), savedAt: Date.now() - 31 * 60 * 1000 })
    : raw.slice(0, -2));
  const calls = fixture(({ action }) => { throw new Error('Unexpected action: ' + action); });
  render(<Assistant />);
  await screen.findByLabelText('問題');
  expect(screen.queryByRole('region', { name: '未送出的修訂草稿' })).toBeNull();
  expect(screen.queryByDisplayValue(instruction)).toBeNull();
  expect(screen.queryByText('英文閱讀')).toBeNull();
  // The composer can mount before the queued draft read; wait for its actual cleanup.
  await waitFor(() => expect(draftEntries()).toEqual([]));
  expect(screen.queryByRole('region', { name: '未送出的修訂草稿' })).toBeNull();
  expect(screen.queryByDisplayValue(instruction)).toBeNull();
  expect(screen.queryByText('英文閱讀')).toBeNull();
  expect(calls).toEqual([]);
});

it.each(['account', 'school', 'context'] as const)('isolates a saved draft from another %s after remount', async scopePart => {
  const calls = fixture(({ action }) => {
    if (action === 'ask') return json(reply(originals()));
    throw new Error('Unexpected action: ' + action);
  });
  const first = render(<Assistant />);
  await start();
  fireEvent.click(protection(1));
  expect(draftEntries()).toHaveLength(1);
  first.unmount();
  if (scopePart === 'account') state.account = 'bob';
  if (scopePart === 'school') state.school = 'nthu';
  if (scopePart === 'context') state.context = 'b'.repeat(43);
  render(<Assistant />);
  await screen.findByLabelText('問題');
  expect(screen.queryByRole('region', { name: '未送出的修訂草稿' })).toBeNull();
  expect(screen.queryByDisplayValue(instruction)).toBeNull();
  expect(screen.queryByRole('article', { name: '行程確認卡' })).toBeNull();
  expect(calls.map(call => call.action)).toEqual(['ask']);
});

it.each(['confirm', 'cancel'] as const)('reloads an in-flight %s as journal reconciliation only, never as an editable saved draft', async pendingAction => {
  const old = originals(), pending = deferred();
  const calls = fixture(({ action }) => {
    if (action === 'ask') return json(reply(old));
    if (action === pendingAction) {
      expect(draftEntries()).toEqual([]);
      return pending.promise;
    }
    if (action === 'reconcile') return json(pendingAction === 'confirm' ? receipt(old[0]) : revoked(old[0]));
    throw new Error('Unexpected action: ' + action);
  });
  const first = render(<Assistant />);
  await start();
  fireEvent.click(protection(1));
  fireEvent.click(within(cards()[0]).getByRole('button', { name: pendingAction === 'confirm' ? '確認' : '取消' }));
  await waitFor(() => expect(callsFor(calls, pendingAction)).toHaveLength(1));
  expect(draftEntries()).toEqual([]);
  first.unmount();
  render(<Assistant />);
  await waitFor(() => expect(callsFor(calls, 'reconcile')).toHaveLength(1));
  await screen.findByText(pendingAction === 'confirm' ? '已核對並加入個人行事曆' : '已撤銷未執行提議');
  expect(screen.queryByRole('region', { name: '未送出的修訂草稿' })).toBeNull();
  expect(callsFor(calls, 'ask')).toHaveLength(1);
  expect(callsFor(calls, pendingAction)).toHaveLength(1);
  expect(callsFor(calls, pendingAction === 'confirm' ? 'cancel' : 'confirm')).toHaveLength(0);
  expect(callsFor(calls, 'reconcile')[0].body.conversationId).toBe(callsFor(calls, pendingAction)[0].body.conversationId);
  await act(async () => pending.resolve(json(pendingAction === 'confirm' ? receipt(old[0]) : revoked(old[0]))));
});

it('does not recover or resend a revision whose new preview was already requested before reload', async () => {
  const old = originals(), pending = deferred();
  let asks = 0;
  const calls = fixture(({ action, body }) => {
    if (action === 'ask') return ++asks === 1 ? json(reply(old)) : pending.promise;
    if (action === 'cancel') return json(revoked(old.find(event => event.token === body.token)!));
    throw new Error('Unexpected action: ' + action);
  });
  const first = render(<Assistant />);
  await start();
  fireEvent.click(protection(1));
  submit();
  await waitFor(() => expect(callsFor(calls, 'ask')).toHaveLength(2));
  expect(draftEntries()).toEqual([]);
  first.unmount();
  render(<Assistant />);
  await screen.findByLabelText('問題');
  expect(screen.queryByRole('region', { name: '未送出的修訂草稿' })).toBeNull();
  expect(calls.map(call => call.action)).toEqual(['ask', 'cancel', 'cancel', 'ask']);
  await act(async () => pending.resolve(json(reply(revised(), '過期回覆不可出現'))));
  expect(screen.queryByText('過期回覆不可出現')).toBeNull();
  expect(screen.queryByRole('article', { name: '行程確認卡' })).toBeNull();
});

it('does not treat an unreadable execution journal as permission to apply a recovered draft', async () => {
  seedDraft();
  const denied = denyStorage('getItem', JOURNAL_PREFIX);
  const calls = fixture(({ action }) => {
    if (action === 'ask') return json(reply(freshCards()));
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  await screen.findByRole('region', { name: '未送出的修訂草稿' });
  restore();
  expect((screen.getByLabelText('已恢復的修改條件') as HTMLTextAreaElement).value).toBe(instruction);
  await askFresh();
  const entry = screen.getByRole('button', { name: '修改時間或條件' }) as HTMLButtonElement;
  fireEvent.click(entry);
  const applyButton = screen.getByRole('button', { name: '套用已恢復的草稿' });
  fireEvent.click(applyButton);
  expect((await screen.findByRole('alert')).textContent).toContain('目前提議或舊操作尚未完成核對');
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('');
  expect(protection(1).checked).toBe(false);
  expect(calls.map(call => call.action)).toEqual(['ask']);
  expect(imports()).toEqual([]);
  denied.mockRestore();
});

it('persists an unsubmitted protection-only edit and later edits to the explicitly restored text', async () => {
  const calls = fixture(({ action }) => {
    if (action === 'ask') return json(reply(originals()));
    throw new Error('Unexpected action: ' + action);
  });
  const first = render(<Assistant />);
  await askFresh();
  openFreshEditor();
  fireEvent.click(protection(1));
  expect(JSON.parse(draftEntries()[0].raw)).toMatchObject({ instruction: '', protectedIndices: [0] });
  first.unmount();
  const second = render(<Assistant />);
  await screen.findByRole('region', { name: '未送出的修訂草稿' });
  restore();
  const restored = screen.getByLabelText('已恢復的修改條件') as HTMLTextAreaElement;
  expect(restored.value).toBe('');
  fireEvent.change(restored, { target: { value: instruction } });
  expect(JSON.parse(draftEntries()[0].raw)).toMatchObject({ instruction, protectedIndices: [0] });
  second.unmount();
  render(<Assistant />);
  await screen.findByRole('region', { name: '未送出的修訂草稿' });
  expect(screen.queryByDisplayValue(instruction)).toBeNull();
  restore();
  expect((screen.getByLabelText('已恢復的修改條件') as HTMLTextAreaElement).value).toBe(instruction);
  expect(calls.map(call => call.action)).toEqual(['ask']);
});

it('keeps recovered typing in memory when draft reads fail, blocks applying, then saves and applies the latest text after access returns', async () => {
  seedDraft();
  const calls = fixture(({ action }) => {
    if (action === 'ask') return json(reply(freshCards()));
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  await screen.findByRole('region', { name: '未送出的修訂草稿' });
  restore();
  const restored = screen.getByLabelText('已恢復的修改條件') as HTMLTextAreaElement;
  await askFresh();
  const editor = openFreshEditor();
  const denied = denyStorage('getItem');
  const whileDenied = '改到明天晚上 21:00，英文仍維持原樣';
  fireEvent.change(restored, { target: { value: whileDenied } });
  expect(restored.value).toBe(whileDenied);
  apply();
  expect((await screen.findByRole('alert')).textContent).toMatch(/(?:讀取|草稿)/);
  expect(restored.value).toBe(whileDenied);
  expect(editor.value).toBe('');
  expect(protection(1).checked).toBe(false);
  expect(calls.map(call => call.action)).toEqual(['ask']);
  expect(imports()).toEqual([]);
  denied.mockRestore();

  const latest = whileDenied + '，練習縮短為半小時';
  fireEvent.change(restored, { target: { value: latest } });
  expect(restored.value).toBe(latest);
  expect(JSON.parse(draftEntries()[0].raw)).toMatchObject({ instruction: latest, protectedIndices: [0] });
  apply();
  expect(editor.value).toBe(latest);
  expect(protection(1).checked).toBe(true);
  expect(JSON.parse(draftEntries()[0].raw)).toMatchObject({ instruction: latest, protectedIndices: [0] });
  expect(calls.map(call => call.action)).toEqual(['ask']);
  expect(imports()).toEqual([]);
});

it('requires explicit restoration again when stored content changes despite retaining the same draft id', async () => {
  seedDraft();
  const calls = fixture(({ action }) => {
    if (action === 'ask') return json(reply(freshCards()));
    throw new Error('Unexpected action: ' + action);
  });
  render(<Assistant />);
  await screen.findByRole('region', { name: '未送出的修訂草稿' });
  restore();
  await askFresh();
  const editor = openFreshEditor();
  const { key, raw } = draftEntries()[0];
  const prior = JSON.parse(raw);
  sessionStorage.setItem(key, JSON.stringify({ ...prior, protectedIndices: [1] }));
  expect(JSON.parse(sessionStorage.getItem(key)!).id).toBe(prior.id);
  apply();
  expect((await screen.findByRole('alert')).textContent).toContain('草稿已更新或失效');
  expect(editor.value).toBe('');
  expect(protection(1).checked).toBe(false);
  expect(protection(2).checked).toBe(false);
  expect(screen.queryByLabelText('已恢復的修改條件')).toBeNull();
  expect(within(recovery()).getByRole('button', { name: '恢復修訂草稿' })).toBeTruthy();
  expect(calls.map(call => call.action)).toEqual(['ask']);
  expect(imports()).toEqual([]);

  restore();
  apply();
  expect(editor.value).toBe(instruction);
  expect(protection(1).checked).toBe(false);
  expect(protection(2).checked).toBe(true);
  expect(calls.map(call => call.action)).toEqual(['ask']);
});
