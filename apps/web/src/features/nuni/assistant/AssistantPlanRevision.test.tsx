import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AssistantPlanRevision } from './AssistantPlanRevision';
import type { V2ActionStates, V2Card, V2Turn } from './types';

function event(id = 'first', args: Record<string, unknown> = {}): V2Card {
  return { tool: 'propose_personal_event', mutationId: id, token: 'private-token-' + id, schoolId: 'pu',
    destination: '個人行事曆', args: { title: '離散數學讀書', date: '2026-11-10', allDay: false, startTime: '20:00', endTime: '21:00', ...args } };
}
const turn = (cards = [event()]): V2Turn => ({ question: '幫我安排讀書', reply: { answer: '請核對確認卡', steps: [], cards } });
const base = { states: {}, pending: false, enabled: true };
function open() { fireEvent.click(screen.getByRole('button', { name: '修改時間或條件' })); }
function enter(value = '第一項改成明晚，其他安排不變') { fireEvent.change(screen.getByLabelText('修改條件'), { target: { value } }); }
function submit() { fireEvent.submit(screen.getByRole('form', { name: '修改安排再預覽' })); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

it('shows the exact original ordered times, focuses the editor, and never previews just by opening', async () => {
  const onPreview = vi.fn(async () => ({ ok: true, message: '新卡已備妥，請確認。' }));
  render(<AssistantPlanRevision {...base} turn={turn([
    event(), event('second', { title: '跨日討論', date: '2026-11-11', endDate: '2026-11-12', startTime: '23:00', endTime: '01:00' }),
    event('third', { title: '全天活動', date: '2026-11-12', endDate: '2026-11-14', allDay: true, startTime: undefined, endTime: undefined }),
  ].map(card => ({ ...card, args: Object.fromEntries(Object.entries(card.args).filter(([, value]) => value !== undefined)) })))} onPreview={onPreview} />);
  open();
  expect(document.activeElement).toBe(screen.getByLabelText('修改條件'));
  expect(within(screen.getByLabelText('原提議行程')).getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByText('2026-11-10 · 20:00–21:00（台灣時間）')).toBeTruthy();
  expect(screen.getByText('2026-11-11 23:00 – 2026-11-12 01:00（台灣時間）')).toBeTruthy();
  expect(screen.getByText('2026-11-12 · 全天（至 2026-11-14，不含結束日）')).toBeTruthy();
  expect(screen.getByText(/先撤銷整份未執行提議/)).toBeTruthy();
  expect(onPreview).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('private-token');
  enter('  第一項改成明晚 20:00  ');
  fireEvent.keyDown(screen.getByLabelText('修改條件'), { key: 'Enter' });
  expect(onPreview).not.toHaveBeenCalled();
  submit();
  await screen.findByRole('status');
  expect(onPreview).toHaveBeenCalledExactlyOnceWith('第一項改成明晚 20:00');
  expect(screen.queryByRole('button', { name: '重新預覽' })).toBeNull();
});

it('keeps the draft when collapsed and returns focus to its entry button', () => {
  render(<AssistantPlanRevision {...base} turn={turn()} onPreview={vi.fn()} />);
  open(); enter();
  fireEvent.click(screen.getByRole('button', { name: '收起修改' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '修改時間或條件' }));
  open();
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('第一項改成明晚，其他安排不變');
});

it('guards direct double submits and keeps the draft for retry after partial cancellation', async () => {
  const first = deferred<{ ok: boolean; message: string }>();
  const onPreview = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: true, message: '新的安排已備妥。' });
  const original = turn([event(), event('second', { title: '程式練習' })]);
  const view = render(<AssistantPlanRevision {...base} turn={original} onPreview={onPreview} />);
  open(); enter(); submit(); submit();
  expect(onPreview).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('button', { name: '正在重新預覽…' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { first.resolve({ ok: false, message: '第一項已撤銷，修改條件已保留。' }); });
  view.rerender(<AssistantPlanRevision {...base} turn={original} states={{ first: { status: 'cancelled' } }} onPreview={onPreview} />);
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('第一項改成明晚，其他安排不變');
  expect((screen.getByRole('button', { name: '重新預覽' }) as HTMLButtonElement).disabled).toBe(false);
  submit();
  await screen.findByText('新的安排已備妥。');
  expect(onPreview).toHaveBeenCalledTimes(2);
  view.rerender(<AssistantPlanRevision {...base} turn={original} states={{ first: { status: 'cancelled' }, second: { status: 'cancelled' } }} onPreview={onPreview} />);
  expect(screen.queryByRole('button', { name: '修改時間或條件' })).toBeNull();
});

