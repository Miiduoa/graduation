const { before, beforeEach, after, test } = require('node:test');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { serverTimestamp } = require('firebase/firestore');
const fs = require('node:fs');
const path = require('node:path');

let environment;
const key = (schoolId, followerUid, targetUid) =>
  `fol_${schoolId}_${followerUid}_${targetUid}`;
const follow = (db, followerUid = 'alice', targetUid = 'bob', schoolId = 'pu') =>
  db.doc(`follows/${key(schoolId, followerUid, targetUid)}`);
const record = (patch = {}) => ({
  schoolId: 'pu',
  followerUid: 'alice',
  targetUid: 'bob',
  createdAt: serverTimestamp(),
  ...patch,
});

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-campus-follows-security',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore/firestore.rules'), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const uid of ['alice', 'bob']) {
      await db.doc(`schools/pu/members/${uid}`).set({ status: 'active', role: 'student' });
    }
    await db.doc('schools/other/members/charlie').set({ status: 'active', role: 'student' });
    await db.doc('schools/pu/members/inactive').set({ status: 'inactive', role: 'student' });
  });
});

after(async () => {
  await environment?.cleanup();
});

test('an active student can follow a current school member and list their own follows', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  await assertSucceeds(follow(alice).set(record()));
  await assertSucceeds(follow(alice).get());
  const list = await assertSucceeds(
    alice.collection('follows').where('schoolId', '==', 'pu').where('followerUid', '==', 'alice').get(),
  );
  if (list.size !== 1 || list.docs[0].id !== key('pu', 'alice', 'bob'))
    throw Error('Following list was not scoped to its owner');
  await assertFails(follow(alice).update({ targetUid: 'charlie' }));
  await assertSucceeds(follow(alice).delete());
});

test('only follower or target can read the follow; guests and strangers cannot', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  const bob = environment.authenticatedContext('bob').firestore();
  const charlie = environment.authenticatedContext('charlie').firestore();
  const guest = environment.unauthenticatedContext().firestore();
  await assertSucceeds(follow(alice).set(record()));
  await assertSucceeds(follow(bob).get());
  for (const db of [charlie, guest]) {
    await assertFails(follow(db).get());
    await assertFails(follow(db).delete());
    await assertFails(follow(db).set(record()));
  }
  await assertFails(bob.collection('follows').get());
});

test('self-follows, mismatched IDs, extra fields, inactive targets and unrelated schools fail', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  await assertFails(follow(alice, 'alice', 'alice').set(record({ targetUid: 'alice' })));
  await assertFails(alice.doc('follows/random').set(record()));
  await assertFails(follow(alice).set(record({ verified: true })));
  await assertFails(follow(alice).set(record({ createdAt: new Date('2026-01-01') })));
  await assertFails(follow(alice, 'alice', 'inactive').set(record({ targetUid: 'inactive' })));
  await assertFails(follow(alice, 'alice', 'charlie').set(record({ targetUid: 'charlie' })));
  await assertFails(follow(alice, 'alice', 'charlie', 'other').set(record({
    schoolId: 'other', targetUid: 'charlie',
  })));
});

test('membership revocation prevents further reads and creations', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  await assertSucceeds(follow(alice).set(record()));
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('schools/pu/members/alice').update({ status: 'inactive' });
  });
  await assertFails(follow(alice).get({ source: 'server' }));
  await assertFails(alice.collection('follows').where('schoolId', '==', 'pu').where('followerUid', '==', 'alice').get({ source: 'server' }));
  await assertFails(follow(alice, 'alice', 'inactive').set(record({ targetUid: 'inactive' })));
  // Privacy cleanup remains possible after membership is revoked.
  await assertSucceeds(follow(alice).delete());
});
