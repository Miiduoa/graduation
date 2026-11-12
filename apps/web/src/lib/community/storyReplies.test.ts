const functionsConfig = vi.hoisted(() => ({ enabled: true }));
vi.mock('../cloudFunctions', () => ({ areFunctionsConfigured: () => functionsConfig.enabled }));
import { beforeEach, expect, it, vi } from 'vitest';
import { httpsCallable } from 'firebase/functions';
import { sendStoryReply } from './storyReplies';

const runtime = vi.hoisted(() => ({ uid: 'reader', configured: true, invoke: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => runtime.invoke) }));
vi.mock('@/lib/firebase', () => ({
  isFirebaseConfigured: () => runtime.configured,
  getAuth: () => ({ currentUser: { uid: runtime.uid, getIdToken: async () => 'fake-token' } }),
  getFunctionsInstance: () => ({}),
}));
const input = {
  schoolId: 'pu',
  storyId: 's1',
  authorUid: 'alice',
  replyId: '0123456789abcdefghij',
  content: '好啊',
};
beforeEach(() => {
  functionsConfig.enabled = true;
  vi.clearAllMocks();
  runtime.configured = true;
  runtime.uid = 'reader';
});

it('pins the intended sender to the callable and requires a real delivery receipt', async () => {
  runtime.invoke
    .mockResolvedValueOnce({ data: { conversationId: 'dm_pu_alice_reader', messageId: 'm1' } })
    .mockResolvedValueOnce({ data: { conversationId: 'dm_pu_alice_reader', messageId: '' } });
  await expect(sendStoryReply('reader', input)).resolves.toBe('dm_pu_alice_reader');
  expect(httpsCallable).toHaveBeenCalledWith({}, 'replyToCampusStory');
  expect(runtime.invoke).toHaveBeenCalledWith({ ...input, viewerUid: 'reader' });
  await expect(sendStoryReply('reader', input)).rejects.toThrow('reply-unconfirmed');
  runtime.invoke.mockResolvedValueOnce({
    data: { conversationId: 'dm_pu_bob_reader', messageId: 'm1' },
  });
  await expect(sendStoryReply('reader', input)).rejects.toThrow('reply-unconfirmed');
});

it('prevents demo and stale-account requests, and hides a response after sign-out', async () => {
  runtime.configured = false;
  await expect(sendStoryReply('reader', input)).rejects.toThrow('reply-session');
  runtime.configured = true;
  runtime.uid = 'other';
  await expect(sendStoryReply('reader', input)).rejects.toThrow('reply-session');
  expect(runtime.invoke).not.toHaveBeenCalled();
  runtime.uid = 'reader';
  runtime.invoke.mockImplementationOnce(async () => {
    runtime.uid = 'other';
    return { data: { conversationId: 'private-thread', messageId: 'm1' } };
  });
  await expect(sendStoryReply('reader', input)).rejects.toThrow('reply-session');
});

it.each([false, true])('delivers through hosted when absent (configured=%s)', async (configured) => {
  functionsConfig.enabled = configured;
  runtime.invoke.mockRejectedValueOnce({ code: 'functions/not-found' });
  const fetcher = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ result: { conversationId: 'dm_pu_alice_reader', messageId: 'story-receipt' } }),
  });
  vi.stubGlobal('fetch', fetcher);
  try {
    await expect(sendStoryReply('reader', input)).resolves.toBe('dm_pu_alice_reader');
    expect(httpsCallable).toHaveBeenCalledWith({}, 'replyToCampusStory');
    expect(fetcher).toHaveBeenCalledWith('/api/fn/replyToCampusStory', expect.anything());
  } finally { vi.unstubAllGlobals(); }
});
it('does not downgrade a denied story reply', async () => {
  const error = { code: 'functions/permission-denied' };
  runtime.invoke.mockRejectedValueOnce(error);
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  try {
    await expect(sendStoryReply('reader', input)).rejects.toBe(error);
    expect(fetcher).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
