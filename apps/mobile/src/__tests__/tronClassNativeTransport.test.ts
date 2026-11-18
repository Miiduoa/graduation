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
it.each(['connect', 'disconnect', 'submit'])(
  'never retries a %s whose reply was lost',
  async (action) => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('lost reply'));
    global.fetch = fetchMock;
    await expect(nuniBffRequest('tronclass', handle, { action })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);
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
