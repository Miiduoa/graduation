import { getDocs } from 'firebase/firestore';
import { listSubscribedBoardIds } from '../../services/boards';
import { listActiveStoriesForSchool } from '../../services/stories';

jest.mock('../../firebase', () => ({ getDb: () => ({}) }));
const error = Object.assign(new Error('offline'), { code: 'unavailable' });
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getDocs).mockRejectedValue(error);
});

test('subscription read failures reach screens that provide recovery', async () => {
  await expect(listSubscribedBoardIds('alice', 'pu', { throwOnError: true })).rejects.toBe(error);
});
test('story read failures reach recovery after the fallback also fails', async () => {
  await expect(listActiveStoriesForSchool('pu', 80, { throwOnError: true })).rejects.toBe(error);
  expect(getDocs).toHaveBeenCalledTimes(2);
});
test('other existing consumers retain their optional-read contract', async () => {
  await expect(listSubscribedBoardIds('alice', 'pu')).resolves.toEqual([]);
  await expect(listActiveStoriesForSchool('pu')).resolves.toEqual([]);
});
