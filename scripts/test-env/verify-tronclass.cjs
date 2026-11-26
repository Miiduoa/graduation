'use strict';

// Exercise the real Next routes and emulator SDKs, without a school login or
// mocked fetch. Only public emulator fixture identities are used here.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { writeRuntimeReport } = require('./write-runtime-report.cjs');

const projectId = process.env.TEST_PROJECT_ID;
const origin = process.env.WEB_PUBLIC_ORIGIN;
assert.equal(projectId, 'demo-campus-one');
assert.match(origin || '', /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:19291');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18291');
assert.equal(process.env.NODE_ENV, 'development');
assert.equal(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, undefined);
assert.equal(process.env.TRONCLASS_RETENTION_ENABLED, 'true');
assert.equal(process.env.TRONCLASS_PLATFORM_CLOSURE_WORKER_ENABLED, 'false');
for (const name of ['TRONCLASS_PLATFORM_CLOSURE_DATABASE_URL', 'FILE_STORAGE_BACKEND',
  'NEXT_PUBLIC_FILE_STORAGE_BACKEND', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'DATABASE_URL', 'ASSIGNMENT_FILE_DATABASE_URL', 'PLATFORM_ASSISTANT_DATABASE_URL',
  'ASSIGNMENT_FILE_SIGNING_SECRET', 'ASSIGNMENT_FILE_STORE_DIR']) {
  assert.equal(process.env[name], undefined, `Isolated runtime must not inherit ${name}.`);
}

const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

async function json(url, body, token) {
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90_000),
    headers: { 'Content-Type': 'application/json', Origin: origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, value: await response.json() };
}

async function main() {
  for (let retry = 0; ; retry++) {
    try {
      const health = await fetch(`${origin}/health/live`, { signal: AbortSignal.timeout(10_000) });
      if (health.ok) break;
    } catch { /* Next may still be starting. */ }
    if (retry >= 60) throw new Error('Local Next server did not become ready.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const app = initializeApp({ projectId }, 'tronclass-emulator-verification');
  const auth = getAuth(app);
  const db = getFirestore(app);
  const signIn = async (login, password = 'campus-test-1234') => {
    const base = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_SAME_ORIGIN === 'true'
      ? origin : `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
    return json(`${base}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
      { email: `${login}@test.campus-one.local`, password, returnSecureToken: true });
  };
  const request = (body, token) => json(`${origin}/api/tronclass`, body, token);
  let secondDisabled = false;
  try {
    assert.equal((await signIn('s0000001', 'wrong-emulator-password')).status, 400);
    const first = await signIn('s0000001');
    const second = await signIn('s0000002');
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.value.localId, 'test-student-a');
    assert.equal(second.value.localId, 'test-student-b');
    const firstToken = first.value.idToken;
    const secondToken = second.value.idToken;
    assert.equal((await request({ action: 'status' })).status, 401);
    assert.equal((await request({ action: 'status' }, 'not-an-issued-token')).status, 401);
    const initial = await request({ action: 'status' }, firstToken);
    assert.equal(initial.status, 200);
    assert.equal(initial.value.connected, false, 'Refusing to disturb an existing emulator school binding.');
    const disconnected = await request({ action: 'disconnect', expectedRevision: initial.value.revision }, firstToken);
    assert.equal(disconnected.status, 200);
    const reread = await request({ action: 'status' }, firstToken);
    assert.equal(reread.status, 200);
    assert.equal(reread.value.revision, disconnected.value.revision);
    const ownerHash = createHash('sha256').update('firebase:test-student-a').digest('hex');
    const stored = (await db.doc(`_tronClassBindings/${ownerHash}`).get()).data();
    assert.equal(stored.state, 'disconnected');
    assert.equal(stored.revision, disconnected.value.revision);
    const other = await request({ action: 'status' }, secondToken);
    assert.equal(other.status, 200);
    assert.equal(other.value.revision, null);
    await auth.updateUser('test-student-b', { disabled: true });
    secondDisabled = true;
    assert.equal((await request({ action: 'status' }, secondToken)).status, 401);
    const report = { checkedAt: new Date().toISOString(), projectId, fullNext: true,
      realAuthEmulator: true, realFirestoreEmulator: true, wrongPasswordRejected: true,
      invalidTokenRejected: true, disabledAccountRejected: true, bindingStatePersisted: true,
      accountIsolationVerified: true, productionWorkersDisabled: true,
      productionStoresAbsent: true, schoolLoginPerformed: false, schoolWritesPerformed: false };
    if (process.env.TRONCLASS_RUNTIME_DIR) {
      writeRuntimeReport(Number(process.env.TRONCLASS_REPORT_DIR_FD), 'acceptance.json', report);
    }
    console.log(JSON.stringify(report));
  } finally {
    if (secondDisabled) await auth.updateUser('test-student-b', { disabled: false });
    await db.terminate();
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(`Local TronClass runtime verification failed: ${error.code || error.name || 'error'}`);
  process.exitCode = 1;
});
