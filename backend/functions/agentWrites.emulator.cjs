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
// Only the isolated demo project below may accept the synthetic order fixtures.
process.env.ONLINE_ORDERING_ENABLED = 'true';
// 載入正式 callable，所有資料庫操作均限於上面指定的本機 demo project。
const service = require('./index');
const db = getFirestore();
const borrow = require('./agent/tools/borrowBook');
const returnBook = require('./agent/tools/returnBook');
const renew = require('./agent/tools/renewBook');
const seat = require('./agent/tools/reserveSeat');
const washing = require('./agent/tools/reserveWashingMachine');
const executeAgentWrite = require('./agent/handlers/executeAgentWrite');
const { libraryLoanVersion } = require('./agent/libraryLoanSource');
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

  const input = { loanId: loan.loanId, expectedLoanVersion: libraryLoanVersion(borrowed) };
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

async function libraryProposal(toolName, loanId) {
  const source = await read(`schools/pu/libraryLoans/${loanId}`);
  const input = { loanId, expectedLoanVersion: libraryLoanVersion(source) };
  await db.doc('users/alice/settings/assistantPermissions').set({ [toolName]: true });
  const action = await proposal(
    { actionProposals: [{ toolName, input }] },
    { seedLeavePermission: false },
  );
  action.data.toolName = toolName;
  action.data.input = input;
  return action;
}

async function actorGuardProposal(toolName) {
  if (toolName === 'renewBook') {
    const loan = await borrow.execute(scope(), { bookId: 'B1' });
    return libraryProposal(toolName, loan.loanId);
  }
  const input = seatInput();
  await db.doc('users/alice/settings/assistantPermissions').set({ [toolName]: true });
  const action = await proposal(
    { actionProposals: [{ toolName, input }] },
    { seedLeavePermission: false },
  );
  action.data.toolName = toolName;
  action.data.input = input;
  return action;
}

async function serviceRecordSnapshot() {
  const collections = [
    'schools/pu/libraryLoans', 'users/alice/schools/pu/libraryLoans',
    'schools/pu/libraryBooks',
    'schools/pu/seatReservations', 'users/alice/schools/pu/seatReservations',
    'schools/pu/serviceWriteGuards', 'users/alice/schools/pu/serviceWriteGuards',
  ];
  return collectionRecordSnapshot(collections);
}

async function collectionRecordSnapshot(collections) {
  const snapshots = await Promise.all(collections.map((path) => db.collection(path).get()));
  return snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => ({
    path: doc.ref.path, data: doc.data(), updateTime: doc.updateTime,
  }))).sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Intercept only the local emulator SDK in this test. The proposal claim commits
 * through the actual Firestore transaction before we change the account, and the
 * real callable cannot start its service transaction until the change completes.
 */
async function runAfterCommittedClaim(action, change) {
  const originalRunTransaction = db.runTransaction;
  const runRef = db.doc(`users/alice/agentRuns/${action.data.agentRunId}`);
  let changedAfterClaim = false;
  let failedAccountReads = 0;
  let abortedServiceCommit = false;
  db.runTransaction = async function (callback, ...options) {
    const result = await originalRunTransaction.call(this, async (tx) => {
      const execute = async () => {
        const value = await callback(tx);
        if (changedAfterClaim && change.abortServiceCommit && !abortedServiceCommit) {
          abortedServiceCommit = true;
          throw new HttpsError('unavailable', 'test abort before service transaction commit');
        }
        return value;
      };
      if (!changedAfterClaim || !change.failAccountRead) return execute();
      const originalGet = tx.get;
      const originalGetAll = tx.getAll;
      tx.get = function (reference, ...args) {
        if (reference.path === 'users/alice') {
          failedAccountReads += 1;
          return Promise.reject(new HttpsError('unavailable', 'test account source unavailable'));
        }
        return originalGet.call(this, reference, ...args);
      };
      tx.getAll = function (...references) {
        if (references.some((reference) => reference?.path === 'users/alice')) {
          failedAccountReads += 1;
          return Promise.reject(new HttpsError('unavailable', 'test account source unavailable'));
        }
        return originalGetAll.call(this, ...references);
      };
      try {
        return await execute();
      } finally {
        tx.get = originalGet;
        tx.getAll = originalGetAll;
      }
    }, ...options);
    if (!changedAfterClaim) {
      const claim = (await runRef.get()).data()?.actionClaims?.['0'];
      if (claim?.status === 'started') {
        changedAfterClaim = true;
        await change.apply(db.doc('users/alice'));
      }
    }
    return result;
  };
  try {
    return await executeAgentWrite.run(action);
  } finally {
    db.runTransaction = originalRunTransaction;
    assert.equal(changedAfterClaim, true, 'the source change must occur after a committed claim');
    if (change.failAccountRead) assert.ok(failedAccountReads > 0, 'the service transaction must attempt the account read');
    if (change.abortServiceCommit) assert.equal(abortedServiceCommit, true, 'the staged service transaction must abort');
  }
}

