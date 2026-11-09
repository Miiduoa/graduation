// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createMemoryGroupStore } from './memoryGroupStore';
import { createR2FileStorage } from './fileStorage';
import { resetFirebaseAdminForTests } from './firebaseAdmin';
import {
  createPrivateFileRateLimiter,
  resetPrivateFileRateLimitForTests,
  setPrivateFileRateLimiterForTests,
} from './privateFileRateLimit';
import { dispatchPrivateFileRequest, type PrivateFileRuntime } from './privateFileRoutes';

const COVER = 'groups/course/cover.jpg';
const POST = 'groups/course/posts/one/notes.pdf';
const ANSWER = 'assignments/work/submissions/alice/answer.pdf';
const STORY = 'schools/pu/stories/story-1/image';
const BUCKET = 'test-bucket';

type Stored = {
  body: Buffer;
  contentType: string;
  etag: string;
  metadata: Record<string, string>;
};

function startMemoryS3() {
  const objects = new Map<string, Stored>();
  let generation = 0;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const host = String(req.headers.host || '127.0.0.1');
      const url = new URL(req.url || '/', `http://${host}`);
      const prefix = `/${BUCKET}/`;
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (!url.pathname.startsWith(prefix)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const key = decodeURIComponent(url.pathname.slice(prefix.length));
      if (req.method === 'HEAD' || req.method === 'GET') {
        const object = objects.get(key);
        if (!object) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', object.contentType);
        res.setHeader('Content-Length', String(object.body.length));
        res.setHeader('ETag', `"${object.etag}"`);
        for (const [name, value] of Object.entries(object.metadata)) {
          res.setHeader(`x-amz-meta-${name}`, value);
        }
        if (req.method === 'GET') res.end(object.body);
        else res.end();
        return;
      }
      if (req.method !== 'PUT') {
        res.statusCode = 405;
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const existing = objects.get(key);
      const ifNoneMatch = req.headers['if-none-match'];
      const ifMatch = String(req.headers['if-match'] || '').replace(/"/g, '');
      if (ifNoneMatch === '*' && existing) {
        res.statusCode = 412;
        res.end();
        return;
      }
      if (ifMatch && existing?.etag !== ifMatch) {
        res.statusCode = 412;
        res.end();
        return;
      }
      const metadata: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        const match = name.match(/^x-amz-meta-(.+)$/);
        if (match && typeof value === 'string') metadata[match[1]] = value;
      }
      const stored: Stored = {
        body,
        contentType: String(req.headers['content-type'] || 'application/octet-stream'),
        etag: String(++generation),
        metadata,
      };
      objects.set(key, stored);
      res.statusCode = existing ? 200 : 200;
      res.setHeader('ETag', `"${stored.etag}"`);
      res.end();
    })().catch(() => {
      res.statusCode = 500;
      res.end();
    });
  });
  return new Promise<{
    origin: string;
    objects: Map<string, Stored>;
    close: () => Promise<void>;
  }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        objects,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}

function seedStore() {
  return createMemoryGroupStore([
    ['groups/course', { schoolId: 'pu' }],
      ['groups/course/posts/one', { authorId: 'alice' }],
    ['assignments/work', { groupId: 'course' }],
    ...['alice', 'bob', 'teacher'].flatMap((uid) => [
      [`users/${uid}`, { displayName: uid }] as [string, Record<string, unknown>],
      [
        `groups/course/members/${uid}`,
        { status: 'active', role: uid === 'teacher' ? 'instructor' : 'member' },
      ] as [string, Record<string, unknown>],
      [`schools/pu/members/${uid}`, { status: 'active' }] as [string, Record<string, unknown>],
    ]),
    [
      'schools/pu/members/stamped',
      { status: 'active', profileBoundSchoolId: 'pu', profileBoundGeneration: 'gen-1' },
    ],
    ['users/stamped', { displayName: 'stamped' }],
  ]);
}

