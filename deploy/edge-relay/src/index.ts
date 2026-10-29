import {
  isAllowedRelayTarget,
  parseAllowedHosts,
  RELAY_COLO_HEADER,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_TS_HEADER,
  verifyRelaySignature,
} from './protocol';

export type RelayEnv = {
  RELAY_SECRET: string;
  ALLOWED_HOSTS?: string;
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
  RELAY_TS_HEADER,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_COLO_HEADER,
]);

function notFound(): Response {
  return new Response(null, { status: 404 });
}

function requestColo(request: Request): string {
  const cf = (request as Request & { cf?: { colo?: string } }).cf;
  return typeof cf?.colo === 'string' ? cf.colo : '';
}

function copyRequestHeaders(from: Headers): Headers {
  const out = new Headers();
  from.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    out.append(key, value);
  });
  return out;
}

function copyResponseHeaders(from: Headers, colo: string): Headers {
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
  if (colo) out.set(RELAY_COLO_HEADER, colo);
  return out;
}

function logRelay(fields: {
  host?: string;
  path?: string;
  status: number;
  ms: number;
  colo?: string;
}): void {
  console.log(
    JSON.stringify({
      msg: 'pu_edge_relay',
      ...(fields.host ? { host: fields.host } : {}),
      ...(fields.path ? { path: fields.path } : {}),
      status: fields.status,
      ms: fields.ms,
      ...(fields.colo ? { colo: fields.colo } : {}),
    }),
  );
}

export async function handleRelayRequest(
  request: Request,
  env: RelayEnv,
  nowMs = Date.now(),
): Promise<Response> {
  const started = Date.now();
  const colo = requestColo(request);
  const secret = String(env?.RELAY_SECRET || '').trim();
  const timestamp = request.headers.get(RELAY_TS_HEADER)?.trim() || '';
  const signature = request.headers.get(RELAY_SIGN_HEADER)?.trim() || '';
  const target = request.headers.get(RELAY_TARGET_HEADER)?.trim() || '';
  const allowedHosts = parseAllowedHosts(env?.ALLOWED_HOSTS);

  const reject = (status = 404, host?: string, path?: string) => {
    logRelay({ host, path, status, ms: Date.now() - started, colo });
    return notFound();
  };

  if (!secret || !timestamp || !signature || !target) {
    return reject();
  }
  if (!isAllowedRelayTarget(target, allowedHosts)) {
    return reject();
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return reject();
  }

  const ok = await verifyRelaySignature({
    secret,
    timestamp,
    method: request.method,
    target,
    signature,
    nowMs,
  });
  if (!ok) {
    return reject();
  }

  const method = request.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers: copyRequestHeaders(request.headers),
    redirect: 'manual',
  };
  if (method !== 'GET' && method !== 'HEAD' && request.body) {
    init.body = request.body;
    (init as RequestInit & { duplex?: string }).duplex = 'half';
  }

  try {
    const upstream = await fetch(target, init);
    const headers = copyResponseHeaders(upstream.headers, colo);
    logRelay({
      host: parsed.hostname,
      path: parsed.pathname,
      status: upstream.status,
      ms: Date.now() - started,
      colo,
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
      colo,
    });
    return new Response(null, { status: 502 });
  }
}

export default {
  async fetch(request: Request, env: RelayEnv): Promise<Response> {
    return handleRelayRequest(request, env);
  },
};
