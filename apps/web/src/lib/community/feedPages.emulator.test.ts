// @vitest-environment node
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, disableNetwork, documentId, enableNetwork, getDocsFromCache, limit, orderBy, query,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/firebase';
import { fetchRecentCampusPosts } from './firestore';
import { fetchCampusPostPage, type CampusPostCursor } from './feedPages';
import { getDb as getMobileDb } from '../../../../mobile/src/firebase';
import { fetchCampusPostPage as fetchMobileCampusPostPage } from '../../../../mobile/src/services/feedPages';

vi.mock('@/lib/firebase', () => ({ getDb: vi.fn() }));
vi.mock('../../../../mobile/src/firebase', () => ({ getDb: vi.fn() }));
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
const localEmulator = /^(?:127\.0\.0\.1|localhost):([0-9]{1,5})$/.test(emulatorHost);
if (process.env.REQUIRE_FEED_EMULATOR === '1' && !localEmulator) {
  throw new Error('Feed verification requires a local Firestore emulator; refusing cloud access.');
}
const describeEmulator = localEmulator ? describe : describe.skip;

describeEmulator('campus feed cursor pagination with repository rules', () => {
  let environment: RulesTestEnvironment;
  let alice: Firestore;

  beforeAll(async () => {
    const [host, port] = emulatorHost.split(':');
    environment = await initializeTestEnvironment({
      projectId: 'demo-campus-feed-pages',
      firestore: {
        host, port: Number(port),
        rules: readFileSync(new URL('../../../../../backend/firestore/firestore.rules', import.meta.url), 'utf8'),
      },
    });
  }, 30000);
  afterAll(async () => { await environment?.cleanup(); });
  beforeEach(async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const batch = db.batch();
      batch.set(db.doc('schools/pu/members/alice'), { status: 'active', role: 'student' });
      batch.set(db.doc('schools/pu/members/inactive'), { status: 'inactive', role: 'student' });
      batch.set(db.doc('schools/other/members/charlie'), { status: 'active', role: 'student' });
      for (let index = 0; index < 245; index += 1) {
        batch.set(db.doc(`schools/pu/campusPosts/post-${String(index).padStart(3, '0')}`), {
          schoolId: 'pu', boardId: 'public', anonymous: false, authorUid: 'alice',
          title: index === 0 ? '上學期的專題集合' : `校園貼文 ${index}`, content: '',
          // Seven posts share a timestamp; a 60-item boundary cuts through ties.
          createdAt: new Date(1700000000000 + Math.floor(index / 7) * 1000),
        });
      }
      batch.set(db.doc('schools/other/campusPosts/private'), {
        schoolId: 'other', boardId: 'public', anonymous: false, authorUid: 'charlie',
        title: '另一校的貼文', content: '', createdAt: new Date(1700000100000),
      });
      await batch.commit();
    });
    alice = environment.authenticatedContext('alice').firestore() as unknown as Firestore;
    vi.mocked(getDb).mockReset().mockReturnValue(alice);
    vi.mocked(getMobileDb).mockReset().mockReturnValue(alice);
  });

  it('finds all 245 posts exactly once, including timestamp ties and posts past the previous cap', async () => {
    const ids: string[] = [];
    const sizes: number[] = [];
    let cursor: CampusPostCursor | null = null;
    let hasMore = true;
    while (hasMore && sizes.length < 6) {
      const page = await fetchCampusPostPage('pu', cursor);
      ids.push(...page.posts.map((post) => post.id));
      sizes.push(page.posts.length);
      cursor = page.nextCursor;
      hasMore = page.hasMore;
    }
    expect(sizes).toEqual([60, 60, 60, 60, 5]);
    expect(ids).toEqual(Array.from({ length: 245 }, (_, i) => `post-${String(244 - i).padStart(3, '0')}`));
    expect(new Set(ids).size).toBe(245);
    expect(hasMore).toBe(false);

    const expandedSizes: number[] = [];
    for (const size of [60, 120, 180, 240]) {
      expandedSizes.push((await fetchRecentCampusPosts('pu', undefined, size)).length);
    }
    expect(expandedSizes.reduce((a, b) => a + b, 0)).toBe(600);
    expect(sizes.slice(0, 4).reduce((a, b) => a + b, 0)).toBe(240);
    console.info('FEED_PAGING_EVIDENCE', JSON.stringify({
      fixturePosts: 245, legacyReturnedDocumentsFor240: 600,
      cursorReturnedDocumentsFor240: 240, cursorPageSizes: sizes,
      uniquePosts: new Set(ids).size,
      boundary: 'actual SDK and isolated emulator; document payloads, not production billing or user timing',
    }));
  });

  it('continues after a deleted boundary without repeating posts when a newer post is inserted', async () => {
    const first = await fetchCampusPostPage('pu');
    const boundary = first.nextCursor!.document.id;
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc(`schools/pu/campusPosts/${boundary}`).delete();
      await db.doc('schools/pu/campusPosts/new-head').set({
        schoolId: 'pu', boardId: 'public', anonymous: false, authorUid: 'alice',
        title: '剛發布', content: '', createdAt: new Date(1800000000000),
      });
    });
    const second = await fetchCampusPostPage('pu', first.nextCursor);
    expect(second.posts).toHaveLength(60);
    expect(second.posts[0].id).toBe('post-184');
    const firstIds = new Set(first.posts.map((post) => post.id));
    expect(second.posts.every((post) => !firstIds.has(post.id))).toBe(true);
    expect(second.posts.some((post) => post.id === 'new-head')).toBe(false);
    expect((await fetchCampusPostPage('pu')).posts[0].id).toBe('new-head');
  });

  it('retries the same cursor after an offline read instead of returning the first cached page', async () => {
    const first = await fetchCampusPostPage('pu');
    const cached = await getDocsFromCache(query(
      collection(alice, 'schools/pu/campusPosts'),
      orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'), limit(60),
    ));
    expect(cached.size).toBe(60);
    await disableNetwork(alice);
    try {
      await expect(fetchCampusPostPage('pu', first.nextCursor)).rejects.toMatchObject({ code: 'unavailable' });
    } finally { await enableNetwork(alice); }
    const next = await fetchCampusPostPage('pu', first.nextCursor);
    expect(next.posts).toHaveLength(60);
    expect(next.posts[0].id).toBe('post-184');
  });

  it('rechecks current membership on every page and works again after membership is restored', async () => {
    const first = await fetchCampusPostPage('pu');
    const membership = 'schools/pu/members/alice';
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(membership).update({ status: 'inactive' });
    });
    await expect(fetchCampusPostPage('pu', first.nextCursor)).rejects.toMatchObject({ code: 'permission-denied' });
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(membership).update({ status: 'active' });
    });
    expect((await fetchCampusPostPage('pu', first.nextCursor)).posts[0].id).toBe('post-184');
  });

  it.each([
    ['another school', 'alice', 'other'],
    ['another account', 'charlie', 'pu'],
    ['inactive student', 'inactive', 'pu'],
    ['signed out', null, 'pu'],
  ] as const)('rejects %s', async (_label, uid, schoolId) => {
    const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext();
    vi.mocked(getDb).mockReturnValue(context.firestore() as unknown as Firestore);
    await expect(fetchCampusPostPage(schoolId)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('does not reuse a cursor across school scopes while the other school can still read its own feed', async () => {
    const first = await fetchCampusPostPage('pu');
    vi.mocked(getDb).mockReturnValue(environment.authenticatedContext('charlie').firestore() as unknown as Firestore);
    await expect(fetchCampusPostPage('other', first.nextCursor)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect((await fetchCampusPostPage('other')).posts.map((post) => post.id)).toEqual(['private']);
  });

  it('native feed service uses the real SDK to page all 245 school posts exactly once', async () => {
    const ids: string[] = [];
    const sizes: number[] = [];
    let cursor: Awaited<ReturnType<typeof fetchMobileCampusPostPage>>['nextCursor'] = null;
    let hasMore = true;
    while (hasMore && sizes.length < 6) {
      const page = await fetchMobileCampusPostPage('pu', cursor);
      ids.push(...page.posts.map((post) => post.id));
      sizes.push(page.posts.length);
      cursor = page.nextCursor;
      hasMore = page.hasMore;
    }
    expect(sizes).toEqual([60, 60, 60, 60, 5]);
    expect(new Set(ids).size).toBe(245);
    expect(ids[0]).toBe('post-244');
    expect(ids.at(-1)).toBe('post-000');
    expect(hasMore).toBe(false);
  });

  it('native feed SDK blocks cached offline continuation and rejected membership, then recovers', async () => {
    const first = await fetchMobileCampusPostPage('pu');
    const cached = await getDocsFromCache(query(
      collection(alice, 'schools/pu/campusPosts'),
      orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'), limit(60),
    ));
    expect(cached.size).toBe(60);
    await disableNetwork(alice);
    try {
      await expect(fetchMobileCampusPostPage('pu', first.nextCursor))
        .rejects.toMatchObject({ code: 'unavailable' });
    } finally { await enableNetwork(alice); }
    expect((await fetchMobileCampusPostPage('pu', first.nextCursor)).posts[0].id).toBe('post-184');
    await environment.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('schools/pu/members/alice').update({ status: 'inactive' });
    });
    await expect(fetchMobileCampusPostPage('pu', first.nextCursor))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await environment.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('schools/pu/members/alice').update({ status: 'active' });
    });
    expect((await fetchMobileCampusPostPage('pu', first.nextCursor)).posts[0].id).toBe('post-184');
    vi.mocked(getMobileDb).mockReturnValue(environment.authenticatedContext('charlie').firestore() as unknown as Firestore);
    await expect(fetchMobileCampusPostPage('other', first.nextCursor))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect((await fetchMobileCampusPostPage('other')).posts.map(row => row.id)).toEqual(['private']);
  });

  it('handles an exact 60-item feed with one final empty page', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const batch = db.batch();
      for (let i = 0; i < 185; i += 1) batch.delete(db.doc(`schools/pu/campusPosts/post-${String(i).padStart(3, '0')}`));
      await batch.commit();
    });
    const first = await fetchCampusPostPage('pu');
    expect(first.hasMore).toBe(true);
    const last = await fetchCampusPostPage('pu', first.nextCursor);
    expect(last).toEqual({ posts: [], nextCursor: null, hasMore: false });
  });
});
