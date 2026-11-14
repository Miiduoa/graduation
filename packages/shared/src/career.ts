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
/** Only a single explicitly year-qualified date in a career deadline/event title. Publication dates never become deadlines. */
export function careerTitleDate(title: string) {
  if (!/截止|報名|申請|徵才|說明會|講座|博覽會/.test(title)) return '';
  const matches = [
    ...title.matchAll(/(?<!\d)(20\d{2}|1[01]\d)[年/.-](\d{1,2})[月/.-](\d{1,2})(?:日)?(?!\d)/g),
  ];
  if (matches.length !== 1) return '';
  const [, y, m, d] = matches[0];
  const year = Number(y) + (y.length === 3 ? 1911 : 0);
  const date = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return careerDate(date) ? date : '';
}
export function careerTimeline(
  announcements: CareerAnnouncement[],
  today = careerToday(),
): CareerTimelineItem[] {
  const seen = new Set<string>();
  return announcements
    .flatMap((a) => {
      const date = careerTitleDate(a.title);
      const key = a.url.replace(/,r\d+(?=\.php)/, '');
      if (!date || date < today || seen.has(key)) return [];
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
