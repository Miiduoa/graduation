const { before, beforeEach, after, test } = require('node:test');
const {
  initializeTestEnvironment, assertFails, assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { serverTimestamp } = require('firebase/firestore');
const fs = require('node:fs');
const path = require('node:path');

let environment;
const doc = (db, schoolId = 'pu', uid = 'alice') =>
  db.doc(`schools/${schoolId}/creatorProfiles/${uid}`);
const card = (patch = {}) => ({
  schoolId: 'pu',
  ownerUid: 'alice',
  headline: '喜歡拍照的資管生',
  bio: '分享校園攝影、課程與社團活動。',
  linkUrl: 'https://example.org/portfolio',
  updatedAt: serverTimestamp(),
  ...patch,
});

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-campus-creator-card-security',
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
after(async () => environment?.cleanup());

test('the owner can publish and edit a campus social card, and peers may read it', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  const bob = environment.authenticatedContext('bob').firestore();
  await assertSucceeds(doc(alice).set(card()));
  const first = await assertSucceeds(doc(bob).get());
  if (first.data()?.headline !== '喜歡拍照的資管生') throw Error('Card read failed');
  await assertSucceeds(doc(alice).set(card({ bio: '更新的校園簡介' })));
  const updated = await assertSucceeds(doc(bob).get({ source: 'server' }));
  if (updated.data()?.bio !== '更新的校園簡介') throw Error('Card update failed');
  await assertSucceeds(doc(alice).delete());
});

test('guests, other-campus members and nonmembers cannot read or write the card', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  const bob = environment.authenticatedContext('bob').firestore();
  const charlie = environment.authenticatedContext('charlie').firestore();
  const inactive = environment.authenticatedContext('inactive').firestore();
  const guest = environment.unauthenticatedContext().firestore();
  await assertSucceeds(doc(alice).set(card()));
  await assertSucceeds(doc(bob).get());
  for (const db of [charlie, inactive, guest]) {
    await assertFails(doc(db).get({ source: 'server' }));
    await assertFails(doc(db).set(card()));
    await assertFails(doc(db).delete());
  }
  await assertFails(doc(bob).set(card()));
  await assertFails(doc(bob).update({ bio: 'I own this' }));
  await assertFails(bob.collection('schools/pu/creatorProfiles').get());
});

test('cannot spoof school, owner, private fields, untrusted link or oversized content', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  await assertFails(doc(alice).set(card({ schoolId: 'other' })));
  await assertFails(doc(alice).set(card({ ownerUid: 'bob' })));
  await assertFails(doc(alice).set(card({ studentId: 'do-not-publish' })));
  await assertFails(doc(alice).set(card({ phone: 'private' })));
  await assertFails(doc(alice).set(card({ headline: 'X'.repeat(65) })));
  await assertFails(doc(alice).set(card({ bio: 'X'.repeat(221) })));
  await assertFails(doc(alice).set(card({ linkUrl: 'http://example.org' })));
  await assertFails(doc(alice).set(card({ linkUrl: 'https://user:password@example.org' })));
  await assertFails(doc(alice).set(card({ linkUrl: 'https://example.org/' + 'a'.repeat(520) })));
  await assertFails(doc(alice).set(card({ updatedAt: new Date('2020-01-01') })));
});

test('revoked membership blocks reads and writes of an existing creator card', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  await assertSucceeds(doc(alice).set(card()));
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('schools/pu/members/alice').update({ status: 'inactive' });
  });
  await assertFails(doc(alice).get({ source: 'server' }));
  await assertFails(doc(alice).set(card({ bio: 'edited after revocation' })));
  // Losing school eligibility must not trap previously shared personal text forever.
  await assertSucceeds(doc(alice).delete());
});

const featureRef = (db, schoolId = 'pu', uid = 'alice') =>
  db.doc('schools/' + schoolId + '/creatorHighlights/' + uid);
const featured = (postId = 'mine') => ({
  schoolId: 'pu',
  ownerUid: 'alice',
  postId,
  updatedAt: serverTimestamp(),
});

async function seedFeaturedPosts() {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [id, attrs] of [
      ['mine', { authorUid: 'alice', anonymous: false, schoolId: 'pu' }],
      ['other-owner', { authorUid: 'bob', anonymous: false, schoolId: 'pu' }],
      ['anonymous', { authorUid: 'alice', anonymous: true, schoolId: 'pu' }],
      ['wrong-school', { authorUid: 'alice', anonymous: false, schoolId: 'other' }],
    ]) {
      await db.doc('schools/pu/campusPosts/' + id).set({
        ...attrs, boardId: 'student-life', title: '貼文', content: '內容',
        createdAt: serverTimestamp(),
      });
    }
  });
}

test('creator can feature only their signed post; same-campus peers see the pointer', async () => {
  await seedFeaturedPosts();
  const alice = environment.authenticatedContext('alice').firestore();
  const bob = environment.authenticatedContext('bob').firestore();
  const guest = environment.unauthenticatedContext().firestore();
  const other = environment.authenticatedContext('charlie').firestore();
  await assertSucceeds(featureRef(alice).set(featured()));
  const existing = await assertSucceeds(featureRef(bob).get({ source: 'server' }));
  if (existing.data()?.postId !== 'mine') throw Error('Featured post not available to peer');
  await assertFails(featureRef(guest).get({ source: 'server' }));
  await assertFails(featureRef(other).get({ source: 'server' }));
  await assertFails(bob.collection('schools/pu/creatorHighlights').get());
  await assertFails(featureRef(bob).set(featured('other-owner')));
  await assertFails(featureRef(bob).delete());
  await assertSucceeds(featureRef(alice).delete());
});

test('featured pointers reject anonymous, foreign, forged and deleted posts', async () => {
  await seedFeaturedPosts();
  const alice = environment.authenticatedContext('alice').firestore();
  for (const postId of ['other-owner', 'anonymous', 'wrong-school', 'missing']) {
    await assertFails(featureRef(alice).set(featured(postId)));
  }
  await assertFails(featureRef(alice).set(featured('mine/other')));
  await assertFails(featureRef(alice).set({ ...featured(), studentId: 'private' }));
  await assertFails(featureRef(alice).set({ ...featured(), ownerUid: 'bob' }));
  await assertFails(featureRef(alice).set({ ...featured(), schoolId: 'other' }));
  await assertFails(featureRef(alice).set({ ...featured(), updatedAt: new Date('2020-01-01') }));
  await assertSucceeds(featureRef(alice).set(featured()));
  await assertFails(featureRef(alice).set(featured('other-owner')));
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('schools/pu/campusPosts/mine').update({ anonymous: true });
  });
  await assertFails(featureRef(alice).set(featured('mine')));
});

test('revoked school membership rejects featured reads, edits, and removal', async () => {
  await seedFeaturedPosts();
  const alice = environment.authenticatedContext('alice').firestore();
  await assertSucceeds(featureRef(alice).set(featured()));
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('schools/pu/members/alice').update({ status: 'inactive' });
  });
  await assertSucceeds(featureRef(alice).get({ source: 'server' }));
  await assertFails(featureRef(alice).set(featured()));
  await assertSucceeds(featureRef(alice).delete());
});
