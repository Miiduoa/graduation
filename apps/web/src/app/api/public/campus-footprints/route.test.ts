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
      status: 200,
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
    // This fixed-ID query should request a modest Overpass scheduling budget,
    // rather than the 512 MiB default, and leave transport time after execution.
    // This checks our request contract, not live public-API availability.
    expect(query).toContain('[timeout:8]');
    expect(query).toContain('[maxsize:67108864]');
    expect(query).not.toContain('[timeout:12]');
    expect(query).toContain('way(id:');
    expect(query).toContain('relation(id:9246899)');
    expect(query).toContain('255784049');
    expect(query).toContain('out meta geom;');
    expect(query).not.toContain('295686299'); // 未交叉確認的停車場
    const second = await GET();
    expect(second.status).toBe(200);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a contradictory OSM node ID reused at different coordinates across audited buildings', async () => {
    // Each way alone is a geometrically valid closed building near its known
    // campus POI. A cross-way identity conflict must reject the *whole*
    // snapshot, not promote a mix of impossible 3D positions.
    const secondOutline = [
      { lat: 24.22690, lon: 120.58354 },
      { lat: 24.22690, lon: 120.58364 },
      { lat: 24.22700, lon: 120.58364 },
      { lat: 24.22700, lon: 120.58354 },
      { lat: 24.22690, lon: 120.58354 },
    ];
    const library = {
      type: 'way', id: 255784049, geometry: libraryOutline,
      nodes: [701, 702, 703, 704, 701], tags: { building: 'yes' },
    };
    const zhugu = {
      type: 'way', id: 255784268, geometry: secondOutline,
      nodes: [801, 802, 803, 804, 801], tags: { building: 'yes' },
    };
    const { parseProvidenceOsmFootprints } = await import('@/app/map/providenceFootprints');
    expect(parseProvidenceOsmFootprints({ elements: [library, zhugu] })
      .map((building) => building.poiId)).toEqual(['pu-zhugu', 'pu-library']);
    // Node 701 cannot identify the library's SW corner and the distant
    // Zhugu corner simultaneously; both rings remain individually closed.
    const conflicting = { elements: [library, { ...zhugu, nodes: [701, 802, 803, 804, 701] }] };
    expect(parseProvidenceOsmFootprints(conflicting)).toEqual([]);
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify(conflicting), { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await response.json()).error).toMatch(/temporarily unavailable/);
    expect((await GET()).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('rejects a truncated Xijia relation instead of rendering an invented solid roof', async () => {
    const dormOutline = [
      { lat: 24.22797, lon: 120.58062 },
      { lat: 24.22797, lon: 120.58072 },
      { lat: 24.22807, lon: 120.58072 },
      { lat: 24.22807, lon: 120.58062 },
      { lat: 24.22797, lon: 120.58062 },
    ];
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      elements: [{
        type: 'relation', id: 9246899,
        tags: { type: 'multipolygon', building: 'dormitory' },
        members: [{ type: 'way', role: 'outer', ref: 123456, geometry: dormOutline }],
        version: 7, user: 'private-editor-name', uid: 999,
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/temporarily unavailable/);
    expect(JSON.stringify(body)).not.toContain('private-editor-name');
  });

  it('serves an audited relation courtyard as a hole instead of a solid building roof', async () => {
    const outer = [
      { lat: 24.22785, lon: 120.58045 }, { lat: 24.22785, lon: 120.58090 },
      { lat: 24.22818, lon: 120.58090 }, { lat: 24.22818, lon: 120.58045 },
      { lat: 24.22785, lon: 120.58045 },
    ];
    const inner = [
      { lat: 24.22799, lon: 120.58063 }, { lat: 24.22799, lon: 120.58072 },
      { lat: 24.22805, lon: 120.58072 }, { lat: 24.22805, lon: 120.58063 },
      { lat: 24.22799, lon: 120.58063 },
    ];
    const mockedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      elements: [{
        type: 'relation', id: 9246899,
        tags: { type: 'multipolygon', building: 'dormitory', 'building:levels': '5' },
        members: [
          { type: 'way', ref: 255783593, role: 'outer', geometry: outer },
          { type: 'way', ref: 665651134, role: 'inner', geometry: inner },
        ],
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', mockedFetch);
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.buildings).toHaveLength(1);
    expect(body.buildings[0]).toMatchObject({
      poiId: 'pu-xijia', sourceUrl: 'https://www.openstreetmap.org/relation/9246899',
      heightBasis: 'illustrative', heightMeters: 12,
      holes: [[[120.58063, 24.22799], [120.58072, 24.22799],
        [120.58072, 24.22805], [120.58063, 24.22805]]],
    });
  });

  it('refuses Overpass redirects instead of following a Location to another host or private network', async () => {
    const upstream = vi.fn().mockResolvedValue(new Response('moved', {
      status: 302,
      headers: { Location: 'http://127.0.0.1:3000/internal' },
    }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');

    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await response.json()).error).toMatch(/temporarily unavailable/);
    expect(upstream).toHaveBeenCalledTimes(1);
    // Native fetch follows HTTP redirects by default. This explicit option
    // stops the follow *before* any redirected network request is made.
    expect(upstream.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      cache: 'no-store',
    });
    expect(new URL(upstream.mock.calls[0][0]).hostname).toBe('overpass-api.de');
    // A rejected redirect cannot poison the snapshot or trigger repeated
    // requests while the existing error cooldown remains active.
    expect((await GET()).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each([206, 203])('rejects an upstream HTTP %i even when its JSON body is valid', async (status) => {
    // Fetch Response.ok is true for every 2xx. A proxy's partial (206) or
    // transformed (203) response is not a complete OSM source snapshot.
    const upstream = vi.fn().mockImplementation(async () =>
      new Response(osmPayload, { status }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');

    const first = await GET();
    expect(first.status).toBe(503);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect(first.headers.get('Retry-After')).toBeTruthy();
    expect((await first.json()).error).toMatch(/temporarily unavailable/);
    // A syntactically valid partial JSON response must not be cached as a
    // verified building, and cooldown must avoid repeated public API calls.
    expect((await GET()).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('rejects a 200 response advertising Content-Range instead of caching an incomplete map', async () => {
    // Even with a valid JSON body, Content-Range denotes a byte-range
    // representation, not proof of a complete OSM export.
    const upstream = vi.fn().mockImplementation(async () =>
      new Response(osmPayload, {
        status: 200,
        headers: { 'Content-Range': 'bytes 0-99/200' },
      }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');

    const first = await GET();
    expect(first.status).toBe(503);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect(first.headers.get('Retry-After')).toBeTruthy();
    expect((await first.json()).error).toMatch(/temporarily unavailable/);
    // Do not cache or immediately retry the invalid upstream representation.
    expect((await GET()).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each([
    { declared: 0, description: 'zero bytes' },
    { declared: new TextEncoder().encode(osmPayload).byteLength - 1, description: 'too few bytes' },
    { declared: new TextEncoder().encode(osmPayload).byteLength + 1, description: 'too many bytes' },
  ])('rejects HTTP 200 identity JSON when Content-Length declares $description', async ({ declared }) => {
    // A proxy can send a syntactically valid JSON subset with an incorrect
    // identity body length. HTTP 200 and JSON.parse alone do not prove that
    // every advertised byte arrived, so it must never become a 24h snapshot.
    const upstream = vi.fn().mockImplementation(async () =>
      new Response(osmPayload, {
        status: 200, headers: { 'Content-Length': String(declared) },
      }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const result = await GET();
    expect(result.status).toBe(503);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect((await GET()).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: 'zero bytes', declared: '0', firstChunk: new TextEncoder().encode(osmPayload) },
    { label: 'fewer bytes than the first chunk', declared: '1',
      firstChunk: new TextEncoder().encode(osmPayload.slice(0, 20)) },
  ])('rejects a stalled identity stream declaring $label without waiting for its 12s deadline',
    async ({ declared, firstChunk }) => {
      vi.useFakeTimers();
      let cancelled = 0;
      // The response sends data but never reaches EOF. A contradictory
      // Content-Length must be rejected immediately, not after a 12s stall.
      const stalled = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(firstChunk); },
        cancel() {
          cancelled += 1;
          return new Promise<void>(() => {});
        },
      });
      const upstream = vi.fn().mockResolvedValue(new Response(stalled, {
        status: 200, headers: { 'Content-Length': declared },
      }));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');
      let settled = false;
      const pendingResponse = GET().then((result) => { settled = true; return result; });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(settled).toBe(true);
      const response = await pendingResponse;
      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(cancelled).toBe(1);
      expect((await GET()).status).toBe(503);
      expect(upstream).toHaveBeenCalledTimes(1);
    });

  it('accepts an identity Overpass body when its declared length matches', async () => {
    const upstream = vi.fn().mockImplementation(async () =>
      new Response(osmPayload, {
        status: 200,
        headers: { 'Content-Length': String(new TextEncoder().encode(osmPayload).byteLength) },
      }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).buildings).toHaveLength(1);
    expect((await GET()).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'x-unknown', 'identity, gzip', 'gzip, br'])(
    'rejects ambiguous Overpass Content-Encoding %j rather than trust decoded JSON',
    async (encoding) => {
      // This synthetic fetch body is already valid JSON. An unreviewed or
      // stacked coding must not disable identity length verification simply
      // because Content-Encoding is non-null.
      const upstream = vi.fn().mockResolvedValue(new Response(osmPayload, {
        status: 200,
        headers: { 'Content-Encoding': encoding, 'Content-Length': '1' },
      }));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');
      const response = await GET();
      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect((await response.json()).error).toMatch(/temporarily unavailable/);
      expect((await GET()).status).toBe(503);
      expect(upstream).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects unsupported encoding before reading a stalled response body', async () => {
    vi.useFakeTimers();
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([123])); },
      cancel() {
        cancelled += 1;
        return new Promise<void>(() => {});
      },
    });
    const upstream = vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'Content-Encoding': 'x-unknown' },
    }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    let settled = false;
    const pending = GET().then((response) => { settled = true; return response; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(true);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(cancelled).toBe(1);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each(['gzip', 'br', 'deflate'])(
    'rejects impossible zero-byte %s transfer without caching valid-looking decoded JSON',
    async (encoding) => {
      // A compressed wire body with Content-Length: 000 has no bytes from
      // which Fetch could have decoded this JSON. This is a synthetic
      // contradictory header/body pair, not a recorded Overpass incident.
      const upstream = vi.fn().mockResolvedValue(new Response(osmPayload, {
        status: 200,
        headers: { 'Content-Encoding': encoding, 'Content-Length': '000' },
      }));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');
      const response = await GET();
      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect((await response.json()).error).toMatch(/temporarily unavailable/);
      expect((await GET()).status).toBe(503);
      expect(upstream).toHaveBeenCalledTimes(1);
    },
  );

  it('cancels a stalled encoded body when the wire length falsely claims zero bytes', async () => {
    let cancelled = 0;
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([123])); },
      cancel() {
        cancelled += 1;
        return new Promise<void>(() => {});
      },
    });
    const upstream = vi.fn().mockResolvedValue(new Response(stalled, {
      status: 200,
      headers: { 'Content-Encoding': 'gzip', 'Content-Length': '0' },
    }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    // Non-settling stream cancellation must not delay the response.
    const result = await GET();
    expect(result.status).toBe(503);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(cancelled).toBe(1);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each(['gzip', 'BR', 'deflate', 'identity'])(
    'accepts recognized Overpass single Content-Encoding %s',
    async (encoding) => {
      // A mocked Fetch response provides already-decoded JSON; no claim about
      // live Overpass compression or transfer correctness.
      const upstream = vi.fn().mockResolvedValue(new Response(osmPayload, {
        status: 200,
        headers: { 'Content-Encoding': encoding,
          'Content-Length': encoding === 'identity'
            ? String(new TextEncoder().encode(osmPayload).byteLength) : '42' },
      }));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');
      const response = await GET();
      expect(response.status).toBe(200);
      expect((await response.json()).buildings).toHaveLength(1);
    },
  );

  it('does not compare decoded gzip bytes against the encoded Content-Length header', async () => {
    // Fetch exposes decompressed Response.body bytes but may preserve the
    // original compressed length header. Model that Fetch contract, without
    // implying this mock represents a real gzip network transfer.
    const upstream = vi.fn().mockImplementation(async () =>
      new Response(osmPayload, {
        status: 200,
        headers: { 'Content-Encoding': 'gzip', 'Content-Length': '42' },
      }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).buildings).toHaveLength(1);
  });

  it('accepts decoded JSON below 500 KB when gzip wire length is slightly larger', async () => {
    // Fetch can expose already-decoded JSON but preserve compressed wire
    // Content-Length. A transport length over the decoded cap is not, by
    // itself, evidence that the decoded OSM JSON exceeds our memory budget.
    // This is a synthetic Fetch header/body contract, not a live OSM request.
    const upstream = vi.fn().mockResolvedValue(new Response(osmPayload, {
      status: 200,
      headers: { 'Content-Encoding': 'gzip', 'Content-Length': '500001' },
    }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).buildings).toHaveLength(1);
    expect((await GET()).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('rejects a decoded gzip body over 500 KB despite a short encoded length', async () => {
    // Untrusted compressed bodies must still obey the *decoded* streaming cap.
    const upstream = vi.fn().mockResolvedValue(new Response(' '.repeat(500_001), {
      status: 200,
      headers: { 'Content-Encoding': 'gzip', 'Content-Length': '42' },
    }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await GET()).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized encoded gzip response without reading its stalled stream', async () => {
    vi.useFakeTimers();
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([123])); },
      cancel() {
        cancelled += 1;
        return new Promise<void>(() => {});
      },
    });
    const upstream = vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'Content-Encoding': 'gzip', 'Content-Length': '1000001' },
    }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    let settled = false;
    const pending = GET().then((result) => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(true);
    expect((await pending).status).toBe(503);
    expect(cancelled).toBe(1);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('retains a dated stale snapshot instead of replacing it with HTTP 206 geometry', async () => {
    const originalTime = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(originalTime);
    try {
      const upstream = vi.fn()
        .mockImplementationOnce(async () => new Response(osmPayload, { status: 200 }))
        .mockImplementationOnce(async () => new Response(osmPayload, { status: 206 }));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');
      const first = await GET();
      expect(first.status).toBe(200);
      const trusted = await first.json();

      clock.mockReturnValue(originalTime + 25 * 60 * 60 * 1000);
      const fallback = await GET();
      expect(fallback.status).toBe(200);
      expect(fallback.headers.get('Cache-Control')).toBe('private, no-store');
      expect(await fallback.json()).toMatchObject({
        stale: true, fetchedAt: trusted.fetchedAt, buildings: trusted.buildings,
      });
      expect(upstream).toHaveBeenCalledTimes(2);
      // The rejected partial response neither refreshes TTL nor causes a
      // retry loop while the upstream is within its error cooldown.
      expect((await GET()).status).toBe(200);
      expect(upstream).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
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

  it.each(['0', '-2', '1.5', '2;3', '101'])(
    'does not cache an OSM building with contradictory building:levels=%s',
    async (levels) => {
      // Synthetic malformed level metadata; not an observed campus source.
      const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        elements: [{
          type: 'way', id: 255784049, geometry: libraryOutline,
          tags: { building: 'yes', 'building:levels': levels },
        }],
      }), { status: 200 }));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');
      const response = await GET();
      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect((await response.json()).error).toMatch(/temporarily unavailable/);
      expect((await GET()).status).toBe(503);
      expect(upstream).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps POI-only fallback when OSM says a listed building is under demolition', async () => {
    // Synthetic conflicting tags, not a report of demolition at Providence.
    const inconsistent = JSON.stringify({
      elements: [{
        type: 'way', id: 255784049, geometry: libraryOutline,
        tags: { building: 'yes', 'demolition:building': 'yes' },
      }],
    });
    const upstream = vi.fn().mockResolvedValue(new Response(inconsistent, { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const result = await GET();
    expect(result.status).toBe(503);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect((await result.json()).error).toMatch(/temporarily unavailable/);
    expect((await GET()).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('accepts documented OSM feet heights as sourced values rather than a 12m illustration', async () => {
    const feetPayload = JSON.stringify({
      elements: [{ type: 'way', id: 255784049, geometry: libraryOutline,
        tags: { building: 'yes', height: '50 ft' } }],
    });
    const upstream = vi.fn().mockResolvedValue(new Response(feetPayload, { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.buildings).toHaveLength(1);
    expect(body.buildings[0]).toMatchObject({ poiId: 'pu-library', heightBasis: 'osm-tag' });
    expect(body.buildings[0].heightMeters).toBeCloseTo(15.24, 6);
    // A valid feet-tagged building is cached under the normal successful snapshot.
    expect((await GET()).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('does not invent a 12m building when Overpass explicitly reports an unsupported height unit', async () => {
    const invalid = JSON.stringify({
      elements: [{ type: 'way', id: 255784049, geometry: libraryOutline,
        tags: { building: 'yes', height: '50 yd' } }],
    });
    const upstream = vi.fn().mockResolvedValue(new Response(invalid, { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const first = await GET();
    expect(first.status).toBe(503);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect((await first.json()).error).toMatch(/temporarily unavailable/);
    // No incorrect building is cached; cooldown avoids hammering Overpass.
    expect((await GET()).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('does not serve or cache an OSM building part as a complete campus building', async () => {
    const partsOnly = JSON.stringify({
      elements: [{ type: 'way', id: 255784049, geometry: libraryOutline,
        tags: { building: 'yes', 'building:part': 'yes', height: '18 m' } }],
    });
    const upstream = vi.fn().mockResolvedValue(new Response(partsOnly, { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const first = await GET();
    expect(first.status).toBe(503);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect((await first.json()).error).toMatch(/temporarily unavailable/);
    const again = await GET();
    expect(again.status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('falls back to POI-only when an audited OSM way becomes underground', async () => {
    const underground = JSON.stringify({
      elements: [{ type: 'way', id: 255784049, geometry: libraryOutline,
        tags: { building: 'yes', height: '18 m', location: 'underground' } }],
    });
    const upstream = vi.fn().mockResolvedValue(new Response(underground, { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');

    const initial = await GET();
    expect(initial.status).toBe(503);
    expect(initial.headers.get('Cache-Control')).toBe('no-store');
    expect((await initial.json()).error).toMatch(/temporarily unavailable/);
    // The unverified 3D volume never enters the fresh cache. Preserve the
    // upstream cooldown rather than requesting a bad way on every map visit.
    const again = await GET();
    expect(again.status).toBe(503);
    expect(again.headers.get('Cache-Control')).toBe('no-store');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('does not cache a building=yes way with a present but empty ruin marker', async () => {
    const ambiguous = JSON.stringify({
      elements: [{ type: 'way', id: 255784049, geometry: libraryOutline,
        tags: { building: 'yes', ruins: '' } }],
    });
    const upstream = vi.fn().mockResolvedValue(new Response(ambiguous, { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const first = await GET();
    expect(first.status).toBe(503);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect((await GET()).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
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

  it.each(['ruin', 'damaged'])(
    'does not cache an audited way relabeled building=%s as an intact campus roof',
    async (classification) => {
      // Synthetic OSM edit on a formerly verified way; the POI remains available.
      const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        elements: [{
          type: 'way', id: 255784049, geometry: libraryOutline,
          tags: { building: classification, height: '20' },
        }],
      }), { status: 200 }));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');
      const first = await GET();
      expect(first.status).toBe(503);
      expect(first.headers.get('Cache-Control')).toBe('no-store');
      expect((await first.json()).error).toMatch(/temporarily unavailable/);
      expect((await GET()).status).toBe(503);
      expect(upstream).toHaveBeenCalledTimes(1);
    },
  );

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

  it('does not publish a way edit later than the Overpass database timestamp', async () => {
    const stamp = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const now = Date.now();
    const baseTime = stamp(now - 10 * 60_000);
    const impossibleWayEdit = stamp(now - 60_000);
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      osm3s: { timestamp_osm_base: baseTime },
      elements: [{ ...JSON.parse(osmPayload).elements[0], version: 99, timestamp: impossibleWayEdit }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');

    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.osmBaseAt).toBe(baseTime);
    expect(data.buildings).toHaveLength(1);
    expect(data.buildings[0]).toMatchObject({
      poiId: 'pu-library', heightBasis: 'illustrative',
    });
    expect(data.buildings[0]).not.toHaveProperty('osmVersion');
    expect(data.buildings[0]).not.toHaveProperty('osmEditedAt');
    expect((await GET()).status).toBe(200);
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

  it.each(['older', 'missing'] as const)(
    'keeps dated campus geometry when an Overpass refresh has %s replication metadata',
    async (regression) => {
      const start = Math.floor(Date.now() / 1000) * 1000;
      const day = 24 * 60 * 60 * 1000;
      const stamp = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
      const initialBase = stamp(start - 60_000);
      // After 25h, the next database state is 40h old: still inside the
      // existing 48h freshness window, but older than the *last* snapshot.
      const regressedBase = stamp(start - 15 * 60 * 60 * 1000);
      const withBase = (payload: string, base: string | null) => JSON.stringify({
        ...JSON.parse(payload),
        ...(base === null ? {} : { osm3s: { timestamp_osm_base: base } }),
      });
      const alteredPayload = JSON.stringify({
        ...JSON.parse(osmPayload),
        elements: [{
          ...JSON.parse(osmPayload).elements[0],
          tags: { building: 'yes', height: '90' },
        }],
      });
      const recoveredPayload = JSON.stringify({
        ...JSON.parse(osmPayload),
        elements: [{
          ...JSON.parse(osmPayload).elements[0],
          tags: { building: 'yes', height: '20' },
        }],
      });
      const upstream = vi.fn()
        .mockImplementationOnce(async () => new Response(withBase(osmPayload, initialBase), { status: 200 }))
        .mockImplementationOnce(async () => new Response(withBase(
          alteredPayload, regression === 'older' ? regressedBase : null,
        ), { status: 200 }))
        .mockImplementationOnce(async () => new Response(withBase(
          recoveredPayload, stamp(start + day + 60 * 60 * 1000),
        ), { status: 200 }));
      vi.stubGlobal('fetch', upstream);
      const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
      try {
        const { GET } = await import('./route');
        const first = await GET();
        expect(first.status).toBe(200);
        const original = await first.json();
        expect(original.osmBaseAt).toBe(initialBase);
        expect(original.buildings[0].heightBasis).toBe('illustrative');

        clock.mockReturnValue(start + day + 60 * 60 * 1000);
        const fallback = await GET();
        expect(fallback.status).toBe(200);
        expect(fallback.headers.get('Cache-Control')).toBe('private, no-store');
        expect(fallback.headers.get('Retry-After')).toBe('600');
        expect(await fallback.json()).toMatchObject({
          stale: true, fetchedAt: original.fetchedAt,
          osmBaseAt: initialBase, buildings: original.buildings,
        });
        expect(upstream).toHaveBeenCalledTimes(2);

        clock.mockReturnValue(start + day + 65 * 60 * 1000);
        expect((await GET()).status).toBe(200);
        expect(upstream).toHaveBeenCalledTimes(2); // No retry storm.

        clock.mockReturnValue(start + day + 71 * 60 * 1000);
        const recovered = await GET();
        expect(recovered.status).toBe(200);
        const next = await recovered.json();
        expect(next.stale).toBe(false);
        expect(next.osmBaseAt).toBe(stamp(start + day + 60 * 60 * 1000));
        expect(next.buildings[0]).toMatchObject({ heightMeters: 20, heightBasis: 'osm-tag' });
        expect(upstream).toHaveBeenCalledTimes(3);
      } finally {
        clock.mockRestore();
      }
    },
  );

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

  it.each([
    ['missing timestamp', {}],
    ['null timestamp', { timestamp_osm_base: null }],
  ])('rejects an explicit osm3s header with %s instead of caching undated geometry', async (_case, osm3s) => {
    const payload = JSON.stringify({ osm3s, ...JSON.parse(osmPayload) });
    const upstream = vi.fn().mockResolvedValue(new Response(payload, { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await response.json()).error).toMatch(/temporarily unavailable/);
    // Rejected metadata cannot be promoted into a fresh cached campus map.
    expect((await GET()).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('retains a dated stale fallback when a later Overpass reply omits its declared replication date', async () => {
    const start = Math.floor(Date.now() / 1000) * 1000;
    const base = new Date(start - 60_000).toISOString().replace('.000Z', 'Z');
    const initialPayload = JSON.stringify({
      osm3s: { timestamp_osm_base: base }, ...JSON.parse(osmPayload),
    });
    const malformedPayload = JSON.stringify({
      osm3s: { copyright: 'OpenStreetMap contributors' }, ...JSON.parse(osmPayload),
    });
    const upstream = vi.fn()
      .mockResolvedValueOnce(new Response(initialPayload, { status: 200 }))
      .mockResolvedValueOnce(new Response(malformedPayload, { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      const { GET } = await import('./route');
      const first = await GET();
      expect(first.status).toBe(200);
      const firstBody = await first.json();
      expect(firstBody.osmBaseAt).toBe(base);
      clock.mockReturnValue(start + 25 * 60 * 60 * 1000);
      const fallback = await GET();
      expect(fallback.status).toBe(200);
      expect(fallback.headers.get('Cache-Control')).toBe('private, no-store');
      const body = await fallback.json();
      expect(body.stale).toBe(true);
      expect(body.fetchedAt).toBe(firstBody.fetchedAt);
      expect(body.osmBaseAt).toBe(base);
      expect(body.buildings).toEqual(firstBody.buildings);
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

  it.each([
    '500001', 'invalid', '', '1e2', '0x10', '2.5', '+10',
    '99999999999999999999999999999999999999999',
  ])(
    'does not leave an oversized or malformed Content-Length body streaming (%s)',
    async (declaredSize) => {
      vi.useFakeTimers();
      let cancelled = 0;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          // Even a small first chunk must not be read when the header already
          // violates our size policy. The cancel itself may never settle.
          controller.enqueue(new Uint8Array([123]));
        },
        cancel() {
          cancelled += 1;
          return new Promise<void>(() => {});
        },
      });
      const upstream = vi.fn().mockResolvedValue(new Response(body, {
        status: 200, headers: { 'Content-Length': declaredSize },
      }));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');
      let settled = false;
      const pending = GET().then((response) => {
        settled = true;
        return response;
      });

      // A known header violation should not wait for the 12-second deadline
      // or for a stalled stream-cancellation promise.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(settled).toBe(true);
      const response = await pending;
      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(cancelled).toBe(1);
      expect((await GET()).status).toBe(503);
      expect(upstream).toHaveBeenCalledTimes(1);
    },
  );

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
      status: 200,
      headers: { get: () => null },
      body,
      text,
    }));
    const { GET } = await import('./route');
    expect((await GET()).status).toBe(503);
    expect(wasCancelled).toBe(true);
    expect(text).not.toHaveBeenCalled();
  });

  it('rejects an oversized stream promptly even when cancellation itself never settles', async () => {
    vi.useFakeTimers();
    let cancelCalls = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(500_001));
      },
      cancel() {
        cancelCalls += 1;
        // A misbehaving stream can ignore cancellation indefinitely. Its
        // pending cancel promise must not delay a known oversize rejection.
        return new Promise<void>(() => {});
      },
    });
    const upstream = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');

    let settledStatus: number | null = null;
    const pending = GET().then((response) => {
      settledStatus = response.status;
      return response;
    });
    // Far less than the 12-second global deadline: failure should happen as
    // soon as the decoded byte limit is exceeded.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cancelCalls).toBe(1);
    expect(settledStatus).toBe(503);
    const rejected = await pending;
    expect(rejected.headers.get('Cache-Control')).toBe('no-store');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('ends a never-settling upstream fetch after 12 seconds even if it ignores abort', async () => {
    vi.useFakeTimers();
    const upstream = vi.fn()
      // Simulate a proxy ignoring AbortSignal entirely; this promise never settles.
      .mockImplementationOnce(() => new Promise<Response>(() => {}))
      .mockImplementationOnce(async () => new Response(osmPayload, { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const pending = GET();

    await vi.advanceTimersByTimeAsync(12_000);
    const unavailable = await pending;
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get('Cache-Control')).toBe('no-store');
    expect((await unavailable.json()).error).toMatch(/temporarily unavailable/);
    expect(upstream.mock.calls[0][1].signal.aborted).toBe(true);
    expect((await GET()).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);

    // Expired shared pending work must not block a later healthy refresh.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);
    const recovered = await GET();
    expect(recovered.status).toBe(200);
    expect((await recovered.json()).buildings).toHaveLength(1);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('ends an unresponsive streamed response body after the server deadline', async () => {
    vi.useFakeTimers();
    // Headers arrive, but reading the body never completes and the mock ignores abort.
    const stalled = new ReadableStream<Uint8Array>({
      start() { /* An unresponsive server sends no bytes and never closes. */ },
    });
    const upstream = vi.fn().mockResolvedValue(new Response(stalled, { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const pending = GET();
    await vi.advanceTimersByTimeAsync(12_000);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(upstream.mock.calls[0][1].signal.aborted).toBe(true);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('cancels a stalled body reader on deadline without accepting a truncated JSON snapshot', async () => {
    vi.useFakeTimers();
    let cancelCalls = 0;
    // This is a syntactically valid JSON chunk, but the stream never ends.
    // Aborting a fetch is not sufficient when an intermediary ignores its signal.
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(osmPayload));
      },
      cancel() {
        cancelCalls += 1;
        // A non-cooperative stream may never resolve the cancel promise.
        return new Promise<void>(() => {});
      },
    });
    const upstream = vi.fn().mockResolvedValue(new Response(stalled, { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    const pending = GET();

    await vi.advanceTimersByTimeAsync(12_000);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(upstream.mock.calls[0][1].signal.aborted).toBe(true);
    expect(cancelCalls).toBe(1);
    // The complete-looking first chunk is not a successful snapshot.
    expect((await GET()).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
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

  it.each([
    { status: 400, retryAfter: null, cooldown: '86400' },
    { status: 403, retryAfter: null, cooldown: '86400' },
    { status: 406, retryAfter: null, cooldown: '86400' },
    { status: 429, retryAfter: '3600', cooldown: '3600' },
    { status: 503, retryAfter: '3600', cooldown: '3600' },
    { status: 500, retryAfter: null, cooldown: '600' },
  ])('cancels an unread HTTP $status error body without waiting for upstream cancellation', async ({
    status, retryAfter, cooldown,
  }) => {
    vi.useFakeTimers();
    let cancelCalls = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Headers have arrived, but the rejected response keeps its body open.
        controller.enqueue(new Uint8Array([123]));
      },
      cancel() {
        cancelCalls += 1;
        // A broken proxy may never acknowledge cancellation.
        return new Promise<void>(() => {});
      },
    });
    const upstream = vi.fn().mockResolvedValue(new Response(stream, {
      status,
      headers: retryAfter ? { 'Retry-After': retryAfter } : undefined,
    }));
    vi.stubGlobal('fetch', upstream);
    const { GET } = await import('./route');
    let result: Response | undefined;
    const pending = GET().then((response) => { result = response; return response; });

    // The error is already known from the headers. Neither a pending cancel
    // nor a never-ending error body should consume the 12-second deadline.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(result?.status).toBe(503);
    const failed = await pending;
    expect(failed.headers.get('Cache-Control')).toBe('no-store');
    const retrySeconds = Number(failed.headers.get('Retry-After'));
    expect(retrySeconds).toBeGreaterThanOrEqual(Number(cooldown) - 1);
    expect(retrySeconds).toBeLessThanOrEqual(Number(cooldown));
    expect(cancelCalls).toBe(1);
    expect((await GET()).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: 502, retryAfter: '3600', cooldownSeconds: 3600 },
    { status: 504, retryAfter: '1800', cooldownSeconds: 1800 },
    { status: 502, retryAfter: null, cooldownSeconds: 600 },
    { status: 504, retryAfter: null, cooldownSeconds: 600 },
  ])('respects overload HTTP $status Retry-After $retryAfter without premature public requests',
    async ({ status, retryAfter, cooldownSeconds }) => {
      const start = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
      try {
        const upstream = vi.fn()
          .mockResolvedValueOnce(new Response('Overpass gateway busy', {
            status, ...(retryAfter ? { headers: { 'Retry-After': retryAfter } } : {}),
          }))
          .mockResolvedValueOnce(new Response(osmPayload, { status: 200 }));
        vi.stubGlobal('fetch', upstream);
        const { GET } = await import('./route');
        const unavailable = await GET();
        expect(unavailable.status).toBe(503);
        expect(unavailable.headers.get('Retry-After')).toBe(String(cooldownSeconds));
        expect(unavailable.headers.get('Cache-Control')).toBe('no-store');

        clock.mockReturnValue(start + (cooldownSeconds - 1) * 1000);
        const beforeDeadline = await GET();
        expect(beforeDeadline.status).toBe(503);
        expect(beforeDeadline.headers.get('Retry-After')).toBe('1');
        expect(upstream).toHaveBeenCalledTimes(1);

        clock.mockReturnValue(start + (cooldownSeconds + 1) * 1000);
        const recovered = await GET();
        expect(recovered.status).toBe(200);
        expect((await recovered.json()).buildings).toHaveLength(1);
        expect(upstream).toHaveBeenCalledTimes(2);
      } finally {
        clock.mockRestore();
      }
    });

  it.each([
    {
      label: 'overflowed delta-seconds',
      header: '9'.repeat(350),
      expectedSeconds: 86_400,
      status: 503,
    },
    {
      label: 'zero-padded delta-seconds',
      header: '0'.repeat(350) + '1800',
      expectedSeconds: 1_800,
      status: 502,
    },
  ])('honours $label Retry-After without retrying a busy Overpass service early',
    async ({ header, expectedSeconds, status }) => {
      // Synthetic upstream headers. In particular, converting 350 digits
      // with Number() would overflow and accidentally impose only 600 sec.
      const start = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
      try {
        const upstream = vi.fn()
          .mockResolvedValueOnce(new Response('busy', {
            status, headers: { 'Retry-After': header },
          }))
          .mockResolvedValueOnce(new Response(osmPayload, { status: 200 }));
        vi.stubGlobal('fetch', upstream);
        const { GET } = await import('./route');
        const rejected = await GET();
        expect(rejected.status).toBe(503);
        expect(rejected.headers.get('Retry-After')).toBe(String(expectedSeconds));
        expect(rejected.headers.get('Cache-Control')).toBe('no-store');

        clock.mockReturnValue(start + (expectedSeconds - 1) * 1000);
        const blocked = await GET();
        expect(blocked.status).toBe(503);
        expect(blocked.headers.get('Retry-After')).toBe('1');
        expect(upstream).toHaveBeenCalledTimes(1);

        clock.mockReturnValue(start + (expectedSeconds + 1) * 1000);
        const recovered = await GET();
        expect(recovered.status).toBe(200);
        expect((await recovered.json()).buildings).toHaveLength(1);
        expect(upstream).toHaveBeenCalledTimes(2);
      } finally {
        clock.mockRestore();
      }
    });

  it.each([502, 504])('preserves an explicitly stale dated footprint during gateway HTTP %i overload', async (status) => {
    const start = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      const upstream = vi.fn()
        .mockResolvedValueOnce(new Response(osmPayload, { status: 200 }))
        .mockResolvedValueOnce(new Response('gateway busy', {
          status, headers: { 'Retry-After': '3600' },
        }));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');
      const initial = await (await GET()).json();

      clock.mockReturnValue(start + day + 1000);
      const stale = await GET();
      expect(stale.status).toBe(200);
      expect(stale.headers.get('Cache-Control')).toBe('private, no-store');
      expect(stale.headers.get('Retry-After')).toBe('3600');
      expect(await stale.json()).toMatchObject({
        stale: true, fetchedAt: initial.fetchedAt, buildings: initial.buildings,
      });

      clock.mockReturnValue(start + day + 30 * 60 * 1000);
      expect((await GET()).status).toBe(200);
      expect(upstream).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('backs off exponentially after repeated upstream errors and resets after recovery', async () => {
    const start = Date.now();
    const minute = 60 * 1000;
    const day = 24 * 60 * minute;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      const upstream = vi.fn()
        .mockRejectedValueOnce(new Error('temporary connection failure'))
        .mockRejectedValueOnce(new Error('temporary connection failure'))
        .mockResolvedValueOnce(new Response(osmPayload, { status: 200 }))
        .mockRejectedValueOnce(new Error('new outage after recovery'));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');

      const first = await GET();
      expect(first.status).toBe(503);
      expect(first.headers.get('Retry-After')).toBe('600');
      expect(upstream).toHaveBeenCalledTimes(1);

      clock.mockReturnValue(start + 10 * minute + 1000);
      const second = await GET();
      expect(second.status).toBe(503);
      expect(second.headers.get('Retry-After')).toBe('1200');
      expect(upstream).toHaveBeenCalledTimes(2);

      // Waiting less than twenty minutes must not send a third public query.
      clock.mockReturnValue(start + 30 * minute);
      expect((await GET()).status).toBe(503);
      expect(upstream).toHaveBeenCalledTimes(2);

      clock.mockReturnValue(start + 30 * minute + 2000);
      const recovered = await GET();
      expect(recovered.status).toBe(200);
      expect((await recovered.json()).stale).toBe(false);
      expect(upstream).toHaveBeenCalledTimes(3);

      // An unrelated later outage starts at ten minutes again, while keeping
      // the previous source date visible as a clearly stale fallback.
      clock.mockReturnValue(start + day + 31 * minute);
      const stale = await GET();
      expect(stale.status).toBe(200);
      expect(stale.headers.get('Retry-After')).toBe('600');
      expect((await stale.json()).stale).toBe(true);
      expect(upstream).toHaveBeenCalledTimes(4);
    } finally {
      clock.mockRestore();
    }
  });

  it('counts a shared failed Overpass request once for concurrent map visitors', async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      const upstream = vi.fn()
        .mockRejectedValueOnce(new Error('shared upstream outage'))
        .mockRejectedValueOnce(new Error('second upstream outage'));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');

      const responses = await Promise.all([GET(), GET(), GET(), GET(), GET()]);
      expect(upstream).toHaveBeenCalledTimes(1);
      for (const response of responses) {
        expect(response.status).toBe(503);
        expect(response.headers.get('Retry-After')).toBe('600');
      }
      clock.mockReturnValue(start + 10 * 60 * 1000 + 1000);
      const secondAttempt = await GET();
      expect(secondAttempt.status).toBe(503);
      expect(secondAttempt.headers.get('Retry-After')).toBe('1200');
      expect(upstream).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it.each([400, 403, 406])('backs off for 24 hours after an Overpass HTTP %i rejection', async (status) => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      const upstream = vi.fn()
        .mockResolvedValueOnce(new Response('client rejected', { status }))
        .mockResolvedValueOnce(new Response(osmPayload, { status: 200 }));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');

      const blocked = await GET();
      expect(blocked.status).toBe(503);
      expect(blocked.headers.get('Cache-Control')).toBe('no-store');
      expect(blocked.headers.get('Retry-After')).toBe('86400');

      clock.mockReturnValue(start + 11 * 60 * 1000);
      expect((await GET()).headers.get('Retry-After')).toBe('85740');
      clock.mockReturnValue(start + 23 * 60 * 60 * 1000);
      expect((await GET()).status).toBe(503);
      expect(upstream).toHaveBeenCalledTimes(1);

      clock.mockReturnValue(start + 24 * 60 * 60 * 1000 + 1000);
      const recovered = await GET();
      expect(recovered.status).toBe(200);
      expect((await recovered.json()).stale).toBe(false);
      expect(upstream).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it.each([400, 403, 406])('retains a dated stale snapshot during HTTP %i cooldown', async (status) => {
    const start = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      const upstream = vi.fn()
        .mockResolvedValueOnce(new Response(osmPayload, { status: 200 }))
        .mockResolvedValueOnce(new Response('client rejected', { status }));
      vi.stubGlobal('fetch', upstream);
      const { GET } = await import('./route');

      const initial = await (await GET()).json();
      clock.mockReturnValue(start + day + 1000);
      const stale = await GET();
      expect(stale.status).toBe(200);
      expect(stale.headers.get('Cache-Control')).toBe('private, no-store');
      expect((await stale.json())).toMatchObject({ stale: true, fetchedAt: initial.fetchedAt });

      clock.mockReturnValue(start + day + 12 * 60 * 60 * 1000);
      const stillStale = await GET();
      expect(stillStale.status).toBe(200);
      expect((await stillStale.json())).toMatchObject({ stale: true, fetchedAt: initial.fetchedAt });
      expect(upstream).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
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
      expect(stale.headers.get('Retry-After')).toBe('5400');
      expect((await stale.json()).fetchedAt).toBe(initial.fetchedAt);

      clock.mockReturnValue(refreshAt + 60 * 60 * 1000);
      const coolingResponse = await GET();
      expect(coolingResponse.headers.get('Retry-After')).toBe('1800');
      const stillStale = await coolingResponse.json();
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
      .mockResolvedValueOnce({ ok: true,
      status: 200, headers: { get: () => null }, text: async () => osmPayload })
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

  it('does not silently replace a dated building with contradictory geometry under the same OSM replication timestamp', async () => {
    // A replica must not assert two different heights/shapes for one identical
    // database snapshot. Keep the last dated fallback until a newer snapshot
    // can be verified; this is a synthetic upstream inconsistency fixture.
    const start = Date.parse('2026-11-12T08:00:00Z');
    const firstBase = '2026-11-12T07:00:00Z';
    const nextBase = '2026-11-13T07:00:00Z';
    const original = JSON.parse(osmPayload);
    const payload = (base: string, height?: string) => JSON.stringify({
      osm3s: { timestamp_osm_base: base },
      elements: original.elements.map((element: { tags: Record<string, string> }) => ({
        ...element, tags: height ? { ...element.tags, height } : element.tags,
      })),
    });
    const upstream = vi.fn()
      .mockResolvedValueOnce(new Response(payload(firstBase), { status: 200 }))
      .mockResolvedValueOnce(new Response(payload(firstBase, '90 m'), { status: 200 }))
      .mockResolvedValueOnce(new Response(payload(nextBase, '90 m'), { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      const { GET } = await import('./route');
      const initial = await (await GET()).json();
      expect(initial.stale).toBe(false);
      expect(initial.osmBaseAt).toBe(firstBase);
      expect(initial.buildings[0].heightBasis).toBe('illustrative');

      clock.mockReturnValue(start + 25 * 60 * 60 * 1000);
      const inconsistent = await GET();
      expect(inconsistent.status).toBe(200);
      expect(inconsistent.headers.get('Cache-Control')).toBe('private, no-store');
      expect(inconsistent.headers.get('Retry-After')).toBe('600');
      const retained = await inconsistent.json();
      expect(retained.stale).toBe(true);
      expect(retained.osmBaseAt).toBe(firstBase);
      expect(retained.fetchedAt).toBe(initial.fetchedAt);
      expect(retained.buildings).toEqual(initial.buildings);
      expect((await GET()).status).toBe(200);
      expect(upstream).toHaveBeenCalledTimes(2);

      clock.mockReturnValue(start + 25 * 60 * 60 * 1000 + 11 * 60 * 1000);
      const recovered = await (await GET()).json();
      expect(recovered.stale).toBe(false);
      expect(recovered.osmBaseAt).toBe(nextBase);
      expect(recovered.buildings[0]).toMatchObject({
        heightMeters: 90, heightBasis: 'osm-tag',
      });
      expect(upstream).toHaveBeenCalledTimes(3);
    } finally {
      clock.mockRestore();
    }
  });

  it('may refresh unchanged buildings with the same valid OSM replication timestamp', async () => {
    const start = Date.parse('2026-11-12T08:00:00Z');
    const source = JSON.stringify({
      osm3s: { timestamp_osm_base: '2026-11-12T07:00:00Z' },
      ...JSON.parse(osmPayload),
    });
    const upstream = vi.fn().mockImplementation(async () => new Response(source, { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      const { GET } = await import('./route');
      const initial = await (await GET()).json();
      clock.mockReturnValue(start + 25 * 60 * 60 * 1000);
      const refreshed = await GET();
      expect(refreshed.status).toBe(200);
      expect(refreshed.headers.get('Retry-After')).toBeNull();
      const body = await refreshed.json();
      expect(body.stale).toBe(false);
      expect(body.buildings).toEqual(initial.buildings);
      expect(body.osmBaseAt).toBe(initial.osmBaseAt);
      expect(body.fetchedAt).not.toBe(initial.fetchedAt);
      expect(upstream).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });
});
