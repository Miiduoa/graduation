import { afterEach, expect, it, vi } from 'vitest';
import { adminFetch, platformFetch } from './platformFetch';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('sends an explicit POST with JSON to Campus One nuni BFF', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const result = await platformFetch(
    'class-workspaces/cw_11111111-1111-4111-8111-111111111111/invites',
    'POST',
    { maxUses: 100, idempotencyKey: 'web-invite-test-key' },
    'a'.repeat(43),
  );
  expect(result.ok).toBe(true);
  expect(fetcher).toHaveBeenCalledWith(
    '/api/nuni/class-workspaces/cw_11111111-1111-4111-8111-111111111111/invites',
    expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ maxUses: 100, idempotencyKey: 'web-invite-test-key' }),
    }),
  );
  expect(fetcher.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
  expect(fetcher.mock.calls[0][1].headers['X-Campus-Session']).toBe('a'.repeat(43));
});

it('posts empty JSON for no-field writes instead of omitting the body', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  await platformFetch(
    'class-workspaces/cw_11111111-1111-4111-8111-111111111111/classroom-sessions/cws_1/check-in',
    'POST',
    {},
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: 'POST',
    body: '{}',
    headers: { 'Content-Type': 'application/json' },
  });
});

it('keeps GET without a JSON body', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ sessions: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  await platformFetch(
    'class-workspaces/cw_11111111-1111-4111-8111-111111111111/classroom-sessions',
    'GET',
  );
  expect(fetcher.mock.calls[0][1].method).toBe('GET');
  expect(fetcher.mock.calls[0][1].body).toBeUndefined();
  expect(fetcher.mock.calls[0][1].headers?.['Content-Type']).toBeUndefined();
});

it('sends admin writes to platform-admin, not the old BFF', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  await adminFetch(
    'school-applications/app-1/decision',
    'POST',
    { decision: 'approve', reason: 'ok', idempotencyKey: 'key-123456' },
    'b'.repeat(43),
  );
  expect(fetcher).toHaveBeenCalledWith(
    '/api/platform-admin/school-applications/app-1/decision',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        decision: 'approve',
        reason: 'ok',
        idempotencyKey: 'key-123456',
      }),
    }),
  );
});
