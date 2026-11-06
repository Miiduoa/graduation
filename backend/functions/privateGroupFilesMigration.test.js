'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { Storage: CloudStorage } = require('@google-cloud/storage');
const { revokePrivateGroupFileTokens } = require('./privateGroupFilesMigration');
const { parseCli, getAdminBucket, runCli, main } = require('../../scripts/revoke-private-group-file-tokens.cjs');

jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn((options, name) => ({ options, name })),
  getApps: jest.fn(() => []),
  applicationDefault: jest.fn(() => ({ kind: 'test-application-default' })),
}));
jest.mock('firebase-admin/storage', () => ({ getStorage: jest.fn() }));

const TOKEN_KEY = 'firebaseStorageDownloadTokens';
const TOKEN = 'inert-private-token-do-not-print';
const COVER = 'groups/course/cover.jpg';
const POST = 'groups/course/posts/post/notes.pdf';
const ANSWER = 'assignments/work/submissions/alice/answer.pdf';
const TARGET = ['--project', 'demo-private-files', '--bucket', 'demo-private-files.appspot.com'];

function metadata(extra = {}) {
  return {
    generation: '9007199254740993', metageneration: '7', contentType: 'application/pdf',
    cacheControl: 'private, no-store', metadata: { [TOKEN_KEY]: TOKEN, author: 'alice' },
    ...extra,
  };
}

function fixture(entries = [[COVER, metadata()]]) {
  const objects = new Map(entries.map(([name, value]) => [name, structuredClone(value)]));
  const files = new Map();
  const bucket = {
    getFiles: jest.fn(async ({ prefix, maxResults, pageToken }) => {
      const names = [...objects.keys()].filter((name) => name.startsWith(prefix)).sort();
      const start = Number(pageToken || 0);
      const page = names.slice(start, start + maxResults).map((name) => ({
        name, metadata: { generation: '1', metageneration: '1', metadata: { [TOKEN_KEY]: 'stale' } },
      }));
      return [page, start + maxResults < names.length ? { pageToken: String(start + maxResults) } : null];
    }),
    file: jest.fn((name) => {
      if (!files.has(name)) {
        files.set(name, {
          getMetadata: jest.fn(async () => [structuredClone(objects.get(name))]),
          setMetadata: jest.fn(async (patch, conditions) => {
            const current = objects.get(name);
            if (conditions.ifGenerationMatch !== String(current.generation)
              || conditions.ifMetagenerationMatch !== String(current.metageneration)) {
              throw Object.assign(new Error('CAS conflict'), { code: 412 });
            }
            const updated = structuredClone(current);
            for (const [key, value] of Object.entries(patch.metadata)) {
              if (value === null) delete updated.metadata[key];
              else updated.metadata[key] = value;
            }
            updated.metageneration = String(BigInt(current.metageneration) + 1n);
            objects.set(name, updated);
            return [structuredClone(updated)];
          }),
        });
      }
      return files.get(name);
    }),
  };
  return { bucket, objects, files };
}

beforeEach(() => {
  jest.clearAllMocks();
  require('firebase-admin/app').getApps.mockReturnValue([]);
});

test('defaults to dry-run and paginates only the three private namespaces', async () => {
  const { bucket, files } = fixture([
    [COVER, metadata()], [POST, metadata()], [ANSWER, metadata()],
    ['groups/course/posts/post/file/extra', metadata()],
    ['assignments/work/public/file.pdf', metadata()],
    ['users/alice/avatar.jpg', metadata()],
  ]);
  const summary = await revokePrivateGroupFileTokens({ bucket, pageSize: 1 });
  expect(summary).toEqual({
    dryRun: true, listed: 5, matched: 3, candidates: 3,
    revoked: 0, conflicts: 0, failures: 0,
  });
  expect([...files.keys()].sort()).toEqual([COVER, POST, ANSWER].sort());
  expect(bucket.getFiles).toHaveBeenCalledTimes(5);
  for (const [query] of bucket.getFiles.mock.calls) {
    expect(['groups/', 'assignments/']).toContain(query.prefix);
    expect(query).toMatchObject({ autoPaginate: false, maxResults: 1 });
  }
  for (const file of files.values()) {
    expect(file.getMetadata).toHaveBeenCalledTimes(1);
    expect(file.setMetadata).not.toHaveBeenCalled();
  }
  expect(JSON.stringify(summary)).not.toContain(TOKEN);
});

