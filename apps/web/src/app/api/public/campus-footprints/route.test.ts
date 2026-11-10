import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const libraryOutline = [
  { lat: 24.22624, lon: 120.58131 },
  { lat: 24.22624, lon: 120.58143 },
  { lat: 24.22634, lon: 120.58143 },
  { lat: 24.22634, lon: 120.58131 },
  { lat: 24.22624, lon: 120.58131 },
];
const osmPayload = JSON.stringify({
  elements: [{ type: 'way', id: 255784049, geometry: libraryOutline, tags: { building: 'yes' },
    version: 7, timestamp: '2026-10-15T08:09:10Z', user: 'editor-name', uid: 22 }],
});

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('public Providence building geometry route', () => {
  it('queries only a fixed set of OSM building ways and caches the inspected outlines', async () => {
    const mockedFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      text: async () => osmPayload,
    });
    vi.stubGlobal('fetch', mockedFetch);
    const { GET } = await import('./route');
    const first = await GET();
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.schoolId).toBe('pu');
    expect(body.buildings).toHaveLength(1);
    expect(body.buildings[0]).toMatchObject({
      poiId: 'pu-library', osmVersion: 7, osmEditedAt: '2026-10-15T08:09:10Z',
    });
    expect(JSON.stringify(body)).not.toContain('editor-name');
    expect(body.buildings[0]).not.toHaveProperty('uid');
    expect(body.stale).toBe(false);
    expect(body.osmBaseAt).toBeNull(); // Legacy Overpass responses omit replication metadata.
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const called = new URL(mockedFetch.mock.calls[0][0]);
    expect(called.hostname).toBe('overpass-api.de');
    const query = called.searchParams.get('data')!;
    expect(query).toContain('way(id:');
    expect(query).toContain('255784049');
    expect(query).toContain('out meta geom;');
    expect(query).not.toContain('295686299'); // 未交叉確認的停車場
    const second = await GET();
    expect(second.status).toBe(200);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('limits shared-cache freshness to the remaining lifetime of the 24-hour OSM snapshot', async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      // Each real fetch has a new single-use response body; reusing one mock Response
      // makes the second refresh fail with "Body is unusable" and masks cache behavior.
      const upstream = vi.fn().mockImplementation(async () =>
        new Response(osmPayload, { status: 200 }));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');
      const initial = await GET();
      expect(initial.status).toBe(200);
      expect(initial.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=3600');
      const initialFetchedAt = (await initial.json()).fetchedAt;

      // A hit ten seconds before expiry cannot extend the CDN TTL by an hour.
      clock.mockReturnValue(start + 24 * 60 * 60 * 1000 - 10_000);
      const nearExpiry = await GET();
      expect(nearExpiry.status).toBe(200);
      expect(nearExpiry.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=10');
      expect((await nearExpiry.json()).stale).toBe(false);
      expect(upstream).toHaveBeenCalledTimes(1);

      // Once expired the origin must query again rather than hand out a fresh label.
      clock.mockReturnValue(start + 24 * 60 * 60 * 1000 + 1_000);
      const refreshed = await GET();
      expect(refreshed.status).toBe(200);
      expect(refreshed.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=3600');
      const updatedSnapshot = await refreshed.json();
      expect(updatedSnapshot.stale).toBe(false);
      expect(updatedSnapshot.fetchedAt).not.toBe(initialFetchedAt);
      expect(upstream).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('does not cache or serve a former building whose OSM way no longer has a building tag', async () => {
    const invalidPayload = JSON.stringify({
      elements: [{ type: 'way', id: 255784049, geometry: libraryOutline,
        tags: { landuse: 'grass', 'demolished:building': 'yes' } }],
    });
    const mockedFetch = vi.fn().mockResolvedValue(new Response(invalidPayload, { status: 200 }));
    vi.stubGlobal('fetch', mockedFetch);
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/temporarily unavailable/);
    expect((await GET()).status).toBe(503);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('does not cache contradictory demolished building metadata as a campus volume', async () => {
    const contradictory = JSON.stringify({
      elements: [{
        type: 'way', id: 255784049, geometry: libraryOutline,
        tags: { building: 'yes', 'demolished:building': 'yes' },
      }],
    });
    const mockedFetch = vi.fn().mockResolvedValue(new Response(contradictory, { status: 200 }));
    vi.stubGlobal('fetch', mockedFetch);
    const { GET } = await import('./route');
    const first = await GET();
    expect(first.status).toBe(503);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect((await first.json()).error).toMatch(/temporarily unavailable/);
    expect((await GET()).status).toBe(503);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('does not cache a building=yes way explicitly marked ruins=yes', async () => {
    const ruinedPayload = JSON.stringify({
      elements: [{
        type: 'way', id: 255784049, geometry: libraryOutline,
        tags: { building: 'yes', ruins: 'yes', height: '20' },
      }],
    });
    const upstream = vi.fn().mockResolvedValue(new Response(ruinedPayload, { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const result = await GET();
    expect(result.status).toBe(503);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect((await result.json()).error).toMatch(/temporarily unavailable/);
    await GET();
    expect(upstream).toHaveBeenCalledTimes(1); // Retain the existing upstream cooldown.
  });

  it('uses recent Overpass database replication metadata without confusing it with a way edit', async () => {
    const baseTime = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000).toISOString()
      .replace('.000Z', 'Z');
    const payload = JSON.stringify({
      osm3s: { timestamp_osm_base: baseTime },
      ...JSON.parse(osmPayload),
    });
    const upstream = vi.fn().mockResolvedValue(new Response(payload, { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(200);
    const snapshot = await response.json();
    expect(snapshot.stale).toBe(false);
    expect(snapshot.osmBaseAt).toBe(baseTime);
    expect(snapshot.buildings).toHaveLength(1);
    expect(snapshot.buildings[0].osmEditedAt).toBe('2026-10-15T08:09:10Z');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('expires fresh cache when Overpass replication becomes 48 hours old, not 24 hours after fetch', async () => {
    const start = Math.floor(Date.now() / 1000) * 1000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      // The database is already 47h30m behind when the HTTP fetch succeeds.
      // A 24-hour cache would incorrectly claim that 71h-old geometry is fresh.
      const baseTime = new Date(start - (47 * 60 + 30) * 60_000)
        .toISOString().replace('.000Z', 'Z');
      const payload = JSON.stringify({
        osm3s: { timestamp_osm_base: baseTime },
        ...JSON.parse(osmPayload),
      });
      const upstream = vi.fn().mockImplementation(async () => new Response(payload, { status: 200 }));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');
      const first = await GET();
      expect(first.status).toBe(200);
      expect(first.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=1800');
      const firstBody = await first.json();
      expect(firstBody.stale).toBe(false);
      expect(firstBody.osmBaseAt).toBe(baseTime);

      clock.mockReturnValue(start + 20 * 60_000);
      const stillFresh = await GET();
      expect(stillFresh.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=600');
      expect((await stillFresh.json()).stale).toBe(false);
      expect(upstream).toHaveBeenCalledTimes(1);

      // A new request after the 48h deadline must revalidate upstream. If
      // replication is still delayed, preserve the dated outline as stale.
      clock.mockReturnValue(start + 30 * 60_000 + 1_000);
      const fallback = await GET();
      expect(fallback.status).toBe(200);
      expect(fallback.headers.get('Cache-Control')).toBe('private, no-store');
      const fallbackBody = await fallback.json();
      expect(fallbackBody.stale).toBe(true);
      expect(fallbackBody.fetchedAt).toBe(firstBody.fetchedAt);
      expect(fallbackBody.osmBaseAt).toBe(baseTime);
      expect(upstream).toHaveBeenCalledTimes(2);
      // The failed refresh must activate the existing cooldown.
      await GET();
      expect(upstream).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('stops stale fallback at seven days from OSM replication, not only the HTTP fetch', async () => {
    const day = 24 * 60 * 60 * 1000;
    const start = Math.floor(Date.now() / 1000) * 1000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      // The reply was fetched today, but the OSM data was already 47 hours old.
      const baseTime = new Date(start - 47 * 60 * 60 * 1000)
        .toISOString().replace('.000Z', 'Z');
      const payload = JSON.stringify({
        osm3s: { timestamp_osm_base: baseTime },
        ...JSON.parse(osmPayload),
      });
      const upstream = vi.fn()
        .mockResolvedValueOnce(new Response(payload, { status: 200 }))
        .mockRejectedValue(new Error('Overpass offline'));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');
      const fresh = await GET();
      expect(fresh.status).toBe(200);
      expect((await fresh.json()).osmBaseAt).toBe(baseTime);

      const expiry = Date.parse(baseTime) + 7 * day;
      // The response is less than seven days old, but the source is almost seven.
      expect(expiry - start).toBeLessThan(7 * day);
      clock.mockReturnValue(expiry - 1);
      const stale = await GET();
      expect(stale.status).toBe(200);
      expect(stale.headers.get('Cache-Control')).toBe('private, no-store');
      expect((await stale.json()).stale).toBe(true);
      expect(upstream).toHaveBeenCalledTimes(2);

      // Do not keep serving the old building through a subsequent cooldown hit.
      clock.mockReturnValue(expiry);
      const expired = await GET();
      expect(expired.status).toBe(503);
      expect(expired.headers.get('Cache-Control')).toBe('no-store');
      expect((await expired.json()).error).toMatch(/temporarily unavailable/);
      expect(upstream).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('does not promote a days-old Overpass database state into a new fresh snapshot', async () => {
    const baseTime = new Date(Math.floor(Date.now() / 1000) * 1000 - 3 * 24 * 60 * 60 * 1000)
      .toISOString().replace('.000Z', 'Z');
    const payload = JSON.stringify({
      osm3s: { timestamp_osm_base: baseTime },
      ...JSON.parse(osmPayload),
    });
    const upstream = vi.fn().mockResolvedValue(new Response(payload, { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const first = await GET();
    expect(first.status).toBe(503);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect((await first.json()).error).toMatch(/temporarily unavailable/);
    expect((await GET()).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('fails closed on implausible future or malformed Overpass replication metadata', async () => {
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      osm3s: { timestamp_osm_base: '2099-01-01T00:00:00Z' },
      ...JSON.parse(osmPayload),
    }), { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const first = await GET();
    expect(first.status).toBe(503);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('reads a real streamed Overpass response and sends an identifiable service header', async () => {
    const mockedFetch = vi.fn().mockResolvedValue(new Response(osmPayload, {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', mockedFetch);
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).buildings).toHaveLength(1);
    expect(mockedFetch.mock.calls[0][1].headers['User-Agent']).toContain('nuni.tw');
  });

  it('does not cache an HTTP 200 response containing duplicate whitelisted OSM way IDs', async () => {
    const original = JSON.parse(osmPayload).elements[0];
    const duplicate = { ...original, tags: { building: 'yes', height: '90' } };
    const payload = JSON.stringify({ elements: [original, duplicate] });
    const mockedFetch = vi.fn().mockResolvedValue(new Response(payload, { status: 200 }));
    vi.stubGlobal('fetch', mockedFetch);
    const { GET } = await import('./route');
    const first = await GET();
    expect(first.status).toBe(503);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect((await first.json()).error).toMatch(/temporarily unavailable/);
    // A malformed duplicate cannot become a cached 24-hour campus volume.
    expect((await GET()).status).toBe(503);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a partial Overpass JSON result even when the service returns HTTP 200', async () => {
    // Overpass can return 200 + elements + remark on query timeout/memory exhaustion.
    // The partial collection must never become a successful 24-hour cache entry.
    const partial = JSON.stringify({
      ...JSON.parse(osmPayload),
      remark: 'runtime error: Query timed out in "query"',
    });
    const mockedFetch = vi.fn().mockResolvedValue(new Response(partial, { status: 200 }));
    vi.stubGlobal('fetch', mockedFetch);
    const { GET } = await import('./route');
    const first = await GET();
    expect(first.status).toBe(503);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect((await first.json()).error).toMatch(/temporarily unavailable/);
    // Error cooldown must apply; retrying immediately does not repeatedly hit OSM.
    expect((await GET()).status).toBe(503);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the last good snapshot when an HTTP 200 Overpass timeout has partial buildings', async () => {
    const partial = JSON.stringify({
      elements: [{ type: 'way', id: 255784049, geometry: libraryOutline,
        tags: { building: 'yes', height: '90' } }],
      remark: 'runtime error: Query run out of memory',
    });
    const mockedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(osmPayload, { status: 200 }))
      .mockResolvedValueOnce(new Response(partial, { status: 200 }));
    vi.stubGlobal('fetch', mockedFetch);
    const { GET } = await import('./route');
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      const initial = await GET();
      expect(initial.status).toBe(200);
      const first = await initial.json();
      expect(first.buildings[0]).toMatchObject({
        poiId: 'pu-library', heightMeters: 12, heightBasis: 'illustrative',
      });

      clock.mockReturnValue(start + 25 * 60 * 60 * 1000);
      const fallback = await GET();
      expect(fallback.status).toBe(200);
      expect(fallback.headers.get('Cache-Control')).toBe('private, no-store');
      const body = await fallback.json();
      expect(body.stale).toBe(true);
      expect(body.fetchedAt).toBe(first.fetchedAt);
      expect(body.buildings).toEqual(first.buildings);
      expect((await GET()).status).toBe(200);
      expect(mockedFetch).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('stops reading oversized streamed responses before buffering the whole payload', async () => {
    let wasCancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(500_001));
      },
      cancel() { wasCancelled = true; },
    });
    const text = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      body,
      text,
    }));
    const { GET } = await import('./route');
    expect((await GET()).status).toBe(503);
    expect(wasCancelled).toBe(true);
    expect(text).not.toHaveBeenCalled();
  });

  it('keeps the fallback explicit and rate limits repeated upstream failures', async () => {
    const mockedFetch = vi.fn().mockRejectedValue(new Error('timeout'));
    vi.stubGlobal('fetch', mockedFetch);
    const { GET } = await import('./route');
    const first = await GET();
    expect(first.status).toBe(503);
    expect((await first.json()).error).toMatch(/temporarily unavailable/);
    expect((await GET()).status).toBe(503);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('stops serving unverified stale building geometry after seven days of upstream failure', async () => {
    const day = 24 * 60 * 60 * 1000;
    const mockedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(osmPayload, { status: 200 }))
      .mockRejectedValue(new Error('upstream still down'));
    vi.stubGlobal('fetch', mockedFetch);
    const { GET } = await import('./route');
    const start = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(start);
    expect((await GET()).status).toBe(200);

    vi.spyOn(Date, 'now').mockReturnValue(start + 2 * day);
    const stale = await GET();
    expect(stale.status).toBe(200);
    expect((await stale.json()).stale).toBe(true);

    vi.spyOn(Date, 'now').mockReturnValue(start + 8 * day);
    const expired = await GET();
    expect(expired.status).toBe(503);
    expect(expired.headers.get('Cache-Control')).toBe('no-store');
    expect((await expired.json()).error).toMatch(/temporarily unavailable/);
    // We still attempt a controlled upstream refresh instead of extending old data.
    expect(mockedFetch).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });

  it('obeys a one-hour Overpass 429 Retry-After rather than retrying after ten minutes', async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      const upstream = vi.fn()
        .mockResolvedValueOnce(new Response('rate limited', {
          status: 429, headers: { 'Retry-After': '3600' },
        }))
        .mockResolvedValueOnce(new Response(osmPayload, { status: 200 }));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');
      const first = await GET();
      expect(first.status).toBe(503);
      expect(first.headers.get('Cache-Control')).toBe('no-store');
      expect(first.headers.get('Retry-After')).toBe('3600');

      clock.mockReturnValue(start + 11 * 60 * 1000);
      const cooling = await GET();
      expect(cooling.status).toBe(503);
      expect(cooling.headers.get('Retry-After')).toBe('2940');
      expect(upstream).toHaveBeenCalledTimes(1);

      clock.mockReturnValue(start + 60 * 60 * 1000 + 1000);
      expect((await GET()).status).toBe(200);
      expect(upstream).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('keeps a dated stale OSM snapshot during an HTTP-date Retry-After from an overloaded endpoint', async () => {
    const start = Math.floor(Date.now() / 1000) * 1000;
    const day = 24 * 60 * 60 * 1000;
    const refreshAt = start + day + 60 * 60 * 1000;
    const retryAfter = new Date(refreshAt + 90 * 60 * 1000).toUTCString();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      const upstream = vi.fn()
        .mockResolvedValueOnce(new Response(osmPayload, { status: 200 }))
        .mockResolvedValueOnce(new Response('overloaded', {
          status: 503, headers: { 'Retry-After': retryAfter },
        }))
        .mockResolvedValueOnce(new Response(osmPayload, { status: 200 }));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');
      const initial = await (await GET()).json();
      clock.mockReturnValue(refreshAt);
      const stale = await GET();
      expect(stale.status).toBe(200);
      expect(stale.headers.get('Cache-Control')).toBe('private, no-store');
      expect((await stale.json()).fetchedAt).toBe(initial.fetchedAt);

      clock.mockReturnValue(refreshAt + 60 * 60 * 1000);
      const stillStale = await (await GET()).json();
      expect(stillStale.stale).toBe(true);
      expect(stillStale.fetchedAt).toBe(initial.fetchedAt);
      expect(upstream).toHaveBeenCalledTimes(2);

      clock.mockReturnValue(refreshAt + 91 * 60 * 1000);
      const recovered = await GET();
      expect(recovered.status).toBe(200);
      expect((await recovered.json()).stale).toBe(false);
      expect(upstream).toHaveBeenCalledTimes(3);
    } finally {
      clock.mockRestore();
    }
  });

  it('returns a dated stale snapshot if the upstream later goes away', async () => {
    const firstFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, headers: { get: () => null }, text: async () => osmPayload })
      .mockRejectedValueOnce(new Error('upstream down'));
    vi.stubGlobal('fetch', firstFetch);
    const { GET } = await import('./route');
    const start = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(start);
    expect((await GET()).status).toBe(200);
    vi.spyOn(Date, 'now').mockReturnValue(start + 25 * 60 * 60 * 1000);
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).stale).toBe(true);
    expect(firstFetch).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
