import { getDmAttachmentUrl, uploadDmAttachment } from '../../services/dmAttachments';
import { httpsCallable } from 'firebase/functions';

let mockUid: string | null = 'alice';
let mockMode = false;
const mockSign = jest.fn();
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
  getFunctionsInstance: () => 'functions',
  isFirebaseMockMode: () => mockMode,
}));
jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn(() => mockSign),
}));

const originalFetch = global.fetch;
beforeEach(() => {
  mockUid = 'alice';
  mockMode = false;
  mockSign.mockReset();
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
  mockSign.mockResolvedValueOnce({ data: {
    method: 'POST', url: 'https://storage.test/upload', fields: { key: 'signed-key', 'Content-Type': 'image/png' },
    path: 'conversations/dm_pu_alice_bob/media/server-id/photo.png', mediaId: 'server-id', expiresAt: 'soon',
  } }).mockResolvedValueOnce({ data: { url: 'https://storage.test/read?X-Goog-Signature=x', expiresAt: 'soon' } });

  const receipt = await uploadDmAttachment('dm_pu_alice_bob', 'file:///photo.png', 'photo.png', 'image/png');
  expect(receipt).toEqual({
    path: 'conversations/dm_pu_alice_bob/media/server-id/photo.png',
    previewUrl: 'https://storage.test/read?X-Goog-Signature=x',
    previewExpiresAt: 'soon',
  });
  expect(mockSign.mock.calls).toEqual([
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

test('uploads to an existing conversation ID longer than 120 characters', async () => {
  const conversationId = `dm_pu_${'a'.repeat(64)}_${'b'.repeat(64)}`;
  expect(conversationId).toHaveLength(135);
  global.fetch = jest.fn(async (url: string) => {
    if (url === 'file:///photo.png') return { ok: true, blob: async () => new Blob(['picture'], { type: 'image/png' }) };
    return { ok: true, status: 204 };
  }) as unknown as typeof fetch;
  mockSign.mockResolvedValueOnce({
    data: {
      method: 'POST',
      url: 'https://storage.test/upload',
      fields: { key: 'signed-key', 'Content-Type': 'image/png' },
      path: `conversations/${conversationId}/media/server-id/photo.png`,
      mediaId: 'server-id',
      expiresAt: 'soon',
    },
  }).mockResolvedValueOnce({
    data: { url: 'https://storage.test/read?X-Goog-Signature=x', expiresAt: 'soon' },
  });
  await expect(
    uploadDmAttachment(conversationId, 'file:///photo.png', 'photo.png', 'image/png'),
  ).resolves.toMatchObject({
    path: `conversations/${conversationId}/media/server-id/photo.png`,
  });
  expect(mockSign).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'upload', conversationId }),
  );
});

test('a legitimate second member can open a legacy message object through fresh callable authorization', async () => {
  mockUid = 'bob';
  mockSign.mockResolvedValueOnce({ data: { url: 'https://storage.test/read', expiresAt: 'soon' } });
  await expect(getDmAttachmentUrl('conversations/dm_pu_alice_bob/messages/old-message/file.pdf'))
    .resolves.toEqual({ url: 'https://storage.test/read', expiresAt: 'soon' });
  expect(mockSign).toHaveBeenCalledWith({
    action: 'read', conversationId: 'dm_pu_alice_bob',
    folder: 'messages', mediaId: 'old-message', fileName: 'file.pdf',
  });
});

test.each(['conversations/../media/x/file.pdf', 'conversations/dm/media/x/../../etc', 'https://evil.test/a'])(
  'does not send arbitrary object paths to the signer (%s)', async (path) => {
    await expect(getDmAttachmentUrl(path)).rejects.toThrow();
    expect(mockSign).not.toHaveBeenCalled();
  },
);

test('missing login and demo sessions never ask for upload or read capabilities', async () => {
  mockUid = null;
  await expect(getDmAttachmentUrl('conversations/c/media/i/file.pdf')).rejects.toThrow();
  mockUid = 'alice';
  mockMode = true;
  await expect(uploadDmAttachment('c', 'file:///photo', 'file.png', 'image/png')).rejects.toThrow();
  expect(mockSign).not.toHaveBeenCalled();
});

test('a transfer or account switch during upload fails closed even if a signed policy was issued', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true, blob: async () => { mockUid = 'bob'; return new Blob(['photo']); },
  })) as unknown as typeof fetch;
  await expect(uploadDmAttachment('dm', 'file:///photo', 'photo.png', 'image/png')).rejects.toThrow('帳號已切換');
  expect(mockSign).not.toHaveBeenCalled();
});

test('denied capability and failed GCS upload are surfaced, not treated as a successful attachment', async () => {
  global.fetch = jest.fn(async (url: string) => {
    if (url === 'file:///photo') return { ok: true, blob: async () => new Blob(['photo']) };
    return { ok: false, status: 403 };
  }) as unknown as typeof fetch;
  mockSign.mockResolvedValueOnce({ data: {
    method: 'POST', url: 'https://storage.test/upload', fields: { key: 'signed' },
    path: 'conversations/dm/media/signed/photo.png', mediaId: 'signed',
  } });
  await expect(uploadDmAttachment('dm', 'file:///photo', 'photo.png', 'image/png'))
    .rejects.toThrow('附件上傳失敗');
  expect(mockSign).toHaveBeenCalledTimes(1);
});
