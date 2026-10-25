const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');

let env;
const school = 'schools/pu';
const serviceRecords = [
  { collection: 'repairRequests', domain: 'repairs', ownerField: 'userId' },
  { collection: 'packages', domain: 'packages', ownerField: 'recipientId' },
  { collection: 'printJobs', domain: 'printing', ownerField: 'userId' },
  { collection: 'healthAppointments', domain: 'health', ownerField: 'userId' },
  { collection: 'healthRecords', domain: 'health', ownerField: 'userId' },
];

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-campus-school-responsibility',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore/firestore.rules'), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [uid, role] of [
      ['admin', 'admin'],
      ['editor', 'editor'],
      ['alice', 'member'],
    ]) {
      await db.doc(`${school}/members/${uid}`).set({ status: 'active', role });
    }
    await db.doc('schools/other/members/other-admin').set({ status: 'active', role: 'admin' });
    for (const domain of ['repairs', 'packages', 'printing', 'health']) {
      for (const [suffix, memberStatus, serviceStatus] of [
        ['staff', 'active', 'active'],
        ['suspended-member', 'inactive', 'active'],
        ['suspended-role', 'active', 'inactive'],
        ['pending-role', 'active', 'pending'],
      ]) {
        const uid = `${domain}-${suffix}`;
        await db.doc(`${school}/members/${uid}`).set({ status: memberStatus, role: 'member' });
        await db
          .doc(`${school}/serviceRoles/${uid}`)
          .set({ status: serviceStatus, [domain]: true });
      }
      await db
        .doc(`${school}/serviceRoles/${domain}-orphan`)
        .set({ status: 'active', [domain]: true });
      await db
        .doc(`schools/other/members/${domain}-other-school`)
        .set({ status: 'active', role: 'member' });
      await db
        .doc(`schools/other/serviceRoles/${domain}-other-school`)
        .set({ status: 'active', [domain]: true });
    }
    for (const { collection, ownerField } of serviceRecords) {
      await db.doc(`${school}/${collection}/one`).set({ [ownerField]: 'alice', status: 'pending' });
      await db.doc(`${school}/${collection}/two`).set({ [ownerField]: 'bob', status: 'pending' });
      await db
        .doc(`schools/other/${collection}/one`)
        .set({ [ownerField]: 'other-student', status: 'pending' });
    }
    await db
      .doc(`${school}/cafeterias/cafe`)
      .set({ name: '學生餐廳', orderingEnabled: false, pilotStatus: 'inactive' });
    await db
      .doc(`${school}/cafeterias/cafe/operators/merchant`)
      .set({ status: 'active', role: 'owner' });
    await db
      .doc(`${school}/orders/one`)
      .set({ userId: 'alice', cafeteriaId: 'cafe', status: 'pending' });
    for (const collection of ['libraryLoans', 'seatReservations', 'washingReservations']) {
      await db.doc(`${school}/${collection}/one`).set({ userId: 'alice' });
    }
    await db.doc(`${school}/adminLogs/one`).set({ action: 'update_service_role' });
    await db.doc(`${school}/events/one/registrations/alice`).set({ userId: 'alice' });
    await db.doc('users/alice/personalTimetable/current').set({ courseIds: ['private-course'] });
    await db.doc('users/alice/grades/one').set({ score: 80 });
    await db.doc(`${school}/members/teacher`).set({ status: 'active', role: 'member' });
    await db.doc(`${school}/members/assigned-editor`).set({ status: 'active', role: 'editor' });
    await db.doc(`${school}/members/assigned-inactive`).set({ status: 'inactive', role: 'member' });
    await db
      .doc('schools/other/members/assigned-other-school')
      .set({ status: 'active', role: 'member' });
    await db.doc(`${school}/members/other-teacher`).set({ status: 'active', role: 'teacher' });
    const assignedTeachers = [
      'teacher',
      'assigned-editor',
      'assigned-inactive',
      'assigned-other-school',
    ];
    await db.doc(`${school}/courseTeachers/math`).set({ teacherUids: assignedTeachers });
    await db
      .doc(`${school}/courseRosters/math`)
      .set({ accessUids: ['alice', ...assignedTeachers] });
    await db
      .doc('courseAppeals/math')
      .set({ schoolId: 'pu', studentUid: 'alice', offeringId: 'math', status: 'pending' });
  });
});

after(async () => {
  if (env) await env.cleanup();
});