const blockedAccountChanges = [
  ...['disabled', 'suspended', 'inactive', 'deleted'].map((status) => ({
    label: status, apply: (account) => account.update({ status }), code: 'failed-precondition',
  })),
  { label: 'deletion marker', apply: (account) => account.update({ accountDeletionInProgress: true }), code: 'failed-precondition' },
  {
    label: 'account read failure', apply: async () => {}, failAccountRead: true, code: 'unavailable',
  },
];

for (const toolName of ['renewBook', 'reserveSeat']) {
  for (const change of blockedAccountChanges) {
    test(`an Agent ${toolName} stops after a committed claim when the account becomes ${change.label}`, async () => {
      const action = await actorGuardProposal(toolName);
      const before = await serviceRecordSnapshot();

      await assert.rejects(runAfterCommittedClaim(action, change), { code: change.code });

      assert.deepEqual(await serviceRecordSnapshot(), before,
        'loan, mirror, inventory, reservation and service guard documents must remain unchanged');
      const run = await read(`users/alice/agentRuns/${action.data.agentRunId}`);
      assert.equal(run.actionClaims['0'].status, 'unverified');
      assert.ok(run.actionClaims['0'].startedAt instanceof Timestamp);
      assert.equal(run.steps.some((step) => step.output?.success === true), false);
    });
  }

  for (const change of [
    { label: 'active profile', apply: (account) => account.update({ status: 'active' }) },
    { label: 'missing root profile with valid membership', apply: (account) => account.delete() },
  ]) {
    test(`an Agent ${toolName} preserves ${change.label} compatibility after the claim`, async () => {
      const action = await actorGuardProposal(toolName);
      const receipt = await runAfterCommittedClaim(action, change);

      assert.equal(receipt.success, true);
      assert.equal(receipt.toolName, toolName);
      const run = await read(`users/alice/agentRuns/${action.data.agentRunId}`);
      assert.equal(run.actionClaims['0'].status, 'completed');
      assert.equal((await db.doc('users/alice').get()).exists, change.label === 'active profile');
      if (toolName === 'renewBook') {
        const loan = await read(`schools/pu/libraryLoans/${action.data.input.loanId}`);
        assert.equal(loan.renewCount, 1);
        assert.deepEqual(await read(`users/alice/schools/pu/libraryLoans/${action.data.input.loanId}`), loan);
      } else {
        const canonical = await db.collection('schools/pu/seatReservations').get();
        const mirror = await db.collection('users/alice/schools/pu/seatReservations').get();
        assert.equal(canonical.size, 1);
        assert.equal(mirror.size, 1);
        assert.equal(canonical.docs[0].data().seatId, action.data.input.seatId);
        assert.deepEqual(mirror.docs[0].data(), canonical.docs[0].data());
      }
    });
  }
}

const orderSourceCollections = [
  'schools/pu/cafeterias', 'schools/pu/cafeterias/cafe/operators',
  'schools/pu/menus', 'schools/pu/cafeteriaMenus',
  'paymentIntents', 'transactions', 'wallets',
  'users/alice/schools/pu/wallet', 'users/alice/schools/pu/transactions',
];
const orderCollections = [
  'schools/pu/orders', 'users/alice/schools/pu/orders', '_orderRequests',
  'schools/pu/queueCounters', ...orderSourceCollections,
];

