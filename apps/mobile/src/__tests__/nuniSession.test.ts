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
function setup(initial: string | null = null, initialFence = false, now = () => 1000) {
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
  const clearCredential = jest.fn(async () => {});
  const savedPlansCleanup = {
    begin: jest.fn(async () => {}),
    end: jest.fn(() => {}),
  };
  const controller = new NuniSessionController({
    storage,
    logoutFence,
    savedPlansCleanup,
    request,
    credential,
    clearCredential,
    now,
  });
  return {
    controller,
    storage,
    logoutFence,
    request,
    credential,
    clearCredential,
    savedPlansCleanup,
    persisted: () => persisted,
    fenced: () => fenced,
  };
}

async function liveForegroundCurrent(
  status: 401 | 409,
  code: string,
): Promise<{
  controller: NuniSessionController;
  storage: ReturnType<typeof setup>['storage'];
  persisted: () => string | null;
  context: string;
  finishRead: () => Promise<void>;
}> {
  const { controller, request, storage, persisted } = setup(stored());
  await controller.refresh();
  const context = controller.state.session!.context;
  expect(controller.isSessionCurrent(account, context)).toBe(true);
  const pending = deferred<unknown>();
  request.mockImplementationOnce(() => pending.promise);
  const reading = controller.request('class-workspaces', context);
  const rejected = expect(reading).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  const signal = request.mock.calls.at(-1)![3]!;
  expect(signal.aborted).toBe(false);
  let settle!: (reason: unknown) => void;
  const current = new Promise<unknown>((_ok, fail) => {
    settle = fail;
  });
  const before = request.mock.calls.filter(([path]) => path === 'sessions/current').length;
  request.mockImplementationOnce(() => current);
  const refresh = controller.refresh();
  for (let i = 0; i < 30 && request.mock.calls.filter(([path]) => path === 'sessions/current').length === before; i++) {
    await Promise.resolve();
  }
  expect(controller.state).toMatchObject({
    loading: false,
    session: expect.objectContaining({ platformAccountId: account, context }),
  });
  expect(controller.isSessionCurrent(account, context)).toBe(true);
  expect(signal.aborted).toBe(false);
  settle(new NuniError(status, code));
  await refresh;
  expect(controller.state.session).toBeNull();
  expect(signal.aborted).toBe(true);
  expect(controller.isSessionCurrent(account, context)).toBe(false);
  return {
    controller,
    storage,
    persisted,
    context,
    finishRead: async () => {
      pending.resolve({ workspaces: [] });
      await rejected;
    },
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
it('authorizes local reads only for the verified account, current session and unexpired lifetime', async () => {
  let clock = 1000;
  const { controller, request } = setup(stored(false, 2000), false, () => clock);
  expect(controller.isSessionCurrent(account, '')).toBe(false);
  await controller.refresh();
  const context = controller.state.session!.context;
  expect(controller.state.session!.expiresAt).toBe(2000);
  expect(controller.isSessionCurrent(account, context)).toBe(true);
  expect(controller.isSessionCurrent('other-account', context)).toBe(false);
  expect(controller.isSessionCurrent(account, 'old-session')).toBe(false);
  clock = 2000;
  expect(controller.isSessionCurrent(account, context)).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
  clock = 1999;
  const refresh = controller.refresh();
  expect(controller.state).toMatchObject({ loading: false, session: expect.objectContaining({ context }) });
  expect(controller.isSessionCurrent(account, context)).toBe(true);
  await refresh;
  expect(controller.state.session!.context).toBe(context);
  expect(controller.isSessionCurrent(account, context)).toBe(true);
  controller.dispose();
  expect(controller.isSessionCurrent(account, context)).toBe(false);
});

it('keeps an unexpired verified session across a foreground refresh and clears it when expired', async () => {
  let clock = 1000;
  const { controller, request } = setup(stored(false, 5000), false, () => clock);
  await controller.refresh();
  const context = controller.state.session!.context;
  const during = deferred<unknown>();
  request.mockImplementationOnce(() => during.promise);
  const refresh = controller.refresh();
  expect(controller.state.session).toMatchObject({ platformAccountId: account, context });
  expect(controller.state.loading).toBe(false);
  expect(controller.isSessionCurrent(account, context)).toBe(true);
  during.resolve(principal);
  await refresh;
  expect(controller.state.session!.context).toBe(context);
  expect(controller.isSessionCurrent(account, context)).toBe(true);
  clock = 5000;
  await controller.refresh();
  expect(controller.state.session).toBeNull();
  expect(controller.state.error).toBe('登入已逾時，請重新登入。');
  expect(controller.isSessionCurrent(account, context)).toBe(false);
});

it('forgets a live session when foreground refresh sees PLATFORM_SESSION_INVALID', async () => {
  const closed = await liveForegroundCurrent(401, 'PLATFORM_SESSION_INVALID');
  expect(closed.storage.clear).toHaveBeenCalled();
  expect(closed.persisted()).toBeNull();
  await closed.finishRead();
});

it('drops a live session when foreground refresh sees a 409 current-session conflict', async () => {
  const closed = await liveForegroundCurrent(409, 'SESSION_CHANGED');
  expect(closed.controller.state.error).not.toBe('');
  expect(closed.controller.isSessionCurrent(account, closed.context)).toBe(false);
  await closed.finishRead();
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

it('binds paginated food reads to the captured account and aborts them on logout', async () => {
  const { controller, request } = setup(stored());
  await controller.refresh();
  const context = controller.state.session!.context;
  const page = deferred<unknown>();
  request.mockImplementationOnce(() => page.promise);
  const read = controller.request('realms/school-one/food/orders', context, undefined, undefined, {
    cursor: 'next-page',
    limit: '25',
  });
  const rejection = expect(read).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  const signal = request.mock.calls.at(-1)![3]!;
  expect(request).toHaveBeenLastCalledWith(
    'realms/school-one/food/orders',
    handle,
    undefined,
    signal,
    undefined,
    { cursor: 'next-page', limit: '25' },
  );
  await controller.logout();
  expect(signal.aborted).toBe(true);
  page.resolve({ orders: [] });
  await rejection;
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
  expect(controller.state.session!.context).toBe(previous);
  const calls = request.mock.calls.length;
  await expect(
    controller.request('class-workspaces', 'stale-context', { title: 'stale write' }),
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
  expect(controller.state.session!.expiresAt).toBe(3_601_000);
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

it('binds a merchant settings PUT to the current account and aborts it on logout', async () => {
  const { controller, request } = setup(stored());
  await controller.refresh();
  const context = controller.state.session!.context;
  const update = deferred<unknown>();
  request.mockImplementationOnce(() => update.promise);
  const pending = controller.request(
    'merchant-workspaces/school-one/location-one/settings',
    context,
    { expectedVersion: 1 },
    'PUT',
  );
  const rejected = expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  const last = request.mock.calls.at(-1)!;
  expect(last[0]).toBe('merchant-workspaces/school-one/location-one/settings');
  expect(last[4]).toBe('PUT');
  await controller.logout();
  expect(last[3]?.aborted).toBe(true);
  update.resolve({ readinessVersion: 2 });
  await rejected;
});

it('fences saved plans synchronously and attempts server revocation before a pending local cleanup completes', async () => {
  const { controller, storage, request, savedPlansCleanup, fenced } = setup(stored());
  const cleanup = deferred<void>();
  savedPlansCleanup.begin.mockReturnValueOnce(cleanup.promise);
  const logout = controller.logout();
  expect(savedPlansCleanup.begin).toHaveBeenCalledTimes(1);
  expect(storage.read).not.toHaveBeenCalled();
  for (let i = 0; i < 20 && !request.mock.calls.length; i++) await Promise.resolve();
  expect(request).toHaveBeenCalledWith('logout', handle, {}, expect.any(AbortSignal));
  expect(fenced()).toBe(true);
  expect(storage.clear).not.toHaveBeenCalled();
  expect(savedPlansCleanup.end).not.toHaveBeenCalled();
  expect(controller.state).toMatchObject({ session: null, loading: true, pendingLogout: true });
  cleanup.resolve();
  await logout;
  expect(savedPlansCleanup.end).toHaveBeenCalledTimes(1);
  expect(controller.state).toEqual({ session: null, loading: false, error: '', pendingLogout: false });
});

it.each(['rejected', 'thrown'] as const)('keeps failed saved-plan cleanup retryable (%s) while still revoking the server session', async (failure) => {
  const { controller, savedPlansCleanup, clearCredential, request, persisted, fenced } = setup(stored());
  await controller.refresh();
  if (failure === 'thrown') savedPlansCleanup.begin.mockImplementationOnce(() => { throw new Error('disk'); });
  else savedPlansCleanup.begin.mockRejectedValueOnce(new Error('disk'));
  clearCredential.mockRejectedValueOnce(new Error('Google chooser'));
  await controller.logout();
  expect(request).toHaveBeenCalledWith('logout', handle, {}, expect.any(AbortSignal));
  expect(clearCredential).toHaveBeenCalledTimes(1);
  expect(controller.state).toEqual({
    session: null, loading: false, pendingLogout: true,
    error: '手機內的已儲存計畫尚未清除，請重試登出。',
  });
  expect(fenced()).toBe(true);
  expect(JSON.parse(persisted()!).pendingLogout).toBe(true);
  expect(savedPlansCleanup.end).toHaveBeenCalledTimes(1);
  await controller.refresh();
  expect(controller.state.error).toContain('已儲存計畫尚未清除');
  await expect(controller.signIn()).rejects.toMatchObject({ code: 'SIGN_OUT_REQUIRED' });
  await controller.logout();
  expect(savedPlansCleanup.begin).toHaveBeenCalledTimes(2);
  expect(savedPlansCleanup.end).toHaveBeenCalledTimes(2);
  expect(persisted()).toBeNull();
  expect(fenced()).toBe(false);
  expect(controller.state).toEqual({ session: null, loading: false, error: '', pendingLogout: false });
});

it('preserves a pending cleanup across restart even after the secure credential is absent', async () => {
  const first = setup();
  await first.controller.refresh();
  first.savedPlansCleanup.begin.mockRejectedValueOnce(new Error('local cleanup failed'));
  await first.controller.logout();
  expect(first.persisted()).toBeNull();
  expect(first.fenced()).toBe(true);
  const second = setup(first.persisted(), first.fenced());
  await second.controller.refresh();
  expect(second.controller.state).toMatchObject({ session: null, pendingLogout: true });
  expect(second.logoutFence.clear).not.toHaveBeenCalled();
  expect(second.request).not.toHaveBeenCalled();
  await expect(second.controller.signIn()).rejects.toMatchObject({ code: 'SIGN_OUT_REQUIRED' });
  await second.controller.logout();
  expect(second.savedPlansCleanup.begin).toHaveBeenCalledTimes(1);
  expect(second.fenced()).toBe(false);
  expect(second.controller.state.pendingLogout).toBe(false);
});

it('retains the secure pending marker when the independent fence and saved-plan cleanup fail', async () => {
  const first = setup(stored());
  await first.controller.refresh();
  first.logoutFence.mark.mockRejectedValue(new Error('AsyncStorage unavailable'));
  first.savedPlansCleanup.begin.mockRejectedValueOnce(new Error('plans unavailable'));
  await first.controller.logout();
  expect(first.request).toHaveBeenCalledWith('logout', handle, {}, expect.any(AbortSignal));
  expect(first.fenced()).toBe(false);
  expect(JSON.parse(first.persisted()!).pendingLogout).toBe(true);
  expect(first.storage.clear).not.toHaveBeenCalled();
  const second = setup(first.persisted(), first.fenced());
  await second.controller.refresh();
  expect(second.controller.state.pendingLogout).toBe(true);
  expect(second.request).not.toHaveBeenCalled();
  await second.controller.logout();
  expect(second.persisted()).toBeNull();
  expect(second.controller.state.pendingLogout).toBe(false);
});

it('does not mislabel a failed fence removal as Google credential cleanup and retries without a session', async () => {
  const { controller, logoutFence, savedPlansCleanup, persisted, fenced } = setup(stored());
  await controller.refresh();
  logoutFence.clear.mockRejectedValueOnce(new Error('disk unavailable'));
  await controller.logout();
  expect(persisted()).toBeNull();
  expect(fenced()).toBe(true);
  expect(controller.state.pendingLogout).toBe(true);
  expect(controller.state.error).toContain('請重試');
  expect(controller.state.error).not.toContain('Google');
  await controller.refresh();
  expect(controller.state.pendingLogout).toBe(true);
  await controller.logout();
  expect(savedPlansCleanup.begin).toHaveBeenCalledTimes(2);
  expect(controller.state.error).toBe('');
  expect(fenced()).toBe(false);
});

it('completes saved-plan cleanup even when the server cannot confirm logout', async () => {
  const { controller, request, savedPlansCleanup, clearCredential, fenced } = setup(stored());
  await controller.refresh();
  request.mockRejectedValueOnce(new NuniError(0, 'NETWORK_ERROR'));
  await controller.logout();
  expect(savedPlansCleanup.begin).toHaveBeenCalledTimes(1);
  expect(savedPlansCleanup.end).toHaveBeenCalledTimes(1);
  expect(clearCredential).toHaveBeenCalledTimes(1);
  expect(fenced()).toBe(true);
  expect(controller.state.pendingLogout).toBe(true);
});

it('a late token exchange cannot clear the fence for failed saved-plan cleanup', async () => {
  const { controller, request, savedPlansCleanup, logoutFence, fenced } = setup();
  await controller.refresh();
  const late = deferred<unknown>();
  request.mockImplementation(async (path) =>
    path === 'login-transactions' ? transaction : path === 'sessions' ? late.promise : { signedOut: true },
  );
  const login = controller.signIn();
  const rejected = expect(login).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  for (let i = 0; i < 40 && !request.mock.calls.some(([path]) => path === 'sessions'); i++) await Promise.resolve();
  expect(request.mock.calls.some(([path]) => path === 'sessions')).toBe(true);
  savedPlansCleanup.begin.mockRejectedValueOnce(new Error('disk'));
  await controller.logout();
  late.resolve({ ...principal, sessionHandle: handle, expiresInSeconds: 3600 });
  await rejected;
  expect(request).toHaveBeenCalledWith('logout', handle, {});
  expect(logoutFence.clear).not.toHaveBeenCalled();
  expect(fenced()).toBe(true);
  expect(controller.state).toMatchObject({ session: null, pendingLogout: true });
  expect(controller.state.error).toContain('已儲存計畫尚未清除');
  await controller.logout();
  expect(fenced()).toBe(false);
});

it('keeps the Google-only error distinct after the session and saved plans are cleared', async () => {
  const { controller, clearCredential, persisted, fenced } = setup(stored());
  await controller.refresh();
  clearCredential.mockRejectedValueOnce(new Error('chooser'));
  await controller.logout();
  expect(controller.state).toEqual({
    session: null, loading: false, pendingLogout: false,
    error: '已登出；裝置上的 Google 帳號選擇狀態尚未清除。',
  });
  expect(persisted()).toBeNull();
  expect(fenced()).toBe(false);
});

it('removes a late pending-credential fallback write when logout finishes while that write is in flight', async () => {
  const { controller, storage, savedPlansCleanup, persisted, fenced } = setup();
  await controller.refresh();
  const write = storage.write.getMockImplementation()!;
  const loginWrite = deferred<void>();
  const fallbackWrite = deferred<void>();
  const cleanup = deferred<void>();
  storage.write
    .mockImplementationOnce(async (value) => { await loginWrite.promise; await write(value); })
    .mockImplementationOnce(write)
    .mockImplementationOnce(async (value) => { await fallbackWrite.promise; await write(value); });
  const login = controller.signIn();
  const rejected = expect(login).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  for (let i = 0; i < 40 && storage.write.mock.calls.length < 1; i++) await Promise.resolve();
  expect(storage.write).toHaveBeenCalledTimes(1);
  savedPlansCleanup.begin.mockReturnValueOnce(cleanup.promise);
  const logout = controller.logout();
  for (let i = 0; i < 40 && storage.write.mock.calls.length < 2; i++) await Promise.resolve();
  expect(storage.write).toHaveBeenCalledTimes(2);
  loginWrite.resolve();
  for (let i = 0; i < 40 && storage.write.mock.calls.length < 3; i++) await Promise.resolve();
  expect(storage.write).toHaveBeenCalledTimes(3);
  cleanup.resolve();
  await logout;
  expect(persisted()).toBeNull();
  fallbackWrite.resolve();
  await rejected;
  expect(persisted()).toBeNull();
  expect(fenced()).toBe(false);
  expect(controller.state).toMatchObject({ session: null, pendingLogout: false });
});
