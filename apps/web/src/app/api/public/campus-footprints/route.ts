import { NextResponse } from 'next/server';
import {
  parseProvidenceOsmFootprints,
  stripOsmRevisionsAfter,
  PROVIDENCE_OSM_BUILDING_WAY_IDS,
  type ProvidenceFootprint,
} from '@/app/map/providenceFootprints';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 只向固定的公開 OSM 查已校核的 way ID；沒有使用者控制的 URL／Overpass 查詢。
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const REFRESH_MS = 24 * 60 * 60 * 1000;
// A failed upstream must not leave a removed/renamed building visible forever.
const MAX_SNAPSHOT_AGE_MS = 7 * REFRESH_MS;
const ERROR_COOLDOWN_MS = 10 * 60 * 1000;
// A public Overpass instance may ask clients to pause longer after rate limiting.
// Respect its Retry-After while bounding malformed or extreme upstream values.
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 500_000;
// A misbehaving upstream can emit unlimited empty/tiny ReadableStream chunks.
// Cap the number of reads as well as bytes so microtasks cannot indefinitely
// starve the 12-second deadline timer or monopolize the Node event loop.
const MAX_RESPONSE_STREAM_CHUNKS = 8_192;
// AbortSignal is advisory: intermediaries and stream mocks may never settle.
// Bound the entire upstream operation so global pending requests can recover.
const OVERPASS_REQUEST_DEADLINE_MS = 12_000;
// Overpass exposes its database replication time separately from each way's edit
// time. A freshly fetched HTTP response can still contain days-old map state.
const MAX_OVERPASS_REPLICATION_LAG_MS = 48 * 60 * 60 * 1000;

function verifyOverpassReplicationTime(payload: unknown, now: number): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const metadata = (payload as Record<string, unknown>).osm3s;
  // Older/mock-compatible replies without replication metadata still follow the
  // existing whitelist/geometry rules. Validate the timestamp whenever supplied.
  if (metadata === undefined) return null;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Invalid Overpass replication metadata');
  }
  const timestamp = (metadata as Record<string, unknown>).timestamp_osm_base;
  // An explicit osm3s header without a usable database timestamp is not
  // equivalent to a legacy response lacking the header entirely. Otherwise a
  // malformed upstream reply would gain a 24-hour "fresh" OSM label despite
  // providing no proof of when its replicated map data was last updated.
  if (timestamp === undefined) throw new Error('Missing Overpass replication timestamp');
  if (typeof timestamp !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp)) {
    throw new Error('Invalid Overpass replication timestamp');
  }
  const baseMs = Date.parse(timestamp);
  if (!Number.isFinite(baseMs) || new Date(baseMs).toISOString().replace('.000Z', 'Z') !== timestamp ||
      baseMs > now + 5 * 60 * 1000 || now - baseMs > MAX_OVERPASS_REPLICATION_LAG_MS) {
    throw new Error('Overpass replication timestamp is not recent');
  }
  return timestamp;
}

class OverpassRateLimitError extends Error {
  constructor(readonly cooldownMs: number) {
    super('OSM service asked to retry later');
  }
}

function overpassRetryAfterMs(header: string | null, now: number, serverDate: string | null = null): number {
  if (!header) return ERROR_COOLDOWN_MS;
  const value = header.trim();
  let requestedMs: number;
  if (/^\d+$/.test(value)) {
    // HTTP delta-seconds may be arbitrarily long. Number(value) * 1000 can
    // overflow to Infinity, which previously fell back to just ten minutes
    // instead of respecting a public Overpass operator's longer pause.
    // Strip leading zeros, then cap *before* numeric conversion.
    const digits = value.replace(/^0+/, '') || '0';
    requestedMs = digits.length > 5 || (digits.length === 5 && digits >= '86400')
      ? MAX_RETRY_AFTER_MS : Number(digits) * 1000;
  } else {
    const dateMs = Date.parse(value);
    // HTTP-date Retry-After and the upstream Date share the same server clock.
    // If our host is ahead, local subtraction alone can shorten a one-hour
    // pause to the ten-minute default and repeatedly overload public Overpass.
    // Keep the more conservative of the local and server-relative durations.
    const originMs = serverDate === null ? NaN : Date.parse(serverDate);
    requestedMs = Number.isFinite(dateMs)
      ? Math.max(dateMs - now, Number.isFinite(originMs) ? dateMs - originMs : -Infinity)
      : NaN;
  }
  if (!Number.isFinite(requestedMs) || requestedMs <= 0) return ERROR_COOLDOWN_MS;
  return Math.max(ERROR_COOLDOWN_MS, Math.min(MAX_RETRY_AFTER_MS, requestedMs));
}