async function orderProposal() {
  await seed([
    ['schools/pu/cafeterias/cafe', {
      name: 'Emulator-only cafeteria', merchantId: 'emulator-merchant',
      schoolId: 'pu', currency: 'TWD', orderingEnabled: true, pilotStatus: 'live',
    }],
    ['schools/pu/cafeterias/cafe/operators/emulator-operator', { status: 'active' }],
    ['schools/pu/menus/rice', {
      name: 'Emulator-only meal', cafeteriaId: 'cafe', schoolId: 'pu',
      price: 100, currency: 'TWD', available: true, orderingEnabled: true,
    }],
    ['users/alice/schools/pu/wallet/balance', { available: 1500, pending: 0, currency: 'TWD' }],
    ['wallets/alice', { available: 1500, pending: 0, currency: 'TWD' }],
    ['users/alice/settings/assistantPermissions', { createOrder: true }],
  ]);
  const input = {
    requestId: randomUUID(), cafeteriaId: 'cafe',
    items: [{ menuItemId: 'rice', quantity: 1 }],
    expectedTotal: 105, paymentMethod: 'onsite',
  };
  const action = await proposal(
    { actionProposals: [{ toolName: 'createOrder', input }] },
    { seedLeavePermission: false },
  );
  action.data.toolName = 'createOrder';
  action.data.input = input;
  return action;
}

async function assertFailedOrderClaim(action, receipt, code) {
  assert.equal(receipt.success, false);
  assert.equal(receipt.toolName, 'createOrder');
  assert.equal(receipt.errorCode, code);
  assert.equal(receipt.orderId, undefined);
  assert.equal(receipt.queueNumber, undefined);
  const run = await read(`users/alice/agentRuns/${action.data.agentRunId}`);
  assert.equal(run.actionClaims['0'].status, 'failed');
  assert.ok(run.actionClaims['0'].startedAt instanceof Timestamp);
  assert.equal(run.steps.length, 1);
  assert.deepEqual(run.steps[0].output, receipt);
  assert.equal(run.steps.some((step) => step.output?.success === true), false);
}

for (const change of blockedAccountChanges) {
  test(`an Agent createOrder fails without service writes when the account becomes ${change.label} after its claim`, async () => {
    const action = await orderProposal();
    const before = await collectionRecordSnapshot(orderCollections);

    const receipt = await runAfterCommittedClaim(action, change);

    await assertFailedOrderClaim(action, receipt, change.code);
    assert.deepEqual(await collectionRecordSnapshot(orderCollections), before,
      'orders, mirrors, idempotency keys, queue counters, payment data and menu sources must not change');
  });
}

for (const change of [
  { label: 'active profile', apply: (account) => account.update({ status: 'active' }) },
  { label: 'legacy profile without status', apply: (account) => account.set({ schoolId: 'pu' }) },
  { label: 'missing root profile with valid membership', apply: (account) => account.delete() },
]) {
  test(`an Agent createOrder preserves ${change.label} compatibility after its claim`, async () => {
    const action = await orderProposal();
    const sourcesBefore = await collectionRecordSnapshot(orderSourceCollections);

    const receipt = await runAfterCommittedClaim(action, change);

    assert.equal(receipt.success, true);
    assert.equal(receipt.toolName, 'createOrder');
    assert.equal(receipt.total, 105);
    assert.equal(receipt.queueNumber, 1);
    assert.equal(receipt.queueStatus, 'assigned');
    const canonical = await read(`schools/pu/orders/${receipt.orderId}`);
    assert.equal(canonical.userId, 'alice');
    assert.equal(canonical.requestId, action.data.input.requestId);
    assert.equal(canonical.paymentStatus, 'pending');
    assert.equal(canonical.paymentMethod, 'onsite');
    assert.deepEqual(await read(`users/alice/schools/pu/orders/${receipt.orderId}`), canonical);
    assert.equal((await db.collection('schools/pu/orders').get()).size, 1);
    assert.equal((await db.collection('_orderRequests').get()).size, 1);
    const counters = await db.collection('schools/pu/queueCounters').get();
    assert.equal(counters.size, 1);
    assert.equal(counters.docs[0].data().nextSerial, 1);
    const run = await read(`users/alice/agentRuns/${action.data.agentRunId}`);
    assert.equal(run.actionClaims['0'].status, 'completed');
    assert.deepEqual(run.steps[0].output, receipt);
    assert.deepEqual(await collectionRecordSnapshot(orderSourceCollections), sourcesBefore,
      'placing the synthetic onsite order must not debit wallets, create payment records or alter menus');
  });
}

