import { NextResponse } from 'next/server';
import {
  parseProvidenceOsmFootprints,
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
// Overpass exposes its database replication time separately from each way's edit
// time. A freshly fetched HTTP response can still contain days-old map state.
const MAX_OVERPASS_REPLICATION_LAG_MS = 48 * 60 * 60 * 1000;

function verifyOverpassReplicationTime(payload: unknown, now: number): void {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  const metadata = (payload as Record<string, unknown>).osm3s;
  // Older/mock-compatible replies without replication metadata still follow the
  // existing whitelist/geometry rules. Validate the timestamp whenever supplied.
  if (metadata === undefined) return;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Invalid Overpass replication metadata');
  }
  const timestamp = (metadata as Record<string, unknown>).timestamp_osm_base;
  if (timestamp === undefined) return;
  if (typeof timestamp !== 'string' ||
      !/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/.test(timestamp)) {
    throw new Error('Invalid Overpass replication timestamp');
  }
  const baseMs = Date.parse(timestamp);
  if (!Number.isFinite(baseMs) || new Date(baseMs).toISOString().replace('.000Z', 'Z') !== timestamp ||
      baseMs > now + 5 * 60 * 1000 || now - baseMs > MAX_OVERPASS_REPLICATION_LAG_MS) {
    throw new Error('Overpass replication timestamp is not recent');
  }
}

class OverpassRateLimitError extends Error {
  constructor(readonly cooldownMs: number) {
    super('OSM service asked to retry later');
  }
}

function overpassRetryAfterMs(header: string | null, now: number): number {
  if (!header) return ERROR_COOLDOWN_MS;
  const value = header.trim();
  let requestedMs: number;
  if (/^\d+$/.test(value)) {
    requestedMs = Number(value) * 1000;
  } else {
    const dateMs = Date.parse(value);
    requestedMs = Number.isFinite(dateMs) ? dateMs - now : NaN;
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
const query = '[out:json][timeout:12];way(id:' +
  PROVIDENCE_OSM_BUILDING_WAY_IDS.join(',') + ');out meta geom;';

type Snapshot = { buildings: ProvidenceFootprint[]; fetchedAt: string; validUntil: number; discardAfter: number };
let cache: Snapshot | null = null;
let pending: Promise<Snapshot> | null = null;
let unavailableUntil = 0;

// Overpass can omit Content-Length or serve compressed responses. Stop reading at the
// decoded byte limit; checking .text().length afterwards would still buffer an
// unbounded upstream response in the Node process.
async function readBoundedResponse(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_RESPONSE_BYTES) {
    throw new Error('OSM response too large');
  }
  if (!response.body) {
    // Covers non-streaming fetch mocks; production Node fetch supplies a stream.
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error('OSM response too large');
    }
    return raw;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const segments: string[] = [];
  let size = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { completed = true; break; }
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('OSM response too large');
      segments.push(decoder.decode(value, { stream: true }));
    }
    segments.push(decoder.decode());
    return segments.join('');
  } finally {
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readOsm(): Promise<Snapshot> {
  const url = OVERPASS_ENDPOINT + '?data=' + encodeURIComponent(query);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      // Identify this service to the public Overpass instance per its usage policy.
      'User-Agent': 'nuni-campus-spatial/1.0 (https://nuni.tw)',
    },
  });
  if (!response.ok) {
    // 429 and 503 can contain a server-provided cooldown. Do not retry against
    // the public endpoint every ten minutes when it explicitly requests longer.
    if (response.status === 429 || response.status === 503) {
      throw new OverpassRateLimitError(overpassRetryAfterMs(
        response.headers.get('retry-after'), Date.now(),
      ));
    }
    throw new Error('OSM service unavailable');
  }
  const raw = await readBoundedResponse(response);
  const payload = JSON.parse(raw) as unknown;
  verifyOverpassReplicationTime(payload, Date.now());
  // Overpass may return HTTP 200 with partial elements plus a top-level "remark"
  // on timeout or memory exhaustion. Never promote that partial result to a
  // fresh 24-hour snapshot or replace a previously verified fallback.
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'remark' in payload) {
    throw new Error('Overpass returned an incomplete result');
  }
  const buildings = parseProvidenceOsmFootprints(payload);
  if (!buildings.length) throw new Error('No verified building outlines in response');
  const now = Date.now();
  return {
    buildings, fetchedAt: new Date(now).toISOString(),
    validUntil: now + REFRESH_MS, discardAfter: now + MAX_SNAPSHOT_AGE_MS,
  };
}

export async function GET() {
  const now = Date.now();
  if (cache && cache.validUntil > now) {
    return NextResponse.json({
      schoolId: 'pu', source: 'OpenStreetMap', fetchedAt: cache.fetchedAt,
      stale: false, buildings: cache.buildings,
    }, { headers: { 'Cache-Control': freshCacheControl(cache.validUntil) } });
  }
  if (unavailableUntil > now) {
    if (!cache) return NextResponse.json({ error: 'Building outlines temporarily unavailable' }, {
      status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': retryAfterSeconds() },
    });
  } else {
    try {
      if (!pending) pending = readOsm().finally(() => { pending = null; });
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
    schoolId: 'pu', source: 'OpenStreetMap', fetchedAt: cache.fetchedAt,
    stale: cache.validUntil <= Date.now(), buildings: cache.buildings,
  }, {
    // 有舊快照時保留舊輪廓並明示來源日期，不把快取說成最新。
    headers: { 'Cache-Control': cache.validUntil <= Date.now()
      ? 'private, no-store' : freshCacheControl(cache.validUntil) },
  });
}
