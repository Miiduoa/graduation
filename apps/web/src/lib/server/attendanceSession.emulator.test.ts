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
    await db.recursiveDelete(db.collection('schools'));
    await db.recursiveDelete(db.collection('users'));
    await db.doc('groups/class-1').set({
      name: '程式設計',
      type: 'course',
      schoolId: 'school-1',
    });
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
    await db.doc('schools/school-1/members/teacher').set({ status: 'active' });
    await db.doc('schools/school-1/members/student').set({ status: 'active' });
    handlers = createLiveSessionHandlers({ db: db as never, now: () => time });
  });

  function startSession() {
    return handlers.startLiveSession({
      auth: { uid: 'teacher' },
      data: { groupId: 'class-1', requestId: 'attempt-1' },
    });
  }

  function correction(
    sessionId: string,
    requestId: string,
    status: 'present' | 'late' | 'absent' | 'excused' = 'present',
    studentUid = 'student',
  ) {
    return handlers.correctAttendanceRecord({
      auth: { uid: 'teacher' },
      data: {
        groupId: 'class-1',
        sessionId,
        studentUid,
        requestId,
        status,
        reason: '授課教師已核對課堂出席紀錄',
      },
    });
  }

  function attendanceRef(sessionId: string) {
    return db.doc(`groups/class-1/attendanceSessions/${sessionId}`);
  }

  async function expectCounters(sessionId: string, expected: number) {
    const [live, attendance] = await db.getAll(
      db.doc(`groups/class-1/liveSessions/${sessionId}`),
      attendanceRef(sessionId),
    );
    expect(live.data()?.attendeeCount).toBe(expected);
    expect(attendance.data()?.attendeeCount).toBe(expected);
  }

  it('starts, joins once, and rejects a non-member with the same token', async () => {
    const started = await startSession();
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
    await expectCounters(started.sessionId, 1);
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

  it('persists the full QR, close, late correction and excused workflow without erasing audit history', async () => {
    const session = await startSession();
    const joinRequest = {
      auth: { uid: 'student' },
      data: { groupId: 'class-1', sessionId: session.sessionId, qrToken: session.qrToken },
    };
    const joined = await handlers.joinLiveSession(joinRequest);
    await expect(correction(session.sessionId, 'too-early', 'absent'))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await attendanceRef(session.sessionId).collection('attendanceCorrections').get()).size).toBe(0);
    await expectCounters(session.sessionId, 1);
    await handlers.endLiveSession({
      auth: { uid: 'teacher' },
      data: { groupId: 'class-1', sessionId: session.sessionId },
    });

    time += 60_000;
    await correction(session.sessionId, 'mark-late', 'late');
    const recordRef = attendanceRef(session.sessionId).collection('attendanceRecords').doc('student');
    const late = (await recordRef.get()).data();
    expect(late).toMatchObject({
      uid: 'student', groupId: 'class-1', sessionId: session.sessionId,
      status: 'late', source: 'manual', correctedBy: 'teacher',
    });
    expect(late?.checkedInAt.toDate().toISOString()).toBe(joined.checkedInAt);
    expect(late?.correctedAt.toMillis()).toBe(time);
    await expectCounters(session.sessionId, 1);

    time += 60_000;
    await correction(session.sessionId, 'mark-excused', 'excused');
    expect((await recordRef.get()).data()).toMatchObject({
      status: 'excused', source: 'manual', checkedInAt: null,
    });
    await expectCounters(session.sessionId, 0);
    const audit = await attendanceRef(session.sessionId).collection('attendanceCorrections').get();
    expect(audit.size).toBe(2);
    expect(audit.docs.map((entry) => entry.data())).toEqual(expect.arrayContaining([
      expect.objectContaining({ previousStatus: 'present', nextStatus: 'late', teacherUid: 'teacher' }),
      expect.objectContaining({ previousStatus: 'late', nextStatus: 'excused', teacherUid: 'teacher' }),
    ]));
    await expect(handlers.joinLiveSession(joinRequest))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    await expectCounters(session.sessionId, 0);
  }, 20_000);

  it('commits one receipt, one audit and one increment for simultaneous identical correction retries', async () => {
    const session = await startSession();
    const results = await Promise.all([
      correction(session.sessionId, 'same-request'),
      correction(session.sessionId, 'same-request'),
    ]);
    expect(results.filter((result) => result.reused === false)).toHaveLength(1);
    expect(results.filter((result) => result.reused === true)).toHaveLength(1);
    await expectCounters(session.sessionId, 1);
    expect((await attendanceRef(session.sessionId).collection('attendanceRecords').get()).size).toBe(1);
    expect((await attendanceRef(session.sessionId).collection('attendanceCorrections').get()).size).toBe(1);
    await expect(correction(session.sessionId, 'same-request', 'late'))
      .rejects.toMatchObject({ code: 'already-exists' });
    await expectCounters(session.sessionId, 1);
  }, 20_000);

  it('serializes simultaneous corrections for different students without losing an attendee increment', async () => {
    await db.doc('groups/class-1/members/other-student').set({ role: 'student', status: 'active' });
    await db.doc('schools/school-1/members/other-student').set({ status: 'active' });
    const session = await startSession();
    await Promise.all([
      correction(session.sessionId, 'first-student'),
      correction(session.sessionId, 'second-student', 'late', 'other-student'),
    ]);
    await expectCounters(session.sessionId, 2);
    expect((await attendanceRef(session.sessionId).collection('attendanceRecords').get()).size).toBe(2);
    expect((await attendanceRef(session.sessionId).collection('attendanceCorrections').get()).size).toBe(2);
  }, 20_000);

  it.each(['teacher', 'student'])('rechecks %s school membership even for an already committed correction', async (uid) => {
    const session = await startSession();
    await correction(session.sessionId, 'saved-request');
    await db.doc(`schools/school-1/members/${uid}`).update({ status: 'inactive' });
    await db.doc(`schools/other-school/members/${uid}`).set({ status: 'active' });
    for (const requestId of ['saved-request', 'new-request']) {
      await expect(handlers.correctAttendanceRecord({
        auth: { uid: 'teacher' },
        data: {
          groupId: 'class-1', sessionId: session.sessionId, studentUid: 'student',
          status: 'present', reason: '授課教師已核對課堂出席紀錄', requestId,
          schoolId: 'other-school',
        },
      })).rejects.toMatchObject({ code: 'permission-denied' });
    }
    await expectCounters(session.sessionId, 1);
    expect((await attendanceRef(session.sessionId).collection('attendanceCorrections').get()).size).toBe(1);
  }, 20_000);

  it.each([
    { uid: 'teacher', account: { accountDeletionInProgress: true } },
    { uid: 'student', account: { accountDeletionInProgress: true } },
    { uid: 'teacher', account: { status: 'deleted' } },
    { uid: 'student', account: { status: 'deleted' } },
  ])('rejects unavailable $uid accounts without partial writes', async ({ uid, account }) => {
    const session = await startSession();
    await db.doc(`users/${uid}`).set(account);
    await expect(correction(session.sessionId, 'unavailable-account'))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await expectCounters(session.sessionId, 0);
    expect((await attendanceRef(session.sessionId).collection('attendanceRecords').get()).size).toBe(0);
    expect((await attendanceRef(session.sessionId).collection('attendanceCorrections').get()).size).toBe(0);
  }, 20_000);

  function reviewedCorrection(sessionId: string, requestId: string, expectedRevision: number | null,
    status: 'present' | 'late' | 'absent' | 'excused' = 'present', uid = 'teacher') {
    return handlers.correctAttendanceRecord({ auth: { uid }, data: {
      groupId: 'class-1', sessionId, studentUid: 'student', requestId, expectedRevision,
      status, reason: '授課教師核對目前版本後確認',
    } });
  }

  it('allows only one of two different reviewed corrections to win against a missing receipt', async () => {
    await db.doc('groups/class-1/members/second').set({ role: 'instructor', status: 'active' });
    await db.doc('schools/school-1/members/second').set({ status: 'active' });
    const session = await startSession();
    const results = await Promise.allSettled([
      reviewedCorrection(session.sessionId, 'one', null, 'present'),
      reviewedCorrection(session.sessionId, 'two', null, 'late', 'second'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toMatchObject({ code: 'aborted' });
    await expectCounters(session.sessionId, 1);
    const reference = attendanceRef(session.sessionId);
    expect((await reference.collection('attendanceRecords').doc('student').get()).data()?.revision).toBe(1);
    expect((await reference.collection('attendanceCorrections').get()).size).toBe(1);
  }, 20_000);

  it('retains idempotency for simultaneous requests carrying the same reviewed revision', async () => {
    const session = await startSession();
    const results = await Promise.all([
      reviewedCorrection(session.sessionId, 'same-reviewed', null),
      reviewedCorrection(session.sessionId, 'same-reviewed', null),
    ]);
    expect(results.filter((result) => result.reused)).toHaveLength(1);
    await expectCounters(session.sessionId, 1);
    const reference = attendanceRef(session.sessionId);
    expect((await reference.collection('attendanceRecords').doc('student').get()).data()?.revision).toBe(1);
    expect((await reference.collection('attendanceCorrections').get()).size).toBe(1);
  }, 20_000);

  it('does not overwrite a QR receipt created after a teacher reviewed the empty state', async () => {
    const session = await startSession();
    const joined = await handlers.joinLiveSession({ auth: { uid: 'student' }, data: {
      groupId: 'class-1', sessionId: session.sessionId, qrToken: session.qrToken,
    } });
    await expect(reviewedCorrection(session.sessionId, 'stale-empty', null, 'late'))
      .rejects.toMatchObject({ code: 'aborted' });
    expect((await attendanceRef(session.sessionId).collection('attendanceCorrections').get()).size).toBe(0);
    await reviewedCorrection(session.sessionId, 'review-qr', 0, 'late');
    const receipt = (await attendanceRef(session.sessionId).collection('attendanceRecords').doc('student').get()).data();
    expect(receipt?.checkedInAt.toDate().toISOString()).toBe(joined.checkedInAt);
    expect(receipt).toMatchObject({ revision: 1, status: 'late' });
    await expectCounters(session.sessionId, 1);
  }, 20_000);

  it('requires explicit re-review before replacing a newer excused decision', async () => {
    const session = await startSession();
    await handlers.endLiveSession({ auth: { uid: 'teacher' }, data: { groupId: 'class-1', sessionId: session.sessionId } });
    await reviewedCorrection(session.sessionId, 'approved-leave', null, 'excused');
    await expect(reviewedCorrection(session.sessionId, 'old-screen', null, 'absent'))
      .rejects.toMatchObject({ code: 'aborted' });
    const reference = attendanceRef(session.sessionId);
    expect((await reference.collection('attendanceRecords').doc('student').get()).data()?.status).toBe('excused');
    await reviewedCorrection(session.sessionId, 'reviewed-screen', 1, 'absent');
    expect((await reference.collection('attendanceRecords').doc('student').get()).data()).toMatchObject({ status: 'absent', revision: 2 });
    const audit = await reference.collection('attendanceCorrections').get();
    expect(audit.size).toBe(2);
    expect(audit.docs.map((entry) => entry.data())).toEqual(expect.arrayContaining([
      expect.objectContaining({ previousRevision: 1, revision: 2, previousStatus: 'excused', nextStatus: 'absent' }),
    ]));
    await expectCounters(session.sessionId, 0);
  }, 20_000);
});
