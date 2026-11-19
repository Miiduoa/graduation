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
function focusScrollFixture(top = 526.94, nested = false) {
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.set(++frameId, callback);
    return frameId;
  });
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  vi.stubGlobal('visualViewport', { offsetTop: 0, height: 720 });
  const content = <>
    <AssistantPlanRevision {...base} turn={turn()} onPreview={vi.fn()} />
    <button type="button">表單外的控制項</button>
  </>;
  const view = render(nested ? <div data-testid="nested-scroll">{content}</div> : content);
  open(); enter();
  const button = screen.getByRole('button', { name: '重新預覽' });
  const scroll = vi.fn();
  Object.defineProperty(button, 'scrollIntoView', { configurable: true, value: scroll });
  const bounds = vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(29, top, 88, 44));
  button.style.setProperty('--assistant-focus-rounding-buffer', '1px');
  button.style.scrollMarginBlockStart = '13px';
  button.style.scrollMarginBlockEnd = '235px';
  const flush = () => act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(0);
  });
  return { view, button, scroll, bounds, request, cancel, frames, flush };
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

function nativeTabScrollFixture(top = 404.84375, nested = false) {
  const fixture = focusScrollFixture(top, nested);
  const originalScroll = 1922;
  vi.stubGlobal('scrollX', 0);
  vi.stubGlobal('scrollY', originalScroll);
  vi.mocked(fixture.button.getBoundingClientRect).mockImplementation(() =>
    new DOMRect(29, top + originalScroll - window.scrollY, 88, 44));
  const pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation((first?: ScrollToOptions | number, second?: number) => {
    const options = typeof first === 'number' ? { left: first, top: second } : first;
    vi.stubGlobal('scrollX', options?.left ?? window.scrollX);
    vi.stubGlobal('scrollY', options?.top ?? window.scrollY);
  });
  const field = screen.getByLabelText('修改條件');
  return { ...fixture, field, pageScroll, originalScroll };
}

it.each([false, true])('preserves a readable control when native Tab scroll races the earlier reveal (reverse=%s)', shiftKey => {
  const { button, field, scroll, flush, pageScroll, originalScroll } = nativeTabScrollFixture();
  fireEvent.keyDown(field, { key: 'Tab', shiftKey });
  // Chromium evidence: the action was already readable at 1922, then native
  // focus moved to 1861 before the product's deferred focus correction ran.
  vi.stubGlobal('scrollY', 1861);
  act(() => button.focus());
  flush();
  expect(document.activeElement).toBe(button);
  expect(window.scrollY).toBe(originalScroll);
  expect(pageScroll).toHaveBeenCalledExactlyOnceWith({ left: 0, top: originalScroll, behavior: 'instant' });
  expect(scroll).not.toHaveBeenCalled();
});

it('still reveals a keyboard-focused control that was hidden before Tab', () => {
  const { button, field, scroll, flush, pageScroll } = nativeTabScrollFixture(526.94);
  fireEvent.keyDown(field, { key: 'Tab' });
  act(() => button.focus());
  flush();
  expect(pageScroll).not.toHaveBeenCalled();
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'end', inline: 'nearest', behavior: 'instant' });
});

it.each([
  { key: 'Enter' },
  { key: 'Tab', ctrlKey: true },
  { key: 'Tab', metaKey: true },
  { key: 'Tab', altKey: true },
  { key: 'Tab', isComposing: true },
])('does not preserve a Tab position for another keyboard interaction %j', keyboard => {
  const { button, field, scroll, flush, pageScroll } = nativeTabScrollFixture();
  fireEvent.keyDown(field, keyboard);
  vi.stubGlobal('scrollY', 1861);
  act(() => button.focus());
  flush();
  expect(pageScroll).not.toHaveBeenCalled();
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'end', inline: 'nearest', behavior: 'instant' });
});

it.each(['next frame', 'pointer', 'prevented Tab'] as const)('does not reuse a Tab snapshot after %s', reason => {
  const { button, field, scroll, flush, pageScroll } = nativeTabScrollFixture();
  const keyboard = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  fireEvent(field, keyboard);
  if (reason === 'next frame') flush();
  if (reason === 'pointer') fireEvent.pointerDown(button);
  if (reason === 'prevented Tab') keyboard.preventDefault();
  vi.stubGlobal('scrollY', 1861);
  act(() => button.focus());
  flush();
  expect(pageScroll).not.toHaveBeenCalled();
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'end', inline: 'nearest', behavior: 'instant' });
});

