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

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

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

  it('keeps duration-zero notifications available until explicitly dismissed', () => {
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: '上傳' }));
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByRole('status').textContent).toContain('上傳中');
    fireEvent.click(screen.getByRole('button', { name: '關閉通知：上傳中' }));
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
});
