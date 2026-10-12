export const ANNOUNCEMENT_SCOPES = ['campus', 'office', 'department'] as const;
export type AnnouncementScope = (typeof ANNOUNCEMENT_SCOPES)[number];
export const ANNOUNCEMENT_SOURCE_KINDS = ['rss', 'api', 'opendata', 'html_list', 'none'] as const;
export type AnnouncementSourceKind = (typeof ANNOUNCEMENT_SOURCE_KINDS)[number];
export const ANNOUNCEMENT_CATEGORIES = [
  'general',
  'academic',
  'event',
  'emergency',
  'system',
] as const;
export type PublicAnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];
export const SOURCE_UNAVAILABLE_TEXT = '暫時抓不到';
export const SUMMARY_NOTICE = '摘要，全文見原文';
export const LOGIN_PORTAL_HOSTS = ['alcat.pu.edu.tw', 'tronclass.com.tw', 'tronclass.pu.edu.tw'];
export const ANNOUNCEMENT_PARSER_PRESETS = {
  iweb: ['iwebTable', 'iwebLinks'],
  rpage: ['rpageList', 'htmlLinks'],
  html: ['htmlLinks', 'iwebLinks'],
  rss: ['rss', 'htmlLinks'],
} as const;
export type AnnouncementCms = keyof typeof ANNOUNCEMENT_PARSER_PRESETS | 'none';

export function normalizeAnnouncementUrl(value: string, baseUrl?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let url: URL;
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

export function isLoginPortalUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return LOGIN_PORTAL_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
  } catch {
    return false;
  }
}

export function classifyAnnouncement(
  title: string,
  office = '',
): PublicAnnouncementCategory {
  const text = `${title} ${office}`;
  if (/停課|颱風|地震|緊急|疏散|警報|災/.test(text)) return 'emergency';
  if (/維修|資訊處|網路|系統中斷|資安/.test(text)) return 'system';
  if (/選課|加退選|成績|教務|招生|抵免|期末考|期中考/.test(text)) return 'academic';
  if (/活動|講座|迎新|畢典|社團|工作坊/.test(text)) return 'event';
  return 'general';
}

export function summarizeAnnouncement(text: string, max = 110): string {
  const compact = String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return '';
  return compact.length <= max ? compact : `${compact.slice(0, max).trim()}…`;
}
