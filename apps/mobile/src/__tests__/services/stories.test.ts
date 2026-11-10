import { listActiveStoriesForSchool } from '../../services/stories';

const mockGetDocs = jest.fn();
const mockQuery = jest.fn((...parts: unknown[]) => parts);

jest.mock('../../firebase', () => ({ getDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  collection: () => 'campusStories',
  where: (...args: unknown[]) => args,
  orderBy: (...args: unknown[]) => args,
  limit: (value: number) => ({ limit: value }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDocs.mockReset();
  jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
});
afterEach(() => jest.restoreAllMocks());

test('includes soon-to-expire stories and filters expired results', async () => {
  const now = Date.now();
  mockGetDocs.mockResolvedValue({ docs: [
    { id: 'soon', data: () => ({ expiresAt: now + 30_000 }) },
    { id: 'expired', data: () => ({ expiresAt: now }) },
    { id: 'missing', data: () => ({}) },
  ] });
  await expect(listActiveStoriesForSchool('pu', 40)).resolves.toEqual([
    { id: 'soon', expiresAt: now + 30_000 },
  ]);
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(mockQuery).toHaveBeenCalledWith('campusStories',
    ['schoolId', '==', 'pu'], ['expiresAt', '>', now + 3_000],
    ['expiresAt', 'desc'], { limit: 40 });
});

test('retries permission-denied once with a higher expiry bound', async () => {
  mockGetDocs.mockRejectedValueOnce({ code: 'permission-denied' }).mockResolvedValue({ docs: [] });
  await expect(listActiveStoriesForSchool('pu')).resolves.toEqual([]);
  expect(mockQuery).toHaveBeenCalledTimes(2);
  expect(mockQuery.mock.calls[1]).toContainEqual(['expiresAt', '>', Date.now() + 15_000]);
});

test.each([true, false])('stops after the retry and honors throwOnError=%s', async (throwOnError) => {
  const failure = { code: 'permission-denied' };
  mockGetDocs.mockRejectedValue(failure);
  const result = listActiveStoriesForSchool('pu', 80, { throwOnError });
  if (throwOnError) await expect(result).rejects.toBe(failure);
  else await expect(result).resolves.toEqual([]);
  expect(mockQuery).toHaveBeenCalledTimes(2);
  for (const parts of mockQuery.mock.calls) {
    expect(parts).toContainEqual(['schoolId', '==', 'pu']);
    expect(parts).toContainEqual(['expiresAt', '>', expect.any(Number)]);
  }
});

test('does not retry other errors', async () => {
  const failure = { code: 'unavailable' };
  mockGetDocs.mockRejectedValue(failure);
  await expect(listActiveStoriesForSchool('pu', 80, { throwOnError: true })).rejects.toBe(failure);
  expect(mockQuery).toHaveBeenCalledTimes(1);
});
