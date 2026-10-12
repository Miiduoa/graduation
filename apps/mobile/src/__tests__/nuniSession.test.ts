import { NuniError } from '@campus/shared/src/nuni';
import {
  NuniSessionController,
  type NuniSessionDependencies,
} from '../services/nuniSessionController';

const account = 'pa_11111111-1111-4111-8111-111111111111';
const handle = `ps_${'a'.repeat(43)}`;
const principal = { authenticated: true, platformAccountId: account, isPlatformOperator: false };
const transaction = {
  kind: 'google-consumer',
  transactionId: `pt_${'b'.repeat(43)}`,
  nonce: 'c'.repeat(43),
  clientId: 'example.apps.googleusercontent.com',
  issuer: 'https://accounts.google.com',
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  expiresInSeconds: 600,
};
const stored = (pendingLogout = false, expiresAt = 100000) =>
  JSON.stringify({ sessionHandle: handle, platformAccountId: account, expiresAt, pendingLogout });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function setup(initial: string | null = null, initialFence = false) {
  let fenced = initialFence;
  const logoutFence = {
    read: jest.fn(async () => fenced),
    mark: jest.fn(async () => {
      fenced = true;
    }),
    clear: jest.fn(async () => {
      fenced = false;
    }),
  };
  let persisted = initial;
  const storage = {
    read: jest.fn(async () => persisted),
    write: jest.fn(async (value: string) => {
      persisted = value;
    }),
    clear: jest.fn(async () => {
      persisted = null;
    }),
  };
  const request = jest.fn<Promise<unknown>, Parameters<NuniSessionDependencies['request']>>(
    async (path) => {
      if (path === 'login-transactions') return transaction;
      if (path === 'sessions')
        return { ...principal, sessionHandle: handle, expiresInSeconds: 3600 };
      if (path === 'sessions/current') return principal;
      if (path === 'logout') return { signedOut: true };
      return {};
    },
  );
  const credential = jest.fn(async () => 'verified-by-server-id-token');
  const controller = new NuniSessionController({
    storage,
    logoutFence,
    request,
    credential,
    clearCredential: jest.fn(async () => {}),
    now: () => 1000,
  });
  return {
    controller,
    storage,
    logoutFence,
    request,
    credential,
    persisted: () => persisted,
    fenced: () => fenced,
  };
}

