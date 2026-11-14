import { act, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ configured: true, enabled: true, invoke: vi.fn() }));
vi.mock('@/lib/firebase', () => ({
  getDb: () => ({}),
  getFunctionsInstance: () => ({}),
  areFunctionsConfigured: () => mock.configured,
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => mock.invoke }));
vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => args,
  doc: (...args: unknown[]) => args,
  query: (...args: unknown[]) => args[0],
  where: () => ({}),
  onSnapshot: (path: unknown[], next: (snap: unknown) => void) => {
    if (path.length === 3) next({ data: () => ({ dormWorkflowEnabled: mock.enabled }) });
    if (path.includes('packages'))
      next({ docs: [{ id: 'legacy', data: () => ({ description: '舊包裹' }) }] });
    return () => {};
  },
}));
import { subscribeDormCloud } from './cloud';
beforeEach(() => {
  mock.configured = true;
  mock.enabled = true;
  mock.invoke.mockReset();
});
it('keeps the old Firestore path working without Functions', async () => {
  mock.configured = false;
  const update = vi.fn();
  const stop = subscribeDormCloud('tw-pu', 'student', update);
  try {
    await waitFor(() => expect(update.mock.calls.at(-1)?.[0].packages[0].id).toBe('legacy'));
    expect(mock.invoke).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});
it('falls back to the old Firestore path when the endpoint fails', async () => {
  mock.invoke.mockRejectedValue(new Error('unavailable'));
  const update = vi.fn();
  const stop = subscribeDormCloud('tw-pu', 'student', update);
  try {
    await waitFor(() => expect(mock.invoke).toHaveBeenCalled());
    await waitFor(() =>
      expect(update.mock.calls.at(-1)?.[0]).toMatchObject({
        packagesState: 'ready',
        packages: [expect.objectContaining({ id: 'legacy' })],
      }),
    );
  } finally {
    stop();
  }
});
it('uses opaque parcel IDs from the endpoint for an enabled school', async () => {
  mock.invoke.mockResolvedValue({
    data: { rows: [{ id: 'dw_synthetic', data: { description: '合成包裹' } }] },
  });
  const update = vi.fn();
  const stop = subscribeDormCloud('tw-pu', 'student', update);
  try {
    await waitFor(() => expect(update.mock.calls.at(-1)?.[0].packages[0].id).toBe('dw_synthetic'));
  } finally {
    stop();
  }
});
it('reads private parcels even when the school workflow is disabled', async () => {
  mock.enabled = false;
  mock.invoke.mockResolvedValue({
    data: { rows: [{ id: 'dw_disabled', data: { description: '關閉工作台前登錄的包裹' } }] },
  });
  const update = vi.fn();
  const stop = subscribeDormCloud('tw-pu', 'student', update);
  try {
    await waitFor(() => expect(update.mock.calls.at(-1)?.[0].packages[0].id).toBe('dw_disabled'));
  } finally {
    stop();
  }
});
it('retains the last private projection on polling failure and recovers on retry', async () => {
  vi.useFakeTimers();
  mock.invoke
    .mockResolvedValueOnce({
      data: { rows: [{ id: 'dw_cached', data: { description: '待領包裹' } }] },
    })
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValue({
      data: { rows: [{ id: 'dw_cached', data: { status: 'picked_up' } }] },
    });
  const update = vi.fn();
  const stop = subscribeDormCloud('tw-pu', 'student', update);
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(update.mock.calls.at(-1)?.[0]).toMatchObject({
      packagesState: 'ready',
      packages: [expect.objectContaining({ id: 'dw_cached', status: 'waiting' })],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(update.mock.calls.at(-1)?.[0]).toMatchObject({
      packagesState: 'error',
      packages: [expect.objectContaining({ id: 'dw_cached', status: 'waiting' })],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(update.mock.calls.at(-1)?.[0]).toMatchObject({
      packagesState: 'ready',
      packages: [expect.objectContaining({ id: 'dw_cached', status: 'collected' })],
    });
    stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(mock.invoke).toHaveBeenCalledTimes(3);
  } finally {
    stop();
    vi.useRealTimers();
  }
});
