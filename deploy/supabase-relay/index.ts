/**
 * pu-edge-relay（Supabase Edge Functions 版）。簽章協定與 Cloudflare Worker
 * `deploy/edge-relay` 相同，protocol 直接引用，不要在這裡再複製一份。
 *
 * 差異：防重放用記憶體 nonce store；cf-placement 只記錄不判斷；
 * 關閉 Supabase JWT 驗證，只靠 HMAC 簽章；密鑰從 Vault
 * （public.pu_edge_relay_secret()，只有 service_role 能叫）讀，不寫在程式裡。
 */
import {
  isAllowedRelayTarget,
  normalizeRelayTarget,
  parseAllowedHosts,
  RELAY_COLO_HEADER,
  RELAY_NONCE_HEADER,
  RELAY_REPLAY_WINDOW_SECONDS,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_TS_HEADER,
  relayHeaderValues,
  sha256Hex,
  verifyRelaySignature,
} from '../edge-relay/src/protocol.ts';

export type RelayNonceStore = { consume(nonce: string, nowMs?: number): Promise<boolean> };

export type SupabaseRelayOptions = {
  secret?: string;
  loadSecret?: () => Promise<string>;
  nowMs?: number;
  nonceStore?: RelayNonceStore;
  fetch?: typeof fetch;
  region?: string;
  allowedHosts?: string;
  supabaseUrl?: string;
  serviceRoleKey?: string;
};

type DenoEnv = {
  env: { get(key: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
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
  'cf-placement',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-real-ip',
  'forwarded',
  'via',
  'x-region',
  'apikey',
  'x-client-info',
  'baggage',
  'sentry-trace',
  'accept-encoding',
  RELAY_TS_HEADER,
  RELAY_NONCE_HEADER,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_COLO_HEADER,
]);

function denoRuntime(): DenoEnv | undefined {
  const candidate = (globalThis as { Deno?: DenoEnv }).Deno;
  return candidate && typeof candidate.env?.get === 'function' ? candidate : undefined;
}

function dropRequestHeader(key: string): boolean {
  const k = key.toLowerCase();
  return (
    HOP_BY_HOP.has(k) ||
    k.startsWith('sb-') ||
    k.startsWith('x-sb-') ||
    k.startsWith('cf-') ||
    k.startsWith('x-forwarded-') ||
    k.startsWith('x-supabase')
  );
}

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

const defaultNonceStore = createMemoryNonceStore();
let cachedSecret = '';
let cachedAt = 0;

export function resetSupabaseRelaySecretCache(): void {
  cachedSecret = '';
  cachedAt = 0;
}

function envGet(options: SupabaseRelayOptions, key: string): string {
  if (key === 'SB_REGION' && options.region) return options.region;
  if (key === 'SUPABASE_URL' && options.supabaseUrl) return options.supabaseUrl;
  if (key === 'SUPABASE_SERVICE_ROLE_KEY' && options.serviceRoleKey) return options.serviceRoleKey;
  return denoRuntime()?.env.get(key) || '';
}

function placementOf(options: SupabaseRelayOptions): string {
  const region = envGet(options, 'SB_REGION').trim();
  return region ? `supabase-${region}` : 'supabase';
}

async function defaultLoadSecret(
  options: SupabaseRelayOptions,
  fetchImpl: typeof fetch,
): Promise<string> {
  if (cachedSecret && Date.now() - cachedAt < 5 * 60_000) return cachedSecret;
  const base = envGet(options, 'SUPABASE_URL').replace(/\/+$/, '');
  const key = envGet(options, 'SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key) return cachedSecret;
  try {
    const res = await fetchImpl(`${base}/rest/v1/rpc/pu_edge_relay_secret`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) return cachedSecret;
    const value = String((await res.json()) || '').trim();
    if (value) {
      cachedSecret = value;
      cachedAt = Date.now();
    }
  } catch {
    // 用舊值。
  }
  return cachedSecret;
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}

function copyRequestHeaders(from: Headers): Headers {
  const out = new Headers();
  from.forEach((value, key) => {
    if (!dropRequestHeader(key)) out.append(key, value);
  });
  return out;
}

function copyResponseHeaders(from: Headers, placement: string): Headers {
  const out = new Headers();
  from.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'set-cookie' || k === 'content-encoding' || HOP_BY_HOP.has(k)) return;
    out.append(key, value);
  });
  const cookies = typeof from.getSetCookie === 'function' ? from.getSetCookie() : [];
  for (const cookie of cookies) out.append('Set-Cookie', cookie);
  out.set(RELAY_COLO_HEADER, placement);
  return out;
}

