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
export const SOURCE_DOWN_EMPTY_TEXT = '學校網站暫時連不上，可以先到學校網站看最新消息';
export const SOURCE_DOWN_WITH_CACHE_TEXT = '學校網站暫時連不上';
export const PLACEHOLDER_ANNOUNCEMENT_SCHOOL_IDS = [
  'tw-demo-uni',
  'tw-taichung-uni-a',
  'tw-taichung-uni-b',
] as const;
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

export function isPlaceholderAnnouncementSchool(input: {
  schoolId?: string | null;
  cms?: string | null;
  demo?: boolean;
}): boolean {
  if (input.cms === 'none') return true;
  const schoolId = (input.schoolId ?? '').trim();
  return (
    schoolId.length > 0 &&
    (PLACEHOLDER_ANNOUNCEMENT_SCHOOL_IDS as readonly string[]).includes(schoolId)
  );
}

const PLACEHOLDER_VISIBLE_ENVIRONMENTS = ['development', 'preview', 'test'] as const;

/** 示範學校預設藏：只有明確寫 development / preview / test 才顯示。未設定、空字串、未知值都藏。 */
export function allowsPlaceholderAnnouncementSchools(
  environment?: string | null,
): boolean {
  return (PLACEHOLDER_VISIBLE_ENVIRONMENTS as readonly string[]).includes(
    String(environment ?? '').trim(),
  );
}

export function isAnnouncementSchoolVisibleToPublic(
  input: { schoolId?: string | null; cms?: string | null; demo?: boolean },
  environment?: string | null,
): boolean {
  return (
    !isPlaceholderAnnouncementSchool(input) || allowsPlaceholderAnnouncementSchools(environment)
  );
}

export function formatTaiwanMonthDayTime(value: Date | string | number): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const month = Number(read('month'));
  const day = Number(read('day'));
  const hour = read('hour').padStart(2, '0');
  const minute = read('minute').padStart(2, '0');
  if (!month || !day || !hour || !minute) return null;
  return `${month}/${day} ${hour}:${minute}`;
}

export function formatStaleAnnouncementNotice(
  updatedAt?: Date | string | number | null,
): string {
  const stamp = updatedAt == null ? null : formatTaiwanMonthDayTime(updatedAt);
  return stamp ? `最後更新 ${stamp}，學校網站暫時連不上` : SOURCE_DOWN_WITH_CACHE_TEXT;
}

export function latestAnnouncementStamp(
  values: Array<string | undefined | null>,
): string | undefined {
  const dates = values
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => new Date(value))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());
  return dates[0]?.toISOString();
}

export function staleAnnouncementUpdatedAt(
  sources: Array<{ status?: string; lastSuccessAt?: string | null }>,
  announcements: Array<{ publishedAt?: string | null }>,
): string | undefined {
  return (
    latestAnnouncementStamp(
      sources
        .filter((item) => item.status === 'unavailable')
        .map((item) => item.lastSuccessAt),
    ) ?? latestAnnouncementStamp(announcements.map((item) => item.publishedAt))
  );
}
