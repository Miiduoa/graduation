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
let STUDENT_LOGIN_CLIENT_TIMEOUT_MS: typeof import('./firebase').STUDENT_LOGIN_CLIENT_TIMEOUT_MS;
beforeEach(async () => {
  vi.resetModules();
  ({ signInWithPuStudentId, STUDENT_LOGIN_CLIENT_TIMEOUT_MS } = await import('./firebase'));
  vi.clearAllMocks();
  state.auth.currentUser = null;
  vi.stubGlobal('fetch', state.fetch);
  state.signIn.mockResolvedValue({ user: { uid: 'student' } });
  state.update.mockImplementation(async (_auth, user) => {
    state.auth.currentUser = user;
  });
  state.deleteApp.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
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
  const used = state.fetch.mock.calls[0][1].signal as AbortSignal;
  expect(used.aborted).toBe(false);
  controller.abort();
  expect(used.aborted).toBe(true);
  response.resolve(Response.json({ customToken: 'test-credential' }));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(state.signIn).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
});
it('still signs in when the school responds after 11 seconds', async () => {
  vi.useFakeTimers();
  const response = deferred<Response>();
  state.fetch.mockReturnValueOnce(response.promise);
  const pending = signInWithPuStudentId('A1234567', 'test-password');
  await vi.advanceTimersByTimeAsync(11_000);
  response.resolve(Response.json({ customToken: 'test-credential' }));
  await expect(pending).resolves.toEqual({ uid: 'student' });
  expect(state.update).toHaveBeenCalled();
});
it('maps a hung school request to a clear unavailable notice without signing in', async () => {
  vi.useFakeTimers();
  state.fetch.mockImplementation(
    (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  );
  const pending = expect(signInWithPuStudentId('A1234567', 'test-password')).rejects.toMatchObject({
    name: 'SchoolLoginHttpError',
    status: 503,
    message: '學校系統暫時連不上，請稍後再試',
  });
  await vi.advanceTimersByTimeAsync(STUDENT_LOGIN_CLIENT_TIMEOUT_MS);
  await pending;
  expect(state.signIn).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
});
it.each([
  [401, '學號或密碼錯誤', '學號或密碼錯誤'],
  [503, '尚未開放', '這間學校尚未開放學號登入'],
  [503, '學校系統暫時無法連線', '學校系統暫時連不上，請稍後再試'],
  [503, '老師登入暫時無法使用', '老師登入暫時無法使用'],
  [503, '老師登入暫未開放；學生請輸入純數字學號', '老師登入暫時無法使用'],
  [429, 'Too many requests', '嘗試太多次，請稍後再試'],
  [503, '暫時無法驗證老師身分', '登入失敗。請確認學號與密碼，或稍後再試。'],
  [500, '<script>evil</script>', '登入失敗。請確認學號與密碼，或稍後再試。'],
] as const)(
  'rejects school login HTTP %s with a fixed notice instead of the server body',
  async (status, serverError, copy) => {
    state.fetch.mockImplementation(async () => Response.json({ error: serverError }, { status }));
    await expect(signInWithPuStudentId('A1234567', 'test-password')).rejects.toMatchObject({
      name: 'SchoolLoginHttpError',
      status,
      message: copy,
    });
    await expect(signInWithPuStudentId('CHANGYI', 'test-password')).rejects.toMatchObject({
      name: 'SchoolLoginHttpError',
      status,
      message: copy,
    });
    expect(state.signIn).not.toHaveBeenCalled();
  },
);

it('maps teacher LMS unavailability by error code without printing the server body', async () => {
  state.fetch.mockImplementation(async () =>
    Response.json({ error: '<script>evil</script>', code: 'teacher_lms_unreachable' }, { status: 503 }),
  );
  await expect(signInWithPuStudentId('changyi', 'test-password')).rejects.toMatchObject({
    name: 'SchoolLoginHttpError',
    status: 503,
    message: '老師登入暫時無法使用',
  });
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

it('never sends another campus\'s credentials to the Providence sign-in endpoint', async () => {
  await expect(
    signInWithPuStudentId('A1234567', 'test-password', undefined, 'ntu'),
  ).rejects.toMatchObject({
    name: 'SchoolLoginHttpError',
    status: 503,
  });
  expect(state.fetch).not.toHaveBeenCalled();
  expect(state.signIn).not.toHaveBeenCalled();
});
