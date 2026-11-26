import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './Toast';

function ToastControls() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.success('已儲存', '你的變更已儲存。')}>儲存</button>
      <button onClick={() => toast.error('同步失敗', '請稍後再試。')}>同步</button>
      <button onClick={() => toast.info('更新完成')}>更新</button>
      <button onClick={() => toast.showToast({ type: 'info', title: '上傳中', duration: 0 })}>
        上傳
      </button>
      <button onClick={() => toast.showToast({ type: 'warning', title: '待確認', duration: -1 })}>
        保留提示
      </button>
      <button onClick={toast.dismissAll}>清除通知</button>
    </>
  );
}

function renderToasts(maxToasts?: number) {
  return render(
    <ToastProvider maxToasts={maxToasts}>
      <ToastControls />
    </ToastProvider>,
  );
}

let visible = true;
let windowFocused = true;

function setVisible(next: boolean) {
  visible = next;
  fireEvent(document, new Event('visibilitychange'));
}

function setWindowFocused(next: boolean) {
  windowFocused = next;
  fireEvent(window, new Event(next ? 'focus' : 'blur'));
}

beforeEach(() => {
  visible = true;
  windowFocused = true;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
    visible ? 'visible' : 'hidden',
  );
  vi.spyOn(document, 'hasFocus').mockImplementation(() => windowFocused);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ToastProvider', () => {
  it('announces ordinary updates as status and errors as alerts with named dismiss buttons', () => {
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    fireEvent.click(screen.getByRole('button', { name: '同步' }));

    expect(screen.getByRole('status').textContent).toContain('已儲存');
    expect(screen.getByRole('alert').textContent).toContain('同步失敗');
    expect(screen.getByRole('alert').getAttribute('aria-atomic')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '關閉通知：已儲存' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('keeps each notification on its original deadline when another notification appears', () => {
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    act(() => vi.advanceTimersByTime(2500));
    fireEvent.click(screen.getByRole('button', { name: '同步' }));

    act(() => vi.advanceTimersByTime(1500));
    expect(screen.queryByText('已儲存')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('同步失敗');
    act(() => vi.advanceTimersByTime(4499));
    expect(screen.getByRole('alert')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('pauses while hovered or focused and resumes only the remaining time after both leave', () => {
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    const notice = screen.getByRole('status').parentElement!;
    const close = screen.getByRole('button', { name: '關閉通知：已儲存' });
    act(() => vi.advanceTimersByTime(1500));

    fireEvent.mouseEnter(notice);
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.focus(close);
    fireEvent.mouseLeave(notice);
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByRole('status')).toBeTruthy();

    fireEvent.blur(close, { relatedTarget: screen.getByRole('button', { name: '儲存' }) });
    act(() => vi.advanceTimersByTime(2499));
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('preserves unread time while the window is unfocused', () => {
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    act(() => vi.advanceTimersByTime(1500));

    setWindowFocused(false);
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByRole('status').textContent).toContain('已儲存');
    expect(vi.getTimerCount()).toBe(0);

    setWindowFocused(true);
    act(() => vi.advanceTimersByTime(2499));
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('waits for both tab visibility and window focus before resuming', () => {
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    act(() => vi.advanceTimersByTime(1000));

    setVisible(false);
    setWindowFocused(false);
    act(() => vi.advanceTimersByTime(10000));
    setWindowFocused(true);
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByRole('status')).toBeTruthy();

    setWindowFocused(false);
    setVisible(true);
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByRole('status')).toBeTruthy();
    setWindowFocused(true);
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('gives notifications created in a background tab their full reading time on return', () => {
    visible = false;
    windowFocused = false;
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: '同步' }));
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByRole('alert').textContent).toContain('同步失敗');
    expect(vi.getTimerCount()).toBe(0);

    setVisible(true);
    setWindowFocused(true);
    act(() => vi.advanceTimersByTime(5999));
    expect(screen.getByRole('alert')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps hover and keyboard reading pauses when the page becomes active again', () => {
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    const notice = screen.getByRole('status').parentElement!;
    const close = screen.getByRole('button', { name: '關閉通知：已儲存' });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.mouseEnter(notice);
    fireEvent.focus(close);
    setVisible(false);
    setWindowFocused(false);
    fireEvent.mouseLeave(notice);
    act(() => vi.advanceTimersByTime(10000));

    setVisible(true);
    setWindowFocused(true);
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.blur(close, { relatedTarget: screen.getByRole('button', { name: '儲存' }) });
    act(() => vi.advanceTimersByTime(3499));
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('preserves independent remaining times when several notifications pause together', () => {
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.click(screen.getByRole('button', { name: '同步' }));
    act(() => vi.advanceTimersByTime(1000));
    setVisible(false);
    act(() => vi.advanceTimersByTime(60000));
    setVisible(true);

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('同步失敗');
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('alert')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['上傳', '上傳中'],
    ['保留提示', '待確認'],
  ])('keeps persistent notification %s until explicitly dismissed', (trigger, title) => {
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: trigger }));
    setWindowFocused(false);
    setVisible(false);
    act(() => vi.advanceTimersByTime(60000));
    setWindowFocused(true);
    setVisible(true);
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByRole('status').textContent).toContain(title);
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: `關閉通知：${title}` }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('cancels removed notification timers when the limit is reached or the list is cleared', () => {
    renderToasts(1);
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    expect(screen.queryByText('已儲存')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('更新完成');
    expect(vi.getTimerCount()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '清除通知' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels pending dismissal when the provider unmounts', () => {
    const view = renderToasts();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not resurrect dismissed notifications after returning from the background', () => {
    const view = renderToasts();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    setWindowFocused(false);
    fireEvent.click(screen.getByRole('button', { name: '清除通知' }));
    setWindowFocused(true);
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.queryByRole('status')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    setVisible(false);
    fireEvent.click(screen.getByRole('button', { name: '同步' }));
    view.unmount();
    setVisible(true);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
