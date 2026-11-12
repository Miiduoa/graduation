import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sendStoryReply } from './storyReplies';

const runtime = vi.hoisted(() => ({ uid: 'reader', configured: true, fetch: vi.fn() }));
vi.mock('@/lib/firebase', () => ({
  isFirebaseConfigured: () => runtime.configured,
  getAuth: () => ({ currentUser: { uid: runtime.uid, getIdToken: async () => 'fake-token' } }),
}));
const input = {
  schoolId: 'pu',
  storyId: 's1',
  authorUid: 'alice',
  replyId: '0123456789abcdefghij',
  content: '好啊',
};
beforeEach(() => {
  vi.clearAllMocks();
  runtime.configured = true;
  runtime.uid = 'reader';
  runtime.fetch.mockReset();
  vi.stubGlobal('fetch', runtime.fetch);
});
afterEach(() => vi.unstubAllGlobals());

it('pins the intended sender to /api/fn and requires a real delivery receipt', async () => {
  runtime.fetch
    .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { conversationId: 'dm_pu_alice_reader', messageId: 'm1' } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { conversationId: 'dm_pu_alice_reader', messageId: '' } }) });
  await expect(sendStoryReply('reader', input)).resolves.toBe('dm_pu_alice_reader');
  expect(runtime.fetch).toHaveBeenCalledWith('/api/fn/replyToCampusStory', expect.objectContaining({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' },
    body: JSON.stringify({ data: { ...input, viewerUid: 'reader' } }),
  }));
  await expect(sendStoryReply('reader', input)).rejects.toThrow('reply-unconfirmed');
  runtime.fetch.mockResolvedValueOnce({
    ok: true, json: async () => ({ result: { conversationId: 'dm_pu_bob_reader', messageId: 'm1' } }),
  });
  await expect(sendStoryReply('reader', input)).rejects.toThrow('reply-unconfirmed');
});

it('prevents demo and stale-account requests, and hides a response after sign-out', async () => {
  runtime.configured = false;
  await expect(sendStoryReply('reader', input)).rejects.toThrow('reply-session');
  runtime.configured = true;
  runtime.uid = 'other';
  await expect(sendStoryReply('reader', input)).rejects.toThrow('reply-session');
  expect(runtime.fetch).not.toHaveBeenCalled();
  runtime.uid = 'reader';
  runtime.fetch.mockImplementationOnce(async () => {
    runtime.uid = 'other';
    return { ok: true, json: async () => ({ result: { conversationId: 'private-thread', messageId: 'm1' } }) };
  });
  await expect(sendStoryReply('reader', input)).rejects.toThrow('reply-session');
});

it('delivers through same-origin /api/fn', async () => {
  runtime.fetch.mockResolvedValue({
    ok: true, json: async () => ({ result: { conversationId: 'dm_pu_alice_reader', messageId: 'story-receipt' } }),
  });
  await expect(sendStoryReply('reader', input)).resolves.toBe('dm_pu_alice_reader');
  expect(runtime.fetch).toHaveBeenCalledWith('/api/fn/replyToCampusStory', expect.anything());
});

it('does not downgrade a denied story reply', async () => {
  runtime.fetch.mockResolvedValueOnce({
    ok: false, json: async () => ({ error: { status: 'PERMISSION_DENIED', message: '目前無法回覆這則限時動態。' } }),
  });
  await expect(sendStoryReply('reader', input)).rejects.toMatchObject({
    code: 'functions/permission-denied',
    message: '目前無法回覆這則限時動態。',
  });
});