it('does not restore a Tab position after focus leaves the revision panel', () => {
  const { button, field, scroll, flush, pageScroll } = nativeTabScrollFixture();
  fireEvent.keyDown(field, { key: 'Tab' });
  vi.stubGlobal('scrollY', 1861);
  act(() => button.focus());
  const outside = screen.getByRole('button', { name: '表單外的控制項' });
  act(() => outside.focus());
  flush();
  expect(document.activeElement).toBe(outside);
  expect(pageScroll).not.toHaveBeenCalled();
  expect(scroll).not.toHaveBeenCalled();
});

it.each([false, true])('preserves nested reading position only if the target was not clipped (clipped=%s)', clipped => {
  const { button, field, scroll, flush, pageScroll, originalScroll } = nativeTabScrollFixture(404.84375, true);
  const container = screen.getByTestId('nested-scroll');
  container.style.overflowY = 'auto';
  container.scrollTop = 200;
  Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 900 });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: clipped ? 200 : 400 });
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(16, 100, 288, clipped ? 200 : 400));
  const nestedScroll = vi.fn((options: ScrollToOptions) => { container.scrollTop = options.top ?? 0; });
  Object.defineProperty(container, 'scrollTo', { configurable: true, value: nestedScroll });
  vi.mocked(button.getBoundingClientRect).mockImplementation(() =>
    new DOMRect(29, 404.84375 + originalScroll - window.scrollY + 200 - container.scrollTop, 88, 44));
  fireEvent.keyDown(field, { key: 'Tab' });
  if (clipped) container.scrollTop = 360;
  else {
    container.scrollTop = 160;
    vi.stubGlobal('scrollY', 1861);
  }
  act(() => button.focus());
  flush();
  expect(scroll).not.toHaveBeenCalled();
  if (clipped) {
    expect(container.scrollTop).toBe(360);
    expect(nestedScroll).not.toHaveBeenCalled();
    expect(pageScroll).not.toHaveBeenCalled();
  } else {
    expect(container.scrollTop).toBe(200);
    expect(window.scrollY).toBe(originalScroll);
    expect(nestedScroll).toHaveBeenCalledExactlyOnceWith({ left: 0, top: 200, behavior: 'instant' });
  }
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

function visibleTabFixture(top = 376.84375) {
  const fixture = focusScrollFixture(top);
  const documentScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const panel = screen.getByRole('region', { name: '修改行程提議' });
  for (const target of panel.querySelectorAll('button, input, textarea')) {
    if (target !== fixture.button)
      vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(29, 200, 100, 44));
  }
  return { ...fixture, documentScroll, panel, field: screen.getByLabelText('修改條件'),
    entry: screen.getByRole('button', { name: '修改時間或條件' }),
    back: screen.getByRole('button', { name: '收起修改' }), focus: vi.spyOn(fixture.button, 'focus') };
}

it.each([false, true])('keeps a visible native Tab target readable (shift=%s)', shiftKey => {
  const { button, field, back, scroll, focus, flush } = visibleTabFixture();
  const from = shiftKey ? back : field;
  act(() => from.focus());
  expect(fireEvent.keyDown(from, { key: 'Tab', shiftKey })).toBe(true);
  expect(focus).not.toHaveBeenCalled();
  act(() => button.focus()); // jsdom does not perform native Tab navigation.
  expect(document.activeElement).toBe(button);
  flush();
  expect(scroll).not.toHaveBeenCalled();
});

it.each([
  { edge: 'top', top: 12.859375 },
  { edge: 'bottom', top: 441.140625 },
])('accepts a rounded $edge alignment that still preserves the full 12px clearance', ({ top }) => {
  const { button, field, scroll, focus, flush } = visibleTabFixture(top);
  expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true);
  expect(focus).not.toHaveBeenCalled();
  act(() => button.focus());
  expect(document.activeElement).toBe(button);
  flush();
  expect(scroll).not.toHaveBeenCalled();
});

