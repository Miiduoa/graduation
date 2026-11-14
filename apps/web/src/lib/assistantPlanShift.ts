import { createPlanProtection, type PlanProtectionEvent } from './assistantPlanProtection';

export type PlanShiftResult = {
  before: PlanProtectionEvent[];
  after: PlanProtectionEvent[];
  selectedIndices: number[];
  protectedIndices: number[];
  offsetMinutes: number;
};

const DAY_MS = 86400000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60000;
const MAX_EVENTS = 16;
const ORIGINAL_ERROR = '原提議內容無法完整核對，請重新取得行程預覽。';
const RANGE_ERROR = '平移後的日期超出可用範圍，開始與結束日期最多相隔 31 天。';

function indices(raw: unknown, length: number, required: boolean): number[] {
  if (!Array.isArray(raw) || raw.length > MAX_EVENTS || (required && !raw.length))
    throw new Error('請選擇原提議中的行程，且不可重複選取。');
  const result = new Set<number>();
  for (let index = 0; index < raw.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error(ORIGINAL_ERROR);
    const value: unknown = descriptor.value;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= length || result.has(value))
      throw new Error('請選擇原提議中的行程，且不可重複選取。');
    result.add(value);
  }
  return [...result].sort((left, right) => left - right);
}

function checkedEvents(raw: unknown, message: string): PlanProtectionEvent[] {
  try {
    const events = createPlanProtection(raw, []).originalEvents;
    if (events.some(event => event.endDate && Date.parse(event.endDate) - Date.parse(event.date) > 31 * DAY_MS))
      throw new Error();
    return events;
  } catch { throw new Error(message); }
}

function shiftedEndpoint(date: string, time: string, offsetMinutes: number): { date: string; time: string } {
  // Parse an explicit UTC+8 instant, then format by UTC fields after adding the
  // same fixed offset. Neither host timezone nor DST participates in arithmetic.
  const instant = Date.parse(`${date}T${time}:00+08:00`);
  const shiftedWallTime = instant + offsetMinutes * 60000 + TAIPEI_OFFSET_MS;
  if (!Number.isFinite(shiftedWallTime)) throw new Error(RANGE_ERROR);
  const iso = new Date(shiftedWallTime).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** Content-only translation in the existing Taiwan timezone; never edits signed cards. */
export function buildPlanShift(
  events: unknown, selectedIndices: unknown, offsetMinutes: unknown, protectedIndices: unknown = [],
): PlanShiftResult {
  const before = checkedEvents(events, ORIGINAL_ERROR);
  const selected = indices(selectedIndices, before.length, true);
  const protectedItems = indices(protectedIndices, before.length, false);
  if (typeof offsetMinutes !== 'number' || !Number.isSafeInteger(offsetMinutes) ||
      offsetMinutes === 0 || Math.abs(offsetMinutes) > 1440)
    throw new Error('平移分鐘數必須是 -1440 到 1440 之間的非零整數。');
  const selectedSet = new Set(selected), protectedSet = new Set(protectedItems);
  if (selected.some(index => protectedSet.has(index)))
    throw new Error('已標記保留原樣的行程不能平移，請先調整選取項目。');
  if (selected.some(index => before[index].allDay))
    throw new Error('全天行程不能平移時間，請只選擇有起訖時間的行程。');
  const candidate = before.map((event, index) => {
    if (!selectedSet.has(index)) return { ...event };
    const start = shiftedEndpoint(event.date, event.startTime!, offsetMinutes);
    const end = shiftedEndpoint(event.endDate ?? event.date, event.endTime!, offsetMinutes);
    const next = { ...event, date: start.date, startTime: start.time, endTime: end.time };
    if (Object.hasOwn(event, 'endDate') || start.date !== end.date) next.endDate = end.date;
    else delete next.endDate;
    return next;
  });
  const after = checkedEvents(candidate, RANGE_ERROR);
  return { before, after, selectedIndices: selected, protectedIndices: protectedItems, offsetMinutes };
}
