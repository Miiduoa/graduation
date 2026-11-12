import { beforeEach, expect, it, vi } from 'vitest';
import { httpsCallable } from 'firebase/functions';
import { sendStoryReply } from './storyReplies';

const runtime = vi.hoisted(() => ({ uid: 'reader', configured: true, invoke: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => runtime.invoke) }));
vi.mock('@/lib/firebase', () => ({
  isFirebaseConfigured: () => runtime.configured,
  getAuth: () => ({ currentUser: { uid: runtime.uid } }),
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
