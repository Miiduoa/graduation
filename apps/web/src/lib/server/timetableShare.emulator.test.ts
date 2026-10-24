// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTimetableShareHandlers } from './timetableShareHandlers';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
const describeEmulator = /^(?:127\.0\.0\.1|localhost):([0-9]{1,5})$/.test(emulatorHost)
  ? describe
  : describe.skip;

describeEmulator('timetable share handlers against the Firestore emulator', () => {
  let app: import('firebase-admin/app').App;
  let db: import('firebase-admin/firestore').Firestore;
  let handlers: ReturnType<typeof createTimetableShareHandlers>;

  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = emulatorHost.replace('localhost', '127.0.0.1');
    const { initializeApp } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    app = initializeApp({ projectId: 'demo-campus-timetable-share' }, 'timetable-share-emulator');
    db = getFirestore(app);
    handlers = createTimetableShareHandlers({ db: db as never });
  });

  afterAll(async () => {
    const { deleteApp } = await import('firebase-admin/app');
    await deleteApp(app);
  });

  beforeEach(async () => {
    await db.recursiveDelete(db.collection('timetableShares'));
    await db.recursiveDelete(db.collection('timetableShareOwners'));
    await db.recursiveDelete(db.collection('users'));
    await db.doc('users/alice/schools/pu/personalTimetable/current').set({
      schoolId: 'pu',
      courses: [
        {
          id: 'db',
          name: '資料庫',
          day: 1,
          start: 3,
          end: 4,
          teacher: '王',
          room: 'PH303',
          color: 'blue',
        },
      ],
      meta: { title: '114-1', email: 'alice@example.com' },
    });
    handlers = createTimetableShareHandlers({ db: db as never });
  });

  it('writes owner and public share documents together and leaves the timetable unchanged', async () => {
    const before = (await db.doc('users/alice/schools/pu/personalTimetable/current').get()).data();
    const created = await handlers.createTimetableShare({
      auth: { uid: 'alice' },
      data: { schoolId: 'pu' },
    });
    const share = await db.doc(`timetableShares/${created.token}`).get();
    const owner = await db.doc(`timetableShareOwners/${created.token}`).get();
    expect(share.exists).toBe(true);
    expect(share.data()).toMatchObject({
      schoolId: 'pu',
      name: '114-1',
      revoked: false,
    });
    expect(share.data()?.ownerUid).toBeUndefined();
    expect(share.data()?.courses).toEqual([
      expect.objectContaining({ name: '資料庫', teacher: '', room: 'PH303' }),
    ]);
    expect(share.data()?.meta).toEqual({ title: '114-1' });
    expect(JSON.stringify(share.data())).not.toContain('alice@example.com');
    expect(owner.data()).toMatchObject({ ownerUid: 'alice' });
    expect((await db.doc('users/alice/schools/pu/personalTimetable/current').get()).data()).toEqual(
      before,
    );
  });

  it('creates a share from submitted courses without writing a personal timetable', async () => {
    await db.recursiveDelete(db.collection('users'));
    const created = await handlers.createTimetableShare({
      auth: { uid: 'alice' },
      data: {
        schoolId: 'pu',
        name: '我的課表',
        ownerUid: 'mallory',
        token: 'forged',
        courses: [
          {
            id: 'local',
            name: '本機課',
            day: 2,
            start: 1,
            end: 2,
            teacher: '隱',
            room: 'B1',
            color: 'mint',
            email: 'alice@example.com',
          },
        ],
        meta: { title: '本機', studentId: 's1234567' },
      },
    });
    expect(created.token).not.toBe('forged');
    const share = await db.doc(`timetableShares/${created.token}`).get();
    const owner = await db.doc(`timetableShareOwners/${created.token}`).get();
    expect(share.data()).toMatchObject({ schoolId: 'pu', name: '本機', revoked: false });
    expect(share.data()?.ownerUid).toBeUndefined();
    expect(share.data()?.courses).toEqual([
      expect.objectContaining({ name: '本機課', teacher: '', room: 'B1' }),
    ]);
    expect(JSON.stringify(share.data())).not.toContain('alice@example.com');
    expect(JSON.stringify(share.data())).not.toContain('s1234567');
    expect(owner.data()).toMatchObject({ ownerUid: 'alice' });
    expect((await db.collection('users').limit(1).get()).empty).toBe(true);
  });

  it('rejects another user and treats a second owner revoke as idempotent', async () => {
    const created = await handlers.createTimetableShare({
      auth: { uid: 'alice' },
      data: { schoolId: 'pu' },
    });
    await expect(
      handlers.revokeTimetableShare({ auth: { uid: 'mallory' }, data: { token: created.token } }),
    ).rejects.toMatchObject({ code: 'not-found' });
    expect((await db.doc(`timetableShares/${created.token}`).get()).data()?.revoked).toBe(false);
    await expect(
      handlers.revokeTimetableShare({ auth: { uid: 'alice' }, data: { token: created.token } }),
    ).resolves.toEqual({ ok: true });
    await expect(
      handlers.revokeTimetableShare({ auth: { uid: 'alice' }, data: { token: created.token } }),
    ).resolves.toEqual({ ok: true });
    expect((await db.doc(`timetableShares/${created.token}`).get()).data()?.revoked).toBe(true);
  });
});