function retryAfterSeconds(): string {
  return String(Math.max(1, Math.ceil((unavailableUntil - Date.now()) / 1000)));
}

// A shared cache must not outlive the 24-hour origin snapshot. In particular,
// a hit just before validUntil must not advertise another full hour of freshness.
function freshCacheControl(validUntil: number): string {
  const secondsRemaining = Math.max(0, Math.floor((validUntil - Date.now()) / 1000));
  return `public, max-age=0, s-maxage=${Math.min(3600, secondsRemaining)}`;
}
// Keep Overpass's own 8-second execution budget below our 12-second network
// deadline, leaving transport headroom; bound its server-side memory to 64 MiB.
const query = '[out:json][timeout:8][maxsize:67108864];way(id:' +
  PROVIDENCE_OSM_BUILDING_WAY_IDS.join(',') + ');out meta geom;';

type Snapshot = { buildings: ProvidenceFootprint[]; fetchedAt: string; osmBaseAt: string | null; validUntil: number; discardAfter: number };
let cache: Snapshot | null = null;
let pending: Promise<Snapshot> | null = null;
let unavailableUntil = 0;

// Overpass can omit Content-Length or serve compressed responses. Stop reading at the
// decoded byte limit; checking .text().length afterwards would still buffer an
// unbounded upstream response in the Node process.
async function readBoundedResponse(response: Response, signal: AbortSignal): Promise<string> {
  // RFC Content-Length consists solely of decimal digits. Number() also
  // accepts blank, hex, exponent and fractional representations that are not
  // valid HTTP lengths. Missing is fine: the streaming byte cap still applies.
  const lengthHeader = response.headers.get('content-length');
  const declared = lengthHeader === null ? 0
    : /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : NaN;
  // For identity-encoded responses, a body that ends at a different byte count
  // from its declared Content-Length is not a verified full Overpass result.
  // Fetch may transparently decompress gzip/br while retaining the *encoded*
  // length header, so comparing those lengths would reject valid compressed
  // responses. Keep the decoded 500 KB cap for every encoding.
  const contentEncoding = response.headers.get('content-encoding');
  const coding = contentEncoding?.trim().toLowerCase() ?? 'identity';
  // Node Fetch transparently decodes these single HTTP content codings.
  // A blank, unknown or stacked/mixed coding cannot safely tell us whether
  // Content-Length measures the decoded bytes. Do not silently classify an
  // ambiguous identity response as compressed and skip its length check.
  if (!['identity', 'gzip', 'br', 'deflate'].includes(coding)) {
    if (response.body) void response.body.cancel().catch(() => {});
    throw new Error('Unsupported OSM content encoding');
  }
  const identityEncoded = coding === 'identity';
  const verifyIdentityLength = lengthHeader !== null && identityEncoded;
  // Fetch delivers decoded bytes, while Content-Length for gzip/br describes
  // compressed wire bytes. A valid compressed response can exceed the decoded
  // cap on the wire (compression adds framing overhead), so do not reject it
  // as if the header measured the decoded body. Still bound both the declared
  // encoded transport (2x) and the streamed decoded payload (500 KB).
  const declaredLimit = identityEncoded ? MAX_RESPONSE_BYTES : MAX_RESPONSE_BYTES * 2;
  if (!Number.isSafeInteger(declared) || declared > declaredLimit) {
    // The response body may still be streaming even though the declared size
    // already violates our limit. Cancel without awaiting: an uncooperative
    // upstream must not hold the shared request open while cancellation stalls.
    if (response.body) void response.body.cancel().catch(() => {});
    throw new Error('OSM response too large');
  }
  // Any HTTP 200 Overpass JSON snapshot requires a non-empty body. A declared
  // zero-byte identity *or* compressed response cannot contain verified map
  // data. Reject it before reading: even a stalled stream must not consume the
  // full 12-second deadline when its header already contradicts the payload.
  if (lengthHeader !== null && declared === 0) {
    if (response.body) void response.body.cancel().catch(() => {});
    throw new Error('OSM response declares an empty body');
  }
  if (!response.body) {
    // Covers non-streaming fetch mocks; production Node fetch supplies a stream.
    const raw = await response.text();
    const byteLength = new TextEncoder().encode(raw).byteLength;
    if (byteLength > MAX_RESPONSE_BYTES) throw new Error('OSM response too large');
    if (verifyIdentityLength && byteLength !== declared) {
      throw new Error('OSM response length mismatch');
    }
    return raw;
  }
  const reader = response.body.getReader();
  // A fetch may deliver headers and then stop sending data. Aborting fetch is
  // not guaranteed to cancel an already-exposed body reader (or a proxy mock).
  // Cancel the reader directly when the server-side deadline expires. Never
  // await cancellation: a broken stream may never acknowledge it.
  const cancelOnAbort = () => { void reader.cancel().catch(() => {}); };
  if (signal.aborted) cancelOnAbort();
  else signal.addEventListener('abort', cancelOnAbort, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const segments: string[] = [];
  let size = 0;
  let chunks = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      // Cancellation can make a read finish normally. Never promote that
      // truncated stream into an apparently complete Overpass snapshot.
      if (signal.aborted) throw new Error('OSM response aborted');
      if (done) { completed = true; break; }
      // Count empty chunks too: the byte cap alone cannot stop a zero-byte
      // stream from spinning through unbounded already-resolved reads.
      if (++chunks > MAX_RESPONSE_STREAM_CHUNKS) {
        throw new Error('OSM response exceeded chunk limit');
      }
      size += value.byteLength;
      // On identity responses, the first byte beyond Content-Length already
      // proves truncation/overdelivery. Do not wait for EOF from an upstream
      // stream that could stall indefinitely after sending too many bytes.
      if (verifyIdentityLength && size > declared) {
        throw new Error('OSM response length mismatch');
      }
      if (size > MAX_RESPONSE_BYTES) throw new Error('OSM response too large');
      segments.push(decoder.decode(value, { stream: true }));
      // A long sequence of already-resolved reads can starve timers even
      // before reaching the absolute chunk cap. Give Node's event loop a
      // chance to run the deadline and other requests every 128 chunks.
      if (chunks % 128 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (signal.aborted) throw new Error('OSM response aborted');
      }
    }
    if (verifyIdentityLength && size !== declared) {
      throw new Error('OSM response length mismatch');
    }
    segments.push(decoder.decode());
    return segments.join('');
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
    if (!completed && !signal.aborted) {
      // Cancellation is best-effort. A broken proxy/stream can accept a cancel
      // request but never settle its promise; waiting here turns an already
      // rejected oversized payload into a 12-second server timeout.
      void reader.cancel().catch(() => {});
    }
    reader.releaseLock();
  }
}

