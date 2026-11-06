import { confirmDmPhoto, localPhoto, openDmPhoto, uploadDmPhoto } from '../../services/dmPhotos';
import { httpsCallable } from 'firebase/functions';
import { Request as NativeFetchRequest } from 'whatwg-fetch';

let mockUid = 'alice';
let mockFileSize = 21;
const mockCall = jest.fn();
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: { uid: mockUid } }),
  getFunctionsInstance: () => 'functions',
  isFirebaseMockMode: () => false,
}));
jest.mock('expo-file-system', () => ({
  File: class {
    exists = true;
    size = mockFileSize;
    type = 'image/png';
  },
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCall) }));

const scope = {
  viewerUid: 'alice',
  schoolId: 'pu',
  conversationId: 'private',
  messageId: 'private_image_00000001',
};
const path = 'conversations/private/photos/media/photo.png';
const published = path.replace('photo.png', 'sent.png');
const local = { uri: 'file:///photo.png', contentType: 'image/png', size: 21 };
const signedUrl = 'https://storage.googleapis.com/bucket/' + published + '?generation=123&X-Goog-Signature=1';
const expiresAt = () => new Date(Date.now() + 60_000).toISOString();
const signal = () => new AbortController().signal;
const original = global.fetch;
beforeEach(() => {
  mockUid = scope.viewerUid;
  mockFileSize = 21;
  mockCall.mockReset();
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = original;
  jest.restoreAllMocks();
});

test('uploads the picked bytes with a native file field last, no preview read, then confirms the exact message', async () => {
  const append = jest.spyOn(FormData.prototype, 'append').mockImplementation(() => undefined);
  mockCall.mockResolvedValueOnce({
    data: {
      method: 'POST',
      url: 'https://bucket.storage.googleapis.com/',
      fields: { key: path, 'Content-Type': local.contentType },
      path,
      mediaId: 'media',
      expiresAt: expiresAt(),
    },
  });
  (fetch as jest.Mock).mockResolvedValueOnce({ ok: true });
  await expect(uploadDmPhoto(scope, local, signal())).resolves.toBe(path);
  expect(mockCall.mock.calls).toEqual([
    [
      {
        ...scope,
        action: 'uploadPhoto',
        fileName: 'photo.png',
        size: 21,
        contentType: 'image/png',
      },
    ],
  ]);
  expect(append.mock.calls.at(-1)).toEqual([
    'file',
    { uri: local.uri, type: local.contentType, name: 'photo.png' },
  ]);
  expect(fetch).toHaveBeenCalledTimes(1);
  mockCall.mockResolvedValueOnce({ data: { conversationId: 'private', messageId: 'different' } });
  await expect(confirmDmPhoto(scope, path, signal())).rejects.toThrow('unconfirmed');
  mockCall.mockResolvedValueOnce({
    data: { conversationId: 'private', messageId: scope.messageId },
  });
  await confirmDmPhoto(scope, path, signal());
  expect(httpsCallable).toHaveBeenCalledWith('functions', 'sendDmPhoto');
  expect(mockCall).toHaveBeenLastCalledWith({ ...scope, path });
});
test('rejects oversized, remote, unsupported or changed local files before requesting access', async () => {
  expect(() => localPhoto('https://bad.test/x', 'image/png')).toThrow();
  expect(() => localPhoto(local.uri, 'image/gif')).toThrow();
  mockFileSize = 10 * 1024 * 1024;
  expect(() => localPhoto(local.uri, 'image/png')).toThrow();
  mockFileSize = 100;
  await expect(uploadDmPhoto(scope, local, signal())).rejects.toThrow('changed');
  expect(mockCall).not.toHaveBeenCalled();
});
test.each([path, published.replace('/private/', '/other/'), signedUrl])(
  'refuses an unbound source before read (%s)',
  async (source) => {
    await expect(openDmPhoto(scope, source, signal())).rejects.toThrow('photo-path');
    expect(mockCall).not.toHaveBeenCalled();
  },
);
test.each([
  signedUrl.replace('/sent.png', '/different.png'),
  signedUrl.replace('storage.googleapis.com', 'evil.test'),
  signedUrl + '&token=legacy',
  signedUrl.split('?')[0],
])('refuses a bad signed response without fetching any bytes (%s)', async (url) => {
  mockCall.mockResolvedValueOnce({ data: { url, expiresAt: expiresAt() } });
  await expect(openDmPhoto(scope, published, signal())).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
test('asks for message-bound access and downloads in-memory bytes with the native signed URL unchanged', async () => {
  const expires = expiresAt();
  mockCall.mockResolvedValueOnce({ data: { url: signedUrl, expiresAt: expires } });
  (fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    blob: async () => new Blob(['PNG'], { type: 'image/png' }),
  });
  const photo = await openDmPhoto(scope, published, signal());
  expect(mockCall).toHaveBeenCalledWith({
    ...scope,
    action: 'read',
    folder: 'photos',
    mediaId: 'media',
    fileName: 'sent.png',
  });
  expect(fetch).toHaveBeenCalledWith(signedUrl, expect.objectContaining({ headers: { 'Cache-Control': 'no-store' } }));
  const [url, init] = jest.mocked(fetch).mock.calls[0];
  expect(new NativeFetchRequest(url, init).url).toBe(signedUrl);
  expect(photo).toEqual({ uri: 'data:image/png;base64,UE5H', expiresAt: Date.parse(expires) });
});
test('account changes, aborted requests and expired grants are denied before fetching', async () => {
  mockCall.mockImplementationOnce(async () => {
    mockUid = 'other';
    return { data: { url: signedUrl, expiresAt: expiresAt() } };
  });
  await expect(openDmPhoto(scope, published, signal())).rejects.toThrow('session');
  mockUid = 'alice';
  mockCall.mockResolvedValueOnce({
    data: { url: signedUrl, expiresAt: new Date(Date.now() - 1).toISOString() },
  });
  await expect(openDmPhoto(scope, published, signal())).rejects.toThrow('grant');
  const aborted = new AbortController();
  aborted.abort();
  await expect(openDmPhoto(scope, published, aborted.signal)).rejects.toThrow('session');
  expect(fetch).not.toHaveBeenCalled();
});
