import { act, waitFor } from '@testing-library/react-native';

const mockState = {
  configured: 'https://synthetic.invalid' as string | null,
  enabled: true,
  invoke: jest.fn(),
  parcelNext: null as null | ((snap: unknown) => void),
};
jest.mock('../firebase', () => ({
  getDb: () => ({}),
  getFunctionsInstance: () => ({}),
  getFunctionsBaseUrl: () => mockState.configured,
}));
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockState.invoke }));
jest.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => args,
  doc: (...args: unknown[]) => args,
  query: (...args: unknown[]) => args[0],
  where: () => ({}),
  onSnapshot: (path: unknown[], next: (snap: unknown) => void) => {
    if (path.length === 3) next({ data: () => ({ dormWorkflowEnabled: mockState.enabled }) });
    if (path.includes('packages')) {
      mockState.parcelNext = next;
      next({
        docs: [{ id: 'legacy', data: () => ({ description: '舊包裹', publicId: 'dw_legacy' }) }],
      });
    }
    return () => {};
  },
}));
import { subscribeDormCloud } from '../services/dormitoryCloud';
beforeEach(() => {
  mockState.configured = 'https://synthetic.invalid';
  mockState.enabled = true;
  mockState.invoke.mockReset();
});
it('keeps the old Firestore path working without Functions', async () => {
  mockState.configured = null;
  const update = jest.fn();
  const stop = subscribeDormCloud('tw-pu', 'student', update);
  try {
    await waitFor(() => expect(update.mock.calls.at(-1)?.[0].packages[0].id).toBe('dw_legacy'));
    expect(mockState.invoke).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});
it('falls back to the old Firestore path when the endpoint fails', async () => {
  mockState.invoke.mockRejectedValue(new Error('unavailable'));
  const update = jest.fn();
  const stop = subscribeDormCloud('tw-pu', 'student', update);
  try {
    await waitFor(() => expect(mockState.invoke).toHaveBeenCalled());
    await waitFor(() =>
      expect(update.mock.calls.at(-1)?.[0]).toMatchObject({
        packagesState: 'ready',
        packages: [expect.objectContaining({ id: 'dw_legacy' })],
      }),
    );
  } finally {
    stop();
  }
});
it('uses opaque parcel IDs from the endpoint for an enabled school', async () => {
  mockState.invoke.mockResolvedValue({
    data: { rows: [{ id: 'dw_synthetic', data: { description: '合成包裹' } }] },
  });
  const update = jest.fn();
  const stop = subscribeDormCloud('tw-pu', 'student', update);
  try {
    await waitFor(() => expect(update.mock.calls.at(-1)?.[0].packages[0].id).toBe('dw_synthetic'));
  } finally {
    stop();
  }
});
it('reads private parcels even when the school workflow is disabled', async () => {
  mockState.enabled = false;
  mockState.invoke.mockResolvedValue({
    data: { rows: [{ id: 'dw_disabled', data: { description: '關閉工作台前登錄的包裹' } }] },
  });
  const update = jest.fn();
  const stop = subscribeDormCloud('tw-pu', 'student', update);
  try {
    await waitFor(() => expect(update.mock.calls.at(-1)?.[0].packages[0].id).toBe('dw_disabled'));
  } finally {
    stop();
  }
});
it('retains the last private projection on polling failure and recovers on retry', async () => {
  jest.useFakeTimers();
  mockState.invoke
    .mockResolvedValueOnce({
      data: {
        rows: [
          { id: 'dw_cached', data: { description: '待領包裹' } },
          { id: 'dw_legacy', data: { description: '舊包裹' } },
        ],
      },
    })
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValue({
      data: { rows: [{ id: 'dw_cached', data: { status: 'picked_up' } }] },
    });
  const update = jest.fn();
  const stop = subscribeDormCloud('tw-pu', 'student', update);
  try {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(update.mock.calls.at(-1)?.[0]).toMatchObject({
      packagesState: 'ready',
      packages: expect.arrayContaining([
        expect.objectContaining({ id: 'dw_cached', status: 'waiting' }),
      ]),
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60000);
    });
    expect(update.mock.calls.at(-1)?.[0]).toMatchObject({
      packagesState: 'error',
      packages: expect.arrayContaining([
        expect.objectContaining({ id: 'dw_cached', status: 'waiting' }),
      ]),
    });
    act(() => {
      mockState.parcelNext?.({
        docs: [
          {
            id: 'legacy',
            data: () => ({
              publicId: 'dw_legacy',
              description: '即時更新的舊包裹',
              status: 'picked_up',
            }),
          },
        ],
      });
    });
    expect(update.mock.calls.at(-1)?.[0]).toMatchObject({
      packagesState: 'error',
      packages: expect.arrayContaining([
        expect.objectContaining({
          id: 'dw_legacy',
          title: '即時更新的舊包裹',
          status: 'collected',
        }),
        expect.objectContaining({ id: 'dw_cached', status: 'waiting' }),
      ]),
    });
    expect(update.mock.calls.at(-1)?.[0].packages).toHaveLength(2);
    act(() => {
      mockState.parcelNext?.({ docs: [] });
    });
    expect(update.mock.calls.at(-1)?.[0]).toMatchObject({
      packagesState: 'error',
      packages: [expect.objectContaining({ id: 'dw_cached', status: 'waiting' })],
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60000);
    });
    expect(update.mock.calls.at(-1)?.[0]).toMatchObject({
      packagesState: 'ready',
      packages: [expect.objectContaining({ id: 'dw_cached', status: 'collected' })],
    });
    stop();
    await jest.advanceTimersByTimeAsync(60000);
    expect(mockState.invoke).toHaveBeenCalledTimes(3);
  } finally {
    stop();
    jest.useRealTimers();
  }
});
