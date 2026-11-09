// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { createMemoryGroupStore } from './memoryGroupStore';
import { dispatchPrivateFileRequest, type PrivateFileRuntime } from './privateFileRoutes';
import { resetPrivateFileRateLimitForTests } from './privateFileRateLimit';

beforeEach(resetPrivateFileRateLimitForTests);

function setup() {
  const store = createMemoryGroupStore([
    ['users/alice', {}],
    ['groups/course', { schoolId: 'pu' }],
    ['groups/course/members/alice', { status: 'active', role: 'member' }],
    ['schools/pu/members/alice', { status: 'active' }],
    ['groups/course/assignments/work', { status: 'published' }],
    ['assignments/work', { groupId: 'course' }],
  ]);
  const signed = { url: 'https://storage.example/file', method: 'PUT', headers: {}, expiresAt: '2026-11-09T00:01:00Z' };
  const storage = {
    head: vi.fn(async () => ({ contentType: 'application/pdf', contentLength: 8, metadata: {} })),
    presignPut: vi.fn(() => signed),
    presignGet: vi.fn(() => ({ ...signed, method: 'GET' })),
  };
  const runtime = { db: store.db, verifyIdToken: async () => ({ uid: 'alice' }), storage } as unknown as PrivateFileRuntime;
  return { runtime, storage };
}

async function invoke(runtime: PrivateFileRuntime, action: string, path: string, contentType = 'application/pdf') {
  return dispatchPrivateFileRequest(new Request('https://nuni.tw/api/files/private', {
    method: 'POST', headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, path, contentType, byteSize: 8 }),
  }), runtime);
}

it.each(['upload', 'download'])('rejects legacy %s before storage access', async action => {
  const { runtime, storage } = setup();
  const response = await invoke(runtime, action, 'assignments/work/submissions/alice/answer.pdf');
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: '不支援舊版作業附件路徑' });
  expect(storage.head).not.toHaveBeenCalled();
  expect(storage.presignPut).not.toHaveBeenCalled();
  expect(storage.presignGet).not.toHaveBeenCalled();
});

it.each(['upload', 'download'])('allows group assignment %s', async action => {
  const { runtime } = setup();
  expect((await invoke(runtime, action, 'groups/course/assignments/work/submissions/alice/answer.pdf')).status).toBe(200);
});

it.each(['image/svg+xml', 'text/html', 'application/xhtml+xml', 'application/javascript', 'text/javascript'])('rejects executable MIME %s', async contentType => {
  const { runtime, storage } = setup();
  expect((await invoke(runtime, 'upload', 'groups/course/assignments/work/submissions/alice/answer.pdf', contentType)).status).toBe(400);
  expect(storage.presignPut).not.toHaveBeenCalled();
});
