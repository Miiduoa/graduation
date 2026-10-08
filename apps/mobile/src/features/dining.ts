import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { collection, doc, getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getDb, getFunctionsInstance, isFirebaseMockMode } from '../firebase';

export type DiningScope = { userId: string; schoolId: string };
export type DiningVenue = { id: string; name: string; location: string; orderingEnabled: boolean };
export type DiningMenu = {
  id: string;
  name: string;
  cafeteriaId: string;
  description: string;
  price: number | null;
  orderable: boolean;
};
export type DiningCatalog = { venues: DiningVenue[]; menus: DiningMenu[] };
export type DiningIntent = DiningScope & {
  requestId: string;
  orderId: string;
  cafeteriaId: string;
  items: { menuItemId: string; quantity: number }[];
  expectedTotal: number;
  label: string;
};
export type DiningReceipt = { id: string; total: number; status: string; label: string };
export class DiningError extends Error {
  constructor(
    message: string,
    readonly kind: 'unavailable' | 'not-sent' | 'unknown' = 'unavailable',
  ) {
    super(message);
  }
}
function assertScope(scope: DiningScope, isCurrent: () => boolean) {
  if (
    !isCurrent() ||
    isFirebaseMockMode() ||
    !scope.userId ||
    !scope.schoolId ||
    getAuthInstance().currentUser?.uid !== scope.userId
  ) {
    throw new DiningError('登入狀態已變更，請重新開啟餐廳頁面。');
  }
}
const key = (scope: DiningScope) =>
  `@campus-dining-pending:v1:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.schoolId)}`;
