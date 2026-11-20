/** 對方婉拒好友邀請後，送出邀請的人要等七天才能再送。 */
export const FRIEND_RESEND_WAIT_MS = 7 * 24 * 60 * 60 * 1000;

export function friendResendAt(declinedAtMs: number): number {
  return declinedAtMs + FRIEND_RESEND_WAIT_MS;
}

/** 用台北時間算月、日。 */
export function taipeiMonthDay(ms: number): { month: number; day: number } {
  const taipei = new Date(ms + 8 * 60 * 60 * 1000);
  return { month: taipei.getUTCMonth() + 1, day: taipei.getUTCDate() };
}

/** 只給送出邀請的人看；被邀請的人那邊不顯示。 */
export function friendResendCopy(declinedAtMs: number): string {
  const { month, day } = taipeiMonthDay(friendResendAt(declinedAtMs));
  return `對方婉拒了，${month} 月 ${day} 日之後才能再送。`;
}

export function canResendFriendRequest(declinedAtMs: number, now = Date.now()): boolean {
  return now > friendResendAt(declinedAtMs);
}
