import { getDmAttachmentUrl, uploadDmAttachment } from '../../services/dmAttachments';
import { httpsCallable } from 'firebase/functions';

let uid: string | null = 'alice';
let mockMode = false;
const sign = jest.fn();
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: uid ? { uid } : null }),
  getFunctionsInstance: () => 'functions',
  isFirebaseMockMode: () => mockMode,
}));
jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn(() => sign),
}));

const originalFetch = global.fetch;
beforeEach(() => {
  uid = 'alice';
  mockMode = false;
  sign.mockReset();
  (httpsCallable as jest.Mock).mockClear();
});
afterEach(() => {
  global.fetch = originalFetch;
});

test('current DM member uploads by short-lived POST and receives durable object path, not a Firebase token', async () => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    if (url === 'file:///photo.png') return { ok: true, blob: async () => new Blob(['picture'], { type: 'image/png' }) };
    return { ok: true, status: 204 };
  }) as unknown as typeof fetch;
  sign.mockResolvedValueOnce({ data: {
    method: 'POST', url: 'https://storage.test/upload', fields: { key: 'signed-key', 'Content-Type': 'image/png' },
    path: 'conversations/dm_pu_alice_bob/media/server-id/photo.png', mediaId: 'server-id', expiresAt: 'soon',
  } }).mockResolvedValueOnce({ data: { url: 'https://storage.test/read?X-Goog-Signature=x', expiresAt: 'soon' } });

  const receipt = await uploadDmAttachment('dm_pu_alice_bob', 'file:///photo.png', 'photo.png', 'image/png');
  expect(receipt).toEqual({
    path: 'conversations/dm_pu_alice_bob/media/server-id/photo.png',
    previewUrl: 'https://storage.test/read?X-Goog-Signature=x',
    previewExpiresAt: 'soon',
  });
  expect(sign.mock.calls).toEqual([
    [{ action: 'upload', conversationId: 'dm_pu_alice_bob', fileName: 'photo.png', contentType: 'image/png', size: 7 }],
    [{ action: 'read', conversationId: 'dm_pu_alice_bob', folder: 'media', mediaId: 'server-id', fileName: 'photo.png' }],
  ]);
  expect(calls).toHaveLength(2);
  expect(calls[1][1]).toEqual({ method: 'POST', body: expect.any(FormData) });
  expect((httpsCallable as jest.Mock).mock.calls).toEqual([
    ['functions', 'dmAttachmentDelivery'], ['functions', 'dmAttachmentDelivery'],
  ]);
  expect(JSON.stringify(receipt)).not.toContain('firebaseStorageDownloadTokens');
});

test('a legitimate second member can open a legacy message object through fresh callable authorization', async () => {
  uid = 'bob';
  sign.mockResolvedValueOnce({ data: { url: 'https://storage.test/read', expiresAt: 'soon' } });
  await expect(getDmAttachmentUrl('conversations/dm_pu_alice_bob/messages/old-message/file.pdf'))
    .resolves.toEqual({ url: 'https://storage.test/read', expiresAt: 'soon' });
  expect(sign).toHaveBeenCalledWith({
    action: 'read', conversationId: 'dm_pu_alice_bob',
    folder: 'messages', mediaId: 'old-message', fileName: 'file.pdf',
  });
});

test.each(['conversations/../media/x/file.pdf', 'conversations/dm/media/x/../../etc', 'https://evil.test/a'])(
  'does not send arbitrary object paths to the signer (%s)', async (path) => {
    await expect(getDmAttachmentUrl(path)).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled();
  },
);

test('missing login and demo sessions never ask for upload or read capabilities', async () => {
  uid = null;
  await expect(getDmAttachmentUrl('conversations/c/media/i/file.pdf')).rejects.toThrow();
  uid = 'alice';
  mockMode = true;
  await expect(uploadDmAttachment('c', 'file:///photo', 'file.png', 'image/png')).rejects.toThrow();
  expect(sign).not.toHaveBeenCalled();
});

test('a transfer or account switch during upload fails closed even if a signed policy was issued', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true, blob: async () => { uid = 'bob'; return new Blob(['photo']); },
  })) as unknown as typeof fetch;
  await expect(uploadDmAttachment('dm', 'file:///photo', 'photo.png', 'image/png')).rejects.toThrow('帳號已切換');
  expect(sign).not.toHaveBeenCalled();
});

test('denied capability and failed GCS upload are surfaced, not treated as a successful attachment', async () => {
  global.fetch = jest.fn(async (url: string) => {
    if (url === 'file:///photo') return { ok: true, blob: async () => new Blob(['photo']) };
    return { ok: false, status: 403 };
  }) as unknown as typeof fetch;
  sign.mockResolvedValueOnce({ data: {
    method: 'POST', url: 'https://storage.test/upload', fields: { key: 'signed' },
    path: 'conversations/dm/media/signed/photo.png', mediaId: 'signed',
  } });
  await expect(uploadDmAttachment('dm', 'file:///photo', 'photo.png', 'image/png'))
    .rejects.toThrow('附件上傳失敗');
  expect(sign).toHaveBeenCalledTimes(1);
});