for (const { collection, domain, ownerField } of serviceRecords) {
  test(`${collection}: only its owner, school admin, and active assigned school staff can read`, async () => {
    for (const uid of ['alice', 'admin', `${domain}-staff`]) {
      await assertSucceeds(
        env.authenticatedContext(uid).firestore().doc(`${school}/${collection}/one`).get(),
      );
    }
    for (const uid of [
      'editor',
      'bob',
      'other-admin',
      `${domain}-suspended-member`,
      `${domain}-suspended-role`,
      `${domain}-pending-role`,
      `${domain}-orphan`,
      `${domain}-other-school`,
      domain === 'health' ? 'packages-staff' : 'health-staff',
    ]) {
      await assertFails(
        env.authenticatedContext(uid).firestore().doc(`${school}/${collection}/one`).get(),
      );
    }
    await assertFails(
      env.unauthenticatedContext().firestore().doc(`${school}/${collection}/one`).get(),
    );
    await assertFails(
      env
        .authenticatedContext(`${domain}-staff`)
        .firestore()
        .doc(`schools/other/${collection}/one`)
        .get(),
    );

    // Staff dashboards may query their assigned service; students must scope to their own record.
    const staff = env.authenticatedContext(`${domain}-staff`).firestore();
    assert.equal((await assertSucceeds(staff.collection(`${school}/${collection}`).get())).size, 2);
    const alice = env.authenticatedContext('alice').firestore();
    await assertSucceeds(
      alice.collection(`${school}/${collection}`).where(ownerField, '==', 'alice').get(),
    );
    await assertFails(alice.collection(`${school}/${collection}`).get());
    await assertFails(
      env.authenticatedContext('editor').firestore().collection(`${school}/${collection}`).get(),
    );

    // Client writes remain prohibited so callable validation and state transitions stay authoritative.
    for (const uid of ['alice', 'admin', `${domain}-staff`]) {
      const db = env.authenticatedContext(uid).firestore();
      await assertFails(db.doc(`${school}/${collection}/new`).set({ [ownerField]: uid }));
      await assertFails(db.doc(`${school}/${collection}/one`).update({ status: 'approved' }));
      await assertFails(db.doc(`${school}/${collection}/one`).delete());
    }
  });
}

test('revoking a staff assignment removes access immediately; an editor requires a separate service assignment', async () => {
  const editor = env.authenticatedContext('editor').firestore();
  await assertFails(editor.doc(`${school}/healthRecords/one`).get());
  await env.withSecurityRulesDisabled((context) =>
    context
      .firestore()
      .doc(`${school}/serviceRoles/editor`)
      .set({ status: 'active', health: true }),
  );
  await assertSucceeds(editor.doc(`${school}/healthRecords/one`).get());
  await assertFails(editor.doc(`${school}/packages/one`).get());
  await env.withSecurityRulesDisabled((context) =>
    context.firestore().doc(`${school}/serviceRoles/editor`).update({ status: 'inactive' }),
  );
  await assertFails(editor.doc(`${school}/healthRecords/one`).get());
});

test('only school admins can configure public school service resources', async () => {
  const editor = env.authenticatedContext('editor').firestore();
  const admin = env.authenticatedContext('admin').firestore();
  for (const [collection, value] of [
    ['menus', { name: '午餐', cafeteriaId: 'cafe', schoolId: 'pu' }],
    ['cafeteriaMenus', { name: '午餐', cafeteriaId: 'cafe', schoolId: 'pu' }],
    ['libraryBooks', { title: '館藏' }],
    ['librarySeats', { name: '座位' }],
    ['washingMachines', { name: '洗衣機' }],
    ['printers', { name: '印表機' }],
    ['healthTimeSlots', { capacity: 1 }],
    ['busRoutes', { name: '校車' }],
  ]) {
    const doc = `${school}/${collection}/new`;
    await assertFails(editor.doc(doc).set(value));
    await assertSucceeds(admin.doc(doc).set(value));
    await assertFails(editor.doc(doc).update(value));
    await assertSucceeds(admin.doc(doc).update(value));
    await assertFails(editor.doc(doc).delete());
    await assertSucceeds(admin.doc(doc).delete());
  }
  for (const uid of ['admin', 'editor', 'health-staff']) {
    await assertFails(
      env
        .authenticatedContext(uid)
        .firestore()
        .doc(`${school}/serviceRoles/new`)
        .set({ status: 'active', health: true }),
    );
  }
});

test('cafeteria governance and operator assignments require audited callables, including for school admins', async () => {
  const operator = `${school}/cafeterias/cafe/operators/merchant`;
  for (const uid of ['admin', 'editor', 'merchant', 'health-staff']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(db.doc(`${school}/cafeterias/new`).set({ name: '新餐廳' }));
    await assertFails(
      db.doc(`${school}/cafeterias/cafe`).update({ name: '新名稱', orderingEnabled: true }),
    );
    await assertFails(db.doc(`${school}/cafeterias/cafe`).update({ activeOperatorCount: 99 }));
    await assertFails(db.doc(`${school}/cafeterias/cafe`).delete());
    await assertFails(
      db.doc(`${school}/cafeterias/cafe/operators/new`).set({ status: 'active', role: 'owner' }),
    );
    await assertFails(db.doc(operator).update({ status: 'inactive' }));
    await assertFails(db.doc(operator).delete());
    if (uid === 'admin' || uid === 'merchant') await assertSucceeds(db.doc(operator).get());
    else await assertFails(db.doc(operator).get());
  }
  // A school admin without a merchant assignment does not inherit storefront write access.
  await assertFails(
    env
      .authenticatedContext('admin')
      .firestore()
      .doc(`${school}/cafeterias/cafe`)
      .update({ intro: '直接變更' }),
  );
});

