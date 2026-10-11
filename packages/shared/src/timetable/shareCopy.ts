import { taipeiMonthDay } from './friendResend';

function expiryMs(expiresAt: string | number | Date): number {
  if (expiresAt instanceof Date) return expiresAt.getTime();
  return typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
}

/** 「X 月 X 日」，用台北時間的到期日。 */
export function shareExpiryLabel(expiresAt: string | number | Date): string {
  const { month, day } = taipeiMonthDay(expiryMs(expiresAt));
  return `${month} 月 ${day} 日`;
}

/** 複製分享連結後的提示。 */
export function shareCopiedCopy(expiresAt: string | number | Date): string {
  return `分享連結已複製，${shareExpiryLabel(expiresAt)}前有效。`;
}

/** 分享頁的標題，跟複製時的提示用同一個日期。 */
export function sharedTimetableTitle(expiresAt: string | number | Date): string {
  return `同學分享的課表 · ${shareExpiryLabel(expiresAt)}前有效`;
}
