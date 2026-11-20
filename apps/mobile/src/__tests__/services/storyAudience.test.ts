import {
  collection,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
} from 'firebase/firestore';
import { listStoryViewers } from '../../services/stories';
import { fetchSchoolDirectoryProfiles } from '../../services/memberDirectory';

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(() => 'receipts'),
  orderBy: jest.fn(() => 'recent-first'),
  limit: jest.fn(() => 'bounded'),
  startAfter: jest.fn(() => 'after-cursor'),
  query: jest.fn(() => 'viewer-query'),
  getDocsFromServer: jest.fn(),
}));
jest.mock('../../firebase', () => ({ getDb: () => 'db' }));
jest.mock('../../services/memberDirectory', () => ({ fetchSchoolDirectoryProfiles: jest.fn() }));

test('loads a bounded, server-authorized page and resolves names only in the story school', async () => {
  const cursor = { id: 'last-viewer' } as Parameters<typeof listStoryViewers>[1];
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValue({ docs: [{ id: 'alice' }, { id: 'unlisted-uid' }] } as never);
  jest
    .mocked(fetchSchoolDirectoryProfiles)
    .mockResolvedValue([{ uid: 'unlisted-uid', displayName: 'unlisted' }]);
  await expect(
    listStoryViewers({ id: 'rain', schoolId: 'pu', authorUid: 'alice' }, cursor),
  ).resolves.toEqual({
    viewers: [{ uid: 'unlisted-uid', displayName: '同學' }],
    nextCursor: null,
  });
  expect(collection).toHaveBeenCalledWith(
    'db',
    'campusStories',
    'rain',
    'schools',
    'pu',
    'authors',
    'alice',
    'views',
  );
  expect(startAfter).toHaveBeenCalledWith(cursor);
  expect(orderBy).toHaveBeenCalledWith('viewedAt', 'desc');
  expect(limit).toHaveBeenCalledWith(21);
  expect(query).toHaveBeenCalledWith('receipts', 'recent-first', 'after-cursor', 'bounded');
  expect(getDocsFromServer).toHaveBeenCalledWith('viewer-query');
  expect(fetchSchoolDirectoryProfiles).toHaveBeenCalledWith('pu', ['unlisted-uid'], 'db');
});
