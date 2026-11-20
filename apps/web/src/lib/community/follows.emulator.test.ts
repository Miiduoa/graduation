// @vitest-environment node
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDocFromCache, getDocFromServer, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/firebase';
import { followId, followUser, listFollowingIds, unfollowUser } from './follows';

vi.mock('@/lib/firebase', () => ({ getDb: vi.fn() }));

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
const describeEmulator = /^(?:127\.0\.0\.1|localhost):([0-9]{1,5})$/.test(emulatorHost)
  ? describe
  : describe.skip;

describeEmulator('follow client against the repository Firestore rules', () => {
  let environment: RulesTestEnvironment;
  let alice: Firestore;
  const relation = (db: Firestore) => doc(db, 'follows', followId('pu', 'alice', 'bob'));

  beforeAll(async () => {
    const [host, port] = emulatorHost.split(':');
    environment = await initializeTestEnvironment({
      projectId: 'demo-campus-follow-client',
      firestore: {
        host,
        port: Number(port),
        rules: readFileSync(
          new URL('../../../../../backend/firestore/firestore.rules', import.meta.url),
          'utf8',
        ),
      },
    });
  }, 30000);

  afterAll(async () => {
    await environment?.cleanup();
  });

  beforeEach(async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        db.doc('schools/pu/members/alice').set({ status: 'active', role: 'student' }),
        db.doc('schools/pu/members/bob').set({ status: 'active', role: 'student' }),
        db.doc('schools/pu/members/inactive').set({ status: 'inactive', role: 'student' }),
        db.doc('schools/other/members/charlie').set({ status: 'active', role: 'student' }),
      ]);
    });
    // RulesTestContext exposes the compat wrapper; the modular SDK accepts it.
    alice = environment.authenticatedContext('alice').firestore() as unknown as Firestore;
    vi.mocked(getDb).mockReset().mockReturnValue(alice);
  });

  it('creates the first follow although reading an absent relation is denied', async () => {
    await expect(getDocFromServer(relation(alice))).rejects.toMatchObject({
      code: 'permission-denied',
    });

    await expect(followUser('pu', 'alice', 'bob')).resolves.toBeUndefined();
    const saved = (await getDocFromServer(relation(alice))).data();
    expect(saved).toMatchObject({ schoolId: 'pu', followerUid: 'alice', targetUid: 'bob' });
    expect(saved?.createdAt.toMillis()).toBeGreaterThan(0);
    await expect(listFollowingIds('pu', 'alice')).resolves.toEqual(['bob']);

    await expect(unfollowUser('pu', 'alice', 'bob')).resolves.toBeUndefined();
    await expect(listFollowingIds('pu', 'alice')).resolves.toEqual([]);
  });

  it('confirms repeated follows without rewriting the original relation', async () => {
    await followUser('pu', 'alice', 'bob');
    const first = (await getDocFromServer(relation(alice))).data();

    await expect(followUser('pu', 'alice', 'bob')).resolves.toBeUndefined();
    const repeated = (await getDocFromServer(relation(alice))).data();
    expect(repeated?.createdAt.toMillis()).toBe(first?.createdAt.toMillis());
    await expect(listFollowingIds('pu', 'alice')).resolves.toEqual(['bob']);
  });

  it('confirms simultaneous follows from separate clients as one saved relation', async () => {
    const secondClient = environment
      .authenticatedContext('alice')
      .firestore() as unknown as Firestore;
    vi.mocked(getDb).mockReturnValueOnce(alice).mockReturnValueOnce(secondClient);

    await expect(
      Promise.all([followUser('pu', 'alice', 'bob'), followUser('pu', 'alice', 'bob')]),
    ).resolves.toEqual([undefined, undefined]);
    await expect(listFollowingIds('pu', 'alice')).resolves.toEqual(['bob']);
  });

  it.each([
    ['guest', null, 'pu', 'alice', 'bob'],
    ['another account', 'bob', 'pu', 'alice', 'bob'],
    ['another school', 'alice', 'other', 'alice', 'charlie'],
    ['cross-school target', 'alice', 'pu', 'alice', 'charlie'],
    ['inactive target', 'alice', 'pu', 'alice', 'inactive'],
  ] as const)('rejects a follow from %s', async (_label, uid, schoolId, followerUid, targetUid) => {
    const context = uid
      ? environment.authenticatedContext(uid)
      : environment.unauthenticatedContext();
    vi.mocked(getDb).mockReturnValue(context.firestore() as unknown as Firestore);

    await expect(followUser(schoolId, followerUid, targetUid)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await environment.withSecurityRulesDisabled(async (admin) => {
      expect((await admin.firestore().collection('follows').get()).empty).toBe(true);
    });
  });

  it('rejects revoked membership even when the matching relation is cached', async () => {
    await followUser('pu', 'alice', 'bob');
    await getDocFromServer(relation(alice));
    expect((await getDocFromCache(relation(alice))).exists()).toBe(true);

    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('schools/pu/members/alice').update({ status: 'inactive' });
    });

    await expect(followUser('pu', 'alice', 'bob')).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(listFollowingIds('pu', 'alice')).rejects.toMatchObject({
      code: 'permission-denied',
    });
    // The existing privacy cleanup permission still lets the owner unfollow.
    await expect(unfollowUser('pu', 'alice', 'bob')).resolves.toBeUndefined();
  });
});
