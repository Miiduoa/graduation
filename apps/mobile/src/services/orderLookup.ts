import { doc, getDocFromServer } from 'firebase/firestore';
import * as Crypto from 'expo-crypto';
import { getAuthInstance, getDb } from '../firebase';

/** 伺服器確定沒有這張單時的話；「再試一次」沿用同一個送出編號 */
export const ORDER_NOT_SENT_TEXT = '訂單沒送出去，請再試一次。';
/** 用同一個編號查也查不出結果時的話，旁邊放「我的訂單」 */
export const ORDER_CHECKING_TEXT = '還在確認訂單有沒有送出，請到『我的訂單』看。';

export type PlacedOrder = {
  orderId: string;
  queueNumber?: unknown;
  createdAt?: unknown;
  status?: unknown;
  items?: Array<{ name: string; quantity: number }> | null;
};

export function placedItems(value: unknown): Array<{ name: string; quantity: number }> {
  return Array.isArray(value)
    ? value
        .filter((item) => item && typeof item.name === 'string' && item.name)
        .map((item) => ({
          name: item.name as string,
          quantity: typeof item.quantity === 'number' ? item.quantity : 0,
        }))
    : [];
}

/**
 * 建單結果不明（斷線、逾時）時，用同一個送出編號算出訂單編號（和後端一樣是 co_ + sha256(uid NUL requestId)），
 * 從伺服器讀學生自己的訂單副本。查到回那張單；伺服器確定沒有回 null；查不出結果就丟錯。
 */
export async function lookUpPlacedOrder(schoolId: string, requestId: string): Promise<PlacedOrder | null> {
  const uid = getAuthInstance()?.currentUser?.uid;
  if (!uid || !schoolId || !requestId) throw new Error('order-lookup-unavailable');
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${uid}\u0000${requestId}`,
  );
  const orderId = `co_${digest}`;
  const snapshot = await getDocFromServer(
    doc(getDb(), 'users', uid, 'schools', schoolId, 'orders', orderId),
  );
  if (!snapshot.exists()) return null;
  const row = snapshot.data() as Record<string, unknown>;
  if (row.userId !== uid || row.requestId !== requestId) throw new Error('order-lookup-mismatch');
  return {
    orderId,
    queueNumber: row.queueNumber,
    createdAt: row.createdAt,
    status: row.status,
    items: placedItems(row.items),
  };
}

export type UnknownOrderOutcome =
  | { kind: 'found'; order: PlacedOrder }
  | { kind: 'not-sent'; message: string }
  | { kind: 'checking'; message: string };

/** 結果不明時查一次，決定要顯示哪一種結果 */
export async function resolveUnknownOrderOutcome(
  schoolId: string,
  requestId: string,
): Promise<UnknownOrderOutcome> {
  try {
    const order = await lookUpPlacedOrder(schoolId, requestId);
    return order ? { kind: 'found', order } : { kind: 'not-sent', message: ORDER_NOT_SENT_TEXT };
  } catch {
    return { kind: 'checking', message: ORDER_CHECKING_TEXT };
  }
}
