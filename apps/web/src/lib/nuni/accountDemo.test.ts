// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  ACCOUNT_DEMO_ACTIONS,
  ACCOUNT_DEMO_ACTION_FEATURES,
  ACCOUNT_DEMO_FEATURES,
  applyAccountDemoAction,
  createAccountDemoPermissions,
  createAccountDemoState,
  parseAccountDemoMutation,
  parseAccountDemoSnapshot,
  type AccountDemoSnapshot,
} from '@campus/shared/src/accountDemo';
import { NuniError } from '@campus/shared/src/nuni';
import {
  ACCOUNT_DEMO_SQL,
  createAccountDemoStore,
  resolveAccountDemoStore,
} from './accountDemoStore';
import { createAccountDemoHandler } from './accountDemoRoute';
import { SESSION_COOKIE, sealCookie, sessionContext } from './server';

const accountId = 'pa_11111111-1111-4111-8111-111111111111';
const otherId = 'pa_22222222-2222-4222-8222-222222222222';
const demo = (): AccountDemoSnapshot => ({
  accountId,
  revision: 0,
  profile: {
    displayName: '展示同學',
    schoolId: 'pu',
    schoolName: '靜宜大學',
    studentId: 'DEMO1140001',
    department: '資訊管理學系',
  },
  permissions: createAccountDemoPermissions(true),
  state: createAccountDemoState(),
  expiresAt: new Date(Date.now() + 86400_000).toISOString(),
});
const dbRow = (value = demo()) => ({
  account_id: value.accountId,
  revision: String(value.revision),
  profile: value.profile,
  permissions: value.permissions,
  state: value.state,
  expires_at: new Date(value.expiresAt),
});

describe('account demonstration contract', () => {
  it('accepts the complete demonstration contract and never treats it as campus authority', () => {
    const original = demo();
    expect(parseAccountDemoSnapshot(original)).toEqual(original);
    expect(Object.keys(createAccountDemoPermissions())).toEqual([...ACCOUNT_DEMO_FEATURES]);
    expect(Object.values(createAccountDemoPermissions())).toEqual(
      ACCOUNT_DEMO_FEATURES.map(() => false),
    );
  });
  it.each([
    { expectedRevision: 0, action: 'checkIn', accountId: otherId },
    { expectedRevision: 0, action: 'checkIn', email: 'owner@example.test' },
    { expectedRevision: 0, action: 'checkIn', permissions: createAccountDemoPermissions(true) },
    { expectedRevision: -1, action: 'checkIn' },
    { expectedRevision: 0.5, action: 'checkIn' },
    { expectedRevision: 0, action: 'grantAdmin' },
    { expectedRevision: 0, permissions: { studentCard: true } },
    { expectedRevision: 0, permissions: { ...createAccountDemoPermissions(true), operator: true } },
    { expectedRevision: 0, permissions: { ...createAccountDemoPermissions(true), food: 'true' } },
  ])('rejects malformed, mixed and identity-bearing mutations: %j', (value) => {
    expect(() => parseAccountDemoMutation(value)).toThrow();
  });
  it('rejects a real-looking student ID and unknown snapshot authority', () => {
    const original = demo();
    expect(() =>
      parseAccountDemoSnapshot({
        ...original,
        profile: { ...original.profile, studentId: '1110700321' },
      }),
    ).toThrow();
    expect(() => parseAccountDemoSnapshot({ ...original, isAdmin: true })).toThrow();
  });
  for (const action of ACCOUNT_DEMO_ACTIONS) {
    it(`enforces every current feature needed for ${action}`, () => {
      for (const feature of ACCOUNT_DEMO_ACTION_FEATURES[action]) {
        const original = demo();
        original.permissions[feature] = false;
        expect(() => applyAccountDemoAction(original, action)).toThrow('DEMO_FEATURE_DISABLED');
      }
    });
  }
  it('requires the student/merchant precursor and resets only progression', () => {
    const original = demo();
    expect(() => applyAccountDemoAction(original, 'approveLeave')).toThrow('DEMO_ACTION_NOT_READY');
    expect(() => applyAccountDemoAction(original, 'publishGrade')).toThrow('DEMO_ACTION_NOT_READY');
    expect(() => applyAccountDemoAction(original, 'readyOrder')).toThrow('DEMO_ACTION_NOT_READY');
    original.state = applyAccountDemoAction(original, 'requestLeave');
    original.state = applyAccountDemoAction(original, 'approveLeave');
    expect(original.state.approveLeave).toBe(true);
    expect(applyAccountDemoAction(original, 'reset')).toEqual(createAccountDemoState());
    expect(original.permissions).toEqual(createAccountDemoPermissions(true));
  });
});

