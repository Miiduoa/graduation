/** 靜宜校園轉送共用簽章與白名單。必須與 nuni-web `puEdgeRelayProtocol.ts`、Functions `puCampusTransport.js` 保持一致。 */

export const RELAY_TS_HEADER = 'x-pu-relay-ts';
export const RELAY_SIGN_HEADER = 'x-pu-relay-sign';
export const RELAY_TARGET_HEADER = 'x-pu-relay-target';
export const RELAY_COLO_HEADER = 'x-pu-relay-colo';
export const RELAY_REPLAY_WINDOW_SECONDS = 60;

const DEFAULT_ALLOWED_HOSTS = ['*.pu.edu.tw'];

export function relayCanonical(timestamp: string, method: string, target: string): string {
  const verb = method.trim().toUpperCase() || 'GET';
  return `${timestamp}\n${verb}\n${target}`;
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

export async function signRelayRequest(
  secret: string,
  timestamp: string,
  method: string,
  target: string,
): Promise<string> {
  return hmacSha256Hex(secret, relayCanonical(timestamp, method, target));
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
  const host = hostname.trim().toLowerCase();
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

export async function verifyRelaySignature(options: {
  secret: string;
  timestamp: string;
  method: string;
  target: string;
  signature: string;
  nowMs?: number;
}): Promise<boolean> {
  if (!options.secret || !options.signature) return false;
  if (!isRelayTimestampFresh(options.timestamp, options.nowMs)) return false;
  const expected = await signRelayRequest(
    options.secret,
    options.timestamp,
    options.method,
    options.target,
  );
  return timingSafeEqualHex(expected, options.signature.trim().toLowerCase());
}
