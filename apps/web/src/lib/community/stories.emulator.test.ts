// @vitest-environment node
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, getDocs, limit, query, where, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/firebase';
import { listActiveStoriesForSchool } from './firestore';

vi.mock('@/lib/firebase', () => ({ getDb: vi.fn() }));

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
const describeEmulator = /^(?:127\.0\.0\.1|localhost):([0-9]{1,5})$/.test(emulatorHost)
  ? describe
  : describe.skip;

describeEmulator('story list client against the repository Firestore rules', () => {
  let environment: RulesTestEnvironment;
  let alice: Firestore;
  let now: number;

  beforeAll(async () => {
    const [host, port] = emulatorHost.split(':');
    environment = await initializeTestEnvironment({
      projectId: 'demo-campus-story-list',
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
    now = Date.now();
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        db.doc('users/alice').set({ status: 'active', schoolId: 'pu', primarySchoolId: 'pu' }),
        db.doc('users/bob').set({ status: 'active', schoolId: 'other', primarySchoolId: 'other' }),
        db.doc('schools/pu/members/alice').set({ status: 'active', role: 'student' }),
        db.doc('schools/other/members/bob').set({ status: 'active', role: 'student' }),
        db.doc('campusStories/active-web').set({
          schoolId: 'pu',
          authorUid: 'alice',
          kind: 'text',
          expiresAt: now + 3_600_000,
          createdAt: now,
        }),
        db.doc('campusStories/expired-web').set({
          schoolId: 'pu',
          authorUid: 'alice',
          kind: 'text',
          expiresAt: now - 60_000,
          createdAt: now - 3_600_000,
        }),
        db.doc('campusStories/soon-web').set({
          schoolId: 'pu',
          authorUid: 'alice',
          kind: 'text',
          expiresAt: now + 30_000,
          createdAt: now,
        }),
        db.doc('campusStories/other-school').set({
          schoolId: 'other',
          authorUid: 'bob',
          kind: 'text',
          expiresAt: now + 3_600_000,
          createdAt: now,
        }),
      ]);
    });
    alice = environment.authenticatedContext('alice').firestore() as unknown as Firestore;
    vi.mocked(getDb).mockReset().mockReturnValue(alice);
  });

  it('lists only unexpired same-school stories through the web query', async () => {
    await expect(listActiveStoriesForSchool('pu', 80)).resolves.toEqual([
      expect.objectContaining({ id: 'active-web', schoolId: 'pu' }),
      expect.objectContaining({ id: 'soon-web', schoolId: 'pu' }),
    ]);
  });

  it('also allows the unsorted fallback that still constrains expiresAt', async () => {
    const rows = await getDocs(
      query(
        collection(alice, 'campusStories'),
        where('schoolId', '==', 'pu'),
        where('expiresAt', '>', Date.now() + 3_000),
        limit(80),
      ),
    );
    expect(rows.docs.map((row) => row.id)).toEqual(['soon-web', 'active-web']);
  });

  it('rejects a school-only list that cannot prove expiry', async () => {
    await expect(
      getDocs(query(collection(alice, 'campusStories'), where('schoolId', '==', 'pu'), limit(80))),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects a classmate from another school', async () => {
    const bob = environment.authenticatedContext('bob').firestore() as unknown as Firestore;
    vi.mocked(getDb).mockReturnValue(bob);
    await expect(listActiveStoriesForSchool('pu')).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
});
