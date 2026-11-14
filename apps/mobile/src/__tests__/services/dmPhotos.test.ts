import { confirmDmPhoto, localPhoto, openDmPhoto, photoParts, uploadDmPhoto } from '../../services/dmPhotos';
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

test('upload and confirm report photos unavailable without calling Firebase', async () => {
  await expect(uploadDmPhoto(scope, local, signal())).rejects.toThrow('photo-unavailable');
  await expect(confirmDmPhoto(scope, path, signal())).rejects.toThrow('photo-unavailable');
  expect(mockCall).not.toHaveBeenCalled();
  expect(httpsCallable).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
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

test('existing conversation IDs longer than 120 characters still parse a bound photo path', () => {
  const conversationId = `dm_pu_${'a'.repeat(64)}_${'b'.repeat(64)}`;
  expect(conversationId).toHaveLength(135);
  const longPath = path.replace('/private/', `/${conversationId}/`);
  expect(photoParts(longPath, conversationId, false)).toMatchObject({ mediaId: 'media' });
  const longScope = { ...scope, conversationId };
  return expect(uploadDmPhoto(longScope, local, signal())).rejects.toThrow('photo-unavailable');
});

test('a prepared canonical peer still cannot upload or confirm a photo', async () => {
  const first = { ...scope, conversationId: 'dm_pu_alice_bob', peerUid: 'bob' };
  const firstPath = path.replace('/private/', '/dm_pu_alice_bob/');
  await expect(uploadDmPhoto(first, local, signal())).rejects.toThrow('photo-unavailable');
  await expect(confirmDmPhoto(first, firstPath, signal())).rejects.toThrow('photo-unavailable');
  expect(mockCall).not.toHaveBeenCalled();
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
