/**
 * 課表直欄順序：週一～週六，最後為週日（與校內紙本／多數課表排版一致）
 */
export const SCHEDULE_COLUMN_DAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

/**
 * 依使用者實際有課的星期顯示欄位（含週六、週日）。
 * 無任何課程列時預設週一至五（示範／空白課表）。
 */
export function deriveScheduleDisplayDays(slots: { dayOfWeek: number }[]): number[] {
  const used = new Set<number>();
  for (const s of slots) {
    const d = Number(s.dayOfWeek);
    if (Number.isInteger(d) && d >= 0 && d <= 6) used.add(d);
  }
  if (used.size === 0) return [1, 2, 3, 4, 5];
  return SCHEDULE_COLUMN_DAY_ORDER.filter((d) => used.has(d));
}
