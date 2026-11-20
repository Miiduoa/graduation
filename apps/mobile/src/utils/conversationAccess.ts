/**
 * 對話存取相關的純函式工具
 * 將 DM id 推導、未讀判定、成員判定從 ChatScreen / MessagesHomeScreen / DmsScreen
 * 中抽出，以利單元測試與避免「看到別人訊息」的回歸。
 */

/**
 * 兩人 DM 的對話 id：必須對 (a, b) 字典序排序後拼接，以保證 A↔B 雙向開啟
 * 都會落在同一份對話文件，不會出現「我發到 X 而對方在 Y 找不到」的悲劇。
 */
export function deriveDmConversationId(
  schoolId: string,
  userA: string,
  userB: string,
): string {
  const [x, y] = [userA, userB].sort();
  return `dm_${schoolId}_${x}_${y}`;
}

/**
 * 判斷一個 uid 是否為對話成員。除了用於 Firestore 規則的雙保險，
 * 也是 UI 顯示前的最後一道過濾。
 */
export function isConversationMember(
  uid: string | null | undefined,
  memberIds: unknown,
): boolean {
  if (!uid) return false;
  if (!Array.isArray(memberIds)) return false;
  return memberIds.includes(uid);
}

type Timestampish = Date | { seconds: number; nanoseconds?: number } | string | number | undefined | null;

function toMs(value: Timestampish): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'object' && typeof (value as any).seconds === 'number') {
    return (value as any).seconds * 1000;
  }
  return null;
}

/**
 * 計算這場對話對某位使用者而言是否未讀。
 *
 * 規則：
 * 1. 若最後一則訊息是我自己發的 → 一定不是未讀。
 * 2. 否則若我有 lastReadBy[uid]，比較最後訊息時間 vs 我上次讀的時間。
 * 3. 若沒有 lastReadBy 紀錄，只要存在 lastMessageAt 就視為未讀。
 *
 * 這個 helper 同時被 MessagesHomeScreen 與未來的 DmsScreen 共用，
 * 是預防「明明是我發的訊息卻顯示成未讀」這類 UX bug 的關鍵點。
 */
export function isConversationUnread(opts: {
  uid: string | null | undefined;
  lastMessageAt: Timestampish;
  lastReadAt: Timestampish;
  lastMessageSenderId?: string | null;
}): boolean {
  const { uid, lastMessageSenderId } = opts;
  if (uid && lastMessageSenderId && lastMessageSenderId === uid) {
    return false;
  }
  const lastMsg = toMs(opts.lastMessageAt);
  if (lastMsg == null) return false;
  const lastRead = toMs(opts.lastReadAt);
  if (lastRead == null) return true;
  return lastMsg > lastRead;
}
