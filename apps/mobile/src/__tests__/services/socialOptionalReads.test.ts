import { getDocs, getDocsFromServer, orderBy, where } from 'firebase/firestore';
import { listSubscribedBoardIds } from '../../services/boards';
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
test.each(['permission-denied', 'unavailable', 'unauthenticated', 'failed-precondition'])(
  'does not use cached stories or an unordered fallback after %s', async (code) => {
    const failure = Object.assign(new Error('cannot verify school access'), { code });
    serverRead.mockRejectedValueOnce(failure);
    await expect(listActiveStoriesForSchool('pu', 80, { throwOnError: true })).rejects.toBe(failure);
    expect(serverRead).toHaveBeenCalledTimes(1);
    expect(getDocs).not.toHaveBeenCalled();
  },
);
test.each([false, true])('returns active server stories, including a missing index (%s)', async (missingIndex) => {
  if (missingIndex) serverRead.mockRejectedValueOnce(
    Object.assign(new Error('The query requires an index.'), { code: 'failed-precondition' }),
  );
  serverRead.mockResolvedValueOnce({ docs: [
    { id: 'live', data: () => ({ schoolId: 'pu', expiresAt: Date.now() + 10_000 }) },
    { id: 'expired', data: () => ({ expiresAt: 1 }) },
  ] });
  const result = await listActiveStoriesForSchool('pu', 12, { throwOnError: true });
  expect(result.map((s) => s.id)).toEqual(['live']);
  expect(where).toHaveBeenCalledWith('schoolId', '==', 'pu');
  expect(orderBy).toHaveBeenCalledTimes(1);
  expect(serverRead).toHaveBeenCalledTimes(missingIndex ? 2 : 1);
  expect(getDocs).not.toHaveBeenCalled();
});
test('other existing consumers retain their optional-read contract', async () => {
  await expect(listSubscribedBoardIds('alice', 'pu')).resolves.toEqual([]);
  await expect(listActiveStoriesForSchool('pu')).resolves.toEqual([]);
});
