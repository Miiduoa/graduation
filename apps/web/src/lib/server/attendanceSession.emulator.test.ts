// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLiveSessionHandlers } from './attendanceSessionHandlers';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
const describeEmulator = /^(?:127\.0\.0\.1|localhost):([0-9]{1,5})$/.test(emulatorHost)
  ? describe
  : describe.skip;

describeEmulator('attendance session handlers against the Firestore emulator', () => {
  let app: import('firebase-admin/app').App;
  let db: import('firebase-admin/firestore').Firestore;
  let handlers: ReturnType<typeof createLiveSessionHandlers>;
  let time: number;

  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = emulatorHost.replace('localhost', '127.0.0.1');
    const { initializeApp } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    app = initializeApp({ projectId: 'demo-campus-attendance' }, 'attendance-emulator');
    db = getFirestore(app);
    time = Date.parse('2026-10-07T03:00:00Z');
    handlers = createLiveSessionHandlers({ db: db as never, now: () => time });
  });

  afterAll(async () => {
    const { deleteApp } = await import('firebase-admin/app');
    await deleteApp(app);
  });

  beforeEach(async () => {
    time = Date.parse('2026-10-07T03:00:00Z');
    await db.recursiveDelete(db.collection('groups'));
    await db.doc('groups/class-1').set({ name: '程式設計' });
    await db.doc('groups/class-1/members/teacher').set({
      uid: 'teacher',
      role: 'instructor',
      status: 'active',
    });
    await db.doc('groups/class-1/members/student').set({
      uid: 'student',
      role: 'student',
      status: 'active',
      displayName: '陳同學',
      studentId: 'S123',
    });
    handlers = createLiveSessionHandlers({ db: db as never, now: () => time });
  });

  it('starts, joins once, and rejects a non-member with the same token', async () => {
    const started = await handlers.startLiveSession({
      auth: { uid: 'teacher' },
      data: { groupId: 'class-1', requestId: 'attempt-1' },
    });
    const first = await handlers.joinLiveSession({
      auth: { uid: 'student' },
      data: {
        groupId: 'class-1',
        sessionId: started.sessionId,
        qrToken: started.qrToken,
      },
    });
    const retry = await handlers.joinLiveSession({
      auth: { uid: 'student' },
      data: {
        groupId: 'class-1',
        sessionId: started.sessionId,
        qrToken: started.qrToken,
      },
    });
    expect(first.alreadyJoined).toBe(false);
    expect(retry).toMatchObject({ alreadyJoined: true, checkedInAt: first.checkedInAt });
    await expect(
      handlers.joinLiveSession({
        auth: { uid: 'outsider' },
        data: {
          groupId: 'class-1',
          sessionId: started.sessionId,
          qrToken: started.qrToken,
        },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    const attendance = await db.doc(`groups/class-1/attendanceSessions/${started.sessionId}`).get();
    expect(attendance.data()?.attendeeCount).toBe(1);
  });

  it('rejects a join after the QR window expires', async () => {
    const started = await handlers.startLiveSession({
      auth: { uid: 'teacher' },
      data: { groupId: 'class-1', requestId: 'attempt-1', qrExpiryMinutes: 5 },
    });
    time += 5 * 60_000;
    await expect(
      handlers.joinLiveSession({
        auth: { uid: 'student' },
        data: {
          groupId: 'class-1',
          sessionId: started.sessionId,
          qrToken: started.qrToken,
        },
      }),
    ).rejects.toMatchObject({ code: 'deadline-exceeded' });
  });
});
