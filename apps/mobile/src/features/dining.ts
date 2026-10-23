import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as firestore from 'firebase/firestore';
import { collection, doc, getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getDb, getFunctionsInstance, isFirebaseMockMode } from '../firebase';
import { fetchCafeteriaCatalog } from '../services/cafeteriaCatalog';
import {
  parseCafeteriaReviewStatus,
  type CafeteriaReviewStatus,
} from '@campus/shared/src/cafeteriaCatalog';

export type DiningScope = { userId: string; schoolId: string };
export type DiningVenue = {
  id: string;
  name: string;
  location: string;
  orderingEnabled: boolean;
  reviewStatus: CafeteriaReviewStatus;
};
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
export type DiningReceipt = {
  id: string;
  total: number;
  status: string;
  label: string;
  /** 伺服器發的取餐號碼；沒拿到是 null（畫面寫「號碼還沒拿到，請到櫃台確認。」） */
  queueNumber?: number | null;
  /** 下單時間 ISO，拿去櫃台時對單用 */
  createdAt?: string | null;
  items?: { name: string; quantity: number }[];
  /** 取消的是誰：'merchant' 店家、'customer' 學生自己 */
  cancelledBy?: string | null;
  cancelReason?: string | null;
};
export type DiningReceiptPatch = {
  queueNumber: number | null;
  status?: string;
  cancelledBy?: string | null;
  cancelReason?: string | null;
};
function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}
function realQueueNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}
function isoOf(value: unknown): string | null {
  if (typeof value === 'string' && Number.isFinite(new Date(value).getTime())) return value;
  const maybe = value as { toDate?: () => Date } | null;
  if (maybe && typeof maybe.toDate === 'function') {
    const date = maybe.toDate();
    if (date instanceof Date && Number.isFinite(date.getTime())) return date.toISOString();
  }
  return null;
}
/** 伺服器沒確認建單時給學生看的話；「再試一次」沿用同一個訂單編號，不會重複下單 */
export const ORDER_NOT_SENT_TEXT = '訂單沒送出去，請再試一次。';
/** 斷線、逾時後用同一個訂單編號查也查不出結果時給學生看的話，旁邊放「我的訂單」 */
export const ORDER_CHECKING_TEXT = '還在確認訂單有沒有送出，請到『我的訂單』看。';
export class DiningError extends Error {
  constructor(
    message: string,
    readonly kind: 'unavailable' | 'not-sent' | 'unknown' | 'checking' = 'unavailable',
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
async function loadDiningCatalogFromApi(schoolId: string): Promise<DiningCatalog> {
  const { cafeterias: locations, menus: items } = await fetchCafeteriaCatalog(schoolId);
  const venues = locations.map((row) => ({
    id: row.id,
    name: row.name,
    location: row.location ?? '',
    orderingEnabled: row.merchantMode === 'native_order',
    reviewStatus: row.reviewStatus,
  }));
  const menus = items.map((item) => {
      const venue = venues.find((row) => row.id === item.cafeteriaId);
      const price =
        typeof item.price === 'number' &&
        Number.isFinite(item.price) &&
        item.price >= 0 &&
        Number.isSafeInteger(Math.round(item.price * 100))
          ? item.price
          : null;
      return {
        id: item.id,
        name: item.name,
        cafeteriaId: item.cafeteriaId,
        description: item.description ?? '',
        price,
        orderable:
          item.available === true &&
          item.soldOut !== true &&
          price !== null &&
          Boolean(venue?.orderingEnabled),
      };
    });
  return { venues, menus };
}

export async function loadPublicDiningCatalog(schoolId: string): Promise<DiningCatalog> {
  if (!schoolId) throw new DiningError('請指定學校');
  return loadDiningCatalogFromApi(schoolId);
}

export async function loadDiningCatalog(
  scope: DiningScope,
  isCurrent: () => boolean,
): Promise<DiningCatalog> {
  assertScope(scope, isCurrent);
  try {
    const catalog = await loadDiningCatalogFromApi(scope.schoolId);
    assertScope(scope, isCurrent);
    return catalog;
  } catch {
    // Platform catalog unavailable: keep the school-scoped Firestore read.
  }
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
      reviewStatus: parseCafeteriaReviewStatus(
        data.reviewStatus ?? data.verificationStatus ?? data.catalogReview,
      ),
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
    queueNumber: realQueueNumber(row.queueNumber),
    createdAt: isoOf(row.createdAt),
    cancelledBy: textOrNull(row.cancelledBy),
    cancelReason: textOrNull(row.cancelReason),
    items: [
      {
        name: typeof item.name === 'string' ? item.name : intent.label,
        quantity: typeof item.quantity === 'number' ? item.quantity : 1,
      },
    ],
  };
}

/**
 * 訂單還沒結束前，盯著學生自己的訂單副本：店家給號碼就換成真的號碼，店家取消就拿掉號碼。
 * 回傳取消監聽；沒辦法監聽時回 null。
 */
export function watchDiningReceipt(
  scope: DiningScope & { orderId: string },
  onChange: (patch: DiningReceiptPatch) => void,
): (() => void) | null {
  const listen = (firestore as { onSnapshot?: typeof firestore.onSnapshot }).onSnapshot;
  if (typeof listen !== 'function' || isFirebaseMockMode()) return null;
  try {
    return listen(
      doc(getDb(), 'users', scope.userId, 'schools', scope.schoolId, 'orders', scope.orderId),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const row = snapshot.data();
        onChange({
          queueNumber: realQueueNumber(row.queueNumber),
          ...(typeof row.status === 'string' ? { status: row.status } : {}),
          cancelledBy: textOrNull(row.cancelledBy),
          cancelReason: textOrNull(row.cancelReason),
        });
      },
      () => undefined,
    );
  } catch {
    return null;
  }
}
export type MyOrder = {
  id: string;
  shop: string;
  total: number | null;
  status: string;
  queueNumber: number | null;
  createdAt: string | null;
  items: { name: string; quantity: number }[];
  cancelledBy: string | null;
  cancelReason: string | null;
};
function myOrderOf(id: string, row: Record<string, unknown>): MyOrder {
  const items = Array.isArray(row.items) ? (row.items as Record<string, unknown>[]) : [];
  return {
    id,
    shop: textOrNull(row.cafeteria) ?? textOrNull(row.merchantName) ?? '校園餐廳',
    total: typeof row.total === 'number' ? row.total : null,
    status: textOrNull(row.status) ?? 'pending',
    queueNumber: realQueueNumber(row.queueNumber),
    createdAt: isoOf(row.createdAt),
    items: items
      .filter((item) => item && typeof item.name === 'string' && item.name)
      .map((item) => ({
        name: item.name as string,
        quantity: typeof item.quantity === 'number' ? item.quantity : 0,
      })),
    cancelledBy: textOrNull(row.cancelledBy),
    cancelReason: textOrNull(row.cancelReason),
  };
}
/**
 * 「我的訂單」：讀學生自己的訂單副本（users/{uid}/schools/{schoolId}/orders），由新到舊，即時更新。
 * 號碼、狀態都以伺服器上的訂單為準，App 關掉重開一樣讀得到；不讀手機本機存的訂單。
 */
