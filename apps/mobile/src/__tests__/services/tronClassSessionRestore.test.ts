const mockSecureGetItem = jest.fn();
const mockSecureSetItem = jest.fn();
const mockSecureDeleteItem = jest.fn();
const mockLegacyGetItem = jest.fn();
const mockLegacyRemoveItem = jest.fn();
const mockAuthHeaders = jest.fn();

jest.mock('../../services/secureStorage', () => ({
  secureGetItem: (...args: unknown[]) => mockSecureGetItem(...args),
  secureSetItem: (...args: unknown[]) => mockSecureSetItem(...args),
  secureDeleteItem: (...args: unknown[]) => mockSecureDeleteItem(...args),
  secureDeleteMany: jest.fn(async () => undefined),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (...args: unknown[]) => mockLegacyGetItem(...args),
    removeItem: (...args: unknown[]) => mockLegacyRemoveItem(...args),
    setItem: jest.fn(async () => undefined),
  },
}));
jest.mock('../../services/cloudFunctions', () => ({
  getCloudFunctionUrl: (name: string) => `https://functions.test/${name}`,
  getFirebaseAuthHeaders: () => mockAuthHeaders(),
}));

const SESSION_KEY = '@pu_cache:tc_backend_session';
const oldSession = JSON.stringify({ sessionId: 'old-session', userId: 17 });
const nextSession = JSON.stringify({ sessionId: 'next-session', userId: 23 });
let client: typeof import('../../services/tronClassClient');
let secureValue: string | null;
let legacyValue: string | null;
const originalFetch = globalThis.fetch;
const mockFetch = jest.fn();
let expectedRequests: number;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.resetModules();
  secureValue = null;
  legacyValue = null;
  mockSecureGetItem.mockReset().mockImplementation(async () => secureValue);
  mockSecureSetItem.mockReset().mockImplementation(async (_key: string, value: string) => {
    secureValue = value;
  });
  mockSecureDeleteItem.mockReset().mockImplementation(async () => {
    secureValue = null;
  });
  mockLegacyGetItem.mockReset().mockImplementation(async () => legacyValue);
  mockLegacyRemoveItem.mockReset().mockImplementation(async () => {
    legacyValue = null;
  });
  mockAuthHeaders.mockReset().mockResolvedValue({});
  mockFetch.mockReset().mockRejectedValue(new Error('Unexpected network request'));
  expectedRequests = 0;
  globalThis.fetch = mockFetch;
  client = require('../../services/tronClassClient');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  expect(mockFetch).toHaveBeenCalledTimes(expectedRequests);
});

test('parallel readers wait for the same stored session instead of reporting a missing connection', async () => {
  const read = deferred<string | null>();
  mockSecureGetItem.mockReturnValueOnce(read.promise);
  const first = client.getTCBackendSessionId();
  let secondSettled = false;
  const second = client.hasTCSession().then((present) => {
    secondSettled = true;
    return present;
  });
  await Promise.resolve();
  await Promise.resolve();
  const settledBeforeRead = secondSettled;
  read.resolve(oldSession);

  await expect(first).resolves.toBe('old-session');
  await expect(second).resolves.toBe(true);
  expect(settledBeforeRead).toBe(false);
  expect(mockSecureGetItem).toHaveBeenCalledTimes(1);
  expect(mockSecureGetItem).toHaveBeenCalledWith(SESSION_KEY);
});

test('a secure storage read completing after logout cannot restore the old session', async () => {
  const read = deferred<string | null>();
  mockSecureGetItem.mockReturnValueOnce(read.promise);
  const restoring = client.getTCBackendSessionId();

  await client.clearTCSession();
  read.resolve(oldSession);

  await expect(restoring).resolves.toBeNull();
  await expect(client.hasTCSession()).resolves.toBe(false);
  expect(secureValue).toBeNull();
  expect(mockSecureSetItem).not.toHaveBeenCalled();
});

