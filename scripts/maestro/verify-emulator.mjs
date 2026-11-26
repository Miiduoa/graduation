import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import { emulatorEnvironment } from './emulator-env.mjs';
import { MAESTRO_STUDENT_EMAIL, MAESTRO_STUDENT_UID } from '../../apps/mobile/e2e/emulatorConfig.ts';

const { fetch, AbortSignal } = globalThis;
const { project, auth, firestore } = emulatorEnvironment();
// The existing public, emulator-only seed owns this fixture password. Do not
// duplicate it in workflow logs or introduce a production account secret.
const seed = readFileSync('scripts/test-env/seed.cjs', 'utf8');
const password = /^const PASSWORD = '([^']+)';/m.exec(seed)?.[1];
assert.ok(password, 'Existing emulator seed password is missing');
const signIn = (value) => fetch(`http://${auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: MAESTRO_STUDENT_EMAIL, password: value, returnSecureToken: true }),
  signal: AbortSignal.timeout(10000), redirect: 'error',
});
const rejected = await signIn('incorrect-emulator-fixture-password');
assert.equal(rejected.status, 400, 'The Auth emulator must reject a wrong password');
const response = await signIn(password);
assert.equal(response.status, 200, 'Seeded account cannot authenticate to the local Auth emulator');
const identity = await response.json();
assert.equal(identity.localId, MAESTRO_STUDENT_UID);
const claims = JSON.parse(Buffer.from(identity.idToken.split('.')[1], 'base64url').toString());
assert.equal(claims.aud, project);
assert.equal(claims.sub, MAESTRO_STUDENT_UID);
assert.equal(claims.firebase.sign_in_provider, 'password');
const get = async (path, token = identity.idToken) => {
  const result = await fetch(`http://${firestore}/v1/projects/${project}/databases/(default)/documents/${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  return { status: result.status, data: await result.json() };
};
const profile = await get(`users/${MAESTRO_STUDENT_UID}`);
assert.equal(profile.status, 200);
assert.equal(profile.data.fields.primarySchoolId.stringValue, 'pu');
assert.equal(profile.data.fields.role.stringValue, 'student');
const member = await get(`schools/pu/members/${MAESTRO_STUDENT_UID}`);
assert.equal(member.status, 200);
assert.equal(member.data.fields.status.stringValue, 'active');
assert.equal(member.data.fields.role.stringValue, 'student');
assert.equal((await get(`users/${MAESTRO_STUDENT_UID}`, null)).status, 403,
  'The real Firestore rules must deny unauthenticated profile access');
for (const path of ['schools/pu/announcements/maestro-course-selection', 'schools/pu/clubEvents/maestro-campus-event']) {
  assert.equal((await get(path)).status, 200, 'Authenticated fixture content is not readable');
}
console.log('Verified real emulator password authentication, student membership, content reads, and guest profile denial.');
