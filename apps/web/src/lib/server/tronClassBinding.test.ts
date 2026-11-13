// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createTronClassBindingService, TRONCLASS_BINDING_TTL_MS, TRONCLASS_LOGIN_WINDOW_MS,
  type TronClassBindingStore,
} from './tronClassBinding';
import { PuCampusError, type TronClassSession } from './puCampusClient';

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
  const login = vi.fn(async () => loginResult());
  const service = createTronClassBindingService({ db: data.db, login, now: () => clock.value, encryptionSecret: SECRET });
  return { ...data, service, login, clock };
}

function bindingPath(owner = OWNER) { return `_tronClassBindings/${createHash('sha256').update(owner).digest('hex')}`; }

afterEach(() => vi.unstubAllEnvs());

describe('independent TronClass binding', () => {
  it('connects a platform account without a portal or membership, stores only encrypted cookies, and grants no role', async () => {
    const { service, docs, login } = setup();
    expect(await service.getStatus(OWNER)).toEqual({ schoolId: 'pu', connected: false, revision: null, account: null, userName: null, expiresAt: null });
    const status = await service.connect(OWNER, input());
    expect(status).toMatchObject({ connected: true, account: '410123456', userName: '學生甲' });
    expect(status.revision).toMatch(/^[a-f0-9]{32}$/);
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

  it('rejects a ciphertext transplanted to a different owner', async () => {
    const { service, docs } = setup();
    await service.connect(OWNER, input());
    const otherOwner = 'firebase:other-account';
    const row = docs.get(bindingPath())!;
    docs.set(bindingPath(otherOwner), { ...row, ownerKey: otherOwner });
    await expect(service.requireBinding(otherOwner)).rejects.toMatchObject({ status: 401, code: 'TRONCLASS_RECONNECT_REQUIRED' });
    expect(await service.getStatus(otherOwner)).toMatchObject({ connected: false });
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
    expect(unlinked).toMatchObject({ connected: false, account: null, userName: null, expiresAt: null });
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
    expect(await service.getStatus(OWNER)).toMatchObject({ connected: false, account: '410123456', revision: status.revision });
    await expect(service.requireBinding(OWNER)).rejects.toMatchObject({ status: 401 });
    await expect(service.assertCurrent(OWNER, status.revision!)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a stale revision before making another school login request', async () => {
    const { service, login } = setup();
    await service.connect(OWNER, input());
    await expect(service.connect(OWNER, input())).rejects.toMatchObject({ status: 409 });
    expect(login).toHaveBeenCalledOnce();
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
    for (const [path, row] of docs) if (row.scope === 'owner') docs.delete(path);
    finish(loginResult());
    await expect(pending).rejects.toMatchObject({ code: 'SIGN_IN_REQUIRED' });
    await expect(service.connect(OWNER, input(marker.revision))).rejects.toMatchObject({ code: 'SIGN_IN_REQUIRED' });
    await expect(service.disconnect(OWNER, marker.revision)).rejects.toMatchObject({ code: 'SIGN_IN_REQUIRED' });
    await expect(service.requireBinding(OWNER)).rejects.toMatchObject({ code: 'SIGN_IN_REQUIRED' });
    expect(docs.get(bindingPath())).toEqual(marker);
    expect([...docs.values()].some((row) => row.scope === 'owner')).toBe(false);
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

  it('enforces a persistent account limit across owners and equivalent student account spellings', async () => {
    const { service, login, db, clock } = setup();
    login.mockRejectedValue(new PuCampusError('credentials', 'fixture'));
    for (let i = 0; i < 5; i++) {
      await expect(service.connect(`firebase:owner-${i}`, input(null, i % 2 ? 's410123456@pu.edu.tw' : '410123456')))
        .rejects.toMatchObject({ status: 401 });
    }
    // Recreating the service does not reset the rate limit.
    const restarted = createTronClassBindingService({ db, login, now: () => clock.value, encryptionSecret: SECRET });
    await expect(restarted.connect('firebase:new-owner', input())).rejects.toMatchObject({ status: 429 });
    expect(login).toHaveBeenCalledTimes(5);
    clock.value += TRONCLASS_LOGIN_WINDOW_MS;
    await expect(restarted.connect('firebase:new-owner', input())).rejects.toMatchObject({ status: 401 });
    expect(login).toHaveBeenCalledTimes(6);
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
