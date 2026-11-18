const { onCall } = require('firebase-functions/v2/https');
const { createDmConversations } = require('./dmConversations');
const { classifyFunctions } = require('./functionRegistry');
const { transactionStore } = require('./testSupport/transactionStore');

const conversationId = 'dm_pu_alice_bob';
const thread = 'conversations/' + conversationId;
const messageId = 'first-text-message-00001';
const identity = { viewerUid: 'alice', schoolId: 'pu', peerUid: 'bob' };
let store;
let service;

function prepare(data = {}, uid = 'alice') {
  return service.prepare({ auth: { uid }, data: { ...identity, ...data } });
}

function send(data = {}, uid = 'alice') {
  return service.sendText({
    auth: { uid },
    data: { ...identity, conversationId, messageId, content: '  一起去社團嗎？  ', ...data },
  });
}

beforeEach(() => {
  store = transactionStore(
    ['alice', 'bob', 'other'].flatMap((uid) => [
      ['users/' + uid, { schoolId: 'pu' }],
      ['schools/pu/members/' + uid, { status: 'active' }],
    ]),
  );
  service = createDmConversations({ db: store.db });
});

test('preparing either direction derives the same ID and leaves no empty conversation', async () => {
  const before = [...store.docs];
  expect(await prepare({ conversationId: 'client-controlled' })).toEqual({
    conversationId,
    peerUid: 'bob',
    exists: false,
  });
  expect(await prepare({ viewerUid: 'bob', peerUid: 'alice' }, 'bob')).toEqual({
    conversationId,
    peerUid: 'alice',
    exists: false,
  });
  expect([...store.docs]).toEqual(before);
  expect(await send()).toEqual({ conversationId, messageId });
  expect(await prepare()).toEqual({ conversationId, peerUid: 'bob', exists: true });
});

test('the first text atomically creates the canonical pair, message and inbox preview', async () => {
  const receipt = await send();
  expect(receipt).toEqual({ conversationId, messageId });
  expect(store.docs.get(thread)).toMatchObject({
    type: 'dm',
    schoolId: 'pu',
    memberIds: ['alice', 'bob'],
    lastMessage: { id: messageId, senderId: 'alice', content: '一起去社團嗎？' },
    lastMessageSenderId: 'alice',
    lastMessageText: '一起去社團嗎？',
  });
  expect(store.docs.get(`${thread}/messages/${messageId}`)).toMatchObject({
    conversationId,
    senderId: 'alice',
    content: '一起去社團嗎？',
    type: 'text',
    readBy: ['alice'],
  });
  expect([...store.docs.keys()].filter((path) => path.startsWith('conversations/'))).toHaveLength(
    2,
  );
});

test.each(
  ['alice', 'bob', 'both'].flatMap((member) =>
    [{}, { schoolId: '' }, { schoolId: null }].map((profile) => [member, profile]),
  ),
)('active legacy member %s with profile %j can prepare and send first and existing text', async (member, profile) => {
  for (const uid of member === 'both' ? ['alice', 'bob'] : [member]) {
    store.docs.set(`users/${uid}`, profile);
  }
  expect(await prepare()).toEqual({ conversationId, peerUid: 'bob', exists: false });
  expect(store.docs.has(thread)).toBe(false);
  expect(await send()).toEqual({ conversationId, messageId });
  expect(store.docs.get(thread)).toMatchObject({
    type: 'dm',
    schoolId: 'pu',
    memberIds: ['alice', 'bob'],
    lastMessage: { id: messageId, type: 'text', content: '一起去社團嗎？' },
  });
  expect(await prepare()).toEqual({ conversationId, peerUid: 'bob', exists: true });
  const nextId = 'next-text-message-000002';
  expect(await send({ messageId: nextId })).toEqual({ conversationId, messageId: nextId });
  expect(store.docs.get(`${thread}/messages/${nextId}`)).toMatchObject({ type: 'text' });
  expect(await send()).toEqual({ conversationId, messageId });
});

