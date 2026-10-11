import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import type { Order } from '../data/types';
import { getDb, getFunctionsInstance } from '../firebase';

function toIsoStringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (value && typeof (value as { seconds?: number }).seconds === 'number') {
    return new Date((value as { seconds: number }).seconds * 1000).toISOString();
  }
  return null;
}

function mapOrderRecord(id: string, data: Record<string, unknown>): Order {
  const createdAt = toIsoStringOrNull(data.createdAt) ?? new Date(0).toISOString();
  const updatedAt = toIsoStringOrNull(data.updatedAt) ?? undefined;

  return {
    id,
    userId: String(data.userId ?? ''),
    schoolId: typeof data.schoolId === 'string' ? data.schoolId : undefined,
    items: Array.isArray(data.items) ? (data.items as Order['items']) : [],
    subtotal: typeof data.subtotal === 'number' ? data.subtotal : undefined,
    tax: typeof data.tax === 'number' ? data.tax : undefined,
    total: typeof data.total === 'number' ? data.total : undefined,
    totalAmount:
      typeof data.totalAmount === 'number'
        ? data.totalAmount
        : typeof data.total === 'number'
          ? data.total
          : undefined,
    status: String(data.status ?? 'pending') as Order['status'],
    paymentStatus: String(data.paymentStatus ?? 'pending') as Order['paymentStatus'],
    merchantId: typeof data.merchantId === 'string' ? data.merchantId : undefined,
    merchantName: typeof data.merchantName === 'string' ? data.merchantName : undefined,
    cafeteria: typeof data.cafeteria === 'string' ? data.cafeteria : undefined,
    cafeteriaId: typeof data.cafeteriaId === 'string' ? data.cafeteriaId : undefined,
    queueNumber:
      typeof data.queueNumber === 'string' || typeof data.queueNumber === 'number'
        ? String(data.queueNumber)
        : undefined,
    estimatedTime: typeof data.estimatedTime === 'number' ? data.estimatedTime : undefined,
    totalPrice:
      typeof data.totalPrice === 'number'
        ? data.totalPrice
        : typeof data.totalAmount === 'number'
          ? data.totalAmount
          : undefined,
    pickupTime: typeof data.pickupTime === 'string' ? data.pickupTime : undefined,
    note: typeof data.note === 'string' ? data.note : undefined,
    createdAt,
    updatedAt,
  };
}

export async function listMerchantOrders(input: {
  schoolId: string;
  cafeteriaId: string;
  max?: number;
  db?: Firestore;
}): Promise<Order[]> {
  const db = input.db ?? getDb();
  const snap = await getDocs(
    query(
      collection(db, 'schools', input.schoolId, 'orders'),
      where('cafeteriaId', '==', input.cafeteriaId),
      limit(input.max ?? 50),
    ),
  );

  return snap.docs
    .map((docSnap) => mapOrderRecord(docSnap.id, docSnap.data() as Record<string, unknown>))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getMerchantOrder(input: {
  schoolId: string;
  orderId: string;
  db?: Firestore;
}): Promise<Order | null> {
  const db = input.db ?? getDb();
  const snap = await getDoc(doc(db, 'schools', input.schoolId, 'orders', input.orderId));
  if (!snap.exists()) {
    return null;
  }

  return mapOrderRecord(snap.id, snap.data() as Record<string, unknown>);
}

export async function updateMerchantOrderStatus(input: {
  schoolId: string;
  orderId: string;
  status: string;
}): Promise<Order | null> {
  const callable = httpsCallable<
    { schoolId: string; orderId: string; status: string },
    { success?: boolean }
  >(getFunctionsInstance(), 'updateOrderStatus');

  await callable({
    schoolId: input.schoolId,
    orderId: input.orderId,
    status: input.status,
  });

  return getMerchantOrder({
    schoolId: input.schoolId,
    orderId: input.orderId,
  });
}

/**
 * 店家按「給號碼」：走同一支 assignQueueNumber（一定帶 orderId，as: 'merchant'）。
 * 伺服器檢查是不是這家店在職的店員；同一筆訂單已經有號碼就回原本那個號碼。
 * 待接單的訂單會一併接單。
 */
export async function giveMerchantQueueNumber(input: {
  schoolId: string;
  orderId: string;
  cafeteriaId: string;
}): Promise<{ queueNumber: number; status?: Order['status'] }> {
  const callable = httpsCallable<
    { schoolId: string; orderId: string; vendorId: string; as: 'merchant' },
    { queueNumber?: number; status?: Order['status'] }
  >(getFunctionsInstance(), 'assignQueueNumber');
  const result = await callable({
    schoolId: input.schoolId,
    orderId: input.orderId,
    vendorId: input.cafeteriaId,
    as: 'merchant',
  });
  const queueNumber = result.data?.queueNumber;
  if (typeof queueNumber !== 'number' || !Number.isSafeInteger(queueNumber) || queueNumber <= 0) {
    throw new Error('號碼還沒給出去，請稍後再試一次。');
  }
  return { queueNumber, status: result.data?.status };
}
