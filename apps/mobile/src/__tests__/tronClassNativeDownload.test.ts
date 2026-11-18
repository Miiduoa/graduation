import {
  NATIVE_TRONCLASS_DOWNLOAD_MAX_BYTES,
  requestNativeTronClassDownload,
  validNativeTronClassDownload,
} from '../services/tronClassNativeDownload';
import { nativeTronClassDownloadTarget } from '../services/tronClassIntegration';
import { revision } from './fixtures/tronClassIntegration';

const mockFetch = jest.fn();
jest.mock('expo/fetch', () => ({ fetch: (...args: unknown[]) => mockFetch(...args) }));
const input = { courseId: 10, activityId: 30, uploadKey: 'material-key', revision };
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
