jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: jest.fn(),
}));

const https = require('https');
const { getFirestore } = require('firebase-admin/firestore');
const database = { collection: jest.fn(), runTransaction: jest.fn(), batch: jest.fn() };
getFirestore.mockReturnValue(database);

// Invoke the actual deployed handlers with the actual paused policy.
const { signInPuStudentId, puAuthenticate } = require('./index');
const {
  PU_ECAMPUS_DATA_PAUSED_CODE,
  PU_ECAMPUS_DATA_PAUSED_MESSAGE,
} = require('./generated/shared/puEcampusDataPolicy');

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    on: jest.fn(),
    setHeader(key, value) { this.headers[key] = value; },
    getHeader(key) { return this.headers[key]; },
    set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  database.collection.mockImplementation((name) => {
    if (name === 'users') return { doc: () => ({ get: async () => ({ exists: false }) }) };
    throw new Error('A paused login must not access sessions or imported data');
  });
  jest.spyOn(https, 'request').mockImplementation(() => {
    throw new Error('A paused login must not contact the school');
  });
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('A paused login must not contact a relay'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

function expectNoSessionOrNetworkActivity() {
  // The callable account-lifecycle guard may read users before the handler.
  expect(database.collection.mock.calls.every(([name]) => name === 'users')).toBe(true);
  expect(database.runTransaction).not.toHaveBeenCalled();
  expect(database.batch).not.toHaveBeenCalled();
  expect(https.request).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
}

test('HTTP student login reports a temporary pause, not incorrect credentials', async () => {
  const response = responseRecorder();
  await signInPuStudentId({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { studentId: '412345678', password: 'fixture-password', schoolId: 'pu' },
  }, response);

  expect(response.statusCode).toBe(503);
  expect(response.headers['Cache-Control']).toBe('no-store');
  expect(response.body).toEqual({
    error: PU_ECAMPUS_DATA_PAUSED_MESSAGE,
    code: PU_ECAMPUS_DATA_PAUSED_CODE,
  });
  expectNoSessionOrNetworkActivity();
});

test('callable authentication reports unavailable and leaves existing sessions untouched', async () => {
  await expect(puAuthenticate.run({
    auth: { uid: 'alice' },
    data: { uid: '412345679', upassword: 'fixture-password' },
  })).rejects.toMatchObject({
    code: 'unavailable',
    message: PU_ECAMPUS_DATA_PAUSED_MESSAGE,
    details: { code: PU_ECAMPUS_DATA_PAUSED_CODE },
  });
  expectNoSessionOrNetworkActivity();
});

test('callable authentication still rejects an anonymous request before processing a login', async () => {
  await expect(puAuthenticate.run({
    data: { uid: '412345679', upassword: 'fixture-password' },
  })).rejects.toMatchObject({ code: 'unauthenticated' });
  expectNoSessionOrNetworkActivity();
});
