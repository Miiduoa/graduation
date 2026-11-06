const { createDmPhotos } = require('./dmPhotos');
const { createDmConversations } = require('./dmConversations');
const { transactionStore } = require('./testSupport/transactionStore');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');
const { generateKeyPairSync, verify } = require('node:crypto');

const messageId = 'photo-message-for-test-01';
const session = { schoolId: 'pu', conversationId: 'thread', viewerUid: 'alice', messageId };
const png = Buffer.from('89504e470d0a1a0a0000000d', 'hex');

function fixture({ conversationId = 'thread', createThread = true } = {}) {
  const store = transactionStore([
    ...(createThread
      ? [
          [
            'conversations/' + conversationId,
            { type: 'dm', schoolId: 'pu', memberIds: ['bob', 'alice'] },
          ],
        ]
      : []),
    ...['alice', 'bob', 'other'].flatMap((uid) => [
      ['users/' + uid, { schoolId: 'pu' }],
      ['schools/pu/members/' + uid, { status: 'active' }],
    ]),
  ]);
  const objects = new Map();
  let seq = 10;
  const missing = () => Object.assign(new Error('missing generation'), { code: 404 });
  const sign = jest.fn(async () => [
    'https://storage.googleapis.com/example/image?signature=temporary',
  ]);
  const policy = jest.fn(async (_, key) => [
    { url: 'https://storage.googleapis.com/example', fields: { key } },
  ]);
  const copy = jest.fn(async (record, dest, options) => {
    expect(options.preconditionOpts.ifGenerationMatch).toBe(0);
    if (objects.has(dest.name)) throw Object.assign(new Error('exists'), { code: 412 });
    objects.set(dest.name, { ...record, ...options, generation: String(++seq) });
  });
  const file = (name, options = {}) => {
    function record() {
      const value = objects.get(name);
      if (!value || (options.generation && options.generation !== value.generation))
        throw missing();
      return value;
    }
    return {
      name,
      getMetadata: async () => [record()],
      download: async () => [record().bytes],
      copy: (dest, opts) => copy(record(), dest, opts),
      delete: async () => {
        record();
        objects.delete(name);
      },
      generateSignedPostPolicyV4: (opts) => policy(opts, name),
      getSignedUrl: (opts) => sign(name, options.generation, opts),
    };
  };
  const bucket = { file };
  const services = createDmPhotos({ db: store.db, getBucket: () => bucket });
  const invoke = (handler, uid, data) =>
    handler({ auth: { uid }, data: { ...session, conversationId, viewerUid: uid, ...data } });
  const upload = (data = {}) =>
    invoke(services.delivery, 'alice', {
      action: 'uploadPhoto',
      size: 12,
      contentType: 'image/png',
      fileName: 'photo.png',
      ...data,
    });
  const send = (path, data = {}) => invoke(services.send, 'alice', { path, ...data });
  const read = (mediaId, uid = 'bob', data = {}) =>
    invoke(services.delivery, uid, {
      action: 'read',
      folder: 'photos',
      mediaId,
      fileName: 'sent.png',
      ...data,
    });
  const stage = (path, change = {}) =>
    objects.set(path, {
      size: '12',
      contentType: 'image/png',
      crc32c: 'crc32c',
      bytes: png,
      metadata: { uploader: 'alice', messageid: messageId },
      generation: String(++seq),
      ...change,
    });
  return { ...store, objects, copy, sign, policy, services, upload, send, read, stage };
}

