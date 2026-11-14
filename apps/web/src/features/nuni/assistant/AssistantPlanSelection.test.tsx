import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlanProtectionEvent } from '@/lib/assistantPlanProtection';
import { AssistantPlanSelection, AssistantPlanSelectionComparison } from './AssistantPlanSelection';
import type { V2ActionStates, V2Card, V2Turn } from './types';

function card(id = 'first', patch: Record<string, unknown> = {}): V2Card {
  return { tool: 'propose_personal_event', mutationId: id, token: 'PRIVATE_TOKEN_' + id, schoolId: 'pu',
    destination: 'PRIVATE_DESTINATION', args: { title: '英文複習', date: '2030-11-04', allDay: false,
      startTime: '20:00', endTime: '21:00', ...patch } };
}
const turn = (cards = [card(), card('second', { title: '程式練習', startTime: '21:00', endTime: '22:00' }),
  card('third', { title: '閱讀', startTime: '22:00', endTime: '23:00' })]): V2Turn =>
  ({ question: 'PRIVATE_QUESTION', reply: { answer: '請核對', steps: [], cards } });
const base = { states: {}, pending: false, enabled: true };
function open() { fireEvent.click(screen.getByRole('button', { name: '選擇要建立的行程' })); }
function checkbox(ordinal: number) { return screen.getByRole('checkbox', { name: new RegExp('^保留 第 ' + ordinal + ' 項') }) as HTMLInputElement; }
function submit() { fireEvent.submit(screen.getByRole('form', { name: '選擇待建立行程' })); }
function ack() { return screen.getByRole('checkbox', { name: '我確認不建立任何項目，並撤銷整份待確認提議' }) as HTMLInputElement; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
afterEach(() => { vi.restoreAllMocks(); });

it('opens with every item checked, exact times, focus, no automatic requests, and no private metadata', () => {
  const onPreview = vi.fn();
  render(<AssistantPlanSelection {...base} turn={turn()} onPreview={onPreview} />);
  open();
  expect(document.activeElement).toBe(checkbox(1));
  expect(screen.getAllByRole('checkbox').every(item => (item as HTMLInputElement).checked)).toBe(true);
  expect(checkbox(1).textContent).toBe('');
  expect(screen.getByRole('checkbox', { name: '保留 第 1 項 · 英文複習 · 2030-11-04 20:00–21:00（台灣時間）' })).toBeTruthy();
  expect(screen.getByText(/排除只是不建立，不會刪除既有行程/)).toBeTruthy();
  expect(screen.getByText(/不會送給模型/)).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('保留 3 項，排除 0 項。');
  expect((screen.getByRole('button', { name: '預覽所選行程' }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.body.textContent).not.toContain('PRIVATE_');
  expect(onPreview).not.toHaveBeenCalled();
});

it('performs a three-to-two preview with open, uncheck, preview and preserves original order', async () => {
  const original = turn(), onPreview = vi.fn(async () => ({ ok: true, message: '兩項的新確認卡已備妥。' }));
  const before = JSON.stringify(original);
  render(<AssistantPlanSelection {...base} turn={original} onPreview={onPreview} />);
  open(); fireEvent.click(checkbox(2)); fireEvent.click(screen.getByRole('button', { name: '預覽所選行程' }));
  await screen.findByText('兩項的新確認卡已備妥。');
  expect(onPreview).toHaveBeenCalledExactlyOnceWith(['first', 'third']);
  expect(JSON.stringify(original)).toBe(before);
  expect(screen.queryByRole('form')).toBeNull();
  expect(screen.queryByRole('button', { name: '選擇要建立的行程' })).toBeNull();
});

it('keeps all-selected submissions local and does not mistake checkbox reversal for a change', () => {
  const onPreview = vi.fn();
  render(<AssistantPlanSelection {...base} turn={turn()} onPreview={onPreview} />);
  open(); submit(); fireEvent.click(checkbox(2)); fireEvent.click(checkbox(2)); submit();
  expect(onPreview).not.toHaveBeenCalled();
  expect(screen.getAllByText(/目前保留全部項目，不需重新預覽/).length).toBeGreaterThan(0);
});

it('preserves choices when collapsed and returns focus without dispatching', () => {
  const onPreview = vi.fn();
  render(<AssistantPlanSelection {...base} turn={turn()} onPreview={onPreview} />);
  open(); fireEvent.click(checkbox(2));
  fireEvent.click(screen.getByRole('button', { name: '收起行程選擇' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '選擇要建立的行程' }));
  open();
  expect(checkbox(1).checked).toBe(true); expect(checkbox(2).checked).toBe(false); expect(checkbox(3).checked).toBe(true);
  expect(onPreview).not.toHaveBeenCalled();
});

it('requires explicit all-excluded acknowledgement, including direct form submission, before requesting cancel-only', async () => {
  const onPreview = vi.fn(async () => ({ ok: true, message: '已撤銷整份待確認提議。' }));
  render(<AssistantPlanSelection {...base} turn={turn()} onPreview={onPreview} />);
  open(); for (const index of [1, 2, 3]) fireEvent.click(checkbox(index));
  const cancel = screen.getByRole('button', { name: '撤銷整份待確認提議' }) as HTMLButtonElement;
  expect(cancel.disabled).toBe(true); expect(ack().checked).toBe(false);
  submit();
  expect(screen.getByRole('alert').textContent).toContain('請先確認不建立任何項目');
  expect(onPreview).not.toHaveBeenCalled();
  fireEvent.click(ack());
  expect(cancel.disabled).toBe(false);
  expect(onPreview).not.toHaveBeenCalled();
  fireEvent.click(cancel); await screen.findByText('已撤銷整份待確認提議。');
  expect(onPreview).toHaveBeenCalledExactlyOnceWith([]);
});

it('resets all-excluded acknowledgement after choosing and excluding an item again', () => {
  const onPreview = vi.fn();
  render(<AssistantPlanSelection {...base} turn={turn([card()])} onPreview={onPreview} />);
  open(); fireEvent.click(checkbox(1)); fireEvent.click(ack());
  fireEvent.click(checkbox(1));
  expect(screen.queryByRole('checkbox', { name: /^我確認/ })).toBeNull();
  fireEvent.click(checkbox(1));
  expect(ack().checked).toBe(false);
  submit(); expect(onPreview).not.toHaveBeenCalled();
});

it('uses each exact ID for equal names and complete duplicate rows while also supporting all-day rows', async () => {
  const allDay = card('all-day'); allDay.args = { title: '全天閱讀', date: '2030-11-05', endDate: '2030-11-07', allDay: true };
  const onPreview = vi.fn(async () => ({ ok: false, message: '明確選擇已收到。' }));
  render(<AssistantPlanSelection {...base} turn={turn([card(), card('duplicate'), allDay])} onPreview={onPreview} />);
  open();
  expect(screen.getByRole('checkbox', { name: '保留 第 3 項 · 全天閱讀 · 2030-11-05 · 全天（至 2030-11-07，不含結束日）' })).toBeTruthy();
  fireEvent.click(checkbox(1)); submit(); await screen.findByText('明確選擇已收到。');
  expect(onPreview).toHaveBeenCalledExactlyOnceWith(['duplicate', 'all-day']);
  expect(checkbox(2).checked).toBe(true);
});

it('guards double submit and freezes all controls while a preview response is pending', async () => {
  const pending = deferred<{ ok: boolean; message: string }>();
  const onPreview = vi.fn(() => pending.promise);
  render(<AssistantPlanSelection {...base} turn={turn()} onPreview={onPreview} />);
  open(); fireEvent.click(checkbox(2)); submit(); submit();
  expect(onPreview).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('form').getAttribute('aria-busy')).toBe('true');
  expect(screen.getAllByRole('checkbox').every(item => (item as HTMLInputElement).disabled)).toBe(true);
  expect((screen.getByRole('button', { name: '正在預覽所選行程…' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '收起行程選擇' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { pending.resolve({ ok: false, message: '請核對後再試。' }); });
  expect(checkbox(2).checked).toBe(false);
});

it('guards double cancellation and freezes the all-excluded acknowledgement', async () => {
  const pending = deferred<{ ok: boolean; message: string }>();
  const onPreview = vi.fn(() => pending.promise);
  render(<AssistantPlanSelection {...base} turn={turn([card()])} onPreview={onPreview} />);
  open(); fireEvent.click(checkbox(1)); fireEvent.click(ack()); submit(); submit();
  expect(onPreview).toHaveBeenCalledExactlyOnceWith([]);
  expect(ack().disabled).toBe(true);
  expect((screen.getByRole('button', { name: '正在撤銷提議…' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { pending.resolve({ ok: false, message: '撤銷結果尚待核對。' }); });
  expect(ack().checked).toBe(true);
});

it('retains selections for its own retry after partial then full source cancellation', async () => {
  const original = turn();
  const onPreview = vi.fn().mockResolvedValueOnce({ ok: false, message: '先核對第一項。' })
    .mockRejectedValueOnce(new Error('新卡暫時無法取得。')).mockResolvedValueOnce({ ok: true, message: '新確認卡已備妥。' });
  const view = render(<AssistantPlanSelection {...base} turn={original} onPreview={onPreview} />);
  open(); fireEvent.click(checkbox(2)); submit(); await screen.findByText('先核對第一項。');
  view.rerender(<AssistantPlanSelection {...base} turn={original} states={{ first: { status: 'cancelled' } }} onPreview={onPreview} />);
  submit(); await screen.findByText('新卡暫時無法取得。');
  view.rerender(<AssistantPlanSelection {...base} turn={original} states={{ first: { status: 'cancelled' }, second: { status: 'cancelled' }, third: { status: 'cancelled' } }} onPreview={onPreview} />);
  expect(checkbox(2).checked).toBe(false); submit(); await screen.findByText('新確認卡已備妥。');
  expect(onPreview.mock.calls).toEqual([[['first', 'third']], [['first', 'third']], [['first', 'third']]]);
});

it('never treats selecting all again after partial cancellation as restoration of old cards', async () => {
  const original = turn(), onPreview = vi.fn(async () => ({ ok: false, message: '尚未完成。' }));
  const view = render(<AssistantPlanSelection {...base} turn={original} onPreview={onPreview} />);
  open(); fireEvent.click(checkbox(2)); submit(); await screen.findByText('尚未完成。');
  view.rerender(<AssistantPlanSelection {...base} turn={original} states={{ first: { status: 'cancelled' } }} onPreview={onPreview} />);
  fireEvent.click(checkbox(2)); submit();
  expect(screen.getAllByText(/不會恢復舊確認卡/).length).toBeGreaterThan(0);
  expect(screen.queryByText(/原提議保持原狀/)).toBeNull();
  expect(onPreview).toHaveBeenCalledTimes(1);
});

it.each(['unknown', 'executing', 'checking', 'conflict', 'absent', 'blocked'] as const)('blocks both subset preview and cancel-only while a global %s action awaits reconciliation', async status => {
  const original = turn([card()]), onPreview = vi.fn(async () => ({ ok: false, message: '已保留選擇。' }));
  const view = render(<AssistantPlanSelection {...base} turn={original} onPreview={onPreview} />);
  open(); fireEvent.click(checkbox(1)); fireEvent.click(ack()); submit(); await screen.findByText('已保留選擇。');
  const state = status === 'absent' ? { status, retryable: true, message: '待核對' } : { status, message: '待核對' };
  view.rerender(<AssistantPlanSelection {...base} turn={original} states={{ unrelated: state } as V2ActionStates} onPreview={onPreview} />);
  expect(screen.getByText(/請先使用原確認卡的核對流程/)).toBeTruthy();
  expect((screen.getByRole('button', { name: '撤銷整份待確認提議' }) as HTMLButtonElement).disabled).toBe(true);
  submit(); expect(onPreview).toHaveBeenCalledTimes(1);
});

it('does not offer cancelled, previously acted-on, mixed-tool, or malformed sources', () => {
  const onPreview = vi.fn();
  const view = render(<AssistantPlanSelection {...base} turn={turn()} states={{ first: { status: 'cancelled' } }} onPreview={onPreview} />);
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<AssistantPlanSelection {...base} turn={turn()} states={{ first: { status: 'superseded' } }} onPreview={onPreview} />);
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<AssistantPlanSelection {...base} turn={turn([card(), { ...card('other'), tool: 'propose_open_page' }])} onPreview={onPreview} />);
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<AssistantPlanSelection {...base} turn={turn([card('bad', { location: 'unexpected' })])} onPreview={onPreview} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(onPreview).not.toHaveBeenCalled();
});

it('blocks a previously open selection if the source becomes executed and respects owner enabled/pending', () => {
  const onPreview = vi.fn(), original = turn();
  const view = render(<AssistantPlanSelection {...base} turn={original} onPreview={onPreview} />);
  open(); fireEvent.click(checkbox(2));
  view.rerender(<AssistantPlanSelection {...base} turn={original} enabled={false} onPreview={onPreview} />);
  submit(); expect(onPreview).not.toHaveBeenCalled();
  view.rerender(<AssistantPlanSelection {...base} turn={original} pending onPreview={onPreview} />);
  submit(); expect(onPreview).not.toHaveBeenCalled();
  view.rerender(<AssistantPlanSelection {...base} turn={original} states={{ first: { status: 'superseded' } }} onPreview={onPreview} />);
  submit();
  expect(screen.getByText(/目前不能變更這份提議/)).toBeTruthy();
  expect((screen.getByRole('button', { name: '預覽所選行程' }) as HTMLButtonElement).disabled).toBe(true);
  expect(onPreview).not.toHaveBeenCalled();
});

it('does not reuse selection or accept a late result after an original source content change', async () => {
  const pending = deferred<{ ok: boolean; message: string }>(), onPreview = vi.fn(() => pending.promise);
  const original = turn();
  const view = render(<AssistantPlanSelection {...base} turn={original} onPreview={onPreview} />);
  open(); fireEvent.click(checkbox(2)); submit();
  const replacement = turn([card('first', { title: '新的來源' }), card('second'), card('third')]);
  view.rerender(<AssistantPlanSelection {...base} turn={replacement} onPreview={onPreview} />);
  open();
  expect(screen.getAllByRole('checkbox').every(item => (item as HTMLInputElement).checked)).toBe(true);
  await act(async () => { pending.resolve({ ok: true, message: '不可顯示舊來源結果。' }); });
  expect(screen.queryByText('不可顯示舊來源結果。')).toBeNull();
  expect(screen.getByRole('form')).toBeTruthy();
  expect(onPreview).toHaveBeenCalledTimes(1);
});

it('drops a late result after unmount without restoring controls', async () => {
  const pending = deferred<{ ok: boolean; message: string }>();
  const view = render(<AssistantPlanSelection {...base} turn={turn()} onPreview={() => pending.promise} />);
  open(); fireEvent.click(checkbox(2)); submit(); view.unmount();
  await act(async () => { pending.resolve({ ok: false, message: '晚到失敗。' }); });
  expect(document.body.textContent).toBe('');
});

const originals: PlanProtectionEvent[] = [
  { title: '同名項目', date: '2030-11-04', allDay: false, startTime: '20:00', endTime: '21:00' },
  { title: '同名項目', date: '2030-11-04', endDate: '2030-11-05', allDay: false, startTime: '23:00', endTime: '01:00' },
  { title: '全天活動', date: '2030-11-07', allDay: true },
];
it('shows exact kept and excluded originals by original index, without fuzzy pairing or a claim of completed creation', () => {
  render(<AssistantPlanSelectionComparison before={originals} retainedIndices={[2, 0]} />);
  expect(screen.getByRole('heading', { name: '行程選擇摘要' })).toBeTruthy();
  const kept = within(screen.getByRole('list', { name: '保留的原提議行程' })).getAllByRole('listitem');
  const excluded = within(screen.getByRole('list', { name: '排除的原提議行程' })).getAllByRole('listitem');
  expect(kept).toHaveLength(2); expect(excluded).toHaveLength(1);
  expect(kept[0].textContent).toContain('第 1 項 · 同名項目');
  expect(kept[1].textContent).toContain('第 3 項 · 全天活動');
  expect(excluded[0].textContent).toContain('第 2 項 · 同名項目');
  expect(excluded[0].textContent).toContain('2030-11-04 23:00 – 2030-11-05 01:00');
  expect(kept[1].textContent).toContain('2030-11-07 · 全天');
  expect(screen.getByText(/是否已建立，請依新確認卡的結果核對/)).toBeTruthy();
  expect(screen.getByText(/不會刪除既有行程/)).toBeTruthy();
  expect(document.body.textContent).not.toContain('已建立 2');
});

it.each([{ indices: [] }, { indices: [0, 1, 2] }])('truthfully summarizes edge selections $indices', ({ indices }) => {
  render(<AssistantPlanSelectionComparison before={originals} retainedIndices={indices} />);
  expect(screen.getByText(indices.length ? '沒有排除項目。' : '沒有保留項目。')).toBeTruthy();
});

it.each([{ indices: [0, 0] }, { indices: [3] }, { indices: [-1] }, { indices: [0.5] }])('does not display a correspondence summary for invalid retained indices $indices', ({ indices }) => {
  const view = render(<AssistantPlanSelectionComparison before={originals} retainedIndices={indices} />);
  expect(view.container.textContent).toBe('');
});
