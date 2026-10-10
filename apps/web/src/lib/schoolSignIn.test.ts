import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'school-test-key';
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'school-test';
  return {
    signIn: vi.fn(),
    fetch: vi.fn(),
    update: vi.fn(),
    deleteApp: vi.fn(),
    auth: { currentUser: null as null | { uid: string } },
  };
});
vi.mock('firebase/app', async (original) => ({
  ...(await original<typeof import('firebase/app')>()),
  getApps: () => [{ options: { projectId: 'school-test' } }],
  initializeApp: (_options: unknown, name: string) => ({ name }),
  deleteApp: state.deleteApp,
}));
vi.mock('firebase/auth', async (original) => ({
  ...(await original<typeof import('firebase/auth')>()),
  getAuth: () => state.auth,
  initializeAuth: (app: unknown) => ({ app }),
  signInWithCustomToken: state.signIn,
  updateCurrentUser: state.update,
}));
let signInWithPuStudentId: typeof import('./firebase').signInWithPuStudentId;
beforeEach(async () => {
  vi.resetModules();
  ({ signInWithPuStudentId } = await import('./firebase'));
  vi.clearAllMocks();
  state.auth.currentUser = null;
  vi.stubGlobal('fetch', state.fetch);
  state.signIn.mockResolvedValue({ user: { uid: 'student' } });
  state.update.mockImplementation(async (_auth, user) => {
    state.auth.currentUser = user;
  });
  state.deleteApp.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it('passes cancellation to the school request and never applies a late credential', async () => {
  const response = deferred<Response>();
  state.fetch.mockReturnValueOnce(response.promise);
  const controller = new AbortController();
  const pending = signInWithPuStudentId('A1234567', 'test-password', controller.signal);
  expect(state.fetch.mock.calls[0][1].signal).toBe(controller.signal);
  controller.abort();
  response.resolve(Response.json({ customToken: 'test-credential' }));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(state.signIn).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
});
it('establishes a school session for a still-active login task and disposes temporary Auth', async () => {
  state.fetch.mockResolvedValueOnce(Response.json({ customToken: 'test-credential' }));
  await expect(
    signInWithPuStudentId('A1234567', 'test-password', new AbortController().signal),
  ).resolves.toEqual({ uid: 'student' });
  expect(state.signIn.mock.calls[0][0]).not.toBe(state.auth);
  expect(state.update).toHaveBeenCalledWith(state.auth, { uid: 'student' });
  expect(state.deleteApp).toHaveBeenCalledOnce();
});
it('does not replace B when cancelled A completes its Firebase exchange late', async () => {
  const exchange = deferred<{ user: { uid: string } }>();
  state.fetch.mockImplementation(async () => Response.json({ customToken: 'test-credential' }));
  state.signIn.mockReturnValueOnce(exchange.promise).mockResolvedValueOnce({ user: { uid: 'B' } });
  const controller = new AbortController();
  const oldLogin = signInWithPuStudentId('A', 'test-password', controller.signal);
  await vi.waitFor(() => expect(state.signIn).toHaveBeenCalledOnce());
  controller.abort();
  await signInWithPuStudentId('B', 'test-password', new AbortController().signal);
  exchange.resolve({ user: { uid: 'A' } });
  await expect(oldLogin).rejects.toMatchObject({ name: 'AbortError' });
  expect(state.auth.currentUser).toEqual({ uid: 'B' });
  expect(state.update).toHaveBeenCalledOnce();
  expect(state.deleteApp).toHaveBeenCalledTimes(2);
});
it('serializes local commits so newer B follows an A commit that already started', async () => {
  state.fetch.mockImplementation(async () => Response.json({ customToken: 'test-credential' }));
  state.signIn
    .mockResolvedValueOnce({ user: { uid: 'A' } })
    .mockResolvedValueOnce({ user: { uid: 'B' } });
  const commit = deferred<void>();
  state.update.mockImplementationOnce(async (_auth, user) => {
    await commit.promise;
    state.auth.currentUser = user;
  });
  const controller = new AbortController();
  const oldLogin = signInWithPuStudentId('A', 'test-password', controller.signal);
  await vi.waitFor(() => expect(state.update).toHaveBeenCalledOnce());
  controller.abort();
  const newLogin = signInWithPuStudentId('B', 'test-password', new AbortController().signal);
  await vi.waitFor(() => expect(state.signIn).toHaveBeenCalledTimes(2));
  expect(state.update).toHaveBeenCalledOnce();
  commit.resolve();
  await Promise.all([oldLogin, newLogin]);
  expect(state.auth.currentUser).toEqual({ uid: 'B' });
  expect(state.update).toHaveBeenCalledTimes(2);
});
it('rejects a replaced attempt even if the caller did not supply cancellation', async () => {
  const exchange = deferred<{ user: { uid: string } }>();
  state.fetch.mockImplementation(async () => Response.json({ customToken: 'test-credential' }));
  state.signIn.mockReturnValueOnce(exchange.promise).mockResolvedValueOnce({ user: { uid: 'B' } });
  const oldLogin = signInWithPuStudentId('A', 'test-password');
  await vi.waitFor(() => expect(state.signIn).toHaveBeenCalledOnce());
  await signInWithPuStudentId('B', 'test-password');
  exchange.resolve({ user: { uid: 'A' } });
  await expect(oldLogin).rejects.toThrow('登入狀態已變更');
  expect(state.auth.currentUser).toEqual({ uid: 'B' });
});
it('does not overwrite a different main identity established during the staged exchange', async () => {
  const exchange = deferred<{ user: { uid: string } }>();
  state.fetch.mockResolvedValueOnce(Response.json({ customToken: 'test-credential' }));
  state.signIn.mockReturnValueOnce(exchange.promise);
  const pending = signInWithPuStudentId('A', 'test-password');
  await vi.waitFor(() => expect(state.signIn).toHaveBeenCalledOnce());
  state.auth.currentUser = { uid: 'other-login' };
  exchange.resolve({ user: { uid: 'A' } });
  await expect(pending).rejects.toThrow('登入狀態已變更');
  expect(state.update).not.toHaveBeenCalled();
  expect(state.auth.currentUser).toEqual({ uid: 'other-login' });
});
it.each(['school verification', 'Firebase exchange'])('does not undo an explicit logout during %s', async (phase) => {
  const response = deferred<Response>();
  const exchange = deferred<{ user: { uid: string } }>();
  state.auth.currentUser = { uid: 'restored-A' };
  state.fetch.mockReturnValueOnce(response.promise);
  state.signIn.mockReturnValueOnce(exchange.promise);
  const pending = signInWithPuStudentId('B', 'test-password');
  if (phase === 'Firebase exchange') {
    response.resolve(Response.json({ customToken: 'test-credential' }));
    await vi.waitFor(() => expect(state.signIn).toHaveBeenCalledOnce());
  }
  state.auth.currentUser = null;
  response.resolve(Response.json({ customToken: 'test-credential' }));
  exchange.resolve({ user: { uid: 'B' } });
  await expect(pending).rejects.toThrow('登入狀態已變更');
  expect(state.update).not.toHaveBeenCalled();
  expect(state.auth.currentUser).toBeNull();
});