it.each([
  { edge: 'top', top: 11.859375, block: 'start' },
  { edge: 'bottom', top: 442.140625, block: 'end' },
])('still reveals a $edge gap below 12px instead of treating rounding as visibility tolerance', ({ top, block }) => {
  const { button, field, scroll, documentScroll, focus, flush } = visibleTabFixture(top);
  expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true);
  expect(focus).not.toHaveBeenCalled();
  expect(documentScroll).not.toHaveBeenCalled();
  act(() => button.focus()); // Emulate the native Tab target after the guard deferred.
  flush();
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block, inline: 'nearest', behavior: 'instant' });
});

it.each([false, true])('restores the reading position after visible native Tab focus (shift=%s)', shiftKey => {
  const { button, field, back, scroll, documentScroll, focus, flush } = visibleTabFixture(406.84375);
  const from = shiftKey ? back : field;
  act(() => from.focus());
  const position = { x: 31.25, y: 1920.5 };
  vi.stubGlobal('scrollX', position.x);
  vi.stubGlobal('scrollY', position.y);
  expect(fireEvent.keyDown(from, { key: 'Tab', shiftKey })).toBe(true);
  expect(focus).not.toHaveBeenCalled();
  expect(documentScroll).not.toHaveBeenCalled();
  act(() => button.focus()); // Emulate the browser's native focus transfer.
  flush();
  expect(document.activeElement).toBe(button);
  expect({ x: window.scrollX, y: window.scrollY }).toEqual(position);
  expect(documentScroll).toHaveBeenCalledExactlyOnceWith({ left: position.x, top: position.y, behavior: 'instant' });
  expect(scroll).not.toHaveBeenCalled();
});

it.each([false, true])('lets native Tab (shift=%s) leave the panel without wrapping focus', shiftKey => {
  const { entry, back, scroll, documentScroll, focus, flush } = visibleTabFixture();
  const from = shiftKey ? entry : back;
  const outside = screen.getByRole('button', { name: '表單外的控制項' });
  act(() => from.focus());
  expect(fireEvent.keyDown(from, { key: 'Tab', shiftKey })).toBe(true);
  expect(document.activeElement).toBe(from);
  expect(focus).not.toHaveBeenCalled();
  expect(documentScroll).not.toHaveBeenCalled();
  // jsdom does not perform the browser's default Tab action.
  act(() => outside.focus());
  flush();
  expect(document.activeElement).toBe(outside);
  expect(scroll).not.toHaveBeenCalled();
});

it.each(['disabled', 'negative tabindex', 'hidden'])('leaves skipping a %s control to native Tab order', skipped => {
  const { button, field, back, focus } = visibleTabFixture();
  if (skipped === 'disabled') (button as HTMLButtonElement).disabled = true;
  else if (skipped === 'negative tabindex') button.tabIndex = -1;
  else button.hidden = true;
  const backFocus = vi.spyOn(back, 'focus');
  expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true);
  expect(backFocus).not.toHaveBeenCalled();
  act(() => back.focus()); // Native Tab skips the unavailable control.
  expect(document.activeElement).toBe(back);
  expect(focus).not.toHaveBeenCalled();
});

it('does not skip an occluded next control to reach a later visible one, and keeps native reveal', () => {
  const { button, field, back, scroll, documentScroll, focus, flush } = visibleTabFixture(526.94);
  const backFocus = vi.spyOn(back, 'focus');
  expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true);
  expect(document.activeElement).toBe(field);
  expect(focus).not.toHaveBeenCalled();
  expect(backFocus).not.toHaveBeenCalled();
  expect(documentScroll).not.toHaveBeenCalled();
  act(() => button.focus()); // Native Tab may still need scrolling to reveal this control.
  flush();
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'end', inline: 'nearest', behavior: 'instant' });
});

it('leaves positive tabindex ordering to the browser', () => {
  const { field, entry, documentScroll, focus } = visibleTabFixture();
  entry.tabIndex = 1;
  expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true);
  expect(document.activeElement).toBe(field);
  expect(focus).not.toHaveBeenCalled();
  expect(documentScroll).not.toHaveBeenCalled();
});

it('leaves a panel with a nonstandard Tab stop to the browser', () => {
  const { panel, field, documentScroll, focus } = visibleTabFixture();
  const link = document.createElement('a');
  link.href = '#details';
  link.textContent = '額外連結';
  panel.append(link);
  vi.spyOn(link, 'getBoundingClientRect').mockReturnValue(new DOMRect(29, 200, 100, 44));
  expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true);
  expect(document.activeElement).toBe(field);
  expect(focus).not.toHaveBeenCalled();
  expect(documentScroll).not.toHaveBeenCalled();
});

