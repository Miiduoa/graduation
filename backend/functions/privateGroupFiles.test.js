const { PassThrough, Readable, Writable } = require('node:stream');
const { finished } = require('node:stream/promises');
const { createGunzip, gzipSync } = require('node:zlib');
const { Storage: CloudStorage, CRC32C } = require('@google-cloud/storage');
const { createPrivateGroupFileHandler, parsePrivateGroupFilePath } = require('./privateGroupFiles');
const { transactionStore } = require('./testSupport/transactionStore');

const COVER = 'groups/course/cover.jpg';
const POST = 'groups/course/posts/one/notes.pdf';
const ANSWER = 'assignments/work/submissions/alice/answer.pdf';

describe('private group file HTTP handler', () => {
  let store, objects, bucket, verifyIdToken, handler, saves, reads, onFile;
  let generation;

  function put(path, bytes = 'original', metadata = {}) {
    const data = Buffer.from(bytes);
    objects.set(path, {
      data,
      metadata: { size: String(data.length), contentType: 'application/pdf', generation: String(++generation), ...metadata },
    });
  }

  function launch({ path = POST, uid = 'alice', method = 'GET', body = '', headers = {}, rawBody, end = true } = {}) {
    const req = new PassThrough();
    req.method = method;
    req.query = { path };
    req.headers = { 'content-type': 'application/pdf', ...(uid ? { authorization: `Bearer ${uid}` } : {}), ...headers };
    if (rawBody !== undefined) req.rawBody = rawBody;
    const chunks = [];
    const res = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    res.statusCode = 200;
    res.headers = {};
    res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; };
    const done = handler(req, res).then(async () => {
      await finished(res);
      return { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() };
    });
    if (end) req.end(body);
    return { req, res, done };
  }
  const invoke = (options) => launch(options).done;

  beforeEach(() => {
    store = transactionStore([
      ['groups/course', { schoolId: 'pu' }],
      ['groups/course/posts/one', { authorId: 'alice' }],
      ['assignments/work', { groupId: 'course' }],
      ...['alice', 'bob', 'teacher'].flatMap((uid) => [
        [`users/${uid}`, { displayName: uid }],
        [`groups/course/members/${uid}`, { status: 'active', role: uid === 'teacher' ? 'instructor' : 'member' }],
        [`schools/pu/members/${uid}`, { status: 'active' }],
      ]),
    ]);
    objects = new Map();
    generation = 0;
    saves = [];
    reads = [];
    onFile = null;
    for (const path of [COVER, POST, ANSWER]) put(path);
    bucket = {
      file: jest.fn((path, options = {}) => {
        if (onFile) onFile(path);
        return {
          async getMetadata() {
            if (!objects.has(path)) throw Object.assign(new Error('Missing object'), { code: 404 });
            return [{ ...objects.get(path).metadata }];
          },
          createReadStream() {
            const object = objects.get(path);
            if (options.generation !== object.metadata.generation) throw new Error('Read was not generation pinned');
            reads.push({ path, generation: options.generation });
            const source = Readable.from([object.data]);
            return object.metadata.contentEncoding === 'gzip' ? source.pipe(createGunzip()) : source;
          },
          async save(data, saveOptions) {
            saves.push({ path, options: saveOptions });
            const existing = objects.get(path);
            const expected = saveOptions.preconditionOpts.ifGenerationMatch;
            if ((expected === 0 && existing) || (expected !== 0 && expected !== existing?.metadata.generation)) {
              throw Object.assign(new Error('Precondition failed'), { code: 412 });
            }
            put(path, data, saveOptions.metadata);
          },
        };
      }),
    };
    verifyIdToken = jest.fn(async (token) => {
      if (token === 'expired') throw new Error('Token revoked');
      return { uid: token, role: 'admin', schoolId: 'other' };
    });
    handler = createPrivateGroupFileHandler({ db: store.db, bucket, verifyIdToken });
  });

  test.each([COVER, POST, ANSWER])('streams authorized bytes with private headers at %s', async (path) => {
    const result = await invoke({ path });
    expect(result).toMatchObject({ status: 200, body: 'original' });
    expect(result.headers).toMatchObject({ 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
    expect(result.headers['content-disposition']).toMatch(/^attachment;/);
    expect(reads).toHaveLength(1);
    expect(verifyIdToken).toHaveBeenCalledWith('alice', true);
    expect(result.body).not.toMatch(/token=|https:\/\//);
  });

  test.each([null, 'expired'])('rejects absent or revoked authentication %s before looking up files', async (uid) => {
    expect((await invoke({ uid })).status).toBe(401);
    expect(bucket.file).not.toHaveBeenCalled();
  });

  test.each(['inactive', 'left', undefined])('school status %s immediately revokes reads and uploads despite stale mirrors', async (status) => {
    store.docs.set('schools/pu/members/alice', { status });
    store.docs.set('schools/other/members/alice', { status: 'active' });
    store.docs.set('users/alice/groups/course', { status: 'active', schoolId: 'other', role: 'owner' });
    for (const path of [COVER, POST, ANSWER]) {
      expect((await invoke({ path })).status).toBe(403);
      expect((await invoke({ path, method: 'POST' })).status).toBe(403);
    }
    expect(bucket.file).not.toHaveBeenCalled();
  });

  test.each([
    'schools/pu/members/alice', 'groups/course/members/alice', 'groups/course', 'assignments/work',
  ])('missing canonical authorization document %s fails closed', async (path) => {
    store.docs.delete(path);
    expect((await invoke({ path: ANSWER })).status).toBe(403);
    expect(bucket.file).not.toHaveBeenCalled();
  });

  test('group revocation and invalid group school fail closed', async () => {
    store.docs.set('groups/course/members/alice', { role: 'owner', status: 'left' });
    expect((await invoke()).status).toBe(403);
    store.docs.set('groups/course/members/alice', { role: 'owner', status: 'active' });
    store.docs.set('groups/course', { schoolId: '../other' });
    expect((await invoke()).status).toBe(403);
    expect(bucket.file).not.toHaveBeenCalled();
  });

  test.each([
    { accountDeletionInProgress: true },
    ...['deleted', 'disabled', 'suspended', 'inactive'].map((status) => ({ status })),
  ])('blocks closed or suspended accounts %j', async (state) => {
    store.docs.set('users/alice', state);
    expect((await invoke()).status).toBe(403);
    expect((await invoke({ method: 'POST' })).status).toBe(403);
    expect(bucket.file).not.toHaveBeenCalled();
  });

  test.each([COVER, POST, ANSWER])('missing account denies reads and uploads at %s despite active memberships', async (path) => {
    store.docs.delete('users/alice');
    for (const method of ['GET', 'POST']) {
      expect(await invoke({ path, method })).toMatchObject({
        status: 403, body: JSON.stringify({ error: 'File access denied' }),
      });
    }
    expect(bucket.file).not.toHaveBeenCalled();
  });

  test('legacy token metadata never becomes a download URL and each download rechecks access', async () => {
    put(POST, 'private bytes', { metadata: { firebaseStorageDownloadTokens: 'legacy-secret' } });
    const result = await invoke();
    expect(result).toMatchObject({ status: 200, body: 'private bytes' });
    expect(JSON.stringify(result)).not.toMatch(/legacy-secret|token=|https:\/\//);
    expect(result.headers.location).toBeUndefined();
    expect(result.headers['cache-control']).toBe('private, no-store');
    bucket.file.mockClear();
    store.docs.set('groups/course/members/alice', { status: 'left', role: 'member' });
    expect(await invoke()).toMatchObject({ status: 403 });
    expect(bucket.file).not.toHaveBeenCalled();
  });

  test('does not stream another author’s unpublished group-post draft', async () => {
    expect((await invoke({ path: POST, uid: 'bob' })).status).toBe(403);
    expect((await invoke({ path: POST, uid: 'alice' })).status).toBe(200);
    store.docs.set('groups/course/posts/one', { authorId: 'alice', attachments: [POST] });
    expect((await invoke({ path: POST, uid: 'bob' })).status).toBe(200);
    const sibling = POST.replace('notes.pdf', 'draft.pdf');
    put(sibling, 'draft-only');
    expect((await invoke({ path: sibling, uid: 'bob' })).status).toBe(403);
    expect((await invoke({ path: sibling, uid: 'teacher' })).status).toBe(403);
    expect((await invoke({ path: sibling, uid: 'alice' })).status).toBe(200);
    store.docs.set('groups/course/members/bob', { status: 'inactive', role: 'member' });
    expect((await invoke({ path: POST, uid: 'bob' })).status).toBe(403);
  });

  test('submission reads require owner or current manager and writes require the owner', async () => {
    expect((await invoke({ path: ANSWER, uid: 'bob' })).status).toBe(403);
    expect((await invoke({ path: ANSWER, uid: 'outsider' })).status).toBe(403);
    expect((await invoke({ path: ANSWER, uid: 'teacher' })).status).toBe(200);
    expect((await invoke({ path: ANSWER, uid: 'teacher', method: 'POST' })).status).toBe(403);
    store.docs.set('schools/pu/members/teacher', { status: 'inactive' });
    expect((await invoke({ path: ANSWER, uid: 'teacher' })).status).toBe(403);
  });

  test.each([POST, ANSWER])('attachments use atomic create-only writes at %s', async (path) => {
    expect((await invoke({ path, method: 'POST', body: 'forged' })).status).toBe(409);
    expect(objects.get(path).data.toString()).toBe('original');
    const fresh = path.replace('.pdf', '-new.pdf');
    expect(await invoke({ path: fresh, method: 'POST', body: 'new answer', headers: {
      'x-goog-meta-firebaseStorageDownloadTokens': 'attacker-token',
    } })).toMatchObject({ status: 201, body: JSON.stringify({ path: fresh }) });
    expect(objects.get(fresh).data.toString()).toBe('new answer');
    expect(saves.every((save) => save.options.preconditionOpts.ifGenerationMatch === 0)).toBe(true);
    expect(saves.at(-1).options.metadata).toEqual({ contentType: 'application/pdf', cacheControl: 'private, no-store' });
  });

  test('manager cover replacement uses generation CAS and a member cannot replace it', async () => {
    const headers = { 'content-type': 'image/jpeg' };
    expect((await invoke({ path: COVER, method: 'POST', headers })).status).toBe(403);
    const previous = objects.get(COVER).metadata.generation;
    expect((await invoke({ path: COVER, uid: 'teacher', method: 'POST', headers, body: 'new cover' })).status).toBe(200);
    expect(saves.at(-1).options.preconditionOpts.ifGenerationMatch).toBe(previous);
    expect(objects.get(COVER).data.toString()).toBe('new cover');
  });

  test.each([undefined, null, '0', '-1', 'invalid'])('rejects malformed stored generation %j before reading or replacing a cover', async (value) => {
    objects.get(COVER).metadata.generation = value;
    expect((await invoke({ path: COVER })).status).toBe(500);
    expect((await invoke({ path: COVER, uid: 'teacher', method: 'POST', headers: { 'content-type': 'image/jpeg' } })).status).toBe(500);
    expect(reads).toHaveLength(0);
    expect(saves).toHaveLength(0);
  });

  test('fails closed when the SDK would round a read generation', async () => {
    // File's constructor converts its generation option to a JavaScript number.
    objects.get(COVER).metadata.generation = '9007199254740993';
    expect((await invoke({ path: COVER })).status).toBe(500);
    expect(reads).toHaveLength(0);
  });

  test('a concurrent cover update fails its generation precondition without overwriting the winner', async () => {
    const original = bucket.file;
    bucket.file = (path, options) => {
      const file = original(path, options);
      return {
        ...file,
        async save(bytes, settings) {
          put(path, 'concurrent cover');
          return file.save(bytes, settings);
        },
      };
    };
    expect((await invoke({ path: COVER, uid: 'teacher', method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: 'losing cover' })).status).toBe(409);
    expect(objects.get(COVER).data.toString()).toBe('concurrent cover');
  });

  test.each([[POST, 0], [COVER, '9007199254740993']])('actual GCS SDK sends the generation precondition for %s', async (path, expected) => {
    if (path === POST) store.docs.set('groups/course/posts/one', { authorId: 'teacher' });
    const storage = new CloudStorage({ projectId: 'demo-private-files', apiEndpoint: 'http://127.0.0.1:1' });
    storage.request = jest.fn((options, callback) => {
      if (options.method !== 'POST') {
        callback(null, { generation: expected, size: '8', contentType: 'image/jpeg' });
        return;
      }
      const upload = options.multipart[1].body;
      const checksum = new CRC32C();
      upload.on('data', (chunk) => checksum.update(chunk));
      upload.on('error', callback);
      upload.on('end', () => callback(null, { generation: '42', crc32c: checksum.toString() }, { statusCode: 200 }));
    });
    handler = createPrivateGroupFileHandler({ db: store.db, bucket: storage.bucket('demo-private-files.appspot.com'), verifyIdToken });
    const response = await invoke({ path, uid: 'teacher', method: 'POST', body: 'wire bytes', headers: { 'content-type': 'image/jpeg' } });
    expect(response.status).toBe(expected === 0 ? 201 : 200);
    const mutation = storage.request.mock.calls.map(([options]) => options).find((options) => options.method === 'POST');
    expect(mutation.qs).toMatchObject({ uploadType: 'multipart', ifGenerationMatch: expected });
    expect(mutation.qs).not.toHaveProperty('preconditionOpts');
    expect(JSON.parse(mutation.multipart[0].body)).toEqual({ contentType: 'image/jpeg', cacheControl: 'private, no-store' });
  });

  test('file existence is disclosed only after canonical authorization', async () => {
    const missing = POST.replace('notes.pdf', 'missing.pdf');
    expect(await invoke({ path: missing, uid: 'outsider' })).toMatchObject({ status: 403, body: '{"error":"File access denied"}' });
    expect((await invoke({ path: POST, uid: 'outsider' })).status).toBe(403);
    expect(bucket.file).not.toHaveBeenCalled();
    expect((await invoke({ path: missing })).status).toBe(404);
  });

  test.each([
    'groups/course/roster.pdf',
    'groups/course/private-notes.txt',
    'groups/course/cover.jpg.backup',
  ])('does not expose unrelated group-root objects through the cover gateway: %s', async (path) => {
    // Keep broad namespace parsing for the separate legacy token migration,
    // but only actual cover filenames may be served by this HTTP endpoint.
    expect(parsePrivateGroupFilePath(path)?.kind).toBe('group-cover');
    put(path, 'synthetic confidential bytes');
    for (const method of ['GET', 'POST']) {
      expect(await invoke({ path, method })).toMatchObject({
        status: 400,
        body: JSON.stringify({ error: 'Invalid private file path' }),
      });
    }
    expect(bucket.file).not.toHaveBeenCalled();
    expect(reads).toHaveLength(0);
    expect(saves).toHaveLength(0);
  });

  test('rejects unsupported methods, MIME types and cover filenames', async () => {
    expect((await invoke({ method: 'DELETE' })).status).toBe(405);
    expect((await invoke({ method: 'POST', headers: { 'content-type': 'text/html' } })).status).toBe(400);
    expect((await invoke({ path: 'groups/course/arbitrary.jpg', uid: 'teacher', method: 'POST', headers: { 'content-type': 'image/jpeg' } })).status).toBe(400);
    expect(saves).toHaveLength(0);
  });

  test('caps prebuffered uploads and metadata-sized reads at the scope limit', async () => {
    const size = parsePrivateGroupFilePath(COVER).maxBytes;
    expect((await invoke({ path: COVER, uid: 'teacher', method: 'POST', headers: { 'content-type': 'image/jpeg' }, rawBody: Buffer.alloc(size) })).status).toBe(413);
    objects.get(COVER).metadata.size = String(size);
    expect((await invoke({ path: COVER })).status).toBe(413);
    expect(saves).toHaveLength(0);
    expect(reads).toHaveLength(0);
  });

  test('caps actual decompressed output and preserves bounded legacy gzip downloads', async () => {
    put(COVER, gzipSync(Buffer.from('small compressed file')), { contentEncoding: 'gzip' });
    expect(await invoke({ path: COVER })).toMatchObject({ status: 200, body: 'small compressed file' });
    const size = parsePrivateGroupFilePath(COVER).maxBytes;
    put(COVER, gzipSync(Buffer.alloc(size)), { contentEncoding: 'gzip' });
    expect(Number(objects.get(COVER).metadata.size)).toBeLessThan(size);
    await expect(invoke({ path: COVER })).rejects.toMatchObject({ statusCode: 413 });
  });

  test('revocation while receiving a body prevents its commit', async () => {
    let started;
    const receiving = new Promise((resolve) => { started = resolve; });
    onFile = started;
    const pending = launch({ method: 'POST', path: POST.replace('.pdf', '-late.pdf'), end: false });
    pending.req.write('first chunk');
    await receiving;
    store.docs.set('schools/pu/members/alice', { status: 'inactive' });
    pending.req.end('last chunk');
    expect((await pending.done).status).toBe(403);
    expect(saves).toHaveLength(0);
  });

  test('bounds simultaneous uploads and releases capacity after completion', async () => {
    handler = createPrivateGroupFileHandler({ db: store.db, bucket, verifyIdToken, maxConcurrentUploads: 1 });
    let started;
    const receiving = new Promise((resolve) => { started = resolve; });
    onFile = started;
    const pending = launch({ method: 'POST', path: POST.replace('.pdf', '-held.pdf'), end: false });
    pending.req.write('first');
    await receiving;
    expect((await invoke({ method: 'POST' })).status).toBe(429);
    pending.req.end('last');
    expect((await pending.done).status).toBe(201);
    expect((await invoke({ method: 'POST', path: POST.replace('.pdf', '-after.pdf') })).status).toBe(201);
  });

  test('an absolute upload deadline returns 408 and frees capacity', async () => {
    handler = createPrivateGroupFileHandler({ db: store.db, bucket, verifyIdToken, uploadTimeoutMs: 25, maxConcurrentUploads: 1 });
    const pending = launch({ method: 'POST', end: false });
    pending.req.write('slow');
    expect((await pending.done).status).toBe(408);
    pending.req.destroy();
    expect((await invoke({ method: 'POST', path: POST.replace('.pdf', '-after-timeout.pdf') })).status).toBe(201);
  });

  test('an upload disconnected during authorization releases capacity immediately', async () => {
    handler = createPrivateGroupFileHandler({ db: store.db, bucket, verifyIdToken, maxConcurrentUploads: 1 });
    const pending = launch({ method: 'POST', end: false });
    pending.req.destroy();
    expect((await pending.done).status).toBe(400);
    expect((await invoke({ method: 'POST', path: POST.replace('.pdf', '-after-disconnect.pdf') })).status).toBe(201);
  });
});

describe('private group file namespace parser', () => {
  test.each([
    ['', null], [COVER, 'group-cover'], [POST, 'group-post'], [ANSWER, 'assignment'],
    ['groups/course', null], ['groups/course/posts/one/nested/file.pdf', null],
    ['groups/course/posts/one/../file.pdf', null], ['groups/course/cover.jpg/', null],
    ['groups/course/cover\n.jpg', null], ['groups/course/cover\\.jpg', null],
    ['assignments/work/submissions/alice', null], ['avatars/alice.jpg', null],
    ['schools/pu/stories/story-1/image', null],
    [null, null], [['groups/course/cover.jpg'], null],
  ])('limits path %j to scope %s', (path, kind) => {
    expect(parsePrivateGroupFilePath(path)?.kind || null).toBe(kind);
  });
});
