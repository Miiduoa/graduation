/* global process, fetch, __dirname */
const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { createGroupMembershipHandlers } = require('./groupMembership');
const { createAccountGuardedOnCall } = require('./accountLifecycle');

const emulator = /^(?:127\.0\.0\.1|localhost):([0-9]{1,5})$/.exec(
  process.env.FIRESTORE_EMULATOR_HOST || '',
);
if (!emulator || Number(emulator[1]) < 1 || Number(emulator[1]) > 65535) {
  throw new Error('Run only with an explicit local FIRESTORE_EMULATOR_HOST');
}
const host = `127.0.0.1:${emulator[1]}`;
process.env.FIRESTORE_EMULATOR_HOST = host;
const projectId = 'demo-campus-group-ownership';
const app = initializeApp({ projectId }, 'group-ownership-concurrency-tests');
const db = getFirestore(app);
const groupId = 'ownership-club';
const groupPath = `groups/${groupId}`;
const participants = ['alice', 'bob', 'carol'];
const joinedAt = Timestamp.fromMillis(1700000000000);
const originalGroup = {
  schoolId: 'pu',
  name: 'Ownership integration club',
  type: 'club',
  joinCode: 'OWNERSHIP',
  memberCount: 3,
  // Historical creator is deliberately different from the current owner.
  createdBy: 'original-founder',
  verification: { status: 'unverified' },
};
let rules;

const read = async (documentPath) => (await db.doc(documentPath).get()).data();
const receipts = () => db.collection(`${groupPath}/ownershipTransfers`).get();
const auditEvents = () =>
  db.collection('schools/pu/adminLogs').where('action', '==', 'transfer_group_ownership').get();
const request = (actor = 'alice', target = 'bob', operationId = 'transfer-1') => ({
  auth: { uid: actor },
  data: { groupId, targetUid: target, operationId, expectedCurrentOwnerUid: actor },
});
// Each call gets a new handler instance: no process-local deduplication can mask races.
const transfer = (actor = 'alice', target = 'bob', operationId = 'transfer-1') =>
  createGroupMembershipHandlers({ db }).transferGroupOwnership(request(actor, target, operationId));

async function assertOwnership(ownerUid) {
  const members = await db.collection(`${groupPath}/members`).get();
  const owners = members.docs.filter(
    (entry) => entry.data().status === 'active' && entry.data().role === 'owner',
  );
  assert.deepEqual(
    owners.map((entry) => entry.id),
    [ownerUid],
  );
  for (const uid of participants) {
    const member = await read(`${groupPath}/members/${uid}`);
    const mirror = await read(`users/${uid}/groups/${groupId}`);
    assert.equal(member.role, uid === ownerUid ? 'owner' : 'member', `${uid} canonical role`);
    assert.equal(member.status, 'active', `${uid} canonical status`);
    assert.equal(mirror.role, member.role, `${uid} mirror role`);
    assert.equal(mirror.status, member.status, `${uid} mirror status`);
    assert.equal(mirror.groupId, groupId);
    assert.equal(mirror.schoolId, 'pu');
    assert.ok(member.joinedAt.isEqual(joinedAt));
    assert.ok(mirror.joinedAt.isEqual(joinedAt));
  }
  assert.deepEqual(await read(groupPath), originalGroup);
}

before(async () => {
  rules = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: Number(emulator[1]),
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore/firestore.rules'), 'utf8'),
    },
  });
});

beforeEach(async () => {
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  assert.equal(response.ok, true);
  const batch = db.batch();
  batch.set(db.doc(groupPath), originalGroup);
  for (const uid of participants) {
    const role = uid === 'alice' ? 'owner' : 'member';
    batch.set(db.doc(`users/${uid}`), { role: 'student', schoolId: 'pu' });
    batch.set(db.doc(`schools/pu/members/${uid}`), { role: 'student', status: 'active' });
    batch.set(db.doc(`${groupPath}/members/${uid}`), { uid, role, status: 'active', joinedAt });
    batch.set(db.doc(`users/${uid}/groups/${groupId}`), {
      groupId,
      schoolId: 'pu',
      name: originalGroup.name,
      type: originalGroup.type,
      joinCode: originalGroup.joinCode,
      role,
      status: 'active',
      joinedAt,
    });
  }
  await batch.commit();
});

