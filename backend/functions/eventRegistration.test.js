const { Timestamp } = require('firebase-admin/firestore');
const {
  createEventRegistrationHandlers,
  prepareRegistrationPolicy,
  normalizeRegistrationPolicy,
} = require('./eventRegistration');
const { transactionStore } = require('./testSupport/transactionStore');
const now = Date.parse('2030-06-01T00:00:00Z');
const policyInput = {
  enabled: true,
  eligibility: 'active-school-members',
  free: true,
  opensAt: '2030-05-01T00:00:00Z',
  closesAt: '2030-07-01T00:00:00Z',
  allowCancellation: true,
  cancellationClosesAt: '2030-07-02T00:00:00Z',
};
const policy = () => normalizeRegistrationPolicy(policyInput, undefined, '2030-07-03T00:00:00Z');
const path = 'schools/pu/clubEvents/one';
let store, handlers;
const request = (requestId = 'registration-attempt-0001', data = {}, uid = 'alice') => ({
  auth: { uid },
  data: { schoolId: 'pu', eventId: 'one', requestId, ...data },
});
beforeEach(() => {
  store = transactionStore([
    ['schools/pu/members/alice', { status: 'active' }],
    [path, { schoolId: 'pu', capacity: 1, appRegistrationCount: 0, registrationPolicy: policy() }],
  ]);
  handlers = createEventRegistrationHandlers({ db: store.db, now: () => now });
});
test('registration and cancellation maintain one authoritative count, independent of legacy counters', async () => {
  store.docs.get(path).registeredCount = 99;
  const response = await handlers.registerCampusEvent(request());
  expect(response.state).toMatchObject({ status: 'registered', count: 1, availability: 'full' });
  expect(store.docs.get(path).registeredCount).toBe(99);
  expect(store.docs.get(`${path}/registrations/alice`)).toMatchObject({
    status: 'registered',
    userId: 'alice',
  });
  expect(
    (await handlers.cancelCampusEventRegistration(request('cancellation-attempt-01'))).state,
  ).toMatchObject({ status: 'cancelled', count: 0 });
});
test('retrying a registration receipt after a later cancellation never re-registers the user', async () => {
  await handlers.registerCampusEvent(request());
  await handlers.cancelCampusEventRegistration(request('cancellation-attempt-01'));
  const replay = await handlers.registerCampusEvent(request());
  expect(replay).toMatchObject({ reused: true, state: { status: 'cancelled', count: 0 } });
});
test('same action with new request ID is also idempotent and receipt IDs cannot change action', async () => {
  await handlers.registerCampusEvent(request());
  expect(await handlers.registerCampusEvent(request('registration-attempt-0002'))).toMatchObject({
    reused: true,
    state: { count: 1 },
  });
  await expect(handlers.cancelCampusEventRegistration(request())).rejects.toMatchObject({
    code: 'already-exists',
  });
});
test.each(['member', 'missing', 'unconfigured', 'full', 'closed', 'future', 'fee', 'counter'])(
  'rejects %s state without creating a registration or receipt',
  async (kind) => {
    const event = store.docs.get(path);
    if (kind === 'member') store.docs.set('schools/pu/members/alice', { status: 'inactive' });
    if (kind === 'missing') store.docs.delete(path);
    if (kind === 'unconfigured') delete event.registrationPolicy;
    if (kind === 'full') event.appRegistrationCount = 1;
    if (kind === 'closed') event.registrationPolicy.closesAt = Timestamp.fromMillis(now);
    if (kind === 'future') event.registrationPolicy.opensAt = Timestamp.fromMillis(now + 1);
    if (kind === 'fee') event.fee = 1;
    if (kind === 'counter') delete event.appRegistrationCount;
    await expect(handlers.registerCampusEvent(request())).rejects.toThrow();
    expect(store.docs.has(`${path}/registrations/alice`)).toBe(false);
    expect([...store.docs.keys()].some((key) => key.startsWith('eventRegistrationRequests/'))).toBe(
      false,
    );
  },
);
test('member revocation rejects even a previously successful receipt', async () => {
  await handlers.registerCampusEvent(request());
  store.docs.set('schools/pu/members/alice', { status: 'inactive' });
  await expect(handlers.registerCampusEvent(request())).rejects.toMatchObject({
    code: 'permission-denied',
  });
});
test('closing intake does not silently remove the existing cancellation window', async () => {
  await handlers.registerCampusEvent(request());
  store.docs.get(path).registrationPolicy.enabled = false;
  expect(
    (await handlers.cancelCampusEventRegistration(request('cancel-attempt-0001'))).state.status,
  ).toBe('cancelled');
});
test('cancellation is refused at its exact server deadline', async () => {
  await handlers.registerCampusEvent(request());
  store.docs.get(path).registrationPolicy.cancellationClosesAt = Timestamp.fromMillis(now);
  await expect(
    handlers.cancelCampusEventRegistration(request('cancel-attempt-0001')),
  ).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(store.docs.get(path).appRegistrationCount).toBe(1);
});
test('failed commit changes neither record nor count and can retry the same ID', async () => {
  store.failNextCommit();
  await expect(handlers.registerCampusEvent(request())).rejects.toThrow('commit unavailable');
  expect(store.docs.get(path).appRegistrationCount).toBe(0);
  expect((await handlers.registerCampusEvent(request())).state.count).toBe(1);
});
test('status reads expose only the requesting member and canonical event', async () => {
  await handlers.registerCampusEvent(request());
  expect(
    await handlers.getEventRegistrations({
      auth: { uid: 'alice' },
      data: { schoolId: 'pu', eventIds: ['one', 'missing'] },
    }),
  ).toMatchObject({
    ok: true,
    states: [
      { eventId: 'one', status: 'registered' },
      { eventId: 'missing', availability: 'unavailable' },
    ],
  });
  await expect(
    handlers.registerCampusEvent(request(undefined, { userId: 'bob' })),
  ).rejects.toMatchObject({ code: 'invalid-argument' });
});
test.each([
  { free: false },
  { eligibility: 'everyone' },
  { closesAt: 'invalid' },
  { closesAt: '2030-08-01T00:00:00Z' },
  { opensAt: '2030-07-01T00:00:00Z' },
  { cancellationClosesAt: '2030-08-01T00:00:00Z' },
  { cancellationClosesAt: null },
])('explicit policy rejects invalid setting %j', (patch) => {
  expect(() =>
    normalizeRegistrationPolicy({ ...policyInput, ...patch }, undefined, '2030-07-03T00:00:00Z'),
  ).toThrow();
});
const prepare = (previous = {}, input = policyInput, capacity = 5) =>
  store.db.runTransaction((transaction) =>
    prepareRegistrationPolicy({
      db: store.db,
      transaction,
      schoolId: 'pu',
      eventId: 'one',
      previous,
      input,
      startsAt: '2030-07-03T00:00:00Z',
      capacity,
    }),
  );
