import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  confirmDmPhoto,
  parseDmPhotoPath,
  readDmPhoto,
  uploadDmPhoto,
  validDmPhoto,
} from './dmPhotos';

const api = vi.hoisted(() => ({ uid: 'alice', call: vi.fn(), callable: vi.fn() }));
vi.mock('./firebase', () => ({
  getAuth: () => ({ currentUser: { uid: api.uid } }),
  getFunctionsInstance: () => 'functions',
}));
vi.mock('firebase/functions', () => ({ httpsCallable: api.callable }));
const scope = {
  viewerUid: 'alice',
  schoolId: 'pu',
  conversationId: 'dm-alice-bob',
  messageId: 'abcdef0123456789abcd',
};
const folder = 'conversations/dm-alice-bob/photos/abc';
const draft = folder + '/photo.jpg';
const path = folder + '/sent.jpg';
const signal = () => new AbortController().signal;
const file = () => new File(['bytes'], 'private-family.jpg', { type: 'image/jpeg' });
beforeEach(() => {
  vi.clearAllMocks();
  api.uid = 'alice';
  api.callable.mockReturnValue(api.call);
});
afterEach(() => vi.unstubAllGlobals());

it('parses photo paths on existing conversation IDs longer than 120 characters', () => {
  const conversationId = `dm_pu_${'a'.repeat(64)}_${'b'.repeat(64)}`;
  expect(conversationId).toHaveLength(135);
  const longPath = `conversations/${conversationId}/photos/abc/sent.jpg`;
  expect(parseDmPhotoPath(longPath, conversationId)).toEqual({
    mediaId: 'abc',
    fileName: 'sent.jpg',
  });
});

it('accepts only nonempty JPEG, PNG and WebP strictly below 10 MiB', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    expect(validDmPhoto({ type, size: 10 * 1024 * 1024 - 1 } as File)).toBe(true);
  }
  for (const [type, size] of [
    ['image/svg+xml', 1],
    ['image/gif', 1],
    ['image/png', 0],
    ['image/png', 10 * 1024 * 1024],
  ]) {
    expect(validDmPhoto({ type, size } as File)).toBe(false);
  }
});

it('does not probe Firebase when sending a photo; send reports photos unavailable', async () => {
  const post = vi.fn();
  vi.stubGlobal('fetch', post);
  await expect(uploadDmPhoto(scope, file(), signal())).rejects.toThrow('photo-unavailable');
  await expect(confirmDmPhoto(scope, draft, signal())).rejects.toThrow('photo-unavailable');
  expect(api.callable).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it('still reads an existing photo through the callable grant path', async () => {
  const grant = {
    url: 'https://storage.googleapis.com/bucket/' + path + '?X-Goog-Signature=abc',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  api.call.mockResolvedValueOnce({ data: grant });
  expect(await readDmPhoto(scope, path, signal())).toEqual(grant);
  expect(api.callable).toHaveBeenCalledWith('functions', 'dmAttachmentDelivery');
});

it('reports an existing photo unavailable only after the read callable is confirmed missing', async () => {
  api.call.mockRejectedValueOnce({ code: 'functions/not-found' });
  await expect(readDmPhoto(scope, path, signal())).rejects.toThrow('photo-unavailable');
});

it('never uploads after the viewer changes', async () => {
  const post = vi.fn();
  vi.stubGlobal('fetch', post);
  api.uid = 'other';
  await expect(uploadDmPhoto(scope, file(), signal())).rejects.toThrow('photo-session');
  expect(post).not.toHaveBeenCalled();
  expect(api.callable).not.toHaveBeenCalled();
});

it('rejects a confirmation path before reporting photos unavailable', async () => {
  await expect(confirmDmPhoto(scope, 'not-a-photo-path', signal())).rejects.toThrow('photo-path');
  await expect(confirmDmPhoto(scope, draft, signal())).rejects.toThrow('photo-unavailable');
});

it('rejects legacy URLs, staging, malformed and cross-thread paths before any read', async () => {
  for (const unsafe of [
    'https://example.com/?token=secret',
    'conversations/dm-alice-bob/media/abc/p.jpg',
    path.replace('dm-alice-bob', 'elsewhere'),
    path.replace('/abc/', '/../'),
    draft,
    path + '/extra',
  ]) {
    expect(parseDmPhotoPath(unsafe, scope.conversationId)).toBeNull();
    await expect(readDmPhoto(scope, unsafe, signal())).rejects.toThrow();
  }
  expect(api.callable).not.toHaveBeenCalled();
});
