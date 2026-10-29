import { createIpv4PinnedFetch } from './campusIpv4Fetch';
import {
  isAllowedRelayTarget,
  isRelayPlacementMiss,
  normalizeRelayHostname,
  normalizeRelayTarget,
  randomRelayNonce,
  RELAY_COLO_HEADER,
  RELAY_NONCE_HEADER,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_TS_HEADER,
  relayHeaderValues,
  sha256Hex,
  signRelayRequest,
} from './puEdgeRelayProtocol';

export {
  hostnameMatchesAllowlist,
  isAllowedRelayTarget,
  isRelayPlacementMiss,
  isRelayTimestampFresh,
  normalizeRelayHostname,
  normalizeRelayTarget,
  parseAllowedHosts,
  parseCfPlacement,
  randomRelayNonce,
  RELAY_COLO_HEADER,
  RELAY_NONCE_HEADER,
  RELAY_REPLAY_WINDOW_SECONDS,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_TS_HEADER,
  relayCanonical,
  sha256Hex,
  signRelayRequest,
  timingSafeEqualHex,
  verifyRelaySignature,
} from './puEdgeRelayProtocol';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type PuEdgeRelayEnv = {
  PU_EDGE_RELAY_URL?: string;
  PU_EDGE_RELAY_SECRET?: string;
  PU_EDGE_RELAY_ALT_URL?: string;
  PU_EDGE_RELAY_ALT_SECRET?: string;
  PU_EDGE_RELAY_ALT_HOSTS?: string;
} & Record<string, string | undefined>;

export type PuEdgeRelayConfig = {
  url: string;
  secret: string;
};

export type PuEdgeRelayAltConfig = PuEdgeRelayConfig & { hosts: string[] };

export function readPuEdgeRelayConfig(
  env: PuEdgeRelayEnv | NodeJS.ProcessEnv = process.env,
): PuEdgeRelayConfig | null {
  const url = String(env.PU_EDGE_RELAY_URL || '').trim();
  const secret = String(env.PU_EDGE_RELAY_SECRET || '').trim();
  if (!url || !secret) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { url, secret };
}

/**
 * 備援轉送。`PU_EDGE_RELAY_ALT_URL`、`PU_EDGE_RELAY_ALT_SECRET`、
 * `PU_EDGE_RELAY_ALT_HOSTS` 三個都有設才生效；主機只做精確比對（不含萬用字元、不含子網域）。
 */
export function parseRelayAltHosts(raw: string | undefined | null): string[] {
  const seen = new Set<string>();
  const hosts: string[] = [];
  for (const item of String(raw || '').split(',')) {
    const host = normalizeRelayHostname(item);
    if (!host || host.includes('*') || host.includes('/') || host.includes(':') || seen.has(host)) {
      continue;
    }
    seen.add(host);
    hosts.push(host);
  }
  return hosts;
}

export function hostMatchesRelayAltHosts(
  hostname: string,
  hosts: readonly string[],
): boolean {
  const host = normalizeRelayHostname(hostname);
  if (!host || host.includes('*') || host.includes('/') || host.includes(':')) return false;
  return hosts.some((item) => item === host);
}

export function readPuEdgeRelayAltConfig(
  env: PuEdgeRelayEnv | NodeJS.ProcessEnv = process.env,
): PuEdgeRelayAltConfig | null {
  const base = readPuEdgeRelayConfig({
    PU_EDGE_RELAY_URL: env.PU_EDGE_RELAY_ALT_URL,
    PU_EDGE_RELAY_SECRET: env.PU_EDGE_RELAY_ALT_SECRET,
  });
  const hosts = parseRelayAltHosts(env.PU_EDGE_RELAY_ALT_HOSTS);
  if (!base || hosts.length === 0) return null;
  return { ...base, hosts };
}

export function selectPuEdgeRelayRoute(
  target: string,
  primary: PuEdgeRelayConfig,
  alt: PuEdgeRelayAltConfig | null,
): { route: PuEdgeRelayConfig; viaAlt: boolean } {
  if (!alt) return { route: primary, viaAlt: false };
  try {
    if (hostMatchesRelayAltHosts(new URL(target).hostname, alt.hosts)) {
      return { route: alt, viaAlt: true };
    }
  } catch {
    return { route: primary, viaAlt: false };
  }
  return { route: primary, viaAlt: false };
}

