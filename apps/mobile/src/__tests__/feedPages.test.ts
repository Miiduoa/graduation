import {
  collection, documentId, getDocsFromServer, limit, orderBy, query, startAfter, startAt, Timestamp,
} from 'firebase/firestore';
import { fetchCampusPostPage } from '../services/feedPages';
import { taiwanFeedDayEnd } from '../services/feedDates';

jest.mock('../firebase', () => ({ getDb: jest.fn(() => ({ current: 'test' })) }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db, path) => ({ path })),
  documentId: jest.fn(() => '__name__'),
  getDocsFromServer: jest.fn(),
  limit: jest.fn((amount) => ({ limit: amount })),
  orderBy: jest.fn((field, direction) => ({ orderBy: field, direction })),
  query: jest.fn((...args) => args),
  startAfter: jest.fn((document) => ({ startAfter: document })),
  startAt: jest.fn((date) => ({ startAt: date })),
  Timestamp: { fromDate: jest.fn((date: Date) => ({ millis: date.getTime() })) },
}));

const doc = (id: string, schoolId = 'pu') => ({
  id,
  ref: { parent: { path: `schools/${schoolId}/campusPosts` } },
  data: () => ({ id: 'untrusted-id', schoolId, boardId: 'public', title: `文章${id}`, content: '', anonymous: false }),
});
const response = (docs: unknown[], metadata = { fromCache: false, hasPendingWrites: false }) => ({
  docs, metadata,
});
beforeEach(() => jest.clearAllMocks());

test('mobile page uses server-only sorted query, stable IDs and 60 document cursor', async () => {
  const docs = Array.from({ length: 60 }, (_, i) => doc(String(i)));
  jest.mocked(getDocsFromServer).mockResolvedValueOnce(response(docs) as any);
  const first = await fetchCampusPostPage('pu');
  expect(first.posts).toHaveLength(60);
  expect(first.posts[0].id).toBe('0');
  expect(first.nextCursor?.document).toBe(docs[59]);
  expect(first.hasMore).toBe(true);
  expect(collection).toHaveBeenCalledWith(expect.anything(), 'schools/pu/campusPosts');
  expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  expect(orderBy).toHaveBeenCalledWith('__name__', 'desc');
  expect(documentId).toHaveBeenCalledTimes(1);
  expect(limit).toHaveBeenCalledWith(60);
  expect(query).toHaveBeenCalledTimes(1);
  jest.mocked(getDocsFromServer).mockResolvedValueOnce(response([doc('60'), doc('61')]) as any);
  const second = await fetchCampusPostPage('pu', first.nextCursor);
  expect(startAfter).toHaveBeenCalledWith(docs[59]);
  expect(second.posts.map((p) => p.id)).toEqual(['60', '61']);
  expect(second.hasMore).toBe(false);
});

test('mobile cursor rejects cross-school and malformed scope before any server query', async () => {
  const cursor = { schoolId: 'pu', document: doc('59') } as any;
  await expect(fetchCampusPostPage('other', cursor)).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(fetchCampusPostPage('pu/path')).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(getDocsFromServer).not.toHaveBeenCalled();
});

test('mobile service never substitutes offline cache or pending writes for a real page', async () => {
  for (const metadata of [
    { fromCache: true, hasPendingWrites: false },
    { fromCache: false, hasPendingWrites: true },
  ]) {
    jest.mocked(getDocsFromServer).mockResolvedValueOnce(response([doc('1')], metadata) as any);
    await expect(fetchCampusPostPage('pu')).rejects.toMatchObject({ code: 'unavailable' });
  }
  jest.mocked(getDocsFromServer).mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
  await expect(fetchCampusPostPage('pu')).rejects.toMatchObject({ code: 'unavailable' });
  jest.mocked(getDocsFromServer).mockRejectedValueOnce(Object.assign(new Error('revoked'), { code: 'permission-denied' }));
  await expect(fetchCampusPostPage('pu')).rejects.toMatchObject({ code: 'permission-denied' });
});

test('mobile pagination drops malformed other-school rows but keeps server cursor', async () => {
  jest.mocked(getDocsFromServer).mockResolvedValueOnce(response([doc('1'), doc('2', 'other')]) as any);
  const page = await fetchCampusPostPage('pu');
  expect(page.posts.map((p) => p.id)).toEqual(['1']);
  expect(page.nextCursor?.document.id).toBe('2');
});

test('Taiwan date validator handles leap days independently of the device timezone', () => {
  expect(taiwanFeedDayEnd('2024-02-29')?.toISOString()).toBe('2024-02-29T15:59:59.999Z');
  expect(taiwanFeedDayEnd('2022-09-03')?.toISOString()).toBe('2022-09-03T15:59:59.999Z');
  for (const invalid of ['2023-02-29', '2024-02-30', '2026-13-01', '2026-1-01', '2026-12-1', '1900-01-01', 'not a date']) {
    expect(taiwanFeedDayEnd(invalid)).toBeNull();
  }
});

test('mobile date boundary starts on server and continues same date using the snapshot', async () => {
  const before = taiwanFeedDayEnd('2022-09-03')!;
  const docs = Array.from({ length: 60 }, (_, i) => doc(String(i)));
  jest.mocked(getDocsFromServer).mockResolvedValueOnce(response(docs) as any);
  const first = await fetchCampusPostPage('pu', null, before);
  expect(Timestamp.fromDate).toHaveBeenCalledWith(before);
  expect(startAt).toHaveBeenCalledWith({ millis: before.getTime() });
  expect(first.nextCursor?.beforeMillis).toBe(before.getTime());
  expect(first.posts).toHaveLength(60);
  jest.mocked(getDocsFromServer).mockResolvedValueOnce(response([doc('60')]) as any);
  const second = await fetchCampusPostPage('pu', first.nextCursor, before);
  expect(startAfter).toHaveBeenCalledWith(docs[59]);
  expect(startAt).toHaveBeenCalledTimes(1);
  expect(second.posts.map((row) => row.id)).toEqual(['60']);
  expect(second.hasMore).toBe(false);
});

test('date cursor is not valid for latest or another date, including offline retry', async () => {
  const before = taiwanFeedDayEnd('2022-09-03')!;
  const cursor = { schoolId: 'pu', document: doc('59'), beforeMillis: before.getTime() } as any;
  await expect(fetchCampusPostPage('pu', cursor)).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(fetchCampusPostPage('pu', cursor, taiwanFeedDayEnd('2022-09-02'))).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(fetchCampusPostPage('other', cursor, before)).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(fetchCampusPostPage('pu', null, new Date(NaN))).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(getDocsFromServer).not.toHaveBeenCalled();
  jest.mocked(getDocsFromServer).mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
  await expect(fetchCampusPostPage('pu', cursor, before)).rejects.toMatchObject({ code: 'unavailable' });
  jest.mocked(getDocsFromServer).mockResolvedValueOnce(response([doc('older')]) as any);
  const retried = await fetchCampusPostPage('pu', cursor, before);
  expect(retried.posts[0].id).toBe('older');
  expect(startAfter).toHaveBeenCalledWith(cursor.document);
});
