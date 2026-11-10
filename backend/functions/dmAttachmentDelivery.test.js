const { createDmAttachmentDelivery, uploadLimit, attachmentPath, MINUTE_MS } = require('./dmAttachmentDelivery');

function fixture() {
  const docs = new Map([
    ['conversations/private', { type: 'dm', schoolId: 'pu', memberIds: ['alice', 'bob'] }],
    ['users/alice', { schoolId: 'pu' }],
    ['users/bob', { schoolId: 'pu' }],
    ['schools/pu/members/alice', { status: 'active' }],
    ['schools/pu/members/bob', { status: 'active' }],
  ]);
  const reads = [];
  const db = {
    collection: (name) => ({
      doc: (id) => {
        const path = `${name}/${id}`;
        return {
          get: async () => {
            reads.push(path);
            return { exists: docs.has(path), data: () => docs.get(path) };
          },
          collection: (sub) => ({
            doc: (subId) => ({
              get: async () => {
                const nested = `${path}/${sub}/${subId}`;
                reads.push(nested);
                return { exists: docs.has(nested), data: () => docs.get(nested) };
              },
            }),
          }),
        };
      },
    }),
  };
  let stored = {
    size: '512', contentType: 'application/pdf', generation: '10', metageneration: '3',
    metadata: { firebaseStorageDownloadTokens: 'OLD_SECRET', preserved: 'yes' },
  };
  const file = {
    getMetadata: jest.fn(async () => [stored]),
    setMetadata: jest.fn(async (patch, options) => {
      if (Number(options?.ifMetagenerationMatch) !== Number(stored.metageneration)) {
        throw Object.assign(new Error('stale metadata'), { code: 412 });
      }
      const metadata = { ...stored.metadata };
      if (patch.metadata?.firebaseStorageDownloadTokens === null) {
        delete metadata.firebaseStorageDownloadTokens;
      }
      stored = { ...stored, metageneration: String(Number(stored.metageneration) + 1), metadata };
      return [stored];
    }),
    getSignedUrl: jest.fn(async () => ['https://storage.test/signed?X-Goog-Expires=60']),
    generateSignedPostPolicyV4: jest.fn(async () => [{ url: 'https://storage.test/post', fields: { key: 'signed-key' } }]),
  };
  const bucket = { file: jest.fn(() => file) };
  const send = createDmAttachmentDelivery({ db, getBucket: () => bucket, now: () => 1234567000000, newId: () => 'generated-on-server' });
  const call = (data, uid = 'alice') => send({ auth: { uid }, data: { action: 'read', conversationId: 'private', folder: 'media', mediaId: 'one', fileName: 'file.pdf', ...data } });
  return { docs, reads, file, bucket, call };
}

test('server authorization checks conversation, current school profile, and active membership on each read', async () => {
  const { call, reads, file, bucket } = fixture();
  const result = await call();
  expect(result).toEqual({ url: expect.stringContaining('X-Goog-Expires'), expiresAt: new Date(1234567000000 + MINUTE_MS).toISOString() });
  expect(reads).toEqual([
    'conversations/private',
    'users/alice', 'schools/pu/members/alice',
    'users/bob', 'schools/pu/members/bob',
  ]);
  expect(bucket.file).toHaveBeenCalledWith('conversations/private/media/one/file.pdf');
  expect(file.setMetadata).not.toHaveBeenCalled();
  expect(file.getMetadata).toHaveBeenCalledTimes(1);
  expect((await file.getMetadata())[0].metadata).toEqual({
    firebaseStorageDownloadTokens: 'OLD_SECRET', preserved: 'yes',
  });
  expect(file.getSignedUrl).toHaveBeenCalledWith({
    version: 'v4', action: 'read', expires: 1234567000000 + MINUTE_MS,
  });
  expect(JSON.stringify(result)).not.toContain('OLD_SECRET');
});

