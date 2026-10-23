'use strict';

const lastHit = new Map();
const robotsCache = new Map();
const USER_AGENT = 'NuniCampusAnnouncements/1.0 (+https://nuni.tw/support)';

function sleep(ms, wait = (amount) => new Promise((resolve) => setTimeout(resolve, amount))) {
  return wait(ms);
}

function robotsAllows(robotsText, pathname) {
  if (typeof robotsText !== 'string' || !robotsText.trim()) return true;
  const lines = robotsText.split(/\r?\n/).map((line) => line.trim());
  let applies = false;
  let allowed = true;
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      applies = value === '*' || /nuni/i.test(value);
      continue;
    }
    if (!applies) continue;
    if (key === 'allow' && pathnameStartsWith(pathname, value)) allowed = true;
    if (key === 'disallow' && value && pathnameStartsWith(pathname, value)) allowed = false;
  }
  return allowed;
}

function pathnameStartsWith(pathname, rule) {
  if (!rule || rule === '/') return rule === '/';
  return pathname === rule || pathname.startsWith(rule.endsWith('/') ? rule : `${rule}`);
}

async function readRobots(origin, fetchImpl, now) {
  const cached = robotsCache.get(origin);
  if (cached && now() - cached.at < 6 * 60 * 60 * 1000) return cached.text;
  try {
    const response = await fetchImpl(`${origin}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    const text = response.ok ? await response.text() : '';
    robotsCache.set(origin, { text, at: now() });
    return text;
  } catch {
    robotsCache.set(origin, { text: '', at: now() });
    return '';
  }
}

async function politeFetch(url, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    now = Date.now,
    wait,
    rateLimitMs = 3000,
    headers = {},
    etag,
    lastModified,
  } = options;
  const target = new URL(url);
  const origin = target.origin;
  const robots = await readRobots(origin, fetchImpl, now);
  if (!robotsAllows(robots, target.pathname)) {
    const error = new Error('robots_disallow');
    error.code = 'robots_disallow';
    throw error;
  }
  const previous = lastHit.get(origin) || 0;
  const waitMs = rateLimitMs - (now() - previous);
  if (waitMs > 0) await sleep(waitMs, wait);
  lastHit.set(origin, now());
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
      ...(etag ? { 'If-None-Match': etag } : {}),
      ...(lastModified ? { 'If-Modified-Since': lastModified } : {}),
      ...headers,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  lastHit.set(origin, now());
  return response;
}

function resetPoliteFetch() {
  lastHit.clear();
  robotsCache.clear();
}

module.exports = {
  USER_AGENT,
  robotsAllows,
  politeFetch,
  resetPoliteFetch,
};