test('apply removes only token metadata using the freshly read exact generation pair', async () => {
  const { bucket, objects, files } = fixture([[COVER, metadata()], [POST, metadata()], [ANSWER, metadata()]]);
  const summary = await revokePrivateGroupFileTokens({ bucket, apply: true });
  expect(summary).toMatchObject({ dryRun: false, candidates: 3, revoked: 3, conflicts: 0, failures: 0 });
  for (const [name, file] of files) {
    expect(bucket.file).toHaveBeenCalledWith(name);
    expect(file.setMetadata).toHaveBeenCalledWith(
      { metadata: { [TOKEN_KEY]: null, author: 'alice' } },
      { ifGenerationMatch: '9007199254740993', ifMetagenerationMatch: '7' },
    );
    expect(objects.get(name)).toEqual(metadata({
      metadata: { author: 'alice' }, metageneration: '8',
    }));
    expect(file.getMetadata).toHaveBeenCalledTimes(2);
  }
  const second = await revokePrivateGroupFileTokens({ bucket, apply: true });
  expect(second).toMatchObject({ candidates: 0, revoked: 0, failures: 0 });
  for (const file of files.values()) expect(file.setMetadata).toHaveBeenCalledTimes(1);
});

test('uses current metadata when the listing still advertises a removed token', async () => {
  const { bucket, files } = fixture([[COVER, metadata({ metadata: { author: 'alice' } })]]);
  expect(await revokePrivateGroupFileTokens({ bucket, apply: true })).toMatchObject({ candidates: 0, revoked: 0 });
  expect(files.get(COVER).getMetadata).toHaveBeenCalledTimes(1);
  expect(files.get(COVER).setMetadata).not.toHaveBeenCalled();
});

test('CLI fails when a successful PATCH leaves the token in current metadata', async () => {
  const { bucket } = fixture();
  const file = bucket.file(COVER);
  file.setMetadata.mockResolvedValue([metadata({ metadata: { author: 'alice' } })]);
  const stdout = { write: jest.fn() }, stderr = { write: jest.fn() };
  expect(await main([...TARGET, '--apply'], { getBucket: () => bucket, stdout, stderr })).toBe(1);
  const output = stdout.write.mock.calls.map(([line]) => line).join('');
  expect(JSON.parse(output)).toMatchObject({ candidates: 1, revoked: 0, failures: 1 });
  expect(output).not.toContain(TOKEN);
  expect(file.getMetadata).toHaveBeenCalledTimes(2);
  expect(file.setMetadata).toHaveBeenCalledTimes(1);
});

test('requires a successful fresh read of the same token-free object after PATCH', async () => {
  for (const current of [
    new Error(`verification failed token=${TOKEN}`),
    metadata({ generation: '9007199254740994', metadata: { author: 'alice' } }),
    metadata({ metadata: [] }),
    metadata({ metadata: { [TOKEN_KEY]: null } }),
  ]) {
    const { bucket } = fixture();
    const file = bucket.file(COVER);
    file.getMetadata.mockReset().mockResolvedValueOnce([metadata()]);
    if (current instanceof Error) file.getMetadata.mockRejectedValueOnce(current);
    else file.getMetadata.mockResolvedValueOnce([current]);
    const summary = await revokePrivateGroupFileTokens({ bucket, apply: true });
    expect(summary).toMatchObject({ candidates: 1, revoked: 0, failures: 1 });
    expect(file.setMetadata).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
  }
});

test.each(['generation', 'metageneration'])('requires valid %s before dry-run or apply', async (field) => {
  for (const value of [undefined, null, '', '0', '-1', '1.5', 'NaN', false, 0, Number.MAX_SAFE_INTEGER + 1]) {
    for (const apply of [false, true]) {
      const { bucket, files } = fixture([[COVER, metadata({ [field]: value })]]);
      expect(await revokePrivateGroupFileTokens({ bucket, apply })).toMatchObject({
        candidates: 1, revoked: 0, failures: 1,
      });
      expect(files.get(COVER).setMetadata).not.toHaveBeenCalled();
    }
  }
});

test('passes numeric safe generations as precise decimal preconditions', async () => {
  const { bucket, files } = fixture([[COVER, metadata({ generation: 12, metageneration: 3 })]]);
  expect(await revokePrivateGroupFileTokens({ bucket, apply: true })).toMatchObject({ revoked: 1 });
  expect(files.get(COVER).setMetadata.mock.calls[0][1]).toEqual({ ifGenerationMatch: '12', ifMetagenerationMatch: '3' });
});

