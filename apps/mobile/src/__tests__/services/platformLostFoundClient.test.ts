import { NuniError } from '@campus/shared/src/nuni';
import { createPlatformLostFoundClient } from '../../services/platformLostFoundClient';
import {
  NuniSessionController,
  type NuniSessionDependencies,
} from '../../services/nuniSessionController';

const accountId = 'pa_11111111-1111-4111-8111-111111111111';
const handle = `ps_${'a'.repeat(43)}`;
const principal = { authenticated: true, platformAccountId: accountId, isPlatformOperator: false };
const createInput = {
  schoolId: 'pu',
  id: 'plf_33333333-3333-4333-8333-333333333333',
  mutationId: 'one-stable-intent',
  fields: {
    type: 'lost' as const,
    title: '水壺',
    description: '白色水壺',
    category: 'other',
    location: '操場',
    date: '2026-11-07',
    contactInfo: '',
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup() {
  let saved: string | null = JSON.stringify({
    sessionHandle: handle,
    platformAccountId: accountId,
    expiresAt: 100_000,
    pendingLogout: false,
  });
  const storage = {
    read: jest.fn(async () => saved),
    write: jest.fn(async (value: string) => {
      saved = value;
    }),
    clear: jest.fn(async () => {
      saved = null;
    }),
  };
  const transport = jest.fn<Promise<unknown>, Parameters<NuniSessionDependencies['request']>>(
    async (path) => {
      if (path === 'sessions/current') return principal;
      if (path === 'logout') return { signedOut: true };
      return { schoolId: 'pu', items: [], nextCursor: null };
    },
  );
  const credential = jest.fn(async () => 'unused');
  const controller = new NuniSessionController({
    storage,
    request: transport,
    credential,
    clearCredential: jest.fn(async () => undefined),
    now: () => 1000,
    logoutFence: {
      read: async () => false,
      mark: async () => undefined,
      clear: async () => undefined,
    },
  });
  await controller.refresh();
  const context = controller.state.session!.context;
  const client = createPlatformLostFoundClient({
    accountId,
    context,
    request: controller.request,
    isCurrent: () => controller.isSessionCurrent(accountId, context),
  });
  return { client, controller, transport, storage, credential, context };
}

test('normal platform reads do not issue any compatibility probes', async () => {
  const { client, transport } = await setup();
  await expect(client.list({ schoolId: 'pu' })).resolves.toEqual({
    schoolId: 'pu',
    items: [],
    nextCursor: null,
  });
  expect(transport.mock.calls.map(([path]) => path)).toEqual([
    'sessions/current',
    'lost-found/list',
  ]);
});

test.each(['list', 'create'] as const)(
  'an old API 401 for %s preserves a freshly proven Google session without replaying the request',
  async (action) => {
    const { client, controller, transport, storage, credential, context } = await setup();
    const states: { loading: boolean; account: string | undefined; context: string | undefined }[] =
      [];
    controller.subscribe((state) =>
      states.push({
        loading: state.loading,
        account: state.session?.platformAccountId,
        context: state.session?.context,
      }),
    );
    transport.mockImplementation(async (path) => {
      if (path === 'sessions/current') return principal;
      throw new NuniError(401, 'CAMPUS_AUTH_REQUIRED');
    });
    const operation =
      action === 'list' ? client.list({ schoolId: 'pu' }) : client.create(createInput);
    await expect(operation).rejects.toMatchObject({ status: 503, code: 'LOST_FOUND_UNAVAILABLE' });
    expect(transport.mock.calls.filter(([path]) => path === `lost-found/${action}`)).toHaveLength(
      1,
    );
    expect(transport.mock.calls.filter(([path]) => path === 'sessions/current')).toHaveLength(3);
    expect(states.length).toBeGreaterThan(0);
    expect(
      states.every(
        (state) => !state.loading && state.account === accountId && state.context === context,
      ),
    ).toBe(true);
    expect(controller.isSessionCurrent(accountId, context)).toBe(true);
    expect(storage.clear).not.toHaveBeenCalled();
    expect(credential).not.toHaveBeenCalled();
    expect(transport.mock.calls.every(([, credentialHandle]) => credentialHandle === handle)).toBe(
      true,
    );
  },
);

test('a retained in-memory session after an offline refresh is insufficient until the explicit probe succeeds', async () => {
  const { client, controller, transport, context } = await setup();
  let currentReads = 0;
  transport.mockImplementation(async (path) => {
    if (path === 'sessions/current') {
      if (++currentReads === 1) throw new NuniError(0, 'NETWORK_ERROR');
      return principal;
    }
    throw new NuniError(401, 'CAMPUS_AUTH_REQUIRED');
  });
  await expect(client.create(createInput)).rejects.toMatchObject({
    status: 503,
    code: 'LOST_FOUND_UNAVAILABLE',
  });
  expect(currentReads).toBe(2);
  expect(controller.isSessionCurrent(accountId, context)).toBe(true);
  expect(transport.mock.calls.filter(([path]) => path === 'lost-found/create')).toHaveLength(1);
});

test('a failed proof of current identity is not mislabeled as a verified unavailable feature', async () => {
  const { client, controller, transport, context } = await setup();
  transport.mockImplementation(async (path) => {
    if (path === 'sessions/current') throw new NuniError(0, 'NETWORK_ERROR');
    throw new NuniError(401, 'CAMPUS_AUTH_REQUIRED');
  });
  await expect(client.list({ schoolId: 'pu' })).rejects.toMatchObject({
    status: 0,
    code: 'NETWORK_ERROR',
  });
  expect(controller.isSessionCurrent(accountId, context)).toBe(true);
  expect(transport.mock.calls.filter(([path]) => path === 'lost-found/list')).toHaveLength(1);
});

test.each([
  { ...principal, platformAccountId: 'pa_22222222-2222-4222-8222-222222222222' },
  { authenticated: false },
])('a malformed or different-account proof is rejected: %j', async (proof) => {
  const { client, transport } = await setup();
  let currentReads = 0;
  transport.mockImplementation(async (path) => {
    if (path === 'sessions/current') return ++currentReads === 1 ? principal : proof;
    throw new NuniError(401, 'CAMPUS_AUTH_REQUIRED');
  });
  await expect(client.list({ schoolId: 'pu' })).rejects.toMatchObject({
    status: 502,
    code: 'INVALID_RESPONSE',
  });
  expect(transport.mock.calls.filter(([path]) => path === 'lost-found/list')).toHaveLength(1);
});

test('a truly revoked Google session still follows the existing controller sign-out boundary', async () => {
  const { client, controller, transport, storage } = await setup();
  transport.mockRejectedValue(new NuniError(401, 'PLATFORM_SESSION_INVALID'));
  await expect(client.create(createInput)).rejects.toMatchObject({
    status: 409,
    code: 'SESSION_CHANGED',
  });
  expect(controller.state.session).toBeNull();
  expect(storage.clear).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls.filter(([path]) => path === 'lost-found/create')).toHaveLength(1);
  expect(transport.mock.calls.filter(([path]) => path === 'sessions/current')).toHaveLength(2);
});

test('logout during a same-context proof prevents its late result from reauthorizing the feature', async () => {
  const { client, controller, transport } = await setup();
  const proof = deferred<unknown>();
  let currentReads = 0;
  transport.mockImplementation(async (path) => {
    if (path === 'sessions/current') return ++currentReads === 1 ? principal : proof.promise;
    if (path === 'logout') return { signedOut: true };
    throw new NuniError(401, 'CAMPUS_AUTH_REQUIRED');
  });
  const running = client.list({ schoolId: 'pu' });
  const rejected = expect(running).rejects.toMatchObject({ status: 409, code: 'SESSION_CHANGED' });
  for (let index = 0; index < 50 && currentReads < 2; index += 1) await Promise.resolve();
  expect(currentReads).toBe(2);
  await controller.logout();
  proof.resolve(principal);
  await rejected;
  expect(controller.state.session).toBeNull();
  expect(transport.mock.calls.filter(([path]) => path === 'lost-found/list')).toHaveLength(1);
});
