// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import {
  createDefaultPlatformAssistantPermissions,
  parsePlatformAssistantPermissionState,
} from '@campus/shared/src/platformAssistantPermissions';
import { resetAssignmentFileStores, setAssignmentFilePoolFactory } from './assignmentFileStore';
import {
  createSqlPlatformAssistantPermissionStore,
  resolvePlatformAssistantPermissionStore,
} from './platformAssistantPermissionStore';

const accountId = 'pa_11111111-1111-4111-8111-111111111111';
const otherId = 'pa_22222222-2222-4222-8222-222222222222';
const enabled = { createPersonalEvent: true, prepareFoodOrder: true };
const row = (revision: number | null, calendar: unknown, food: unknown) => ({
  account_id: accountId,
  revision,
  create_personal_event: calendar,
  prepare_food_order: food,
});

afterEach(() => resetAssignmentFileStores());

it('returns closed defaults only for an existing account without a preference row', async () => {
  const query = vi.fn().mockResolvedValue([row(null, null, null)]);
  const store = createSqlPlatformAssistantPermissionStore(query);
  expect(await store.read(accountId)).toEqual({
    scope: 'platform-account',
    accountId,
    revision: 0,
    permissions: createDefaultPlatformAssistantPermissions(),
  });
  query.mockResolvedValue([]);
  await expect(store.read(accountId)).rejects.toMatchObject({
    status: 401,
    code: 'SIGN_IN_REQUIRED',
  });
});

it('reads a new authority snapshot each time, including a saved revocation', async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([row(1, true, true)])
    .mockResolvedValueOnce([row(2, false, true)]);
  const store = createSqlPlatformAssistantPermissionStore(query);
  expect((await store.read(accountId)).permissions.createPersonalEvent).toBe(true);
  expect((await store.read(accountId)).permissions.createPersonalEvent).toBe(false);
  expect(query).toHaveBeenCalledTimes(2);
});

it.each([
  row(1, 'true', false),
  row(-1, true, true),
  row(0, true, true),
  row(null, true, null),
  { ...row(1, true, true), account_id: otherId },
])('fails closed on corrupt or cross-account database state', async (value) => {
  const store = createSqlPlatformAssistantPermissionStore(async () => [value]);
  await expect(store.read(accountId)).rejects.toMatchObject({
    status: 503,
    code: 'ASSISTANT_PERMISSION_STORE_UNAVAILABLE',
  });
});

it('returns a confirmed revision only when all saved fields match the request', async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([row(1, true, true)])
    .mockResolvedValueOnce([row(2, false, true)]);
  const store = createSqlPlatformAssistantPermissionStore(query);
  expect((await store.save(accountId, 0, enabled)).revision).toBe(1);
  await expect(store.save(accountId, 1, enabled)).rejects.toMatchObject({ status: 503 });
});

it('distinguishes a revision conflict from an unavailable account', async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([row(null, null, null)])
    .mockResolvedValueOnce([]);
  const store = createSqlPlatformAssistantPermissionStore(query);
  await expect(store.save(accountId, 2, enabled)).rejects.toMatchObject({
    status: 409,
    code: 'ASSISTANT_PERMISSION_REVISION_CONFLICT',
  });
  await expect(store.save(accountId, 2, enabled)).rejects.toMatchObject({ status: 401 });
});

it('does not send invalid identity or permission values to PostgreSQL', async () => {
  const query = vi.fn();
  const store = createSqlPlatformAssistantPermissionStore(query);
  await expect(store.read('firebase-user')).rejects.toMatchObject({ status: 401 });
  await expect(store.save(accountId, -1, enabled)).rejects.toMatchObject({ status: 422 });
  await expect(store.save(accountId, 2147483647, enabled)).rejects.toMatchObject({ status: 422 });
  await expect(
    store.save(accountId, 0, { ...enabled, createPersonalEvent: 'true' } as never),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    store.save(accountId, 0, { ...enabled, isAdmin: true } as never),
  ).rejects.toMatchObject({ status: 422 });
  expect(query).not.toHaveBeenCalled();
});

it.each(['production', 'development', 'test'])(
  'never substitutes memory when persistence is missing in %s',
  async (NODE_ENV) => {
    const store = resolvePlatformAssistantPermissionStore({ NODE_ENV });
    await expect(store.read(accountId)).rejects.toMatchObject({ status: 503 });
    await expect(store.save(accountId, 0, enabled)).rejects.toMatchObject({ status: 503 });
  },
);

it('uses the explicit assistant database before existing platform database settings', async () => {
  const connections: string[] = [];
  setAssignmentFilePoolFactory((url) => {
    connections.push(url);
    return { query: async () => ({ rows: [row(1, true, false)] }) };
  });
  const env = {
    PLATFORM_ASSISTANT_DATABASE_URL: 'postgresql://assistant.example/test',
    ASSIGNMENT_FILE_DATABASE_URL: 'postgresql://attachments.example/test',
    DATABASE_URL: 'postgresql://fallback.example/test',
  };
  await resolvePlatformAssistantPermissionStore(env).read(accountId);
  await resolvePlatformAssistantPermissionStore({
    ...env,
    PLATFORM_ASSISTANT_DATABASE_URL: '',
  }).read(accountId);
  await resolvePlatformAssistantPermissionStore({ DATABASE_URL: env.DATABASE_URL }).read(accountId);
  expect(connections).toEqual([
    env.PLATFORM_ASSISTANT_DATABASE_URL,
    env.ASSIGNMENT_FILE_DATABASE_URL,
    env.DATABASE_URL,
  ]);
});

it('does not expose database details when a query fails', async () => {
  const store = createSqlPlatformAssistantPermissionStore(async () => {
    throw new Error('password=test host=internal');
  });
  await expect(store.read(accountId)).rejects.toMatchObject({
    code: 'ASSISTANT_PERMISSION_STORE_UNAVAILABLE',
  });
  await expect(store.save(accountId, 0, enabled)).rejects.toMatchObject({
    code: 'ASSISTANT_PERMISSION_STORE_UNAVAILABLE',
  });
});

it('rejects a fabricated unsaved grant or unknown response field', () => {
  const state = { scope: 'platform-account', accountId, revision: 0, permissions: enabled };
  expect(() => parsePlatformAssistantPermissionState(state)).toThrow();
  expect(() =>
    parsePlatformAssistantPermissionState({ ...state, revision: 1, uid: 'other' }),
  ).toThrow();
});
