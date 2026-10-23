import { getDoc, getDocs, where } from 'firebase/firestore';
import {
  fetchSchoolDirectoryProfiles,
  searchSchoolDirectoryByDisplayNamePrefix,
} from '../../services/memberDirectory';

jest.mock('../../firebase', () => ({ getDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((...parts) => parts.slice(1).join('/')),
  collection: jest.fn((...parts) => parts.slice(1).join('/')),
  query: jest.fn((...parts) => parts),
  where: jest.fn((...parts) => parts),
  orderBy: jest.fn((...parts) => parts),
  startAt: jest.fn((...parts) => parts),
  endAt: jest.fn((...parts) => parts),
  limit: jest.fn((...parts) => parts),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
}));

const uid = 'real_member_uid_123456789';
const directoryDoc = (data?: Record<string, unknown>) => ({
  id: uid,
  exists: () => data !== undefined,
  data: () => data,
});

beforeEach(() => jest.clearAllMocks());

test('unknown account IDs do not become manufactured invitation targets', async () => {
  jest.mocked(getDoc).mockResolvedValue(directoryDoc() as never);
  await expect(searchSchoolDirectoryByDisplayNamePrefix('pu', uid)).resolves.toEqual([]);
  // Existing author labels retain their separate fallback behavior.
  await expect(fetchSchoolDirectoryProfiles('pu', [uid])).resolves.toEqual([
    expect.objectContaining({ uid, isDiscoverable: false }),
  ]);
});

test.each([false, undefined])(
  'exact ID lookup requires explicit discovery consent (%s)',
  async (isDiscoverable) => {
    jest
      .mocked(getDoc)
      .mockResolvedValue(directoryDoc({ displayName: '小林', isDiscoverable }) as never);
    await expect(searchSchoolDirectoryByDisplayNamePrefix('pu', uid)).resolves.toEqual([]);
  },
);

test('exact ID lookup returns a confirmed discoverable member', async () => {
  jest
    .mocked(getDoc)
    .mockResolvedValue(directoryDoc({ displayName: '小林', isDiscoverable: true }) as never);
  await expect(searchSchoolDirectoryByDisplayNamePrefix('pu', uid)).resolves.toEqual([
    expect.objectContaining({ uid, displayName: '小林', isDiscoverable: true }),
  ]);
  expect(getDoc).toHaveBeenCalledWith(`schools/pu/directory/${uid}`);
});

test.each(['permission-denied', 'unavailable'])(
  'exact ID read errors stay errors (%s)',
  async (code) => {
    const error = Object.assign(new Error(code), { code });
    jest.mocked(getDoc).mockRejectedValue(error);
    await expect(searchSchoolDirectoryByDisplayNamePrefix('pu', uid)).rejects.toBe(error);
  },
);

test('name search filters discovery consent in the query and in returned records', async () => {
  jest.mocked(getDocs).mockResolvedValue({
    docs: [
      directoryDoc({ displayName: '小林', isDiscoverable: true }),
      { id: 'hidden', data: () => ({ displayName: '小陳', isDiscoverable: false }) },
      { id: 'legacy', data: () => ({ displayName: '小王' }) },
    ],
  } as never);
  const rows = await searchSchoolDirectoryByDisplayNamePrefix('pu', '小');
  expect(where).toHaveBeenCalledWith('isDiscoverable', '==', true);
  expect(rows.map((row) => row.uid)).toEqual([uid]);
});

test('a failed name search does not pretend there are no matching people', async () => {
  const error = Object.assign(new Error('offline'), { code: 'unavailable' });
  jest.mocked(getDocs).mockRejectedValue(error);
  await expect(searchSchoolDirectoryByDisplayNamePrefix('pu', '小')).rejects.toBe(error);
});
