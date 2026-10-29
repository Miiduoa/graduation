/** 靜宜校園轉送共用簽章與白名單。必須與 `deploy/edge-relay/src/protocol.ts`、Functions `puCampusTransport.js` 保持一致。Supabase 轉送直接 import 那份 protocol，不要再複製。 */

export const RELAY_TS_HEADER = 'x-pu-relay-ts';
export const RELAY_NONCE_HEADER = 'x-pu-relay-nonce';
export const RELAY_SIGN_HEADER = 'x-pu-relay-sign';
export const RELAY_TARGET_HEADER = 'x-pu-relay-target';
export const RELAY_COLO_HEADER = 'x-pu-relay-colo';
export const RELAY_REPLAY_WINDOW_SECONDS = 60;
export const RELAY_NONCE_PATTERN = /^[0-9a-f]{32}$/;
export const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export const TAIWAN_NEAR_COLOS = ['TPE', 'KHH'] as const;

const DEFAULT_ALLOWED_HOSTS = ['*.pu.edu.tw'];

export type RelaySignFields = {
  timestamp: string;
  nonce: string;
  method: string;
  target: string;
  bodySha256: string;
  cookie: string;
  contentType: string;
};

export function normalizeRelayHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/g, '');
}

export function normalizeRelayTarget(target: string): string | null {
  try {
    const url = new URL(target);
    const host = normalizeRelayHostname(url.hostname);
    if (!host) return null;
    url.hostname = host;
    return url.toString();
  } catch {
    return null;
  }
}

export function relayCanonical(fields: RelaySignFields): string {
  const verb = fields.method.trim().toUpperCase() || 'GET';
  return [
    fields.timestamp,
    fields.nonce.trim().toLowerCase(),
    verb,
    fields.target,
    fields.bodySha256.trim().toLowerCase(),
    fields.cookie,
    fields.contentType,
  ].join('\n');
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function timingSafeEqualHex(left: string, right: string): boolean {
  const a = hexToBytes(left);
  const b = hexToBytes(right);
  if (!a || !b || a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(mac));
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(data);
  return copy;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(data));
  return bytesToHex(new Uint8Array(digest));
}

export function randomRelayNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function relayHeaderValues(headers: Headers): { cookie: string; contentType: string } {
  return {
    cookie: headers.get('cookie') ?? '',
    contentType: headers.get('content-type') ?? '',
  };
}

export async function signRelayRequest(secret: string, fields: RelaySignFields): Promise<string> {
  return hmacSha256Hex(secret, relayCanonical(fields));
}

export function isRelayTimestampFresh(
  timestamp: string,
  nowMs = Date.now(),
  windowSeconds = RELAY_REPLAY_WINDOW_SECONDS,
): boolean {
  if (!/^[0-9]{1,12}$/.test(timestamp)) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return false;
  const now = Math.floor(nowMs / 1000);
  return Math.abs(now - ts) <= windowSeconds;
}

export function parseAllowedHosts(raw: string | undefined | null): string[] {
  const items = String(raw || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return items.length > 0 ? items : [...DEFAULT_ALLOWED_HOSTS];
}

export function hostnameMatchesAllowlist(hostname: string, patterns: readonly string[]): boolean {
  const host = normalizeRelayHostname(hostname);
  if (!host || host.includes(':')) return false;
  return patterns.some((pattern) => {
    const item = pattern.trim().toLowerCase();
    if (!item || item === '*') return false;
    if (item.startsWith('*.')) {
      const suffix = item.slice(1);
      return suffix.startsWith('.') && host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === item;
  });
}

export function isAllowedRelayTarget(target: string, patterns: readonly string[]): boolean {
  try {
    const url = new URL(target);
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    if (url.port && url.port !== '443') return false;
    return hostnameMatchesAllowlist(url.hostname, patterns);
  } catch {
    return false;
  }
}

export function parseCfPlacement(placement: string): { kind: 'local' | 'remote' | ''; colo: string } {
  const raw = placement.trim();
  const placed = raw.match(/^(local|remote)-([A-Za-z0-9]{3})$/i);
  if (placed) return { kind: placed[1]!.toLowerCase() as 'local' | 'remote', colo: placed[2]!.toUpperCase() };
  if (/^[A-Za-z]{3}$/.test(raw)) return { kind: '', colo: raw.toUpperCase() };
  return { kind: '', colo: '' };
}

export function isTaiwanNearbyColo(colo: string): boolean {
  return (TAIWAN_NEAR_COLOS as readonly string[]).includes(colo.trim().toUpperCase());
}

export function isRelayPlacementMiss(placement: string): boolean {
  return !isTaiwanNearbyColo(parseCfPlacement(placement).colo);
}

export function readRequestPlacement(request: Request): string {
  const header = request.headers.get('cf-placement')?.trim() || '';
  if (header) return header;
  const cf = (request as Request & { cf?: { placement?: string } }).cf;
  if (typeof cf?.placement === 'string' && cf.placement.trim()) return cf.placement.trim();
  return '';
}

export async function verifyRelaySignature(options: {
  secret: string;
  fields: RelaySignFields;
  signature: string;
  nowMs?: number;
}): Promise<boolean> {
  if (!options.secret || !options.signature) return false;
  if (!RELAY_NONCE_PATTERN.test(options.fields.nonce.trim().toLowerCase())) return false;
  if (!/^[0-9a-f]{64}$/.test(options.fields.bodySha256.trim().toLowerCase())) return false;
  if (!isRelayTimestampFresh(options.fields.timestamp, options.nowMs)) return false;
  const expected = await signRelayRequest(options.secret, options.fields);
  return timingSafeEqualHex(expected, options.signature.trim().toLowerCase());
}
