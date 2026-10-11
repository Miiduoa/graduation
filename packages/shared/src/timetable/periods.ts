/** 靜宜大學第 1–13 節。個人課表與截圖匯入都用這張表。 */

export const WEEKDAYS = ['一', '二', '三', '四', '五'] as const;
export const WEEKDAY_LABELS = ['星期一', '星期二', '星期三', '星期四', '星期五'] as const;

export const PERIOD_TIMES: ReadonlyArray<readonly [string, string]> = [
  ['08:10', '09:00'],
  ['09:10', '10:00'],
  ['10:10', '11:00'],
  ['11:10', '12:00'],
  ['13:10', '14:00'],
  ['14:10', '15:00'],
  ['15:10', '16:00'],
  ['16:10', '17:00'],
  ['17:10', '18:00'],
  ['18:05', '18:55'],
  ['19:00', '19:50'],
  ['19:55', '20:45'],
  ['20:50', '21:40'],
];

export const PERIOD_COUNT = PERIOD_TIMES.length;

export function periodStart(period: number): string {
  return PERIOD_TIMES[period - 1]?.[0] ?? '';
}

export function periodEnd(period: number): string {
  return PERIOD_TIMES[period - 1]?.[1] ?? '';
}

export function periodRangeLabel(start: number, end: number): string {
  if (!start || !end) return '時間待定';
  return `${periodStart(start)}–${periodEnd(end)}`;
}

export function weekdayLabel(day: number): string {
  return WEEKDAY_LABELS[day - 1] ?? '未排定';
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = String(value || '0:0')
    .split(':')
    .map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}
