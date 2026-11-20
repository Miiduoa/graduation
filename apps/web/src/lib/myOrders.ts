import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
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

function orderCollection(uid: string, schoolId: string) {
  if (!uid || !schoolId || !isFirebaseConfigured()) throw new Error('firebase-unavailable');
  return collection(getDb(), 'users', uid, 'schools', schoolId, 'orders');
}

export function watchMyOrders(
  uid: string,
  schoolId: string,
  onChange: (orders: MyOrder[], fromCache: boolean) => void,
  onError: (error: unknown) => void,
): () => void {
  try {
    return onSnapshot(
      query(orderCollection(uid, schoolId), orderBy('createdAt', 'desc'), limit(30)),
      { includeMetadataChanges: true },
      (snapshot) => onChange(
        snapshot.docs.map((row) => myOrderOf(row.id, row.data())),
        snapshot.metadata.fromCache,
      ),
      onError,
    );
  } catch (error) {
    onError(error);
    return () => undefined;
  }
}

// Notifications can refer to an order older than the recent list.
export function watchMyOrder(
  uid: string,
  schoolId: string,
  orderId: string,
  onChange: (order: MyOrder | null, fromCache: boolean) => void,
  onError: (error: unknown) => void,
): () => void {
  try {
    return onSnapshot(
      doc(orderCollection(uid, schoolId), orderId),
      { includeMetadataChanges: true },
      (snapshot) => onChange(
        snapshot.exists() ? myOrderOf(snapshot.id, snapshot.data()) : null,
        snapshot.metadata.fromCache,
      ),
      onError,
    );
  } catch (error) {
    onError(error);
    return () => undefined;
  }
}
