import { expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { subscribeDormCloud } from './cloud';
const mock = vi.hoisted(() => ({ collection: vi.fn(), invoke: vi.fn(), stop: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}), getFunctionsInstance: () => ({}) }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => mock.invoke }));
vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => {
    mock.collection(...args);
    return {};
  },
  doc: () => ({}),
  query: () => ({}),
  where: () => ({}),
  onSnapshot: () => mock.stop,
}));
it('loads legacy parcels through the authorized backend without reading their Firestore document IDs', async () => {
  mock.invoke.mockResolvedValue({
    data: {
      rows: [{ id: 'dw_synthetic', data: { description: '合成舊包裹', status: 'waiting' } }],
    },
  });
  const update = vi.fn();
  const stop = subscribeDormCloud('tw-pu', 'student', update);
  try {
    await waitFor(() =>
      expect(update.mock.calls.at(-1)?.[0].packages).toEqual([
        expect.objectContaining({ id: 'dw_synthetic', title: '合成舊包裹' }),
      ]),
    );
    expect(mock.invoke).toHaveBeenCalledWith({ schoolId: 'pu', action: 'parcels' });
    expect(mock.collection.mock.calls.some((args) => args.includes('packages'))).toBe(false);
  } finally {
    stop();
  }
});
