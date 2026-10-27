/* global process, fetch */
'use strict';

const { after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { getApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const local = /^(?:127\.0\.0\.1|localhost):([0-9]{1,5})$/.exec(process.env.FIRESTORE_EMULATOR_HOST || '');
if (!local || Number(local[1]) < 1 || Number(local[1]) > 65535) {
  throw new Error('Run only with an explicit local FIRESTORE_EMULATOR_HOST');
}
const host = `127.0.0.1:${local[1]}`;
const projectId = 'demo-campus-agent-write-transactions';
process.env.FIRESTORE_EMULATOR_HOST = host;
process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
// 載入正式 callable，所有資料庫操作均限於上面指定的本機 demo project。
const service = require('./index');
const db = getFirestore();
const borrow = require('./agent/tools/borrowBook');
const returnBook = require('./agent/tools/returnBook');
const renew = require('./agent/tools/renewBook');
const seat = require('./agent/tools/reserveSeat');
const washing = require('./agent/tools/reserveWashingMachine');
const executeAgentWrite = require('./agent/handlers/executeAgentWrite');
const read = async (path) => (await db.doc(path).get()).data();
const scope = (uid = 'alice') => ({ uid, schoolId: 'pu' });
const request = (uid, data) => ({ auth: { uid }, data: { schoolId: 'pu', ...data } });
const seatInput = (seatId = 'S1') => ({ seatId, date: '2026-10-28', startTime: '09:00', endTime: '10:00' });
const washingInput = { dormitory: 'A', machineId: 'M1', startTime: '09:00' };

async function seed(values) {
  const batch = db.batch();
  for (const [path, data] of values) batch.set(db.doc(path), data);
  await batch.commit();
}

beforeEach(async () => {
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(response.ok, true);
  await seed([
    ...['alice', 'bob'].flatMap((uid) => [
      [`users/${uid}`, { schoolId: 'pu' }],
      [`schools/pu/members/${uid}`, { status: 'active' }],
    ]),
    ['users/alice/schools/pu/personalTimetable/current', {
      schoolId: 'pu', courses: [{ id: 'c1', name: '資料庫', teacher: '王老師' }],
    }],
    ...['B1', 'B2'].map((id) => [`schools/pu/libraryBooks/${id}`, { title: id, availableCopies: 1, available: 1 }]),
    ...['S1', 'S2', 'S3'].map((id) => [`schools/pu/librarySeats/${id}`, { status: 'available' }]),
    ['schools/pu/washingMachines/M1', { dormitory: 'A', status: 'available' }],
  ]);
});

after(async () => {
  await db.terminate();
  await deleteApp(getApp());
});

test('normal callable and Agent compete for the last copy without negative inventory', async () => {
  const results = await Promise.allSettled([
    service.borrowBook.run(request('alice', { bookId: 'B1' })),
    borrow.execute(scope('bob'), { bookId: 'B1' }),
  ]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  const book = await read('schools/pu/libraryBooks/B1');
  assert.equal(book.availableCopies, 0);
  assert.equal(book.available, 0);
  const loans = await db.collection('schools/pu/libraryLoans').get();
  assert.equal(loans.size, 1);
  const loan = loans.docs[0];
  assert.deepEqual(await read(`users/${loan.data().userId}/schools/pu/libraryLoans/${loan.id}`), loan.data());
});

test('different books still share the users ten-loan quota', async () => {
  await seed(Array.from({ length: 9 }, (_, index) => [`schools/pu/libraryLoans/old-${index}`, {
    userId: 'alice', schoolId: 'pu', status: 'borrowed', bookId: `old-${index}`,
  }]));
  const results = await Promise.allSettled([
    service.borrowBook.run(request('alice', { bookId: 'B1' })),
    borrow.execute(scope(), { bookId: 'B2' }),
  ]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal((await db.collection('schools/pu/libraryLoans').get()).size, 10);
  assert.equal((await read('schools/pu/libraryBooks/B1')).availableCopies +
    (await read('schools/pu/libraryBooks/B2')).availableCopies, 1);
});

test('concurrent returns replenish a copy once and preserve the canonical mirror', async () => {
  const loan = await borrow.execute(scope(), { bookId: 'B1' });
  const results = await Promise.allSettled([
    service.returnBook.run(request('alice', { loanId: loan.loanId })),
    returnBook.execute(scope(), { loanId: loan.loanId }),
  ]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal((await read('schools/pu/libraryBooks/B1')).availableCopies, 1);
  const saved = await read(`schools/pu/libraryLoans/${loan.loanId}`);
  assert.equal(saved.status, 'returned');
  assert.deepEqual(await read(`users/alice/schools/pu/libraryLoans/${loan.loanId}`), saved);
});

test('concurrent renewals cannot exceed two and never partly update the mirror', async () => {
  const loan = await borrow.execute(scope(), { bookId: 'B1' });
  await renew.execute(scope(), { loanId: loan.loanId });
  const results = await Promise.allSettled([
    service.renewBook.run(request('alice', { loanId: loan.loanId })),
    renew.execute(scope(), { loanId: loan.loanId }),
  ]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  const saved = await read(`schools/pu/libraryLoans/${loan.loanId}`);
  assert.equal(saved.renewCount, 2);
  assert.deepEqual(await read(`users/alice/schools/pu/libraryLoans/${loan.loanId}`), saved);
  await returnBook.execute(scope(), { loanId: loan.loanId });
  await assert.rejects(renew.execute(scope(), { loanId: loan.loanId }), { code: 'failed-precondition' });
});

test('a missing book blocks a return without changing either loan copy', async () => {
  const loan = await borrow.execute(scope(), { bookId: 'B1' });
  const before = await read(`schools/pu/libraryLoans/${loan.loanId}`);
  await db.doc('schools/pu/libraryBooks/B1').delete();
  await assert.rejects(returnBook.execute(scope(), { loanId: loan.loanId }), { code: 'failed-precondition' });
  assert.deepEqual(await read(`schools/pu/libraryLoans/${loan.loanId}`), before);
  assert.deepEqual(await read(`users/alice/schools/pu/libraryLoans/${loan.loanId}`), before);
});

test('normal and Agent seat requests serialize even when the conflict query starts empty', async () => {
  const results = await Promise.allSettled([
    service.reserveSeat.run(request('alice', seatInput())),
    seat.execute(scope('bob'), seatInput()),
  ]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  const saved = await db.collection('schools/pu/seatReservations').get();
  assert.equal(saved.size, 1);
  const row = saved.docs[0];
  assert.deepEqual(await read(`users/${row.data().userId}/schools/pu/seatReservations/${row.id}`), row.data());
});

test('different seats still share the daily user quota', async () => {
  await seat.execute(scope(), seatInput('S1'));
  const results = await Promise.allSettled([
    service.reserveSeat.run(request('alice', seatInput('S2'))),
    seat.execute(scope(), seatInput('S3')),
  ]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal((await db.collection('schools/pu/seatReservations').get()).size, 2);
});

test('normal and Agent washing reservations cannot both own the same machine', async () => {
  const results = await Promise.allSettled([
    service.reserveWashingMachine.run(request('alice', washingInput)),
    washing.execute(scope('bob'), washingInput),
  ]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  const reservations = await db.collection('schools/pu/washingReservations').get();
  assert.equal(reservations.size, 1);
  assert.equal((await read('schools/pu/washingMachines/M1')).reservedBy, reservations.docs[0].data().userId);
});

test('cancelling an old washing reservation cannot release a newer reservation', async () => {
  const first = await washing.execute(scope(), washingInput);
  await service.cancelWashingReservation.run(request('alice', { reservationId: first.reservationId }));
  assert.equal((await read('schools/pu/washingMachines/M1')).status, 'available');
  const next = await washing.execute(scope('bob'), washingInput);
  await assert.rejects(service.cancelWashingReservation.run(request('alice', {
    reservationId: first.reservationId,
  })), { code: 'failed-precondition' });
  const machine = await read('schools/pu/washingMachines/M1');
  assert.equal(machine.status, 'reserved');
  assert.equal(machine.reservedBy, 'bob');
  assert.equal(machine.activeReservationId, next.reservationId);
  // 舊資料尚未標記取消時，也不能透過舊 owner 把另一筆的新預約解鎖。
  await db.doc(`schools/pu/washingReservations/${first.reservationId}`).update({ status: 'reserved' });
  await service.cancelWashingReservation.run(request('alice', { reservationId: first.reservationId }));
  assert.deepEqual(await read('schools/pu/washingMachines/M1'), machine);
});

test('invalid resources, inactive membership and closing accounts never write service records', async () => {
  await assert.rejects(seat.execute(scope(), seatInput('missing')), { code: 'not-found' });
  await assert.rejects(seat.execute(scope(), { ...seatInput(), endTime: '08:00' }), { code: 'invalid-argument' });
  await assert.rejects(washing.execute(scope(), { ...washingInput, dormitory: 'foreign' }), { code: 'invalid-argument' });
  await db.doc('schools/pu/members/alice').update({ status: 'inactive' });
  for (const [tool, input] of [[borrow, { bookId: 'B1' }], [seat, seatInput()], [washing, washingInput]]) {
    await assert.rejects(tool.execute(scope(), input), { code: 'permission-denied' });
  }
  await db.doc('schools/pu/members/alice').update({ status: 'active' });
  await db.doc('users/alice').update({ accountDeletionInProgress: true });
  await assert.rejects(borrow.execute(scope(), { bookId: 'B1' }), { code: 'failed-precondition' });
  for (const path of ['libraryLoans', 'seatReservations', 'washingReservations']) {
    assert.equal((await db.collection(`schools/pu/${path}`).get()).size, 0);
  }
});

async function proposal(overrides = {}) {
  const runId = randomUUID();
  const input = { courseId: 'c1', date: '2026-10-28', type: '病假' };
  await db.doc(`users/alice/agentRuns/${runId}`).set({
    runId, userId: 'alice', schoolId: 'pu', status: 'completed', steps: [],
    createdAt: Timestamp.now(), actionProposals: [{ toolName: 'submitLeaveRequest', input }],
    ...overrides,
  });
  return { auth: { uid: 'alice' }, data: {
    toolName: 'submitLeaveRequest', agentRunId: runId, input,
    context: { schoolId: 'pu', groupId: 'untrusted-foreign-group' },
  } };
}

test('one Agent proposal can be claimed once and never accepts a client group override', async () => {
  const action = await proposal();
  const results = await Promise.allSettled([executeAgentWrite.run(action), executeAgentWrite.run(action)]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(results.find((row) => row.status === 'rejected').reason.code, 'already-exists');
  const leaves = await db.collection('leaveRequests').get();
  assert.equal(leaves.size, 1);
  const saved = leaves.docs[0].data();
  assert.equal(saved.uid, 'alice');
  assert.equal(saved.schoolId, 'pu');
  assert.equal(saved.groupId, undefined);
  assert.equal(saved.source, 'campus-one');
  assert.equal(saved.officialSubmitted, false);
  assert.equal(saved.courses[0].offeringId, '資料庫｜王老師');
  const run = await read(`users/alice/agentRuns/${action.data.agentRunId}`);
  assert.equal(run.actionClaims['0'].status, 'completed');
});

test('changed, foreign or expired proposals cannot execute a write', async () => {
  const action = await proposal();
  await assert.rejects(executeAgentWrite.run({ ...action, data: { ...action.data,
    input: { ...action.data.input, courseId: 'foreign' },
  } }), { code: 'permission-denied' });
  await assert.rejects(executeAgentWrite.run({ ...action, auth: { uid: 'bob' } }), { code: 'permission-denied' });
  const expired = await proposal({ createdAt: Timestamp.fromMillis(Date.now() - 31 * 60 * 1000) });
  await assert.rejects(executeAgentWrite.run(expired), { code: 'permission-denied' });
  assert.equal((await db.collection('leaveRequests').get()).size, 0);
});

test('a failed Agent write remains claimed and cannot be replayed as success', async () => {
  const action = await proposal();
  await db.doc('users/alice/schools/pu/personalTimetable/current').delete();
  await assert.rejects(executeAgentWrite.run(action), { code: 'failed-precondition' });
  await assert.rejects(executeAgentWrite.run(action), { code: 'already-exists' });
  assert.equal((await read(`users/alice/agentRuns/${action.data.agentRunId}`)).actionClaims['0'].status, 'unverified');
  assert.equal((await db.collection('leaveRequests').get()).size, 0);
});
