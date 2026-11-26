import { getDocs, getDocsFromServer, orderBy, where } from 'firebase/firestore';
import { listSubscribedBoardIds, readSubscribedBoardIds } from '../../services/boards';
import { listActiveStoriesForSchool } from '../../services/stories';

jest.mock('../../firebase', () => ({ getDb: () => ({}) }));
const serverRead = getDocsFromServer as jest.Mock;
const error = Object.assign(new Error('offline'), { code: 'unavailable' });
beforeEach(() => {
  jest.clearAllMocks();
  serverRead.mockReset().mockRejectedValue(error);
  jest.mocked(getDocs).mockRejectedValue(error);
});

test('subscription read failures reach screens that provide recovery', async () => {
  await expect(listSubscribedBoardIds('alice', 'pu', { throwOnError: true })).rejects.toBe(error);
});
test('story read failures reach recovery without an unbounded fallback', async () => {
  await expect(listActiveStoriesForSchool('pu', 80, { throwOnError: true })).rejects.toBe(error);
  expect(getDocs).toHaveBeenCalledTimes(1);
});
test('optional story reads fail closed without a school-only retry', async () => {
  await expect(listActiveStoriesForSchool('pu')).resolves.toEqual([]);
  expect(getDocs).toHaveBeenCalledTimes(1);
});
test('other existing consumers retain their optional-read contract', async () => {
  await expect(listSubscribedBoardIds('alice', 'pu')).resolves.toEqual([]);
  await expect(listActiveStoriesForSchool('pu')).resolves.toEqual([]);
});


test.each([false, true])('subscription provenance is per document (cache: %s)', async (fromCache) => {
  jest.mocked(getDocs).mockResolvedValueOnce({
    docs: [
      { data: () => ({ boardId: 'committed' }), metadata: { hasPendingWrites: false } },
      { data: () => ({ boardId: 'pending' }), metadata: { hasPendingWrites: true } },
    ],
    metadata: { fromCache, hasPendingWrites: true },
  } as Awaited<ReturnType<typeof getDocs>>);
  await expect(readSubscribedBoardIds('alice', 'pu')).resolves.toEqual({
    ids: ['committed', 'pending'],
    serverConfirmedIds: fromCache ? [] : ['committed'],
  });
});
