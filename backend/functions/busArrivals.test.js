const { readRealtimeBusCache } = require('./busArrivals');

const now = Date.parse('2026-10-08T01:00:00Z');
function cache(overrides = {}) {
  return {
    source: 'tdx',
    isRealtime: true,
    cachedAt: { toMillis: () => now - 1000 },
    fetchedAt: new Date(now - 1000).toISOString(),
    arrivals: [{ stopId: 'stop-1' }],
    ...overrides,
  };
}

test('only a recent cache with explicit realtime provenance is reused', () => {
  expect(readRealtimeBusCache(cache(), now)).toMatchObject({
    source: 'tdx',
    isRealtime: true,
    fromCache: true,
  });
});

test.each([
  { source: undefined },
  { source: 'static' },
  { isRealtime: false },
  { fetchedAt: undefined },
  { fetchedAt: new Date(now - 60_000).toISOString() },
  { fetchedAt: new Date(now + 1000).toISOString() },
  { cachedAt: { toMillis: () => now - 60_000 } },
  { arrivals: null },
])('does not relabel old, static, expired or malformed caches as realtime: %j', (overrides) => {
  expect(readRealtimeBusCache(cache(overrides), now)).toBeNull();
});