function requestMethod(init?: RequestInit): string {
  return String(init?.method || 'GET').trim().toUpperCase() || 'GET';
}

async function bodyBytes(body: BodyInit | null | undefined): Promise<Uint8Array> {
  if (body == null) return new Uint8Array();
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString());
  }
  const copy = new Request('https://pu-edge-relay.body.invalid', { method: 'POST', body });
  return new Uint8Array(await copy.arrayBuffer());
}

function logClientRelay(fields: {
  host: string;
  path: string;
  status: number;
  ms: number;
  colo: string;
  viaAlt?: boolean;
}): void {
  console.info(
    JSON.stringify({
      msg: 'pu_edge_relay_client',
      host: fields.host,
      path: fields.path,
      status: fields.status,
      ms: fields.ms,
      ...(fields.colo ? { colo: fields.colo } : {}),
      ...(isRelayPlacementMiss(fields.colo) ? { placement_miss: true } : {}),
      ...(fields.viaAlt ? { via: 'alt' } : {}),
    }),
  );
}

/**
 * 所有連 `*.pu.edu.tw` 的伺服器端請求都走這個 fetch。
 * 只有 `PU_EDGE_RELAY_URL` 與 `PU_EDGE_RELAY_SECRET` 都有設時才轉送；否則維持 IPv4 直連。
 * 備援三個變數都設時，`PU_EDGE_RELAY_ALT_HOSTS` 列到的主機改走備援，其餘維持主轉送。
 */
export function createPuRelayFetch(
  options: {
    env?: PuEdgeRelayEnv | NodeJS.ProcessEnv;
    fetch?: FetchLike;
    directFetch?: FetchLike;
    now?: () => number;
    nonce?: () => string;
  } = {},
): FetchLike {
  const env = options.env ?? process.env;
  const config = readPuEdgeRelayConfig(env);
  const alt = readPuEdgeRelayAltConfig(env);
  const direct = options.directFetch ?? createIpv4PinnedFetch();
  if (!config) return direct;
  const relayFetch = options.fetch ?? ((url, init) => fetch(url, init));
  return async (url, init = {}) => {
    const normalized = normalizeRelayTarget(String(url)) || String(url);
    if (!isAllowedRelayTarget(normalized, ['*.pu.edu.tw'])) {
      return direct(url, init);
    }
    const { route, viaAlt } = selectPuEdgeRelayRoute(normalized, config, alt);
    const method = requestMethod(init);
    const timestamp = String(Math.floor((options.now?.() ?? Date.now()) / 1000));
    const nonce = (options.nonce?.() ?? randomRelayNonce()).trim().toLowerCase();
    const bytes = await bodyBytes(init.body);
    const headers = new Headers(init.headers);
    const signed = relayHeaderValues(headers);
    const signature = await signRelayRequest(route.secret, {
      timestamp,
      nonce,
      method,
      target: normalized,
      bodySha256: await sha256Hex(bytes),
      cookie: signed.cookie,
      contentType: signed.contentType,
    });
    headers.set(RELAY_TS_HEADER, timestamp);
    headers.set(RELAY_NONCE_HEADER, nonce);
    headers.set(RELAY_SIGN_HEADER, signature);
    headers.set(RELAY_TARGET_HEADER, normalized);
    const relayInit: RequestInit = {
      method,
      headers,
      redirect: 'manual',
      signal: init.signal,
    };
    if (method !== 'GET' && method !== 'HEAD' && bytes.byteLength) {
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      relayInit.body = copy;
    }
    const started = Date.now();
    const response = await relayFetch(route.url, relayInit);
    let parsed: URL | null = null;
    try {
      parsed = new URL(normalized);
    } catch {
      parsed = null;
    }
    if (parsed) {
      logClientRelay({
        host: parsed.hostname,
        path: parsed.pathname,
        status: response.status,
        ms: Date.now() - started,
        colo: response.headers.get(RELAY_COLO_HEADER) || response.headers.get('cf-placement') || '',
        viaAlt,
      });
    }
    return response;
  };
}
