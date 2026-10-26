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
const bookmark = (db, uid = 'alice', schoolId = 'pu', postId = 'one') =>
  db.doc(`users/${uid}/campusPostBookmarks/${schoolId}/posts/${postId}`);
const data = (overrides = {}) => ({
  schoolId: 'pu',
  postId: 'one',
  createdAt: serverTimestamp(),
  ...overrides,
});

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-campus-post-bookmarks',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore/firestore.rules'), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('schools/pu/members/alice').set({ status: 'active', role: 'student' });
    await db.doc('schools/pu/members/bob').set({ status: 'active', role: 'student' });
    await db.doc('schools/pu/campusPosts/one').set({
      schoolId: 'pu', boardId: 'public', anonymous: false, authorUid: 'bob', title: 'Hello',
    });
    await db.doc('schools/other/campusPosts/one').set({
      schoolId: 'other', boardId: 'public', anonymous: false, authorUid: 'bob', title: 'Other',
    });
  });
});

after(async () => {
  await environment?.cleanup();
});

test('the active student can create, list and remove own bookmarked campus posts', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  const ref = bookmark(alice);
  await assertSucceeds(ref.set(data()));
  await assertSucceeds(ref.get());
  const list = await assertSucceeds(alice.collection('users/alice/campusPostBookmarks/pu/posts').get());
  if (list.size !== 1 || list.docs[0].id !== 'one') throw Error('Saved post missing');
  await assertFails(ref.update({ schoolId: 'other' }));
  await assertSucceeds(ref.delete());
});

test('no account may read or write someone else\'s saved posts', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  const bob = environment.authenticatedContext('bob').firestore();
  const guest = environment.unauthenticatedContext().firestore();
  await assertSucceeds(bookmark(alice).set(data()));
  for (const db of [bob, guest]) {
    await assertFails(bookmark(db).get());
    await assertFails(bookmark(db).set(data()));
    await assertFails(bookmark(db).delete());
  }
});

test('rejects forged school, extra fields, missing posts and missing school membership', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  await assertFails(bookmark(alice).set(data({ schoolId: 'other' })));
  await assertFails(bookmark(alice).set(data({ authorUid: 'bob' })));
  await assertFails(bookmark(alice, 'alice', 'pu', 'missing').set(data({ postId: 'missing' })));
  await assertFails(bookmark(alice, 'alice', 'other').set(data({ schoolId: 'other' })));
});

test('revoking school membership also revokes access to saved school posts', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  await assertSucceeds(bookmark(alice).set(data()));
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('schools/pu/members/alice').update({ status: 'inactive' });
  });
  // Default Firestore reads may reuse the document just written by this client.
  // Require a server read to exercise the current authorization policy.
  await assertFails(bookmark(alice).get({ source: 'server' }));
  await assertFails(alice.collection('users/alice/campusPostBookmarks/pu/posts').get({ source: 'server' }));
  await assertFails(bookmark(alice).delete());
});
