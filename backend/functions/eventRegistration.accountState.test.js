'use strict';

const { createAccountGuardedOnCall } = require('./accountLifecycle');
const { createEventRegistrationHandlers, normalizeRegistrationPolicy } = require('./eventRegistration');
const { transactionStore } = require('./testSupport/transactionStore');

const uid = 'alice';
const accountPath = `users/${uid}`;
const eventPath = 'schools/pu/clubEvents/one';
const registrationPath = `${eventPath}/registrations/${uid}`;
const now = Date.parse('2030-06-01T00:00:00Z');
const operations = ['registerCampusEvent', 'cancelCampusEventRegistration', 'getEventRegistrations'];
const blockedProfiles = [
  ...['disabled', 'suspended', 'inactive', 'deleted'].map((status) => [status, { status }]),
  ['deletion marker', { status: 'active', accountDeletionInProgress: true }],
];

function request(operation) {
  return {
    auth: { uid },
    data: operation === 'getEventRegistrations'
      ? { schoolId: 'pu', eventIds: ['one'] }
      : { schoolId: 'pu', eventId: 'one', requestId: operation === 'registerCampusEvent'
        ? 'register-attempt-0001' : 'cancel-attempt-000001' },
  };
}

function fixture(profile = { status: 'active' }) {
  const policy = normalizeRegistrationPolicy({
    enabled: true, eligibility: 'active-school-members', free: true,
    opensAt: '2030-05-01T00:00:00Z', closesAt: '2030-07-01T00:00:00Z',
    allowCancellation: true, cancellationClosesAt: '2030-07-02T00:00:00Z',
  }, undefined, '2030-07-03T00:00:00Z');
  const store = transactionStore([
    ...(profile === null ? [] : [[accountPath, profile]]),
    ['schools/pu/members/alice', { status: 'active' }],
    [eventPath, { schoolId: 'pu', capacity: 2, appRegistrationCount: 0, registrationPolicy: policy }],
  ]);
  const admissionReads = [];
  // Observe the real admission read without replacing its account-state policy.
  const admissionDb = {
    collection: (name) => ({
      doc: (id) => ({
        get: async () => {
          const snapshot = await store.db.collection(name).doc(id).get();
          admissionReads.push({ path: `${name}/${id}`, exists: snapshot.exists, data: snapshot.data() });
          return snapshot;
        },
      }),
    }),
  };
  const onCall = createAccountGuardedOnCall({
    onCall: (_options, handler) => handler,
    getDb: () => admissionDb,
  });
  const handlers = createEventRegistrationHandlers({ db: store.db, now: () => now });
  const invoke = (operation) => onCall({}, handlers[operation])(request(operation));
  return { store, admissionReads, invoke };
}

async function prepare(operation, profile) {
  const setup = fixture(profile);
  if (operation !== 'registerCampusEvent') await setup.invoke('registerCampusEvent');
  setup.admissionReads.length = 0;
  return setup;
}

function receiptCount(store) {
  return [...store.docs.keys()].filter((path) => path.startsWith('eventRegistrationRequests/')).length;
}

function expectActiveAdmission(setup) {
  expect(setup.admissionReads).toEqual([
    { path: accountPath, exists: true, data: { status: 'active' } },
  ]);
}

describe.each(operations)('%s account state at transaction time', (operation) => {
  test.each(blockedProfiles)('rejects %s appearing after successful admission without changing service records', async (_label, profile) => {
    const setup = await prepare(operation);
    const before = new Map(setup.store.docs);
    const transact = setup.store.db.runTransaction.bind(setup.store.db);
    let attempts = 0;
    setup.store.db.runTransaction = (callback) => {
      attempts += 1;
      expectActiveAdmission(setup);
      setup.store.docs.set(accountPath, profile);
      return transact(callback);
    };

    await expect(setup.invoke(operation)).rejects.toMatchObject({ code: 'permission-denied' });

    expect(attempts).toBe(1);
    expectActiveAdmission(setup);
    expect(setup.store.docs).toEqual(new Map(before).set(accountPath, profile));
    expect(setup.store.docs.get(eventPath).appRegistrationCount).toBe(operation === 'registerCampusEvent' ? 0 : 1);
    expect(receiptCount(setup.store)).toBe(operation === 'registerCampusEvent' ? 0 : 1);
  });

  test.each([
    ['active', { status: 'active' }], ['legacy', { displayName: 'Alice' }], ['missing', null],
  ])('preserves %s profile compatibility through the real admission and handler', async (_label, profile) => {
    const setup = await prepare(operation, profile);
    const before = new Map(setup.store.docs);

    const result = await setup.invoke(operation);

    expect(result.ok).toBe(true);
    expect(setup.admissionReads).toEqual([
      { path: accountPath, exists: profile !== null, data: profile === null ? undefined : profile },
    ]);
    if (operation === 'getEventRegistrations') {
      expect(result.states[0]).toMatchObject({ status: 'registered', count: 1 });
      expect(setup.store.docs).toEqual(before);
    } else {
      const cancelled = operation === 'cancelCampusEventRegistration';
      expect(result.state).toMatchObject({ status: cancelled ? 'cancelled' : 'registered', count: cancelled ? 0 : 1 });
      expect(setup.store.docs.get(registrationPath).status).toBe(cancelled ? 'cancelled' : 'registered');
      expect(receiptCount(setup.store)).toBe(cancelled ? 2 : 1);
    }
  });

  test('an unavailable account read after admission propagates without any partial service write', async () => {
    const setup = await prepare(operation);
    const before = new Map(setup.store.docs);
    const failure = new Error('account-source-unavailable');
    const transact = setup.store.db.runTransaction.bind(setup.store.db);
    let accountReadAttempted = false;
    setup.store.db.runTransaction = (callback) => transact((transaction) => callback({
      ...transaction,
      getAll: async (...references) => {
        if (references.some((reference) => reference.path === accountPath)) {
          accountReadAttempted = true;
          throw failure;
        }
        return transaction.getAll(...references);
      },
    }));

    await expect(setup.invoke(operation)).rejects.toBe(failure);

    expectActiveAdmission(setup);
    expect(accountReadAttempted).toBe(true);
    expect(setup.store.docs).toEqual(before);
  });
});

describe.each(['registerCampusEvent', 'cancelCampusEventRegistration'])('%s successful receipt replay', (operation) => {
  test.each(blockedProfiles)('does not return success for an old receipt after %s appears during admission', async (_label, profile) => {
    const setup = await prepare(operation);
    await setup.invoke(operation);
    setup.admissionReads.length = 0;
    const before = new Map(setup.store.docs);
    const transact = setup.store.db.runTransaction.bind(setup.store.db);
    setup.store.db.runTransaction = (callback) => {
      expectActiveAdmission(setup);
      setup.store.docs.set(accountPath, profile);
      return transact(callback);
    };

    await expect(setup.invoke(operation)).rejects.toMatchObject({ code: 'permission-denied' });

    expectActiveAdmission(setup);
    expect(setup.store.docs).toEqual(new Map(before).set(accountPath, profile));
  });

  test('a still-active account can replay a successful receipt without another write', async () => {
    const setup = await prepare(operation);
    const first = await setup.invoke(operation);
    setup.admissionReads.length = 0;
    const before = new Map(setup.store.docs);

    const repeated = await setup.invoke(operation);

    expect(repeated).toMatchObject({ ok: true, reused: true, state: first.state });
    expectActiveAdmission(setup);
    expect(setup.store.docs).toEqual(before);
  });
});