export function watchMyOrders(
  scope: DiningScope,
  onChange: (orders: MyOrder[]) => void,
  onError: (error: unknown) => void,
): () => void {
  if (!scope.userId || !scope.schoolId || isFirebaseMockMode()) {
    onChange([]);
    return () => undefined;
  }
  try {
    return firestore.onSnapshot(
      firestore.query(
        collection(getDb(), 'users', scope.userId, 'schools', scope.schoolId, 'orders'),
        firestore.orderBy('createdAt', 'desc'),
        firestore.limit(30),
      ),
      (snapshot) => onChange(snapshot.docs.map((row) => myOrderOf(row.id, row.data()))),
      onError,
    );
  } catch (error) {
    onError(error);
    return () => undefined;
  }
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
      throw new DiningError(ORDER_NOT_SENT_TEXT, 'unknown');
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
    if (error instanceof DiningError && error.kind !== 'unknown') throw error;
    // 結果不明（斷線、逾時、回執還沒讀到）：先用同一個訂單編號查一次
    let found: DiningReceipt | null;
    try {
      found = await readDiningReceipt(intent, isCurrent);
    } catch (lookupError) {
      if (lookupError instanceof DiningError && lookupError.kind !== 'unknown') throw lookupError;
      throw new DiningError(ORDER_CHECKING_TEXT, 'checking');
    }
    if (found) {
      await clearDiningIntent(intent);
      return found;
    }
    // 伺服器確定沒有這張單：請學生再試一次，沿用同一個編號
    throw new DiningError(ORDER_NOT_SENT_TEXT, 'unknown');
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