it('preserves native scrolling inside an inline or clipping ancestor', () => {
  const { panel, field, documentScroll, focus } = visibleTabFixture();
  panel.parentElement!.style.overflowY = 'auto';
  expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true);
  expect(document.activeElement).toBe(field);
  expect(focus).not.toHaveBeenCalled();
  expect(documentScroll).not.toHaveBeenCalled();
});

it('respects a descendant handler that already cancelled Tab', () => {
  const { field, documentScroll, focus } = visibleTabFixture();
  field.addEventListener('keydown', event => event.preventDefault(), { once: true });
  expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(false);
  expect(document.activeElement).toBe(field);
  expect(focus).not.toHaveBeenCalled();
  expect(documentScroll).not.toHaveBeenCalled();
});

it('does not intercept modified Tab shortcuts or ordinary typing', () => {
  const { field, documentScroll, focus } = visibleTabFixture();
  for (const modifiers of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }])
    expect(fireEvent.keyDown(field, { key: 'Tab', ...modifiers })).toBe(true);
  expect(fireEvent.keyDown(field, { key: 'a' })).toBe(true);
  expect(document.activeElement).toBe(field);
  expect(focus).not.toHaveBeenCalled();
  expect(documentScroll).not.toHaveBeenCalled();
});

it.each([false, true])('keeps owned editor focus reachable with a nested scroller present=%s', nested => {
  const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  const onPreview = vi.fn();
  render(<div style={nested ? { overflowY: 'auto' } : undefined}>
    <AssistantPlanRevision {...base} turn={turn()} draft={draftBridge()} onPreview={onPreview} />
  </div>);
  const expectOwnedFocus = (target: HTMLElement) => {
    expect(document.activeElement).toBe(target);
    if (nested) expect(focus).toHaveBeenCalledExactlyOnceWith();
    else expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  };
  open();
  const field = screen.getByLabelText('修改條件');
  expectOwnedFocus(field);
  const clickFromFocus = (name: string) => {
    const button = screen.getByRole('button', { name });
    act(() => button.focus({ preventScroll: true }));
    focus.mockClear();
    fireEvent.click(button);
  };
  clickFromFocus('套用已恢復的草稿');
  expectOwnedFocus(field);
  clickFromFocus('清除修改內容');
  expectOwnedFocus(field);
  enter('改'.repeat(301));
  act(() => screen.getByRole('button', { name: '重新預覽' }).focus({ preventScroll: true }));
  focus.mockClear();
  submit();
  expectOwnedFocus(field);
  expect(onPreview).not.toHaveBeenCalled();
  clickFromFocus('收起修改');
  expectOwnedFocus(screen.getByRole('button', { name: '修改時間或條件' }));
});

it('reveals the owned textarea focus instantly after opening without starting native focus scrolling', () => {
  const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  const { flush } = focusScrollFixture();
  const field = screen.getByLabelText('修改條件');
  const scroll = vi.fn();
  Object.defineProperty(field, 'scrollIntoView', { configurable: true, value: scroll });
  vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(new DOMRect(29, 730, 200, 96));
  expect(document.activeElement).toBe(field);
  expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  expect(scroll).not.toHaveBeenCalled();
  flush();
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'end', inline: 'nearest', behavior: 'instant' });
});

it('preserves native focus reveal for the panel fallback when its entry is disabled', () => {
  const original = turn();
  const onPreview = vi.fn();
  const view = render(<AssistantPlanRevision {...base} turn={original} onPreview={onPreview} />);
  open();
  view.rerender(<AssistantPlanRevision {...base} enabled={false} turn={original} onPreview={onPreview} />);
  const panel = screen.getByRole('region', { name: '修改行程提議' });
  const focus = vi.spyOn(panel, 'focus');
  fireEvent.click(screen.getByRole('button', { name: '收起修改' }));
  expect(document.activeElement).toBe(panel);
  expect(focus).toHaveBeenCalledExactlyOnceWith();
});

