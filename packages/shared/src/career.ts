/** Spec PR 1: public, read-only career information. No account or local workspace. */
export type CareerAnnouncement = { title: string; date: string; url: string; source: string };
export type CareerTimelineItem = CareerAnnouncement & { date: string };
export type CareerJob = { title: string; company: string; url: string; source: '台灣就業通' };
export type CareerFeed = {
  announcements: CareerAnnouncement[];
  timeline: CareerTimelineItem[];
  jobs: CareerJob[];
  announcementsUnavailable: boolean;
  jobsUnavailable: boolean;
  supported: boolean;
};
export const CAREER_EMPTY = '職產處還沒在這裡上架工讀或實習。';
export const CAREER_JOBS_UNAVAILABLE = '暫時讀不到台灣就業通的職缺。';
export const CAREER_LINKS = [
  { label: '到 104 找更多', url: 'https://www.104.com.tw/jobs/main/' },
  { label: '到 Cake 找更多', url: 'https://www.cake.me/jobs?locale=zh-TW' },
];
export function careerIsPu(school: string) {
  return ['pu', 'tw-pu'].includes(school);
}
export function emptyCareerFeed(supported = true): CareerFeed {
  return {
    announcements: [],
    timeline: [],
    jobs: [],
    announcementsUnavailable: supported,
    jobsUnavailable: supported,
    supported,
  };
}
export function careerSafeUrl(value: string, host: string, base?: string) {
  try {
    const u = new URL(value, base);
    return u.protocol === 'https:' && u.hostname === host && !u.username && !u.password
      ? u.href
      : '';
  } catch {
    return '';
  }
}
export function careerDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function careerToday(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function careerSoon(date: string, today = careerToday()) {
  const days = (Date.parse(date) - Date.parse(today)) / 86400000;
  return days >= 0 && days <= 7;
}
const careerStatus = /取消|延期|延後|暫停|停辦|停開|改期|擇期|待定|未定|另行通知/;
const careerExplicitDate = /(?<!\d)(20\d{2}|1[01]\d)[年/.-](\d{1,2})[月/.-](\d{1,2})(?:日)?(?!\d)/g;

/** Only a single explicitly year-qualified date in a career deadline/event title. Publication dates never become deadlines. */
export function careerTitleDate(title: string) {
  // Keep status notices in announcements, but never offer their old date as an event.
  if (careerStatus.test(title.normalize('NFKC').replace(/\s/g, ''))) return '';
  if (!/截止|報名|申請|徵才|說明會|講座|博覽會/.test(title)) return '';
  const matches = [...title.matchAll(careerExplicitDate)];
  if (matches.length !== 1) return '';
  const match = matches[0];
  const before = title.slice(0, match.index);
  const after = title.slice(match.index! + match[0].length);
  const remainder = before + ' ' + after;
  // Textual endpoints (翌日、月底、學期末…) are ranges too. Without an
  // explicit end date, retain the announcement but do not invent a one-day event.
  const rangeEnd = after.normalize('NFKC').replace(/[\s\p{Cf}]/gu, '');
  if (/(?:至|到|迄|翌日|隔日|次日|月底|月末|年底|年末|學期末|学期末)|[~～]/.test(rangeEnd))
    return '';
  // A second date without a year, or a shortened range endpoint, is still
  // ambiguous. Never turn the first date into a single-day calendar event.
  if (
    /(?<!\d)\d{1,2}[月/.-]\d{1,2}(?:日)?(?!\d)|(?:至|到|及|與|[、~～–—-])\s*\d{1,2}\s*日?/.test(
      remainder,
    )
  )
    return '';
  if (
    /(?:發布|發佈|刊登|更新|公告日期)\s*[:：]?\s*$/.test(before) ||
    /^\s*(?:[日）)\]】]\s*)?(?:發布|發佈|刊登|更新|公告)/.test(after)
  )
    return '';
  // The single date must sit next to a deadline/event phrase, rather than
  // merely coexist with an unrelated career keyword somewhere in the title.
  const event = '(?:截止|報名|申請|徵才|說明會|講座|博覽會)';
  if (
    !new RegExp(event + '[^，。；：:]{0,12}$').test(before) &&
    !new RegExp('^[^，。；：:]{0,12}' + event).test(after)
  )
    return '';
  const [, y, m, d] = match;
  const year = Number(y) + (y.length === 3 ? 1911 : 0);
  const date = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return careerDate(date) ? date : '';
}
// Compare only explicit dates and exact event names after removing status labels.
// Notices stay in announcements; unrelated sources, dates and events stay visible.
function careerEventKey(a: CareerAnnouncement, statusNotice = false) {
  let title = a.title.normalize('NFKC').replace(/\s/g, '');
  if (statusNotice) {
    if (!careerStatus.test(title)) return '';
    title = title.replace(new RegExp('(?:' + careerStatus.source + ')(?:通知)?', 'g'), '');
  }
  const date = careerTitleDate(title);
  const name = title.replace(careerExplicitDate, '').replace(/[\p{P}\p{S}]/gu, '');
  return date && name ? JSON.stringify([a.source, date, name]) : '';
}

export function careerTimeline(
  announcements: CareerAnnouncement[],
  today = careerToday(),
): CareerTimelineItem[] {
  const suppressed = new Set(announcements.map((a) => careerEventKey(a, true)).filter(Boolean));
  const seen = new Set<string>();
  return announcements
    .flatMap((a) => {
      const date = careerTitleDate(a.title);
      const key = a.url.replace(/,r\d+(?=\.php)/, '');
      if (!date || date < today || seen.has(key) || suppressed.has(careerEventKey(a))) return [];
      seen.add(key);
      return [
        { ...a, date, source: /校園徵才|校徵|徵才博覽會/.test(a.title) ? '校園徵才' : a.source },
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);
}
export function careerCalendarUrl(item: CareerTimelineItem) {
  const end = new Date(item.date + 'T00:00:00Z');
  end.setUTCDate(end.getUTCDate() + 1);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: item.title,
    dates: item.date.replaceAll('-', '') + '/' + end.toISOString().slice(0, 10).replaceAll('-', ''),
    details: `來源：${item.source}\n${item.url}\n日期擷取自公告標題，請回原文確認時間。`,
    ctz: 'Asia/Taipei',
  });
  return 'https://calendar.google.com/calendar/render?' + params;
}
export async function fetchCareerFeed(
  school: string,
  origin = '',
  signal?: AbortSignal,
): Promise<CareerFeed> {
  if (!careerIsPu(school)) return emptyCareerFeed(false);
  const response = await fetch(`${origin}/career/data?school=pu`, { signal });
  if (!response.ok) throw new Error('career feed unavailable');
  return response.json() as Promise<CareerFeed>;
}
