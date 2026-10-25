import { afterEach, expect, it, vi } from 'vitest';
import { platformFetch } from './platformFetch';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('sends JSON with credentials to forwarded platform endpoints', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const result = await platformFetch('/auth/platform/school-applications/app-1/decision', {
    decision: 'approve',
  });
  expect(result.ok).toBe(true);
  expect(fetcher).toHaveBeenCalledWith(
    '/auth/platform/school-applications/app-1/decision',
    expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    }),
  );
});
