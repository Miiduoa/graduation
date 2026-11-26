'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, 'seed.cjs'), 'utf8');

async function run({ existing = false, authError, documentError } = {}) {
  const calls = { createdUsers: [], createdDocuments: [], updateUsers: 0, mergedDocuments: 0, paths: [] };
  const code = await new Promise((resolve, reject) => {
    const auth = {
      async getUser() {
        if (authError) throw { code: authError };
        if (!existing) throw { code: 'auth/user-not-found' };
        return {};
      },
      async updateUser() { calls.updateUsers++; },
      async createUser(user) { calls.createdUsers.push(user.uid); },
    };
    const db = {
      doc(reference) {
        calls.paths.push(reference);
        assert.match(reference, /^(schools\/pu(?:\/|$)|users\/test-)/);
        return {
          async create(data) {
            if (documentError) throw { code: documentError };
            if (existing) throw { code: 6 };
            calls.createdDocuments.push({ reference, data });
          },
          async set() { calls.mergedDocuments++; },
        };
      },
    };
    try {
      vm.runInNewContext(source, {
        require(name) {
          if (name === 'firebase-admin/app') return { initializeApp() {} };
          if (name === 'firebase-admin/auth') return { getAuth: () => auth };
          if (name === 'firebase-admin/firestore') return { getFirestore: () => db };
          throw new Error('Unexpected dependency');
        },
        process: {
          argv: ['node', 'seed.cjs', '--missing-only'],
          env: { TEST_PROJECT_ID: 'demo-campus-one', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19291',
            FIRESTORE_EMULATOR_HOST: '127.0.0.1:18291' },
          exit: resolve,
        },
        console: { log() {}, error() {} },
      });
    } catch (error) { reject(error); }
  });
  return { code, calls };
}

test('missing-only seeding leaves existing public accounts and documents unchanged', async () => {
  const { code, calls } = await run({ existing: true });
  assert.equal(code, 0);
  assert.equal(calls.createdUsers.length, 0);
  assert.equal(calls.createdDocuments.length, 0);
  assert.equal(calls.updateUsers, 0);
  assert.equal(calls.mergedDocuments, 0);
  assert.equal(calls.paths.length, 12);
});

test('missing-only seeding creates only the missing public fixtures', async () => {
  const { code, calls } = await run();
  assert.equal(code, 0);
  assert.equal(calls.createdUsers.length, 5);
  assert.equal(calls.createdDocuments.length, 12);
  assert.equal(calls.updateUsers, 0);
  assert.equal(calls.mergedDocuments, 0);
});

test('unexpected auth errors do not create replacement accounts', async () => {
  const { code, calls } = await run({ authError: 'auth/internal-error' });
  assert.equal(code, 1);
  assert.equal(calls.createdUsers.length, 0);
  assert.equal(calls.updateUsers, 0);
});

test('document failures are not mistaken for an existing fixture', async () => {
  const { code } = await run({ documentError: 13 });
  assert.equal(code, 1);
});
