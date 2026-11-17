/* global process, fetch */
'use strict';

const { after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { getApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');

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
const { resolveReserveSeatInput } = require('./lib/campusWriteIntentResolve');
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

async function proposal(overrides = {}, { seedLeavePermission = true } = {}) {
  const runId = randomUUID();
  const input = { courseId: 'c1', date: '2026-10-28', type: '病假' };
  // 此測例需要執行寫入；只開測試用到的請假權限，其餘維持預設關閉。
  if (seedLeavePermission) {
    await db.doc('users/alice/settings/assistantPermissions').set({ submitLeaveRequest: true });
  }
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

// These fixtures exercise nuni's Firebase collections only. They neither call
// nor claim to reserve a seat in an official library booking system.
const exactSeatInput = { seatId: 'lib-3F-A15', date: '2026-11-18', startTime: '14:00', endTime: '16:30' };
const exactSeatMessage = '2026-11-18 圖書館三樓 A15，14:00–16:30 預約座位';
async function seatProposal(message = exactSeatMessage, expected = exactSeatInput) {
  const input = resolveReserveSeatInput(message, 'Asia/Taipei');
  assert.deepEqual(input, expected, 'the proposed interval must preserve the explicit request');
  await seed([
    [`schools/pu/librarySeats/${input.seatId}`, { status: 'available' }],
    ['users/alice/settings/assistantPermissions', { reserveSeat: true }],
  ]);
  const action = await proposal({ actionProposals: [{ toolName: 'reserveSeat', input }] },
    { seedLeavePermission: false });
  action.data.toolName = 'reserveSeat';
  action.data.input = input;
  return action;
}

async function seatServiceSnapshot() {
  const paths = [
    'schools/pu/seatReservations', 'schools/pu/librarySeats', 'schools/pu/serviceWriteGuards',
    ...['alice', 'bob'].flatMap(uid => [
      `users/${uid}/schools/pu/seatReservations`, `users/${uid}/schools/pu/serviceWriteGuards`,
    ]),
  ];
  const rows = await Promise.all(paths.map(async path => {
    const snapshot = await db.collection(path).get();
    return snapshot.docs.map(doc => ({ path: doc.ref.path, data: doc.data(), updateTime: doc.updateTime }));
  }));
  return rows.flat().sort((left, right) => left.path.localeCompare(right.path));
}

async function assertSeatReceipt(action, receipt) {
  assert.equal(receipt.success, true);
  assert.equal(receipt.toolName, 'reserveSeat');
  for (const field of ['seatId', 'date', 'startTime', 'endTime']) {
    assert.equal(receipt[field], action.data.input[field], `receipt must retain ${field}`);
  }
  const canonical = await read(`schools/pu/seatReservations/${receipt.reservationId}`);
  assert.deepEqual(canonical, await read(`users/alice/schools/pu/seatReservations/${receipt.reservationId}`));
  assert.equal(canonical.userId, 'alice');
  assert.equal(canonical.schoolId, 'pu');
  assert.equal(canonical.status, 'active');
  assert.ok(canonical.createdAt instanceof Timestamp);
  for (const field of ['seatId', 'date', 'startTime', 'endTime']) {
    assert.equal(canonical[field], action.data.input[field], `canonical record must retain ${field}`);
  }
  const run = await read(`users/alice/agentRuns/${action.data.agentRunId}`);
  assert.equal(run.actionClaims['0'].status, 'completed');
  assert.deepEqual(run.steps[0].input, action.data.input);
  assert.deepEqual(run.steps[0].output, receipt);
}

// The test hook runs only AFTER the real claim transaction has committed. Read
// failures and commit aborts wrap the real SDK, never a production bypass flag.
async function afterSeatClaim(action, change, { failSeatRead = false, abortCommit = false } = {}) {
  const original = db.runTransaction;
  const runRef = db.doc(`users/alice/agentRuns/${action.data.agentRunId}`);
  let changed = false;
  let failedReads = 0;
  let aborted = false;
  db.runTransaction = async function(callback, ...options) {
    const result = await original.call(this, async tx => {
      const originalGet = tx.get;
      if (changed && failSeatRead) {
        tx.get = function(reference, ...args) {
          if (reference.path === `schools/pu/librarySeats/${action.data.input.seatId}`) {
            failedReads += 1;
            return Promise.reject(new HttpsError('unavailable', 'synthetic seat source unavailable'));
          }
          return originalGet.call(this, reference, ...args);
        };
      }
      try {
        const value = await callback(tx);
        if (changed && abortCommit && !aborted) {
          aborted = true;
          throw new HttpsError('unavailable', 'synthetic abort before seat transaction commit');
        }
        return value;
      } finally { tx.get = originalGet; }
    }, ...options);
    if (!changed && (await runRef.get()).data()?.actionClaims?.['0']?.status === 'started') {
      changed = true;
      await change();
    }
    return result;
  };
  try { return await executeAgentWrite.run(action); }
  finally {
    db.runTransaction = original;
    assert.equal(changed, true, 'the fault must occur after the real claim commits');
    if (failSeatRead) assert.ok(failedReads > 0, 'the service transaction must read the source');
    if (abortCommit) assert.equal(aborted, true, 'the actual service callback must reach pre-commit');
  }
}

test('resolved Agent seat proposal preserves 14:00–16:30 through receipt and canonical mirror', async () => {
  const action = await seatProposal();
  const receipt = await executeAgentWrite.run(action);
  await assertSeatReceipt(action, receipt);
  const beforeReplay = await seatServiceSnapshot();
  await assert.rejects(executeAgentWrite.run(action), { code: 'already-exists' });
  assert.deepEqual(await seatServiceSnapshot(), beforeReplay);
  assert.equal((await db.collection('schools/pu/seatReservations').get()).size, 1);
});

test('resolved 30-minute Agent seat proposal claims once under duplicate confirmation', async () => {
  const action = await seatProposal('2026-11-18 圖書館三樓 A15，14:00 開始預約 30 分鐘',
    { ...exactSeatInput, endTime: '14:30' });
  const results = await Promise.allSettled([executeAgentWrite.run(action), executeAgentWrite.run(action)]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.code, 'already-exists');
  await assertSeatReceipt(action, results.find(row => row.status === 'fulfilled').value);
  assert.equal((await db.collection('schools/pu/seatReservations').get()).size, 1);
});

test('missing seat selection or interval cannot generate an arbitrary Agent seat proposal', async () => {
  const before = await seatServiceSnapshot();
  for (const message of [
    '2026-11-18 14:00–16:30 圖書館三樓隨便一席',
    '2026-11-18 14:00–16:30 預約座位',
    '2026-11-18 14:00 圖書館三樓 A15 預約座位',
  ]) assert.equal(resolveReserveSeatInput(message, 'Asia/Taipei'), null, message);
  assert.deepEqual(await seatServiceSnapshot(), before);
  assert.equal((await db.collection('users/alice/agentRuns').get()).size, 0);
});

for (const fault of [
  { name: 'source removed', code: 'not-found', apply: action => db.doc(`schools/pu/librarySeats/${action.data.input.seatId}`).delete() },
  { name: 'source closed', code: 'failed-precondition', apply: action => db.doc(`schools/pu/librarySeats/${action.data.input.seatId}`).update({ status: 'disabled' }) },
  { name: 'school membership withdrawn', code: 'permission-denied', apply: () => db.doc('schools/pu/members/alice').update({ status: 'inactive' }) },
  { name: 'source read unavailable', code: 'unavailable', apply: async () => {}, failSeatRead: true },
  { name: 'transaction commit aborted', code: 'unavailable', apply: async () => {}, abortCommit: true },
  { name: 'another user reserved the interval', code: 'already-exists', apply: action => seat.execute(scope('bob'), action.data.input) },
]) {
  test(`Agent seat ${fault.name} after claim leaves no partial reservation, mirror or guard`, async () => {
    const action = await seatProposal();
    let beforeService;
    await assert.rejects(afterSeatClaim(action, async () => {
      await fault.apply(action);
      beforeService = await seatServiceSnapshot();
    }, fault), { code: fault.code });
    assert.deepEqual(await seatServiceSnapshot(), beforeService);
    assert.equal((await db.collection('users/alice/schools/pu/seatReservations').get()).size, 0);
    const run = await read(`users/alice/agentRuns/${action.data.agentRunId}`);
    assert.equal(run.actionClaims['0'].status, 'unverified');
    assert.equal(run.steps[0].output.success, false);
    if (fault.name === 'school membership withdrawn') {
      await db.doc('schools/pu/members/alice').update({ status: 'active' });
    }
    await assert.rejects(executeAgentWrite.run(action), { code: 'already-exists' });
    assert.deepEqual(await seatServiceSnapshot(), beforeService);
  });
}

test('seat proposal tampering cannot claim another interval, seat, date, school or account', async () => {
  const action = await seatProposal();
  const before = await seatServiceSnapshot();
  for (const input of [
    { ...action.data.input, endTime: '18:00' },
    { ...action.data.input, seatId: 'S2' },
    { ...action.data.input, date: '2026-11-19' },
  ]) await assert.rejects(executeAgentWrite.run({ ...action, data: { ...action.data, input } }), { code: 'permission-denied' });
  await assert.rejects(executeAgentWrite.run({ ...action, auth: { uid: 'bob' } }), { code: 'permission-denied' });
  await assert.rejects(executeAgentWrite.run({ ...action, data: { ...action.data, context: { schoolId: 'foreign' } } }), { code: 'permission-denied' });
  assert.deepEqual(await seatServiceSnapshot(), before);
  assert.equal((await read(`users/alice/agentRuns/${action.data.agentRunId}`)).actionClaims, undefined);
  await assertSeatReceipt(action, await executeAgentWrite.run(action));
});

test('a mismatched seat time receipt remains unverified after the real commit and cannot repeat it', async () => {
  const action = await seatProposal();
  const execute = seat.execute;
  let receipt;
  seat.execute = async (...args) => ({ ...await execute(...args), endTime: '18:00' });
  try { receipt = await executeAgentWrite.run(action); }
  finally { seat.execute = execute; }
  assert.equal(receipt.success, false);
  assert.equal(receipt.errorCode, 'unverified_receipt');
  const reservations = await db.collection('schools/pu/seatReservations').get();
  assert.equal(reservations.size, 1);
  const canonical = reservations.docs[0];
  assert.equal(canonical.data().startTime, '14:00');
  assert.equal(canonical.data().endTime, '16:30');
  assert.deepEqual(await read(`users/alice/schools/pu/seatReservations/${canonical.id}`), canonical.data());
  const run = await read(`users/alice/agentRuns/${action.data.agentRunId}`);
  assert.equal(run.actionClaims['0'].status, 'unverified');
  assert.deepEqual(run.steps[0].output, receipt);
  const beforeReplay = await seatServiceSnapshot();
  await assert.rejects(executeAgentWrite.run(action), { code: 'already-exists' });
  assert.deepEqual(await seatServiceSnapshot(), beforeReplay);
});

test('an Agent return with a whitespace-only saved book title confirms its receipt and cannot replenish twice', async () => {
  const blankTitle = ' \t\n ';
  const bookRef = db.doc('schools/pu/libraryBooks/B1');
  await bookRef.update({ title: blankTitle });
  const loan = await borrow.execute(scope(), { bookId: 'B1' });
  const loanRef = db.doc(`schools/pu/libraryLoans/${loan.loanId}`);
  const mirrorRef = db.doc(`users/alice/schools/pu/libraryLoans/${loan.loanId}`);
  const borrowed = (await loanRef.get()).data();
  assert.equal(borrowed.bookTitle, blankTitle);
  assert.equal(borrowed.status, 'borrowed');
  assert.deepEqual((await mirrorRef.get()).data(), borrowed);
  assert.equal((await bookRef.get()).data().availableCopies, 0);
  assert.equal((await bookRef.get()).data().available, 0);

  const input = { loanId: loan.loanId };
  // 還書測例只開歸還權限；其餘維持預設關閉（與 main 請假權限 seed 模式一致）。
  await db.doc('users/alice/settings/assistantPermissions').set({ returnBook: true });
  const action = await proposal(
    { actionProposals: [{ toolName: 'returnBook', input }] },
    { seedLeavePermission: false },
  );
  action.data.toolName = 'returnBook';
  action.data.input = input;
  const receipt = await executeAgentWrite.run(action);
  const runRef = db.doc(`users/alice/agentRuns/${action.data.agentRunId}`);
  const guardRef = db.doc('users/alice/schools/pu/serviceWriteGuards/library');
  const watched = [loanRef, mirrorRef, bookRef, runRef, guardRef];
  const afterReturn = await db.getAll(...watched);
  const [canonical, mirror, book, savedRun] = afterReturn.map((snapshot) => snapshot.data());
  assert.equal(canonical.status, 'returned');
  assert.equal(canonical.bookId, 'B1');
  assert.equal(canonical.bookTitle, blankTitle);
  assert.ok(canonical.returnedAt instanceof Timestamp);
  assert.deepEqual(mirror, canonical);
  assert.equal(book.availableCopies, 1);
  assert.equal(book.available, 1);

  await assert.rejects(executeAgentWrite.run(action), { code: 'already-exists' });
  const afterReplay = await db.getAll(...watched);
  afterReplay.forEach((snapshot, index) => {
    assert.deepEqual(snapshot.data(), afterReturn[index].data());
    assert.equal(snapshot.updateTime.isEqual(afterReturn[index].updateTime), true,
      `replaying the proposal must not rewrite ${snapshot.ref.path}`);
  });

  assert.equal(receipt.success, true, 'the committed return must produce a verified success receipt');
  assert.equal(receipt.toolName, 'returnBook');
  assert.equal(receipt.bookTitle, 'B1');
  assert.equal(savedRun.actionClaims['0'].status, 'completed');
  assert.ok(savedRun.actionClaims['0'].startedAt instanceof Timestamp);
  assert.ok(savedRun.actionClaims['0'].updatedAt instanceof Timestamp);
  assert.equal(savedRun.steps.length, 1);
  assert.deepEqual(savedRun.toolCalls, savedRun.steps);
  assert.equal(savedRun.steps[0].phase, 'executeAgentWrite');
  assert.equal(savedRun.steps[0].tool, 'returnBook');
  assert.deepEqual(savedRun.steps[0].input, input);
  assert.deepEqual(savedRun.steps[0].output, receipt);
});

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

test('closed assistant write permission denies before claim and leaves no claim', async () => {
  const action = await proposal({}, { seedLeavePermission: false });
  await assert.rejects(executeAgentWrite.run(action), (error) => {
    assert.equal(error.code, 'permission-denied');
    assert.match(String(error.message || ''), /送出請假申請/);
    return true;
  });
  const run = await read(`users/alice/agentRuns/${action.data.agentRunId}`);
  assert.equal(run.actionClaims, undefined);
  assert.equal((await db.collection('leaveRequests').get()).size, 0);
});
