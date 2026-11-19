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
  throw new Error('Repair regressions require an explicit local FIRESTORE_EMULATOR_HOST');
}
const host = `127.0.0.1:${local[1]}`;
const projectId = 'demo-campus-agent-repair-transactions';
process.env.FIRESTORE_EMULATOR_HOST = host;
process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
delete process.env.DEBUG_FORCE_SUBMIT_REPAIR_ERROR;
// Initialize the real callables only after pinning all database access to this
// local demo project. These records are personal reminders, not school tickets.
require('./index');
const db = getFirestore();
const executeAgentWrite = require('./agent/handlers/executeAgentWrite');
const repair = require('./agent/tools/createDormRepairRequest');

const actorPath = 'users/alice';
const memberPath = 'schools/pu/members/alice';
const permissionPath = 'users/alice/settings/assistantPermissions';
const sourcePaths = [actorPath, memberPath, permissionPath];
const input = {
  dormitory: 'A棟', room: '302', category: 'hvac',
  description: '合成測試：冷氣不冷', urgency: 'normal',
};

async function seed(entries) {
  const batch = db.batch();
  for (const [path, value] of entries) batch.set(db.doc(path), value);
  await batch.commit();
}
async function activeActor() {
  await seed([
    [actorPath, { schoolId: 'pu', status: 'active' }],
    [memberPath, { role: 'student', status: 'active' }],
    [permissionPath, { createDormRepairRequest: true }],
  ]);
}
beforeEach(async () => {
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(response.ok, true);
  await activeActor();
  await seed([
    ['users/bob', { schoolId: 'pu', status: 'active' }],
    ['schools/pu/members/bob', { role: 'student', status: 'active' }],
    ['users/bob/settings/assistantPermissions', { createDormRepairRequest: true }],
    ['schools/ntu/members/alice', { role: 'student', status: 'active' }],
  ]);
});
after(async () => {
  await db.terminate();
  await deleteApp(getApp());
});

