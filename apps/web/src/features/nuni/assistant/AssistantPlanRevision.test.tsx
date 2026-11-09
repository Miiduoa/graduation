import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AssistantPlanRevision } from './AssistantPlanRevision';
import type { V2ActionStates, V2Card, V2Turn } from './types';

function event(id = 'first', args: Record<string, unknown> = {}): V2Card {
  return { tool: 'propose_personal_event', mutationId: id, token: 'private-token-' + id, schoolId: 'pu',
    destination: '個人行事曆', args: { title: '離散數學讀書', date: '2026-11-10', allDay: false, startTime: '20:00', endTime: '21:00', ...args } };
}
const turn = (cards = [event()]): V2Turn => ({ question: '幫我安排讀書', reply: { answer: '請核對確認卡', steps: [], cards } });
const base = { states: {}, pending: false, enabled: true };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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
  expect(onPreview).toHaveBeenCalledExactlyOnceWith('第一項改成明晚 20:00', []);
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

it('distinguishes same-name items by ordinal and exact time and submits only the explicit selection', async () => {
  const onPreview = vi.fn(async () => ({ ok: false, message: '保留條件已收到。' }));
  render(<AssistantPlanRevision {...base} turn={turn([
    event(), event('second', { startTime: '22:00', endTime: '23:00' }),
  ])} onPreview={onPreview} />);
  open();
  const first = screen.getByRole('checkbox', { name: '保留原樣 第 1 項 離散數學讀書 2026-11-10 · 20:00–21:00（台灣時間）' }) as HTMLInputElement;
  const second = screen.getByRole('checkbox', { name: '保留原樣 第 2 項 離散數學讀書 2026-11-10 · 22:00–23:00（台灣時間）' }) as HTMLInputElement;
  expect(first.type).toBe('checkbox');
  expect(first.checked).toBe(false);
  expect(second.checked).toBe(false);
  second.focus();
  expect(document.activeElement).toBe(second);
  fireEvent.click(second);
  expect(first.checked).toBe(false);
  expect(second.checked).toBe(true);
  enter('第一項改到明晚，勾選的第二項保持原樣');
  submit();
  await screen.findByText('保留條件已收到。');
  expect(onPreview).toHaveBeenCalledExactlyOnceWith('第一項改到明晚，勾選的第二項保持原樣', [1]);
});

it('retains the checked items and condition across collapse, rejection and retry, while freezing pending controls', async () => {
  const pending = deferred<{ ok: boolean; message: string }>();
  const onPreview = vi.fn().mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ ok: true, message: '新提議已保留勾選的項目。' });
  render(<AssistantPlanRevision {...base} turn={turn([
    event(), event('second', { title: '程式練習' }),
  ])} onPreview={onPreview} />);
  open(); enter('第二項改成明晚');
  fireEvent.click(screen.getByRole('checkbox', { name: /^保留原樣 第 1 項 / }));
  fireEvent.click(screen.getByRole('button', { name: '收起修改' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '修改時間或條件' }));
  open();
  expect((screen.getByRole('checkbox', { name: /^保留原樣 第 1 項 / }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('第二項改成明晚');
  submit(); submit();
  for (const checkbox of screen.getAllByRole('checkbox')) expect((checkbox as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '收起修改' }) as HTMLButtonElement).disabled).toBe(true);
  expect(onPreview).toHaveBeenCalledExactlyOnceWith('第二項改成明晚', [0]);
  await act(async () => { pending.resolve({ ok: false, message: '新提議未保留勾選項目，沒有加入確認卡。' }); });
  expect(screen.getByRole('alert').textContent).toContain('沒有加入確認卡');
  expect((screen.getByRole('checkbox', { name: /^保留原樣 第 1 項 / }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('checkbox', { name: /^保留原樣 第 2 項 / }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('第二項改成明晚');
  submit();
  await screen.findByText('新提議已保留勾選的項目。');
  expect(onPreview).toHaveBeenNthCalledWith(2, '第二項改成明晚', [0]);
});

it('treats all-protected as a local no-op even with no instruction or a direct form submit', () => {
  const onPreview = vi.fn();
  render(<AssistantPlanRevision {...base} turn={turn([
    event(), event('second', { title: '程式練習' }),
  ])} onPreview={onPreview} />);
  open();
  for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('');
  expect((screen.getByRole('button', { name: '重新預覽' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('status').textContent).toContain('原提議保持不變');
  submit(); submit();
  expect(onPreview).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).toBeNull();
  const back = screen.getByRole('button', { name: '回到原提議' }) as HTMLButtonElement;
  expect(back.type).toBe('button');
  back.focus();
  expect(document.activeElement).toBe(back);
  fireEvent.click(back);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '修改時間或條件' }));
  expect(screen.queryByRole('form', { name: '修改安排再預覽' })).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('原提議保持不變');
  open();
  expect(screen.getAllByRole('checkbox').every(checkbox => (checkbox as HTMLInputElement).checked)).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: /^保留原樣 第 2 項 / }));
  enter('第二項改成明晚');
  expect((screen.getByRole('button', { name: '重新預覽' }) as HTMLButtonElement).disabled).toBe(false);
  expect(onPreview).not.toHaveBeenCalled();
});