async function readOsm(signal: AbortSignal): Promise<Snapshot> {
  const url = OVERPASS_ENDPOINT + '?data=' + encodeURIComponent(query);
  const response = await fetch(url, {
    signal,
    cache: 'no-store',
    // Do not follow redirects from the fixed public Overpass origin. A 3xx
    // pointing at a different host (including a private network) must fail
    // rather than turn this server-side fetch into an SSRF request.
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      // Identify this service to the public Overpass instance per its usage policy.
      'User-Agent': 'nuni-campus-spatial/1.0 (https://nuni.tw)',
    },
  });
  // Overpass returns one complete JSON document on HTTP 200. Fetch's ok flag
  // also accepts 206 Partial Content and other 2xx codes: a truncated or
  // intermediary-transformed reply must never become a 24-hour OSM snapshot.
  if (response.status !== 200) {
    // Fetch resolves as soon as headers arrive; error bodies may keep streaming
    // indefinitely (including 406/429/503 responses from a congested proxy).
    // We only need status/Retry-After. Release the unused body immediately,
    // without awaiting cancellation from an uncooperative upstream.
    if (response.body) void response.body.cancel().catch(() => {});
    // A malformed fixed query (400) or blocked/forbidden client (403/406)
    // cannot recover by hammering public Overpass every ten minutes.
    // Allow a full-day cooldown; do not treat these as transient congestion.
    if (response.status === 400 || response.status === 403 || response.status === 406) {
      throw new OverpassRateLimitError(MAX_RETRY_AFTER_MS);
    }
    // Public Overpass and intermediaries may request an extended cooldown for
    // partial replies, request timeouts and gateway/server failures as well as
    // ordinary 429 limits. All these responses are rejected without reading a
    // body, but their Retry-After must still protect the upstream service.
    if (response.status === 206 || response.status === 408 ||
        response.status === 429 || response.status >= 500) {
      throw new OverpassRateLimitError(overpassRetryAfterMs(
        response.headers.get('retry-after'), Date.now(), response.headers.get('date'),
      ));
    }
    throw new Error('OSM service unavailable');
  }
  // A 200 OK with Content-Range still advertises a byte-range representation.
  // A proxy must not promote a partial map export into a fresh campus snapshot,
  // even when the returned fragment happens to be syntactically valid JSON.
  if (response.headers.get('content-range') !== null) {
    if (response.body) void response.body.cancel().catch(() => {});
    // Even HTTP 200 is not a complete source when a proxy sends Content-Range.
    // Retain any upstream cooldown instead of retrying a partial response at 10m.
    throw new OverpassRateLimitError(overpassRetryAfterMs(
      response.headers.get('retry-after'), Date.now(), response.headers.get('date'),
    ));
  }
  let raw: string;
  try {
    raw = await readBoundedResponse(response, signal);
  } catch (error) {
    // Overpass or an intermediary can return HTTP 200 with unusable framing
    // (empty/oversized/invalid stream) and still request a longer cooldown.
    // Reject the geometry as before, but respect that explicit retry window
    // rather than sending another request after our default ten minutes.
    const retryAfter = response.headers.get('retry-after');
    if (!signal.aborted && retryAfter !== null) {
      throw new OverpassRateLimitError(overpassRetryAfterMs(
        retryAfter, Date.now(), response.headers.get('date'),
      ));
    }
    throw error;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    // Some overloaded public proxies return an incomplete HTTP 200 body
    // with Retry-After. Never cache truncated JSON or shorten their pause.
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter !== null) {
      throw new OverpassRateLimitError(overpassRetryAfterMs(retryAfter, Date.now(), response.headers.get('date')));
    }
    throw new Error('Invalid Overpass JSON');
  }
  // Check a partial-result remark before replication metadata, since an
  // incomplete OSM response may also have an incomplete osm3s header.
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'remark' in payload) {
    throw new OverpassRateLimitError(overpassRetryAfterMs(
      response.headers.get('retry-after'), Date.now(), response.headers.get('date'),
    ));
  }
  const osmBaseAt = verifyOverpassReplicationTime(payload, Date.now());
  const now = Date.now();
  // A way's edit timestamp cannot be newer than the Overpass replication
  // snapshot that contains it. Preserve checked geometry, but drop any
  // contradictory revision label rather than advertising false provenance.
  // Legacy replies without osm3s are bounded by their HTTP fetch time.
  const buildings = stripOsmRevisionsAfter(
    parseProvidenceOsmFootprints(payload),
    osmBaseAt ? Date.parse(osmBaseAt) : now,
  );
  if (!buildings.length) {
    // A valid JSON object can still contain no verified outlines during an
    // upstream partial/outage response. Never cache it as a fresh map. If the
    // origin explicitly asks us to pause, do not retry after only ten minutes.
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter !== null) {
      throw new OverpassRateLimitError(overpassRetryAfterMs(
        retryAfter, Date.now(), response.headers.get('date'),
      ));
    }
    throw new Error('No verified building outlines in response');
  }
  // The 48-hour replication-age check must remain true for the *entire* time
  // this snapshot is presented as fresh, not only when Overpass was fetched.
  // Otherwise a 47-hour-old OSM database could be marked fresh for another
  // 24 hours. Older Overpass replies without metadata keep the normal TTL.
  const replicationDeadline = osmBaseAt === null
    ? Number.POSITIVE_INFINITY : Date.parse(osmBaseAt) + MAX_OVERPASS_REPLICATION_LAG_MS;
  const validUntil = Math.min(now + REFRESH_MS, replicationDeadline);
  if (validUntil <= now) throw new Error('Overpass replication expired while reading');
  return {
    buildings, fetchedAt: new Date(now).toISOString(), osmBaseAt,
    validUntil,
    // The fallback cannot be younger than the underlying OSM database state.
    // A 47-hour replication lag must not silently extend seven-day retention.
    discardAfter: Math.min(now + MAX_SNAPSHOT_AGE_MS,
      osmBaseAt === null ? Number.POSITIVE_INFINITY : Date.parse(osmBaseAt) + MAX_SNAPSHOT_AGE_MS),
  };
}