test('a secure storage read cannot overwrite a more recent login', async () => {
  const read = deferred<string | null>();
  mockSecureGetItem.mockReturnValueOnce(read.promise);
  const restoring = client.getTCBackendSessionId();

  await client.setTCBackendSession('next-session', 23);
  read.resolve(oldSession);

  await expect(restoring).resolves.toBe('next-session');
  await expect(client.getTCBackendSessionId()).resolves.toBe('next-session');
  expect(secureValue).toBe(nextSession);
});

test.each([undefined, null, Number.NaN])('a new session without a valid user ID never inherits the previous user (%s)', async (userId) => {
  await client.setTCBackendSession('old-session', 17);
  await client.setTCBackendSession('next-session', userId);

  await expect(client.getTCBackendSessionId()).resolves.toBe('next-session');
  expect(JSON.parse(secureValue!)).toEqual({ sessionId: 'next-session', userId: null });
});

test('a legacy storage read completing after logout cannot migrate the old session back', async () => {
  const read = deferred<string | null>();
  const started = deferred<void>();
  mockLegacyGetItem.mockImplementationOnce(() => {
    started.resolve();
    return read.promise;
  });
  const restoring = client.getTCBackendSessionId();
  await started.promise;

  await client.clearTCSession();
  read.resolve(oldSession);

  await expect(restoring).resolves.toBeNull();
  expect(mockSecureSetItem).not.toHaveBeenCalled();
  expect(secureValue).toBeNull();
});

test('logout finishes after an in-flight legacy migration, leaving no stored session', async () => {
  const write = deferred<void>();
  const started = deferred<void>();
  legacyValue = oldSession;
  mockSecureSetItem.mockImplementationOnce(async (_key: string, value: string) => {
    started.resolve();
    await write.promise;
    secureValue = value;
  });
  const restoring = client.getTCBackendSessionId();
  await started.promise;

  const clearing = client.clearTCSession();
  write.resolve();
  await clearing;

  await expect(restoring).resolves.toBeNull();
  await expect(client.hasTCSession()).resolves.toBe(false);
  expect(secureValue).toBeNull();
  expect(legacyValue).toBeNull();
});

test('a slow session save cannot overwrite a later login in secure storage', async () => {
  const write = deferred<void>();
  const started = deferred<void>();
  mockSecureSetItem.mockImplementationOnce(async (_key: string, value: string) => {
    started.resolve();
    await write.promise;
    secureValue = value;
  });
  const saving = client.setTCBackendSession('old-session', 17);
  await started.promise;

  const replacing = client.setTCBackendSession('next-session', 23);
  write.resolve();
  await Promise.all([saving, replacing]);

  await expect(client.getTCBackendSessionId()).resolves.toBe('next-session');
  expect(secureValue).toBe(nextSession);
});

test('a slow logout cannot erase a later login from secure storage', async () => {
  const remove = deferred<void>();
  const started = deferred<void>();
  mockSecureDeleteItem.mockImplementationOnce(async () => {
    started.resolve();
    await remove.promise;
    secureValue = null;
  });
  const clearing = client.clearTCSession();
  await started.promise;

  const replacing = client.setTCBackendSession('next-session', 23);
  remove.resolve();
  await Promise.all([clearing, replacing]);

  await expect(client.getTCBackendSessionId()).resolves.toBe('next-session');
  expect(secureValue).toBe(nextSession);
});

test('a temporary secure storage failure permits another restore attempt', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockSecureGetItem.mockRejectedValueOnce(new Error('Keychain is temporarily unavailable'));
  secureValue = oldSession;
  try {
    await expect(client.hasTCSession()).resolves.toBe(false);
    await expect(client.getTCBackendSessionId()).resolves.toBe('old-session');
    expect(mockSecureGetItem).toHaveBeenCalledTimes(2);
  } finally {
    warning.mockRestore();
  }
});

