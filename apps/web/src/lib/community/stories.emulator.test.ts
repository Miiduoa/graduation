// @vitest-environment node
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, getDocs, getDocsFromServer, limit, orderBy, query, where, type Firestore } from 'firebase/firestore';
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


  it('allows only the current story author to fetch private audience receipts from the server', async () => {
    const viewPath = 'campusStories/active-web/schools/pu/authors/alice/views';
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        db.doc('users/viewer-pu').set({ status: 'active', schoolId: 'pu', primarySchoolId: 'pu' }),
        db.doc('schools/pu/members/viewer-pu').set({ status: 'active', role: 'student' }),
        db.doc(viewPath + '/viewer-pu').set({ viewerUid: 'viewer-pu', viewedAt: new Date(now - 1000) }),
      ]);
    });

    const audience = (db: Firestore) =>
      query(collection(db, viewPath), orderBy('viewedAt', 'desc'), limit(21));

    // The UI's refresh uses the same server-only receipt query.
    const ownerPage = await getDocsFromServer(audience(alice));
    expect(ownerPage.docs.map((row) => row.id)).toEqual(['viewer-pu']);

    const otherSchool = environment.authenticatedContext('bob').firestore() as unknown as Firestore;
    await expect(getDocsFromServer(audience(otherSchool))).rejects.toMatchObject({
      code: 'permission-denied',
    });
    const classmate = environment.authenticatedContext('viewer-pu').firestore() as unknown as Firestore;
    await expect(getDocsFromServer(audience(classmate))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('rejects old audience paths after a story ID is reused by a different school and author', async () => {
    const oldPath = 'campusStories/active-web/schools/pu/authors/alice/views';
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc(oldPath + '/old-student').set({
        viewerUid: 'old-student',
        viewedAt: new Date(now - 1000),
      });
      // Simulate the retired parent being replaced; client-side updates are forbidden by rules.
      await db.doc('campusStories/active-web').set({
        schoolId: 'other', authorUid: 'bob', kind: 'text',
        expiresAt: now + 3_600_000, createdAt: now,
      });
    });

    const oldAudience = (db: Firestore) =>
      getDocsFromServer(query(collection(db, oldPath), orderBy('viewedAt', 'desc'), limit(21)));

    await expect(oldAudience(alice)).rejects.toMatchObject({ code: 'permission-denied' });
    const currentOwner = environment.authenticatedContext('bob').firestore() as unknown as Firestore;
    await expect(oldAudience(currentOwner)).rejects.toMatchObject({ code: 'permission-denied' });

    const currentPath = 'campusStories/active-web/schools/other/authors/bob/views';
    const newAudience = await getDocsFromServer(
      query(collection(currentOwner, currentPath), orderBy('viewedAt', 'desc'), limit(21)),
    );
    expect(newAudience.empty).toBe(true);
  });

  it('rejects a classmate from another school', async () => {
    const bob = environment.authenticatedContext('bob').firestore() as unknown as Firestore;
    vi.mocked(getDb).mockReturnValue(bob);
    await expect(listActiveStoriesForSchool('pu')).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
});