test('rejects malformed metadata instead of treating it as a clean object', async () => {
  for (const value of [null, [], 'invalid', metadata({ metadata: [] }), metadata({ metadata: 'invalid' })]) {
    const { bucket, files } = fixture([[COVER, value]]);
    expect(await revokePrivateGroupFileTokens({ bucket, apply: true })).toMatchObject({ revoked: 0, failures: 1 });
    expect(files.get(COVER).setMetadata).not.toHaveBeenCalled();
  }
});

test('reports CAS conflicts and metadata failures without retrying a mutation', async () => {
  const { bucket } = fixture([[COVER, metadata()], [POST, metadata()], [ANSWER, metadata()]]);
  const conflicting = bucket.file(COVER);
  const missing = bucket.file(POST);
  conflicting.setMetadata.mockRejectedValue(Object.assign(new Error(`token=${TOKEN}`), { code: 412 }));
  missing.getMetadata.mockRejectedValue(Object.assign(new Error(`token=${TOKEN}`), { code: 404 }));
  const summary = await revokePrivateGroupFileTokens({ bucket, apply: true });
  expect(summary).toMatchObject({ candidates: 2, revoked: 1, conflicts: 1, failures: 1 });
  expect(conflicting.setMetadata).toHaveBeenCalledTimes(1);
  expect(missing.setMetadata).not.toHaveBeenCalled();
  expect(JSON.stringify(summary)).not.toContain(TOKEN);
});

test('listing errors and repeated pagination cursors remain visible and never widen prefixes', async () => {
  const { bucket } = fixture();
  bucket.getFiles.mockRejectedValueOnce(new Error(`token=${TOKEN}`));
  expect(await revokePrivateGroupFileTokens({ bucket })).toMatchObject({ failures: 1 });
  bucket.getFiles.mockClear().mockResolvedValue([[], { pageToken: 'repeated', prefix: 'public/' }]);
  expect(await revokePrivateGroupFileTokens({ bucket })).toMatchObject({ failures: 2 });
  expect(bucket.getFiles).toHaveBeenCalledTimes(4);
  for (const [query] of bucket.getFiles.mock.calls) expect(['groups/', 'assignments/']).toContain(query.prefix);
});

test('does not read even a valid private path returned outside its listed prefix', async () => {
  const { bucket } = fixture();
  bucket.getFiles.mockResolvedValueOnce([[{ name: ANSWER }], null]).mockResolvedValueOnce([[], null]);
  expect(await revokePrivateGroupFileTokens({ bucket, apply: true })).toMatchObject({ matched: 0, revoked: 0 });
  expect(bucket.file).not.toHaveBeenCalled();
});

test('actual GCS SDK serializes both preconditions as PATCH query parameters', async () => {
  const storage = new CloudStorage({ projectId: 'demo-private-files', apiEndpoint: 'http://127.0.0.1:1' });
  storage.request = jest.fn((options, callback) => callback(null, { metadata: { author: 'alice' } }));
  const realFile = storage.bucket('demo-private-files.appspot.com').file(COVER);
  realFile.getMetadata = jest.fn()
    .mockResolvedValueOnce([metadata()])
    .mockResolvedValueOnce([metadata({ metadata: { author: 'alice' }, metageneration: '8' })]);
  const { bucket } = fixture();
  bucket.file.mockReturnValue(realFile);
  expect(await revokePrivateGroupFileTokens({ bucket, apply: true })).toMatchObject({ revoked: 1, failures: 0 });
  const request = storage.request.mock.calls[0][0];
  expect(request).toMatchObject({
    method: 'PATCH',
    qs: { ifGenerationMatch: '9007199254740993', ifMetagenerationMatch: '7' },
    json: { metadata: { author: 'alice', [TOKEN_KEY]: null } },
  });
  expect(request.qs).not.toHaveProperty('preconditionOpts');
});

test('requires explicit CLI targets and defaults to dry-run', async () => {
  expect(parseCli(TARGET)).toEqual({ projectId: 'demo-private-files', bucketName: 'demo-private-files.appspot.com', apply: false });
  expect(parseCli([...TARGET, '--apply'])).toMatchObject({ apply: true });
  for (const args of [[], ['--project', 'demo-private-files'], [...TARGET, '--apply=false'], [...TARGET, 'unexpected']]) {
    expect(() => parseCli(args)).toThrow();
  }
  const { bucket, files } = fixture();
  expect(await runCli(TARGET, { getBucket: async () => bucket })).toMatchObject({ dryRun: true, candidates: 1, revoked: 0 });
  expect(files.get(COVER).setMetadata).not.toHaveBeenCalled();
});

