// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
let handlers: Record<string, (event: Record<string, unknown>) => void>;
let fetchMock: ReturnType<typeof vi.fn>;
let cache: { match: ReturnType<typeof vi.fn>; addAll: ReturnType<typeof vi.fn> };
let cachesMock: {
  open: ReturnType<typeof vi.fn>;
  keys: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  handlers = {};
  fetchMock = vi.fn();
  cache = { match: vi.fn(), addAll: vi.fn().mockResolvedValue(undefined) };
  cachesMock = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  vm.runInNewContext(source, {
    URL,
    Response,
    fetch: fetchMock,
    caches: cachesMock,
    self: {
      location: { origin: 'https://campus.test' },
      addEventListener: (name: string, handler: (typeof handlers)[string]) => {
        handlers[name] = handler;
      },
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn() },
    },
  });
});
it('never intercepts API, account data fetches, or uploaded file downloads', () => {
  for (const path of ['/api/me', '/course/private?_rsc=1', '/uploads/private.pdf']) {
    const respondWith = vi.fn();
    handlers.fetch({
      request: { method: 'GET', url: `https://campus.test${path}`, mode: 'cors' },
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
  }
  expect(cachesMock.open).not.toHaveBeenCalled();
});
it('does not serve previous account pages from cache', async () => {
  const response = new Response('Current account');
  fetchMock.mockResolvedValue(response);
  const respondWith = vi.fn();
  handlers.fetch({
    request: { method: 'GET', url: 'https://campus.test/course/private', mode: 'navigate' },
    respondWith,
  });
  expect(await respondWith.mock.calls[0][0]).toBe(response);
  expect(cachesMock.open).not.toHaveBeenCalled();
});
it('returns an offline page on a failed navigation, even when cache is empty', async () => {
  fetchMock.mockRejectedValue(new Error('offline'));
  const respondWith = vi.fn();
  handlers.fetch({
    request: { method: 'GET', url: 'https://campus.test/', mode: 'navigate' },
    respondWith,
  });
  const response = await respondWith.mock.calls[0][0];
  expect(response.status).toBe(503);
  expect(await response.text()).toContain('沒有網路');
  expect(cache.match).toHaveBeenCalledWith('/offline.html');
});
it('purges legacy account and API caches when activating', async () => {
  cachesMock.keys.mockResolvedValue([
    'campus-static-v2',
    'campus-dynamic-v1.0.0',
    'campus-api-v1.0.0',
    'other-app',
  ]);
  const waitUntil = vi.fn();
  handlers.activate({ waitUntil });
  await waitUntil.mock.calls[0][0];
  expect(cachesMock.delete.mock.calls.map(([key]) => key)).toEqual([
    'campus-dynamic-v1.0.0',
    'campus-api-v1.0.0',
  ]);
});
it('preloads only existing public files and ignores arbitrary cache requests', async () => {
  const waitUntil = vi.fn();
  handlers.install({ waitUntil });
  await waitUntil.mock.calls[0][0];
  const paths: string[] = cache.addAll.mock.calls[0][0];
  for (const path of paths)
    expect(readFileSync(new URL(`../../public${path}`, import.meta.url)).length).toBeGreaterThan(0);
  cache.addAll.mockClear();
  handlers.message({ data: { type: 'CACHE_URLS', urls: ['/api/me'] }, waitUntil });
  expect(cache.addAll).not.toHaveBeenCalled();
});
