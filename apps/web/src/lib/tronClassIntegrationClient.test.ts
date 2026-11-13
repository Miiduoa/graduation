import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTronClassClient,
  safeTronClassHref,
  TronClassRequestError,
} from './tronClassIntegrationClient';

afterEach(() => vi.unstubAllGlobals());

describe('TronClass client response boundary', () => {
  it.each(['status', 'sync', 'prepare'] as const)(
    'rejects an empty successful response for %s',
    async (action) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}')),
      );
      const client = createTronClassClient({ kind: 'platform', context: 'context' });
      const result = action === 'prepare' ? client.prepare(1, 2) : client[action]();
      await expect(result).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    },
  );

  it('preserves a server error without reducing it to a successful empty record', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'TRONCLASS_RECONNECT_REQUIRED',
              message: '請重新連接學校帳號。',
            }),
            { status: 401 },
          ),
      ),
    );
    const client = createTronClassClient({ kind: 'platform', context: 'context' });
    await expect(client.status()).rejects.toEqual(
      new TronClassRequestError('TRONCLASS_RECONNECT_REQUIRED', '請重新連接學校帳號。', 401),
    );
  });

  it('allows only the school TronClass origin in source links', () => {
    expect(safeTronClassHref('https://tronclass.pu.edu.tw/course/123')).toBe(
      'https://tronclass.pu.edu.tw/course/123',
    );
    for (const href of [
      'javascript:alert(1)',
      'https://tronclass.pu.edu.tw.evil.test/course/123',
      'https://user:pass@tronclass.pu.edu.tw/course/123',
      'http://tronclass.pu.edu.tw/course/123',
    ])
      expect(safeTronClassHref(href)).toBeNull();
  });
});
