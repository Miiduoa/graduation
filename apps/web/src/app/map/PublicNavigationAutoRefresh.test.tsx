import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicNavigationTask, type PublicTaskPort } from './PublicNavigationTask';

const id = 'pago_00000000-0000-4000-8000-000000000001';
const makePort = (call: PublicTaskPort['call'], scope = 'a') =>
  ({
    scope,
    schoolId: 'pu',
    schoolName: '測試校園',
    call,
  }) satisfies PublicTaskPort;
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('waiting for an existing navigation task', () => {
  it('checks again while visible until unknown can be reconciled without executing', async () => {
    vi.useFakeTimers();
    const call = vi
      .fn<PublicTaskPort['call']>()
      .mockResolvedValueOnce({ status: 'pending', operationId: id })
      .mockResolvedValue({ status: 'unknown', operationId: id });
    render(<PublicNavigationTask port={makePort(call)} />);
    await flush();
    expect(call.mock.calls.map(([action]) => action)).toEqual(['status']);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(call.mock.calls.map(([action]) => action)).toEqual(['status', 'status']);
    expect(screen.getByRole('button', { name: '確認是否已送出' })).toBeTruthy();
  });
  it('stops after twelve checks and allows a deliberate restart', async () => {
    vi.useFakeTimers();
    const call = vi.fn<PublicTaskPort['call']>(async () => ({
      status: 'pending',
      operationId: id,
    }));
    render(<PublicNavigationTask port={makePort(call)} />);
    await flush();
    for (let i = 0; i < 12; i++)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
    expect(call).toHaveBeenCalledTimes(13);
    expect(screen.getByText('自動查詢已暫停，可手動查詢。')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(call).toHaveBeenCalledTimes(13);
    fireEvent.click(screen.getByRole('button', { name: '恢復自動查詢' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(call).toHaveBeenCalledTimes(14);
    expect(call.mock.calls.every(([action]) => action === 'status')).toBe(true);
  });
  it('pauses in a background tab and resumes only after returning', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const call = vi.fn<PublicTaskPort['call']>(async () => ({
      status: 'pending',
      operationId: id,
    }));
    render(<PublicNavigationTask port={makePort(call)} />);
    await flush();
    visibility.mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(call).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('stops and permits a manual retry after a status error', async () => {
    vi.useFakeTimers();
    const call = vi
      .fn<PublicTaskPort['call']>()
      .mockResolvedValueOnce({ status: 'pending', operationId: id })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ status: 'unknown', operationId: id });
    render(<PublicNavigationTask port={makePort(call)} />);
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByText('無法確認先前任務狀態，請重新查詢。')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(call).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '查詢原任務' }));
    await flush();
    expect(screen.getByRole('button', { name: '確認是否已送出' })).toBeTruthy();
    expect(call.mock.calls.map(([action]) => action)).toEqual(['status', 'status', 'status']);
  });
  it('aborts a late status on account change and never displays the old result', async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    const call = vi
      .fn<PublicTaskPort['call']>()
      .mockResolvedValueOnce({ status: 'pending', operationId: id })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const nextCall = vi.fn<PublicTaskPort['call']>(async () => null);
    const view = render(<PublicNavigationTask port={makePort(call)} />);
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    const signal = call.mock.calls[1][2];
    view.rerender(<PublicNavigationTask port={makePort(nextCall, 'b')} />);
    await flush();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish({ status: 'unknown', operationId: id });
    });
    expect(screen.queryByRole('button', { name: '確認是否已送出' })).toBeNull();
    expect(screen.getByLabelText('起點與終點')).toBeTruthy();
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(nextCall).toHaveBeenCalledTimes(1);
  });
  it('lets the user stop waiting and ignores the cancelled response', async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    const call = vi
      .fn<PublicTaskPort['call']>()
      .mockResolvedValueOnce({ status: 'pending', operationId: id })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce({ status: 'unknown', operationId: id });
    render(<PublicNavigationTask port={makePort(call)} />);
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    fireEvent.click(screen.getByRole('button', { name: '停止等待' }));
    expect(call.mock.calls[1][2].aborted).toBe(true);
    await act(async () => {
      finish({ status: 'completed', operationId: id });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(call).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('先前任務已完成。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查詢原任務' }));
    await flush();
    expect(screen.getByRole('button', { name: '確認是否已送出' })).toBeTruthy();
  });
  it('stays paused until the user resumes and never submits automatically', async () => {
    vi.useFakeTimers();
    const call = vi.fn<PublicTaskPort['call']>(async () => ({
      status: 'pending',
      operationId: id,
    }));
    render(<PublicNavigationTask port={makePort(call)} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '停止自動查詢' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(call).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '查詢原任務' }));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(call).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '恢復自動查詢' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(call.mock.calls.map(([action]) => action)).toEqual(['status', 'status', 'status']);
  });
  it('rejects a late response from the previous campus', async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    const call = vi
      .fn<PublicTaskPort['call']>()
      .mockResolvedValueOnce({ status: 'pending', operationId: id })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const nextCall = vi.fn<PublicTaskPort['call']>(async () => null);
    const view = render(<PublicNavigationTask port={makePort(call)} />);
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    view.rerender(<PublicNavigationTask port={{ ...makePort(nextCall), schoolId: 'other' }} />);
    await flush();
    expect(call.mock.calls[1][2].aborted).toBe(true);
    await act(async () => {
      finish({ status: 'unknown', operationId: id });
    });
    expect(screen.queryByRole('button', { name: '確認是否已送出' })).toBeNull();
    expect(screen.getByLabelText('起點與終點')).toBeTruthy();
  });
});