test('sending persists only an immutable version; sender and recipient can request a fresh link', async () => {
  const f = fixture();
  const { path, mediaId } = await f.upload();
  expect((await f.upload()).path).toBe(path);
  await expect(f.read(mediaId)).rejects.toMatchObject({ code: 'permission-denied' });
  f.stage(path);
  const receipt = await f.send(path);
  expect(await f.send(path)).toEqual(receipt);
  const key = 'conversations/thread/messages/' + messageId;
  const row = f.docs.get(key);
  expect(row).toMatchObject({
    senderId: 'alice',
    content: '照片',
    type: 'image',
    attachmentPath: path.replace('photo.png', 'sent.png'),
    readBy: ['alice'],
  });
  expect(JSON.stringify(row)).not.toMatch(/https?:|signature=/);
  expect(f.docs.get('conversations/thread').lastMessage.id).toBe(messageId);
  expect(f.objects.has(path)).toBe(false);
  f.stage(path, { bytes: Buffer.from('different pixels') }); // Replay of an unexpired POST.
  expect(f.objects.get(row.attachmentPath).bytes).toEqual(png);
  for (const uid of ['alice', 'bob']) {
    expect(await f.read(mediaId, uid)).toHaveProperty('url');
  }
  expect(f.sign).toHaveBeenCalledWith(
    row.attachmentPath,
    row.attachmentGeneration,
    expect.objectContaining({ version: 'v4', action: 'read' }),
  );
  await expect(f.read(mediaId, 'other')).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(f.read(mediaId, 'bob', { fileName: 'photo.png' })).rejects.toMatchObject({
    code: 'invalid-argument',
  });
  f.docs.set(key, { ...row, recalledAt: new Date() });
  await expect(f.read(mediaId)).rejects.toMatchObject({ code: 'permission-denied' });
  expect(f.sign).toHaveBeenCalledTimes(2);
});

test.each([
  [{ contentType: 'image/svg+xml' }],
  [{ fileName: 'sent.png' }],
  [{ size: 0 }],
  [{ size: 10 * 1024 * 1024 }],
  [{ messageId: '../not-a-path' }],
  [{ schoolId: 'another' }],
  [{ viewerUid: 'bob' }],
])('rejects invalid photo requests before signing %j', async (data) => {
  const f = fixture();
  await expect(f.upload(data)).rejects.toThrow();
  expect(f.policy).not.toHaveBeenCalled();
});

test.each([
  { contentType: 'image/jpeg' },
  { bytes: Buffer.from('<html>image</html>') },
  { contentEncoding: 'gzip' },
  { size: 'NaN' },
  { generation: '90071992547409930' },
  { metadata: { uploader: 'bob', messageid: messageId } },
])('rejects changed or invalid staging objects', async (change) => {
  const f = fixture();
  const { path } = await f.upload();
  f.stage(path, change);
  await expect(f.send(path)).rejects.toThrow();
  expect(f.copy).not.toHaveBeenCalled();
  expect(f.docs.has('conversations/thread/messages/' + messageId)).toBe(false);
});

test('an acknowledged write can be retried after the draft is gone; another message cannot be overwritten', async () => {
  const f = fixture();
  const { path, mediaId } = await f.upload();
  f.stage(path);
  await f.send(path);
  const thread = f.docs.get('conversations/thread');
  thread.lastMessageText = 'newer conversation';
  const key = 'conversations/thread/messages/' + messageId;
  expect((await Promise.all([f.send(path), f.send(path)])).map((x) => x.messageId)).toEqual([
    messageId,
    messageId,
  ]);
  expect(f.docs.get('conversations/thread').lastMessageText).toBe('newer conversation');
  await expect(f.send(path.replace('photos/', 'media/'))).rejects.toMatchObject({
    code: 'invalid-argument',
  });
  await expect(f.read(mediaId, 'bob', { messageId: 'another-message-000001' })).rejects.toThrow();
  f.docs.set(key, { senderId: 'alice', type: 'text', content: 'hello' });
  await expect(f.send(path)).rejects.toMatchObject({ code: 'already-exists' });
});

