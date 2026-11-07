// @vitest-environment node
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, disableNetwork, enableNetwork, getDocsFromCache, limit, orderBy, query,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/firebase';
import { fetchRecentCampusPosts } from './firestore';

vi.mock('@/lib/firebase', () => ({ getDb: vi.fn() }));

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
const hasLocalEmulator = /^(?:127\.0\.0\.1|localhost):([0-9]{1,5})$/.test(emulatorHost);
if (process.env.REQUIRE_FEED_EMULATOR === '1' && !hasLocalEmulator) {
  throw new Error('Feed verification requires a local Firestore emulator; refusing cloud access.');
}
const describeEmulator = hasLocalEmulator ? describe : describe.skip;

describeEmulator('campus feed service against repository Firestore rules', () => {
  let environment: RulesTestEnvironment;
  let alice: Firestore;
  const firstPage = (db: Firestore) => query(
    collection(db, 'schools', 'pu', 'campusPosts'), orderBy('createdAt', 'desc'), limit(60),
  );

  beforeAll(async () => {
    const [host, port] = emulatorHost.split(':');
    environment = await initializeTestEnvironment({
      projectId: 'demo-campus-feed-read',
      firestore: {
        host,
        port: Number(port),
        rules: readFileSync(
          new URL('../../../../../backend/firestore/firestore.rules', import.meta.url), 'utf8',
        ),
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
      for (let i = 0; i < 61; i += 1) {
        batch.set(db.doc(`schools/pu/campusPosts/post-${String(i).padStart(3, '0')}`), {
          schoolId: 'pu', boardId: 'public', anonymous: false, authorUid: 'alice',
          title: i === 0 ? '上學期的專題集合' : `近期貼文 ${i}`,
          content: '', createdAt: new Date(1700000000000 + i * 1000),
        });
      }
      batch.set(db.doc('schools/other/campusPosts/other-secret'), {
        schoolId: 'other', boardId: 'public', anonymous: false, authorUid: 'charlie',
        title: '另一校的貼文', content: '', createdAt: new Date(1700000100000),
      });
      await batch.commit();
    });
    alice = environment.authenticatedContext('alice').firestore() as unknown as Firestore;
    vi.mocked(getDb).mockReset().mockReturnValue(alice);
  });

  it('lets an active student find the 61st post without reading another school', async () => {
    const recent = await fetchRecentCampusPosts('pu', undefined, 60);
    expect(recent).toHaveLength(60);
    expect(recent[0].id).toBe('post-060');
    expect(recent.some((post) => post.id === 'post-000')).toBe(false);
    const extended = await fetchRecentCampusPosts('pu', undefined, 120);
    expect(extended).toHaveLength(61);
    expect(extended.at(-1)).toMatchObject({ id: 'post-000', title: '上學期的專題集合' });
    expect(extended.every((post) => post.schoolId === 'pu')).toBe(true);
  });

  it('rejects offline reads despite a populated cache and succeeds after reconnection', async () => {
    await fetchRecentCampusPosts('pu', undefined, 60);
    expect((await getDocsFromCache(firstPage(alice))).size).toBe(60);
    await disableNetwork(alice);
    try {
      await expect(fetchRecentCampusPosts('pu', undefined, 120)).rejects.toMatchObject({ code: 'unavailable' });
    } finally {
      await enableNetwork(alice);
    }
    await expect(fetchRecentCampusPosts('pu', undefined, 120)).resolves.toHaveLength(61);
  });

  it('rejects revoked membership with cached posts and permits restored membership', async () => {
    await fetchRecentCampusPosts('pu', undefined, 60);
    expect((await getDocsFromCache(firstPage(alice))).size).toBe(60);
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('schools/pu/members/alice').update({ status: 'inactive' });
    });
    await expect(fetchRecentCampusPosts('pu', undefined, 120)).rejects.toMatchObject({ code: 'permission-denied' });
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('schools/pu/members/alice').update({ status: 'active' });
    });
    await expect(fetchRecentCampusPosts('pu', undefined, 120)).resolves.toHaveLength(61);
  });

  it.each([
    ['another school', 'alice', 'other'],
    ['another account', 'charlie', 'pu'],
    ['inactive student', 'inactive', 'pu'],
    ['signed-out student', null, 'pu'],
  ] as const)('rejects %s', async (_label, uid, schoolId) => {
    const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext();
    vi.mocked(getDb).mockReturnValue(context.firestore() as unknown as Firestore);
    await expect(fetchRecentCampusPosts(schoolId, undefined, 60)).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