describe('account demonstration persistence', () => {
  it('fails closed without configured database access, even in development', () => {
    expect(() => resolveAccountDemoStore({ NODE_ENV: 'development' })).toThrow(
      'ACCOUNT_DEMO_STORE_UNAVAILABLE',
    );
  });
  it('scopes every SQL operation to the verified account and confirms a new revision by reading it back', async () => {
    let row = dbRow();
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      expect(params?.[0]).toBe(accountId);
      if (sql === ACCOUNT_DEMO_SQL.update) {
        expect(params?.[1]).toBe(0);
        row = {
          ...row,
          revision: '1',
          permissions: JSON.parse(String(params?.[2])),
          state: JSON.parse(String(params?.[3])),
        };
      }
      return [structuredClone(row)];
    });
    const result = await createAccountDemoStore(query).mutate(accountId, {
      expectedRevision: 0,
      action: 'checkIn',
    });
    expect(result.revision).toBe(1);
    expect(result.state.checkIn).toBe(true);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      ACCOUNT_DEMO_SQL.read,
      ACCOUNT_DEMO_SQL.update,
      ACCOUNT_DEMO_SQL.read,
    ]);
  });
  it('rejects stale revisions and disabled features before any update', async () => {
    const original = demo();
    original.permissions.food = false;
    const query = vi.fn(async () => [dbRow(original)]);
    const store = createAccountDemoStore(query);
    await expect(
      store.mutate(accountId, { expectedRevision: 1, action: 'checkIn' }),
    ).rejects.toMatchObject({ code: 'DEMO_REVISION_CHANGED' });
    await expect(
      store.mutate(accountId, { expectedRevision: 0, action: 'createOrder' }),
    ).rejects.toMatchObject({ code: 'DEMO_FEATURE_DISABLED' });
    expect(query.mock.calls).toHaveLength(2);
  });
  it('cannot adopt another account row or corrupt expired data', async () => {
    const wrong = { ...demo(), accountId: otherId };
    await expect(
      createAccountDemoStore(async () => [dbRow(wrong)]).read(accountId),
    ).rejects.toThrow('ACCOUNT_DEMO_STORE_UNAVAILABLE');
    const expired = { ...demo(), expiresAt: new Date(Date.now() - 1000).toISOString() };
    await expect(
      createAccountDemoStore(async () => [dbRow(expired)]).read(accountId),
    ).rejects.toThrow('ACCOUNT_DEMO_STORE_UNAVAILABLE');
  });
  it('does not report success when a concurrent update, expiry or suspension wins the CAS', async () => {
    const query = vi.fn(async (sql: string) => (sql === ACCOUNT_DEMO_SQL.update ? [] : [dbRow()]));
    await expect(
      createAccountDemoStore(query).mutate(accountId, { expectedRevision: 0, action: 'checkIn' }),
    ).rejects.toMatchObject({ status: 409, code: 'DEMO_REVISION_CHANGED' });
  });
  it('does not claim a confirmed save if the following owner read fails or changes', async () => {
    let reads = 0;
    const value = demo();
    const query = vi.fn(async (sql: string) => {
      if (sql === ACCOUNT_DEMO_SQL.update)
        return [dbRow({ ...value, revision: 1, state: { ...value.state, checkIn: true } })];
      return reads++ === 0 ? [dbRow(value)] : [];
    });
    await expect(
      createAccountDemoStore(query).mutate(accountId, { expectedRevision: 0, action: 'checkIn' }),
    ).rejects.toMatchObject({ code: 'DEMO_SAVE_NOT_CONFIRMED' });
  });
  it('preserves progress when editing permissions and uses the previous revision exactly once', async () => {
    const value = demo();
    value.state.submitAssignment = true;
    let row = dbRow(value);
    const query = async (sql: string, params?: unknown[]) => {
      if (sql === ACCOUNT_DEMO_SQL.update) {
        if (Number(row.revision) !== params?.[1]) return [];
        row = {
          ...row,
          revision: String(Number(row.revision) + 1),
          permissions: JSON.parse(String(params?.[2])),
          state: JSON.parse(String(params?.[3])),
        };
      }
      return [structuredClone(row)];
    };
    const store = createAccountDemoStore(query);
    const result = await store.mutate(accountId, {
      expectedRevision: 0,
      permissions: createAccountDemoPermissions(false),
    });
    expect(result.state.submitAssignment).toBe(true);
    expect(result.permissions).toEqual(createAccountDemoPermissions(false));
    await expect(
      store.mutate(accountId, { expectedRevision: 0, action: 'checkIn' }),
    ).rejects.toThrow('DEMO_REVISION_CHANGED');
  });
});

