import { nuniBffFilePut, nuniBffRequest } from '../services/nuniClient';
import {
  nativeTronClassFirebaseRequest,
  nativeTronClassFirebaseSubmissionDownload,
  tronClassUploadQuery,
} from '../services/tronClassNativeTransport';
import { requestNativeTronClassSubmissionDownload } from '../services/tronClassNativeDownload';
import { operationId, revision } from './fixtures/tronClassIntegration';

const handle = `ps_${'a'.repeat(43)}`;
const originalFetch = global.fetch;
const mockGetIdToken = jest.fn();
let mockUser: { uid: string; getIdToken: typeof mockGetIdToken } | null;
jest.mock('../firebase', () => ({ getAuthInstance: () => ({ currentUser: mockUser }) }));
let mockExpoFetch: jest.Mock | undefined;
jest.mock('expo/fetch', () => ({
  get fetch() {
    return mockExpoFetch;
  },
}));
jest.mock('../services/tronClassNativeDownload', () => ({
  ...jest.requireActual('../services/tronClassNativeDownload'),
  requestNativeTronClassSubmissionDownload: jest.fn(),
}));
const submissionInput = { courseId: 10, homeworkId: 20, submissionId: '30', uploadId: 40, revision };
const downloadMock = jest.mocked(requestNativeTronClassSubmissionDownload);
beforeEach(() => {
  mockUser = { uid: 'school-a', getIdToken: mockGetIdToken };
  mockGetIdToken.mockReset().mockResolvedValue('fresh-token');
  downloadMock.mockReset().mockResolvedValue({ bytes: new Uint8Array([1]), filename: 'answer.pdf', contentType: 'application/pdf' });
  mockExpoFetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
});

it('uses POST at the fixed TronClass BFF with Platform authorization, without a browser cookie or legacy TC bridge', async () => {
  const fetchMock = jest.fn(async () => ({ ok: true, text: async () => '{}' }));
  global.fetch = fetchMock as unknown as typeof fetch;
  await nuniBffRequest('tronclass', handle, { action: 'status' });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://nuni.tw/api/tronclass',
    expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      body: '{"action":"status"}',
      headers: expect.objectContaining({ Authorization: `Platform ${handle}` }),
    }),
  );
  await expect(nuniBffRequest('tronclass', handle)).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
  });
});
it.each([
  {
    name: 'Platform',
    authorization: `Platform ${handle}`,
    read: (signal?: AbortSignal) => nuniBffRequest('tronclass', handle, { action: 'courses' }, signal),
    cancellationCode: 'REQUEST_CANCELLED',
  },
  {
    name: 'Firebase',
    authorization: 'Bearer fresh-token',
    read: (signal?: AbortSignal) => nativeTronClassFirebaseRequest('school-a', () => true, { action: 'courses' }, signal),
    cancellationCode: 'SESSION_CHANGED',
  },
])('loads the independent course index through the real $name transport with bounded read retry', async ({
  authorization, read, cancellationCode,
}) => {
  const index = { kind: 'course-index', revision, fetchedAt: '2026-11-18T10:00:00.000Z',
    courses: [{ id: 10, name: '程式設計', code: 'CS101', teachers: [], semester: null,
      status: 'active', href: 'https://tronclass.pu.edu.tw/course/10/content' }],
    errors: [], partial: false };
  const fetchMock = jest.fn()
    .mockRejectedValueOnce(new TypeError('waking'))
    .mockResolvedValue({ ok: true, text: async () => JSON.stringify(index) });
  global.fetch = fetchMock as unknown as typeof fetch;

  await expect(read()).resolves.toEqual(index);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const call of fetchMock.mock.calls) {
    expect(call).toEqual(['https://nuni.tw/api/tronclass', expect.objectContaining({
      method: 'POST', redirect: 'error', cache: 'no-store', body: '{"action":"courses"}',
      headers: { Accept: 'application/json', Authorization: authorization, 'Content-Type': 'application/json' },
    })]);
  }

  const cancelled = new AbortController();
  cancelled.abort();
  await expect(read(cancelled.signal)).rejects.toMatchObject({ code: cancellationCode });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it.each(['connect', 'disconnect', 'submit', 'cancel-preparation'])(
  'never retries a %s whose reply was lost',
  async (action) => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('lost reply'));
    global.fetch = fetchMock;
    mockExpoFetch = jest.fn().mockRejectedValue(new Error('lost reply'));
    await expect(nuniBffRequest('tronclass', handle, { action })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    expect(fetchMock.mock.calls.length + mockExpoFetch.mock.calls.length).toBe(1);
  },
);

