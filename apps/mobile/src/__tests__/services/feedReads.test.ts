import { getDocs, query } from 'firebase/firestore';
import { fetchRecentCampusPosts } from '../../services/feed';

jest.mock('../../firebase', () => ({ getDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((...parts) => parts.slice(1).join('/')),
  query: jest.fn((...parts) => parts),
  where: jest.fn((...parts) => ({ where: parts })),
  orderBy: jest.fn((...parts) => ({ orderBy: parts })),
  limit: jest.fn((count) => ({ limit: count })),
  getDocs: jest.fn(),
}));
beforeEach(() => jest.clearAllMocks());

test('the missing-index fallback keeps the selected board filter', async () => {
  jest
    .mocked(getDocs)
    .mockRejectedValueOnce(
      Object.assign(new Error('missing index'), { code: 'failed-precondition' }),
    )
    .mockResolvedValueOnce({ docs: [] } as never);
  await expect(fetchRecentCampusPosts('pu', 'my-board', 45)).resolves.toEqual([]);
  expect(query).toHaveBeenNthCalledWith(
    1,
    'schools/pu/campusPosts',
    { where: ['boardId', '==', 'my-board'] },
    { orderBy: ['createdAt', 'desc'] },
    { limit: 45 },
  );
  expect(query).toHaveBeenNthCalledWith(
    2,
    'schools/pu/campusPosts',
    { where: ['boardId', '==', 'my-board'] },
    { limit: 25 },
  );
});

test('a failed fallback propagates instead of looking like an empty board', async () => {
  const error = new Error('offline');
  jest.mocked(getDocs).mockRejectedValue(error);
  await expect(fetchRecentCampusPosts('pu', 'my-board')).rejects.toBe(error);
});
