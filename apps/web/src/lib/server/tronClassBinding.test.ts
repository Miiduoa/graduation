// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createTronClassBindingService, TRONCLASS_BINDING_TTL_MS, TRONCLASS_LOGIN_WINDOW_MS,
  type TronClassBindingStore,
} from './tronClassBinding';
import { PuCampusError, type PuCampusGateway, type TronClassSession } from './puCampusClient';

const schedulerStarted = vi.hoisted(() => vi.fn(() => true));
vi.mock('./tronClassRetentionScheduler', () => ({ isTronClassRetentionSchedulerStarted: schedulerStarted }));

const OWNER = 'platform:pa_12345678-1234-1234-1234-123456789abc';
const SECRET = 'binding-tests-only-secret-at-least-thirty-two';
const PASSWORD = 'private-password-not-for-storage';
const SOURCE_COOKIES = { session: 'private-school-cookie', route: 'fixture-route' };
const NOW = Date.parse('2026-11-13T08:00:00Z');
const loginResult = (): TronClassSession => ({ cookies: { ...SOURCE_COOKIES }, userId: 123,
  userName: '學生甲', role: 'teacher' });

function store() {
  const docs = new Map<string, Record<string, unknown>>();
  let tail: Promise<unknown> = Promise.resolve();
  const snapshot = (path: string) => {
    const value = structuredClone(docs.get(path));
    return { exists: value !== undefined, data: () => value };
  };
  const db: TronClassBindingStore = {
    doc: (path) => ({ path, get: async () => snapshot(path) }),
    runTransaction: (work) => {
      const operation = tail.then(async () => {
        const writes = new Map<string, Record<string, unknown>>();
        const value = await work({ get: async (ref) => snapshot(ref.path),
          set: (ref, data) => { writes.set(ref.path, structuredClone(data)); } });
        writes.forEach((data, path) => docs.set(path, data));
        return value;
      });
      tail = operation.catch(() => {});
      return operation;
    },
  };
  return { db, docs };
}

function input(expectedRevision: string | null = null, account = '410123456') {
  return { schoolId: 'pu' as const, account, password: PASSWORD, expectedRevision };
}

function setup() {
  const data = store();
  const clock = { value: NOW };
  const login = vi.fn<PuCampusGateway['loginTronClass']>(async () => loginResult());
  const service = createTronClassBindingService({ db: data.db, login, now: () => clock.value, encryptionSecret: SECRET });
  return { ...data, service, login, clock };
}

function bindingPath(owner = OWNER) { return `_tronClassBindings/${createHash('sha256').update(owner).digest('hex')}`; }

