// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { createMemoryGroupStore } from './memoryGroupStore';
import { resetUidRateLimitForTests } from './uidRateLimit';
import { HOSTED_WEB_CALLABLES } from '../hostedCallables';
import { getCloudFunctionUrl } from '../cloudFunctions';

beforeEach(() => resetUidRateLimitForTests());
const text = {
  viewerUid: 'alice', schoolId: 'pu', peerUid: 'bob',
  conversationId: 'dm_pu_alice_bob', messageId: 'first-text-message-00001', content: '  你好  ',
};
const reply = {
  viewerUid: 'alice', schoolId: 'pu', authorUid: 'bob',
  storyId: 'story-1', replyId: 'test-reply-0000000001', content: '  你好  ',
};
const cases = [
  ['prepareDmConversation', text, '請先登入。'],
  ['sendDmText', text, '請先登入。'],
  ['replyToCampusStory', reply, '請先登入再回覆。'],
] as const;
function setup() {
  const store = createMemoryGroupStore([
    ['users/alice', { primarySchoolId: 'pu' }],
    ['schools/pu/members/alice', { status: 'active' }],
    ['campusStories/story-1', { schoolId: 'pu', authorUid: 'bob', expiresAt: Date.now() + 60000 }],
  ]);
  const verifyIdToken = vi.fn(async (token: string) => {
    if (token !== 'fake-valid') throw new Error('invalid token');
    return { uid: 'alice' };
  });
  return { store, runtime: { db: store.db as FnRuntime['db'], verifyIdToken }, verifyIdToken };
}
function request(data: unknown, token?: string) {
  return new Request('https://nuni.tw/api/fn/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data }),
  });
}
it.each(cases)('%s preserves missing/invalid token errors and does not check revocation', async (name, data, message) => {
  const { runtime, verifyIdToken } = setup();
  const missing = await dispatchFnRequest(name, request(data), runtime);
  expect(missing.status).toBe(401);
  expect(await missing.json()).toEqual({ error: { status: 'UNAUTHENTICATED', message } });
  const invalid = await dispatchFnRequest(name, request(data, 'fake-invalid'), runtime);
  expect(invalid.status).toBe(401);
  expect((await invalid.json()).error.status).toBe('UNAUTHENTICATED');
  const ok = await dispatchFnRequest(name, request(data, 'fake-valid'), runtime);
  expect(ok.status).toBe(200);
  expect(verifyIdToken).toHaveBeenLastCalledWith('fake-valid');
});
it.each(cases)('%s hosts writes and returns 503 when Admin is unavailable', async (name, data) => {
  expect(HOSTED_WEB_CALLABLES).toContain(name);
  expect(getCloudFunctionUrl(name, { env: {} })).toBe(`/api/fn/${name}`);
  const { runtime, store } = setup();
  const ok = await dispatchFnRequest(name, request(data, 'fake-valid'), runtime);
  const { result } = await ok.json();
  expect(result.conversationId).toBe(text.conversationId);
  const thread = store.docs.get('conversations/' + text.conversationId);
  if (name === 'prepareDmConversation') {
    expect(result.exists).toBe(false);
    expect(thread).toBeUndefined();
  } else {
    const row = store.docs.get(`conversations/${result.conversationId}/messages/${result.messageId}`);
    expect(Object.keys(row!).sort()).toEqual([
      'conversationId', 'senderId', 'content', 'type', 'readBy', 'createdAt',
      ...(name === 'replyToCampusStory' ? ['storyReplyTo'] : []),
    ].sort());
    expect(row).toMatchObject({ type: 'text', readBy: ['alice'], content: '你好' });
    expect(thread?.lastMessage).toEqual({ id: result.messageId, ...row });
  }
  const disabled = await dispatchFnRequest(name, request(data), null);
  expect(disabled.status).toBe(503);
  expect((await disabled.json()).error.message).toBe('尚未啟用');
});
it('does not host photo or attachment callables', () => {
  expect(HOSTED_WEB_CALLABLES).not.toContain('sendDmPhoto');
  expect(HOSTED_WEB_CALLABLES).not.toContain('dmAttachmentDelivery');
});