test('a disabled account cannot replay an existing successful order to repair its mirror or allocate a pending number', async () => {
  const action = await orderProposal();
  const created = await service.createOrder.run(request('alice', action.data.input));
  assert.equal(created.success, true);
  const canonicalRef = db.doc(`schools/pu/orders/${created.orderId}`);
  const mirrorRef = db.doc(`users/alice/schools/pu/orders/${created.orderId}`);
  // Model an already committed order awaiting queue recovery. The original
  // request key and immutable receipt digest stay intact; the mirror is stale.
  await canonicalRef.update({ queueNumber: null, queueStatus: 'pending_confirmation' });
  await mirrorRef.update({ queueNumber: null, queueStatus: 'pending_confirmation', fixtureMarker: 'keep-stale-mirror' });
  const before = await collectionRecordSnapshot(orderCollections);

  const receipt = await runAfterCommittedClaim(action, blockedAccountChanges[0]);

  await assertFailedOrderClaim(action, receipt, 'failed-precondition');
  assert.deepEqual(await collectionRecordSnapshot(orderCollections), before,
    'a rejected replay must not rewrite even an existing mirror or consume a queue number');
});


async function cancelProposal() {
  const action = await orderProposal();
  const created = await service.createOrder.run(request('alice', action.data.input));
  assert.equal(created.success, true);
  const input = { orderId: created.orderId, reason: 'Emulator-only cancellation' };
  await db.doc('users/alice/settings/assistantPermissions').set({ cancelOrder: true });
  await db.doc(`users/alice/agentRuns/${action.data.agentRunId}`).update({
    actionProposals: [{ toolName: 'cancelOrder', input }],
  });
  action.data.toolName = 'cancelOrder';
  action.data.input = input;
  return action;
}

async function assertUnverifiedCancellation(action, before) {
  assert.deepEqual(await collectionRecordSnapshot(orderCollections), before,
    'a rejected cancellation must not change either order copy, counters, payment data or menu sources');
  const run = await read(`users/alice/agentRuns/${action.data.agentRunId}`);
  assert.equal(run.actionClaims['0'].status, 'unverified');
  assert.ok(run.actionClaims['0'].startedAt instanceof Timestamp);
  assert.equal(run.steps.some((step) => step.output?.success === true), false);
}

for (const change of blockedAccountChanges) {
  test(`an Agent cancelOrder stops when the account becomes ${change.label} after claim`, async () => {
    const action = await cancelProposal();
    const before = await collectionRecordSnapshot(orderCollections);

    await assert.rejects(runAfterCommittedClaim(action, change), { code: change.code });

    await assertUnverifiedCancellation(action, before);
  });
}

for (const change of [
  { label: 'active', apply: (account) => account.update({ status: 'active' }) },
  { label: 'legacy', apply: (account) => account.set({ schoolId: 'pu' }) },
  { label: 'missing profile', apply: (account) => account.delete() },
]) {
  test(`an Agent cancelOrder atomically preserves the complete receipt for a ${change.label} account`, async () => {
    const action = await cancelProposal();
    const sourcesBefore = await collectionRecordSnapshot([...orderSourceCollections, 'schools/pu/queueCounters', '_orderRequests']);

    const receipt = await runAfterCommittedClaim(action, change);

    assert.equal(receipt.success, true);
    assert.equal(receipt.orderId, action.data.input.orderId);
    const canonical = await read(`schools/pu/orders/${receipt.orderId}`);
    const mirror = await read(`users/alice/schools/pu/orders/${receipt.orderId}`);
    assert.equal(canonical.status, 'cancelled');
    assert.equal(canonical.cancelReason, action.data.input.reason);
    assert.equal(canonical.queueNumber, null);
    assert.equal(canonical.queueStatus, 'cancelled');
    assert.equal(canonical.cancelledQueueNumber, 1);
    assert.ok(canonical.cancelledAt instanceof Timestamp);
    assert.deepEqual(mirror, canonical);
    assert.deepEqual(await collectionRecordSnapshot([...orderSourceCollections, 'schools/pu/queueCounters', '_orderRequests']), sourcesBefore);
    const run = await read(`users/alice/agentRuns/${action.data.agentRunId}`);
    assert.equal(run.actionClaims['0'].status, 'completed');
    const beforeReplay = await collectionRecordSnapshot(orderCollections);
    await assert.rejects(executeAgentWrite.run(action), { code: 'already-exists' });
    assert.deepEqual(await collectionRecordSnapshot(orderCollections), beforeReplay);
  });
}