test('first opt-in creates a separate zero counter only after checking all old registration sources', async () => {
  expect(await prepare({ registeredCount: 0 })).toMatchObject({
    appRegistrationCount: 0,
    registrationPolicy: { enabled: true },
  });
  expect(await prepare({}, { enabled: false })).toEqual({
    registrationPolicy: { version: 1, enabled: false },
  });
});
test.each([
  'schools/pu/events/one/registrations/old',
  'schools/pu/clubEvents/one/registrations/old',
  'events/one/registrations/old',
  'eventRegistrations/old',
])('unknown old source %s prevents counter initialization', async (oldPath) => {
  store.docs.set(oldPath, { eventId: 'one' });
  await expect(prepare()).rejects.toMatchObject({ code: 'failed-precondition' });
});
test.each([10, -1, '0'])('unknown legacy count %j is never adopted', async (registeredCount) => {
  await expect(prepare({ registeredCount })).rejects.toThrow();
});
test('capacity cannot be lowered below current controlled count', async () => {
  await expect(
    prepare({ appRegistrationCount: 3, registrationPolicy: policy() }, undefined, 2),
  ).rejects.toThrow();
});
test('active participants keep accepted deadlines while intake can be closed', async () => {
  const previous = { appRegistrationCount: 1, registrationPolicy: policy() };
  await expect(prepare(previous, { ...policyInput, allowCancellation: false })).rejects.toThrow(
    '不可更改',
  );
  expect(await prepare(previous, { enabled: false })).toMatchObject({
    appRegistrationCount: 1,
    registrationPolicy: { enabled: false, allowCancellation: true },
  });
});
test('account deletion marker blocks new registrations without changing the seat count', async () => {
  store.docs.set('users/alice', { accountDeletionInProgress: true });
  await expect(handlers.registerCampusEvent(request())).rejects.toMatchObject({
    code: 'permission-denied',
  });
  expect(store.docs.get(path).appRegistrationCount).toBe(0);
});