test('ordinary editors cannot browse students or official service receipts; event registration authority remains scoped', async () => {
  for (const record of ['orders', 'libraryLoans', 'seatReservations', 'washingReservations']) {
    const target = `${school}/${record}/one`;
    await assertFails(env.authenticatedContext('editor').firestore().doc(target).get());
    await assertSucceeds(env.authenticatedContext('admin').firestore().doc(target).get());
    await assertSucceeds(env.authenticatedContext('alice').firestore().doc(target).get());
  }
  for (const target of [
    `${school}/members/alice`,
    `${school}/serviceRoles/health-staff`,
    `${school}/adminLogs/one`,
  ]) {
    await assertFails(env.authenticatedContext('editor').firestore().doc(target).get());
    await assertSucceeds(env.authenticatedContext('admin').firestore().doc(target).get());
  }
  await assertSucceeds(
    env.authenticatedContext('health-staff').firestore().doc(`${school}/members/alice`).get(),
  );
  await assertFails(
    env
      .authenticatedContext('health-suspended-member')
      .firestore()
      .doc(`${school}/members/alice`)
      .get(),
  );
  await assertSucceeds(
    env
      .authenticatedContext('editor')
      .firestore()
      .doc(`${school}/events/one/registrations/alice`)
      .get(),
  );
  await assertFails(
    env
      .authenticatedContext('editor')
      .firestore()
      .doc('schools/other/events/one/registrations/alice')
      .get(),
  );
});

test('external merchant identity retains its assigned storefront without inheriting school governance', async () => {
  const merchant = env.authenticatedContext('merchant').firestore();
  await assertSucceeds(merchant.doc(`${school}/cafeterias/cafe`).update({ intro: '本週供餐資訊' }));
  await assertSucceeds(merchant.doc(`${school}/orders/one`).get());
  await assertFails(merchant.doc(`${school}/healthRecords/one`).get());
  await assertFails(
    merchant.doc(`${school}/cafeterias/cafe/operators/outsider`).set({ status: 'active' }),
  );
});

test('school administrators and service staff cannot open personal student timetable or grades', async () => {
  for (const target of ['users/alice/personalTimetable/current', 'users/alice/grades/one']) {
    await assertSucceeds(env.authenticatedContext('alice').firestore().doc(target).get());
    for (const uid of ['admin', 'editor', 'health-staff']) {
      await assertFails(env.authenticatedContext(uid).firestore().doc(target).get());
    }
  }
});

test('official course authority belongs to school admin and assigned teachers, preserving student access', async () => {
  const editor = env.authenticatedContext('editor').firestore();
  const admin = env.authenticatedContext('admin').firestore();
  const teacher = env.authenticatedContext('teacher').firestore();
  const alice = env.authenticatedContext('alice').firestore();
  const roster = `${school}/courseRosters/math`;
  const assignment = `${school}/courseTeachers/math`;
  for (const target of [roster, assignment, 'courseAppeals/math']) {
    await assertFails(editor.doc(target).get());
    await assertSucceeds(admin.doc(target).get());
    await assertSucceeds(teacher.doc(target).get());
    await assertSucceeds(env.authenticatedContext('assigned-editor').firestore().doc(target).get());
    for (const uid of ['other-teacher', 'assigned-inactive', 'assigned-other-school']) {
      await assertFails(env.authenticatedContext(uid).firestore().doc(target).get());
    }
  }
  await assertSucceeds(alice.doc(roster).get());
  await assertSucceeds(alice.doc('courseAppeals/math').get());
  await assertFails(alice.doc(assignment).get());
  for (const uid of ['editor', 'teacher', 'assigned-editor', 'alice']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(db.doc(assignment).update({ teacherUids: ['editor'] }));
    await assertFails(db.doc(roster).update({ accessUids: ['editor'] }));
  }
  await assertFails(
    editor.doc('courseAppeals/math').update({ status: 'approved', teacherNote: '未授權處理' }),
  );
  await assertSucceeds(
    teacher.doc('courseAppeals/math').update({ status: 'reviewing', teacherNote: '檢視中' }),
  );
  await assertSucceeds(
    env
      .authenticatedContext('assigned-editor')
      .firestore()
      .doc('courseAppeals/math')
      .update({ status: 'reviewing', teacherNote: '已收到' }),
  );
  await assertFails(teacher.doc('courseAppeals/math').update({ studentUid: 'teacher' }));
  await assertSucceeds(admin.doc(assignment).update({ teacherUids: ['teacher'] }));
  await assertFails(
    env.authenticatedContext('assigned-editor').firestore().doc('courseAppeals/math').get(),
  );
  await assertSucceeds(
    admin.doc('courseAppeals/math').update({ status: 'approved', teacherNote: '已處理' }),
  );
});
