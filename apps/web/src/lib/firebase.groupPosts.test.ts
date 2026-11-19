import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  const user = { uid: 'alice', getIdToken: vi.fn(async () => 'test-token') };
  return { user, auth: { currentUser: user as typeof user | null }, getDocs: vi.fn() };
});
vi.mock('firebase/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('firebase/auth', async (original) => ({
  ...await original<typeof import('firebase/auth')>(),
  getAuth: () => runtime.auth,
}));
vi.mock('firebase/firestore', async (original) => ({
  ...await original<typeof import('firebase/firestore')>(),
  getDocs: runtime.getDocs,
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'demo-group-feed');
  runtime.auth.currentUser = runtime.user;
  runtime.getDocs.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('loads legacy posts through the hosted policy and keeps ISO dates without client collection queries', async () => {
  const fetchPage = vi.fn(async () => ({ ok: true, json: async () => ({ result: { posts: [{
    id: 'legacy', authorId: 'alice', content: '歷史貼文', createdAt: { seconds: 100, nanoseconds: 1000000 },
  }] } }) }));
  vi.stubGlobal('fetch', fetchPage);
  const { fetchGroupPosts } = await import('./firebase');
  expect(await fetchGroupPosts('g1')).toEqual([{
    id: 'legacy', groupId: 'g1', authorId: 'alice', content: '歷史貼文', createdAt: '1970-01-01T00:01:40.001Z',
  }]);
  expect(fetchPage).toHaveBeenCalledWith('/api/fn/listGroupDiscussionPage', expect.objectContaining({
    body: JSON.stringify({ data: { groupId: 'g1', pageSize: 20 } }),
  }));
  expect(runtime.getDocs).not.toHaveBeenCalled();
});

it('discards hosted results when the login session changes', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    runtime.auth.currentUser = null;
    return { ok: true, json: async () => ({ result: { posts: [{ id: 'private' }] } }) };
  }));
  const { fetchGroupPosts } = await import('./firebase');
  expect(await fetchGroupPosts('g1')).toEqual([]);
  expect(runtime.getDocs).not.toHaveBeenCalled();
});
