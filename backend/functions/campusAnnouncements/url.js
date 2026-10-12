'use strict';

const crypto = require('node:crypto');

const LOGIN_PORTAL_HOSTS = ['alcat.pu.edu.tw', 'tronclass.com.tw', 'tronclass.pu.edu.tw'];

function normalizeAnnouncementUrl(value, baseUrl) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  if (url.username || url.password) return '';
  url.hash = '';
  const drop = new Set([
    'lang',
    'fbclid',
    'gclid',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'sessionid',
    'phpsessid',
  ]);
  for (const key of [...url.searchParams.keys()]) {
    if (drop.has(key.toLowerCase()) || /^utm_/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (url.protocol === 'http:') url.protocol = 'https:';
  return url.toString();
}

function isLoginPortalUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return LOGIN_PORTAL_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
  } catch {
    return false;
  }
}

function announcementDocId(schoolId, originalUrl) {
  const digest = crypto
    .createHash('sha256')
    .update(`${schoolId}:${normalizeAnnouncementUrl(originalUrl)}`)
    .digest('hex')
    .slice(0, 32);
  return `pub_${digest}`;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(value) {
  const text = decodeHtml(value);
  const iso = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }
  const roc = text.match(/(\d{2,3})[./年](\d{1,2})[./月](\d{1,2})/);
  if (roc && Number(roc[1]) < 200) {
    const date = new Date(Date.UTC(Number(roc[1]) + 1911, Number(roc[2]) - 1, Number(roc[3])));
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
}

function htmlFingerprint(html) {
  const tags = String(html || '')
    .toLowerCase()
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .match(/<\/?[a-z0-9]+/g);
  return crypto
    .createHash('sha256')
    .update((tags || []).slice(0, 400).join(','))
    .digest('hex')
    .slice(0, 24);
}

module.exports = {
  LOGIN_PORTAL_HOSTS,
  normalizeAnnouncementUrl,
  isLoginPortalUrl,
  announcementDocId,
  decodeHtml,
  parseDate,
  htmlFingerprint,
};
