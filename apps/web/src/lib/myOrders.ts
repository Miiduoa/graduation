import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from './firebase';

export type MyOrder = {
  id: string;
  shop: string;
  total: number | null;
  status: string;
  queueNumber: number | null;
  createdAt: unknown;
  items: { name: string; quantity: number }[];
  cancelledBy: string | null;
  cancelReason: string | null;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function myOrderOf(id: string, row: Record<string, unknown>): MyOrder {
  const items = Array.isArray(row.items) ? (row.items as Record<string, unknown>[]) : [];
  const queueNumber = row.queueNumber;
  return {
    id,
    shop: text(row.cafeteria) ?? text(row.merchantName) ?? '校園餐廳',
    total: typeof row.total === 'number' ? row.total : null,
    status: text(row.status) ?? 'pending',
    queueNumber:
      typeof queueNumber === 'number' && Number.isSafeInteger(queueNumber) && queueNumber > 0
        ? queueNumber
        : null,
    createdAt: row.createdAt ?? null,
    items: items
      .filter(item => item && typeof item.name === 'string' && item.name)
      .map(item => ({ name: item.name as string, quantity: typeof item.quantity === 'number' ? item.quantity : 0 })),
    cancelledBy: text(row.cancelledBy),
    cancelReason: text(row.cancelReason),
  };
}

/**
 * 「我的訂單」：讀學生自己的訂單副本（users/{uid}/schools/{schoolId}/orders），由新到舊，即時更新。
 * 號碼和狀態以伺服器上的訂單為準。
 */
export function watchMyOrders(
  uid: string,
  schoolId: string,
  onChange: (orders: MyOrder[]) => void,
  onError: (error: unknown) => void,
): () => void {
  if (!uid || !schoolId || !isFirebaseConfigured()) {
    onError(new Error('firebase-unavailable'));
    return () => undefined;
  }
  try {
    return onSnapshot(
      query(collection(getDb(), 'users', uid, 'schools', schoolId, 'orders'), orderBy('createdAt', 'desc'), limit(30)),
      snapshot => onChange(snapshot.docs.map(row => myOrderOf(row.id, row.data()))),
      onError,
    );
  } catch (error) {
    onError(error);
    return () => undefined;
  }
}
