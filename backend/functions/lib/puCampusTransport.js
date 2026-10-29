/**
 * 靜宜校園 HTTP 轉送（可選）。簽章格式必須與
 * `apps/web/src/lib/server/puEdgeRelayProtocol.ts`、
 * `deploy/edge-relay/src/protocol.ts` 一致。
 *
 * 只有 PU_EDGE_RELAY_URL 與 PU_EDGE_RELAY_SECRET 都有設時才轉送。
 * 備援三個變數都設時，PU_EDGE_RELAY_ALT_HOSTS 列到的主機改走備援（精確主機名，不含子網域）。
 * 不記錄 body、cookie、學號、密碼。
 */
const { createHmac, createHash, randomBytes } = require('node:crypto');

const RELAY_TS_HEADER = 'x-pu-relay-ts';
const RELAY_NONCE_HEADER = 'x-pu-relay-nonce';
const RELAY_SIGN_HEADER = 'x-pu-relay-sign';
const RELAY_TARGET_HEADER = 'x-pu-relay-target';
const RELAY_COLO_HEADER = 'x-pu-relay-colo';
const RELAY_REPLAY_WINDOW_SECONDS = 60;
const RELAY_NONCE_PATTERN = /^[0-9a-f]{32}$/;
const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const TAIWAN_NEAR_COLOS = new Set(['TPE', 'KHH']);
const DEFAULT_ALLOWED_HOSTS = ['*.pu.edu.tw'];

let campusHttpFetch = null;
let cachedEnvRelayFetch = null;
let cachedEnvRelayKey = '';

function normalizeRelayHostname(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/g, '');
}

