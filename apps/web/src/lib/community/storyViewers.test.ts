import { beforeEach, expect, it, vi } from 'vitest';
import { listStoryViewersPage } from './storyViewers';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

const mock = vi.hoisted(() => ({
  user: { uid: 'owner' },
  read: vi.fn(),
  profiles: vi.fn(),
}));
vi.mock('@/lib/firebase', () => ({
  getDb: () => 'db',
  getAuth: () => ({ currentUser: mock.user }),
}));
vi.mock('./firestore', () => ({ fetchSchoolDirectoryProfiles: mock.profiles }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: string, ...parts: string[]) => parts.join('/'),
  getDocsFromServer: mock.read,
  orderBy: (...args: string[]) => ({ order: args }),
  startAfter: (doc: unknown) => ({ after: doc }),
  limit: (size: number) => ({ limit: size }),
  query: (...args: unknown[]) => args,
}));
const story = { id: 'spring', authorUid: 'owner', schoolId: 'pu' };
beforeEach(() => {
  vi.resetAllMocks();
  mock.user.uid = story.authorUid;
});

it('pages server receipts using the document cursor, excludes the author and hides UID fallbacks', async () => {
  const docs = Array.from({ length: 21 }, (_, n) => ({
    id: n === 0 ? 'owner' : 'student-id-' + n,
  }));
  mock.read.mockResolvedValue({ docs });
  mock.profiles.mockResolvedValue([{ uid: docs[1].id, displayName: 'student-' }]);
  const cursor = { id: 'prior-row' } as QueryDocumentSnapshot;
  const page = await listStoryViewersPage(story, cursor);
  expect(mock.read).toHaveBeenCalledWith([
    'campusStories/spring/schools/pu/authors/owner/views',
    { order: ['viewedAt', 'desc'] },
    { after: cursor },
    { limit: 21 },
  ]);
  expect(mock.profiles).toHaveBeenCalledExactlyOnceWith(
    'pu',
    docs.slice(1, 20).map((d) => d.id),
  );
  expect(page.nextCursor).toBe(docs[19]);
  expect(page.viewers).toHaveLength(19);
  expect(page.viewers[0]).toEqual({ uid: docs[1].id, displayName: '同學' });
});

it('rejects a different account both before the query and if it changes during the read', async () => {
  mock.user.uid = 'stranger';
  await expect(listStoryViewersPage(story, null)).rejects.toMatchObject({
    code: 'permission-denied',
  });
  expect(mock.read).not.toHaveBeenCalled();
  mock.user.uid = 'owner';
  mock.read.mockImplementationOnce(async () => {
    mock.user.uid = 'stranger';
    return { docs: [{ id: 'reader' }] };
  });
  await expect(listStoryViewersPage(story, null)).rejects.toMatchObject({
    code: 'permission-denied',
  });
  expect(mock.profiles).not.toHaveBeenCalled();
});