/** A stalled fetch OR response body must never hold the shared pending promise
 * indefinitely. Aborting releases cooperative clients; the independent deadline
 * settles this request even if the upstream ignores AbortSignal.
 * readOsm only returns a Snapshot and cannot mutate the live cache after timeout.
 */
async function readOsmWithDeadline(): Promise<Snapshot> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('OSM request deadline exceeded'));
    }, OVERPASS_REQUEST_DEADLINE_MS);
  });
  try {
    return await Promise.race([readOsm(controller.signal), deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function GET() {
  const now = Date.now();
  if (cache && cache.validUntil > now) {
    return NextResponse.json({
      schoolId: 'pu', source: 'OpenStreetMap', fetchedAt: cache.fetchedAt, osmBaseAt: cache.osmBaseAt,
      stale: false, buildings: cache.buildings,
    }, { headers: { 'Cache-Control': freshCacheControl(cache.validUntil) } });
  }
  if (unavailableUntil > now) {
    if (!cache) return NextResponse.json({ error: 'Building outlines temporarily unavailable' }, {
      status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': retryAfterSeconds() },
    });
  } else {
    try {
      if (!pending) pending = readOsmWithDeadline().finally(() => { pending = null; });
      cache = await pending;
      unavailableUntil = 0;
    } catch (error) {
      unavailableUntil = Date.now() + (error instanceof OverpassRateLimitError
        ? error.cooldownMs : ERROR_COOLDOWN_MS);
    }
  }
  // Stale is an outage fallback, not an unlimited-lived source of campus geometry.
  // Expired geometry must fall back to the existing POI/map experience instead.
  if (!cache || cache.discardAfter <= Date.now()) return NextResponse.json({
    error: 'Building outlines temporarily unavailable',
  }, {
    status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': retryAfterSeconds() },
  });
  return NextResponse.json({
    schoolId: 'pu', source: 'OpenStreetMap', fetchedAt: cache.fetchedAt, osmBaseAt: cache.osmBaseAt,
    stale: cache.validUntil <= Date.now(), buildings: cache.buildings,
  }, {
    // 有舊快照時保留舊輪廓並明示來源日期，不把快取說成最新。
    headers: {
      'Cache-Control': cache.validUntil <= Date.now()
        ? 'private, no-store' : freshCacheControl(cache.validUntil),
      // A valid dated fallback is still served with HTTP 200. Advertise the
      // current upstream cooldown so the client does not hammer a stale origin.
      ...(cache.validUntil <= Date.now() && unavailableUntil > Date.now()
        ? { 'Retry-After': retryAfterSeconds() } : {}),
    },
  });
}
