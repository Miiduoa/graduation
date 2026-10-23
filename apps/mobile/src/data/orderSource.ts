import { doc, getDocFromServer } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getDb, getFunctionsInstance, isFirebaseMockMode } from '../firebase';
import type { CreateOrderInput } from './source';
import type { Order } from './types';

export function assertOrderRequest(data: CreateOrderInput) {
  if (
    typeof data.requestId !== 'string' ||
    !data.requestId.trim() ||
    data.requestId.length > 128 ||
    data.requestId.includes('/')
  ) {
    throw new Error('此下單入口尚未提供可重試的送出編號，請從餐廳頁面重新確認訂單。');
  }
}
function owner(uid: string) {
  if (isFirebaseMockMode() || !uid || getAuthInstance().currentUser?.uid !== uid) {
    throw new Error('登入狀態已變更，訂單尚未確認。');
  }
}
function key(value: string | null | undefined) {
  if (!value || value.includes('/') || value === '.' || value === '..')
    throw new Error('訂單資料不完整。');
  return value;
}
export async function createOrderThroughServer(
  data: CreateOrderInput,
  resolveSchool: (uid: string, schoolId?: string) => Promise<string | undefined | null>,
): Promise<Order> {
  assertOrderRequest(data);
  owner(data.userId);
  const schoolId = key(await resolveSchool(data.userId, data.schoolId));
  owner(data.userId);
  const cafeteriaId = key(data.cafeteriaId);
  const expectedTotal = data.expectedTotal ?? data.total ?? data.totalAmount;
  if (typeof expectedTotal !== 'number' || !Number.isFinite(expectedTotal) || expectedTotal < 0) {
    throw new Error('請先確認訂單金額後再送出。');
  }
  const response = await httpsCallable<Record<string, unknown>, Record<string, unknown>>(
    getFunctionsInstance(),
    'createOrder',
  )({
    userId: data.userId,
    schoolId,
    cafeteriaId,
    requestId: data.requestId,
    items: data.items.map((item) => ({ menuItemId: item.menuItemId, quantity: item.quantity })),
    expectedTotal,
    ...(data.paymentMethod ? { paymentMethod: data.paymentMethod } : {}),
    ...(data.pickupTime ? { pickupTime: data.pickupTime } : {}),
    ...(data.note ? { note: data.note } : {}),
    ...(data.source === 'ai_agent' ? { source: 'ai_agent' } : {}),
  });
  owner(data.userId);
  const result = response.data;
  if (
    result.success !== true ||
    result.userId !== data.userId ||
    result.schoolId !== schoolId ||
    result.cafeteriaId !== cafeteriaId ||
    result.requestId !== data.requestId ||
    typeof result.orderId !== 'string'
  ) {
    throw new Error('訂單回覆無法確認，請保留送出編號並重新讀取訂單。');
  }
  const orderId = key(result.orderId);
  const snapshot = await getDocFromServer(
    doc(getDb(), 'users', data.userId, 'schools', schoolId, 'orders', orderId),
  );
  owner(data.userId);
  const row = snapshot.exists() ? snapshot.data() : null;
  if (
    !row ||
    row.schemaVersion !== 2 ||
    row.userId !== data.userId ||
    row.schoolId !== schoolId ||
    row.cafeteriaId !== cafeteriaId ||
    row.requestId !== data.requestId ||
    row.orderId !== orderId ||
    row.total !== expectedTotal ||
    row.total !== result.total ||
    row.currency !== 'TWD' ||
    !Array.isArray(row.items) ||
    row.items.length === 0 ||
    !row.items.every(
      (item) =>
        typeof item.name === 'string' &&
        Number.isFinite(item.price) &&
        item.price >= 0 &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity > 0,
    )
  ) {
    throw new Error('訂單紀錄尚未確認，請保留原送出編號，勿建立另一筆訂單。');
  }
  const created =
    typeof row.createdAt === 'string' ? new Date(row.createdAt) : row.createdAt?.toDate?.();
  if (!(created instanceof Date) || !Number.isFinite(created.getTime())) {
    throw new Error('訂單建立時間尚未確認，請重新讀取原訂單。');
  }
  return { ...row, id: orderId, createdAt: created.toISOString() } as Order;
}
