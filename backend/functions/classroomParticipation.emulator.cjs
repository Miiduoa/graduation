/* global process */
'use strict';

const { after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { getApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

if (!/^(?:localhost|127\.0\.0\.1):\d{1,5}$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw new Error('Run only against a local Firestore emulator');
}
const projectId = 'demo-campus-classroom-participation';
process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
const { submitPollResponse, submitReaction } = require('./index');
const db = getFirestore();
const group = db.doc('groups/class-one');
const live = group.collection('liveSessions').doc('current');
const poll = live.collection('polls').doc('question');
const counts = { understood: 0, partial: 0, confused: 0 };
const request = (uid, data) => ({
  auth: { uid },
  data: { groupId: group.id, sessionId: live.id, ...data },
});
const vote = (uid, optionIdx = 1, pollId = poll.id) =>
  submitPollResponse.run(request(uid, { pollId, optionIdx }));
const react = (uid, reaction = 'partial') => submitReaction.run(request(uid, { reaction }));

beforeEach(async () => {
  await db.recursiveDelete(group);
  const batch = db.batch();
  batch.set(group, { type: 'course', schoolId: 'school-one' });
  for (const uid of ['student', 'student.a', 'removed']) {
    batch.set(group.collection('members').doc(uid), { status: uid === 'removed' ? 'inactive' : 'active' });
    batch.set(db.doc(`schools/school-one/members/${uid}`), { status: 'active' });
  }
  batch.set(live, { schemaVersion: 2, active: true, reactions: counts });
  batch.set(poll, { active: true, options: ['A', 'B'], responses: {} });
  await batch.commit();
});
after(async () => {
  await db.terminate();
  await deleteApp(getApp());
});

for (const [name, submit] of [['vote', vote], ['reaction', react]]) {
  for (const actor of ['outsider', 'removed', 'student']) {
    test(`rejects ${name} without classroom and school membership (${actor})`, async () => {
      if (actor === 'student') {
        await db.doc('schools/school-one/members/student').update({ status: 'inactive' });
      }
      await assert.rejects(submit(actor), { code: 'permission-denied' });
      assert.deepEqual((await poll.get()).data().responses, {});
      assert.deepEqual((await live.get()).data().reactions, counts);
      assert.equal((await live.collection('userReactions').doc(actor).get()).exists, false);
    });
  }

  test(`rejects ${name} after the session closes`, async () => {
    await live.update({ active: false });
    await assert.rejects(submit('student'), { code: 'failed-precondition' });
  });
}

test('rejects out-of-range choices, nested poll paths and closed polls', async () => {
  await assert.rejects(vote('student', 2), { code: 'invalid-argument' });
  await assert.rejects(vote('student', '0'), { code: 'invalid-argument' });
  await assert.rejects(vote('student', 0, 'question/nested/value'), { code: 'invalid-argument' });
  await poll.update({ active: false });
  await assert.rejects(vote('student'), { code: 'failed-precondition' });
  assert.deepEqual((await poll.get()).data().responses, {});
});

test('records each member vote under the literal UID', async () => {
  await vote('student', 0);
  await vote('student.a', 1);
  assert.deepEqual((await poll.get()).data().responses, { student: 0, 'student.a': 1 });
});

test('keeps one reaction per member when requests are retried or changed', async () => {
  await Promise.all([react('student'), react('student')]);
  assert.deepEqual((await live.get()).data().reactions, { ...counts, partial: 1 });
  await react('student', 'understood');
  assert.deepEqual((await live.get()).data().reactions, { ...counts, understood: 1 });
  assert.equal((await live.collection('userReactions').doc('student').get()).data().reaction, 'understood');
});