const pendingIntentLocks = new Map<string, Promise<void>>();
async function withIntentLock<T>(
  scope: DiningScope,
  operation: (storageKey: string) => Promise<T>,
) {
  const storageKey = key(scope);
  const previous = pendingIntentLocks.get(storageKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  pendingIntentLocks.set(storageKey, current);
  await previous;
  try {
    return await operation(storageKey);
  } finally {
    release();
    if (pendingIntentLocks.get(storageKey) === current) pendingIntentLocks.delete(storageKey);
  }
}
export const diningTotal = (price: number, quantity = 1) => {
  const subtotalCents = Math.round(price * 100) * quantity;
  const subtotal = subtotalCents / 100;
  const tax = Math.round(subtotal * 0.05);
  return { subtotal, tax, total: (subtotalCents + tax * 100) / 100 };
};
export async function loadDiningCatalog(
  scope: DiningScope,
  isCurrent: () => boolean,
): Promise<DiningCatalog> {
  assertScope(scope, isCurrent);
  const db = getDb();
  const [venueSnap, firstMenus] = await Promise.all([
    getDocsFromServer(collection(db, 'schools', scope.schoolId, 'cafeterias')),
    getDocsFromServer(collection(db, 'schools', scope.schoolId, 'menus')),
  ]);
  assertScope(scope, isCurrent);
  const menuSnap = firstMenus.empty
    ? await getDocsFromServer(collection(db, 'schools', scope.schoolId, 'cafeteriaMenus'))
    : firstMenus;
  assertScope(scope, isCurrent);
  if (
    [...venueSnap.docs, ...menuSnap.docs].some(
      (entry) => entry.data().schoolId && entry.data().schoolId !== scope.schoolId,
    )
  ) {
    throw new DiningError('餐廳資料所屬學校不一致，請稍後再試。');
  }
  const venues = venueSnap.docs.map((entry) => {
    const data = entry.data();
    return {
      id: entry.id,
      name: typeof data.name === 'string' ? data.name : '未提供店名',
      location: typeof data.location === 'string' ? data.location : '',
      orderingEnabled: data.pilotStatus === 'live' && data.orderingEnabled === true,
    };
  });
  const menus = menuSnap.docs.map((entry) => {
    const data = entry.data();
    const cafeteriaId = typeof data.cafeteriaId === 'string' ? data.cafeteriaId : '';
    const price =
      typeof data.price === 'number' &&
      Number.isFinite(data.price) &&
      data.price >= 0 &&
      Number.isSafeInteger(Math.round(data.price * 100)) &&
      Math.abs(data.price * 100 - Math.round(data.price * 100)) < 0.000001
        ? data.price
        : null;
    return {
      id: entry.id,
      name: typeof data.name === 'string' ? data.name : '未提供餐點名稱',
      cafeteriaId,
      price,
      description: typeof data.description === 'string' ? data.description : '',
      orderable:
        data.available === true &&
        data.soldOut !== true &&
        data.orderingEnabled === true &&
        price !== null &&
        venues.some((venue) => venue.id === cafeteriaId && venue.orderingEnabled),
    };
  });
  return { venues, menus };
}
export async function prepareDiningIntent(
  scope: DiningScope,
  menu: DiningMenu,
  isCurrent: () => boolean,
): Promise<DiningIntent> {
  return withIntentLock(scope, async (storageKey) => {
    assertScope(scope, isCurrent);
    if (!menu.orderable || menu.price === null)
      throw new DiningError('此餐點尚未開放訂購。', 'not-sent');
    if (await AsyncStorage.getItem(storageKey)) {
      throw new DiningError('請先確認上一筆訂單的結果，再建立新訂單。', 'unknown');
    }
    assertScope(scope, isCurrent);
    const requestId = Crypto.randomUUID();
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${scope.userId}\u0000${requestId}`,
    );
    assertScope(scope, isCurrent);
    const intent: DiningIntent = {
      ...scope,
      requestId,
      orderId: `co_${digest}`,
      cafeteriaId: menu.cafeteriaId,
      items: [{ menuItemId: menu.id, quantity: 1 }],
      expectedTotal: diningTotal(menu.price).total,
      label: menu.name,
    };
    await AsyncStorage.setItem(storageKey, JSON.stringify(intent));
    assertScope(scope, isCurrent);
    return intent;
  });
}
export async function loadDiningIntent(
  scope: DiningScope,
  isCurrent: () => boolean,
): Promise<DiningIntent | null> {
  assertScope(scope, isCurrent);
  const saved = await withIntentLock(scope, (storageKey) => AsyncStorage.getItem(storageKey));
  assertScope(scope, isCurrent);
  if (!saved) return null;
  const value = JSON.parse(saved) as DiningIntent;
  if (
    value.userId !== scope.userId ||
    value.schoolId !== scope.schoolId ||
    typeof value.requestId !== 'string' ||
    !value.requestId ||
    typeof value.label !== 'string' ||
    !value.cafeteriaId ||
    !Array.isArray(value.items) ||
    value.items.length !== 1 ||
    value.items[0].quantity !== 1 ||
    !value.items[0].menuItemId ||
    !Number.isFinite(value.expectedTotal)
  ) {
    throw new DiningError('上一筆訂單資料不完整，請先到訂單紀錄確認。', 'unknown');
  }
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${scope.userId}\u0000${value.requestId}`,
  );
  assertScope(scope, isCurrent);
  if (value.orderId !== `co_${digest}`)
    throw new DiningError('上一筆訂單編號無法核對，請先到訂單紀錄確認。', 'unknown');
  return value;
}
export async function readDiningReceipt(
  intent: DiningIntent,
  isCurrent: () => boolean,
): Promise<DiningReceipt | null> {
  assertScope(intent, isCurrent);
  const snapshot = await getDocFromServer(
    doc(getDb(), 'users', intent.userId, 'schools', intent.schoolId, 'orders', intent.orderId),
  );
  assertScope(intent, isCurrent);
  if (!snapshot.exists()) return null;
  const row = snapshot.data();
  const item = Array.isArray(row.items) && row.items.length === 1 ? row.items[0] : null;
  if (
    row.schemaVersion !== 2 ||
    row.userId !== intent.userId ||
    row.schoolId !== intent.schoolId ||
    row.cafeteriaId !== intent.cafeteriaId ||
    row.requestId !== intent.requestId ||
    row.paymentMethod !== 'onsite' ||
    row.currency !== 'TWD' ||
    row.total !== intent.expectedTotal ||
    item?.menuItemId !== intent.items[0].menuItemId ||
    item?.quantity !== 1 ||
    !['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'].includes(row.status)
  ) {
    throw new DiningError('訂單回執與送出內容不一致，請先到訂單紀錄確認。', 'unknown');
  }
  return {
    id: intent.orderId,
    total: row.total,
    status: row.status,
    label: typeof item.name === 'string' ? item.name : intent.label,
  };
}
export async function submitDiningIntent(
  intent: DiningIntent,
  isCurrent: () => boolean,
): Promise<DiningReceipt> {
  assertScope(intent, isCurrent);
  try {
    const existing = await readDiningReceipt(intent, isCurrent);
    if (existing) {
      await clearDiningIntent(intent);
      return existing;
    }
    assertScope(intent, isCurrent);
    const call = httpsCallable(getFunctionsInstance(), 'createOrder');
    await call({
      userId: intent.userId,
      schoolId: intent.schoolId,
      cafeteriaId: intent.cafeteriaId,
      requestId: intent.requestId,
      items: intent.items,
      expectedTotal: intent.expectedTotal,
      paymentMethod: 'onsite',
    });
    assertScope(intent, isCurrent);
    const receipt = await readDiningReceipt(intent, isCurrent);
    if (!receipt)
      throw new DiningError(
        '尚未確認訂單結果，請使用同一筆訂單重新確認，避免重複下單。',
        'unknown',
      );
    await clearDiningIntent(intent);
    return receipt;
  } catch (error) {
    assertScope(intent, isCurrent);
    const rejection = error as { code?: string; details?: { orderOutcome?: string } };
    if (
      rejection.code?.startsWith('functions/') &&
      rejection.details?.orderOutcome === 'not_created'
    ) {
      await clearDiningIntent(intent);
      throw new DiningError(
        '訂單未成立。餐點、金額或接單狀態可能已變更，請更新菜單後重新確認。',
        'not-sent',
      );
    }
    if (error instanceof DiningError) throw error;
    throw new DiningError('尚未確認訂單結果。請重新確認同一筆訂單，避免重複下單。', 'unknown');
  }
}
export async function clearDiningIntent(intent: DiningScope & { requestId: string }) {
  // A confirmed receipt remains valid even when removing a local retry marker fails.
  await withIntentLock(intent, async (storageKey) => {
    const saved = await AsyncStorage.getItem(storageKey);
    if (saved && (JSON.parse(saved) as DiningIntent).requestId === intent.requestId) {
      await AsyncStorage.removeItem(storageKey);
    }
  }).catch(() => undefined);
}
