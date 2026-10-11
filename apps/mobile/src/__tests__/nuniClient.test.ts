import {
  nuniPlatformRequest,
  parseNuniLoginSession,
  parseNuniLoginTransaction,
} from '../services/nuniClient';

const handle = `ps_${'a'.repeat(43)}`;
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

it('sends a platform credential only to the fixed HTTPS API and refuses paths that escape it', async () => {
  const fetchMock = jest.fn(async () => ({ ok: true, text: async () => '{}' }));
  global.fetch = fetchMock as unknown as typeof fetch;
  await nuniPlatformRequest('class-workspaces', handle, { title: '課程' });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.nuni.tw/v1/auth/platform/class-workspaces',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: `Platform ${handle}` }),
      redirect: 'error',
    }),
  );
  for (const path of [
    'https://foreign.invalid',
    '//foreign.invalid',
    '../account',
    'class-workspaces?url=x',
    'class-workspaces/%2e%2e',
  ]) {
    await expect(nuniPlatformRequest(path, handle)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  }
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('maps bounded API errors without reflecting arbitrary server messages', async () => {
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 403,
    text: async () => JSON.stringify({ code: 'FORBIDDEN', message: 'raw-secret' }),
  })) as unknown as typeof fetch;
  await expect(nuniPlatformRequest('sessions/current', handle)).rejects.toMatchObject({
    status: 403,
    code: 'FORBIDDEN',
    message: 'FORBIDDEN',
  });
});
it('aborts the native fetch when its session is invalidated', async () => {
  let sentSignal: AbortSignal | undefined;
  global.fetch = jest.fn(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        sentSignal = options?.signal as AbortSignal;
        sentSignal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  ) as unknown as typeof fetch;
  const controller = new AbortController();
  const work = nuniPlatformRequest('sessions/current', handle, undefined, controller.signal);
  const rejection = expect(work).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
  controller.abort();
  await rejection;
  expect(sentSignal?.aborted).toBe(true);
});
it('validates login transaction provider audience, lifetime and nonce before opening native Google', () => {
  const value = {
    kind: 'google-consumer',
    transactionId: `pt_${'b'.repeat(43)}`,
    nonce: 'c'.repeat(43),
    clientId: 'example.apps.googleusercontent.com',
    issuer: 'https://accounts.google.com',
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    expiresInSeconds: 600,
  };
  expect(parseNuniLoginTransaction(value).clientId).toBe(value.clientId);
  expect(() => parseNuniLoginTransaction({ ...value, expiresInSeconds: 601 })).toThrow(
    'INVALID_RESPONSE',
  );
  expect(() => parseNuniLoginTransaction({ ...value, clientId: 'untrusted.invalid' })).toThrow(
    'INVALID_RESPONSE',
  );
  expect(() => parseNuniLoginTransaction({ ...value, nonce: '' })).toThrow('INVALID_RESPONSE');
});
it('parses the actual session-create contract without requiring current-session authenticated field', () => {
  const value = {
    sessionHandle: handle,
    platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
    isPlatformOperator: false,
    expiresInSeconds: 3600,
    created: true,
  };
  expect(parseNuniLoginSession(value).platformAccountId).toBe(value.platformAccountId);
  expect(() => parseNuniLoginSession({ ...value, sessionHandle: 'invalid' })).toThrow(
    'INVALID_RESPONSE',
  );
  expect(() => parseNuniLoginSession({ ...value, expiresInSeconds: Infinity })).toThrow(
    'INVALID_RESPONSE',
  );
});