after(async () => {
  if (rules) await rules.cleanup();
  await db.terminate();
  await deleteApp(app);
});

test('simultaneous transfers to two eligible recipients commit exactly one owner and consistent mirrors', async () => {
  const outcomes = await Promise.allSettled([
    transfer('alice', 'bob', 'competing-bob'),
    transfer('alice', 'carol', 'competing-carol'),
  ]);
  const succeeded = outcomes.filter((result) => result.status === 'fulfilled');
  const rejected = outcomes.filter((result) => result.status === 'rejected');
  assert.equal(succeeded.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'failed-precondition');
  const winner = succeeded[0].value;
  assert.equal(winner.reused, false);
  await assertOwnership(winner.toUid);
  const completed = await receipts();
  assert.equal(completed.size, 1);
  assert.equal(completed.docs[0].id, winner.operationId);
  assert.equal(completed.docs[0].data().fromUid, 'alice');
  assert.equal(completed.docs[0].data().toUid, winner.toUid);
  assert.equal((await auditEvents()).size, 1);
  await assert.rejects(transfer('alice', 'carol', 'former-owner-cannot-retry'), {
    code: 'failed-precondition',
  });
});

test('parallel retries of one operation create one immutable receipt and one atomic success audit event', async () => {
  const outcomes = await Promise.all(Array.from({ length: 4 }, () => transfer()));
  assert.equal(outcomes.filter((result) => result.reused === false).length, 1);
  assert.equal(outcomes.filter((result) => result.reused === true).length, 3);
  await assertOwnership('bob');
  const completed = await receipts();
  assert.equal(completed.size, 1);
  const receipt = completed.docs[0].data();
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.fromUid, 'alice');
  assert.equal(receipt.toUid, 'bob');
  assert.ok(receipt.completedAt instanceof Timestamp);
  const logs = await auditEvents();
  assert.equal(logs.size, 1, 'replays must not add more ownership-transfer success events');
  const event = logs.docs[0].data();
  assert.equal(event.actorUid, 'alice');
  assert.ok(event.createdAt instanceof Timestamp);
  assert.ok(
    event.createdAt.isEqual(receipt.completedAt),
    'audit event and receipt must share the transaction commit timestamp',
  );
  await transfer();
  assert.deepEqual((await receipts()).docs[0].data(), receipt);
  const replayLogs = await auditEvents();
  assert.equal(replayLogs.size, 1);
  assert.equal(replayLogs.docs[0].id, logs.docs[0].id);
  assert.deepEqual(replayLogs.docs[0].data(), event);
});

test('the former owner loses privileged client writes and the historical creator stays immutable', async () => {
  await transfer();
  const former = rules.authenticatedContext('alice').firestore();
  const current = rules.authenticatedContext('bob').firestore();
  await assertSucceeds(former.doc(groupPath).get());
  await assertFails(former.doc(groupPath).update({ name: 'Former owner changed this' }));
  await assertSucceeds(current.doc(groupPath).update({ name: 'Current owner changed this' }));
  await assertFails(current.doc(groupPath).update({ createdBy: 'bob' }));
  await assertFails(former.doc(`${groupPath}/members/alice`).update({ role: 'owner' }));
  await assertFails(current.doc(`${groupPath}/members/carol`).update({ role: 'owner' }));
  await assertFails(former.doc(`${groupPath}/ownershipTransfers/transfer-1`).get());
  await assertFails(current.doc(`${groupPath}/ownershipTransfers/transfer-1`).get());
  assert.equal((await read(groupPath)).createdBy, 'original-founder');
});

test('an eligible former owner can recover the original receipt after leaving and a later transfer', async () => {
  const original = await transfer();
  const receipt = (await receipts()).docs[0].data();
  await createGroupMembershipHandlers({ db }).leaveGroup({
    auth: { uid: 'alice' },
    data: { groupId },
  });
  await transfer('bob', 'carol', 'transfer-2');
  const replay = await transfer();
  assert.deepEqual({ ...replay, reused: false }, original);
  assert.equal((await read(`${groupPath}/members/alice`)).status, 'left');
  assert.equal((await read(`users/alice/groups/${groupId}`)).status, 'left');
  assert.equal((await read(`${groupPath}/members/carol`)).role, 'owner');
  assert.deepEqual(await read(`${groupPath}/ownershipTransfers/transfer-1`), receipt);
  assert.equal((await receipts()).size, 2);
  assert.equal((await auditEvents()).size, 2);
  assert.equal((await read(groupPath)).createdBy, 'original-founder');
});