function logRelay(fields: {
  host?: string;
  path?: string;
  status: number;
  ms: number;
  colo: string;
  cfPlacement?: string;
}): void {
  console.log(
    JSON.stringify({
      msg: 'pu_edge_relay',
      ...(fields.host ? { host: fields.host } : {}),
      ...(fields.path ? { path: fields.path } : {}),
      status: fields.status,
      ms: fields.ms,
      colo: fields.colo,
      ...(fields.cfPlacement ? { cf_placement: fields.cfPlacement } : {}),
    }),
  );
}

export async function handleSupabaseRelayRequest(
  request: Request,
  options: SupabaseRelayOptions = {},
): Promise<Response> {
  const started = Date.now();
  const nowMs = options.nowMs ?? started;
  const nonceStore = options.nonceStore ?? defaultNonceStore;
  const fetchImpl = options.fetch ?? fetch;
  const placement = placementOf(options);
  const cfPlacement = request.headers.get('cf-placement')?.trim() || '';
  const timestamp = request.headers.get(RELAY_TS_HEADER)?.trim() || '';
  const nonce = request.headers.get(RELAY_NONCE_HEADER)?.trim().toLowerCase() || '';
  const signature = request.headers.get(RELAY_SIGN_HEADER)?.trim() || '';
  const rawTarget = request.headers.get(RELAY_TARGET_HEADER)?.trim() || '';
  const allowedHosts = parseAllowedHosts(options.allowedHosts ?? envGet(options, 'ALLOWED_HOSTS'));

  const reject = (host?: string, path?: string) => {
    logRelay({
      host,
      path,
      status: 404,
      ms: Date.now() - started,
      colo: placement,
      cfPlacement,
    });
    return notFound();
  };

  if (!timestamp || !nonce || !signature || !rawTarget) return reject();
  if (!isAllowedRelayTarget(rawTarget, allowedHosts)) return reject();
  const target = normalizeRelayTarget(rawTarget) || rawTarget;
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return reject();
  }

  const secret = (
    options.secret ||
    (await (options.loadSecret ?? (() => defaultLoadSecret(options, fetchImpl)))())
  ).trim();
  if (!secret) return reject();

  const bodyBytes = new Uint8Array(await request.arrayBuffer());
  const signedHeaders = relayHeaderValues(request.headers);
  const ok = await verifyRelaySignature({
    secret,
    fields: {
      timestamp,
      nonce,
      method: request.method,
      target: rawTarget,
      bodySha256: await sha256Hex(bodyBytes),
      cookie: signedHeaders.cookie,
      contentType: signedHeaders.contentType,
    },
    signature,
    nowMs,
  });
  if (!ok) return reject();
  if (!(await nonceStore.consume(nonce, nowMs))) return reject(parsed.hostname, parsed.pathname);

  const method = request.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers: copyRequestHeaders(request.headers),
    redirect: 'manual',
  };
  if (method !== 'GET' && method !== 'HEAD' && bodyBytes.byteLength) {
    const copy = new ArrayBuffer(bodyBytes.byteLength);
    new Uint8Array(copy).set(bodyBytes);
    init.body = copy;
  }

  try {
    const upstream = await fetchImpl(target, init);
    const headers = copyResponseHeaders(upstream.headers, placement);
    logRelay({
      host: parsed.hostname,
      path: parsed.pathname,
      status: upstream.status,
      ms: Date.now() - started,
      colo: placement,
      cfPlacement,
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
      cfPlacement,
    });
    return new Response(null, { status: 502 });
  }
}

const deno = denoRuntime();
if (deno && typeof deno.serve === 'function') {
  const nonceStore = createMemoryNonceStore();
  deno.serve((request) =>
    handleSupabaseRelayRequest(request, {
      region: deno.env.get('SB_REGION') || '',
      nonceStore,
    }),
  );
}
