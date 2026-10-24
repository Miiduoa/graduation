import { act, renderHook, waitFor } from '@testing-library/react-native';
import { getDocs, startAfter } from 'firebase/firestore';
import { useAdminCollectionPage } from '../screens/admin/useAdminCollectionPage';

const mockGetDocs = getDocs as jest.Mock;
const mockStartAfter = startAfter as jest.Mock;

jest.mock('../firebase', () => ({ getDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...path: string[]) => path.join('/'),
  query: (...parts: unknown[]) => parts,
  orderBy: jest.fn((...args: unknown[]) => ({ type: 'orderBy', args })),
  limit: jest.fn((n: number) => ({ type: 'limit', n })),
  startAfter: jest.fn((cursor: unknown) => ({ type: 'startAfter', cursor })),
  getDocs: jest.fn(),
}));

function docSnap(id: string, data: Record<string, unknown> = {}) {
  return {
    id,
    data: () => data,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('page 2 is reachable via startAfter on the last raw snapshot', async () => {
  const page1 = Array.from({ length: 2 }, (_, i) =>
    docSnap(`a${i}`, { title: `A${i}`, publishedAt: { seconds: 100 - i } }),
  );
  const page2 = [docSnap('a2', { title: 'A2', publishedAt: { seconds: 50 } })];
  mockGetDocs.mockResolvedValueOnce({ docs: page1 }).mockResolvedValueOnce({ docs: page2 });

  const { result } = renderHook(() =>
    useAdminCollectionPage({
      schoolId: 'pu',
      uid: 'admin',
      canAccess: true,
      pageSize: 2,
      getCollection: () => 'schools/pu/announcements' as never,
      buildConstraints: () => [],
      mapDocs: (docs) => docs.map((d) => ({ id: d.id, ...(d.data() as object) })),
    }),
  );

  await waitFor(() => expect(result.current.items).toHaveLength(2));
  expect(result.current.hasMore).toBe(true);

  await act(async () => {
    await result.current.loadMore();
  });

  await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['a0', 'a1', 'a2']));
  expect(mockStartAfter).toHaveBeenCalledWith(page1[page1.length - 1]);
  expect(result.current.hasMore).toBe(false);
});

test('equal-timestamp pages still advance with the raw snapshot cursor', async () => {
  const stamp = { seconds: 42 };
  const page1 = [docSnap('first', { publishedAt: stamp }), docSnap('second', { publishedAt: stamp })];
  const page2 = [docSnap('third', { publishedAt: stamp })];
  mockGetDocs.mockResolvedValueOnce({ docs: page1 }).mockResolvedValueOnce({ docs: page2 });

  const { result } = renderHook(() =>
    useAdminCollectionPage({
      schoolId: 'pu',
      uid: 'admin',
      canAccess: true,
      pageSize: 2,
      getCollection: () => 'schools/pu/announcements' as never,
      buildConstraints: () => [],
      mapDocs: (docs) => docs.map((d) => ({ id: d.id, ...(d.data() as object) })),
    }),
  );

  await waitFor(() => expect(result.current.hasMore).toBe(true));
  await act(async () => {
    await result.current.loadMore();
  });
  await waitFor(() => expect(result.current.items.map((i) => i.id)).toContain('third'));
  expect(mockStartAfter).toHaveBeenCalledWith(page1[1]);
});

test('duplicate IDs across pages are deduped', async () => {
  const page1 = [docSnap('same', { title: 'one' }), docSnap('b', { title: 'b' })];
  const page2 = [docSnap('same', { title: 'updated' }), docSnap('c', { title: 'c' })];
  mockGetDocs
    .mockResolvedValueOnce({ docs: page1 })
    .mockResolvedValueOnce({ docs: page2 });

  const { result } = renderHook(() =>
    useAdminCollectionPage({
      schoolId: 'pu',
      uid: 'admin',
      canAccess: true,
      pageSize: 2,
      getCollection: () => 'schools/pu/announcements' as never,
      buildConstraints: () => [],
      mapDocs: (docs) => docs.map((d) => ({ id: d.id, ...(d.data() as object) })),
    }),
  );

  await waitFor(() => expect(result.current.items).toHaveLength(2));
  await act(async () => {
    await result.current.loadMore();
  });
  await waitFor(() => expect(result.current.items).toHaveLength(3));
  const same = result.current.items.find((i) => i.id === 'same') as { title?: string };
  expect(same?.title).toBe('updated');
});