for (const scenario of [
  {
    name: 'actor school seat revoked',
    document: 'schools/pu/members/alice',
    patch: { status: 'inactive' },
    code: 'permission-denied',
  },
  {
    name: 'target school seat revoked',
    document: 'schools/pu/members/bob',
    patch: { status: 'inactive' },
    code: 'permission-denied',
  },
  {
    name: 'target group membership revoked',
    document: `${groupPath}/members/bob`,
    patch: { status: 'removed' },
    code: 'failed-precondition',
  },
]) {
  test(`${scenario.name} rejects transfer without receipt, audit, or partial owner changes`, async () => {
    await db.doc(scenario.document).update(scenario.patch);
    const actor = await read(`${groupPath}/members/alice`);
    const target = await read(`${groupPath}/members/bob`);
    const actorMirror = await read(`users/alice/groups/${groupId}`);
    const targetMirror = await read(`users/bob/groups/${groupId}`);
    await assert.rejects(transfer(), { code: scenario.code });
    assert.deepEqual(await read(`${groupPath}/members/alice`), actor);
    assert.deepEqual(await read(`${groupPath}/members/bob`), target);
    assert.deepEqual(await read(`users/alice/groups/${groupId}`), actorMirror);
    assert.deepEqual(await read(`users/bob/groups/${groupId}`), targetMirror);
    assert.equal((await receipts()).size, 0);
    assert.equal((await auditEvents()).size, 0);
  });
}

for (const scenario of [
  {
    name: 'revoked school seat',
    document: 'schools/pu/members/alice',
    patch: { status: 'inactive' },
    code: 'permission-denied',
  },
  {
    name: 'closing account',
    document: 'users/alice',
    patch: { accountDeletionInProgress: true },
    code: 'failed-precondition',
  },
]) {
  test(`receipt replay rejects an actor with ${scenario.name} without adding audit events`, async () => {
    await transfer();
    const receipt = (await receipts()).docs[0].data();
    await db.doc(scenario.document).update(scenario.patch);
    await assert.rejects(transfer(), { code: scenario.code });
    assert.deepEqual((await receipts()).docs[0].data(), receipt);
    assert.equal((await auditEvents()).size, 1);
    await assertOwnership('bob');
  });
}

test('inactive historical owners do not hide the sole active owner before a query limit', async () => {
  const batch = db.batch();
  for (let index = 0; index < 9; index += 1) {
    const uid = `a00-historical-${index}`;
    batch.set(db.doc(`${groupPath}/members/${uid}`), { uid, role: 'owner', status: 'left' });
  }
  await batch.commit();
  await transfer();
  await assertOwnership('bob');
  assert.equal((await receipts()).size, 1);
  assert.equal((await auditEvents()).size, 1);
});

