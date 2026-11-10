// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemoryGroupStore } from './memoryGroupStore';
import { createSupabaseFileStorage } from './fileStorage';
import { resetFirebaseAdminForTests } from './firebaseAdmin';
import {
  createPrivateFileRateLimiter,
  resetPrivateFileRateLimitForTests,
  setPrivateFileRateLimiterForTests,
} from './privateFileRateLimit';
import { dispatchPrivateFileRequest, type PrivateFileRuntime } from './privateFileRoutes';

vi.mock('server-only', () => ({}));

const COVER = 'groups/course/cover.jpg';
const POST = 'groups/course/posts/one/notes.pdf';
const ANSWER = 'groups/course/assignments/work/submissions/alice/answer.pdf';
const STORY = 'schools/pu/stories/story-1/image';
const BUCKET = 'test-bucket';

type Stored = {
  body: Buffer;
  contentType: string;
  etag: string;
  metadata: Record<string, string>;
};

async function startMemoryStorage() {
  const objects = new Map<string, Stored>();
  const fetchMock: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const route = url.pathname.replace('/storage/v1', '');
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (route.startsWith('/object/upload/sign/')) {
      return json({ url: `${route}?token=upload-token` });
    }
    if (route.startsWith('/object/sign/')) return json({ signedURL: `${route}?token=download-token` });
    if (route.startsWith('/object/info/')) {
      const key = decodeURIComponent(route.slice(`/object/info/${BUCKET}/`.length));
      const object = objects.get(key);
      return object ? json({ size: object.body.length, content_type: object.contentType, metadata: object.metadata }) : json({ message: 'missing', statusCode: '404' }, 404);
    }
    if (init?.method === 'DELETE') {
      const { prefixes } = JSON.parse(String(init.body));
      for (const key of prefixes) objects.delete(key);
      return json([]);
    }
    throw new Error('Unexpected storage request');
  };
  return { origin: 'https://storage.example', objects, fetchMock };
}

function put(upload: { body: Record<string, unknown> }, body: string) {
  const key = String(upload.body.path);
  if (memoryStorage.objects.has(key)) return 409;
  const headers = upload.body.headers as Record<string, string>;
  memoryStorage.objects.set(key, { body: Buffer.from(body), contentType: headers['content-type'], etag: '', metadata: headers['x-metadata'] ? JSON.parse(Buffer.from(headers['x-metadata'], 'base64').toString()) : {} });
  return 200;
}

