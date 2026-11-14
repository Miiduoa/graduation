import { beforeEach, expect, it, vi } from 'vitest';
import { loadOwnCampusPosts } from './myPosts';

const mocks = vi.hoisted(() => ({
  getDocs: vi.fn(),
  query: vi.fn((...parts: unknown[]) => parts),
  where: vi.fn((...parts: unknown[]) => parts),
  startAfter: vi.fn((cursor: unknown) => ({ after: cursor })),
}));
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  getDocs: mocks.getDocs,
  query: mocks.query,
  where: mocks.where,
  startAfter: mocks.startAfter,
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  limit: (size: number) => ({ limit: size }),
  orderBy: (key: string, direction: string) => ({ orderBy: key, direction }),
}));

function entry(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      schoolId: 'school-a', authorUid: 'alice', anonymous: false,
      title: '標題', content: '文字', boardId: 'general', ...overrides,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

it('reads only one school and the signed owner without re-attributing anonymous posts', async () => {
  const rows = [
    entry('one'),
    entry('anonymous', { anonymous: true, authorUid: 'alice' }),
    entry('other-user', { authorUid: 'bob' }),
    entry('other-school', { schoolId: 'school-b' }),
    entry('two', { mediaUrls: ['https://example.test/image.jpg'] }),
  ];
  mocks.getDocs.mockResolvedValue({ docs: rows });
  const result = await loadOwnCampusPosts('school-a', 'alice', null, 8);
  expect(result.items.map((row) => row.id)).toEqual(['one', 'two']);
  expect(result.hasMore).toBe(false);
  expect(mocks.query.mock.calls[0]).toContain('schools/school-a/campusPosts');
  expect(mocks.query.mock.calls[0]).toContainEqual(['authorUid', '==', 'alice']);
  expect(mocks.query.mock.calls[0]).toContainEqual({ orderBy: 'createdAt', direction: 'desc' });
  expect(mocks.query.mock.calls[0]).toContainEqual({ limit: 9 });
  expect(mocks.query.mock.calls[0]).not.toContainEqual(expect.objectContaining({ after: expect.anything() }));
});

it('pages with a document cursor and cannot exceed the capped page size', async () => {
  const entries = Array.from({ length: 25 }, (_, idx) => entry(String(idx)));
  mocks.getDocs.mockResolvedValue({ docs: entries });
  const first = await loadOwnCampusPosts('school-a', 'alice', null, 999);
  expect(first.items).toHaveLength(24);
  expect(first.hasMore).toBe(true);
  expect(first.cursor).toBe(entries[23]);
  expect(mocks.query.mock.calls[0]).toContainEqual({ limit: 25 });

  mocks.getDocs.mockResolvedValue({ docs: [entry('last')] });
  const last = await loadOwnCampusPosts('school-a', 'alice', first.cursor);
  expect(mocks.startAfter).toHaveBeenCalledWith(entries[23]);
  expect(last.items.map((row) => row.id)).toEqual(['last']);
  expect(last.hasMore).toBe(false);
  expect(last.cursor).toBeNull();
});

it('fails closed on missing identity and forwards membership/index failures without showing an empty timeline', async () => {
  await expect(loadOwnCampusPosts('', 'alice')).rejects.toThrow('MISSING_SOCIAL_SCOPE');
  await expect(loadOwnCampusPosts('school-a', '')).rejects.toThrow('MISSING_SOCIAL_SCOPE');
  expect(mocks.getDocs).not.toHaveBeenCalled();
  const permissionError = new Error('permission-denied');
  mocks.getDocs.mockRejectedValue(permissionError);
  await expect(loadOwnCampusPosts('school-a', 'alice')).rejects.toBe(permissionError);
});
