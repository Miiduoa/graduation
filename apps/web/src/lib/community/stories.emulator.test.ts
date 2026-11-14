// @vitest-environment node
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocFromServer, getDocs, getDocsFromServer, limit, orderBy, query, startAfter, where, type Firestore } from 'firebase/firestore';
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

  it('keeps retired receipts isolated after a same-school author change', async () => {
    // A retired story ID can be reassigned by an administrative fixture even though
    // ordinary clients cannot update authorUid. A valid school membership alone
    // must not grant either author access to the other author's old receipts.
    const oldPath = 'campusStories/active-web/schools/pu/authors/alice/views';
    const newPath = 'campusStories/active-web/schools/pu/authors/charlie/views';
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        db.doc('users/charlie').set({ status: 'active', schoolId: 'pu', primarySchoolId: 'pu' }),
        db.doc('schools/pu/members/charlie').set({ status: 'active', role: 'student' }),
        db.doc(oldPath + '/prior-viewer').set({
          viewerUid: 'prior-viewer',
          viewedAt: new Date(now - 2_000),
        }),
        db.doc(newPath + '/current-viewer').set({
          viewerUid: 'current-viewer',
          viewedAt: new Date(now - 1_000),
        }),
      ]);
      await db.doc('campusStories/active-web').set({
        schoolId: 'pu', authorUid: 'charlie', kind: 'text',
        expiresAt: now + 3_600_000, createdAt: now,
      });
    });

    const currentAuthor = environment.authenticatedContext('charlie').firestore() as unknown as Firestore;
    const audience = (db: Firestore, path: string) => getDocsFromServer(
      query(collection(db, path), orderBy('viewedAt', 'desc'), limit(21)),
    );

    // The old author remains an active member of the SAME school.
    // Neither that identity nor the new author can read the retired subcollection.
    await expect(audience(alice, oldPath)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(audience(currentAuthor, oldPath)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(getDocFromServer(doc(alice, oldPath + '/prior-viewer'))).rejects.toMatchObject({
      code: 'permission-denied',
    });

    // The replacement author retains the valid path and can read the new receipt.
    const currentPage = await audience(currentAuthor, newPath);
    expect(currentPage.docs.map((row) => row.id)).toEqual(['current-viewer']);
    expect((await getDocFromServer(doc(currentAuthor, newPath + '/current-viewer'))).exists()).toBe(true);
    await expect(audience(alice, newPath)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rechecks the author membership and story expiry before revealing a previously readable audience', async () => {
    const receiptPath = 'campusStories/active-web/schools/pu/authors/alice/views/viewer-pu';
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(receiptPath).set({
        viewerUid: 'viewer-pu',
        viewedAt: new Date(now - 1_000),
      });
    });

    // The author could read this audience while the school and story were valid.
    const audience = () => getDocsFromServer(query(
      collection(alice, 'campusStories/active-web/schools/pu/authors/alice/views'),
      orderBy('viewedAt', 'desc'),
      limit(21),
    ));
    const receipt = () => getDocFromServer(doc(alice, receiptPath));
    expect((await audience()).docs.map((row) => row.id)).toEqual(['viewer-pu']);
    expect((await receipt()).exists()).toBe(true);

    // A stale local member record cannot continue authorizing the private list.
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('schools/pu/members/alice').update({ status: 'inactive' });
    });
    await expect(audience()).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(receipt()).rejects.toMatchObject({ code: 'permission-denied' });

    // Restoring the same verified school membership restores valid server reads.
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('schools/pu/members/alice').update({ status: 'active' });
    });
    expect((await audience()).docs.map((row) => row.id)).toEqual(['viewer-pu']);

    // Even the author must lose receipt access once the story expires.
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('campusStories/active-web').update({ expiresAt: now - 1_000 });
    });
    await expect(audience()).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(receipt()).rejects.toMatchObject({ code: 'permission-denied' });
  });


  it('rechecks a second audience page after school membership changes and story expiry', async () => {
    const path = 'campusStories/active-web/schools/pu/authors/alice/views';
    // Use the same 21-receipt page size as the native service (20 visible + lookahead).
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all(Array.from({ length: 23 }, (_, index) => {
        const uid = `viewer-${String(index).padStart(2, '0')}`;
        return db.doc(`${path}/${uid}`).set({
          viewerUid: uid,
          viewedAt: new Date(now - index * 1_000),
        });
      }));
    });

    const pageQuery = (cursor?: Awaited<ReturnType<typeof getDocsFromServer>>['docs'][number]) =>
      query(
        collection(alice, path),
        orderBy('viewedAt', 'desc'),
        ...(cursor ? [startAfter(cursor)] : []),
        limit(21),
      );

    const firstPage = await getDocsFromServer(pageQuery());
    expect(firstPage.size).toBe(21);
    expect(firstPage.docs[0].id).toBe('viewer-00');
    const previousCursor = firstPage.docs[20];

    // Reusing a cursor issued while authorized must not bypass later revocation.
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('schools/pu/members/alice').update({ status: 'inactive' });
    });
    await expect(getDocsFromServer(pageQuery(previousCursor))).rejects.toMatchObject({
      code: 'permission-denied',
    });

    // After restoration, start with a new server first page and obtain the remaining two.
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('schools/pu/members/alice').update({ status: 'active' });
    });
    const newFirstPage = await getDocsFromServer(pageQuery());
    expect(newFirstPage.size).toBe(21);
    const nextPage = await getDocsFromServer(pageQuery(newFirstPage.docs[20]));
    expect(nextPage.docs.map((row) => row.id)).toEqual(['viewer-21', 'viewer-22']);

    // A cursor must not retain read access when the underlying story expires.
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('campusStories/active-web').update({ expiresAt: now - 1_000 });
    });
    await expect(getDocsFromServer(pageQuery(newFirstPage.docs[20]))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('rejects a classmate from another school', async () => {
    const bob = environment.authenticatedContext('bob').firestore() as unknown as Firestore;
    vi.mocked(getDb).mockReturnValue(bob);
    await expect(listActiveStoriesForSchool('pu')).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
});
