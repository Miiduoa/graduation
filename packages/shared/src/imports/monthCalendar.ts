import { filterPersonalEvents } from './eventDraft';
import { isPersonalImportDate } from './validation';
import type { PersonalImportRecord } from './types';

export const MONTH_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

export function isCalendarMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && isPersonalImportDate(`${month}-01`);
}

export function shiftCalendarMonth(month: string, offset: number): string {
  if (!isCalendarMonth(month)) return month;
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  const result = date.toISOString().slice(0, 7);
  return isCalendarMonth(result) ? result : month;
}

/** 日期直接比較，全天與台灣牆上時間都不轉成裝置時區。 */
export function personalEventsOnDate(records: readonly PersonalImportRecord[], date: string) {
  if (!isPersonalImportDate(date)) return [];
  return filterPersonalEvents(records).filter((row) => {
    if (!row.date || !isPersonalImportDate(row.date) || row.date > date) return false;
    const end = row.endDate || row.date;
    if (row.allDay && row.endDate) return date < end;
    if (date > end) return false;
    // 午夜結束的跨日事件不佔用結束日。
    return !(date === end && end > row.date && row.endTime === '00:00');
  });
}

export type MonthCalendarDay = { date: string; events: PersonalImportRecord[] };

/** 週日為第一欄，空格只補到完整週；事件保留原物件與完整起訖。 */
export function buildMonthCalendar(
  records: readonly PersonalImportRecord[],
  month: string,
): (MonthCalendarDay | null)[] {
  if (!isCalendarMonth(month)) return [];
  const first = new Date(`${month}-01T00:00:00Z`);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const cells: (MonthCalendarDay | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  const events = filterPersonalEvents(records, month);
  for (let day = 1; day <= last.getUTCDate(); day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    cells.push({ date, events: [] });
  }
  const days = cells.filter((day): day is MonthCalendarDay => day !== null);
  const monthEnd = days[days.length - 1].date;
  for (const event of events) {
    if (!event.date || !isPersonalImportDate(event.date)) continue;
    const start = event.date < days[0].date ? days[0].date : event.date;
    const end = event.endDate || event.date;
    const exclusiveEnd =
      (event.allDay && !!event.endDate) || (end > event.date && event.endTime === '00:00');
    const lastDate = end < monthEnd ? end : monthEnd;
    const startDay = Number(start.slice(-2));
    for (let day = startDay; day <= Number(lastDate.slice(-2)); day += 1) {
      const bucket = days[day - 1];
      if (bucket.date < start || bucket.date > lastDate) continue;
      if (exclusiveEnd && bucket.date === end) continue;
      bucket.events.push(event);
    }
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}