function normalizeRelayTarget(target) {
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

function relayCanonical(fields) {
  const verb = String(fields.method || 'GET').trim().toUpperCase() || 'GET';
  return [
    fields.timestamp,
    String(fields.nonce || '').trim().toLowerCase(),
    verb,
    fields.target,
    String(fields.bodySha256 || '').trim().toLowerCase(),
    fields.cookie || '',
    fields.contentType || '',
  ].join('\n');
}

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function signRelayRequest(secret, fields) {
  return createHmac('sha256', secret).update(relayCanonical(fields), 'utf8').digest('hex');
}

function randomRelayNonce() {
  return randomBytes(16).toString('hex');
}

function parseAllowedHosts(raw) {
  const items = String(raw || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return items.length > 0 ? items : [...DEFAULT_ALLOWED_HOSTS];
}

function hostnameMatchesAllowlist(hostname, patterns) {
  const host = normalizeRelayHostname(hostname);
  if (!host || host.includes(':')) return false;
  return patterns.some((pattern) => {
    const item = String(pattern || '').trim().toLowerCase();
    if (!item || item === '*') return false;
    if (item.startsWith('*.')) {
      const suffix = item.slice(1);
      return suffix.startsWith('.') && host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === item;
  });
}

function isAllowedRelayTarget(target, patterns) {
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

function parseCfPlacement(placement) {
  const raw = String(placement || '').trim();
  const placed = raw.match(/^(local|remote)-([A-Za-z0-9]{3})$/i);
  if (placed) return { kind: placed[1].toLowerCase(), colo: placed[2].toUpperCase() };
  if (/^[A-Za-z]{3}$/.test(raw)) return { kind: '', colo: raw.toUpperCase() };
  return { kind: '', colo: '' };
}

function isRelayPlacementMiss(placement) {
  return !TAIWAN_NEAR_COLOS.has(parseCfPlacement(placement).colo);
}

function readPuEdgeRelayConfig(env = process.env) {
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

function parseRelayAltHosts(raw) {
  const seen = new Set();
  const hosts = [];
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

function hostMatchesRelayAltHosts(hostname, hosts) {
  const host = normalizeRelayHostname(hostname);
  if (!host || host.includes('*') || host.includes('/') || host.includes(':')) return false;
  return (hosts || []).some((item) => item === host);
}

function readPuEdgeRelayAltConfig(env = process.env) {
  const base = readPuEdgeRelayConfig({
    PU_EDGE_RELAY_URL: env.PU_EDGE_RELAY_ALT_URL,
    PU_EDGE_RELAY_SECRET: env.PU_EDGE_RELAY_ALT_SECRET,
  });
  const hosts = parseRelayAltHosts(env.PU_EDGE_RELAY_ALT_HOSTS);
  if (!base || hosts.length === 0) return null;
  return { ...base, hosts };
}

function selectPuEdgeRelayRoute(target, primary, alt) {
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

function setCampusHttpFetch(fn) {
  campusHttpFetch = typeof fn === 'function' ? fn : null;
  cachedEnvRelayFetch = null;
  cachedEnvRelayKey = '';
}

function getCampusHttpFetch(env = process.env) {
  if (campusHttpFetch) return campusHttpFetch;
  const config = readPuEdgeRelayConfig(env);
  if (!config) {
    cachedEnvRelayFetch = null;
    cachedEnvRelayKey = '';
    return null;
  }
  const alt = readPuEdgeRelayAltConfig(env);
  const key = `${config.url}\n${config.secret}\n${alt ? `${alt.url}\n${alt.secret}\n${alt.hosts.join(',')}` : ''}`;
  if (cachedEnvRelayFetch && cachedEnvRelayKey === key) return cachedEnvRelayFetch;
  cachedEnvRelayKey = key;
  cachedEnvRelayFetch = createCjsRelayFetch({ ...config, alt });
  return cachedEnvRelayFetch;
}

function bodyBuffer(body) {
  if (body == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  return Buffer.from(String(body), 'utf8');
}

function headerLookup(headers, name) {
  const wanted = name.toLowerCase();
  let found = '';
  new Headers(headers || {}).forEach((value, key) => {
    if (key.toLowerCase() === wanted) found = value;
  });
  return found;
}

function createCjsRelayFetch(config, fetchImpl = globalThis.fetch, now = Date.now, nonceFn = randomRelayNonce) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Campus relay fetch is unavailable');
  }
  const primary = { url: config.url, secret: config.secret };
  const alt = config.alt && Array.isArray(config.alt.hosts) ? config.alt : null;
  return async (url, init = {}) => {
    const normalized = normalizeRelayTarget(String(url)) || String(url);
    if (!isAllowedRelayTarget(normalized, DEFAULT_ALLOWED_HOSTS)) {
      throw new Error('Untrusted campus URL');
    }
    const { route, viaAlt } = selectPuEdgeRelayRoute(normalized, primary, alt);
    const method = String(init.method || 'GET').trim().toUpperCase() || 'GET';
    const timestamp = String(Math.floor(now() / 1000));
    const nonce = String(nonceFn()).trim().toLowerCase();
    const bytes = bodyBuffer(init.body);
    const headers = new Headers(init.headers);
    const cookie = headerLookup(headers, 'cookie');
    const contentType = headerLookup(headers, 'content-type');
    const signature = signRelayRequest(route.secret, {
      timestamp,
      nonce,
      method,
      target: normalized,
      bodySha256: bytes.length ? sha256Hex(bytes) : EMPTY_BODY_SHA256,
      cookie,
      contentType,
    });
    headers.set(RELAY_TS_HEADER, timestamp);
    headers.set(RELAY_NONCE_HEADER, nonce);
    headers.set(RELAY_SIGN_HEADER, signature);
    headers.set(RELAY_TARGET_HEADER, normalized);
    const relayInit = {
      method,
      headers,
      redirect: 'manual',
      signal: init.signal,
    };
    if (method !== 'GET' && method !== 'HEAD' && bytes.length) {
      relayInit.body = bytes;
    }
    const started = Date.now();
    const response = await fetchImpl(route.url, relayInit);
    try {
      const parsed = new URL(normalized);
      const colo = response.headers.get(RELAY_COLO_HEADER) || response.headers.get('cf-placement') || '';
      console.info(
        JSON.stringify({
          msg: 'pu_edge_relay_client',
          host: parsed.hostname,
          path: parsed.pathname,
          status: response.status,
          ms: Date.now() - started,
          ...(colo ? { colo } : {}),
          ...(isRelayPlacementMiss(colo) ? { placement_miss: true } : {}),
          ...(viaAlt ? { via: 'alt' } : {}),
        }),
      );
    } catch {
      // 日誌失敗不影響轉送。
    }
    return response;
  };
}

function headerRecord(headers) {
  const result = {};
  new Headers(headers || {}).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function cookieString(jar) {
  return Object.entries(jar || {})
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function parseCookies(setCookieHeaders, jar) {
  if (!setCookieHeaders) return;
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  headers.forEach((header) => {
    const pair = String(header).split(';')[0].trim();
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0, idx)] = pair.slice(idx + 1);
  });
}

function nodeHeadersFromResponse(response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;
    headers[key] = value;
  });
  const cookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (cookies.length) headers['set-cookie'] = cookies;
  else {
    const fallback = response.headers.get('set-cookie');
    if (fallback) headers['set-cookie'] = [fallback];
  }
  return headers;
}

async function sendWithCampusFetch(options) {
  const fetchImpl = options.fetch || getCampusHttpFetch(options.env);
  if (!fetchImpl) return null;
  const url = String(options.url);
  const method = String(options.method || 'GET').trim().toUpperCase() || 'GET';
  const timeoutMs = options.timeoutMs;
  const headers = headerRecord(options.headers);
  if (options.cookies && Object.keys(options.cookies).length) {
    headers.Cookie = cookieString(options.cookies);
  }
  const controller = new AbortController();
  const timer =
    timeoutMs != null
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
  timer?.unref?.();
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : options.body,
      redirect: 'manual',
      signal: controller.signal,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (options.maxResponseBytes && buffer.length > options.maxResponseBytes) {
      throw new Error('Campus response is too large');
    }
    const jar = { ...(options.cookies || {}) };
    parseCookies(nodeHeadersFromResponse(response)['set-cookie'], jar);
    return {
      status: response.status,
      headers: nodeHeadersFromResponse(response),
      body: buffer.toString('utf8'),
      cookies: jar,
      url,
    };
  } catch (error) {
    if (error && typeof error === 'object' && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      const timed = new Error(options.timeoutMessage || 'Campus request timed out');
      timed.code = 'ETIMEDOUT';
      throw timed;
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  DEFAULT_ALLOWED_HOSTS,
  EMPTY_BODY_SHA256,
  RELAY_COLO_HEADER,
  RELAY_NONCE_HEADER,
  RELAY_NONCE_PATTERN,
  RELAY_REPLAY_WINDOW_SECONDS,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_TS_HEADER,
  createCjsRelayFetch,
  getCampusHttpFetch,
  hostMatchesRelayAltHosts,
  hostnameMatchesAllowlist,
  isAllowedRelayTarget,
  isRelayPlacementMiss,
  normalizeRelayHostname,
  normalizeRelayTarget,
  parseAllowedHosts,
  parseRelayAltHosts,
  randomRelayNonce,
  readPuEdgeRelayAltConfig,
  readPuEdgeRelayConfig,
  relayCanonical,
  selectPuEdgeRelayRoute,
  sendWithCampusFetch,
  setCampusHttpFetch,
  sha256Hex,
  signRelayRequest,
};