beforeEach(() => {
  schedulerStarted.mockReset();
  schedulerStarted.mockReturnValue(true);
  vi.stubEnv('TRONCLASS_RETENTION_ENABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

describe('independent TronClass binding', () => {
  it('connects a platform account without a portal or membership, stores only encrypted cookies, and grants no role', async () => {
    const { service, docs, login } = setup();
    expect(await service.getStatus(OWNER)).toEqual({ schoolId: 'pu', connected: false, revision: null, account: null, userName: null, expiresAt: null, studentKey: null });
    const status = await service.connect(OWNER, input());
    expect(status).toMatchObject({ connected: true, account: '410123456', userName: '學生甲' });
    expect(status.revision).toMatch(/^[a-f0-9]{32}$/);
    expect(status.studentKey).toMatch(/^[a-f0-9]{64}$/);
    expect(login).toHaveBeenCalledWith('410123456', PASSWORD, expect.objectContaining({ route: 'student' }));
    expect(await service.requireBinding(OWNER)).toMatchObject({ revision: status.revision, userId: 123, cookies: SOURCE_COOKIES });
    const persisted = JSON.stringify([...docs]);
    for (const value of [PASSWORD, SOURCE_COOKIES.session, SOURCE_COOKIES.route, '_puSessions', 'schools/', 'users/']) expect(persisted).not.toContain(value);
    expect(JSON.stringify(status)).not.toContain('cookies');
    expect(JSON.stringify(status)).not.toContain('teacher');
    expect(await service.getStatus(OWNER)).toEqual(status);
    expect(docs.get(bindingPath())?.purgeAt).toEqual(new Date(NOW + TRONCLASS_BINDING_TTL_MS));
    expect([...docs.values()].find((row) => row.scope === 'owner')).toMatchObject({ ownerKey: OWNER,
      purgeAt: new Date(NOW + TRONCLASS_LOGIN_WINDOW_MS) });
    expect([...docs.values()].find((row) => row.scope === 'account')).not.toHaveProperty('ownerKey');
  });

  it('keeps provider owners isolated even when their account id text is the same', async () => {
    const { service } = setup();
    const linked = await service.connect(OWNER, input());
    const firebaseOwner = OWNER.replace('platform:', 'firebase:');
    expect(await service.getStatus(firebaseOwner)).toMatchObject({ connected: false, revision: null });
    await expect(service.requireBinding(firebaseOwner)).rejects.toMatchObject({ status: 401 });
    await service.assertCurrent(OWNER, linked.revision!);
  });

  it('keeps the draft identity stable across a new revision and account spelling only for the same verified student', async () => {
    const { service, login } = setup();
    const first = await service.connect(OWNER, input());
    const sameStudent = await service.connect(OWNER, input(first.revision, 's410123456@pu.edu.tw'));
    expect(sameStudent.revision).not.toBe(first.revision);
    expect(sameStudent.studentKey).toBe(first.studentKey);
    login.mockResolvedValueOnce({ ...loginResult(), userId: 999 });
    const otherStudent = await service.connect(OWNER, input(sameStudent.revision, 's410123456@pu.edu.tw'));
    expect(otherStudent.studentKey).not.toBe(first.studentKey);
    expect(JSON.stringify(otherStudent)).not.toContain('userId');
  });

  it('scopes the opaque draft identity to its nuni owner and secret', async () => {
    const { service, db, login, clock } = setup();
    const first = await service.connect(OWNER, input());
    const otherOwner = await service.connect('firebase:other-owner', input());
    expect(otherOwner.studentKey).not.toBe(first.studentKey);
    const rotated = createTronClassBindingService({ db, login, now: () => clock.value,
      encryptionSecret: `${SECRET}-rotated` });
    expect(await rotated.getStatus(OWNER)).toMatchObject({ connected: false, studentKey: null });
    const afterRotation = await rotated.connect(OWNER, input(first.revision));
    expect(afterRotation.studentKey).not.toBe(first.studentKey);
  });

  it('rejects a ciphertext transplanted to a different owner', async () => {
    const { service, docs } = setup();
    await service.connect(OWNER, input());
    const otherOwner = 'firebase:other-account';
    const row = docs.get(bindingPath())!;
    docs.set(bindingPath(otherOwner), { ...row, ownerKey: otherOwner });
    await expect(service.requireBinding(otherOwner)).rejects.toMatchObject({ status: 401, code: 'TRONCLASS_RECONNECT_REQUIRED' });
    expect(await service.getStatus(otherOwner)).toMatchObject({ connected: false, studentKey: null });
  });

  it('rejects a ciphertext transplanted across revisions for the same owner', async () => {
    const { service, docs } = setup();
    await service.connect(OWNER, input());
    const row = docs.get(bindingPath())!;
    docs.set(bindingPath(), { ...row, revision: 'f'.repeat(32) });
    await expect(service.requireBinding(OWNER)).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
  });

  it('replaces the cookie payload with a tombstone when disconnected', async () => {
    const { service, docs } = setup();
    const status = await service.connect(OWNER, input());
    const unlinked = await service.disconnect(OWNER, status.revision);
    expect(unlinked).toMatchObject({ connected: false, account: null, userName: null, expiresAt: null, studentKey: null });
    expect(unlinked.revision).not.toBe(status.revision);
    expect(docs.get(bindingPath())).not.toHaveProperty('sealedCookies');
    await expect(service.requireBinding(OWNER)).rejects.toMatchObject({ status: 401 });
    await expect(service.assertCurrent(OWNER, status.revision!)).rejects.toMatchObject({ status: 409 });
    await expect(service.disconnect(OWNER, status.revision)).rejects.toMatchObject({ status: 409 });
    expect((await service.connect(OWNER, input(unlinked.revision))).connected).toBe(true);
  });

  it('does not return a locally expired session or assert it as current', async () => {
    const { service, clock } = setup();
    const status = await service.connect(OWNER, input());
    clock.value += TRONCLASS_BINDING_TTL_MS;
    expect(await service.getStatus(OWNER)).toMatchObject({ connected: false, account: '410123456', revision: status.revision, studentKey: null });
    await expect(service.requireBinding(OWNER)).rejects.toMatchObject({ status: 401 });
    await expect(service.assertCurrent(OWNER, status.revision!)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a stale revision before making another school login request', async () => {
    const { service, login } = setup();
    await service.connect(OWNER, input());
    await expect(service.connect(OWNER, input())).rejects.toMatchObject({ status: 409 });
    expect(login).toHaveBeenCalledOnce();
  });

  it('does not consume quota or contact school for an already cancelled connection', async () => {
    const { service, login, docs } = setup();
    const controller = new AbortController();
    controller.abort(new Error('private caller cancellation reason'));
    await expect(service.connect(OWNER, input(), controller.signal)).rejects.toMatchObject({
      status: 499, code: 'TRONCLASS_LOGIN_CANCELLED', message: 'TRONCLASS_LOGIN_CANCELLED',
    });
    expect(login).not.toHaveBeenCalled();
    expect(docs.size).toBe(0);
  });

  it('stops waiting for a store that ignores cancellation without starting school login later', async () => {
    const { db, docs } = store();
    const controller = new AbortController();
    let finish!: (value: TronClassBindingStore) => void;
    const getStore = vi.fn(() => new Promise<TronClassBindingStore>((resolve) => { finish = resolve; }));
    const login = vi.fn<PuCampusGateway['loginTronClass']>(async () => loginResult());
    const service = createTronClassBindingService({ getStore, login, encryptionSecret: SECRET });
    const pending = service.connect(OWNER, input(), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'TRONCLASS_LOGIN_CANCELLED' });
    await vi.waitFor(() => expect(getStore).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    finish(db);
    await Promise.resolve();
    expect(login).not.toHaveBeenCalled();
    expect(docs.size).toBe(0);
  });

  it('cancels a late ignored login, keeps its rate-limit attempt, and never persists its session', async () => {
    const { service, login, docs } = setup();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    let finish!: (value: TronClassSession) => void;
    login.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = service.connect(OWNER, input(), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ status: 499, code: 'TRONCLASS_LOGIN_CANCELLED' });
    await vi.waitFor(() => expect(login).toHaveBeenCalledOnce());
    expect(login.mock.calls[0]?.[2]?.signal).toBe(controller.signal);
    controller.abort();
    await rejected;
    finish(loginResult());
    await Promise.resolve();
    expect(docs.has(bindingPath())).toBe(false);
    expect([...docs.values()].filter(row => row.scope === 'owner' || row.scope === 'owner-account'))
      .toEqual(expect.arrayContaining([expect.objectContaining({ timestamps: [expect.objectContaining({ timestamp: NOW })] })]));
    expect(remove.mock.calls.filter(([event]) => event === 'abort')).toHaveLength(2);
    expect(await service.getStatus(OWNER)).toMatchObject({ connected: false, revision: null });
  });

  it.each([false, true])('does not write an aborted binding after transaction read (existing connection: %s)', async (connected) => {
    const { service, login, docs, db } = setup();
    const prior = connected ? await service.connect(OWNER, input()) : await service.getStatus(OWNER);
    const original = structuredClone(docs.get(bindingPath()));
    const controller = new AbortController();
    const run = db.runTransaction;
    let attempts = 0;
    db.runTransaction = (work) => run(transaction => {
      attempts++;
      return work({
        ...transaction,
        get: async ref => {
          const value = await transaction.get(ref);
          // The first transaction records quota; the second persists binding.
          if (attempts === 2) controller.abort();
          return value;
        },
      });
    });
    await expect(service.connect(OWNER, input(prior.revision), controller.signal))
      .rejects.toMatchObject({ status: 499, code: 'TRONCLASS_LOGIN_CANCELLED' });
    expect(login).toHaveBeenCalledTimes(connected ? 2 : 1);
    expect(docs.get(bindingPath())).toEqual(original);
    expect(await service.getStatus(OWNER)).toEqual(prior);
  });

  it('aborts quota transaction before writes and never sends credentials', async () => {
    const { service, login, docs, db } = setup();
    const controller = new AbortController();
    const run = db.runTransaction;
    db.runTransaction = (work) => run(transaction => work({
      ...transaction,
      get: async ref => { const value = await transaction.get(ref); controller.abort(); return value; },
    }));
    await expect(service.connect(OWNER, input(), controller.signal)).rejects.toMatchObject({ code: 'TRONCLASS_LOGIN_CANCELLED' });
    expect(login).not.toHaveBeenCalled();
    expect(docs.size).toBe(0);
  });

  it('preserves a completed connection when its former caller later aborts', async () => {
    const { service } = setup();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const status = await service.connect(OWNER, input(), controller.signal);
    expect(add.mock.calls.filter(([event]) => event === 'abort')).toHaveLength(2);
    expect(remove.mock.calls.filter(([event]) => event === 'abort')).toHaveLength(2);
    controller.abort();
    expect(await service.getStatus(OWNER)).toEqual(status);
  });

  it('cannot resurrect a pending first connection after unlink', async () => {
    const { service, login } = setup();
    let finish!: (value: TronClassSession) => void;
    login.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = service.connect(OWNER, input());
    await vi.waitFor(() => expect(login).toHaveBeenCalledOnce());
    const disconnected = await service.disconnect(OWNER, null);
    finish(loginResult());
    await expect(pending).rejects.toMatchObject({ status: 409 });
    expect(await service.getStatus(OWNER)).toEqual(disconnected);
  });

  it('cannot resurrect credentials or quota after the account closure barrier is written', async () => {
    const { service, login, docs } = setup();
    let finish!: (value: TronClassSession) => void;
    login.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = service.connect(OWNER, input());
    await vi.waitFor(() => expect(login).toHaveBeenCalledOnce());
    const marker = { schoolId: 'pu', state: 'closed', ownerHash: createHash('sha256').update(OWNER).digest('hex'),
      revision: 'c'.repeat(32), updatedAt: NOW };
    docs.set(bindingPath(), marker);
    for (const [path, row] of docs) if (row.ownerKey === OWNER && path.startsWith('_tronClassLoginAttempts/')) docs.delete(path);
    finish(loginResult());
    await expect(pending).rejects.toMatchObject({ code: 'SIGN_IN_REQUIRED' });
    await expect(service.connect(OWNER, input(marker.revision))).rejects.toMatchObject({ code: 'SIGN_IN_REQUIRED' });
    await expect(service.disconnect(OWNER, marker.revision)).rejects.toMatchObject({ code: 'SIGN_IN_REQUIRED' });
    await expect(service.requireBinding(OWNER)).rejects.toMatchObject({ code: 'SIGN_IN_REQUIRED' });
    expect(docs.get(bindingPath())).toEqual(marker);
    expect([...docs.values()].filter(row => row.scope === 'owner' || row.scope === 'owner-account')).toEqual([]);
    expect([...docs.values()].find(row => row.scope === 'target-account')).toMatchObject({
      timestamps: [expect.objectContaining({ timestamp: NOW })],
    });
    expect(login).toHaveBeenCalledOnce();
  });

  it('does not let a slow old connection replace a completed newer connection', async () => {
    const { service, login } = setup();
    let finish!: (value: TronClassSession) => void;
    login.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = service.connect(OWNER, input());
    await vi.waitFor(() => expect(login).toHaveBeenCalledOnce());
    const fresh = await service.connect(OWNER, input(null, 's410999999'));
    finish(loginResult());
    await expect(pending).rejects.toMatchObject({ status: 409 });
    expect(await service.getStatus(OWNER)).toEqual(fresh);
  });

  it('sanitizes school errors and does not persist the password', async () => {
    const { service, login, docs } = setup();
    login.mockRejectedValueOnce(new PuCampusError('credentials', `bad ${PASSWORD} ${SOURCE_COOKIES.session}`));
    await expect(service.connect(OWNER, input())).rejects.toMatchObject({ status: 401, message: 'TRONCLASS_INVALID_CREDENTIALS' });
    login.mockRejectedValueOnce(new Error(`network ${PASSWORD} ${SOURCE_COOKIES.session}`));
    await expect(service.connect(OWNER, input())).rejects.toMatchObject({ status: 502, message: 'TRONCLASS_LOGIN_UNAVAILABLE' });
    expect(JSON.stringify([...docs])).not.toContain(PASSWORD);
    expect(docs.has(bindingPath())).toBe(false);
  });

  it('enforces a persistent owner/account limit across equivalent account spellings without affecting another owner', async () => {
    const { service, login, db, clock } = setup();
    login.mockRejectedValue(new PuCampusError('credentials', 'fixture'));
    for (let i = 0; i < 5; i++) {
      await expect(service.connect(OWNER, input(null, i % 2 ? 's410123456@pu.edu.tw' : '410123456')))
        .rejects.toMatchObject({ status: 401 });
    }
    // Recreating the service does not reset the rate limit.
    const restarted = createTronClassBindingService({ db, login, now: () => clock.value, encryptionSecret: SECRET });
    await expect(restarted.connect(OWNER, input())).rejects.toMatchObject({ status: 429 });
    expect(login).toHaveBeenCalledTimes(5);
    await expect(restarted.connect('firebase:new-owner', input())).rejects.toMatchObject({ status: 401 });
    clock.value += TRONCLASS_LOGIN_WINDOW_MS;
    await expect(restarted.connect(OWNER, input())).rejects.toMatchObject({ status: 401 });
    expect(login).toHaveBeenCalledTimes(7);
  });

  it('refunds transport failures without refunding verified credential failures at the same timestamp', async () => {
    const { service, login, docs } = setup();
    login.mockRejectedValueOnce(new PuCampusError('credentials', 'fixture'));
    await expect(service.connect(OWNER, input())).rejects.toMatchObject({ status: 401 });
    login.mockRejectedValue(new PuCampusError('timeout', 'fixture', { loginNotDelivered: true }));
    for (let i = 0; i < 6; i++) {
      await expect(service.connect(OWNER, input())).rejects.toMatchObject({ code: 'TRONCLASS_LOGIN_UNAVAILABLE' });
    }
    expect([...docs.values()].find(row => row.scope === 'target-account')?.timestamps)
      .toEqual([expect.objectContaining({ timestamp: NOW })]);
    login.mockRejectedValue(new PuCampusError('credentials', 'fixture'));
    for (let i = 0; i < 4; i++) {
      await expect(service.connect(OWNER, input())).rejects.toMatchObject({ status: 401 });
    }
    await expect(service.connect(OWNER, input())).rejects.toMatchObject({ status: 429 });
  });

  it('shares the target budget across callers and leaves room after one caller is limited', async () => {
    const { service, login, docs } = setup();
    login.mockRejectedValue(new PuCampusError('credentials', 'fixture'));
    for (let caller = 0; caller < 4; caller++) {
      const owner = `platform:pa_caller${caller}`;
      for (let attempt = 0; attempt < 5; attempt++) {
        const account = attempt % 2 ? ' CHANGYI@PU.EDU.TW ' : 'changyi';
        await expect(service.connect(owner, input(null, account))).rejects.toMatchObject({ status: 401 });
      }
      await expect(service.connect(owner, input(null, 'changyi'))).rejects.toMatchObject({ status: 429 });
    }
    const freshOwner = 'platform:pa_fresh';
    await expect(service.connect(freshOwner, input(null, 'changyi@pu.edu.tw'))).rejects.toMatchObject({ status: 429 });
    expect(login).toHaveBeenCalledTimes(20);
    const budget = [...docs.values()].find(row => row.scope === 'target-account');
    expect(budget).toMatchObject({ timestamps: expect.any(Array), purgeAt: new Date(NOW + 15 * 60_000) });
    expect(budget).not.toHaveProperty('ownerKey');
  });

  it.each([
    new PuCampusError('unavailable', 'fixture', { code: 'HTTP_403' }),
    new PuCampusError('timeout', 'fixture', { code: 'UND_ERR_HEADERS_TIMEOUT' }),
  ])('keeps the debit when delivery cannot be ruled out (%s)', async (failure) => {
    const { service, login } = setup();
    login.mockRejectedValue(failure);
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(service.connect(OWNER, input())).rejects.toMatchObject({ status: 502 });
    }
    await expect(service.connect(OWNER, input())).rejects.toMatchObject({ status: 429 });
    expect(login).toHaveBeenCalledTimes(5);
  });

  it('requires reconnection for a legacy cookie jar while preserving its revision', async () => {
    const { service, docs } = setup();
    const connected = await service.connect(OWNER, input());
    const row = docs.get(bindingPath())!;
    docs.set(bindingPath(), { ...row, sealedCookies: String(row.sealedCookies).replace(/^v2\./, 'v1.') });
    await expect(service.getStatus(OWNER)).resolves.toMatchObject({ connected: false, revision: connected.revision });
    await expect(service.requireBinding(OWNER)).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
    await expect(service.connect(OWNER, input(connected.revision))).resolves.toMatchObject({ connected: true });
  });

  it.each([undefined, 'false', 'TRUE'])('rejects binding before school login or storage when retention is %s', async (flag) => {
    vi.stubEnv('TRONCLASS_RETENTION_ENABLED', flag);
    const { service, login, docs } = setup();
    await expect(service.connect(OWNER, input())).rejects.toMatchObject({ status: 503, code: 'TRONCLASS_RETENTION_REQUIRED' });
    expect(login).not.toHaveBeenCalled();
    expect(docs.size).toBe(0);
  });

  it('rejects binding before login and storage when the retention scheduler has not started', async () => {
    schedulerStarted.mockReturnValue(false);
    const { service, login, docs } = setup();
    await expect(service.connect(OWNER, input())).rejects.toMatchObject({ status: 503, code: 'TRONCLASS_RETENTION_REQUIRED' });
    expect(login).not.toHaveBeenCalled();
    expect(docs.size).toBe(0);
  });

  it('does not save a verified session if retention is disabled during login', async () => {
    const { service, login, docs } = setup();
    login.mockImplementationOnce(async () => {
      vi.stubEnv('TRONCLASS_RETENTION_ENABLED', 'false');
      return loginResult();
    });
    await expect(service.connect(OWNER, input())).rejects.toMatchObject({ code: 'TRONCLASS_RETENTION_REQUIRED' });
    expect(docs.has(bindingPath())).toBe(false);
  });

  it('limits one platform account across different school accounts', async () => {
    const { service, login } = setup();
    login.mockRejectedValue(new PuCampusError('credentials', 'fixture'));
    for (let i = 0; i < 6; i++) {
      await expect(service.connect(OWNER, input(null, `41012345${i}`))).rejects.toMatchObject({ status: 401 });
    }
    await expect(service.connect(OWNER, input(null, '410123459'))).rejects.toMatchObject({ status: 429 });
    expect(login).toHaveBeenCalledTimes(6);
  });

  it('does not reset corrupt rate limit records', async () => {
    const { service, login, docs } = setup();
    login.mockRejectedValue(new PuCampusError('credentials', 'fixture'));
    await expect(service.connect(OWNER, input())).rejects.toMatchObject({ status: 401 });
    const path = [...docs.keys()].find((key) => key.startsWith('_tronClassLoginAttempts/'))!;
    docs.set(path, { timestamps: null });
    await expect(service.connect(OWNER, input())).rejects.toMatchObject({ status: 503 });
    expect(login).toHaveBeenCalledOnce();
  });

  it.each([
    { ...loginResult(), userId: null },
    { ...loginResult(), cookies: { session: 'line\r\nbreak' } },
    { ...loginResult(), cookies: {} },
  ] as TronClassSession[])('requires a verified numeric source identity and usable cookies', async (source) => {
    const { service, login } = setup();
    login.mockResolvedValueOnce(source);
    await expect(service.connect(OWNER, input())).rejects.toMatchObject({ status: 502, code: 'TRONCLASS_IDENTITY_UNVERIFIED' });
    expect((await service.getStatus(OWNER)).connected).toBe(false);
  });

  it('fails before login if encryption is not configured', async () => {
    vi.stubEnv('TRONCLASS_SESSION_SECRET', '');
    vi.stubEnv('BFF_SESSION_SECRET', '');
    const { db, login } = setup();
    const service = createTronClassBindingService({ db, login });
    await expect(service.connect(OWNER, input())).rejects.toMatchObject({ code: 'TRONCLASS_CONFIGURATION_REQUIRED' });
    expect(login).not.toHaveBeenCalled();
  });

  it.each(['https://evil.example/login', 'someone@other.edu.tw', 'a/b', ''])('rejects invalid accounts without attempting login: %s', async (account) => {
    const { service, login } = setup();
    await expect(service.connect(OWNER, input(null, account))).rejects.toMatchObject({ status: 422 });
    expect(login).not.toHaveBeenCalled();
  });
});