test('an already cancelled order keeps its original cancellation time and reason through an Agent confirmation', async () => {
  const action = await cancelProposal();
  await service.cancelOrder.run(request('alice', { orderId: action.data.input.orderId, reason: 'Original reason' }));
  const orderRef = db.doc(`schools/pu/orders/${action.data.input.orderId}`);
  const original = await orderRef.get();

  const receipt = await executeAgentWrite.run(action);

  assert.equal(receipt.success, true);
  const after = await orderRef.get();
  assert.deepEqual(after.data(), original.data());
  assert.equal(after.updateTime.isEqual(original.updateTime), true);
  assert.deepEqual(await read(`users/alice/schools/pu/orders/${action.data.input.orderId}`), original.data());
});

for (const source of [
  { label: 'missing', code: 'not-found', apply: (ref) => ref.delete() },
  { label: 'preparing', code: 'failed-precondition', apply: (ref) => ref.update({ status: 'preparing' }) },
  { label: 'invalid status', code: 'failed-precondition', apply: (ref) => ref.update({ status: 'unrecognized' }) },
]) {
  test(`an Agent cancellation cannot mutate a ${source.label} order after claim`, async () => {
    const action = await cancelProposal();
    let afterSourceChange;
    await assert.rejects(runAfterCommittedClaim(action, {
      apply: async () => {
        await source.apply(db.doc(`schools/pu/orders/${action.data.input.orderId}`));
        afterSourceChange = await collectionRecordSnapshot(orderCollections);
      },
    }), { code: source.code });
    await assertUnverifiedCancellation(action, afterSourceChange);
  });
}

test('an Agent cancellation transaction abort leaves both order copies unchanged', async () => {
  const action = await cancelProposal();
  const before = await collectionRecordSnapshot(orderCollections);

  await assert.rejects(runAfterCommittedClaim(action, {
    apply: async () => {}, abortServiceCommit: true,
  }), { code: 'unavailable' });

  await assertUnverifiedCancellation(action, before);
});

// Fault injection is restricted to the local SDK transport. In ordinary callable
// tests this begins after admission, before the first actual service transaction.
async function withAccountReadFault(tx, uid, run, onFailure) {
  const originalGet = tx.get;
  const originalGetAll = tx.getAll;
  const fails = (reference) => reference?.path === `users/${uid}`;
  const error = () => {
    onFailure();
    return Promise.reject(new HttpsError('unavailable', 'test queue account source unavailable'));
  };
  tx.get = function (reference, ...args) {
    return fails(reference) ? error() : originalGet.call(this, reference, ...args);
  };
  tx.getAll = function (...references) {
    return references.some(fails) ? error() : originalGetAll.call(this, ...references);
  };
  try {
    return await run();
  } finally {
    tx.get = originalGet;
    tx.getAll = originalGetAll;
  }
}

async function runBeforeQueueTransaction(run, uid, change) {
  const originalRunTransaction = db.runTransaction;
  let changed = false;
  let failedReads = 0;
  db.runTransaction = async function (callback, ...options) {
    if (!changed) {
      changed = true;
      await change.apply(db.doc(`users/${uid}`));
    }
    return originalRunTransaction.call(this, (tx) => change.failAccountRead
      ? withAccountReadFault(tx, uid, () => callback(tx), () => { failedReads += 1; })
      : callback(tx), ...options);
  };
  try {
    return await run();
  } finally {
    db.runTransaction = originalRunTransaction;
    assert.equal(changed, true, 'the callable must reach its queue transaction');
    if (change.failAccountRead) assert.ok(failedReads > 0, 'the queue transaction must read its actor account');
  }
}

async function runAfterOrderCommit(action, change) {
  const originalRunTransaction = db.runTransaction;
  let committed;
  let failedReads = 0;
  db.runTransaction = async function (callback, ...options) {
    const result = await originalRunTransaction.call(this, (tx) => committed && change.failAccountRead
      ? withAccountReadFault(tx, 'alice', () => callback(tx), () => { failedReads += 1; })
      : callback(tx), ...options);
    if (!committed) {
      const orders = await db.collection('schools/pu/orders').get();
      assert.equal(orders.size, 1, 'the first transaction must commit the canonical order');
      assert.equal(orders.docs[0].data().queueNumber, null);
      committed = await collectionRecordSnapshot(orderCollections);
      await change.apply(db.doc('users/alice'));
    }
    return result;
  };
  try {
    const receipt = await service.createOrder.run(request('alice', action.data.input));
    return { receipt, committed };
  } finally {
    db.runTransaction = originalRunTransaction;
    assert.ok(committed, 'the account change must occur after the order commit');
    if (change.failAccountRead) assert.ok(failedReads > 0, 'system queue assignment must read the buyer account');
  }
}

