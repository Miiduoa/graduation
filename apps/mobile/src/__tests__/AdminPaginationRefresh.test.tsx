import { act, renderHook, waitFor } from '@testing-library/react-native';
import { getDocs } from 'firebase/firestore';
import { useAdminCollectionPage } from '../screens/admin/useAdminCollectionPage';

jest.mock('firebase/firestore', () => ({
  query: (...parts: unknown[]) => parts,
  limit: (count: number) => ({ count }),
  startAfter: (cursor: unknown) => ({ cursor }),
  getDocs: jest.fn(),
}));

test('a mutation-triggered reload supersedes an in-flight next page', async () => {
  const row = (id: string) => ({ id, data: () => ({}) });
  let resolveOldPage!: (value: { docs: ReturnType<typeof row>[] }) => void;
  (getDocs as jest.Mock)
    .mockResolvedValueOnce({ docs: [row('before-role-update')] })
    .mockReturnValueOnce(new Promise((resolve) => { resolveOldPage = resolve; }))
    .mockResolvedValueOnce({ docs: [row('after-role-update')] });
  const { result } = renderHook(() => useAdminCollectionPage({
    schoolId: 'school', uid: 'admin', canAccess: true, pageSize: 1,
    getCollection: () => 'schools/school/members' as never,
    buildConstraints: () => [],
    mapDocs: (docs) => docs.map((doc) => ({ id: doc.id })),
  }));
  await waitFor(() => expect(result.current.items[0]?.id).toBe('before-role-update'));
  let loadingMore!: Promise<void>;
  act(() => { loadingMore = result.current.loadMore(); });
  await act(async () => { await result.current.reload(); });
  expect(getDocs).toHaveBeenCalledTimes(3);
  expect(result.current.items.map((item) => item.id)).toEqual(['after-role-update']);
  await act(async () => {
    resolveOldPage({ docs: [row('stale-second-page')] });
    await loadingMore;
  });
  expect(result.current.items.map((item) => item.id)).toEqual(['after-role-update']);
});
