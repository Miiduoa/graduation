import {
  isAllowedRelayTarget,
  isRelayPlacementMiss,
  normalizeRelayTarget,
  parseAllowedHosts,
  readRequestPlacement,
  RELAY_COLO_HEADER,
  RELAY_NONCE_HEADER,
  RELAY_REPLAY_WINDOW_SECONDS,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_TS_HEADER,
  relayHeaderValues,
  sha256Hex,
  verifyRelaySignature,
} from './protocol';

export type RelayEnv = {
  RELAY_SECRET: string;
  ALLOWED_HOSTS?: string;
};

export type RelayNonceStore = {
  consume(nonce: string, nowMs?: number): Promise<boolean>;
};

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'cdn-loop',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'cf-placement',
  RELAY_TS_HEADER,
  RELAY_NONCE_HEADER,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_COLO_HEADER,
]);

const NONCE_CACHE_NAME = 'pu-edge-relay-nonce';

export function createMemoryNonceStore(): RelayNonceStore {
  const seen = new Map<string, number>();
  return {
    async consume(nonce, nowMs = Date.now()) {
      for (const [key, exp] of seen) {
        if (exp <= nowMs) seen.delete(key);
      }
      if (seen.has(nonce)) return false;
      seen.set(nonce, nowMs + RELAY_REPLAY_WINDOW_SECONDS * 1000);
      return true;
    },
  };
}

export function createWorkerNonceStore(): RelayNonceStore {
  const memory = createMemoryNonceStore();
  return {
    async consume(nonce, nowMs = Date.now()) {
      if (!(await memory.consume(nonce, nowMs))) return false;
      try {
        const cache = await caches.open(NONCE_CACHE_NAME);
        const key = new Request(`https://pu-edge-relay.nonce/${encodeURIComponent(nonce)}`);
        if (await cache.match(key)) return false;
        await cache.put(
          key,
          new Response('1', {
            headers: { 'Cache-Control': `max-age=${RELAY_REPLAY_WINDOW_SECONDS}` },
          }),
        );
      } catch {
        // 免費方案 Cache API 盡力去重；記憶體已記過。
      }
      return true;
    },
  };
}

const defaultNonceStore = createWorkerNonceStore();

function notFound(): Response {
  return new Response(null, { status: 404 });
}

function copyRequestHeaders(from: Headers): Headers {
  const out = new Headers();
  from.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    out.append(key, value);
  });
  return out;
}

function copyResponseHeaders(from: Headers, placement: string): Headers {
  const out = new Headers();
  from.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    out.append(key, value);
  });
  const cookies = typeof from.getSetCookie === 'function' ? from.getSetCookie() : [];
  for (const cookie of cookies) {
    out.append('Set-Cookie', cookie);
  }
  if (placement) out.set(RELAY_COLO_HEADER, placement);
  return out;
}

function logRelay(fields: {
  host?: string;
  path?: string;
  status: number;
  ms: number;
  colo?: string;
  placement_miss?: boolean;
}): void {
  console.log(
    JSON.stringify({
      msg: 'pu_edge_relay',
      ...(fields.host ? { host: fields.host } : {}),
      ...(fields.path ? { path: fields.path } : {}),
      status: fields.status,
      ms: fields.ms,
      ...(fields.colo ? { colo: fields.colo } : {}),
      ...(fields.placement_miss ? { placement_miss: true } : {}),
    }),
  );
}

export async function handleRelayRequest(
  request: Request,
  env: RelayEnv,
  nowMs = Date.now(),
  nonceStore: RelayNonceStore = defaultNonceStore,
): Promise<Response> {
  const started = Date.now();
  const placement = readRequestPlacement(request);
  const placementMiss = isRelayPlacementMiss(placement);
  const secret = String(env?.RELAY_SECRET || '').trim();
  const timestamp = request.headers.get(RELAY_TS_HEADER)?.trim() || '';
  const nonce = request.headers.get(RELAY_NONCE_HEADER)?.trim().toLowerCase() || '';
  const signature = request.headers.get(RELAY_SIGN_HEADER)?.trim() || '';
  const rawTarget = request.headers.get(RELAY_TARGET_HEADER)?.trim() || '';
  const allowedHosts = parseAllowedHosts(env?.ALLOWED_HOSTS);

  const reject = (host?: string, path?: string) => {
    logRelay({
      host,
      path,
      status: 404,
      ms: Date.now() - started,
      colo: placement,
      placement_miss: placementMiss,
    });
    return notFound();
  };

  if (!secret || !timestamp || !nonce || !signature || !rawTarget) {
    return reject();
  }
  if (!isAllowedRelayTarget(rawTarget, allowedHosts)) {
    return reject();
  }
  const target = normalizeRelayTarget(rawTarget) || rawTarget;

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return reject();
  }

  const bodyBytes = new Uint8Array(await request.arrayBuffer());
  const bodySha256 = await sha256Hex(bodyBytes);
  const signedHeaders = relayHeaderValues(request.headers);
  const ok = await verifyRelaySignature({
    secret,
    fields: {
      timestamp,
      nonce,
      method: request.method,
      target: rawTarget,
      bodySha256,
      cookie: signedHeaders.cookie,
      contentType: signedHeaders.contentType,
    },
    signature,
    nowMs,
  });
  if (!ok) {
    return reject();
  }
  if (!(await nonceStore.consume(nonce, nowMs))) {
    return reject(parsed.hostname, parsed.pathname);
  }

  const method = request.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers: copyRequestHeaders(request.headers),
    redirect: 'manual',
  };
  if (method !== 'GET' && method !== 'HEAD' && bodyBytes.byteLength) {
    init.body = bodyBytes;
  }

  try {
    const upstream = await fetch(target, init);
    const headers = copyResponseHeaders(upstream.headers, placement);
    logRelay({
      host: parsed.hostname,
      path: parsed.pathname,
      status: upstream.status,
      ms: Date.now() - started,
      colo: placement,
      placement_miss: placementMiss,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch {
    logRelay({
      host: parsed.hostname,
      path: parsed.pathname,
      status: 502,
      ms: Date.now() - started,
      colo: placement,
      placement_miss: placementMiss,
    });
    return new Response(null, { status: 502 });
  }
}

export default {
  async fetch(request: Request, env: RelayEnv): Promise<Response> {
    return handleRelayRequest(request, env);
  },
};