for (const change of blockedAccountChanges) {
  test(`a committed order stays pending without queue writes when its buyer becomes ${change.label}`, async () => {
    const action = await orderProposal();

    const { receipt, committed } = await runAfterOrderCommit(action, change);

    assert.equal(receipt.success, true, 'the already committed order must not be reported as nonexistent');
    assert.equal(receipt.orderOutcome, undefined);
    assert.equal(receipt.status, 'pending');
    assert.equal(receipt.queueNumber, null);
    assert.equal(receipt.queueStatus, 'pending_confirmation');
    assert.deepEqual(await collectionRecordSnapshot(orderCollections), committed,
      'failed post-commit numbering must not consume counters or partially update order copies or payments');
  });
}

for (const change of [
  { label: 'active', apply: (account) => account.update({ status: 'active' }) },
  { label: 'legacy', apply: (account) => account.set({ schoolId: 'pu' }) },
  { label: 'missing profile', apply: (account) => account.delete() },
]) {
  test(`post-commit system numbering preserves a ${change.label} buyer`, async () => {
    const action = await orderProposal();
    const sources = await collectionRecordSnapshot(orderSourceCollections);

    const { receipt } = await runAfterOrderCommit(action, change);

    assert.equal(receipt.success, true);
    assert.equal(receipt.queueStatus, 'assigned');
    assert.equal(receipt.queueNumber, 1);
    const canonical = await read(`schools/pu/orders/${receipt.orderId}`);
    assert.equal(canonical.queueAssignedBy, 'system');
    assert.deepEqual(await read(`users/alice/schools/pu/orders/${receipt.orderId}`), canonical);
    assert.deepEqual(await collectionRecordSnapshot(orderSourceCollections), sources);
  });
}

async function manualQueueFixture(role, hasNumber = false) {
  await orderProposal();
  const uid = role === 'merchant' ? 'bob' : 'alice';
  await db.doc('schools/pu/cafeterias/cafe/operators/bob').set({ status: 'active' });
  const orderId = 'manual-queue-fixture';
  const order = {
    orderId, requestId: 'manual-queue-request', userId: 'alice', schoolId: 'pu',
    cafeteriaId: 'cafe', merchantId: 'emulator-merchant', status: 'pending',
    paymentMethod: 'onsite', paymentStatus: 'pending', total: 105,
    items: [{ menuItemId: 'rice', name: 'Test meal', price: 100, quantity: 1 }],
    queueNumber: hasNumber ? 7 : null, queueStatus: 'pending_confirmation',
  };
  await seed([
    [`schools/pu/orders/${orderId}`, order],
    [`users/alice/schools/pu/orders/${orderId}`, { ...order, fixtureMarker: 'stale mirror' }],
  ]);
  return { uid, orderId, run: () => service.assignQueueNumber.run(request(uid, {
    orderId, ...(role === 'merchant' ? { as: 'merchant' } : {}),
  })) };
}

