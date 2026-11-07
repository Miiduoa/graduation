/** Inclusive last instant of a Taiwan calendar day, independent of device timezone. */
export function taiwanFeedDayEnd(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (checked.getUTCFullYear() !== year ||
      checked.getUTCMonth() !== month - 1 ||
      checked.getUTCDate() !== day) return null;
  return new Date(Date.UTC(year, month - 1, day + 1) - 8 * 60 * 60 * 1000 - 1);
}