test('two groups in one school can reuse an operation ID without sharing or replacing audit events', async () => {
  const otherGroupId = 'ownership-club-two';
  const otherGroupPath = `groups/${otherGroupId}`;
  const secondGroup = {
    ...originalGroup,
    name: 'Second ownership club',
    joinCode: 'OWNERSHIP-TWO',
    createdBy: 'second-founder',
  };
  const batch = db.batch();
  batch.set(db.doc(otherGroupPath), secondGroup);
  for (const uid of participants) {
    const role = uid === 'alice' ? 'owner' : 'member';
    batch.set(db.doc(`${otherGroupPath}/members/${uid}`), {
      uid,
      role,
      status: 'active',
      joinedAt,
    });
    batch.set(db.doc(`users/${uid}/groups/${otherGroupId}`), {
      groupId: otherGroupId,
      schoolId: 'pu',
      name: secondGroup.name,
      type: secondGroup.type,
      joinCode: secondGroup.joinCode,
      role,
      status: 'active',
      joinedAt,
    });
  }
  await batch.commit();
  const firstRequest = request('alice', 'bob', 'shared-operation');
  const secondRequest = {
    ...request('alice', 'carol', 'shared-operation'),
    data: { ...request('alice', 'carol', 'shared-operation').data, groupId: otherGroupId },
  };
  const invoke = (input) => createGroupMembershipHandlers({ db }).transferGroupOwnership(input);
  const results = await Promise.all([invoke(firstRequest), invoke(secondRequest)]);
  assert.ok(results.every((result) => result.success && result.reused === false));
  await assertOwnership('bob');
  assert.deepEqual(await read(otherGroupPath), secondGroup);
  for (const uid of participants) {
    const member = await read(`${otherGroupPath}/members/${uid}`);
    const mirror = await read(`users/${uid}/groups/${otherGroupId}`);
    assert.equal(member.role, uid === 'carol' ? 'owner' : 'member');
    assert.equal(member.status, 'active');
    assert.equal(mirror.role, member.role);
    assert.equal(mirror.status, member.status);
  }
  const receiptPaths = [groupPath, otherGroupPath].map(
    (prefix) => `${prefix}/ownershipTransfers/shared-operation`,
  );
  const completed = await Promise.all(receiptPaths.map(read));
  assert.ok(completed.every((receipt) => receipt.status === 'completed'));
  assert.ok(completed.every((receipt) => typeof receipt.auditLogId === 'string'));
  assert.notEqual(completed[0].auditLogId, completed[1].auditLogId);
  assert.equal((await auditEvents()).size, 2);
  const auditPaths = completed.map((receipt) => `schools/pu/adminLogs/${receipt.auditLogId}`);
  const events = await Promise.all(auditPaths.map(read));
  for (let index = 0; index < events.length; index += 1) {
    assert.equal(events[index].action, 'transfer_group_ownership');
    assert.equal(events[index].actorUid, 'alice');
    assert.ok(events[index].createdAt.isEqual(completed[index].completedAt));
    assert.ok(events[index].details.includes(`group=${index === 0 ? groupId : otherGroupId};`));
  }
  const replay = await Promise.all([invoke(firstRequest), invoke(secondRequest)]);
  assert.ok(replay.every((result) => result.reused === true));
  assert.equal((await auditEvents()).size, 2);
  assert.deepEqual(await Promise.all(receiptPaths.map(read)), completed);
  assert.deepEqual(await Promise.all(auditPaths.map(read)), events);
});

test('an existing audit event without its receipt prevents the entire transfer from committing', async () => {
  const protectedPaths = [
    groupPath,
    ...participants.flatMap((uid) => [
      `${groupPath}/members/${uid}`,
      `users/${uid}/groups/${groupId}`,
    ]),
  ];
  const originalDocuments = await Promise.all(protectedPaths.map(read));
  await transfer();
  const receipt = await read(`${groupPath}/ownershipTransfers/transfer-1`);
  assert.equal(typeof receipt.auditLogId, 'string');
  const auditPath = `schools/pu/adminLogs/${receipt.auditLogId}`;
  const immutableEvent = await read(auditPath);

  // Construct an orphaned existing event using the handler's own computed ID.
  // Keep that immutable event while restoring all pre-transfer state and removing the receipt.
  const batch = db.batch();
  protectedPaths.forEach((documentPath, index) => {
    batch.set(db.doc(documentPath), originalDocuments[index]);
  });
  batch.delete(db.doc(`${groupPath}/ownershipTransfers/transfer-1`));
  await batch.commit();
  await assert.rejects(transfer());
  assert.deepEqual(await Promise.all(protectedPaths.map(read)), originalDocuments);
  assert.equal((await receipts()).size, 0);
  assert.equal((await auditEvents()).size, 1);
  assert.deepEqual(await read(auditPath), immutableEvent);
});


