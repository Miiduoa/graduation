// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FunctionsUnconfiguredError } from './functionsUrl';
import { downloadPrivateFile, privateFilesEnabled, uploadPrivateFile } from './privateFiles';

const runtime = vi.hoisted(() => ({
  user: null as null | { uid: string; getIdToken: () => Promise<string> },
}));

vi.mock('./firebase', () => ({
  getAuth: () => ({ currentUser: runtime.user }),
}));

beforeEach(() => {
  runtime.user = { uid: 'alice', getIdToken: vi.fn().mockResolvedValue('alice-token') };
  delete process.env.NEXT_PUBLIC_FILE_STORAGE_BACKEND;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FILE_STORAGE_BACKEND;
  vi.unstubAllGlobals();
});

it('does not call the network when R2 is not enabled', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  expect(privateFilesEnabled()).toBe(false);
  await expect(downloadPrivateFile('groups/course/posts/one/notes.pdf')).rejects.toBeInstanceOf(
    FunctionsUnconfiguredError,
  );
  await expect(
    uploadPrivateFile({
      path: 'assignments/work/submissions/alice/answer.pdf',
      body: new Uint8Array([1, 2, 3]),
      contentType: 'application/pdf',
    }),
  ).rejects.toBeInstanceOf(FunctionsUnconfiguredError);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('uploads through a presigned ticket when R2 is enabled', async () => {
  process.env.NEXT_PUBLIC_FILE_STORAGE_BACKEND = 'r2';
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/files/private') {
      return new Response(
        JSON.stringify({
          path: 'assignments/work/submissions/alice/answer.pdf',
          url: 'http://127.0.0.1/object',
          method: 'PUT',
          headers: { 'content-type': 'application/pdf' },
          expiresAt: '2026-11-09T00:00:00.000Z',
          maxBytes: 50 * 1024 * 1024,
        }),
        { status: 200 },
      );
    }
    expect(url).toBe('http://127.0.0.1/object');
    expect(init?.method).toBe('PUT');
    return new Response(null, { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  await expect(
    uploadPrivateFile({
      path: 'assignments/work/submissions/alice/answer.pdf',
      body: new Uint8Array([1, 2, 3, 4]),
      contentType: 'application/pdf',
    }),
  ).resolves.toEqual({ path: 'assignments/work/submissions/alice/answer.pdf' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('surfaces 429 with a Chinese message without automatic retries', async () => {
  process.env.NEXT_PUBLIC_FILE_STORAGE_BACKEND = 'r2';
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Too many uploads' }), { status: 429 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(uploadPrivateFile({ path: 'groups/course/assignments/work/submissions/alice/answer.pdf', body: new Uint8Array([1]), contentType: 'application/pdf' })).rejects.toMatchObject({ statusCode: 429, message: '上傳太頻繁，請稍後再試' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
