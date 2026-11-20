import { act, renderHook, waitFor } from '@testing-library/react-native';
import { getDocs, orderBy, startAfter } from 'firebase/firestore';
import { useAdminCollectionPage } from '../hooks/useAdminCollectionPage';

jest.mock('../firebase', () => ({ getDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...path: string[]) => path.join('/'),
  documentId: () => '__name__',
  query: (...args: unknown[]) => args,
  orderBy: jest.fn((field, direction) => ({ order: field, direction })),
  startAfter: jest.fn((document) => ({ after: document })),
  limit: (size: number) => ({ limit: size }),
  getDocs: jest.fn(),
}));

const row = (id: string, data: Record<string, unknown> = {}) => ({
  id,
  data: () => data,
});

function useMembers(schoolId: string, uid: string, demo?: Array<{ id: string; name: string }>) {
  return useAdminCollectionPage<{ id: string; name: string }>({
    schoolId,
    uid,
    demoItems: demo,
    pageSize: 2,
    getCollection: () => ['schools', schoolId, 'members'],
    buildConstraints: () => [orderBy('__name__')],
    mapDocs: (docs) => docs.map((docSnap) => ({ id: docSnap.id, name: docSnap.id })),
  });
}

function useLogs(schoolId: string, uid: string) {
  return useAdminCollectionPage<{ id: string; createdAt: number }>({
    schoolId,
    uid,
    pageSize: 2,
    getCollection: () => ['schools', schoolId, 'adminLogs'],
    buildConstraints: () => [orderBy('createdAt', 'desc'), orderBy('__name__', 'desc')],
    mapDocs: (docs) =>
      docs.map((docSnap) => ({
        id: docSnap.id,
        createdAt: Number((docSnap.data() as { createdAt?: number }).createdAt ?? 0),
      })),
  });
}

beforeEach(() => jest.clearAllMocks());

test('loads more than one page and keeps stable id order across pages', async () => {
  (getDocs as jest.Mock)
    .mockResolvedValueOnce({ docs: [row('a'), row('b')] })
    .mockResolvedValueOnce({ docs: [row('c')] });
  const { result } = renderHook(() => useMembers('pu', 'editor'));
  await waitFor(() => expect(result.current.items).toHaveLength(2));
  expect(result.current.hasMore).toBe(true);
  expect(result.current.complete).toBe(false);
  await act(async () => result.current.loadMore());
  expect(startAfter).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  expect(result.current.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  expect(result.current.hasMore).toBe(false);
  expect(result.current.complete).toBe(true);
});

test('equal timestamps still paginate with documentId DESC tie-breaker and do not drop ties', async () => {
  const sameTime = 1_700_000_000_000;
  (getDocs as jest.Mock)
    .mockResolvedValueOnce({
      docs: [row('log-b', { createdAt: sameTime }), row('log-a', { createdAt: sameTime })],
    })
    .mockResolvedValueOnce({
      docs: [row('log-c', { createdAt: sameTime })],
    });
  const { result } = renderHook(() => useLogs('pu', 'editor'));
  await waitFor(() => expect(result.current.items).toHaveLength(2));
  expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  expect(orderBy).toHaveBeenCalledWith('__name__', 'desc');
  await act(async () => result.current.loadMore());
  expect(result.current.items.map((item) => item.id)).toEqual(['log-b', 'log-a', 'log-c']);
  expect(startAfter).toHaveBeenCalledWith(expect.objectContaining({ id: 'log-a' }));
});

test('retry after a failed page does not duplicate already loaded rows', async () => {
  (getDocs as jest.Mock)
    .mockResolvedValueOnce({ docs: [row('a'), row('b')] })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ docs: [row('b'), row('c')] });
  const { result } = renderHook(() => useMembers('pu', 'editor'));
  await waitFor(() => expect(result.current.items).toHaveLength(2));
  await act(async () => result.current.loadMore());
  expect(result.current.error).toBe(true);
  expect(result.current.items.map((item) => item.id)).toEqual(['a', 'b']);
  await act(async () => result.current.loadMore());
  expect(result.current.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  expect(result.current.error).toBe(false);
});

test('search-after-load-more stays on the accumulated loaded set', async () => {
  (getDocs as jest.Mock)
    .mockResolvedValueOnce({ docs: [row('alice'), row('bob')] })
    .mockResolvedValueOnce({ docs: [row('carol')] });
  const { result } = renderHook(() => useMembers('pu', 'editor'));
  await waitFor(() => expect(result.current.items).toHaveLength(2));
  const before = result.current.items.filter((item) => item.id.includes('a'));
  expect(before.map((item) => item.id)).toEqual(['alice']);
  await act(async () => result.current.loadMore());
  const after = result.current.items.filter((item) => item.id.includes('a'));
  expect(after.map((item) => item.id)).toEqual(['alice', 'carol']);
});

test('switching school hides stale rows and ignores a late previous page', async () => {
  let resolve!: (value: unknown) => void;
  (getDocs as jest.Mock)
    .mockReturnValueOnce(
      new Promise((yes) => {
        resolve = yes;
      }),
    )
    .mockResolvedValueOnce({ docs: [row('current')] });
  const { result, rerender } = renderHook(
    ({ school, uid }) => useMembers(school, uid),
    { initialProps: { school: 'pu', uid: 'editor' } },
  );
  rerender({ school: 'other', uid: 'editor' });
  expect(result.current.items).toHaveLength(0);
  await act(async () => resolve({ docs: [row('stale')] }));
  await waitFor(() =>
    expect(result.current.items).toEqual([expect.objectContaining({ id: 'current' })]),
  );
});

test('permission revocation on the next page keeps loaded rows and marks denial', async () => {
  (getDocs as jest.Mock)
    .mockResolvedValueOnce({ docs: [row('a'), row('b')] })
    .mockRejectedValueOnce(Object.assign(new Error('Missing permissions'), { code: 'permission-denied' }));
  const { result } = renderHook(() => useMembers('pu', 'editor'));
  await waitFor(() => expect(result.current.items).toHaveLength(2));
  await act(async () => result.current.loadMore());
  expect(result.current.items).toHaveLength(2);
  expect(result.current.error).toBe(true);
  expect(result.current.permissionDenied).toBe(true);
  expect(result.current.hasMore).toBe(true);
});