function seedStore() {
  return createMemoryGroupStore([
    ['groups/course', { schoolId: 'pu' }],
      ['groups/course/posts/one', { authorId: 'alice' }],
    ['assignments/work', { groupId: 'course' }],
    ['groups/course/assignments/work', { status: 'published' }],
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

let memoryStorage: Awaited<ReturnType<typeof startMemoryStorage>>;
let store: ReturnType<typeof seedStore>;
let runtime: PrivateFileRuntime;

beforeEach(async () => {
  resetFirebaseAdminForTests();
  resetPrivateFileRateLimitForTests();
  setPrivateFileRateLimiterForTests(
    createPrivateFileRateLimiter({ requestsPerMinute: 1000, uploadsPerMinute: 1000 }),
  );
  memoryStorage = await startMemoryStorage();
  store = seedStore();
  runtime = {
    db: store.db as never,
    verifyIdToken: async (token: string) => {
      if (token === 'expired') throw new Error('Token revoked');
      return { uid: token };
    },
    storage: createSupabaseFileStorage({
      backend: 'supabase', presignTtlSeconds: 60, url: memoryStorage.origin,
      serviceRoleKey: 'test-service-secret', bucket: BUCKET,
    }, memoryStorage.fetchMock),
  };
});

afterEach(async () => {
  resetPrivateFileRateLimitForTests();
  resetFirebaseAdminForTests();
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
  expect(memoryStorage.objects.size).toBe(0);
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
  expect(upload.body.url).toContain('https://storage.example/storage/v1/');
  expect(put(upload, 'photo')).toBe(200);
  expect((await invoke(runtime, { action: 'finalize', path: upload.body.path }, { uid: 'stamped' })).status).toBe(200);
  expect((await invoke(runtime, { action: 'download', path: STORY }, { uid: 'stamped' })).status).toBe(200);
});

it('uploads and downloads an assignment file for the owner', async () => {
  const upload = await invoke(runtime, {
    action: 'upload',
    path: ANSWER,
    contentType: 'application/pdf',
    byteSize: 8,
  });
  expect(upload.status).toBe(200);
  expect(upload.body.requiresFinalize).toBe(true);
  expect(JSON.stringify(upload.body)).not.toContain('test-service-secret');
  expect(put(upload, 'homework')).toBe(200);
  expect(put(upload, 'forged!!')).toBe(409);
  expect((await invoke(runtime, { action: 'finalize', path: ANSWER })).status).toBe(200);

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
  expect(download.body.url).toContain('token=download-token');
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
  expect(put(first, 'original')).toBe(200);
  const second = await invoke(runtime, { action: 'upload', path: COVER, contentType: 'image/jpeg', byteSize: 7 }, { uid: 'teacher' });
  expect(second.status).toBe(200);
  expect(second.body.path).not.toBe(first.body.path);
  expect(put(second, 'updated')).toBe(200);
  expect((await invoke(runtime, { action: 'finalize', path: second.body.path }, { uid: 'teacher' })).status).toBe(200);
  expect((await invoke(runtime, { action: 'download', path: second.body.path })).status).toBe(200);
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
      byteSize: 5 * 1024 * 1024 + 1,
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

it.each(['upload', 'download', 'finalize'])('rejects legacy assignment %s paths at the gateway', async (action) => {
  const result = await invoke(runtime, { action, path: 'assignments/work/submissions/alice/answer.pdf', contentType: 'application/pdf', byteSize: 8 });
  expect(result).toEqual({ status: 403, body: { error: '不支援舊版作業附件路徑' } });
});

it.each(['image/svg+xml', 'text/html', 'application/xhtml+xml', 'application/javascript', 'text/javascript'])('rejects executable assignment MIME %s', async (contentType) => {
  expect((await invoke(runtime, { action: 'upload', path: ANSWER, contentType, byteSize: 8 })).status).toBe(400);
});

it.each([
  ['text/html', 8, 400],
  ['application/pdf', 25 * 1024 * 1024 + 1, 413],
  ['application/pdf', 0, 413],
])('deletes invalid finalized objects (%s, %i)', async (contentType, length, status) => {
  await invoke(runtime, { action: 'upload', path: ANSWER, contentType: 'application/pdf', byteSize: 8 });
  memoryStorage.objects.set(ANSWER, { body: Buffer.alloc(Number(length)), contentType: String(contentType), etag: '', metadata: {} });
  expect((await invoke(runtime, { action: 'download', path: ANSWER })).status).toBe(404);
  expect((await invoke(runtime, { action: 'finalize', path: ANSWER })).status).toBe(status);
  expect(memoryStorage.objects.has(ANSWER)).toBe(false);
});

it('rechecks current authorization before finalize and does not delete another user file', async () => {
  memoryStorage.objects.set(ANSWER, { body: Buffer.from('pdf'), contentType: 'application/pdf', etag: '', metadata: {} });
  expect((await invoke(runtime, { action: 'finalize', path: ANSWER }, { uid: 'bob' })).status).toBe(403);
  expect(memoryStorage.objects.has(ANSWER)).toBe(true);
  store.docs.set('schools/pu/members/alice', { status: 'inactive' });
  expect((await invoke(runtime, { action: 'finalize', path: ANSWER })).status).toBe(403);
});

it.each(['../notes.pdf', 'groups/course/posts/one/../notes.pdf', 'groups/course/posts/one/a\u0000.pdf', 'groups/course/posts/one/a\\b.pdf'])('rejects path injection %s', async path => {
  for (const action of ['upload', 'download', 'finalize']) {
    expect((await invoke(runtime, { action, path, contentType: 'application/pdf', byteSize: 8 })).status).toBe(400);
  }
});

it('rejects forged story ownership metadata', async () => {
  await invoke(runtime, { action: 'upload', path: STORY, contentType: 'image/jpeg', byteSize: 8 }, { uid: 'stamped' });
  memoryStorage.objects.set(STORY, { body: Buffer.from('photo'), contentType: 'image/jpeg', etag: '', metadata: { 'owner-uid': 'stamped', 'owner-proof': 'forged' } });
  for (const action of ['download', 'finalize']) {
    expect((await invoke(runtime, { action, path: STORY }, { uid: 'stamped' })).status).toBe(action === 'download' ? 404 : 403);
  }
});

it('reissues downloads only after fresh authorization and metadata checks', async () => {
  await invoke(runtime, { action: 'upload', path: ANSWER, contentType: 'application/pdf', byteSize: 8 });
  memoryStorage.objects.set(ANSWER, { body: Buffer.from('pdf'), contentType: 'application/pdf', etag: '', metadata: {} });
  expect((await invoke(runtime, { action: 'finalize', path: ANSWER })).status).toBe(200);
  expect((await invoke(runtime, { action: 'download', path: ANSWER })).status).toBe(200);
  memoryStorage.objects.get(ANSWER)!.contentType = 'text/html';
  expect((await invoke(runtime, { action: 'download', path: ANSWER })).status).toBe(400);
});

it('requires finalize before download and ignores self reported size for quota', async () => {
  const upload = await invoke(runtime, { action: 'upload', path: ANSWER, contentType: 'application/pdf', byteSize: 1 });
  expect(upload.status).toBe(200);
  put(upload, 'larger than reported');
  expect((await invoke(runtime, { action: 'download', path: ANSWER })).status).toBe(404);
  expect(store.docs.get('privateFileQuota/global')?.reservedBytes).toBe(45 * 1024 * 1024);
  expect((await invoke(runtime, { action: 'finalize', path: ANSWER })).status).toBe(200);
  expect((await invoke(runtime, { action: 'finalize', path: ANSWER })).status).toBe(200);
  expect(store.docs.get('privateFileQuota/global')).toEqual({ reservedBytes: 0, finalizedBytes: 20 });
});

it('claims finalized uploads, refreshes timestamps, permits download and rechecks membership', async () => {
  const upload = await invoke(runtime, { action: 'upload', path: ANSWER, contentType: 'application/pdf', byteSize: 1 });
  put(upload, 'answer');
  expect((await invoke(runtime, { action: 'claim', path: ANSWER })).status).toBe(410);
  expect((await invoke(runtime, { action: 'finalize', path: ANSWER })).status).toBe(200);
  runtime.now = () => 1000;
  expect((await invoke(runtime, { action: 'claim', path: ANSWER })).body).toMatchObject({ path: ANSWER, claimed: true });
  runtime.now = () => 2000;
  expect((await invoke(runtime, { action: 'claim', path: ANSWER })).status).toBe(200);
  const record = [...store.docs.values()].find((row) => row.path === ANSWER)!;
  expect(record).toMatchObject({ status: 'claimed', claimedAt: 2000 });
  expect((await invoke(runtime, { action: 'download', path: ANSWER })).status).toBe(200);
  expect((await invoke(runtime, { action: 'claim', path: ANSWER }, { uid: 'bob' })).status).toBe(403);
  record.status = 'deleting';
  expect((await invoke(runtime, { action: 'claim', path: ANSWER })).status).toBe(410);
});

it.each([
  [COVER, 'image/jpeg', 5, 'teacher'],
  [POST, 'application/pdf', 20, 'alice'],
  [ANSWER, 'application/pdf', 25, 'alice'],
  [STORY, 'image/jpeg', 10, 'stamped'],
  [STORY, 'video/mp4', 45, 'stamped'],
])('accepts the inclusive ticket, finalize and download boundary for %s (%s)', async (path, contentType, mib, uid) => {
  const byteSize = Number(mib) * 1024 * 1024;
  const auth = { uid: String(uid) };
  expect((await invoke(runtime, { action: 'upload', path, contentType, byteSize: byteSize + 1 }, auth)).status).toBe(413);
  const ticket = await invoke(runtime, { action: 'upload', path, contentType, byteSize }, auth);
  expect(ticket.status).toBe(200);
  put(ticket, 'x');
  memoryStorage.objects.get(String(ticket.body.path))!.body = Buffer.alloc(byteSize);
  expect((await invoke(runtime, { action: 'finalize', path: ticket.body.path }, auth)).status).toBe(200);
  expect((await invoke(runtime, { action: 'download', path: ticket.body.path }, auth)).status).toBe(200);
});

it('confirms only the original claimed story object after publication while uploads stay forbidden', async () => {
  const auth = { uid: 'stamped' };
  const ticket = await invoke(runtime, { action: 'upload', path: STORY, contentType: 'image/jpeg', byteSize: 4 }, auth);
  put(ticket, 'jpeg');
  expect((await invoke(runtime, { action: 'finalize', path: STORY }, auth)).status).toBe(200);
  expect((await invoke(runtime, { action: 'claim', path: STORY }, auth)).status).toBe(200);
  store.docs.set('campusStories/story-1', { schoolId: 'pu', authorUid: 'stamped', mediaUrl: STORY });
  expect((await invoke(runtime, { action: 'claim', path: STORY }, auth)).status).toBe(200);
  expect((await invoke(runtime, { action: 'upload', path: STORY, contentType: 'image/jpeg', byteSize: 4 }, auth)).status).toBe(403);
  expect((await invoke(runtime, { action: 'claim', path: STORY }, { uid: 'bob' })).status).toBe(403);
  store.docs.set('campusStories/story-1', { schoolId: 'pu', authorUid: 'stamped', mediaUrl: STORY.replace('story-1', 'other') });
  expect((await invoke(runtime, { action: 'claim', path: STORY }, auth)).status).toBe(403);
});

it('keeps a released cover downloadable while the group still references it', async () => {
  const auth = { uid: 'teacher' };
  const old = await invoke(runtime, { action: 'upload', path: COVER, contentType: 'image/jpeg', byteSize: 4 }, auth);
  put(old, 'jpeg');
  await invoke(runtime, { action: 'finalize', path: old.body.path }, auth);
  await invoke(runtime, { action: 'claim', path: old.body.path }, auth);
  store.docs.get('groups/course')!.coverUrl = old.body.path;
  const next = await invoke(runtime, { action: 'upload', path: COVER, contentType: 'image/jpeg', byteSize: 4 }, auth);
  put(next, 'jpeg');
  await invoke(runtime, { action: 'finalize', path: next.body.path }, auth);
  expect((await invoke(runtime, { action: 'claim', path: next.body.path }, auth)).status).toBe(200);
  expect((await invoke(runtime, { action: 'download', path: old.body.path }, auth)).status).toBe(200);
});

it.each([false, true])('ticket issuance never reads cleanup state, including quota rejection (%s)', async (full) => {
  if (full) store.docs.set('privateFileQuota/global', { reservedBytes: 900 * 1024 * 1024 });
  const collections = vi.spyOn(store.db, 'collection');
  const scan = vi.spyOn(store.db, 'collectionGroup');
  const result = await invoke(runtime, { action: 'upload', path: ANSWER, contentType: 'application/pdf', byteSize: 1 });
  expect(result.status).toBe(full ? 507 : 200);
  expect(collections.mock.calls.flat()).not.toContain('privateFileCleanup');
  expect(scan).not.toHaveBeenCalled();
  expect([...store.docs.keys()].some((key) => key.startsWith('privateFileCleanup/'))).toBe(false);
});

it('records the claimed reference and rejects a different document namespace', async () => {
  const upload = await invoke(runtime, { action: 'upload', path: ANSWER, contentType: 'application/pdf', byteSize: 1 });
  put(upload, 'answer');
  await invoke(runtime, { action: 'finalize', path: ANSWER });
  expect((await invoke(runtime, { action: 'claim', path: ANSWER, reference: 'groups/other' })).status).toBe(403);
  const reference = 'groups/course/assignments/work/submissions/alice';
  expect((await invoke(runtime, { action: 'claim', path: ANSWER, reference })).status).toBe(200);
  expect([...store.docs.values()].find((row) => row.path === ANSWER)?.refs).toEqual([reference]);
});