function request(
  body: unknown,
  init: { uid?: string | null; method?: string } = {},
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.uid !== null) headers.Authorization = `Bearer ${init.uid ?? 'alice'}`;
  return new Request('https://nuni.tw/api/files/private', {
    method: init.method ?? 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function invoke(
  runtime: PrivateFileRuntime | null | undefined,
  body: unknown,
  init?: { uid?: string | null; method?: string },
) {
  const response = await dispatchPrivateFileRequest(request(body, init), runtime);
  return { status: response.status, body: await response.json() };
}

let s3: Awaited<ReturnType<typeof startMemoryS3>>;
let store: ReturnType<typeof seedStore>;
let runtime: PrivateFileRuntime;

beforeEach(async () => {
  resetFirebaseAdminForTests();
  resetPrivateFileRateLimitForTests();
  setPrivateFileRateLimiterForTests(
    createPrivateFileRateLimiter({ requestsPerMinute: 1000, uploadsPerMinute: 1000 }),
  );
  s3 = await startMemoryS3();
  store = seedStore();
  runtime = {
    db: store.db as never,
    verifyIdToken: async (token: string) => {
      if (token === 'expired') throw new Error('Token revoked');
      return { uid: token };
    },
    storage: createR2FileStorage({
      backend: 'r2',
      presignTtlSeconds: 60,
      s3: {
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret',
        bucket: BUCKET,
        endpoint: s3.origin,
        region: 'auto',
      },
    }),
  };
});

afterEach(async () => {
  resetPrivateFileRateLimitForTests();
  resetFirebaseAdminForTests();
  await s3.close();
});

it('returns 503 尚未啟用 when storage is not configured', async () => {
  expect(await invoke(null, { action: 'download', path: POST })).toEqual({
    status: 503,
    body: { error: '尚未啟用' },
  });
});

it('rejects missing or revoked authentication before looking up files', async () => {
  expect((await invoke(runtime, { action: 'download', path: POST }, { uid: null })).status).toBe(401);
  expect((await invoke(runtime, { action: 'download', path: POST }, { uid: 'expired' })).status).toBe(
    401,
  );
  expect(s3.objects.size).toBe(0);
});

it('rejects a non-member without disclosing whether the object exists', async () => {
  expect(await invoke(runtime, { action: 'download', path: POST }, { uid: 'outsider' })).toEqual({
    status: 403,
    body: { error: 'File access denied' },
  });
  expect(await invoke(runtime, { action: 'upload', path: POST, contentType: 'application/pdf', byteSize: 4 }, { uid: 'outsider' })).toEqual({
    status: 403,
    body: { error: 'File access denied' },
  });
});

it('rejects an unstamped campus story reader (未蓋章)', async () => {
  expect(await invoke(runtime, { action: 'download', path: STORY })).toEqual({
    status: 403,
    body: { error: 'File access denied' },
  });
  expect(
    await invoke(runtime, {
      action: 'upload',
      path: STORY,
      contentType: 'image/jpeg',
      byteSize: 4,
    }),
  ).toEqual({
    status: 403,
    body: { error: 'File access denied' },
  });
});

it('lets a stamped school member upload and download a draft story', async () => {
  const upload = await invoke(
    runtime,
    { action: 'upload', path: STORY, contentType: 'image/jpeg', byteSize: 5 },
    { uid: 'stamped' },
  );
  expect(upload.status).toBe(200);
  expect(upload.body.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  expect(Number(new URL(String(upload.body.url)).searchParams.get('X-Amz-Expires'))).toBe(60);
  const put = await fetch(String(upload.body.url), {
    method: String(upload.body.method),
    headers: upload.body.headers as Record<string, string>,
    body: Buffer.from('photo'),
  });
  expect(put.status).toBe(200);
  const download = await invoke(runtime, { action: 'download', path: STORY }, { uid: 'stamped' });
  expect(download.status).toBe(200);
  const got = await fetch(String(download.body.url), { method: String(download.body.method) });
  expect(await got.text()).toBe('photo');
});

it('uploads and downloads an assignment file for the owner', async () => {
  const upload = await invoke(runtime, {
    action: 'upload',
    path: ANSWER,
    contentType: 'application/pdf',
    byteSize: 8,
  });
  expect(upload.status).toBe(200);
  expect(upload.body.headers).toMatchObject({
    'content-type': 'application/pdf',
    'if-none-match': '*',
  });
  const put = await fetch(String(upload.body.url), {
    method: String(upload.body.method),
    headers: upload.body.headers as Record<string, string>,
    body: Buffer.from('homework'),
  });
  expect(put.status).toBe(200);
  const duplicate = await fetch(String(upload.body.url), {
    method: String(upload.body.method),
    headers: upload.body.headers as Record<string, string>,
    body: Buffer.from('forged!!'),
  });
  expect(duplicate.status).toBe(412);

  const asBob = await invoke(runtime, { action: 'download', path: ANSWER }, { uid: 'bob' });
  expect(asBob.status).toBe(403);
  const asTeacher = await invoke(runtime, { action: 'download', path: ANSWER }, { uid: 'teacher' });
  expect(asTeacher.status).toBe(200);
  const teacherWrite = await invoke(
    runtime,
    { action: 'upload', path: ANSWER, contentType: 'application/pdf', byteSize: 4 },
    { uid: 'teacher' },
  );
  expect(teacherWrite.status).toBe(403);
  const download = await invoke(runtime, { action: 'download', path: ANSWER });
  expect(download.status).toBe(200);
  const got = await fetch(String(download.body.url));
  expect(await got.text()).toBe('homework');
});

it('lets a manager replace a group cover and rejects a member write', async () => {
  expect(
    (
      await invoke(runtime, {
        action: 'upload',
        path: COVER,
        contentType: 'image/jpeg',
        byteSize: 4,
      })
    ).status,
  ).toBe(403);
  const first = await invoke(
    runtime,
    { action: 'upload', path: COVER, contentType: 'image/jpeg', byteSize: 8 },
    { uid: 'teacher' },
  );
  expect(first.status).toBe(200);
  expect(first.body.headers).toMatchObject({ 'if-none-match': '*' });
  await fetch(String(first.body.url), {
    method: String(first.body.method),
    headers: first.body.headers as Record<string, string>,
    body: Buffer.from('original'),
  });
  const second = await invoke(
    runtime,
    { action: 'upload', path: COVER, contentType: 'image/jpeg', byteSize: 7 },
    { uid: 'teacher' },
  );
  expect(second.status).toBe(200);
  expect(String((second.body.headers as Record<string, string>)['if-match'])).toMatch(/"/);
  await fetch(String(second.body.url), {
    method: String(second.body.method),
    headers: second.body.headers as Record<string, string>,
    body: Buffer.from('updated'),
  });
  const download = await invoke(runtime, { action: 'download', path: COVER });
  const got = await fetch(String(download.body.url));
  expect(await got.text()).toBe('updated');
});

it('rejects unsupported types and oversize uploads', async () => {
  expect(
    await invoke(runtime, {
      action: 'upload',
      path: POST,
      contentType: 'text/html',
      byteSize: 4,
    }),
  ).toEqual({ status: 400, body: { error: 'Unsupported file type or filename' } });
  expect(
    await invoke(runtime, {
      action: 'upload',
      path: COVER,
      contentType: 'image/jpeg',
      byteSize: 5 * 1024 * 1024,
    }, { uid: 'teacher' }),
  ).toEqual({ status: 413, body: { error: 'File is too large' } });
  expect(
    (await invoke(runtime, { action: 'download', path: 'avatars/alice.jpg' })).status,
  ).toBe(400);
});

it('rejects inactive school membership even with a stale group mirror', async () => {
  store.docs.set('schools/pu/members/alice', { status: 'inactive' });
  store.docs.set('groups/course/members/alice', { status: 'active', role: 'owner' });
  expect((await invoke(runtime, { action: 'download', path: POST })).status).toBe(403);
  expect(
    (await invoke(runtime, { action: 'upload', path: POST, contentType: 'application/pdf', byteSize: 4 }))
      .status,
  ).toBe(403);
});