describe('authenticated demo route', () => {
  const principal = vi.fn();
  const read = vi.fn();
  const mutate = vi.fn();
  const handle = createAccountDemoHandler({ principal, store: () => ({ read, mutate }) });
  const session = () => ({
    sessionHandle: 'ps_' + 'a'.repeat(43),
    expiresAt: Date.now() + 3600_000,
  });
  function request(
    body?: unknown,
    options: {
      native?: boolean;
      origin?: string;
      context?: string;
      auth?: string;
      query?: string;
      pendingLogout?: true;
    } = {},
  ) {
    const current = {
      ...session(),
      ...(options.pendingLogout ? { pendingLogout: true as const } : {}),
    };
    return new NextRequest('https://nuni.tw/api/nuni/account-demo' + (options.query ?? ''), {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(options.native
          ? { Authorization: 'Platform ' + current.sessionHandle }
          : {
              Cookie: SESSION_COOKIE + '=' + sealCookie(SESSION_COOKIE, current),
              'X-Campus-Session': options.context ?? sessionContext(current),
              ...(body !== undefined ? { Origin: options.origin ?? 'https://nuni.tw' } : {}),
            }),
        ...(options.auth ? { Authorization: options.auth } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
  beforeEach(() => {
    vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
    vi.stubEnv('BFF_SESSION_SECRET', 'account-demo-cookie-secret-longer-than-32-characters');
    principal.mockReset().mockResolvedValue({
      authenticated: true,
      platformAccountId: accountId,
      isPlatformOperator: false,
    });
    read.mockReset().mockResolvedValue(demo());
    mutate.mockReset().mockResolvedValue(demo());
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each([false, true])(
    'reads only the upstream-verified account via native=%s',
    async (native) => {
      const response = await handle(request(undefined, { native }));
      expect(response.status).toBe(200);
      expect((await response.json()).demo.accountId).toBe(accountId);
      expect(read).toHaveBeenCalledWith(accountId);
      expect(principal).toHaveBeenCalledTimes(1);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('vary')).toContain('Authorization');
    },
  );
  it('does not expose other users when the authenticated account has no demo', async () => {
    principal.mockResolvedValue({
      authenticated: true,
      platformAccountId: otherId,
      isPlatformOperator: false,
    });
    read.mockResolvedValue(null);
    const response = await handle(request());
    expect(await response.json()).toEqual({ demo: null });
    expect(read).toHaveBeenCalledWith(otherId);
  });
  it.each([false, true])(
    'accepts an exact action for native=%s without accepting an account selector',
    async (native) => {
      const response = await handle(
        request({ expectedRevision: 0, action: 'checkIn' }, { native }),
      );
      expect(response.status).toBe(200);
      expect(mutate).toHaveBeenCalledWith(accountId, { expectedRevision: 0, action: 'checkIn' });
      const bad = await handle(
        request({ expectedRevision: 0, action: 'checkIn', accountId: otherId }, { native }),
      );
      expect(bad.status).toBe(422);
      expect(mutate).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects cross-origin writes, stale context, pending logout and malformed bearer without data access', async () => {
    const mutation = { expectedRevision: 0, action: 'checkIn' };
    expect((await handle(request(mutation, { origin: 'https://untrusted.example' }))).status).toBe(
      403,
    );
    expect((await handle(request(mutation, { context: 'other' }))).status).toBe(409);
    expect((await handle(request(undefined, { pendingLogout: true }))).status).toBe(401);
    expect((await handle(request(undefined, { auth: 'Platform invalid' }))).status).toBe(401);
    expect(principal).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });
  it.each(['cookie', 'context'])(
    'rejects a native bearer mixed with a browser %s before checking either identity',
    async (source) => {
      const mixed = request(undefined, { native: true });
      if (source === 'cookie')
        mixed.cookies.set(SESSION_COOKIE, sealCookie(SESSION_COOKIE, session()));
      else mixed.headers.set('X-Campus-Session', sessionContext(session()));
      const response = await handle(mixed);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'AMBIGUOUS_AUTHENTICATION' });
      expect(principal).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(mutate).not.toHaveBeenCalled();
    },
  );
  it('accepts JSON with a charset but rejects prefix lookalikes and malformed JSON before a mutation', async () => {
    const valid = request({ expectedRevision: 0, action: 'checkIn' }, { native: true });
    valid.headers.set('Content-Type', 'application/json; charset=utf-8');
    expect((await handle(valid)).status).toBe(200);
    const wrongType = request({ expectedRevision: 0, action: 'checkIn' }, { native: true });
    wrongType.headers.set('Content-Type', 'application/jsonx');
    const unsupported = await handle(wrongType);
    expect(unsupported.status).toBe(415);
    expect(await unsupported.json()).toEqual({ error: 'UNSUPPORTED_MEDIA_TYPE' });
    const malformed = new NextRequest('https://nuni.tw/api/nuni/account-demo', {
      method: 'POST',
      headers: {
        Authorization: 'Platform ' + session().sessionHandle,
        'Content-Type': 'application/json',
      },
      body: '{',
    });
    const invalid = await handle(malformed);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'INVALID_INPUT' });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(principal).toHaveBeenCalledTimes(1);
  });
  it('rechecks revoked upstream sessions before reading or writing', async () => {
    principal.mockRejectedValue(new NuniError(401, 'SIGN_IN_REQUIRED'));
    expect((await handle(request())).status).toBe(401);
    expect(
      (await handle(request({ expectedRevision: 0, action: 'checkIn' }, { native: true }))).status,
    ).toBe(401);
    expect(read).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });
  it('rejects query selectors and returns only a generic database failure', async () => {
    expect((await handle(request(undefined, { query: '?accountId=' + otherId }))).status).toBe(400);
    read.mockRejectedValue(new Error('postgres://private-secret'));
    const response = await handle(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'ACCOUNT_DEMO_STORE_UNAVAILABLE' });
  });
});
