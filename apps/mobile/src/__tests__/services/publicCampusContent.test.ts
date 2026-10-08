import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  where,
} from 'firebase/firestore';
import { isFirebaseMockMode } from '../../firebase';
import {
  loadCampusAnnouncements,
  loadCampusAnnouncement,
  loadCampusEvent,
  loadCampusEvents,
  isPublicWebUrl,
} from '../../services/publicCampusContent';

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((...args) => args),
  doc: jest.fn((...args) => args),
  getDocFromServer: jest.fn(),
  getDocsFromServer: jest.fn(),
  limit: jest.fn(),
  orderBy: jest.fn(),
  where: jest.fn(),
  query: jest.fn((...args) => args),
}));
jest.mock('../../firebase', () => ({
  getDb: jest.fn(() => 'db'),
  isFirebaseMockMode: jest.fn(() => false),
}));
const row = { title: '校方公告', body: '真實內文', publishedAt: '2026-10-08T00:00:00Z' };
const document = (data = row) => ({ id: 'a1', exists: () => true, data: () => data });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isFirebaseMockMode).mockReturnValue(false);
});

test('reads school canonical server documents without a mock or cache fallback', async () => {
  jest.mocked(getDocsFromServer).mockResolvedValue({ empty: false, docs: [document()] } as never);
  await expect(loadCampusAnnouncements('pu')).resolves.toMatchObject([
    { id: 'a1', schoolId: 'pu', title: '校方公告' },
  ]);
  expect(collection).toHaveBeenCalledWith('db', 'schools', 'pu', 'announcements');
  expect(getDocsFromServer).toHaveBeenCalledTimes(1);
});

test('legacy content is only consulted after a successful empty canonical result', async () => {
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValueOnce({ empty: true, docs: [] } as never)
    .mockResolvedValueOnce({ empty: false, docs: [document()] } as never);
  await expect(loadCampusAnnouncements('pu')).resolves.toHaveLength(1);
  expect(collection).toHaveBeenLastCalledWith('db', 'announcements');
  jest.clearAllMocks();
  jest.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('permission-denied'));
  await expect(loadCampusAnnouncements('pu')).rejects.toThrow('permission-denied');
  expect(getDocsFromServer).toHaveBeenCalledTimes(1);
});

test('canonical and legacy details reject other-school data and preserve document IDs', async () => {
  jest
    .mocked(getDocFromServer)
    .mockResolvedValueOnce(document({ ...row, schoolId: 'other' } as never) as never);
  await expect(loadCampusAnnouncement('pu', 'a1')).rejects.toThrow('Invalid campus content');
  jest
    .mocked(getDocFromServer)
    .mockResolvedValueOnce({ exists: () => false } as never)
    .mockResolvedValueOnce(document({ ...row, schoolId: 'other' } as never) as never);
  await expect(loadCampusAnnouncement('pu', 'a1')).resolves.toBeNull();
  jest
    .mocked(getDocFromServer)
    .mockResolvedValueOnce(document({ ...row, id: 'forged' } as never) as never);
  await expect(loadCampusAnnouncement('pu', 'a1')).resolves.toMatchObject({ id: 'a1' });
  expect(doc).toHaveBeenLastCalledWith('db', 'schools', 'pu', 'announcements', 'a1');
});

test('missing IDs never fall back to sample content and invalid runtime never reads Firestore', async () => {
  await expect(loadCampusAnnouncement('pu', '')).resolves.toBeNull();
  await expect(loadCampusEvent('pu', '../other')).resolves.toBeNull();
  expect(getDocFromServer).not.toHaveBeenCalled();
  jest.mocked(isFirebaseMockMode).mockReturnValue(true);
  await expect(loadCampusAnnouncements('pu')).rejects.toThrow('Campus content unavailable');
  expect(getDocsFromServer).not.toHaveBeenCalled();
});

test('attachment links require safe web URLs and malformed dates are not invented', async () => {
  jest.mocked(getDocFromServer).mockResolvedValue(
    document({
      ...row,
      publishedAt: 'broken',
      attachments: [
        { name: '公告附件', url: 'https://school.edu/notice.pdf' },
        { name: 'Unsafe', url: 'javascript:alert(1)' },
        { name: 'Local file', url: 'file:///private/data' },
      ],
    } as never) as never,
  );
  const result = await loadCampusAnnouncement('pu', 'a1');
  expect(result?.publishedAt).toBe('');
  expect(result?.attachments).toHaveLength(1);
  expect(isPublicWebUrl('https://user:password@school.edu')).toBe(false);
});

test.each([
  [loadCampusAnnouncements, 'announcements', 'publishedAt'],
  [loadCampusEvents, 'events', 'startsAt'],
] as const)(
  'legacy queries keep the school filter and an explicit bounded date ordering (%s)',
  async (load, collectionName, dateField) => {
    jest
      .mocked(getDocsFromServer)
      .mockResolvedValueOnce({ empty: true, docs: [] } as never)
      .mockResolvedValueOnce({ empty: true, docs: [] } as never);
    await expect(load('pu')).resolves.toEqual([]);
    expect(collection).toHaveBeenLastCalledWith('db', collectionName);
    expect(where).toHaveBeenCalledWith('schoolId', '==', 'pu');
    expect(orderBy).toHaveBeenCalledWith(dateField, 'desc');
    expect(limit).toHaveBeenCalledWith(100);
  },
);