test('a failed migration keeps the legacy copy available for a later launch', async () => {
  legacyValue = oldSession;
  mockSecureSetItem.mockRejectedValueOnce(new Error('Keychain write failed'));

  await expect(client.getTCBackendSessionId()).resolves.toBe('old-session');
  expect(legacyValue).toBe(oldSession);
  expect(mockLegacyRemoveItem).not.toHaveBeenCalled();
});

function response(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  } as Response;
}

test('changing the connection while reading auth headers prevents the stale request', async () => {
  const headers = deferred<Record<string, string>>();
  const started = deferred<void>();
  mockAuthHeaders.mockImplementationOnce(() => {
    started.resolve();
    return headers.promise;
  });
  await client.setTCBackendSession('old-session', 17);
  const reading = client.tcFetchProfile();
  const rejected = expect(reading).rejects.toThrow('課程連線已變更');
  await started.promise;

  await client.setTCBackendSession('next-session', 23);
  headers.resolve({});

  await rejected;
  expect(secureValue).toBe(nextSession);
});

test.each([200, 401])('a late HTTP %s response cannot change a newer session', async (status) => {
  const pending = deferred<Response>();
  const started = deferred<void>();
  mockFetch.mockImplementationOnce(() => {
    started.resolve();
    return pending.promise;
  });
  expectedRequests = 1;
  await client.setTCBackendSession('old-session', 17);
  const reading = client.tcFetchProfile();
  const rejected = expect(reading).rejects.toThrow('課程連線已變更');
  await started.promise;

  await client.setTCBackendSession('next-session', 23);
  pending.resolve(response(status, { success: status === 200, userId: 17, result: { id: 17 } }));

  await rejected;
  await expect(client.getTCBackendSessionId()).resolves.toBe('next-session');
  expect(secureValue).toBe(nextSession);
  expect(JSON.parse(mockFetch.mock.calls[0][1].body).sessionId).toBe('old-session');
});

test('a successful response arriving after logout cannot expose or persist the old account', async () => {
  const pending = deferred<Response>();
  const started = deferred<void>();
  mockFetch.mockImplementationOnce(() => {
    started.resolve();
    return pending.promise;
  });
  expectedRequests = 1;
  await client.setTCBackendSession('old-session', 17);
  const reading = client.tcFetchProfile();
  const rejected = expect(reading).rejects.toThrow('課程連線已變更');
  await started.promise;

  await client.clearTCSession();
  pending.resolve(response(200, { success: true, userId: 17, result: { id: 17 } }));

  await rejected;
  await expect(client.hasTCSession()).resolves.toBe(false);
  expect(secureValue).toBeNull();
});

test('logout waits for a profile save already in progress and then clears it', async () => {
  const write = deferred<void>();
  const started = deferred<void>();
  await client.setTCBackendSession('old-session', 17);
  mockSecureSetItem.mockImplementationOnce(async (_key: string, value: string) => {
    started.resolve();
    await write.promise;
    secureValue = value;
  });
  mockFetch.mockResolvedValueOnce(response(200, { success: true, userId: 17, result: { id: 17 } }));
  expectedRequests = 1;
  const reading = client.tcFetchProfile();
  const rejected = expect(reading).rejects.toThrow('課程連線已變更');
  await started.promise;

  const clearing = client.clearTCSession();
  write.resolve();
  await clearing;

  await rejected;
  await expect(client.hasTCSession()).resolves.toBe(false);
  expect(secureValue).toBeNull();
});

test.each(['logout', 'replacement'] as const)(
  'a session refresh completing after %s cannot replace the current connection',
  async (change) => {
    const pending = deferred<Response>();
    const started = deferred<void>();
    mockFetch.mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    });
    expectedRequests = 1;
    await client.setTCBackendSession('old-session', 17);
    const refreshing = client.refreshTCBackendSession('student', 'password');
    await started.promise;

    if (change === 'logout') await client.clearTCSession();
    else await client.setTCBackendSession('next-session', 23);
    pending.resolve(response(200, {
      success: true, tronClassSessionId: 'refreshed-old-session', tronClassUserId: 17,
    }));

    await expect(refreshing).resolves.toMatchObject({ success: false, cancelled: true });
    await expect(client.getTCBackendSessionId()).resolves.toBe(change === 'logout' ? null : 'next-session');
    expect(secureValue).toBe(change === 'logout' ? null : nextSession);
  },
);

