// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createSupabaseFileStorage, getFileStorage } from './fileStorage';
import { dispatchPrivateFileRequest } from './privateFileRoutes';

vi.mock('server-only', () => ({}));
const config = { backend: 'supabase' as const, url: 'https://storage.example', bucket: 'private', serviceRoleKey: 'test-service-secret', presignTtlSeconds: 600 };

it('calls Storage with service credentials, disables upsert and bounds download TTL', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-service-secret');
    if (url.pathname.includes('/upload/sign/')) {
      expect(new Headers(init?.headers).get('x-upsert')).not.toBe('true');
      return new Response(JSON.stringify({ url: '/object/upload/sign/private/a.pdf?token=upload' }));
    }
    expect(JSON.parse(String(init?.body))).toEqual({ expiresIn: 60 });
    return new Response(JSON.stringify({ signedURL: '/object/sign/private/a.pdf?token=download' }));
  });
  const storage = createSupabaseFileStorage(config, fetchMock);
  const now = new Date('2026-11-09T00:00:00Z');
  const upload = await storage.presignPut({ key: 'a.pdf', contentType: 'application/pdf', contentLength: 8, now });
  expect(upload.expiresAt).toBe('2026-11-09T02:00:00.000Z');
  expect(upload.headers).not.toHaveProperty('content-length');
  const download = await storage.presignGet({ key: 'a.pdf', attachment: true, now });
  expect(new URL(download.url).searchParams.get('download')).toBe('a.pdf');
  expect(download.expiresAt).toBe('2026-11-09T00:01:00.000Z');
  expect(JSON.stringify([upload, download])).not.toContain(config.serviceRoleKey);
});

it('returns 503 for unset backend or any missing variable', async () => {
  const env = { FILE_STORAGE_BACKEND: 'supabase', SUPABASE_URL: config.url, SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey, SUPABASE_STORAGE_BUCKET: config.bucket };
  for (const key of Object.keys(env)) {
    const storage = getFileStorage({ ...env, [key]: '' });
    expect(storage).toBeNull();
    const response = await dispatchPrivateFileRequest(new Request('https://nuni.tw/api/files/private', { method: 'POST' }), null);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(config.serviceRoleKey);
  }
});

it('sanitizes upstream errors containing credentials', async () => {
  const storage = createSupabaseFileStorage(config, async () => new Response(JSON.stringify({ message: config.serviceRoleKey }), { status: 500 }));
  await expect(storage.presignPut({ key: 'a.pdf', contentType: 'application/pdf', contentLength: 8 })).rejects.toThrow('File storage request failed');
});

it.each(['%2e%2e', '%2E%2E', '%252e%252e', '..%2f', '?x', '#x', '\\', '．．', 'a b', 'a\n', 'a..b'])('rejects unsafe keys before SDK fetch: %j', async (part) => {
  const fetchMock = vi.fn<typeof fetch>();
  const storage = createSupabaseFileStorage(config, fetchMock);
  for (const key of [`groups/g/posts/${part}/cover.png`, `groups/g/posts/p/${part}`]) {
    await expect(storage.presignPut({ key, contentType: 'image/png', contentLength: 8 })).rejects.toThrow('Invalid file storage path');
    await expect(storage.presignGet({ key })).rejects.toThrow('Invalid file storage path');
    await expect(storage.head(key)).rejects.toThrow('Invalid file storage path');
    await expect(storage.remove(key)).rejects.toThrow('Invalid file storage path');
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

it('keeps the real SDK request and signed URL on the authorized object path', async () => {
  const key = 'groups/g/posts/post_1/0-notes.pdf';
  const expected = `/private/${key}`;
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const operation = url.pathname.includes('/upload/sign/') ? 'upload/sign' : 'sign';
    expect(url.pathname).toBe(`/storage/v1/object/${operation}${expected}`);
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    return new Response(JSON.stringify(operation === 'upload/sign'
      ? { url: `/object/upload/sign${expected}?token=upload` }
      : { signedURL: `/object/sign${expected}?token=download` }));
  });
  const storage = createSupabaseFileStorage(config, fetchMock);
  await storage.presignPut({ key, contentType: 'application/pdf', contentLength: 8 });
  await storage.presignGet({ key });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each(['/object/upload/sign/private/other.pdf?token=x', '/object/upload/sign/private/%2e%2e/other.pdf?token=x'])('rejects a mismatching signed object URL %s', async (url) => {
  const storage = createSupabaseFileStorage(config, async () => new Response(JSON.stringify({ url })));
  await expect(storage.presignPut({ key: 'a.pdf', contentType: 'application/pdf', contentLength: 8 })).rejects.toThrow('Invalid file storage path');
});

it('keeps real SDK info and delete requests within the validated bucket', async () => {
  const key = 'groups/g/posts/post_1/notes.pdf';
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method === 'DELETE') {
      expect(url.pathname).toBe('/storage/v1/object/private');
      expect(await request.json()).toEqual({ prefixes: [key] });
      return new Response('[]');
    }
    expect(url.pathname).toBe(`/storage/v1/object/info/private/${key}`);
    return new Response(JSON.stringify({ content_type: 'application/pdf', size: 8 }));
  });
  const storage = createSupabaseFileStorage(config, fetchMock);
  await expect(storage.head(key)).resolves.toMatchObject({ contentType: 'application/pdf', contentLength: 8 });
  await storage.remove(key);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('stores original display names separately from the object key', async () => {
  const storage = createSupabaseFileStorage(config, async () => new Response(JSON.stringify({ url: '/object/upload/sign/private/random.pdf?token=x' })));
  const signed = await storage.presignPut({ key: 'random.pdf', contentType: 'application/pdf', contentLength: 8, metadata: { originalFilename: '原始 檔名..pdf' } });
  expect(JSON.parse(Buffer.from(signed.headers['x-metadata'], 'base64').toString('utf8'))).toEqual({ originalFilename: '原始 檔名..pdf' });
  expect(new URL(signed.url).pathname).toBe('/storage/v1/object/upload/sign/private/random.pdf');
});
