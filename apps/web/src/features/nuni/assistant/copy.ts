import { formatTaipeiDateTime, taipeiParts } from '@campus/shared/src/taipeiTime';

export const SUGGESTIONS = [
  '這禮拜有什麼要交的',
  '下一堂課在哪，幾點',
  '中午吃什麼',
  '幫我排今晚寫作業',
];

export const PAGE_LABELS: Record<string, string> = {
  today: '今日',
  timetable: '課表',
  calendar: '行事曆',
  classroom: '課程',
  orders: '訂單',
  clubs: '社團',
  map: '校園地圖',
  bus: '公車資訊',
  cafeteria: '餐廳',
  announcements: '公告',
  events: '活動',
  food: '點餐',
};

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function pageKey(href: string): string {
  const path = href.split('?')[0].replace(/^\//, '').split('/')[0];
  return path || '';
}

export function pageLabel(href: string): string {
  return PAGE_LABELS[pageKey(href)] || '頁面';
}

export function pathButtonLabel(href: string): string {
  return '開啟' + pageLabel(href);
}

export function isInternalPath(href: string): boolean {
  return /^\/[a-z][a-z0-9-]*(?:\/[A-Za-z0-9._~-]*)*(?:\?[A-Za-z0-9._~+=&%/\-]*)?(?:#[A-Za-z0-9._~-]*)?$/.test(
    href,
  );
}

export function isSafeHref(href: string): boolean {
  return isInternalPath(href) || /^https:\/\/[^\s]+$/.test(href);
}

export function formatDayLabel(date: string): string {
  const parts = taipeiParts(`${date}T12:00:00+08:00`);
  if (!parts) return date;
  const weekday = WEEKDAYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()];
  return `${parts.month}月${parts.day}日（${weekday}）`;
}

export function formatClock(value: string): string {
  return /^\d{2}:\d{2}$/.test(value) ? value : value;
}

export function formatEventWhen(args: Record<string, unknown>): string {
  const date = typeof args.date === 'string' ? args.date : '';
  const endDate = typeof args.endDate === 'string' ? args.endDate : '';
  const start = typeof args.startTime === 'string' ? args.startTime : '';
  const end = typeof args.endTime === 'string' ? args.endTime : '';
  const allDay = args.allDay === true;
  if (!date) return '';
  const day = formatDayLabel(date);
  const span = endDate && endDate !== date ? `${day} – ${formatDayLabel(endDate)}` : day;
  if (allDay) return `${span} · 全天`;
  if (start && end) return `${span} · ${formatClock(start)}–${formatClock(end)}`;
  return span;
}

export function formatYuan(minor: unknown): string {
  const n = Number(minor);
  if (!Number.isFinite(n)) return '';
  const yuan = n / 100;
  return `${Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2)} 元`;
}

export function formatPickup(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return '';
  return formatTaipeiDateTime(iso, { seconds: false }) || (iso.length >= 16 ? iso.slice(11, 16) : iso);
}

export function formatDueInstant(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDayLabel(value);
  const formatted = formatTaipeiDateTime(value, { seconds: false });
  if (formatted) return formatted;
  const md = value.match(/^(\d{1,2})[/／](\d{1,2})(?:日)?(?:\s*([0-2]?\d)[:：]([0-5]\d))?$/);
  if (!md) return value;
  return `${Number(md[1])}月${Number(md[2])}日${md[3] ? ` ${md[3].padStart(2, '0')}:${md[4]}` : ''}`;
}

export function stepFamily(name: string): string {
  if (/food/.test(name)) return '餐點與訂單';
  if (/transit/.test(name)) return '交通資訊';
  if (/campus/.test(name)) return '校園資訊';
  if (/club/.test(name)) return '社團資訊';
  if (/propose/.test(name)) return '確認提議';
  return '課務與行程';
}

export function stepStatus(status: string): string {
  return status === 'error' ? '本步驟未取得資料' : '已查詢';
}