test.each([
  ['transferred despite active old-school membership', 'users/alice', { schoolId: 'other' }],
  ['deleted profile', 'users/alice', { schoolId: 'pu', status: 'deleted' }],
  ['disabled profile', 'users/alice', { schoolId: 'pu', status: 'disabled' }],
  ['suspended profile', 'users/alice', { schoolId: 'pu', status: 'suspended' }],
  ['inactive profile', 'users/alice', { schoolId: 'pu', status: 'inactive' }],
  ['peer deleted profile', 'users/bob', { schoolId: 'pu', status: 'deleted' }],
  ['peer disabled profile', 'users/bob', { schoolId: 'pu', status: 'disabled' }],
  ['peer suspended profile', 'users/bob', { schoolId: 'pu', status: 'suspended' }],
  ['peer inactive profile', 'users/bob', { schoolId: 'pu', status: 'inactive' }],
  ['peer account deletion', 'users/bob', { schoolId: 'pu', accountDeletionInProgress: true }],
  ['account deletion', 'users/alice', { schoolId: 'pu', accountDeletionInProgress: true }],
  ['inactive membership', 'schools/pu/members/alice', { status: 'inactive' }],
  ['missing membership', 'schools/pu/members/alice', null],
  ['removed from conversation', 'conversations/private', { type: 'dm', schoolId: 'pu', memberIds: ['bob', 'carol'] }],
  ['conversation moved school', 'conversations/private', { type: 'dm', schoolId: 'other', memberIds: ['alice', 'bob'] }],
  ['wrong conversation type', 'conversations/private', { type: 'group', schoolId: 'pu', memberIds: ['alice', 'bob'] }],
  ['duplicate members', 'conversations/private', { type: 'dm', schoolId: 'pu', memberIds: ['alice', 'alice'] }],
])('refuses %s before generating a capability', async (_name, key, value) => {
  const { call, docs, file } = fixture();
  if (value == null) docs.delete(key);
  else docs.set(key, value);
  await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
  expect(file.getSignedUrl).not.toHaveBeenCalled();
  expect(file.generateSignedPostPolicyV4).not.toHaveBeenCalled();
});

test('conversation outsider cannot read, even if a separate active school member', async () => {
  const { call, docs, file } = fixture();
  docs.set('users/carol', { schoolId: 'pu' });
  docs.set('schools/pu/members/carol', { status: 'active' });
  await expect(call({}, 'carol')).rejects.toMatchObject({ code: 'permission-denied' });
  expect(file.getSignedUrl).not.toHaveBeenCalled();
});

test('legitimate second member can request a new signed link', async () => {
  const { call, file } = fixture();
  await expect(call({}, 'bob')).resolves.toMatchObject({ url: expect.stringContaining('signed') });
  expect(file.getSignedUrl).toHaveBeenCalledTimes(1);
});

test.each([
  [{ conversationId: '../pu' }],
  [{ mediaId: '../x' }],
  [{ fileName: 'folder/path' }],
  [{ folder: 'temp' }],
  [{ fileName: '..' }],
])('rejects path injection before signing', async (changes) => {
  const { call, file } = fixture();
  await expect(call(changes)).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(file.getSignedUrl).not.toHaveBeenCalled();
});

test('previous message attachment path remains addressable without exposing a Firebase token', async () => {
  const { call, bucket } = fixture();
  await call({ folder: 'messages', mediaId: 'old-message' });
  expect(bucket.file).toHaveBeenCalledWith('conversations/private/messages/old-message/file.pdf');
});

test('missing or malformed stored files never receive a link', async () => {
  const { call, file } = fixture();
  file.getMetadata.mockRejectedValueOnce({ code: 404 });
  await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
  file.getMetadata.mockResolvedValueOnce([{ size: '0', contentType: 'application/pdf' }]);
  await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
  file.getMetadata.mockResolvedValueOnce([{ size: '3', contentType: 'application/x-msdownload' }]);
  await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
  expect(file.getSignedUrl).not.toHaveBeenCalled();
});