it('exposes a restored principal only after server verification, never from storage', async () => {
  const { controller, request } = setup(stored());
  const current = deferred<unknown>();
  request.mockImplementationOnce(() => current.promise);
  const refresh = controller.refresh();
  expect(controller.state.session).toBeNull();
  await Promise.resolve();
  current.resolve(principal);
  await refresh;
  expect(controller.state.session).toMatchObject({ platformAccountId: account });
  expect(request).toHaveBeenCalledWith(
    'sessions/current',
    handle,
    undefined,
    expect.any(AbortSignal),
  );
});
it('does not expose offline cached identity and allows a verified retry', async () => {
  const { controller, request } = setup(stored());
  request.mockRejectedValueOnce(new NuniError(0, 'NETWORK_ERROR'));
  await controller.refresh();
  expect(controller.state.session).toBeNull();
  expect(controller.state.error).not.toBe('');
  await controller.refresh();
  expect(controller.state.session).toMatchObject({ platformAccountId: account });
});
it('removes expired secure storage without calling authenticated endpoints', async () => {
  const { controller, storage, request } = setup(stored(false, 999));
  await controller.refresh();
  expect(controller.state.session).toBeNull();
  expect(storage.clear).toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
it('persists pending logout on revoke failure and refuses re-login after restart', async () => {
  const first = setup(stored());
  await first.controller.refresh();
  first.request.mockRejectedValueOnce(new NuniError(0, 'NETWORK_ERROR'));
  await first.controller.logout();
  expect(first.controller.state).toMatchObject({ session: null, pendingLogout: true });
  expect(JSON.parse(first.persisted()!).pendingLogout).toBe(true);
  const second = setup(first.persisted());
  await second.controller.refresh();
  expect(second.request).not.toHaveBeenCalled();
  await expect(second.controller.signIn()).rejects.toMatchObject({ code: 'SIGN_OUT_REQUIRED' });
  await second.controller.logout();
  expect(second.persisted()).toBeNull();
  expect(second.controller.state.pendingLogout).toBe(false);
});
it('treats an already revoked handle as signed out', async () => {
  const { controller, request, persisted } = setup(stored(true));
  await controller.refresh();
  request.mockRejectedValueOnce(new NuniError(401, 'PLATFORM_SESSION_INVALID'));
  await controller.logout();
  expect(persisted()).toBeNull();
  expect(controller.state.pendingLogout).toBe(false);
});
it('rejects an old screen context before sending a mutation', async () => {
  const { controller, request } = setup(stored());
  await controller.refresh();
  const previous = controller.state.session!.context;
  await controller.refresh();
  const calls = request.mock.calls.length;
  await expect(
    controller.request('class-workspaces', previous, { title: 'stale write' }),
  ).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(request).toHaveBeenCalledTimes(calls);
});
it('aborts and rejects a read whose result arrives after logout', async () => {
  const { controller, request } = setup(stored());
  await controller.refresh();
  const late = deferred<unknown>();
  request.mockImplementationOnce(() => late.promise);
  const reading = controller.request('class-workspaces', controller.state.session!.context);
  const result = expect(reading).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  const signal = request.mock.calls[1][3]!;
  await controller.logout();
  expect(signal.aborted).toBe(true);
  late.resolve({ workspaces: [] });
  await result;
});
it('uses the same consumer transaction as Web, verifies current session, and stores no cached principal role', async () => {
  const { controller, request, credential, persisted } = setup();
  await controller.refresh();
  await expect(controller.signIn()).resolves.toBe('signed-in');
  expect(credential).toHaveBeenCalledWith(transaction.clientId, transaction.nonce);
  expect(request).toHaveBeenCalledWith(
    'sessions',
    undefined,
    {
      kind: 'google-consumer',
      transactionId: transaction.transactionId,
      nonce: transaction.nonce,
      idToken: 'verified-by-server-id-token',
    },
    expect.any(AbortSignal),
  );
  expect(JSON.parse(persisted()!)).not.toHaveProperty('isPlatformOperator');
});
it('prevents double login and treats credential cancellation as cancellation', async () => {
  const { controller, credential } = setup();
  await controller.refresh();
  const late = deferred<string>();
  credential.mockImplementationOnce(() => late.promise);
  const first = controller.signIn();
  await expect(controller.signIn()).rejects.toMatchObject({ code: 'SIGN_IN_BUSY' });
  late.resolve('valid-id-token');
  await first;
  await controller.logout();
  credential.mockRejectedValueOnce({ code: 'CANCELLED' });
  await expect(controller.signIn()).resolves.toBe('cancelled');
  expect(controller.state.error).toBe('');
});
it('revokes a late successful token exchange after logout instead of restoring the account', async () => {
  const { controller, request } = setup();
  await controller.refresh();
  const late = deferred<unknown>();
  request.mockImplementation(async (path) =>
    path === 'login-transactions'
      ? transaction
      : path === 'sessions'
        ? late.promise
        : { signedOut: true },
  );
  const login = controller.signIn();
  const rejected = expect(login).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  while (!request.mock.calls.some(([path]) => path === 'sessions')) await Promise.resolve();
  await controller.logout();
  late.resolve({ ...principal, sessionHandle: handle, expiresInSeconds: 3600 });
  await rejected;
  expect(request).toHaveBeenCalledWith('logout', handle, {});
  expect(controller.state.session).toBeNull();
});
it('revokes a created session when secure storage cannot save it', async () => {
  const { controller, request, storage } = setup();
  await controller.refresh();
  storage.write.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(controller.signIn()).rejects.toThrow('storage unavailable');
  expect(request).toHaveBeenCalledWith('logout', handle, {});
  expect(controller.state.session).toBeNull();
});
it('logout during startup still revokes the stored account', async () => {
  const { controller, request } = setup(stored());
  await controller.logout();
  expect(request).toHaveBeenCalledWith('logout', handle, {}, expect.any(AbortSignal));
  expect(controller.state.session).toBeNull();
});
it('still revokes remotely when saving the pending logout marker fails', async () => {
  const { controller, request, storage, persisted } = setup(stored());
  await controller.refresh();
  storage.write.mockRejectedValueOnce(new Error('storage pressure'));
  await controller.logout();
  expect(request).toHaveBeenCalledWith('logout', handle, {}, expect.any(AbortSignal));
  expect(persisted()).toBeNull();
  expect(controller.state.pendingLogout).toBe(false);
});
it('does not accept a current-session principal for another account', async () => {
  const { controller, request } = setup(stored());
  request.mockResolvedValueOnce({
    ...principal,
    platformAccountId: 'pa_22222222-2222-4222-8222-222222222222',
  });
  await controller.refresh();
  expect(controller.state.session).toBeNull();
  expect(controller.state.error).not.toBe('');
});
it('clears a sign-in storage write that completes after logout has already cleared the account', async () => {
  const { controller, storage, persisted } = setup();
  await controller.refresh();
  const write = storage.write.getMockImplementation()!;
  const late = deferred<void>();
  storage.write.mockImplementationOnce(async (value) => {
    await late.promise;
    await write(value);
  });
  const signingIn = controller.signIn();
  const rejected = expect(signingIn).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  for (let i = 0; i < 20 && !storage.write.mock.calls.length; i++) await Promise.resolve();
  expect(storage.write).toHaveBeenCalledTimes(1);
  await controller.logout();
  expect(persisted()).toBeNull();
  late.resolve();
  await rejected;
  expect(persisted()).toBeNull();
  expect(controller.state.session).toBeNull();
});

it('keeps a durable independent fence when secure writes fail and logout is offline', async () => {
  const first = setup(stored());
  await first.controller.refresh();
  first.storage.write.mockRejectedValue(new Error('keychain unavailable'));
  first.storage.clear.mockRejectedValue(new Error('keychain unavailable'));
  first.request.mockRejectedValueOnce(new NuniError(0, 'NETWORK_ERROR'));
  await first.controller.logout();
  expect(first.fenced()).toBe(true);
  expect(JSON.parse(first.persisted()!).pendingLogout).toBe(false);
  const second = setup(first.persisted(), first.fenced());
  await second.controller.refresh();
  expect(second.controller.state).toMatchObject({ session: null, pendingLogout: true });
  expect(second.request).not.toHaveBeenCalled();
  await expect(second.controller.signIn()).rejects.toMatchObject({ code: 'SIGN_OUT_REQUIRED' });
  await second.controller.logout();
  expect(second.fenced()).toBe(false);
  expect(second.persisted()).toBeNull();
});
it.each([{}, { signedOut: false }, { authenticated: false }])(
  'does not accept an invalid logout receipt: %j',
  async (receipt) => {
    const { controller, request, persisted, fenced } = setup(stored());
    await controller.refresh();
    request.mockResolvedValueOnce(receipt);
    await controller.logout();
    expect(controller.state).toMatchObject({ session: null, pendingLogout: true });
    expect(persisted()).not.toBeNull();
    expect(fenced()).toBe(true);
  },
);
it('keeps failed-login cleanup pending when the server does not confirm revocation', async () => {
  const { controller, request, storage, fenced } = setup();
  await controller.refresh();
  storage.write.mockRejectedValueOnce(new Error('storage unavailable'));
  request.mockImplementation(async (path) =>
    path === 'login-transactions'
      ? transaction
      : path === 'sessions'
        ? { ...principal, sessionHandle: handle, expiresInSeconds: 3600 }
        : path === 'sessions/current'
          ? principal
          : { signedOut: false },
  );
  await expect(controller.signIn()).rejects.toThrow('storage unavailable');
  expect(controller.state).toMatchObject({ session: null, pendingLogout: true });
  expect(fenced()).toBe(true);
});
it('fails closed when the independent logout fence cannot be read on restart', async () => {
  const { controller, logoutFence, request } = setup(stored());
  logoutFence.read.mockRejectedValue(new Error('disk unavailable'));
  await controller.refresh();
  expect(controller.state.session).toBeNull();
  expect(controller.state.error).not.toBe('');
  expect(request).not.toHaveBeenCalled();
});
