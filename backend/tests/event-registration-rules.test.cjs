const { before, beforeEach, after, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-campus-event-rules',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore/firestore.rules'), 'utf8'),
    },
  });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('schools/pu/members/alice').set({ status: 'active', role: 'member' });
    await db.doc('schools/pu/members/editor').set({ status: 'active', role: 'editor' });
    await db.doc('schools/pu/clubEvents/one').set({ appRegistrationCount: 1, schoolId: 'pu' });
    await db
      .doc('schools/pu/clubEvents/one/registrations/alice')
      .set({ userId: 'alice', status: 'registered' });
    await db.doc('schools/pu/events/one/registrations/alice').set({ userId: 'alice' });
    await db.doc('eventRegistrationRequests/one').set({ userId: 'alice' });
  });
});
after(async () => {
  await env.cleanup();
});
test('only active owner or school editor can read managed registrations, and no client can forge state or count', async () => {
  for (const uid of ['alice', 'editor', 'outsider']) {
    const db = env.authenticatedContext(uid).firestore();
    const registration = db.doc('schools/pu/clubEvents/one/registrations/alice');
    if (uid === 'outsider') await assertFails(registration.get());
    else await assertSucceeds(registration.get());
    await assertFails(registration.set({ userId: uid, status: 'registered' }));
    await assertFails(registration.delete());
    await assertFails(
      db.doc(`schools/pu/clubEvents/one/registrations/${uid}`).set({ userId: uid }),
    );
    await assertFails(
      db.doc('schools/pu/clubEvents/one').update({ appRegistrationCount: 0, registeredCount: 0 }),
    );
    await assertFails(db.doc(`schools/pu/events/one/registrations/${uid}`).set({ userId: uid }));
    await assertFails(db.doc('schools/pu/events/one/registrations/alice').delete());
    await assertFails(db.doc('eventRegistrationRequests/one').get());
    await assertFails(db.doc('eventRegistrationRequests/one').set({ userId: uid }));
  }
});
test('revoked membership loses private registration reads', async () => {
  await env.withSecurityRulesDisabled((context) =>
    context.firestore().doc('schools/pu/members/alice').update({ status: 'inactive' }),
  );
  await assertFails(
    env
      .authenticatedContext('alice')
      .firestore()
      .doc('schools/pu/clubEvents/one/registrations/alice')
      .get(),
  );
  await assertFails(
    env
      .unauthenticatedContext()
      .firestore()
      .doc('schools/pu/clubEvents/one/registrations/alice')
      .get(),
  );
});
