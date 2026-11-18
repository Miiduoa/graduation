import {
  NATIVE_TRONCLASS_DOWNLOAD_MAX_BYTES,
  requestNativeTronClassDownload,
  requestNativeTronClassSubmissionDownload,
  validNativeTronClassDownload,
  validNativeTronClassSubmissionDownload,
} from '../services/tronClassNativeDownload';
import { nativeTronClassDownloadTarget } from '../services/tronClassIntegration';
import { revision } from './fixtures/tronClassIntegration';

const mockFetch = jest.fn();
jest.mock('expo/fetch', () => ({ fetch: (...args: unknown[]) => mockFetch(...args) }));
const input = { courseId: 10, activityId: 30, uploadKey: 'material-key', revision };
const submissionInput = { courseId: 10, homeworkId: 20, submissionId: '30', uploadId: 40, revision };
function response(
  chunks: Uint8Array[] = [new Uint8Array([1, 2, 3])],
  headers: Record<string, string> = {},
) {
  const all = {
    'content-type': 'application/pdf',
    'content-length': '3',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent('教材.pdf')}`,
    ...headers,
  };
  let index = 0;
  const reader = {
    read: jest.fn(async () =>
      index < chunks.length ? { done: false, value: chunks[index++] } : { done: true },
    ),
    cancel: jest.fn(async () => undefined),
    releaseLock: jest.fn(),
  };
  const body = { getReader: () => reader, cancel: jest.fn(async () => undefined) };
  return {
    ok: true,
    status: 200,
    headers: { get: (key: string) => all[key.toLowerCase()] ?? null },
    body,
    reader,
  };
}
beforeEach(() => {
  mockFetch.mockReset();
});
afterEach(() => { jest.useRealTimers(); });
it('uses only the authenticated native BFF, identity encoding and a bounded readable stream', async () => {
  const file = response();
  mockFetch.mockResolvedValue(file);
  const value = await requestNativeTronClassDownload('Platform private-session', input, () => true);
  expect(Array.from(value.bytes)).toEqual([1, 2, 3]);
  expect(value.filename).toBe('教材.pdf');
  expect(mockFetch).toHaveBeenCalledWith(
    'https://nuni.tw/api/tronclass/material-download',
    expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      body: JSON.stringify(input),
      headers: expect.objectContaining({
        Authorization: 'Platform private-session',
        'Accept-Encoding': 'identity',
      }),
    }),
  );
  expect(file.reader.releaseLock).toHaveBeenCalledTimes(1);
});
it('copies the scope before the first await so caller mutation cannot change the downloaded target', async () => {
  mockFetch.mockResolvedValue(response());
  const scope = { ...input };
  const work = requestNativeTronClassDownload('Bearer token', scope, () => true);
  scope.courseId = 99;
  scope.uploadKey = 'other-key';
  await work;
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual(input);
});
it.each([
  { ...input, revision: { toString: () => revision } },
  { ...input, uploadKey: '../secret' },
  { ...input, courseId: '10' },
  { ...input, url: 'https://foreign.test' },
])('rejects malformed or caller-selected download authority before fetching: %j', async (value) => {
  expect(validNativeTronClassDownload(value as typeof input)).toBe(false);
  await expect(
    requestNativeTronClassDownload('Bearer token', value as typeof input, () => true),
  ).rejects.toMatchObject({ code: 'TRONCLASS_INVALID_INPUT' });
  expect(mockFetch).not.toHaveBeenCalled();
});
it.each([
  { 'content-encoding': 'gzip' },
  { 'content-type': 'text/html' },
  { 'content-disposition': 'inline' },
  { 'content-length': '0' },
  { 'content-length': 'bad' },
])('refuses unsafe or undecodable binary response metadata: %j', async (headers) => {
  const file = response(undefined, headers);
  mockFetch.mockResolvedValue(file);
  await expect(
    requestNativeTronClassDownload('Bearer token', input, () => true),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  expect(file.body.cancel).toHaveBeenCalledTimes(1);
});
it('cancels an oversized declared file before pulling bytes', async () => {
  const file = response(undefined, {
    'content-length': String(NATIVE_TRONCLASS_DOWNLOAD_MAX_BYTES + 1),
  });
  mockFetch.mockResolvedValue(file);
  await expect(
    requestNativeTronClassDownload('Bearer token', input, () => true),
  ).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TOO_LARGE' });
  expect(file.reader.read).not.toHaveBeenCalled();
  expect(file.body.cancel).toHaveBeenCalled();
});
it('enforces the decoded stream limit even when the length header lies', async () => {
  const file = response([new Uint8Array(NATIVE_TRONCLASS_DOWNLOAD_MAX_BYTES), new Uint8Array([1])]);
  mockFetch.mockResolvedValue(file);
  await expect(
    requestNativeTronClassDownload('Bearer token', input, () => true),
  ).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TOO_LARGE' });
  expect(file.reader.cancel).toHaveBeenCalled();
});
it('rejects truncated bytes and cancels an owner change during streaming', async () => {
  mockFetch.mockResolvedValueOnce(response([new Uint8Array([1])]));
  await expect(
    requestNativeTronClassDownload('Bearer token', input, () => true),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  let current = true;
  const file = response();
  file.reader.read.mockImplementationOnce(async () => {
    current = false;
    return { done: false, value: new Uint8Array([1]) };
  });
  mockFetch.mockResolvedValueOnce(file);
  await expect(
    requestNativeTronClassDownload('Bearer token', input, () => current),
  ).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(file.reader.cancel).toHaveBeenCalled();
});
it('derives only an explicitly allowed activity upload key from fixed school URLs', () => {
  const material = {
    id: 30,
    courseId: 10,
    courseName: 'course',
    title: 'material',
    type: 'document',
    href: '',
    files: [],
  };
  const file = {
    name: 'file',
    allowDownload: true,
    downloadHref: 'https://tronclass.pu.edu.tw/api/uploads/material-key/blob',
  };
  expect(nativeTronClassDownloadTarget(material, file, revision)).toEqual(input);
  for (const href of [
    'https://foreign.test/api/uploads/x/blob',
    `${file.downloadHref}?cookie=x`,
    'https://tronclass.pu.edu.tw/api/uploads/%2e%2e/blob',
  ]) {
    expect(
      nativeTronClassDownloadTarget(material, { ...file, downloadHref: href }, revision),
    ).toBeNull();
  }
  expect(
    nativeTronClassDownloadTarget(material, { ...file, allowDownload: false }, revision),
  ).toBeNull();
});

it('downloads a submission attachment only through its fixed authenticated BFF with an immutable numeric scope', async () => {
  mockFetch.mockResolvedValue(response());
  const scope = { ...submissionInput };
  const work = requestNativeTronClassSubmissionDownload('Platform private-session', scope, () => true);
  scope.submissionId = '999';
  scope.uploadId = 99;
  expect((await work).filename).toBe('教材.pdf');
  expect(mockFetch).toHaveBeenCalledWith('https://nuni.tw/api/tronclass/submission-attachment',
    expect.objectContaining({ method: 'POST', redirect: 'error', credentials: 'omit',
      body: JSON.stringify(submissionInput),
      headers: expect.objectContaining({ Authorization: 'Platform private-session',
        'Accept-Encoding': 'identity', 'Cache-Control': 'no-store' }),
    }));
});

it.each([
  { ...submissionInput, submissionId: '030' },
  { ...submissionInput, submissionId: '0' },
  { ...submissionInput, submissionId: '-1' },
  { ...submissionInput, submissionId: '1e2' },
  { ...submissionInput, submissionId: '9007199254740992' },
  { ...submissionInput, submissionId: 30 },
  { ...submissionInput, uploadId: '40' },
  { ...submissionInput, uploadId: -1 },
  { ...submissionInput, revision: { toString: () => revision } },
  { ...submissionInput, url: 'https://foreign.test' },
  { ...submissionInput, studentId: 123 },
  { ...submissionInput, uploadKey: 'untrusted-key' },
])('rejects unbounded IDs or extra authority before a submission attachment request: %j', async (value) => {
  expect(validNativeTronClassSubmissionDownload(value as typeof submissionInput)).toBe(false);
  await expect(requestNativeTronClassSubmissionDownload('Bearer token', value as typeof submissionInput, () => true))
    .rejects.toMatchObject({ code: 'TRONCLASS_INVALID_INPUT' });
  expect(mockFetch).not.toHaveBeenCalled();
});

it.each([
  { headers: { 'content-type': 'text/html' }, chunks: undefined, code: 'INVALID_RESPONSE' },
  { headers: { 'content-length': String(NATIVE_TRONCLASS_DOWNLOAD_MAX_BYTES + 1) }, chunks: undefined, code: 'TRONCLASS_DOWNLOAD_TOO_LARGE' },
  { headers: {}, chunks: [new Uint8Array([1])], code: 'INVALID_RESPONSE' },
])('applies the bounded byte contract to submission attachments: $code', async ({ headers, chunks, code }) => {
  mockFetch.mockResolvedValue(response(chunks, headers));
  await expect(requestNativeTronClassSubmissionDownload('Bearer token', submissionInput, () => true))
    .rejects.toMatchObject({ code });
});

it('does not fetch an attachment for an already aborted request', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(requestNativeTronClassSubmissionDownload('Bearer token', submissionInput, () => true, controller.signal))
    .rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(mockFetch).not.toHaveBeenCalled();
});

it('ends a stalled attachment request at 60 seconds and discards a late response without retrying', async () => {
  jest.useFakeTimers();
  let finish!: (value: ReturnType<typeof response>) => void;
  mockFetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const work = requestNativeTronClassSubmissionDownload('Bearer token', submissionInput, () => true);
  const rejected = expect(work).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TIMEOUT' });
  jest.advanceTimersByTime(60_000);
  await rejected;
  const file = response();
  finish(file);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(file.body.cancel).toHaveBeenCalledTimes(1);
  expect(file.reader.read).not.toHaveBeenCalled();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it.each(['deadline', 'external'] as const)('cancels a stalled submission attachment body at the %s boundary', async (reason) => {
  jest.useFakeTimers();
  const file = response();
  file.reader.read.mockImplementationOnce(() => new Promise(() => undefined));
  mockFetch.mockResolvedValue(file);
  const controller = new AbortController();
  const work = requestNativeTronClassSubmissionDownload('Bearer token', submissionInput, () => true, controller.signal);
  const rejected = expect(work).rejects.toMatchObject({
    code: reason === 'deadline' ? 'TRONCLASS_DOWNLOAD_TIMEOUT' : 'SESSION_CHANGED',
  });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(file.reader.read).toHaveBeenCalledTimes(1);
  if (reason === 'external') controller.abort();
  else jest.advanceTimersByTime(60_000);
  await rejected;
  expect(file.reader.cancel).toHaveBeenCalledTimes(1);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