test.each([200, 503])('a cancelled login refresh with HTTP %s cannot start a CAS fallback', async (status) => {
  const pending = deferred<Response>();
  const started = deferred<void>();
  mockFetch.mockImplementationOnce(() => {
    started.resolve();
    return pending.promise;
  });
  expectedRequests = 1;
  const signingIn = client.tcLogin('student', 'password');
  await started.promise;

  await client.setTCBackendSession('next-session', 23);
  pending.resolve(response(status, {
    success: status === 200, tronClassSessionId: 'refreshed-old-session', tronClassUserId: 17,
  }));

  await expect(signingIn).resolves.toMatchObject({ success: false, session: null });
  await expect(client.getTCBackendSessionId()).resolves.toBe('next-session');
  expect(secureValue).toBe(nextSession);
});

test('a session refresh being saved during logout cannot report a successful login', async () => {
  const write = deferred<void>();
  const started = deferred<void>();
  mockSecureSetItem.mockImplementationOnce(async (_key: string, value: string) => {
    started.resolve();
    await write.promise;
    secureValue = value;
  });
  mockFetch.mockResolvedValueOnce(response(200, {
    success: true, tronClassSessionId: 'refreshed-old-session', tronClassUserId: 17,
  }));
  expectedRequests = 1;
  const refreshing = client.refreshTCBackendSession('student', 'password');
  await started.promise;

  const clearing = client.clearTCSession();
  write.resolve();
  await clearing;

  await expect(refreshing).resolves.toMatchObject({ success: false, cancelled: true });
  await expect(client.hasTCSession()).resolves.toBe(false);
  expect(secureValue).toBeNull();
});

test('a login profile check completing after replacement cannot fall back to CAS', async () => {
  const pending = deferred<Response>();
  const started = deferred<void>();
  mockFetch
    .mockResolvedValueOnce(response(200, {
      success: true, tronClassSessionId: 'refreshed-old-session', tronClassUserId: 17,
    }))
    .mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    });
  expectedRequests = 2;
  const signingIn = client.tcLogin('student', 'password');
  await started.promise;

  await client.setTCBackendSession('next-session', 23);
  pending.resolve(response(200, { success: true, userId: 17, result: { id: 17 } }));

  await expect(signingIn).resolves.toMatchObject({ success: false, session: null });
  await expect(client.getTCBackendSessionId()).resolves.toBe('next-session');
  expect(secureValue).toBe(nextSession);
});

test.each(['fetch', 'body'] as const)(
  'a login profile %s rejection after replacement cannot clear the new connection',
  async (failureAt) => {
    const pending = deferred<never>();
    const started = deferred<void>();
    const failLater = () => {
      started.resolve();
      return pending.promise;
    };
    mockFetch.mockResolvedValueOnce(response(200, {
      success: true, tronClassSessionId: 'refreshed-old-session', tronClassUserId: 17,
    }));
    if (failureAt === 'fetch') mockFetch.mockImplementationOnce(failLater);
    else mockFetch.mockResolvedValueOnce({ ...response(200, {}), text: failLater });
    expectedRequests = 2;
    const signingIn = client.tcLogin('student', 'password');
    await started.promise;

    await client.setTCBackendSession('next-session', 23);
    pending.reject(new Error('Network connection lost'));

    await expect(signingIn).resolves.toMatchObject({ success: false, session: null });
    await expect(client.getTCBackendSessionId()).resolves.toBe('next-session');
    expect(secureValue).toBe(nextSession);
  },
);