// Capture every ownership document, not just the proposed recipient's role. Account
// fixtures change deliberately, but failed transfers must not alter this state.
async function ownershipState() {
  const snapshotState = (snapshot) => ({
    exists: snapshot.exists,
    data: snapshot.exists ? snapshot.data() : null,
    updateTime: snapshot.updateTime || null,
  });
  const [group, members, mirrors, operations, logs] = await Promise.all([
    db.doc(groupPath).get(),
    db.collection(`${groupPath}/members`).get(),
    Promise.all(participants.map(async (uid) => ({
      uid,
      ...snapshotState(await db.doc(`users/${uid}/groups/${groupId}`).get()),
    }))),
    receipts(),
    auditEvents(),
  ]);
  const documents = (snapshot) => snapshot.docs
    .map((entry) => ({ id: entry.id, ...snapshotState(entry) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    group: snapshotState(group),
    members: documents(members),
    mirrors,
    receipts: documents(operations),
    audits: documents(logs),
  };
}

function accountGuardedTransfer(afterAdmission = async () => {}) {
  const onCall = createAccountGuardedOnCall({
    onCall: (_options, handler) => handler,
    getDb: () => db,
  });
  return onCall({}, async (input) => {
    await afterAdmission(input);
    return createGroupMembershipHandlers({ db }).transferGroupOwnership(input);
  });
}

for (const [label, patch] of [
  ['deleted', { status: 'deleted' }],
  ['disabled', { status: 'disabled' }],
  ['suspended', { status: 'suspended' }],
  ['inactive', { status: 'inactive' }],
  ['deletion marker', { accountDeletionInProgress: true }],
]) {
  test(`an account with ${label} cannot receive ownership despite active school and group memberships`, async () => {
    await db.doc('users/bob').update(patch);
    const before = await ownershipState();
    await assert.rejects(accountGuardedTransfer()(request()), { code: 'failed-precondition' });
    assert.deepEqual(await ownershipState(), before);
    await assertOwnership('alice');
  });
}

test('an actor marked for deletion after the real callable admission cannot commit ownership changes', async () => {
  await db.doc('users/alice').update({ status: 'active' });
  const before = await ownershipState();
  let admissions = 0;
  const invoke = accountGuardedTransfer(async () => {
    admissions++;
    assert.equal((await read('users/alice')).status, 'active');
    await db.doc('users/alice').update({ accountDeletionInProgress: true });
  });
  await assert.rejects(invoke(request()), { code: 'failed-precondition' });
  assert.equal(admissions, 1, 'the original active account must pass the real admission guard');
  assert.equal((await read('users/alice')).accountDeletionInProgress, true);
  assert.deepEqual(await ownershipState(), before);
  await assertOwnership('alice');
});

for (const uid of ['alice', 'bob']) {
  test(`a missing ${uid === 'alice' ? 'actor' : 'target'} profile rejects the transfer without changing ownership`, async () => {
    await db.doc(`users/${uid}`).delete();
    const before = await ownershipState();
    await assert.rejects(accountGuardedTransfer()(request()), { code: 'failed-precondition' });
    assert.equal((await db.doc(`users/${uid}`).get()).exists, false);
    assert.deepEqual(await ownershipState(), before);
    await assertOwnership('alice');
  });

  test(`an existing empty ${uid === 'alice' ? 'actor' : 'target'} profile preserves legacy transfer and receipt compatibility`, async () => {
    await db.doc(`users/${uid}`).set({});
    const invoke = accountGuardedTransfer();
    const result = await invoke(request());
    assert.equal(result.success, true);
    assert.equal(result.reused, false);
    assert.deepEqual(await read(`users/${uid}`), {});
    await assertOwnership('bob');
    const committed = await ownershipState();
    const replay = await invoke(request());
    assert.deepEqual({ ...replay, reused: false }, result);
    assert.deepEqual(await ownershipState(), committed);
  });
}

for (const status of ['disabled', 'suspended', 'inactive']) {
  test(`the existing admission guard still rejects an actor with status ${status}`, async () => {
    await db.doc('users/alice').update({ status });
    const before = await ownershipState();
    let admissions = 0;
    await assert.rejects(accountGuardedTransfer(async () => { admissions++; })(request()), {
      code: 'failed-precondition',
    });
    assert.equal(admissions, 0);
    assert.deepEqual(await ownershipState(), before);
  });

  for (const uid of ['alice', 'bob']) {
    test(`the transaction rechecks ${uid} becoming ${status} after admission and preserves receipt recovery rules`, async () => {
      const invoke = accountGuardedTransfer(async () => {
        await db.doc(`users/${uid}`).update({ status });
      });
      const before = await ownershipState();
      await assert.rejects(invoke(request()), { code: 'failed-precondition' });
      assert.deepEqual(await ownershipState(), before);
      await assertOwnership('alice');

      await db.doc(`users/${uid}`).update({ status: 'active' });
      await transfer();
      const committed = await ownershipState();
      if (uid === 'alice') {
        await assert.rejects(invoke(request()), { code: 'failed-precondition' });
      } else {
        const replay = await invoke(request());
        assert.equal(replay.reused, true);
      }
      assert.deepEqual(await ownershipState(), committed);
    });
  }
}

for (const profile of [{ role: 'student' }, { role: 'teacher' }, { role: 'student', schoolId: 'other-school' }]) {
  test(`active school seats allow legacy profiles ${JSON.stringify(profile)} without changing their data`, async () => {
    for (const uid of ['alice', 'bob']) await db.doc(`users/${uid}`).set(profile);
    const result = await accountGuardedTransfer()(request());
    assert.equal(result.success, true);
    await assertOwnership('bob');
    for (const uid of ['alice', 'bob']) assert.deepEqual(await read(`users/${uid}`), profile);
  });
}

test('receipt recovery rejects an original actor whose profile disappears without changing the receipt', async () => {
  await transfer();
  await db.doc('users/alice').delete();
  const committed = await ownershipState();
  await assert.rejects(accountGuardedTransfer()(request()), { code: 'failed-precondition' });
  assert.equal((await db.doc('users/alice').get()).exists, false);
  assert.deepEqual(await ownershipState(), committed);
});

for (const targetState of ['disabled', 'suspended', 'inactive', 'deleted', 'missing']) {
  test(`an eligible actor recovers the immutable receipt after the target becomes ${targetState}`, async () => {
    const original = await transfer();
    if (targetState === 'missing') await db.doc('users/bob').delete();
    else await db.doc('users/bob').update({ status: targetState });
    const committed = await ownershipState();
    const replay = await accountGuardedTransfer()(request());
    assert.equal(replay.reused, true);
    assert.deepEqual({ ...replay, reused: false }, original);
    assert.deepEqual(await ownershipState(), committed);
    await assertOwnership('bob');
  });
}

test('receipt recovery rechecks an actor marked for deletion after admission without changing the original success', async () => {
  await transfer();
  await db.doc('users/alice').update({ status: 'active' });
  const committed = await ownershipState();
  let admissions = 0;
  const invoke = accountGuardedTransfer(async () => {
    admissions++;
    await db.doc('users/alice').update({ accountDeletionInProgress: true });
  });
  await assert.rejects(invoke(request()), { code: 'failed-precondition' });
  assert.equal(admissions, 1);
  assert.deepEqual(await ownershipState(), committed);
  await assertOwnership('bob');
});

for (const uid of ['alice', 'bob']) {
  for (const [label, patch] of [
    ['deleted', { status: 'deleted' }],
    ['deletion marker', { accountDeletionInProgress: true }],
    ['disabled', { status: 'disabled' }],
    ['suspended', { status: 'suspended' }],
    ['inactive', { status: 'inactive' }],
    ['missing profile', null],
  ]) {
    test(`an injected ABORTED triggers a real Firestore SDK retry that rechecks the ${uid === 'alice' ? 'actor' : 'target'} ${label} before committing`, async () => {
      const before = await ownershipState();
      let attempts = 0;
      let stagedAttempt = false;
      const database = {
        collection: db.collection.bind(db),
        runTransaction: (callback) => db.runTransaction(async (transaction) => {
          attempts++;
          // This write happens before the second attempt reads any documents,
          // after Firestore has abandoned the first staged transaction.
          if (attempts === 2) {
            if (patch === null) await db.doc(`users/${uid}`).delete();
            else await db.doc(`users/${uid}`).update(patch);
          }
          const result = await callback(transaction);
          if (attempts === 1) {
            stagedAttempt = true;
            assert.equal(result.success, true);
            assert.equal(result.reused, false);
            // Use the actual SDK retry path and actual Transaction object.
            // Code 10 is Firestore ABORTED, matching the existing emulator tests.
            throw Object.assign(new Error('force ownership transaction retry'), { code: 10 });
          }
          return result;
        }),
      };
      const result = createGroupMembershipHandlers({ db: database }).transferGroupOwnership(request());
      await assert.rejects(result, { code: 'failed-precondition' });
      assert.equal(stagedAttempt, true, 'first attempt must stage the normal transfer');
      assert.equal(attempts, 2, 'Firestore itself must retry the original transaction callback');
      if (patch === null) assert.equal((await db.doc(`users/${uid}`).get()).exists, false);
      for (const [key, value] of Object.entries(patch || {})) {
        assert.equal((await read(`users/${uid}`))[key], value);
      }
      assert.deepEqual(await ownershipState(), before);
      await assertOwnership('alice');
    });
  }
}
