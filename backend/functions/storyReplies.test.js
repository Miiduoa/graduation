const { createReplyToCampusStory } = require('./storyReplies');
const { transactionStore } = require('./testSupport/transactionStore');

const request = {
  viewerUid: 'alice',
  authorUid: 'bob',
  schoolId: 'pu',
  storyId: 'story-1',
  replyId: 'test-reply-0000000001',
  content: '  明天還有嗎？  ',
};
const story = {
  authorUid: 'bob',
  schoolId: 'pu',
  allowReplies: true,
  mediaUrl: 'private-media',
  text: '校園市集',
};
const thread = 'conversations/dm_pu_alice_bob';
let store;
const send = (overrides = {}, uid = 'alice') =>
  createReplyToCampusStory({ db: store.db })({ auth: { uid }, data: { ...request, ...overrides } });
beforeEach(() => {
  store = transactionStore([
    ['users/alice', { schoolId: 'pu' }],
    ['users/bob', { schoolId: 'pu' }],
    ['schools/pu/members/alice', { status: 'active' }],
    ['schools/pu/members/bob', { status: 'active' }],
    ['campusStories/story-1', { ...story, expiresAt: Date.now() + 60000 }],
  ]);
});

test('creates one private text message, retaining only the story identifiers', async () => {
  const receipt = await send();
  expect(receipt.conversationId).toBe('dm_pu_alice_bob');
  const message = store.docs.get(`${thread}/messages/${receipt.messageId}`);
  expect(message).toMatchObject({
    senderId: 'alice',
    content: '明天還有嗎？',
    readBy: ['alice'],
    storyReplyTo: { storyId: 'story-1', authorUid: 'bob' },
  });
  expect(JSON.stringify(message)).not.toMatch(/private-media|校園市集/);
  expect(store.docs.get(thread)).toMatchObject({
    memberIds: ['alice', 'bob'],
    type: 'dm',
    schoolId: 'pu',
    lastMessage: { id: receipt.messageId },
    lastMessageSenderId: 'alice',
  });
  expect([...store.docs.keys()].filter((key) => key.startsWith('campusStories/'))).toEqual([
    'campusStories/story-1',
  ]);
});

test('reuses the DM without resetting read state and never bumps the preview on replay', async () => {
  store.docs.set(thread, {
    type: 'dm',
    schoolId: 'pu',
    memberIds: ['bob', 'alice'],
    lastReadBy: { bob: 10 },
  });
  const first = await send();
  const latest = await send({ replyId: 'test-reply-0000000002', content: '謝謝' });
  store.docs.delete('campusStories/story-1');
  expect(await send()).toEqual(first);
  expect(store.docs.get(thread)).toMatchObject({
    lastReadBy: { bob: 10 },
    lastMessage: { id: latest.messageId },
  });
  expect([...store.docs.keys()].filter((key) => key.includes('/messages/'))).toHaveLength(2);
  await expect(send({ content: 'changed' })).rejects.toMatchObject({ code: 'already-exists' });
});

test.each([
  ['users/alice', { schoolId: 'other' }],
  ['users/alice', { schoolId: 'pu', status: 'deleted' }],
  ['users/bob', { accountDeletionInProgress: true }],
  ['schools/pu/members/alice', {}],
  ['schools/pu/members/bob', { status: 'inactive' }],
  ['users/alice/blockedUsers/bob', {}],
  ['users/bob/blockedUsers/alice', {}],
  ['friendBlocks/alice_bob', {}],
  ['friendBlocks/bob_alice', {}],
  ['campusStories/story-1', { ...story, allowReplies: false, expiresAt: 9e12 }],
  ['campusStories/story-1', { authorUid: 'bob', schoolId: 'pu', expiresAt: 9e12 }],
  ['campusStories/story-1', { ...story, expiresAt: 0 }],
  ['campusStories/story-1', { ...story, expiresAt: 'tomorrow' }],
  ['campusStories/story-1', { ...story, expiresAt: Infinity }],
  ['campusStories/story-1', { ...story, schoolId: 'other', expiresAt: 9e12 }],
  ['campusStories/story-1', { ...story, authorUid: 'charlie', expiresAt: 9e12 }],
  [thread, { type: 'group', schoolId: 'pu', memberIds: ['alice', 'bob'] }],
  [thread, { type: 'dm', schoolId: 'other', memberIds: ['alice', 'bob'] }],
  [thread, { type: 'dm', schoolId: 'pu', memberIds: ['alice', 'charlie'] }],
  [thread, { type: 'dm', schoolId: 'pu', memberIds: ['alice', 'bob', 'charlie'] }],
])('rejects stale access or a mismatched recipient at %s', async (path, record) => {
  store.docs.set(path, record);
  await expect(send()).rejects.toMatchObject({ code: 'permission-denied' });
  expect([...store.docs.keys()].some((key) => key.includes('/messages/'))).toBe(false);
});

test('rejects an expired or deleted story, a self reply, and an account switch', async () => {
  store.docs.delete('campusStories/story-1');
  await expect(send()).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(send({ authorUid: 'alice' })).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(send({}, 'charlie')).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(send({}, null)).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(store.docs.has(thread)).toBe(false);
});

test.each([
  { content: '   ' },
  { content: 'a'.repeat(501) },
  { content: 123 },
  { replyId: null },
  { replyId: 'wrong' },
  { storyId: '../bad' },
  { authorUid: 'bob/charlie' },
])('rejects malformed input %j', async (overrides) => {
  await expect(send(overrides)).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(store.docs.has(thread)).toBe(false);
});

test('a failed first commit leaves neither a message nor an empty conversation', async () => {
  store.failNextCommit();
  await expect(send()).rejects.toThrow('commit unavailable');
  expect(store.docs.has(thread)).toBe(false);
  await send();
  expect([...store.docs.keys()].filter((key) => key.includes('/messages/'))).toHaveLength(1);
});
