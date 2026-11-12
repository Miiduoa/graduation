const functionsConfig = vi.hoisted(() => ({ enabled: true }));
vi.mock('./cloudFunctions', () => ({ areFunctionsConfigured: () => functionsConfig.enabled }));
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
const url = 'https://storage.googleapis.com/bucket';
const signal = () => new AbortController().signal;
const file = () => new File(['bytes'], 'private-family.jpg', { type: 'image/jpeg' });
const expiry = () => new Date(Date.now() + 60_000).toISOString();
const signed = (path: string) => ({
  url: url + '/' + path + '?X-Goog-Signature=abc',
  expiresAt: expiry(),
});
beforeEach(() => {
  functionsConfig.enabled = true;
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

it('posts signed fields before the file under the correct object and conceals the local filename', async () => {
  const fields = { key: draft, policy: 'policy' };
  api.call.mockResolvedValue({
    data: { url, expiresAt: expiry(), path: draft, method: 'POST', mediaId: 'abc', fields },
  });
  const post = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', post);
  const photo = file();
  const s = signal();
  expect(await uploadDmPhoto(scope, photo, s)).toBe(draft);
  expect(api.callable).toHaveBeenCalledWith('functions', 'dmAttachmentDelivery');
  expect(api.call).toHaveBeenCalledWith({
    ...scope,
    action: 'uploadPhoto',
    size: photo.size,
    fileName: 'photo.jpg',
    contentType: photo.type,
  });
  const sent = post.mock.calls[0][1];
  expect(sent).toMatchObject({ method: 'POST', credentials: 'omit', signal: s });
  expect([...sent.body.keys()]).toEqual(['key', 'policy', 'file']);
  expect(sent.body.get('file').name).toBe('photo.jpg');
});

it('passes the approved first-message peer through photo upload and confirmation', async () => {
  const initial = { ...scope, peerUid: 'bob' };
  api.call.mockResolvedValueOnce({
    data: { url, expiresAt: expiry(), path: draft, method: 'POST', mediaId: 'abc', fields: { key: draft } },
  }).mockResolvedValueOnce({ data: { conversationId: scope.conversationId, messageId: scope.messageId } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  const s = signal();
  const uploaded = await uploadDmPhoto(initial, file(), s);
  await confirmDmPhoto(initial, uploaded, s);
  expect(api.call.mock.calls[0][0]).toMatchObject({ ...initial, action: 'uploadPhoto' });
  expect(api.call.mock.calls[1][0]).toEqual({ ...initial, path: draft });
});

it('never uploads after the viewer changes or to a grant with the wrong object key', async () => {
  const post = vi.fn();
  vi.stubGlobal('fetch', post);
  const data = {
    url,
    expiresAt: expiry(),
    path: draft,
    method: 'POST',
    mediaId: 'abc',
    fields: { key: 'other' },
  };
  api.call.mockResolvedValueOnce({ data }).mockImplementationOnce(async () => {
    api.uid = 'other';
    return { data: { ...data, fields: { key: draft } } };
  });
  await expect(uploadDmPhoto(scope, file(), signal())).rejects.toThrow();
  await expect(uploadDmPhoto(scope, file(), signal())).rejects.toThrow();
  expect(post).not.toHaveBeenCalled();
});

it('requires a receipt for the exact message and thread', async () => {
  const receipt = { conversationId: scope.conversationId, messageId: scope.messageId };
  api.call
    .mockResolvedValueOnce({ data: { ...receipt, messageId: 'somewhere' } })
    .mockResolvedValueOnce({ data: { ...receipt, conversationId: 'somewhere' } })
    .mockResolvedValueOnce({ data: receipt });
  await expect(confirmDmPhoto(scope, draft, signal())).rejects.toThrow();
  await expect(confirmDmPhoto(scope, draft, signal())).rejects.toThrow();
  await confirmDmPhoto(scope, draft, signal());
  expect(api.callable).toHaveBeenLastCalledWith('functions', 'sendDmPhoto');
  expect(api.call).toHaveBeenLastCalledWith({ ...scope, path: draft });
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
  expect(api.call).not.toHaveBeenCalled();
});

it('requests a fresh, scoped GET each time and checks expiry, URL type and object binding', async () => {
  const grant = signed(path);
  api.call.mockResolvedValueOnce({ data: grant }).mockResolvedValueOnce({ data: grant });
  for (let i = 0; i < 2; ++i) expect(await readDmPhoto(scope, path, signal())).toEqual(grant);
  expect(api.call).toHaveBeenCalledTimes(2);
  expect(api.call).toHaveBeenLastCalledWith({
    ...scope,
    action: 'read',
    folder: 'photos',
    mediaId: 'abc',
    fileName: 'sent.jpg',
  });
  for (const data of [
    signed(path.replace('dm-alice-bob', 'elsewhere')),
    { ...grant, url: grant.url + '&token=secret' },
    { ...grant, url: grant.url.replace('storage.googleapis.com', 'untrusted.test') },
    { ...grant, expiresAt: '1999-01-01T00:00:00Z' },
  ]) {
    api.call.mockResolvedValueOnce({ data });
    await expect(readDmPhoto(scope, path, signal())).rejects.toThrow();
  }
});

it('reports photos unavailable after the callable is confirmed missing', async () => {
  functionsConfig.enabled = false;
  api.call.mockRejectedValue({ code: 'functions/not-found' });
  await expect(uploadDmPhoto(scope, file(), signal())).rejects.toThrow('photo-unavailable');
  await expect(confirmDmPhoto(scope, draft, signal())).rejects.toThrow('photo-unavailable');
  await expect(readDmPhoto(scope, path, signal())).rejects.toThrow('photo-unavailable');
  expect(api.callable).toHaveBeenCalled();
});