function draftBridge() {
  return {
    status: '',
    recovery: { id: 'recovered-draft', sameContent: true },
    onChange: vi.fn(),
    onClear: vi.fn(() => ({ ok: true, message: '已清除本份修改。' })),
    onApply: vi.fn(() => ({ ok: true, content: { instruction: '第二項改到明晚', protectedIndices: [0] } })),
  };
}

it('reports draft changes only from actual text and checkbox changes, never opening, closing or rerendering', () => {
  const draft = draftBridge();
  const original = turn([event(), event('second', { title: '程式練習' })]);
  const view = render(<AssistantPlanRevision {...base} turn={original} draft={draft} onPreview={vi.fn()} />);
  open();
  expect(draft.onChange).not.toHaveBeenCalled();
  enter('第二項改到明晚');
  expect(draft.onChange).toHaveBeenLastCalledWith('第二項改到明晚', []);
  fireEvent.click(screen.getByRole('checkbox', { name: /^保留原樣 第 1 項 / }));
  expect(draft.onChange).toHaveBeenLastCalledWith('第二項改到明晚', [0]);
  fireEvent.click(screen.getByRole('checkbox', { name: /^保留原樣 第 1 項 / }));
  expect(draft.onChange).toHaveBeenLastCalledWith('第二項改到明晚', []);
  expect(draft.onChange).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByRole('button', { name: '收起修改' }));
  open();
  view.rerender(<AssistantPlanRevision {...base} turn={original} draft={{ ...draft, status: '暫存已更新。', recovery: { id: 'new-recovery', sameContent: false } }} onPreview={vi.fn()} />);
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('第二項改到明晚');
  expect(draft.onChange).toHaveBeenCalledTimes(3);
  expect(draft.onApply).not.toHaveBeenCalled();
  expect(draft.onClear).not.toHaveBeenCalled();
});

it.each([true, false])('applies a restored draft only on explicit action, with same-content matching %s', sameContent => {
  const draft = draftBridge();
  draft.recovery.sameContent = sameContent;
  draft.onApply.mockReturnValue({ ok: true, content: { instruction: '恢復的條件', protectedIndices: sameContent ? [0] : [] } });
  const onPreview = vi.fn();
  render(<AssistantPlanRevision {...base} turn={turn([event(), event('second', { title: '程式練習' })])} draft={draft} onPreview={onPreview} />);
  open(); enter('目前輸入');
  fireEvent.click(screen.getByRole('checkbox', { name: /^保留原樣 第 2 項 / }));
  draft.onChange.mockClear();
  expect(screen.getByText(sameContent ? '目前提議內容逐欄相同，可帶回保留選項。' : '只帶入文字，保留項目須重新選擇。')).toBeTruthy();
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('目前輸入');
  const apply = screen.getByRole('button', { name: '套用已恢復的草稿' }) as HTMLButtonElement;
  expect(apply.type).toBe('button');
  apply.focus();
  fireEvent.click(apply);
  expect(draft.onApply).toHaveBeenCalledOnce();
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('恢復的條件');
  expect((screen.getByRole('checkbox', { name: /^保留原樣 第 1 項 / }) as HTMLInputElement).checked).toBe(sameContent);
  expect((screen.getByRole('checkbox', { name: /^保留原樣 第 2 項 / }) as HTMLInputElement).checked).toBe(false);
  expect(document.activeElement).toBe(screen.getByLabelText('修改條件'));
  expect(screen.getByRole('status').textContent).toContain('請核對後再重新預覽');
  expect(draft.onChange).not.toHaveBeenCalled();
  expect(onPreview).not.toHaveBeenCalled();
});

it('keeps the current instruction and selections when applying a draft fails', () => {
  const draft = { ...draftBridge(), onApply: vi.fn(() => ({ ok: false, message: '草稿已過期，沒有套用。' })) };
  const onPreview = vi.fn();
  render(<AssistantPlanRevision {...base} turn={turn([event(), event('second', { title: '程式練習' })])} draft={draft} onPreview={onPreview} />);
  open(); enter('目前條件');
  fireEvent.click(screen.getByRole('checkbox', { name: /^保留原樣 第 2 項 / }));
  fireEvent.click(screen.getByRole('button', { name: '套用已恢復的草稿' }));
  expect(screen.getByRole('alert').textContent).toBe('草稿已過期，沒有套用。');
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('目前條件');
  expect((screen.getByRole('checkbox', { name: /^保留原樣 第 2 項 / }) as HTMLInputElement).checked).toBe(true);
  expect(onPreview).not.toHaveBeenCalled();
});

