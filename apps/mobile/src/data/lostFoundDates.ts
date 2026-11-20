const TAIWAN_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar day in Asia/Taipei as YYYY-MM-DD (no invented local clock time). */
export function taiwanCalendarDay(now: Date = new Date()): string {
  return TAIWAN_DAY.format(now);
}

/** Accept only strict YYYY-MM-DD calendar dates; do not invent an 08:00 clock time. */
export function isLostFoundDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Use UTC noon solely to validate the Y-M-D triple; never persist that clock time.
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Normalize stored/item dates for the date-only form field.
 * Prefer Taiwan calendar day when an instant is present; keep YYYY-MM-DD as-is.
 */
export function lostFoundDateFieldValue(value: string | undefined, fallback = taiwanCalendarDay()): string {
  if (!value?.trim()) return fallback;
  const trimmed = value.trim();
  if (isLostFoundDateOnly(trimmed)) return trimmed;
  const date = new Date(trimmed);
  if (!Number.isFinite(date.getTime())) return fallback;
  return taiwanCalendarDay(date);
}

/** Persist date-only values as YYYY-MM-DD strings (no synthetic morning clock). */
export function normalizeLostFoundDateInput(value: string): string {
  const trimmed = value.trim();
  if (!isLostFoundDateOnly(trimmed)) throw new Error('請填寫有效日期（YYYY-MM-DD）。');
  return trimmed;
}