test.each([
  ['users/alice', { status: 'disabled' }],
  ['users/alice', { accountDeletionInProgress: true }],
])('legacy profiles still reject prepare and sends when access changes at %s', async (path, value) => {
  store.docs.set('users/alice', {});
  store.docs.set('users/bob', { schoolId: '' });
  const original = store.docs.get(path);
  store.docs.set(path, value);
  await expect(prepare()).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(send()).rejects.toMatchObject({ code: 'permission-denied' });
  expect(store.docs.has(thread)).toBe(false);
  if (original) store.docs.set(path, original);
  else store.docs.delete(path);
  await send();
  const before = store.docs.get(thread);
  store.docs.set(path, value);
  await expect(prepare()).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(send({ messageId: 'next-text-message-000002' })).rejects.toMatchObject({
    code: 'permission-denied',
  });
  await expect(send()).rejects.toMatchObject({ code: 'permission-denied' });
  expect(store.docs.get(thread)).toEqual(before);
  expect(store.docs.has(`${thread}/messages/next-text-message-000002`)).toBe(false);
});

test.each([
  ['users/bob', { status: 'suspended', schoolId: '' }],
  ['users/bob', { status: 'deleted' }],
  ['users/bob', { accountDeletionInProgress: true }],
  ['users/alice/blockedUsers/bob', {}],
  ['users/bob/blockedUsers/alice', {}],
  ['friendBlocks/alice_bob', {}],
  ['friendBlocks/bob_alice', {}],
])('peer account status and block records do not block first or existing DM at %s', async (path, value) => {
  store.docs.set('users/alice', {});
  store.docs.set(path, value);
  expect(await prepare()).toEqual({ conversationId, peerUid: 'bob', exists: false });
  expect(await send()).toEqual({ conversationId, messageId });
  store.docs.set(path, value);
  expect(await prepare()).toEqual({ conversationId, peerUid: 'bob', exists: true });
  expect(await send({ messageId: 'next-text-message-000002' })).toEqual({
    conversationId,
    messageId: 'next-text-message-000002',
  });
});

test.each([
  ['users/alice', { schoolId: 'elsewhere' }],
  ['users/bob', { schoolId: 'elsewhere' }],
  ['schools/pu/members/alice', { status: 'inactive' }],
  ['schools/pu/members/bob', { status: 'inactive' }],
])('existing conversation still sends after school change at %s', async (path, value) => {
  store.docs.set('users/alice', {});
  store.docs.set('users/bob', { schoolId: '' });
  expect(await send()).toEqual({ conversationId, messageId });
  store.docs.set(path, value);
  expect(await prepare()).toEqual({ conversationId, peerUid: 'bob', exists: true });
  const nextId = 'next-text-message-000002';
  expect(await send({ messageId: nextId })).toEqual({ conversationId, messageId: nextId });
});

test('trims before applying the 4000 character limit and limits the inbox preview', async () => {
  await send({ content: `  ${'字'.repeat(4000)}  ` });
  expect(store.docs.get(`${thread}/messages/${messageId}`).content).toHaveLength(4000);
  expect(store.docs.get(thread).lastMessageText).toHaveLength(50);
});

test('a receipt replay preserves a later message and existing read state', async () => {
  store.docs.set(thread, {
    type: 'dm',
    schoolId: 'pu',
    memberIds: ['bob', 'alice'],
    lastReadBy: { bob: 42 },
  });
  const first = await send();
  const second = await send(
    {
      viewerUid: 'bob',
      peerUid: 'alice',
      messageId: 'next-text-message-000002',
      content: '走吧',
    },
    'bob',
  );
  const latest = store.docs.get(thread);
  expect(await send()).toEqual(first);
  expect(store.docs.get(thread)).toEqual(latest);
  expect(latest).toMatchObject({ lastReadBy: { bob: 42 }, lastMessage: { id: second.messageId } });
  expect([...store.docs.keys()].filter((path) => path.includes('/messages/'))).toHaveLength(2);
});