async function proposal() {
  const id = randomUUID();
  await db.doc(`users/alice/agentRuns/${id}`).set({
    runId: id, userId: 'alice', schoolId: 'pu', status: 'completed',
    createdAt: Timestamp.now(), steps: [],
    actionProposals: [{ toolName: 'createDormRepairRequest', input }],
  });
  return { auth: { uid: 'alice' }, data: {
    toolName: 'createDormRepairRequest', agentRunId: id,
    context: { schoolId: 'pu' }, input: { ...input },
  } };
}
const runRef = action => db.doc(`users/alice/agentRuns/${action.data.agentRunId}`);
async function repairRows() {
  const snapshot = await db.collectionGroup('repairRequests').get();
  return snapshot.docs.map(doc => ({ path: doc.ref.path, data: doc.data(), updateTime: doc.updateTime }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

// The real SDK commits the claim before this boundary changes any source. For
// retry cases, numeric gRPC ABORTED is synthetic contention: Firestore's actual
// transaction runner, not a mock retry loop, must repeat the service callback.
async function atClaimBoundary(action, change = async () => {}, options = {}) {
  const original = db.runTransaction;
  const stats = { claimCommitted: false, serviceIntercepted: false, attempts: [] };
  let firstService = false;
  let outcome;
  db.runTransaction = async function(callback, ...transactionOptions) {
    const service = stats.claimCommitted && !firstService;
    if (service) { firstService = true; stats.serviceIntercepted = true; }
    let attemptNumber = 0;
    const result = await original.call(this, async tx => {
      if (!service) return callback(tx);
      attemptNumber += 1;
      if (attemptNumber === 2 && options.beforeRetry) await options.beforeRetry();
      const observed = { reads: [], repairs: [] };
      const originalGet = tx.get, originalGetAll = tx.getAll, originalCreate = tx.create;
      const read = reference => {
        if (!reference?.path) return false;
        observed.reads.push(reference.path);
        return reference.path === options.failRead;
      };
      tx.get = function(reference, ...args) {
        // Match the SDK's asynchronous rejection contract so all reads already
        // started by Promise.all retain their rejection handlers.
        if (read(reference)) return Promise.reject(new HttpsError('unavailable', 'synthetic repair authorization source unavailable'));
        return originalGet.call(this, reference, ...args);
      };
      tx.getAll = function(...references) {
        let failed = false;
        for (const reference of references) failed = read(reference) || failed;
        if (failed) return Promise.reject(new HttpsError('unavailable', 'synthetic repair authorization source unavailable'));
        return originalGetAll.call(this, ...references);
      };
      tx.create = function(reference, value) {
        if (reference.path.startsWith('schools/pu/repairRequests/')) observed.repairs.push(reference.path);
        return originalCreate.call(this, reference, value);
      };
      try {
        const value = await callback(tx);
        if (observed.repairs.length && options.abortCommit) {
          throw new HttpsError('unavailable', 'synthetic abort after repair writes were staged');
        }
        if (observed.repairs.length && options.retryOnce && attemptNumber === 1) {
          throw Object.assign(new Error('synthetic repair transaction contention'), { code: 10 });
        }
        return value;
      } finally {
        stats.attempts.push(observed);
        tx.get = originalGet;
        tx.getAll = originalGetAll;
        tx.create = originalCreate;
      }
    }, ...transactionOptions);
    if (!stats.claimCommitted) {
      const stored = (await runRef(action).get()).data();
      if (stored?.actionClaims?.['0']?.status === 'started') {
        stats.claimCommitted = true;
        await change();
      }
    }
    return result;
  };
  try {
    outcome = { result: await executeAgentWrite.run(action) };
  } catch (error) {
    outcome = { error };
  } finally {
    db.runTransaction = original;
  }
  assert.equal(stats.claimCommitted, true, 'the mutation must follow a real committed claim');
  return { ...outcome, stats };
}

async function assertFailedWithoutRepair(action, outcome) {
  const rows = await repairRows();
  assert.equal(rows.length, 0, 'no repair record may survive a rejected transaction');
  assert.ok(outcome.error || outcome.result?.success === false, 'revoked or unreadable authority must not return success');
  const run = (await runRef(action).get()).data();
  assert.ok(['failed', 'unverified'].includes(run.actionClaims['0'].status));
  assert.equal(run.steps.some(step => step.output?.success === true), false);
}
function assertSourcesRead(attempt) {
  for (const path of sourcePaths) assert.ok(attempt.reads.includes(path), `service attempt must read ${path}`);
}

test('normal confirmation writes exactly the reviewed personal reminder with a matching receipt', async () => {
  const action = await proposal();
  const outcome = await atClaimBoundary(action);
  assert.equal(outcome.error, undefined);
  assert.equal(outcome.result.success, true);
  assert.equal(outcome.result.repairId, outcome.result.requestId);
  assert.equal(outcome.result.status, 'pending');
  assert.equal(outcome.result.room, input.room);
  assert.equal(outcome.result.dormitory, input.dormitory);
  assert.equal(outcome.stats.attempts.length, 1);
  assertSourcesRead(outcome.stats.attempts[0]);
  const rows = await repairRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, `schools/pu/repairRequests/${outcome.result.repairId}`);
  assert.deepEqual(rows[0].data, { ...input, userId: 'alice', schoolId: 'pu', images: [],
    status: 'pending', createdAt: rows[0].data.createdAt });
  assert.ok(rows[0].data.createdAt instanceof Timestamp);
  assert.equal((await runRef(action).get()).data().actionClaims['0'].status, 'completed');
});

for (const status of ['disabled', 'deleted', 'suspended', 'inactive']) {
  test(`account becomes ${status} after the claim: no repair is written`, async () => {
    const action = await proposal();
    const outcome = await atClaimBoundary(action, () => db.doc(actorPath).update({ status }));
    await assertFailedWithoutRepair(action, outcome);
  });
}
test('account deletion starts after the claim: no repair is written', async () => {
  const action = await proposal();
  await assertFailedWithoutRepair(action, await atClaimBoundary(action,
    () => db.doc(actorPath).update({ accountDeletionInProgress: true })));
});
for (const remove of [false, true]) {
  test(`membership ${remove ? 'removed' : 'deactivated'} after the claim: no repair is written`, async () => {
    const action = await proposal();
    await assertFailedWithoutRepair(action, await atClaimBoundary(action,
      () => remove ? db.doc(memberPath).delete() : db.doc(memberPath).update({ status: 'inactive' })));
  });
  test(`repair permission ${remove ? 'removed' : 'revoked'} after the claim: no repair is written`, async () => {
    const action = await proposal();
    await assertFailedWithoutRepair(action, await atClaimBoundary(action,
      () => remove ? db.doc(permissionPath).delete() : db.doc(permissionPath).update({ createDormRepairRequest: false })));
  });
}
for (const path of sourcePaths) {
  test(`unreadable transaction source ${path} fails closed`, async () => {
    const action = await proposal();
    const outcome = await atClaimBoundary(action, undefined, { failRead: path });
    await assertFailedWithoutRepair(action, outcome);
    assert.ok(outcome.stats.attempts.some(attempt => attempt.reads.includes(path)), 'the actual transaction must attempt the failed source');
  });
}

test('duplicate and repeated confirmations cannot create another repair', async () => {
  const action = await proposal();
  const outcomes = await Promise.allSettled([executeAgentWrite.run(action), executeAgentWrite.run(action)]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled' && row.value.success === true).length, 1);
  assert.equal(outcomes.find(row => row.status === 'rejected').reason.code, 'already-exists');
  const before = await repairRows();
  assert.equal(before.length, 1);
  await assert.rejects(executeAgentWrite.run(action), { code: 'already-exists' });
  assert.deepEqual(await repairRows(), before);
});

test('restoring permission after a rejected attempt cannot reuse its consumed claim', async () => {
  const action = await proposal();
  const outcome = await atClaimBoundary(action,
    () => db.doc(permissionPath).update({ createDormRepairRequest: false }));
  await assertFailedWithoutRepair(action, outcome);
  await db.doc(permissionPath).update({ createDormRepairRequest: true });
  await assert.rejects(executeAgentWrite.run(action), { code: 'already-exists' });
  assert.deepEqual(await repairRows(), []);
});

test('invalid scope, foreign identity, foreign school and altered input cannot claim this proposal', async () => {
  const action = await proposal();
  for (const changed of [
    { ...action, data: { ...action.data, context: { schoolId: 'pu/foreign' } } },
    { ...action, auth: { uid: 'bob' } },
    { ...action, data: { ...action.data, context: { schoolId: 'ntu' } } },
    { ...action, data: { ...action.data, input: { ...input, room: '999' } } },
  ]) await assert.rejects(executeAgentWrite.run(changed));
  assert.deepEqual(await repairRows(), []);
  assert.equal((await runRef(action).get()).data().actionClaims, undefined);
  const result = await executeAgentWrite.run(action);
  assert.equal(result.success, true);
  assert.equal((await repairRows()).length, 1);
});

test('direct tool rejects malformed actor and school identifiers without a repair', async () => {
  for (const context of [
    { uid: 'alice/foreign', schoolId: 'pu' }, { uid: 'alice', schoolId: 'pu/foreign' },
    { uid: '', schoolId: 'pu' }, { uid: 'alice', schoolId: '' },
  ]) {
    const result = await repair.execute(context, input);
    assert.equal(result.success, false);
  }
  assert.deepEqual(await repairRows(), []);
});

test('abort after staging the repair commits no partial data and consumes the attempted claim', async () => {
  const action = await proposal();
  const outcome = await atClaimBoundary(action, undefined, { abortCommit: true });
  await assertFailedWithoutRepair(action, outcome);
  assert.equal(outcome.stats.attempts[0].repairs.length, 1, 'failure must occur after tx.create, before commit');
  await assert.rejects(executeAgentWrite.run(action), { code: 'already-exists' });
  assert.deepEqual(await repairRows(), []);
});

test('real SDK retries synthetic ABORTED contention and commits only one repair when authority stays valid', async () => {
  const action = await proposal();
  const outcome = await atClaimBoundary(action, undefined, { retryOnce: true });
  assert.equal(outcome.result?.success, true);
  assert.equal(outcome.stats.attempts.length, 2, 'Firestore must really rerun the service callback');
  for (const attempt of outcome.stats.attempts) assertSourcesRead(attempt);
  assert.equal((await repairRows()).length, 1, 'the rolled-back attempt must not leave a second repair');
});
for (const [name, path, value] of [
  ['account', actorPath, { status: 'disabled' }],
  ['membership', memberPath, { status: 'inactive' }],
  ['permission', permissionPath, { createDormRepairRequest: false }],
]) {
  test(`transaction retry re-reads ${name} revoked after the first staged attempt`, async () => {
    const action = await proposal();
    const outcome = await atClaimBoundary(action, undefined, {
      retryOnce: true, beforeRetry: () => db.doc(path).update(value),
    });
    await assertFailedWithoutRepair(action, outcome);
    assert.equal(outcome.stats.attempts.length, 2, 'the SDK must retry after rolling back the first staged write');
    assertSourcesRead(outcome.stats.attempts[0]);
    assert.ok(outcome.stats.attempts[1].reads.includes(path), 'the retry must read the newly revoked source');
    assert.equal(outcome.stats.attempts[0].repairs.length, 1);
    assert.equal(outcome.stats.attempts[1].repairs.length, 0);
  });
}
