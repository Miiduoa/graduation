const {
  isDmAttachmentPath, migrateDmToken, scanDmTokens,
} = require('./dmAttachmentTokenMigration');
const { args } = require('./scripts/revokeDmAttachmentTokens.cjs');

function fileWithToken(name = 'conversations/pu_alice_bob/messages/one/photo.png') {
  let stored = {
    generation: '42', metageneration: '7', contentType: 'image/png',
    metadata: { firebaseStorageDownloadTokens: 'NEVER_LOG_THIS', important: 'keep' },
  };
  const file = {
    name,
    getMetadata: jest.fn(async () => [stored]),
    setMetadata: jest.fn(async (patch, opts) => {
      if (opts?.ifMetagenerationMatch !== Number(stored.metageneration)) throw { code: 412 };
      if (patch?.metadata?.firebaseStorageDownloadTokens !== null) throw Error('wrong patch');
      stored = {
        ...stored, metageneration: String(Number(stored.metageneration) + 1),
        metadata: { important: 'keep' },
      };
      return [stored];
    }),
  };
  return { file, current: () => stored };
}

test('only legacy DM attachments are in migration scope', () => {
  expect(isDmAttachmentPath('conversations/dm/media/object/file.png')).toBe(true);
  expect(isDmAttachmentPath('conversations/dm/messages/object/file.pdf')).toBe(true);
  for (const path of [
    'schools/pu/stories/a/photo', 'conversations/dm/image.png',
    'conversations/dm/media/../name', 'conversations/dm/media/id/../../x',
    'conversations/dm/avatars/id/photo.jpg', 'conversations//media/id/a',
  ]) expect(isDmAttachmentPath(path)).toBe(false);
});

test('dry-run finds legacy token but never changes the object or prints secret/path', async () => {
  const { file } = fileWithToken();
  const item = await migrateDmToken(file);
  expect(item.status).toBe('would-revoke');
  expect(item.id).toMatch(/^[a-f0-9]{16}$/);
  expect(JSON.stringify(item)).not.toContain('NEVER_LOG_THIS');
  expect(JSON.stringify(item)).not.toContain('conversations/');
  expect(file.setMetadata).not.toHaveBeenCalled();
});

test('verified GCS migration preserves other metadata and generation', async () => {
  const { file, current } = fileWithToken();
  const outcome = await migrateDmToken(file, { execute: true });
  expect(outcome.status).toBe('revoked');
  expect(file.setMetadata).toHaveBeenCalledWith(
    { metadata: { firebaseStorageDownloadTokens: null } },
    { ifMetagenerationMatch: 7 },
  );
  expect(current().metadata).toEqual({ important: 'keep' });
  expect(current().generation).toBe('42');
  expect(file.getMetadata).toHaveBeenCalledTimes(2);
});

test('token-free file remains accessible without writes, even in execute mode', async () => {
  const { file } = fileWithToken();
  file.getMetadata.mockResolvedValueOnce([{ generation: '42', metadata: { important: 'keep' } }]);
  await expect(migrateDmToken(file, { execute: true })).resolves.toMatchObject({ status: 'clean' });
  expect(file.setMetadata).not.toHaveBeenCalled();
});

test('precondition conflicts and lying metadata responses fail closed', async () => {
  const { file } = fileWithToken();
  file.setMetadata.mockRejectedValueOnce({ code: 412 });
  await expect(migrateDmToken(file, { execute: true })).rejects.toMatchObject({ code: 412 });
  file.setMetadata.mockResolvedValueOnce([{}]);
  await expect(migrateDmToken(file, { execute: true })).rejects.toThrow('not verified');
});

test('missing GCS generation/metageneration never triggers an unsafe write', async () => {
  const { file } = fileWithToken();
  file.getMetadata.mockResolvedValueOnce([{ metadata: { firebaseStorageDownloadTokens: 'secret' } }]);
  await expect(migrateDmToken(file, { execute: true })).rejects.toThrow('generation');
  expect(file.setMetadata).not.toHaveBeenCalled();
});

test('scan is bounded, paginated and does not mutate without execution confirmation', async () => {
  const one = fileWithToken('conversations/dm/media/one/file.png').file;
  const two = fileWithToken('conversations/dm/messages/two/file.pdf').file;
  const other = fileWithToken('schools/pu/stories/a/photo.png').file;
  const bucket = {
    getFiles: jest.fn(async (q) => q.pageToken
      ? [[two], null]
      : [[one, other], { pageToken: 'page-two' }]),
  };
  const items = [];
  const result = await scanDmTokens(bucket, { maxObjects: 3, onItem: (item) => items.push(item) });
  expect(result).toEqual({ scanned: 3, skipped: 1, clean: 0, wouldRevoke: 2, revoked: 0, truncated: false, nextPageToken: null });
  expect(items).toHaveLength(3);
  expect(bucket.getFiles).toHaveBeenCalledTimes(2);
  expect(one.setMetadata).not.toHaveBeenCalled();
  expect(two.setMetadata).not.toHaveBeenCalled();
  expect(other.getMetadata).not.toHaveBeenCalled();
});

test('bounded scan returns a continuation cursor instead of silently skipping later objects', async () => {
  const one = fileWithToken('conversations/dm/media/one/file.png').file;
  const two = fileWithToken('conversations/dm/media/two/file.png').file;
  const bucket = {
    getFiles: jest.fn(async (q) => q.pageToken
      ? [[two], null]
      : [[one], { pageToken: 'next-page' }]),
  };
  const first = await scanDmTokens(bucket, { maxObjects: 1 });
  expect(first).toMatchObject({ scanned: 1, truncated: true, nextPageToken: 'next-page' });
  const second = await scanDmTokens(bucket, { maxObjects: 1, pageToken: first.nextPageToken });
  expect(second).toMatchObject({ scanned: 1, truncated: false, nextPageToken: null });
  expect(bucket.getFiles.mock.calls[1][0]).toMatchObject({
    prefix: 'conversations/', autoPaginate: false, pageToken: 'next-page',
  });
});

test('CLI defaults to dry-run and requires exact bucket confirmation to mutate', () => {
  expect(args(['--bucket', 'campus.appspot.com'])).toEqual({
    bucketName: 'campus.appspot.com', path: undefined, execute: false, maxObjects: 100, pageToken: undefined,
  });
  expect(() => args(['--bucket', 'campus.appspot.com', '--execute'])).toThrow('EXACT');
  expect(() => args(['--bucket', 'campus.appspot.com', '--execute', '--confirm-bucket', 'other.app'])).toThrow('EXACT');
  expect(() => args(['--bucket', 'campus.appspot.com', '--path', '../invalid'])).toThrow('Only');
  expect(() => args(['--bucket', 'campus.appspot.com', '--max-objects', '5000'])).toThrow('1 to 1000');
  expect(() => args(['--bucket', 'campus.appspot.com', '--page-token', 'x', '--path', 'conversations/dm/media/id/file'])).toThrow('cannot');
  expect(args(['--bucket', 'campus.appspot.com', '--page-token', 'page2']).pageToken).toBe('page2');
  expect(args(['--bucket', 'campus.appspot.com', '--execute', '--confirm-bucket', 'campus.appspot.com']).execute).toBe(true);
});