test.each([
  ['users/alice', { schoolId: 'pu', status: 'deleted' }],
  ['users/alice', { schoolId: 'pu', status: 'disabled' }],
  ['users/alice', { schoolId: 'pu', status: 'inactive' }],
  ['users/alice', { schoolId: 'pu', accountDeletionInProgress: true }],
])(
  'refuses preparation, first delivery and receipt replay after access changes at %s',
  async (path, value) => {
    const original = store.docs.get(path);
    store.docs.set(path, value);
    await expect(prepare()).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(send()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(store.docs.has(thread)).toBe(false);
    if (original) store.docs.set(path, original);
    else store.docs.delete(path);
    await send();
    const before = store.docs.get(thread);
    store.docs.set(path, value);
    await expect(send()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(store.docs.get(thread)).toEqual(before);
  },
);

test('text DMs still send when the caller profile document is missing', async () => {
  store.docs.delete('users/alice');
  expect(await send()).toEqual({ conversationId, messageId });
  store.docs.delete('users/alice');
  expect(await send({ messageId: 'next-text-message-000002' })).toEqual({
    conversationId,
    messageId: 'next-text-message-000002',
  });
});

test('new chats still require the caller to have active school membership, existing chats do not', async () => {
  const path = 'schools/pu/members/alice';
  const original = store.docs.get(path);
  store.docs.set(path, { status: 'inactive' });
  await expect(prepare()).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(send()).rejects.toMatchObject({ code: 'permission-denied' });
  expect(store.docs.has(thread)).toBe(false);
  store.docs.set(path, original);
  await send();
  store.docs.set(path, { status: 'inactive' });
  expect(await send()).toEqual({ conversationId, messageId });
  expect(await send({ messageId: 'next-text-message-000002' })).toEqual({
    conversationId,
    messageId: 'next-text-message-000002',
  });
});

test.each([
  ['schools/pu/members/bob', { status: 'inactive' }],
  ['schools/pu/members/bob', null],
])('first DM does not require recipient school membership at %s', async (path, value) => {
  if (value == null) store.docs.delete(path);
  else store.docs.set(path, value);
  expect(await prepare()).toEqual({ conversationId, peerUid: 'bob', exists: false });
  expect(await send()).toEqual({ conversationId, messageId });
  expect(store.docs.get(thread)).toMatchObject({
    type: 'dm',
    schoolId: 'pu',
    memberIds: ['alice', 'bob'],
  });
});

test.each([
  ['users/alice', { schoolId: 'elsewhere' }],
  ['users/bob', { schoolId: 'elsewhere' }],
  ['users/alice', { primarySchoolId: 'pu' }],
  ['users/bob', {}],
])('active members can still open a first DM after profile school change at %s', async (path, value) => {
  store.docs.set(path, value);
  expect(await prepare()).toEqual({ conversationId, peerUid: 'bob', exists: false });
  expect(await send()).toEqual({ conversationId, messageId });
  expect(store.docs.get(thread)).toMatchObject({
    type: 'dm',
    schoolId: 'pu',
    memberIds: ['alice', 'bob'],
  });
});

test('refuses preparation and creation when the caller has no school membership', async () => {
  store.docs.delete('schools/pu/members/alice');
  await expect(prepare()).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(send()).rejects.toMatchObject({ code: 'permission-denied' });
  expect(store.docs.has(thread)).toBe(false);
});

test.each(['users/alice', 'users/bob'])(
  'first and existing DMs still send when %s is missing',
  async (path) => {
    store.docs.delete(path);
    expect(await prepare()).toEqual({ conversationId, peerUid: 'bob', exists: false });
    expect(await send()).toEqual({ conversationId, messageId });
    store.docs.delete(path);
    expect(await send({ messageId: 'next-text-message-000002' })).toEqual({
      conversationId,
      messageId: 'next-text-message-000002',
    });
  },
);

test.each([
  { type: 'group', schoolId: 'pu', memberIds: ['alice', 'bob'] },
  { type: 'dm', schoolId: 'elsewhere', memberIds: ['alice', 'bob'] },
  { type: 'dm', schoolId: 'pu', memberIds: ['alice', 'other'] },
  { type: 'dm', schoolId: 'pu', memberIds: ['bob', 'other'] },
  { type: 'dm', schoolId: 'pu', memberIds: ['alice', 'alice'] },
  { type: 'dm', schoolId: 'pu', memberIds: ['alice', 'bob', 'other'] },
  { type: 'dm', schoolId: 'pu', memberIds: ['alice'] },
  { type: 'dm', schoolId: 'pu', memberIds: 'alice,bob' },
])('rejects a stored thread whose identity does not match the requested pair %j', async (row) => {
  store.docs.set(thread, row);
  await expect(prepare()).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(send()).rejects.toMatchObject({ code: 'permission-denied' });
  expect(store.docs.get(thread)).toEqual(row);
  expect([...store.docs.keys()].some((path) => path.includes('/messages/'))).toBe(false);
});

test.each([
  { peerUid: undefined },
  { peerUid: null },
  { peerUid: '../bob' },
  { schoolId: '../pu' },
])('rejects malformed identity %j', async (data) => {
  await expect(prepare(data)).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(send(data)).rejects.toMatchObject({ code: 'invalid-argument' });
});

test.each([
  { content: ' ' },
  { content: null },
  { content: 123 },
  { content: '字'.repeat(4001) },
  { messageId: 'short' },
  { messageId: 'a'.repeat(65) },
  { messageId: 'bad/path/message-0000001' },
  { messageId: null },
  { conversationId: '../thread' },
  { conversationId: null },
])('rejects malformed message input %j', async (data) => {
  await expect(send(data)).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(store.docs.has(thread)).toBe(false);
});

test('binds the authenticated sender and rejects self, forged pair and forged conversation IDs', async () => {
  await expect(prepare({}, null)).rejects.toMatchObject({ code: 'unauthenticated' });
  await expect(send({}, null)).rejects.toMatchObject({ code: 'unauthenticated' });
  await expect(prepare({}, 'other')).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(send({}, 'other')).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(prepare({ peerUid: 'alice' })).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(send({ peerUid: 'alice' })).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(send({ conversationId: 'another-thread' })).rejects.toMatchObject({
    code: 'permission-denied',
  });
  await expect(send({ peerUid: 'other' })).rejects.toMatchObject({ code: 'permission-denied' });
  expect(store.docs.has(thread)).toBe(false);
});

test.each([
  { content: 'different' },
  { senderId: 'bob' },
  { conversationId: 'different' },
  { type: 'image' },
])('rejects reuse of a message ID for a different existing message %j', async (change) => {
  await send();
  const key = `${thread}/messages/${messageId}`;
  store.docs.set(key, { ...store.docs.get(key), ...change });
  await expect(send()).rejects.toMatchObject({ code: 'already-exists' });
});

test('a missing parent cannot turn an orphan message into a valid receipt or a new thread', async () => {
  await send();
  store.docs.delete(thread);
  await expect(send()).rejects.toMatchObject({ code: 'permission-denied' });
  expect(store.docs.has(thread)).toBe(false);
});

test('a failed first commit leaves neither a message nor an empty conversation', async () => {
  store.failNextCommit();
  await expect(send()).rejects.toThrow('commit unavailable');
  expect(store.docs.has(thread)).toBe(false);
  expect(store.docs.has(`${thread}/messages/${messageId}`)).toBe(false);
  expect(await send()).toEqual({ conversationId, messageId });
});

test('canonical conversation IDs longer than 120 characters still create and reopen', async () => {
  const alice = 'a'.repeat(64);
  const bob = 'b'.repeat(64);
  const longId = `dm_pu_${[alice, bob].sort().join('_')}`;
  expect(longId).toHaveLength(135);
  const local = transactionStore([
    [`users/${alice}`, { schoolId: 'pu' }],
    [`users/${bob}`, { schoolId: 'pu' }],
    [`schools/pu/members/${alice}`, { status: 'active' }],
  ]);
  const svc = createDmConversations({ db: local.db });
  const data = { viewerUid: alice, schoolId: 'pu', peerUid: bob };
  expect(await svc.prepare({ auth: { uid: alice }, data })).toEqual({
    conversationId: longId,
    peerUid: bob,
    exists: false,
  });
  expect(
    await svc.sendText({
      auth: { uid: alice },
      data: { ...data, conversationId: longId, messageId, content: '還在嗎' },
    }),
  ).toEqual({ conversationId: longId, messageId });
  expect(await svc.prepare({ auth: { uid: alice }, data })).toEqual({
    conversationId: longId,
    peerUid: bob,
    exists: true,
  });
  expect(
    await svc.sendText({
      auth: { uid: alice },
      data: { ...data, conversationId: longId, messageId, content: '還在嗎' },
    }),
  ).toEqual({ conversationId: longId, messageId });
  expect(local.docs.get(`conversations/${longId}/messages/${messageId}`).content).toBe('還在嗎');
});

test('the existing Fly registry exposes both v2 callable handlers', async () => {
  const { callables } = classifyFunctions({
    prepareDmConversation: onCall({ region: 'asia-east1' }, service.prepare),
    sendDmText: onCall({ region: 'asia-east1' }, service.sendText),
  });
  expect(Object.keys(callables)).toEqual(['prepareDmConversation', 'sendDmText']);
  expect(await callables.prepareDmConversation({ auth: { uid: 'alice' }, data: identity })).toEqual(
    {
      conversationId,
      peerUid: 'bob',
      exists: false,
    },
  );
  expect(
    await callables.sendDmText({
      auth: { uid: 'alice' },
      data: { ...identity, conversationId, messageId, content: '你好' },
    }),
  ).toEqual({ conversationId, messageId });
});