it('never claims all-protected selections restore original cards already revoked during a failed revision', async () => {
  const onPreview = vi.fn(async () => ({ ok: false, message: '原卡已撤銷，新提議未完成。' }));
  const original = turn([event(), event('second', { title: '程式練習' })]);
  const view = render(<AssistantPlanRevision {...base} turn={original} onPreview={onPreview} />);
  open(); enter(); submit();
  await screen.findByRole('alert');
  view.rerender(<AssistantPlanRevision {...base} turn={original}
    states={{ first: { status: 'cancelled' }, second: { status: 'cancelled' } }} onPreview={onPreview} />);
  for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  expect(screen.getByRole('status').textContent).toContain('已有項目撤銷，不能恢復原確認卡');
  expect(screen.queryByText(/原提議保持不變/)).toBeNull();
  submit();
  expect(onPreview).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '回到原提議' }));
  expect(screen.getByRole('status').textContent).toContain('不能恢復原確認卡');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '修改時間或條件' }));
});

it('rejects a partially selected exact-duplicate group without expanding the selection or contacting the owner', async () => {
  const onPreview = vi.fn(async () => ({ ok: false, message: '已收到整組保留條件。' }));
  render(<AssistantPlanRevision {...base} turn={turn([
    event(), event('identical'), event('third', { title: '不同的第三項' }),
  ])} onPreview={onPreview} />);
  open(); enter('只修改第三項');
  fireEvent.click(screen.getByRole('checkbox', { name: /^保留原樣 第 1 項 / }));
  submit();
  expect(screen.getByRole('alert').textContent).toContain('完全相同的行程需一起標記保留');
  expect(onPreview).not.toHaveBeenCalled();
  expect((screen.getByRole('checkbox', { name: /^保留原樣 第 1 項 / }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('checkbox', { name: /^保留原樣 第 2 項 / }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('checkbox', { name: /^保留原樣 第 3 項 / }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('checkbox', { name: /^保留原樣 第 2 項 / }));
  submit();
  await screen.findByText('已收到整組保留條件。');
  expect(onPreview).toHaveBeenCalledExactlyOnceWith('只修改第三項', [0, 1]);
});

it('keeps protection choices blocked from preview while an original cancellation result remains unknown', async () => {
  const onPreview = vi.fn(async () => ({ ok: false, message: '撤銷結果仍待核對。' }));
  const original = turn([event(), event('second', { title: '程式練習' })]);
  const view = render(<AssistantPlanRevision {...base} turn={original} onPreview={onPreview} />);
  open(); enter('只改第二項');
  fireEvent.click(screen.getByRole('checkbox', { name: /^保留原樣 第 1 項 / }));
  submit();
  await screen.findByRole('alert');
  view.rerender(<AssistantPlanRevision {...base} turn={original}
    states={{ first: { status: 'cancelled' }, second: { status: 'unknown', message: '待核對' } }} onPreview={onPreview} />);
  expect((screen.getByRole('checkbox', { name: /^保留原樣 第 1 項 / }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText(/請先使用原確認卡的核對流程/)).toBeTruthy();
  submit();
  expect(onPreview).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '收起修改' }));
  expect(document.activeElement).toBe(screen.getByRole('region', { name: '修改行程提議' }));
});

it('clears old protection choices on a new proposal and ignores its predecessor\'s late result', async () => {
  const pending = deferred<{ ok: boolean; message: string }>();
  const onPreview = vi.fn(() => pending.promise);
  const original = turn([event(), event('second', { title: '程式練習' })]);
  const view = render(<AssistantPlanRevision {...base} turn={original} onPreview={onPreview} />);
  open(); enter('舊修改');
  fireEvent.click(screen.getByRole('checkbox', { name: /^保留原樣 第 1 項 / }));
  submit();
  view.rerender(<AssistantPlanRevision {...base} turn={turn([
    event('next-first', { title: '新的第一項' }), event('next-second', { title: '新的第二項' }),
  ])} onPreview={onPreview} />);
  open();
  expect(screen.getAllByRole('checkbox').every(checkbox => !(checkbox as HTMLInputElement).checked)).toBe(true);
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('');
  fireEvent.click(screen.getByRole('checkbox', { name: /^保留原樣 第 2 項 / }));
  enter('新修改');
  await act(async () => { pending.resolve({ ok: true, message: '舊結果不應顯示' }); });
  expect(screen.queryByText('舊結果不應顯示')).toBeNull();
  expect((screen.getByRole('checkbox', { name: /^保留原樣 第 1 項 / }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('checkbox', { name: /^保留原樣 第 2 項 / }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('新修改');
  view.unmount();
  render(<AssistantPlanRevision {...base} turn={original} onPreview={onPreview} />);
  open();
  expect(screen.getAllByRole('checkbox').every(checkbox => !(checkbox as HTMLInputElement).checked)).toBe(true);
});


// Explicit jsdom geometry uses the measured 720px viewport and computed margins:
// 150px dock + 72px bottom clearance + 12px focus gap. Browser QA checks movement.
function focusScrollFixture(top = 526.94) {
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.set(++frameId, callback);
    return frameId;
  });
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  vi.stubGlobal('visualViewport', { offsetTop: 0, height: 720 });
  const view = render(<>
    <AssistantPlanRevision {...base} turn={turn()} onPreview={vi.fn()} />
    <button type="button">表單外的控制項</button>
  </>);
  open(); enter();
  const button = screen.getByRole('button', { name: '重新預覽' });
  const scroll = vi.fn();
  Object.defineProperty(button, 'scrollIntoView', { configurable: true, value: scroll });
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(29, top, 88, 44));
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = computedStyle(element, pseudo);
    if (element === button) {
      style.scrollMarginBlockStart = '12px';
      style.scrollMarginBlockEnd = '234px';
    }
    return style;
  });
  const flush = () => act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(0);
  });
  return { view, button, scroll, request, cancel, frames, flush };
}

