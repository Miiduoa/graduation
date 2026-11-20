import { act, renderHook, waitFor } from '@testing-library/react-native';
import { getDocs, orderBy, startAfter } from 'firebase/firestore';
import { useAdminEvents } from '../hooks/useAdminEvents';
jest.mock('../firebase', () => ({ getDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...path: string[]) => path.join('/'),
  documentId: () => '__name__',
  query: (...args: unknown[]) => args,
  orderBy: jest.fn((field) => ({ order: field })),
  startAfter: jest.fn((document) => ({ after: document })),
  limit: (size: number) => ({ limit: size }),
  getDocs: jest.fn(),
}));
const row = (id: string) => ({
  id,
  data: () => ({ title: id, registrationPolicy: { enabled: true, version: 1 } }),
});
beforeEach(() => jest.clearAllMocks());
test('undated events are included and document snapshots paginate without dropping same-date events', async () => {
  const first = Array.from({ length: 50 }, (_, index) => row(`event${index}`));
  (getDocs as jest.Mock)
    .mockResolvedValueOnce({ docs: first })
    .mockResolvedValueOnce({ docs: [row('undated')] });
  const { result } = renderHook(() => useAdminEvents('pu', 'editor'));
  await waitFor(() => expect(result.current.items).toHaveLength(50));
  expect(orderBy).toHaveBeenCalledWith('__name__');
  expect(result.current.hasMore).toBe(true);
  await act(async () => result.current.loadMore());
  expect(startAfter).toHaveBeenCalledWith(first[49]);
  expect(result.current.items).toHaveLength(51);
  expect(result.current.items[50]).toMatchObject({ id: 'undated' });
  expect(result.current.hasMore).toBe(false);
});
test('a failed next page preserves loaded events and retries the same cursor', async () => {
  const first = Array.from({ length: 50 }, (_, index) => row(`event${index}`));
  (getDocs as jest.Mock)
    .mockResolvedValueOnce({ docs: first })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ docs: [row('last')] });
  const { result } = renderHook(() => useAdminEvents('pu', 'editor'));
  await waitFor(() => expect(result.current.items).toHaveLength(50));
  await act(async () => result.current.loadMore());
  expect(result.current.error).toBe(true);
  expect(result.current.items).toHaveLength(50);
  await act(async () => result.current.loadMore());
  expect(result.current.items).toHaveLength(51);
  expect(startAfter).toHaveBeenLastCalledWith(first[49]);
});
test('switching school hides old managed events immediately and ignores late pages', async () => {
  let resolve!: (value: unknown) => void;
  (getDocs as jest.Mock)
    .mockReturnValueOnce(
      new Promise((yes) => {
        resolve = yes;
      }),
    )
    .mockResolvedValueOnce({ docs: [row('current')] });
  const { result, rerender } = renderHook(({ school }) => useAdminEvents(school, 'editor'), {
    initialProps: { school: 'pu' },
  });
  rerender({ school: 'other' });
  expect(result.current.items).toHaveLength(0);
  await act(async () => resolve({ docs: [row('old')] }));
  await waitFor(() =>
    expect(result.current.items).toEqual([expect.objectContaining({ id: 'current' })]),
  );
});