const credentialInput = {
  action: 'connect',
  schoolId: 'pu',
  account: 'student',
  password: 'school-secret',
  expectedRevision: null,
};
const connected = { connected: true, revision, account: 'student' };
const credentialTransports = [
  {
    name: 'Platform',
    authorization: `Platform ${handle}`,
    connect: () => nuniBffRequest('tronclass', handle, credentialInput),
  },
  {
    name: 'Firebase',
    authorization: 'Bearer fresh-token',
    connect: () => nativeTronClassFirebaseRequest('school-a', () => true, credentialInput),
  },
];

it.each(credentialTransports)(
  'sends the school password through $name only with the native redirect-refusing fetch, never the global fetch',
  async ({ authorization, connect }) => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    mockExpoFetch = jest.fn(async () => ({ ok: true, status: 200, redirected: false, text: async () => JSON.stringify(connected) }));
    await expect(connect()).resolves.toEqual(connected);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockExpoFetch).toHaveBeenCalledTimes(1);
    expect(mockExpoFetch).toHaveBeenCalledWith('https://nuni.tw/api/tronclass', {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      signal: expect.any(AbortSignal),
      headers: {
        Accept: 'application/json',
        Authorization: authorization,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify(credentialInput),
    });
  },
);

it.each(credentialTransports)(
  'rejects a $name binding reply that reports any redirect, without sending the password again',
  async ({ connect }) => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    for (const reply of [
      { ok: true, status: 200, redirected: true },
      { ok: false, status: 307, redirected: false },
      { ok: false, status: 308, redirected: false },
    ]) {
      mockExpoFetch = jest.fn(async () => ({ ...reply, text: async () => JSON.stringify(connected) }));
      await expect(connect()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
      expect(mockExpoFetch).toHaveBeenCalledTimes(1);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

it.each(credentialTransports)(
  'maps a refused $name redirect to a network failure and never falls back to the global fetch',
  async ({ connect }) => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    mockExpoFetch = jest.fn().mockRejectedValue(new Error("Redirect is not allowed when redirect mode is 'error'"));
    await expect(connect()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(mockExpoFetch).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

it.each(credentialTransports)(
  'fails closed for $name when the native fetch is unavailable',
  async ({ connect }) => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    mockExpoFetch = undefined;
    await expect(connect()).rejects.toMatchObject({ code: 'TRONCLASS_SECURE_TRANSPORT_UNAVAILABLE' });
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

it('keeps non-credential TronClass reads on the existing transport', async () => {
  const fetchMock = jest.fn(async () => ({ ok: true, text: async () => '{}' }));
  global.fetch = fetchMock as unknown as typeof fetch;
  await nuniBffRequest('tronclass', handle, { action: 'status' });
  await nativeTronClassFirebaseRequest('school-a', () => true, { action: 'status' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(mockExpoFetch).not.toHaveBeenCalled();
});
it('encodes only the upload scope at the fixed BFF and never retries a lost upload', async () => {
  const fetchMock = jest.fn().mockRejectedValue(new Error('lost upload reply'));
  global.fetch = fetchMock;
  const query = tronClassUploadQuery({
    courseId: 10,
    homeworkId: 20,
    revision,
    operationId,
    fileId: operationId,
    name: '作業 & 答案.pdf',
  });
  await expect(
    nuniBffFilePut('tronclass', handle, new Uint8Array([1]), 'application/pdf', undefined, query),
  ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/nuni\.tw\/api\/tronclass\?/);
  expect(String(fetchMock.mock.calls[0][0])).toContain(
    'name=%E4%BD%9C%E6%A5%AD+%26+%E7%AD%94%E6%A1%88.pdf',
  );
  await expect(
    nuniBffFilePut('tronclass', handle, new Uint8Array([1]), 'application/pdf', undefined, {
      ...query,
      host: 'evil.test',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(
    nuniBffFilePut('other', handle, new Uint8Array([1]), 'application/pdf', undefined, query),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});
it('uses a fresh Firebase token for a verified school owner without falling back to a different user', async () => {
  const fetchMock = jest.fn(async () => ({ ok: true, text: async () => '{}' }));
  global.fetch = fetchMock as unknown as typeof fetch;
  await nativeTronClassFirebaseRequest('school-a', () => true, { action: 'status' });
  expect(mockGetIdToken).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://nuni.tw/api/tronclass',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }),
      redirect: 'error',
    }),
  );
  mockGetIdToken.mockImplementationOnce(async () => {
    mockUser = { uid: 'school-b', getIdToken: mockGetIdToken };
    return 'stale-token';
  });
  await expect(
    nativeTronClassFirebaseRequest('school-a', () => true, {
      action: 'connect',
      password: 'private',
    }),
  ).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('sanitizes Firebase error messages and does not replay school writes', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: false,
    status: 503,
    text: async () =>
      JSON.stringify({ error: 'TRONCLASS_WRITES_DISABLED', message: 'private upstream detail' }),
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  await expect(
    nativeTronClassFirebaseRequest('school-a', () => true, { action: 'submit' }),
  ).rejects.toMatchObject({
    code: 'TRONCLASS_WRITES_DISABLED',
    message: 'TRONCLASS_WRITES_DISABLED',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('sends preparation cancellation through Firebase once and never retries a lost result', async () => {
  const input = { action: 'cancel-preparation', operationId, revision, courseId: 10, homeworkId: 20 };
  const fetchMock = jest.fn().mockRejectedValue(new Error('lost cancellation reply'));
  global.fetch = fetchMock;
  await expect(nativeTronClassFirebaseRequest('school-a', () => true, input))
    .rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('https://nuni.tw/api/tronclass', expect.objectContaining({
    method: 'POST', body: JSON.stringify(input),
    headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }),
  }));
});

it('binds submission attachment downloads to the same Firebase owner and copies input before obtaining its token', async () => {
  const scope = { ...submissionInput };
  mockGetIdToken.mockImplementationOnce(async () => {
    scope.submissionId = '999';
    scope.uploadId = 999;
    return 'fresh-token';
  });
  await nativeTronClassFirebaseSubmissionDownload('school-a', () => true, scope);
  expect(downloadMock).toHaveBeenCalledWith('Bearer fresh-token', submissionInput, expect.any(Function), undefined);
  mockGetIdToken.mockImplementationOnce(async () => {
    mockUser = { uid: 'school-b', getIdToken: mockGetIdToken };
    return 'wrong-owner-token';
  });
  await expect(nativeTronClassFirebaseSubmissionDownload('school-a', () => true, submissionInput))
    .rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(downloadMock).toHaveBeenCalledTimes(1);
});

it('rejects invalid and already cancelled attachment requests before obtaining a Firebase token', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(nativeTronClassFirebaseSubmissionDownload('school-a', () => true, submissionInput, controller.signal))
    .rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  await expect(nativeTronClassFirebaseSubmissionDownload('school-a', () => true, { ...submissionInput, submissionId: '030' }))
    .rejects.toMatchObject({ code: 'TRONCLASS_INVALID_INPUT' });
  expect(mockGetIdToken).not.toHaveBeenCalled();
  expect(downloadMock).not.toHaveBeenCalled();
});

it('discards attachment bytes if the Firebase owner changes during download', async () => {
  downloadMock.mockImplementationOnce(async () => {
    mockUser = { uid: 'school-b', getIdToken: mockGetIdToken };
    return { bytes: new Uint8Array([1]), filename: 'private.pdf', contentType: 'application/pdf' };
  });
  await expect(nativeTronClassFirebaseSubmissionDownload('school-a', () => true, submissionInput))
    .rejects.toMatchObject({ code: 'SESSION_CHANGED' });
});