test('upload grants server-generated object name and enforces a storage-side policy', async () => {
  const { call, file, bucket } = fixture();
  const response = await call({
    action: 'upload', contentType: 'image/png', size: 1024,
    // Clients may supply an old ID, but may not select an upload destination.
    mediaId: 'another-file', folder: 'messages',
  });
  expect(response).toMatchObject({
    method: 'POST', url: 'https://storage.test/post',
    path: 'conversations/private/media/generated-on-server/file.pdf',
    mediaId: 'generated-on-server',
  });
  expect(bucket.file).toHaveBeenCalledWith(response.path);
  expect(file.generateSignedPostPolicyV4).toHaveBeenCalledWith({
    expires: 1234567000000 + MINUTE_MS,
    fields: { 'Content-Type': 'image/png', 'x-goog-meta-uploader': 'alice' },
    conditions: [
      ['content-length-range', 1, 10 * 1024 * 1024 - 1],
      ['eq', '$Content-Type', 'image/png'],
      ['eq', '$x-goog-meta-uploader', 'alice'],
    ],
  });
});

test.each([
  ['unrecognized MIME', 'application/x-msdownload', 100],
  ['empty upload', 'image/png', 0],
  ['too large image', 'image/png', 10 * 1024 * 1024],
  ['invalid size', 'image/png', 1.2],
  ['oversized PDF', 'application/pdf', 50 * 1024 * 1024],
])('upload refuses %s without a policy', async (_name, contentType, size) => {
  const { call, file } = fixture();
  await expect(call({ action: 'upload', contentType, size })).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(file.generateSignedPostPolicyV4).not.toHaveBeenCalled();
});

test('upload is refused after transfer, even before creating any policy', async () => {
  const { call, docs, file } = fixture();
  docs.set('users/alice', { schoolId: 'other' });
  await expect(call({ action: 'upload', contentType: 'application/pdf', size: 300 }))
    .rejects.toMatchObject({ code: 'permission-denied' });
  expect(file.generateSignedPostPolicyV4).not.toHaveBeenCalled();
});


test('token-free legacy member can still read without modifying object metadata', async () => {
  const { call, file } = fixture();
  file.getMetadata.mockResolvedValueOnce([{
    generation: '10', size: '512', contentType: 'application/pdf', metadata: { preserved: 'yes' },
  }]);
  await expect(call({}, 'bob')).resolves.toHaveProperty('url');
  expect(file.setMetadata).not.toHaveBeenCalled();
  expect(file.getSignedUrl).toHaveBeenCalledTimes(1);
});

test.each(['messages', 'media'])('legacy token remains intact on %s reads without metageneration', async (folder) => {
  const { call, file } = fixture();
  const metadata = {
    size: '512', contentType: 'application/pdf',
    metadata: { firebaseStorageDownloadTokens: 'OLD_SECRET', preserved: 'yes' },
  };
  file.getMetadata.mockResolvedValue([metadata]);
  file.setMetadata.mockRejectedValue(new Error('read must never write metadata'));
  await expect(call({ folder })).resolves.toHaveProperty('url');
  expect(file.setMetadata).not.toHaveBeenCalled();
  expect(file.getMetadata).toHaveBeenCalledTimes(1);
  expect(metadata.metadata).toEqual({ firebaseStorageDownloadTokens: 'OLD_SECRET', preserved: 'yes' });
  expect(file.getSignedUrl).toHaveBeenCalledWith({ version: 'v4', action: 'read', expires: 1234567000000 + MINUTE_MS });
});

test('limits and paths match the existing legacy media storage model', () => {
  expect(uploadLimit('application/pdf')).toBe(50 * 1024 * 1024 - 1);
  expect(uploadLimit('audio/mpeg')).toBe(20 * 1024 * 1024 - 1);
  expect(uploadLimit('video/mp4')).toBe(100 * 1024 * 1024 - 1);
  expect(uploadLimit('image/png')).toBe(10 * 1024 * 1024 - 1);
  expect(uploadLimit('application/octet-stream')).toBe(0);
  expect(attachmentPath('private', 'media', 'a', 'photo.jpg')).toBe('conversations/private/media/a/photo.jpg');
});
