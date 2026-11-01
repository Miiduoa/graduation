const { before, after, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
let env;
before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('需要獨立測試環境');
  env = await initializeTestEnvironment({
    projectId: 'demo-nuni-club',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore/firestore.rules'), 'utf8'),
    },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('groups/club').set({ type: 'club', schoolId: 'school' });
    for (const [uid, role] of [
      ['president', 'owner'],
      ['officer', 'admin'],
      ['student', 'member'],
      ['moderator', 'moderator'],
      ['instructor', 'instructor'],
    ]) {
      await db.doc(`schools/school/members/${uid}`).set({ status: 'active' });
      await db
        .doc(`groups/club/members/${uid}`)
        .set({ status: 'active', role, phone: '0900000000' });
    }
    await db.doc('groups/club/clubEvents/event').set({ title: '測試活動' });
    await db
      .doc('groups/club/clubEvents/event/registrations/student')
      .set({ status: 'registered' });
  });
});
after(async () => {
  await env?.cleanup();
});
test('社員無法直接取得其他社員的私人欄位，既有管理角色保留讀權', async () => {
  for (const uid of ['president', 'officer', 'moderator', 'instructor'])
    await assertSucceeds(
      env.authenticatedContext(uid).firestore().doc('groups/club/members/student').get(),
    );
  for (const uid of ['student', 'outsider'])
    await assertFails(
      env.authenticatedContext(uid).firestore().doc('groups/club/members/officer').get(),
    );
  await assertSucceeds(
    env.authenticatedContext('student').firestore().doc('groups/club/members/student').get(),
  );
  await assertFails(
    env.authenticatedContext('student').firestore().collection('groups/club/members').get(),
  );
});
test('既有教師與管理員保留管理權，但不能直接調整角色', async () => {
  for (const uid of ['moderator', 'instructor']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertSucceeds(db.doc('groups/club/members/student').update({ phone: '0911111111' }));
    await assertFails(db.doc('groups/club/members/student').update({ role: 'owner' }));
    await assertSucceeds(db.doc('groups/club/members/removable').delete());
  }
});

test('所有客戶端均不可繞過伺服器讀寫活動、報名及簽到', async () => {
  for (const uid of ['president', 'officer', 'student', 'outsider']) {
    const db = env.authenticatedContext(uid).firestore();
    for (const target of [
      'groups/club/clubEvents/event',
      'groups/club/clubEvents/event/registrations/student',
    ]) {
      await assertFails(db.doc(target).get());
      await assertFails(db.doc(target).set({ checkedInAt: 123 }));
    }
  }
});

test('真實交易重送後重讀仍只計一次報名與簽到', async () => {
  const { Firestore } = require('@google-cloud/firestore');
  const { createClubAdmin } = require('../functions/clubAdmin');
  const db = new Firestore({
    projectId: 'demo-nuni-club',
    host: process.env.FIRESTORE_EMULATOR_HOST,
    ssl: false,
    universeDomain: 'googleapis.com',
  });
  try {
    let clock = 1000;
    const run = createClubAdmin({
      db,
      enabled: () => true,
      pilotGroupId: 'club',
      now: () => clock,
    });
    const call = (uid, data = {}) =>
      run({ auth: { uid }, data: { schoolId: 'school', groupId: 'club', ...data } });
    await Promise.all(
      [1, 2].map(() =>
        call('officer', {
          action: 'create',
          eventId: 'persisted',
          title: '交易測試',
          startsAt: 2000,
          endsAt: 3000,
        }),
      ),
    );
    await Promise.all(
      [1, 2, 3].map(() => call('student', { action: 'register', eventId: 'persisted' })),
    );
    clock = 2500;
    await Promise.all(
      [1, 2, 3].map(() =>
        call('officer', { action: 'checkIn', eventId: 'persisted', targetUid: 'student' }),
      ),
    );
    const reloaded = createClubAdmin({
      db,
      enabled: () => true,
      pilotGroupId: 'club',
      now: () => clock,
    });
    const view = await reloaded({
      auth: { uid: 'president' },
      data: { schoolId: 'school', groupId: 'club' },
    });
    const assert = require('node:assert/strict');
    assert.equal(view.events.find((event) => event.id === 'persisted').registered, 1);
    assert.equal(view.events.find((event) => event.id === 'persisted').checkedIn, 1);
    assert.ok((await call('president', { action: 'export' })).csv.includes('"1","1"'));
  } finally {
    await db.terminate();
  }
});

test('所有既有社團在試辦關閉時仍可取得安全名單，拒絕跨校、離社及未登入', async () => {
  const assert = require('node:assert/strict');
  const { Firestore } = require('@google-cloud/firestore');
  const { createClubRoster } = require('../functions/clubRoster');
  const db = new Firestore({
    projectId: 'demo-nuni-club',
    host: process.env.FIRESTORE_EMULATOR_HOST,
    ssl: false,
  });
  try {
    const run = createClubRoster({ db });
    for (const groupId of ['club', 'existing-club']) {
      if (groupId !== 'club') {
        await db.doc(`groups/${groupId}`).set({ type: 'club', schoolId: 'school' });
        await db
          .doc(`groups/${groupId}/members/student`)
          .set({
            status: 'active',
            role: 'member',
            displayName: '社員姓名',
            phone: 'secret',
            studentId: 'secret',
          });
      }
      const view = await run({ auth: { uid: 'student' }, data: { groupId, schoolId: 'school' } });
      assert.ok(view.members.length > 0);
      for (const member of view.members)
        assert.deepEqual(Object.keys(member).sort(), ['name', 'role']);
      if (groupId !== 'club') assert.equal(view.members[0].name, '社員姓名');
    }
    for (const request of [
      { data: { groupId: 'club', schoolId: 'school' } },
      { auth: { uid: 'outsider' }, data: { groupId: 'club', schoolId: 'school' } },
      { auth: { uid: 'student' }, data: { groupId: 'club', schoolId: 'other' } },
    ])
      await assert.rejects(run(request));
    await db.doc('groups/existing-club/members/student').update({ status: 'left' });
    await assert.rejects(
      run({ auth: { uid: 'student' }, data: { groupId: 'existing-club', schoolId: 'school' } }),
    );
    await db.doc('schools/school/members/student').update({ status: 'inactive' });
    await assert.rejects(
      run({ auth: { uid: 'student' }, data: { groupId: 'club', schoolId: 'school' } }),
    );
    await db.doc('schools/school/members/student').update({ status: 'active' });
  } finally {
    await db.terminate();
  }
});
