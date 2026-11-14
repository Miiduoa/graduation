// @vitest-environment node
import { afterEach, it, expect, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it('caches and coalesces actual public route responses by canonical school without changing visitor access', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        '<div class="d-txt"><a href="/p/406-1102-1.php">實習申請2026/12/8截止</a></div>',
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  const { GET } = await import('./route');
  const responses = await Promise.all(
    ['pu', 'tw-pu', 'pu'].map((s) => GET(new Request(`https://nuni.tw/career/data?school=${s}`))),
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
  const feeds = await Promise.all(responses.map((r) => r.json()));
  expect(feeds[0]).toEqual(feeds[1]);
  expect(responses[0].headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(responses[0].headers.get('Cache-Control')).toBe('public, max-age=30, s-maxage=30');
  const unknown = await GET(new Request('https://nuni.tw/career/data?school=other'));
  expect((await unknown.json()).supported).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
