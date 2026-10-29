/**
 * 靜宜校園 HTTP 轉送（可選）。簽章格式必須與
 * `apps/web/src/lib/server/puEdgeRelayProtocol.ts`、
 * `deploy/edge-relay/src/protocol.ts` 一致。
 *
 * 只有 PU_EDGE_RELAY_URL 與 PU_EDGE_RELAY_SECRET 都有設時才轉送。
 * 不記錄 body、cookie、學號、密碼。
 */
const { createHmac } = require('node:crypto');

const RELAY_TS_HEADER = 'x-pu-relay-ts';
const RELAY_SIGN_HEADER = 'x-pu-relay-sign';
const RELAY_TARGET_HEADER = 'x-pu-relay-target';
const RELAY_REPLAY_WINDOW_SECONDS = 60;
const DEFAULT_ALLOWED_HOSTS = ['*.pu.edu.tw'];

let campusHttpFetch = null;
let cachedEnvRelayFetch = null;
let cachedEnvRelayKey = '';

function relayCanonical(timestamp, method, target) {
  const verb = String(method || 'GET').trim().toUpperCase() || 'GET';
  return `${timestamp}\n${verb}\n${target}`;
}

function signRelayRequest(secret, timestamp, method, target) {
  return createHmac('sha256', secret)
    .update(relayCanonical(timestamp, method, target), 'utf8')
    .digest('hex');
}

function parseAllowedHosts(raw) {
  const items = String(raw || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return items.length > 0 ? items : [...DEFAULT_ALLOWED_HOSTS];
}

function hostnameMatchesAllowlist(hostname, patterns) {
  const host = String(hostname || '').trim().toLowerCase();
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
  const key = `${config.url}\n${config.secret}`;
  if (cachedEnvRelayFetch && cachedEnvRelayKey === key) return cachedEnvRelayFetch;
  cachedEnvRelayKey = key;
  cachedEnvRelayFetch = createCjsRelayFetch(config);
  return cachedEnvRelayFetch;
}

function createCjsRelayFetch(config, fetchImpl = globalThis.fetch, now = Date.now) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Campus relay fetch is unavailable');
  }
  return async (url, init = {}) => {
    const target = String(url);
    if (!isAllowedRelayTarget(target, DEFAULT_ALLOWED_HOSTS)) {
      throw new Error('Untrusted campus URL');
    }
    const method = String(init.method || 'GET').trim().toUpperCase() || 'GET';
    const timestamp = String(Math.floor(now() / 1000));
    const signature = signRelayRequest(config.secret, timestamp, method, target);
    const headers = new Headers(init.headers);
    headers.set(RELAY_TS_HEADER, timestamp);
    headers.set(RELAY_SIGN_HEADER, signature);
    headers.set(RELAY_TARGET_HEADER, target);
    const relayInit = {
      method,
      headers,
      redirect: 'manual',
      signal: init.signal,
    };
    if (method !== 'GET' && method !== 'HEAD' && init.body != null) {
      relayInit.body = init.body;
    }
    return fetchImpl(config.url, relayInit);
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
  RELAY_REPLAY_WINDOW_SECONDS,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_TS_HEADER,
  createCjsRelayFetch,
  getCampusHttpFetch,
  hostnameMatchesAllowlist,
  isAllowedRelayTarget,
  parseAllowedHosts,
  readPuEdgeRelayConfig,
  relayCanonical,
  sendWithCampusFetch,
  setCampusHttpFetch,
  signRelayRequest,
};
