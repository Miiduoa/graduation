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


test('a personal pin must reference one of the author’s current nonanonymous posts', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('schools/pu/campusPosts/photo1').set({
      schoolId: 'pu', authorUid: 'alice', anonymous: false, title: '我的照片',
    });
    await db.doc('schools/pu/campusPosts/anonymousOld').set({
      schoolId: 'pu', authorUid: 'alice', anonymous: true, title: '匿名舊貼文',
    });
    await db.doc('schools/pu/campusPosts/bobPost').set({
      schoolId: 'pu', authorUid: 'bob', anonymous: false, title: '其他同學',
    });
    await db.doc('schools/pu/campusPosts/wrongSchool').set({
      schoolId: 'other', authorUid: 'alice', anonymous: false, title: '錯誤校園',
    });
  });
  await assertSucceeds(doc(alice).set(card({ pinnedPostId: 'photo1' })));
  await assertSucceeds(doc(alice).set({ pinnedPostId: '', updatedAt: serverTimestamp() }, { merge: true }));
  await assertSucceeds(doc(alice).set({ pinnedPostId: 'photo1', updatedAt: serverTimestamp() }, { merge: true }));

  const snapshot = await assertSucceeds(doc(alice).get({ source: 'server' }));
  if (snapshot.data()?.bio !== card().bio) throw Error('Changing the pin modified the biography');

  for (const pinnedPostId of ['missing', 'anonymousOld', 'bobPost', 'wrongSchool', 'invalid/path', 'x'.repeat(129)]) {
    await assertFails(doc(alice).set({ pinnedPostId, updatedAt: serverTimestamp() }, { merge: true }));
  }
  await assertFails(doc(alice).set({ pinnedPostId: 10, updatedAt: serverTimestamp() }, { merge: true }));
});

test('other members cannot pin another author’s post or modify their pinned profile', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  const bob = environment.authenticatedContext('bob').firestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('schools/pu/campusPosts/photo1').set({
      schoolId: 'pu', authorUid: 'alice', anonymous: false, title: '照片',
    });
  });
  await assertSucceeds(doc(alice).set(card({ pinnedPostId: 'photo1' })));
  await assertFails(doc(bob).set({ pinnedPostId: '', updatedAt: serverTimestamp() }, { merge: true }));
  await assertFails(doc(bob).set(card({ pinnedPostId: 'photo1' })));
});

test('bio edits preserve the creator pin and do not permit hidden private fields', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('schools/pu/campusPosts/photo1').set({
      schoolId: 'pu', authorUid: 'alice', anonymous: false, title: '照片',
    });
  });
  await assertSucceeds(doc(alice).set(card({ pinnedPostId: 'photo1' })));
  await assertSucceeds(doc(alice).set(card({ bio: '新簡介' }), { merge: true }));
  const snapshot = await assertSucceeds(doc(alice).get({ source: 'server' }));
  if (snapshot.data()?.pinnedPostId !== 'photo1') throw Error('Editing the bio discarded the pin');
  await assertFails(doc(alice).set({ studentId: 'secret', updatedAt: serverTimestamp() }, { merge: true }));
});
