import { createNuniClassroom } from '@campus/shared/src/nuniClassroom';
import {
  nuniBffFilePut,
  nuniBffRequest,
  nuniPlatformRequest,
  parseNuniLoginSession,
  parseNuniLoginTransaction,
} from '../services/nuniClient';

const handle = `ps_${'a'.repeat(43)}`;
const originalFetch = global.fetch;
it('encodes food pagination as data without permitting request URL or mutation overrides', async () => {
  const fetchMock = jest.fn(async (_url: unknown, _options?: unknown) => ({
    ok: true,
    text: async () => '{}',
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  await nuniPlatformRequest(
    'realms/school-one/food/orders',
    handle,
    undefined,
    undefined,
    undefined,
    { cursor: 'abc+/=next&personId=other', limit: '25' },
  );
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    'https://api.nuni.tw/v1/auth/platform/realms/school-one/food/orders?cursor=abc%2B%2F%3Dnext%26personId%3Dother&limit=25',
  );
  await expect(
    nuniPlatformRequest('realms/school-one/food/orders', handle, {}, undefined, undefined, {
      cursor: 'abc',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(
    nuniPlatformRequest('realms/school-one/food/orders', handle, undefined, undefined, undefined, {
      cursor: 'a'.repeat(501),
    }),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
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
it('retries a waking API failure once before giving up', async () => {
  const fetchMock = jest
    .fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce({ ok: true, text: async () => '{"ready":true}' });
  global.fetch = fetchMock as unknown as typeof fetch;
  await expect(nuniPlatformRequest('session')).resolves.toEqual({ ready: true });
  expect(fetchMock).toHaveBeenCalledTimes(2);
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

it('uses the API settings PUT contract without changing the credential origin', async () => {
  const fetchMock = jest.fn(async () => ({ ok: true, text: async () => '{}' }));
  global.fetch = fetchMock as unknown as typeof fetch;
  const input = {
    expectedVersion: 1,
    serviceModes: ['pickup'],
    paymentMode: 'counter-only',
    termsVersion: 'merchant-terms-v1',
  };
  await nuniPlatformRequest(
    'merchant-workspaces/school-one/location-one/settings',
    handle,
    input,
    undefined,
    'PUT',
  );
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.nuni.tw/v1/auth/platform/merchant-workspaces/school-one/location-one/settings',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify(input),
      redirect: 'error',
      headers: expect.objectContaining({ Authorization: `Platform ${handle}` }),
    }),
  );
});

it('permits large import snapshots only on the two exact sync endpoints', async () => {
  const body = JSON.stringify({ records: 'a'.repeat(2_000_001) });
  global.fetch = jest.fn(async () => ({
    ok: true,
    text: async () => body,
  })) as unknown as typeof fetch;
  for (const path of ['personal-imports/read', 'personal-imports/write']) {
    await expect(nuniPlatformRequest(path, handle, {})).resolves.toHaveProperty('records');
  }
  for (const path of [
    'sessions/current',
    'personal-imports/read/extra',
    'personal-imports/read-other',
  ]) {
    await expect(nuniPlatformRequest(path, handle, {})).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  }
  global.fetch = jest.fn(async () => ({
    ok: true,
    text: async () => ' '.repeat(8 * 1024 * 1024 + 16 * 1024 + 1),
  })) as unknown as typeof fetch;
  await expect(nuniPlatformRequest('personal-imports/read', handle, {})).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
});

it('keeps wake retry on personal-import sync while still aborting via external signal', async () => {
  const fetchMock = jest
    .fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ records: [] }),
    });
  global.fetch = fetchMock as unknown as typeof fetch;
  await expect(nuniPlatformRequest('personal-imports/read', handle, {})).resolves.toEqual({
    records: [],
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);

  let sentSignal: AbortSignal | undefined;
  global.fetch = jest.fn(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        sentSignal = options?.signal as AbortSignal;
        sentSignal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  ) as unknown as typeof fetch;
  const controller = new AbortController();
  const work = nuniPlatformRequest(
    'personal-imports/write',
    handle,
    { records: [] },
    controller.signal,
  );
  const rejection = expect(work).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
  controller.abort();
  await rejection;
  expect(sentSignal?.aborted).toBe(true);
});

it('sends assignment file JSON and bytes only to the nuni.tw BFF', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'cwf_11111111-1111-4111-8111-111111111111' }),
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  await nuniBffRequest(
    'class-workspaces/cw_11111111-1111-4111-8111-111111111111/assignments/cwa_22222222-2222-4222-8222-222222222222/files/intents',
    handle,
    {
      originalName: 'shot.jpg',
      contentType: 'image/jpeg',
      byteSize: 8,
      idempotencyKey: 'intent-key',
    },
  );
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    'https://nuni.tw/api/nuni/class-workspaces/cw_11111111-1111-4111-8111-111111111111/assignments/cwa_22222222-2222-4222-8222-222222222222/files/intents',
  );
  expect(fetchMock.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: `Platform ${handle}` }),
    }),
  );
  await nuniBffFilePut(
    'class-workspaces/cw_11111111-1111-4111-8111-111111111111/assignments/cwa_22222222-2222-4222-8222-222222222222/files/cwf_11111111-1111-4111-8111-111111111111/content',
    handle,
    Uint8Array.from([0xff, 0xd8, 0xff]),
    'image/jpeg',
  );
  expect(String(fetchMock.mock.calls[1]?.[0])).toContain('https://nuni.tw/api/nuni/');
  expect(fetchMock.mock.calls[1]?.[1]).toEqual(
    expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({ Authorization: `Platform ${handle}` }),
    }),
  );
  await expect(nuniBffRequest('https://foreign.invalid', handle)).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
  });
});

it.each([
  ['lost response', undefined, { status: 0, code: 'NETWORK_ERROR' }],
  ...[500, 502, 503, 504].map((status) => [
    `HTTP ${status}`,
    { ok: false, status, text: async () => '{"code":"REQUEST_FAILED"}' },
    { status, code: 'REQUEST_FAILED' },
  ]),
])('does not resend check-in after %s', async (_label, response, failure) => {
  const fetchMock = jest.fn();
  if (response) fetchMock.mockResolvedValueOnce(response);
  else fetchMock.mockRejectedValueOnce(new TypeError('Response lost after server accepted check-in'));
  fetchMock.mockResolvedValue({ ok: true, text: async () => '{}' });
  global.fetch = fetchMock as unknown as typeof fetch;
  const classroom = createNuniClassroom((path, input) => nuniPlatformRequest(path, handle, input));
  const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
  const sessionId = 'cws_22222222-2222-4222-8222-222222222222';

  await expect(classroom.checkIn(workspaceId, sessionId)).rejects.toMatchObject(failure);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    `https://api.nuni.tw/v1/auth/platform/class-workspaces/${workspaceId}/classroom-sessions/${sessionId}/check-in`,
    expect.objectContaining({ method: 'POST', body: '{}' }),
  );
});