test('rechecks both students at publication and issuance, including block and school changes', async () => {
  const f = fixture();
  const { path, mediaId } = await f.upload();
  f.stage(path);
  const original = f.copy.getMockImplementation();
  f.copy.mockImplementationOnce(async (...args) => {
    await original(...args);
    f.docs.set('users/bob', { schoolId: 'other' });
  });
  await expect(f.send(path)).rejects.toMatchObject({ code: 'permission-denied' });
  expect(f.docs.has('conversations/thread/messages/' + messageId)).toBe(false);
  f.docs.set('users/bob', { schoolId: 'pu' });
  await f.send(path); // Firestore failure after the copy can recover using the same file.
  for (const key of [
    'users/alice/blockedUsers/bob',
    'users/bob/blockedUsers/alice',
    'friendBlocks/bob_alice',
  ]) {
    f.docs.set(key, {});
    await expect(f.read(mediaId)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(f.send(path)).rejects.toMatchObject({ code: 'permission-denied' });
    f.docs.delete(key);
  }
  f.docs.set('schools/pu/members/alice', { status: 'inactive' });
  await expect(f.read(mediaId)).rejects.toMatchObject({ code: 'permission-denied' });
});

test('a first photo creates the canonical thread only when it is sent with the validated peer', async () => {
  const conversationId = 'dm_pu_alice_bob';
  const thread = 'conversations/' + conversationId;
  const f = fixture({ conversationId, createThread: false });
  await expect(f.upload()).rejects.toMatchObject({ code: 'permission-denied' });
  expect(f.policy).not.toHaveBeenCalled();
  const { path, mediaId } = await f.upload({ peerUid: 'bob' });
  expect(f.docs.has(thread)).toBe(false);
  await expect(f.read(mediaId, 'bob', { peerUid: 'alice' })).rejects.toMatchObject({
    code: 'permission-denied',
  });
  f.stage(path);
  await expect(f.send(path)).rejects.toMatchObject({ code: 'permission-denied' });
  expect(f.copy).not.toHaveBeenCalled();
  expect(await f.send(path, { peerUid: 'bob' })).toEqual({ conversationId, messageId });
  expect(f.docs.get(thread)).toMatchObject({
    type: 'dm',
    schoolId: 'pu',
    memberIds: ['alice', 'bob'],
    lastMessage: { id: messageId, type: 'image', content: '照片' },
  });
  expect(f.docs.get(`${thread}/messages/${messageId}`).attachmentPath).toBe(
    path.replace('photo.', 'sent.'),
  );
  expect(await f.read(mediaId)).toHaveProperty('url');
  expect(await f.send(path, { peerUid: 'bob' })).toEqual({ conversationId, messageId });
});

test.each([
  { peerUid: 'alice' },
  { peerUid: 'other' },
  { peerUid: 'bob', conversationId: 'forged-thread' },
])('new photo mode rejects a forged pair or conversation before signing %j', async (data) => {
  const f = fixture({ conversationId: 'dm_pu_alice_bob', createThread: false });
  await expect(f.upload(data)).rejects.toMatchObject({ code: 'permission-denied' });
  expect(f.policy).not.toHaveBeenCalled();
  expect([...f.docs.keys()].some((key) => key.startsWith('conversations/'))).toBe(false);
});

test('a first photo rechecks changed access after copying and leaves no empty thread on denial', async () => {
  const conversationId = 'dm_pu_alice_bob';
  const thread = 'conversations/' + conversationId;
  const f = fixture({ conversationId, createThread: false });
  const { path } = await f.upload({ peerUid: 'bob' });
  f.stage(path);
  const copy = f.copy.getMockImplementation();
  f.copy.mockImplementationOnce(async (...args) => {
    await copy(...args);
    f.docs.set('friendBlocks/bob_alice', {});
  });
  await expect(f.send(path, { peerUid: 'bob' })).rejects.toMatchObject({
    code: 'permission-denied',
  });
  expect(f.docs.has(thread)).toBe(false);
  expect(f.docs.has(`${thread}/messages/${messageId}`)).toBe(false);
  f.docs.delete('friendBlocks/bob_alice');
  await f.send(path, { peerUid: 'bob' });
  expect(f.docs.get(thread).lastMessage.id).toBe(messageId);
});

test('a failed first photo commit can retry without creating an empty inbox entry', async () => {
  const conversationId = 'dm_pu_alice_bob';
  const thread = 'conversations/' + conversationId;
  const f = fixture({ conversationId, createThread: false });
  const { path } = await f.upload({ peerUid: 'bob' });
  f.stage(path);
  const copy = f.copy.getMockImplementation();
  f.copy.mockImplementationOnce(async (...args) => {
    await copy(...args);
    f.failNextCommit();
  });
  await expect(f.send(path, { peerUid: 'bob' })).rejects.toThrow('commit unavailable');
  expect(f.docs.has(thread)).toBe(false);
  expect(f.docs.has(`${thread}/messages/${messageId}`)).toBe(false);
  expect(await f.send(path, { peerUid: 'bob' })).toEqual({ conversationId, messageId });
});

test('a text delivered during the first photo upload shares the same thread and preserves newer previews on replay', async () => {
  const conversationId = 'dm_pu_alice_bob';
  const thread = 'conversations/' + conversationId;
  const f = fixture({ conversationId, createThread: false });
  const text = createDmConversations({ db: f.db });
  const request = {
    auth: { uid: 'alice' },
    data: {
      viewerUid: 'alice',
      schoolId: 'pu',
      peerUid: 'bob',
      conversationId,
      messageId: 'first-text-message-00001',
      content: '這是剛才的照片',
    },
  };
  const { path } = await f.upload({ peerUid: 'bob' });
  f.stage(path);
  const copy = f.copy.getMockImplementation();
  f.copy.mockImplementationOnce(async (...args) => {
    await copy(...args);
    await text.sendText(request);
  });
  await f.send(path, { peerUid: 'bob' });
  const latest = f.docs.get(thread);
  expect(latest).toMatchObject({ memberIds: ['alice', 'bob'], lastMessage: { id: messageId } });
  expect(await text.sendText(request)).toEqual({
    conversationId,
    messageId: request.data.messageId,
  });
  expect(f.docs.get(thread)).toEqual(latest);
  expect([...f.docs.keys()].filter((key) => key.includes('/messages/'))).toHaveLength(2);
  expect(
    [...f.docs.keys()].filter(
      (key) => key.startsWith('conversations/') && !key.includes('/messages/'),
    ),
  ).toHaveLength(1);
});

test('an orphan photo cannot be used to prepare another upload, read or recover a missing conversation', async () => {
  const conversationId = 'dm_pu_alice_bob';
  const thread = 'conversations/' + conversationId;
  const f = fixture({ conversationId, createThread: false });
  const { path, mediaId } = await f.upload({ peerUid: 'bob' });
  f.docs.set(`${thread}/messages/${messageId}`, {
    senderId: 'alice',
    type: 'image',
    attachmentPath: path.replace('photo.', 'sent.'),
  });
  await expect(f.upload({ peerUid: 'bob' })).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(f.send(path, { peerUid: 'bob' })).rejects.toMatchObject({
    code: 'permission-denied',
  });
  await expect(f.read(mediaId, 'bob', { peerUid: 'alice' })).rejects.toMatchObject({
    code: 'permission-denied',
  });
  expect(f.docs.has(thread)).toBe(false);
  expect(f.copy).not.toHaveBeenCalled();
  expect(f.sign).not.toHaveBeenCalled();
});

test('the Google SDK signs the exact stage key, file type, size, uploader and request ID', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const app = initializeApp(
    {
      credential: cert({
        projectId: 'demo-photo',
        clientEmail: 'local@demo-photo.iam.gserviceaccount.com',
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      }),
    },
    'photo-policy-test',
  );
  const storage = getStorage(app);
  const f = fixture();
  const photos = createDmPhotos({ db: f.db, getBucket: () => storage.bucket('demo-photo') });
  const grant = await photos.delivery({
    auth: { uid: 'alice' },
    data: {
      ...session,
      action: 'uploadPhoto',
      contentType: 'image/png',
      size: 128,
      fileName: 'photo.png',
    },
  });
  const { policy } = grant.fields;
  expect(
    verify(
      'RSA-SHA256',
      Buffer.from(policy),
      publicKey,
      Buffer.from(grant.fields['x-goog-signature'], 'hex'),
    ),
  ).toBe(true);
  const parsed = JSON.parse(Buffer.from(policy, 'base64').toString());
  expect(parsed.conditions).toEqual(
    expect.arrayContaining([
      ['content-length-range', 128, 128],
      { key: grant.path },
      { 'Content-Type': 'image/png' },
      { 'x-goog-meta-uploader': 'alice' },
      { 'x-goog-meta-messageid': messageId },
    ]),
  );
  expect(Date.parse(parsed.expiration) - Date.now()).toBeLessThanOrEqual(60_000);
  f.docs.set('conversations/thread/messages/' + messageId, {
    senderId: 'alice',
    type: 'image',
    attachmentPath: grant.path.replace('photo.png', 'sent.png'),
    attachmentGeneration: '987654321',
  });
  const read = await photos.delivery({
    auth: { uid: 'bob' },
    data: {
      ...session,
      viewerUid: 'bob',
      action: 'read',
      folder: 'photos',
      fileName: 'sent.png',
      mediaId: grant.mediaId,
    },
  });
  const signed = new URL(read.url);
  expect(signed.searchParams.get('generation')).toBe('987654321');
  expect(Number(signed.searchParams.get('X-Goog-Expires'))).toBeLessThanOrEqual(60);
  expect(signed.searchParams.get('X-Goog-Signature')).toMatch(/^[a-f0-9]+$/i);
  expect(signed.searchParams.has('token')).toBe(false);
  await deleteApp(app);
});
