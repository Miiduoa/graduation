import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('web readiness', () => {
  it('does not require a legacy process for standalone installations', async () => {
    vi.stubEnv('CAMPUS_LEGACY_ENABLED', 'false');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ready', legacy: 'disabled' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('only reports ready after the pinned legacy web process responds', async () => {
    vi.stubEnv('CAMPUS_LEGACY_ENABLED', 'true');
    vi.stubEnv('CAMPUS_RELEASE_SHA', 'a'.repeat(40));
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ status: 'ok', service: 'campus-web' }));
    vi.stubGlobal('fetch', fetcher);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({ revision: 'a'.repeat(40), legacy: 'ready' });
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/health/live',
      expect.objectContaining({
        redirect: 'error',
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each(['wrong-service', 'error-response', 'network-error', 'invalid-json'])(
    'rejects an unavailable legacy process: %s',
    async (failure) => {
      vi.stubEnv('CAMPUS_LEGACY_ENABLED', 'true');
      vi.stubEnv('CAMPUS_RELEASE_SHA', 'untrusted-value');
      const fetcher = vi.fn();
      if (failure === 'network-error') fetcher.mockRejectedValue(new Error('unavailable'));
      else if (failure === 'error-response')
        fetcher.mockResolvedValue(new Response(null, { status: 500 }));
      else if (failure === 'invalid-json') fetcher.mockResolvedValue(new Response('invalid'));
      else fetcher.mockResolvedValue(Response.json({ status: 'ok', service: 'other' }));
      vi.stubGlobal('fetch', fetcher);
      const response = await GET();
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        status: 'unavailable',
        legacy: 'unavailable',
        revision: null,
      });
    },
  );
});