for (const role of ['customer', 'merchant']) {
  for (const change of blockedAccountChanges.filter((row) => ['suspended', 'deletion marker', 'account read failure'].includes(row.label))) {
    test(`manual ${role} numbering stops when its actor becomes ${change.label} after admission`, async () => {
      const fixture = await manualQueueFixture(role);
      const before = await collectionRecordSnapshot(orderCollections);

      await assert.rejects(runBeforeQueueTransaction(fixture.run, fixture.uid, change), { code: change.code });

      assert.deepEqual(await collectionRecordSnapshot(orderCollections), before);
    });
  }
  test(`a disabled ${role} cannot use an existing number to rewrite a stale receipt`, async () => {
    const fixture = await manualQueueFixture(role, true);
    const before = await collectionRecordSnapshot(orderCollections);

    await assert.rejects(runBeforeQueueTransaction(fixture.run, fixture.uid, blockedAccountChanges[0]), { code: 'failed-precondition' });

    assert.deepEqual(await collectionRecordSnapshot(orderCollections), before);
  });
  test(`a ${role} cannot revive a cancelled order with a leftover queue number`, async () => {
    const fixture = await manualQueueFixture(role, true);
    const cancelled = { status: 'cancelled', queueStatus: role === 'customer' ? 'cancelled' : 'assigned' };
    await db.doc(`schools/pu/orders/${fixture.orderId}`).update(cancelled);
    await db.doc(`users/alice/schools/pu/orders/${fixture.orderId}`).update(cancelled);
    await db.doc('schools/pu/queueCounters/cancelled-order-fixture').set({ nextSerial: 7 });
    const before = await collectionRecordSnapshot(orderCollections);

    await assert.rejects(fixture.run(), { code: 'failed-precondition' });

    assert.deepEqual(await collectionRecordSnapshot(orderCollections), before,
      'a cancelled order must retain both receipts and all counter data without rewriting updateTime');
  });
  test(`manual ${role} numbering preserves legacy actor profiles`, async () => {
    const fixture = await manualQueueFixture(role);
    const sources = await collectionRecordSnapshot(orderSourceCollections);

    const result = await runBeforeQueueTransaction(fixture.run, fixture.uid, {
      apply: (account) => account.set({ schoolId: 'pu' }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.queueNumber, 1);
    const canonical = await read(`schools/pu/orders/${fixture.orderId}`);
    assert.equal(canonical.queueAssignedBy, role);
    assert.equal(canonical.status, role === 'merchant' ? 'confirmed' : 'pending');
    assert.deepEqual(await read(`users/alice/schools/pu/orders/${fixture.orderId}`), canonical);
    assert.deepEqual(await collectionRecordSnapshot(orderSourceCollections), sources);
  });
}

for (const toolName of ['renewBook', 'returnBook']) {
  test(`an Agent ${toolName} rejects a changed canonical book after preview without rewriting service data`, async () => {
    const loan = await borrow.execute(scope(), { bookId: 'B1' });
    const action = await libraryProposal(toolName, loan.loanId);
    const loanRef = db.doc(`schools/pu/libraryLoans/${loan.loanId}`);
    await loanRef.update({ bookId: 'B2', bookTitle: 'Changed book after preview' });
    const watched = [
      loanRef,
      db.doc(`users/alice/schools/pu/libraryLoans/${loan.loanId}`),
      db.doc('schools/pu/libraryBooks/B1'),
      db.doc('schools/pu/libraryBooks/B2'),
      db.doc('users/alice/schools/pu/serviceWriteGuards/library'),
    ];
    const before = await db.getAll(...watched);

    await assert.rejects(executeAgentWrite.run(action), { code: 'failed-precondition' });

    const after = await db.getAll(...watched);
    after.forEach((snapshot, index) => {
      assert.deepEqual(snapshot.data(), before[index].data());
      assert.equal(snapshot.updateTime.isEqual(before[index].updateTime), true,
        `a stale confirmation must not rewrite ${snapshot.ref.path}`);
    });
    const run = await read(`users/alice/agentRuns/${action.data.agentRunId}`);
    assert.equal(run.actionClaims['0'].status, 'unverified');
    assert.equal(run.steps.some((step) => step.output?.success === true), false);
  });
}

test('a normal renewal makes an older Agent renewal confirmation stale', async () => {
  const loan = await borrow.execute(scope(), { bookId: 'B1' });
  const action = await libraryProposal('renewBook', loan.loanId);
  await service.renewBook.run(request('alice', { loanId: loan.loanId }));
  const watched = [
    db.doc(`schools/pu/libraryLoans/${loan.loanId}`),
    db.doc(`users/alice/schools/pu/libraryLoans/${loan.loanId}`),
    db.doc('schools/pu/libraryBooks/B1'),
  ];
  const before = await db.getAll(...watched);
  assert.equal(before[0].data().renewCount, 1);

  await assert.rejects(executeAgentWrite.run(action), { code: 'failed-precondition' });

  const after = await db.getAll(...watched);
  after.forEach((snapshot, index) => {
    assert.deepEqual(snapshot.data(), before[index].data());
    assert.equal(snapshot.updateTime.isEqual(before[index].updateTime), true);
  });
  assert.equal(after[0].data().renewCount, 1);
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