test('initializes an explicitly bound named Admin app and rejects reuse with another target', () => {
  const admin = require('firebase-admin/app');
  const storage = require('firebase-admin/storage');
  const bucket = {};
  const getBucket = jest.fn(() => bucket);
  storage.getStorage.mockReturnValue({ bucket: getBucket });
  admin.getApps.mockReturnValue([{ name: '[DEFAULT]', options: { projectId: 'another-project' } }]);
  expect(getAdminBucket(parseCli(TARGET))).toBe(bucket);
  expect(admin.initializeApp).toHaveBeenCalledWith({
    projectId: 'demo-private-files', storageBucket: 'demo-private-files.appspot.com',
    credential: { kind: 'test-application-default' },
  }, 'private-group-file-token-migration');
  expect(getBucket).toHaveBeenCalledWith('demo-private-files.appspot.com');
  const app = admin.initializeApp.mock.results[0].value;
  admin.getApps.mockReturnValue([app]);
  expect(getAdminBucket(parseCli(TARGET))).toBe(bucket);
  expect(admin.initializeApp).toHaveBeenCalledTimes(1);
  expect(() => getAdminBucket({ projectId: 'other-project', bucketName: 'other-bucket' })).toThrow('different target');
  expect(admin.initializeApp).toHaveBeenCalledTimes(1);
});

test('real CLI Admin initialization resolves functions dependencies without sending a request', () => {
  const script = `
    const assert = require('node:assert/strict');
    const { createRequire } = require('node:module');
    let networkRequests = 0;
    for (const name of ['node:http', 'node:https']) {
      const transport = require(name);
      transport.request = transport.get = () => {
        networkRequests += 1;
        throw new Error('Unexpected network access');
      };
    }
    const { getAdminBucket } = require('./scripts/revoke-private-group-file-tokens.cjs');
    const bucket = getAdminBucket({ projectId: 'demo-private-files', bucketName: 'demo-private-files.appspot.com' });
    assert.equal(bucket.name, 'demo-private-files.appspot.com');
    const requireFunctions = createRequire(require.resolve('./backend/functions/package.json'));
    const { getApp, deleteApp } = requireFunctions('firebase-admin/app');
    const app = getApp('private-group-file-token-migration');
    assert.equal(app.options.projectId, 'demo-private-files');
    assert.equal(app.options.storageBucket, bucket.name);
    assert.equal(networkRequests, 0);
    deleteApp(app).catch(() => { process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.stdout).toBe('');
  expect(result.status).toBe(0);
});

test.each([412, 500])('CLI returns nonzero for Storage failure %s without printing token values', async (code) => {
  const { bucket } = fixture();
  bucket.file(COVER).setMetadata.mockRejectedValue(Object.assign(new Error(`token=${TOKEN}`), { code }));
  const stdout = { write: jest.fn() }, stderr = { write: jest.fn() };
  expect(await main([...TARGET, '--apply'], { getBucket: () => bucket, stdout, stderr })).toBe(1);
  const output = stdout.write.mock.calls.map(([line]) => line).join('');
  expect(output).not.toContain(TOKEN);
  expect(JSON.parse(output)).toMatchObject(code === 412 ? { conflicts: 1 } : { failures: 1 });
  expect(stderr.write).not.toHaveBeenCalled();
});

test('CLI hides fatal Admin errors and prints help without creating a client', async () => {
  const stdout = { write: jest.fn() }, stderr = { write: jest.fn() };
  const getBucket = jest.fn(() => { throw new Error(`credential URL token=${TOKEN}`); });
  expect(await main(TARGET, { getBucket, stdout, stderr })).toBe(1);
  expect(stderr.write.mock.calls.flat().join('')).not.toContain(TOKEN);
  getBucket.mockClear();
  expect(await main(['--help'], { getBucket, stdout, stderr })).toBe(0);
  expect(getBucket).not.toHaveBeenCalled();
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/revoke-private-group-file-tokens.cjs')],
    { encoding: 'utf8', timeout: 10_000 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('--project');
});
