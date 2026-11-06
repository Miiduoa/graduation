const { createDmPhotos } = require('./dmPhotos');
const { transactionStore } = require('./testSupport/transactionStore');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');
const { generateKeyPairSync, verify } = require('node:crypto');

const messageId = 'photo-message-for-test-01';
const session = { schoolId: 'pu', conversationId: 'thread', viewerUid: 'alice', messageId };
const png = Buffer.from('89504e470d0a1a0a0000000d', 'hex');

function fixture() {
  const store = transactionStore([
    ['conversations/thread', { type: 'dm', schoolId: 'pu', memberIds: ['bob', 'alice'] }],
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
    handler({ auth: { uid }, data: { ...session, viewerUid: uid, ...data } });
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