test('failed page retry preserves rows and reuses the same cursor', async () => {
  const page1 = Array.from({ length: 2 }, (_, i) => docSnap(`m${i}`));
  mockGetDocs
    .mockResolvedValueOnce({ docs: page1 })
    .mockRejectedValueOnce(new Error('network down'))
    .mockResolvedValueOnce({ docs: [docSnap('m2')] });

  const { result } = renderHook(() =>
    useAdminCollectionPage({
      schoolId: 'pu',
      uid: 'admin',
      canAccess: true,
      pageSize: 2,
      getCollection: () => 'schools/pu/members' as never,
      buildConstraints: () => [],
      mapDocs: (docs) => docs.map((d) => ({ id: d.id })),
    }),
  );

  await waitFor(() => expect(result.current.items).toHaveLength(2));
  await act(async () => {
    await result.current.loadMore();
  });
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.items.map((i) => i.id)).toEqual(['m0', 'm1']);
  expect(result.current.hasMore).toBe(true);

  mockStartAfter.mockClear();
  await act(async () => {
    await result.current.loadMore();
  });
  await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['m0', 'm1', 'm2']));
  expect(mockStartAfter).toHaveBeenCalledWith(page1[1]);
  expect(result.current.error).toBe(false);
});

test('late account/school/role results are ignored for the new scope', async () => {
  let resolveFirst!: (value: { docs: ReturnType<typeof docSnap>[] }) => void;
  mockGetDocs.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
  );
  mockGetDocs.mockResolvedValue({ docs: [docSnap('other-school')] });

  const { result, rerender } = renderHook(
    ({ schoolId, uid, canAccess }) =>
      useAdminCollectionPage({
        schoolId,
        uid,
        canAccess,
        pageSize: 50,
        getCollection: () => `schools/${schoolId}/announcements` as never,
        buildConstraints: () => [],
        mapDocs: (docs) => docs.map((d) => ({ id: d.id })),
      }),
    { initialProps: { schoolId: 'pu', uid: 'admin', canAccess: true } },
  );

  expect(result.current.items).toEqual([]);
  rerender({ schoolId: 'ntu', uid: 'admin', canAccess: true });
  expect(result.current.items).toEqual([]);

  await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(2));
  await act(async () => {
    resolveFirst({ docs: [docSnap('stale-pu')] });
  });
  await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['other-school']));
  expect(result.current.items.map((i) => i.id)).not.toContain('stale-pu');
});

test('permission-denied clears private rows and cursor', async () => {
  const page1 = Array.from({ length: 2 }, (_, i) => docSnap(`secret${i}`));
  mockGetDocs
    .mockResolvedValueOnce({ docs: page1 })
    .mockRejectedValueOnce({ code: 'permission-denied', message: 'Missing permissions' });

  const { result } = renderHook(() =>
    useAdminCollectionPage({
      schoolId: 'pu',
      uid: 'admin',
      canAccess: true,
      pageSize: 2,
      getCollection: () => 'schools/pu/adminLogs' as never,
      buildConstraints: () => [],
      mapDocs: (docs) => docs.map((d) => ({ id: d.id })),
    }),
  );

  await waitFor(() => expect(result.current.items).toHaveLength(2));
  await act(async () => {
    await result.current.loadMore();
  });
  await waitFor(() => expect(result.current.permissionDenied).toBe(true));
  expect(result.current.items).toEqual([]);
  expect(result.current.hasMore).toBe(false);
});

test('unauthenticated or non-editor state does not query', async () => {
  const { result } = renderHook(() =>
    useAdminCollectionPage({
      schoolId: 'pu',
      uid: '',
      canAccess: false,
      pageSize: 50,
      getCollection: () => 'schools/pu/announcements' as never,
      buildConstraints: () => [],
      mapDocs: (docs) => docs.map((d) => ({ id: d.id })),
    }),
  );

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(mockGetDocs).not.toHaveBeenCalled();
  expect(result.current.items).toEqual([]);
});
