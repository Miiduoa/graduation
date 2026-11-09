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

it('does not call the network when Supabase is not enabled', async () => {
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

it('uploads through a presigned ticket when Supabase is enabled', async () => {
  process.env.NEXT_PUBLIC_FILE_STORAGE_BACKEND = 'supabase';
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
  process.env.NEXT_PUBLIC_FILE_STORAGE_BACKEND = 'supabase';
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Too many uploads' }), { status: 429 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(uploadPrivateFile({ path: 'groups/course/assignments/work/submissions/alice/answer.pdf', body: new Uint8Array([1]), contentType: 'application/pdf' })).rejects.toMatchObject({ statusCode: 429, message: '上傳太頻繁，請稍後再試' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(['r2', '', 'firebase'])('rejects the unsupported backend %s', (backend) => {
  expect(privateFilesEnabled(backend)).toBe(false);
});

it.each([200, 400, 413, 429, 503])('requires successful finalization before returning the new path (%s)', async (status) => {
  process.env.NEXT_PUBLIC_FILE_STORAGE_BACKEND = 'supabase';
  const path = 'groups/g/cover.12345678-1234-1234-1234-123456789abc.png';
  let finish!: (response: Response) => void;
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ path, url: 'https://project.supabase.co/upload', method: 'POST', headers: { 'x-upsert': 'false', 'content-type': 'image/png' }, expiresAt: 'later', requiresFinalize: true })))
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  let settled = false;
  const upload = uploadPrivateFile({ path: 'groups/g/cover.png', body: new Blob(['image']), contentType: 'image/png' });
  void upload.then(() => { settled = true; }, () => { settled = true; });
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(settled).toBe(false);
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', headers: { 'x-upsert': 'false', 'content-type': 'image/png' } });
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ action: 'finalize', path });
  expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer alice-token');
  finish(new Response(JSON.stringify(status === 200 ? { path, finalized: true } : { error: 'Invalid file' }), { status }));
  if (status === 200) await expect(upload).resolves.toEqual({ path });
  else await expect(upload).rejects.toMatchObject({ statusCode: status, ...(status === 429 ? { message: '上傳太頻繁，請稍後再試' } : {}) });
});

it.each([412, 429])('does not finalize failed object uploads (%s)', async (status) => {
  process.env.NEXT_PUBLIC_FILE_STORAGE_BACKEND = 'supabase';
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ path: 'groups/g/cover.png', url: 'https://project.supabase.co/upload', method: 'PUT', headers: {}, expiresAt: 'later', requiresFinalize: true })))
    .mockResolvedValueOnce(new Response(null, { status }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(uploadPrivateFile({ path: 'groups/g/cover.png', body: new Blob(['image']), contentType: 'image/png' })).rejects.toThrow(status === 412 ? 'File already exists or changed' : '上傳太頻繁，請稍後再試');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each([200, 410])('claims only the target document namespace and propagates expiry (%s)', async (status) => {
  process.env.NEXT_PUBLIC_FILE_STORAGE_BACKEND = 'supabase';
  const path = 'groups/course/posts/one/notes.pdf';
  const network = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ path, claimed: true }), { status }));
  vi.stubGlobal('fetch', network);
  const { claimPrivateFile } = await import('./privateFiles');
  await expect(claimPrivateFile(path, 'groups/course/posts/two')).rejects.toThrow('附件不屬於此文件');
  expect(network).not.toHaveBeenCalled();
  if (status === 200) await expect(claimPrivateFile(path, 'groups/course/posts/one')).resolves.toBeUndefined();
  else await expect(claimPrivateFile(path, 'groups/course/posts/one')).rejects.toMatchObject({ statusCode: 410 });
  expect(JSON.parse(network.mock.calls[0][1]!.body as string)).toMatchObject({ action: 'claim', path });
});

it.each([
  ['groups/g/posts/p/file.pdf', 'groups/g/posts/p', 'groups/g/posts/other'],
  ['groups/g/assignments/a/submissions/u/file.pdf', 'groups/g/assignments/a/submissions/u', 'groups/g/assignments/a/submissions/other'],
  ['groups/g/cover.old.jpg', 'groups/g', 'groups/other'],
  ['schools/s/stories/story/image.jpg', 'schools/s/stories/story', 'schools/s/stories/other'],
])('allows only the owning container for %s', async (path, own, other) => {
  const { assertPrivateFileNamespace } = await import('./privateFiles');
  expect(() => assertPrivateFileNamespace(path, own)).not.toThrow();
  expect(() => assertPrivateFileNamespace(path, other)).toThrow('附件不屬於此文件');
  expect(() => assertPrivateFileNamespace('groups/g/cover.old.jpg', 'groups/g/posts/p')).toThrow('附件不屬於此文件');
});
