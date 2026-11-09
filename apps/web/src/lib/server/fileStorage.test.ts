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