it('aligns the bottom of a focused control hidden by the dock even inside the layout viewport', () => {
  const { button, scroll, flush } = focusScrollFixture();
  act(() => button.focus());
  expect(document.activeElement).toBe(button);
  expect(scroll).not.toHaveBeenCalled();
  flush();
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'end', inline: 'nearest', behavior: 'instant' });
});

it('aligns the top of a focused control above the visible area', () => {
  const { button, scroll, flush } = focusScrollFixture(8);
  act(() => button.focus());
  flush();
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'start', inline: 'nearest', behavior: 'instant' });
});

it('does not scroll a focused control fully inside the usable area including its bottom boundary', () => {
  const { button, scroll, flush } = focusScrollFixture(442);
  act(() => button.focus());
  flush();
  expect(scroll).not.toHaveBeenCalled();
});

it('does not schedule another scroll request for typing or checkbox state changes', () => {
  const { button, scroll, request, flush } = focusScrollFixture();
  act(() => button.focus());
  flush();
  expect(scroll).toHaveBeenCalledOnce();
  request.mockClear();
  scroll.mockClear();
  enter('更新條件而不重新聚焦');
  fireEvent.click(screen.getByRole('checkbox', { name: /^保留原樣 第 1 項 / }));
  expect(request).not.toHaveBeenCalled();
  expect(scroll).not.toHaveBeenCalled();
});

it('does not request scrolling after focus has moved outside the revision form', () => {
  const { button, scroll, flush } = focusScrollFixture();
  act(() => button.focus());
  act(() => screen.getByRole('button', { name: '表單外的控制項' }).focus());
  flush();
  expect(scroll).not.toHaveBeenCalled();
});

it('cancels a pending focus frame on unmount and ignores a late callback from the old proposal', () => {
  const { view, button, scroll, cancel, frames } = focusScrollFixture();
  act(() => button.focus());
  const [id, lateCallback] = [...frames.entries()][0];
  view.unmount();
  expect(cancel).toHaveBeenCalledWith(id);
  expect(frames.size).toBe(0);
  act(() => lateCallback(0));
  expect(scroll).not.toHaveBeenCalled();
});