it('preserves a failed preview for retry when every original card was revoked', async () => {
  const onPreview = vi.fn().mockRejectedValueOnce(new Error('模型暫時無法產生新提議。')).mockResolvedValueOnce({ ok: false, message: '目前沒有新卡，請調整條件。' });
  const original = turn();
  const view = render(<AssistantPlanRevision {...base} turn={original} onPreview={onPreview} />);
  open(); enter('改成明晚'); submit();
  await screen.findByText('模型暫時無法產生新提議。');
  view.rerender(<AssistantPlanRevision {...base} turn={original} states={{ first: { status: 'cancelled' } }} onPreview={onPreview} />);
  submit();
  await screen.findByText('目前沒有新卡，請調整條件。');
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('改成明晚');
  expect(onPreview).toHaveBeenCalledTimes(2);
});

it.each(['unknown', 'executing', 'checking', 'conflict', 'absent', 'blocked'] as const)('stops revision while a %s result awaits the original recovery flow', async status => {
  const onPreview = vi.fn(async () => ({ ok: false, message: '修改條件已保留。' }));
  const original = turn();
  const view = render(<AssistantPlanRevision {...base} turn={original} onPreview={onPreview} />);
  open(); enter(); submit();
  await screen.findByText('修改條件已保留。');
  const state = status === 'absent' ? { status, retryable: true, message: '待查核' } : { status, message: '待查核' };
  view.rerender(<AssistantPlanRevision {...base} turn={original} states={{ other: state } as V2ActionStates} onPreview={onPreview} />);
  expect(screen.getByText(/請先使用原確認卡的核對流程/)).toBeTruthy();
  expect((screen.getByRole('button', { name: '重新預覽' }) as HTMLButtonElement).disabled).toBe(true);
  submit();
  expect(onPreview).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('第一項改成明晚，其他安排不變');
});

it('does not start from a cancelled or non-calendar proposal and respects enabled/pending', () => {
  const onPreview = vi.fn();
  const view = render(<AssistantPlanRevision {...base} turn={turn()} states={{ first: { status: 'cancelled' } }} onPreview={onPreview} />);
  expect(screen.queryByRole('button', { name: '修改時間或條件' })).toBeNull();
  view.rerender(<AssistantPlanRevision {...base} turn={turn([{ ...event(), tool: 'propose_open_page' }])} onPreview={onPreview} />);
  expect(screen.queryByRole('button', { name: '修改時間或條件' })).toBeNull();
  view.rerender(<AssistantPlanRevision {...base} turn={turn()} enabled={false} onPreview={onPreview} />);
  expect((screen.getByRole('button', { name: '修改時間或條件' }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<AssistantPlanRevision {...base} turn={turn()} pending onPreview={onPreview} />);
  expect((screen.getByRole('button', { name: '修改時間或條件' }) as HTMLButtonElement).disabled).toBe(true);
  expect(onPreview).not.toHaveBeenCalled();
});

it('rejects an oversized instruction before calling the owner and retains the full draft', () => {
  const onPreview = vi.fn();
  render(<AssistantPlanRevision {...base} turn={turn()} onPreview={onPreview} />);
  open(); enter('改'.repeat(301)); submit();
  expect(screen.getByRole('alert').textContent).toContain('300');
  expect(onPreview).not.toHaveBeenCalled();
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toHaveLength(301);
});

it('drops a late result after changing proposals instead of overwriting the next draft', async () => {
  const old = deferred<{ ok: boolean; message: string }>();
  const onPreview = vi.fn(() => old.promise);
  const view = render(<AssistantPlanRevision {...base} turn={turn()} onPreview={onPreview} />);
  open(); enter('舊修改'); submit();
  view.rerender(<AssistantPlanRevision {...base} turn={turn([event('replacement', { title: '新安排' })])} onPreview={onPreview} />);
  open(); enter('新修改');
  await act(async () => { old.resolve({ ok: true, message: '舊結果不應顯示' }); });
  expect(screen.queryByText('舊結果不應顯示')).toBeNull();
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('新修改');
  expect((screen.getByRole('button', { name: '重新預覽' }) as HTMLButtonElement).disabled).toBe(false);
  view.unmount();
});
