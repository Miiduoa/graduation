// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore, type Timestamp } from 'firebase-admin/firestore';
import { LMS_CACHE_COLLECTION } from '@campus/shared/src/puLmsReadonly';
import type { AcademicFirestore } from './academicRecordsHandlers';
import { createTronClassLmsHandler } from './tronClassLmsHandler';
import type { LmsReadonlySource } from './tronClassLmsSource';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
const localEmulator = /^(?:127\.0\.0\.1|localhost):\d{1,5}$/.test(emulatorHost);
const uid = 'lms-cache-test';
const portal = '_puSessions/current';
const originalId = 'b'.repeat(32);
const replacementId = 'c'.repeat(32);
const cache = `${LMS_CACHE_COLLECTION}/${uid}`;

function courseSource(name: string): LmsReadonlySource {
  return {
    fetchCourses: async (_cookies, { status }) => status === 'upcoming' ? [] : [{ id: 10001, name }],
    fetchHomeworkPage: async () => ({ ok: true, value: { homework_activities: [], total: 0 } }),
    fetchActivities: async () => ({ ok: true, value: [] }),
    fetchCourseAnnouncements: async () => ({ ok: true, value: [] }),
    fetchSiteAnnouncements: async () => ({ ok: true, value: [] }),
  };
}

describe.skipIf(!localEmulator)('TronClass cache writes against the Firestore emulator', () => {
  let app: App;
  let db: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-campus-tronclass-cache' }, 'tronclass-cache-emulator');
    db = getFirestore(app);
    vi.stubEnv('SCHOOL_LMS_READONLY_ENABLED', 'true');
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await deleteApp(app);
  });

  beforeEach(async () => {
    const expiresAt = new Date(Date.now() + 600_000);
    const batch = db.batch();
    batch.set(db.doc(`users/${uid}`), { schoolId: 'pu' });
    batch.set(db.doc(`schools/pu/members/${uid}`), { status: 'active' });
    batch.set(db.doc(portal), { ownerUid: uid, tronClassSessionId: originalId, expiresAt });
    for (const id of [originalId, replacementId]) {
      batch.set(db.doc(`_puTronClassSessions/${id}`), {
        ownerUid: uid, userId: id === originalId ? 1 : 2, cookies: { session: id }, expiresAt,
      });
    }
    batch.delete(db.doc(cache));
    await batch.commit();
  });

  function read(source: LmsReadonlySource, refresh = false) {
    const handler = createTronClassLmsHandler({ db: db as unknown as AcademicFirestore, source });
    return handler({ auth: { uid, token: { schoolId: 'pu' } }, data: { refresh } });
  }

  async function refreshReplacement() {
    await read(courseSource('新課表'), true);
    return (await db.doc(cache).get()).updateTime;
  }

  async function expectReplacement(version: Timestamp | undefined) {
    const saved = await db.doc(cache).get();
    expect(version).toBeDefined();
    expect(saved.updateTime).toEqual(version);
    expect(saved.get('snapshot.courses')).toEqual([{ id: 10001, name: '新課表' }]);
  }

  it('preserves the completed refresh when an older same-session response arrives later', async () => {
    let replacementTime: Timestamp | undefined;
    const slow = courseSource('舊課表');
    slow.fetchHomeworkPage = async () => {
      replacementTime = await refreshReplacement();
      return { ok: true, value: { homework_activities: [], total: 0 } };
    };
    await read(slow, true);
    await expectReplacement(replacementTime);
  });

  it('keeps the replacement session cache when the old request reaches its write', async () => {
    let replacementTime: Timestamp | undefined;
    const runTransaction = db.runTransaction.bind(db);
    // Relink after fetching and before the old cache transaction starts. Each
    // handler still commits through the real SDK, including the resumed writer.
    const transaction = vi.spyOn(db, 'runTransaction').mockImplementationOnce(async (fn, options) => {
      await db.doc(portal).update({ tronClassSessionId: replacementId });
      replacementTime = await refreshReplacement();
      return runTransaction(fn, options);
    });
    try {
      await expect(read(courseSource('舊課表'), true)).rejects.toMatchObject({ code: 'failed-precondition' });
    } finally {
      transaction.mockRestore();
    }
    await expectReplacement(replacementTime);
  });

  it('refetches after credentials rotate between reads of the same session document', async () => {
    await read(courseSource('舊課表'));
    await db.doc(`_puTronClassSessions/${originalId}`).update({
      userId: 2, cookies: { session: 'replacement' },
    });
    const result = await read(courseSource('新課表'));
    expect(result.cache.hit).toBe(false);
    expect(result.courses).toEqual([{ id: 10001, name: '新課表' }]);
  });
});