it('clears only after the owner confirms removal and otherwise retains the full local draft', () => {
  const draft = draftBridge();
  draft.onClear.mockReturnValueOnce({ ok: false, message: '暫存無法清除，內容仍保留。' });
  const onPreview = vi.fn();
  render(<AssistantPlanRevision {...base} turn={turn([event(), event('second', { title: '程式練習' })])} draft={draft} onPreview={onPreview} />);
  open(); enter('保留到清除成功');
  fireEvent.click(screen.getByRole('checkbox', { name: /^保留原樣 第 1 項 / }));
  draft.onChange.mockClear();
  const clear = screen.getByRole('button', { name: '清除修改內容' }) as HTMLButtonElement;
  expect(clear.type).toBe('button');
  fireEvent.click(clear);
  expect(screen.getByRole('alert').textContent).toContain('內容仍保留');
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('保留到清除成功');
  expect((screen.getByRole('checkbox', { name: /^保留原樣 第 1 項 / }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(clear);
  expect((screen.getByLabelText('修改條件') as HTMLTextAreaElement).value).toBe('');
  expect(screen.getAllByRole('checkbox').every(node => !(node as HTMLInputElement).checked)).toBe(true);
  expect(screen.getByRole('status').textContent).toBe('已清除本份修改。');
  expect(document.activeElement).toBe(screen.getByLabelText('修改條件'));
  expect(draft.onClear).toHaveBeenCalledTimes(2);
  expect(draft.onChange).not.toHaveBeenCalled();
  expect(onPreview).not.toHaveBeenCalled();
});

it('blocks apply while pending or awaiting reconciliation but allows local clearing after pending ends', () => {
  const draft = draftBridge();
  const original = turn();
  const onPreview = vi.fn();
  const view = render(<AssistantPlanRevision {...base} turn={original} draft={draft} onPreview={onPreview} />);
  open(); enter('修改條件');
  view.rerender(<AssistantPlanRevision {...base} turn={original} pending draft={draft} onPreview={onPreview} />);
  const apply = screen.getByRole('button', { name: '套用已恢復的草稿' }) as HTMLButtonElement;
  const clear = screen.getByRole('button', { name: '清除修改內容' }) as HTMLButtonElement;
  expect(apply.disabled).toBe(true);
  expect(clear.disabled).toBe(true);
  fireEvent.click(apply); fireEvent.click(clear);
  expect(draft.onApply).not.toHaveBeenCalled();
  expect(draft.onClear).not.toHaveBeenCalled();
  view.rerender(<AssistantPlanRevision {...base} turn={original} states={{ other: { status: 'unknown', message: '待核對' } }} draft={draft} onPreview={onPreview} />);
  expect(apply.disabled).toBe(true);
  expect(clear.disabled).toBe(false);
  fireEvent.click(apply); fireEvent.click(clear);
  expect(draft.onApply).not.toHaveBeenCalled();
  expect(draft.onClear).toHaveBeenCalledOnce();
  expect(onPreview).not.toHaveBeenCalled();
});


it.each([
  { label: '套用已恢復的草稿', ok: true },
  { label: '清除修改內容', ok: true },
  { label: '套用已恢復的草稿', ok: false },
  { label: '清除修改內容', ok: false },
])('announces $label result only once when owner status repeats the same message (ok=$ok)', ({ label, ok }) => {
  const message = ok ? '修改草稿已更新。' : '草稿操作失敗，內容仍保留。';
  const draft = {
    ...draftBridge(), status: message,
    onApply: vi.fn(() => ({ ok, message, content: { instruction: '恢復的條件', protectedIndices: [] } })),
    onClear: vi.fn(() => ({ ok, message })),
  };
  render(<AssistantPlanRevision {...base} turn={turn()} draft={draft} onPreview={vi.fn()} />);
  open(); enter('目前修改');
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(screen.getAllByText(message)).toHaveLength(1);
  expect(screen.getByRole(ok ? 'status' : 'alert').textContent).toBe(message);
  expect(screen.queryByRole(ok ? 'alert' : 'status')).toBeNull();
});
