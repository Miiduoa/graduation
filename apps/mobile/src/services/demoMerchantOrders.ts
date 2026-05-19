/**
 * Demo Merchant Orders — in-memory 訂單 store
 *
 * 目的：把學生下單 ↔ 店家接單在 demo 模式下串成同一份資料。
 *
 *  - 學生 OrderingScreen 按「確認下單」→ addDemoOrder()
 *  - 店家 VendorDashboardScreen / MerchantHubScreen 讀 listDemoMerchantOrders()
 *  - 學生 StudentOrdersScreen 讀 listDemoOrdersForStudent() 看狀態
 *  - 店家按「開始備餐 / 可取餐」→ updateDemoOrderStatus()
 *
 * 同時相容兩種 ID 體系：
 *  - PU 餐廳 id（tw-pu-caf-jingyuan 等）
 *  - DEMO_MERCHANTS id（merchant_cafe_a 等）
 *  比對時兩邊都試一次，避免「我送出的單店家看不到」。
 *
 * 為什麼不打 Firestore：demo uid 都是 demo_* 開頭，Firestore security rules
 *  根本不會 accept，且演示時不需要真實 cloud round-trip。
 */
import { DEMO_MERCHANT_ORDERS, type DemoMerchantOrder } from '../data/demoMerchants';
import type { Order } from '../data/types';

type DemoOrderStatus = Order['status'];

const liveOrders: Order[] = [];
const statusOverrides = new Map<string, DemoOrderStatus>();
const subscribers = new Set<() => void>();

function notify() {
  for (const cb of subscribers) {
    try {
      cb();
    } catch {
      /* swallow */
    }
  }
}

export function subscribeDemoOrders(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function addDemoOrder(order: Order): void {
  const existing = liveOrders.findIndex((o) => o.id === order.id);
  if (existing >= 0) {
    liveOrders[existing] = order;
  } else {
    liveOrders.unshift(order);
  }
  notify();
}

export function updateDemoOrderStatus(orderId: string, status: DemoOrderStatus): void {
  statusOverrides.set(orderId, status);
  const idx = liveOrders.findIndex((o) => o.id === orderId);
  if (idx >= 0) {
    liveOrders[idx] = { ...liveOrders[idx], status };
  }
  notify();
}

function matchesMerchant(order: Pick<Order, 'cafeteriaId' | 'merchantId' | 'cafeteria'>, key: string): boolean {
  if (!key) return false;
  return (
    order.cafeteriaId === key ||
    order.merchantId === key ||
    order.cafeteria === key
  );
}

/** 把 demoMerchants.ts 靜態訂單轉成 Order 形狀，供店家畫面 fallback 使用 */
function staticDemoMerchantOrdersAsOrders(merchantId: string): Order[] {
  const matched = DEMO_MERCHANT_ORDERS.filter((o) => o.merchantId === merchantId);
  return matched.map((o) => mapDemoMerchantOrder(o));
}

function mapDemoMerchantOrder(o: DemoMerchantOrder): Order {
  const override = statusOverrides.get(o.id);
  const status = override ?? mapStatus(o.status);
  return {
    id: o.id,
    userId: o.studentUid ?? 'demo_student_kuchih',
    items: [
      {
        menuItemId: `${o.merchantId}-line`,
        name: o.items,
        quantity: 1,
        price: o.total,
      },
    ],
    total: o.total,
    totalAmount: o.total,
    totalPrice: o.total,
    status,
    paymentStatus: 'paid',
    merchantId: o.merchantId,
    cafeteria: o.merchantId,
    cafeteriaId: o.merchantId,
    note: o.note,
    createdAt: o.orderedAt,
  };
}

function mapStatus(s: DemoMerchantOrder['status']): DemoOrderStatus {
  switch (s) {
    case 'pending':
      return 'pending';
    case 'processing':
      return 'preparing';
    case 'ready':
      return 'ready';
    case 'completed':
      return 'completed';
    default:
      return 'pending';
  }
}

/** 給店家畫面：列出某店收到的所有訂單（live + static demo） */
export function listDemoMerchantOrders(merchantKey: string): Order[] {
  if (!merchantKey) return [];
  const staticOrders = staticDemoMerchantOrdersAsOrders(merchantKey);
  const live = liveOrders.filter((o) => matchesMerchant(o, merchantKey));
  const merged = [...live, ...staticOrders];

  // dedupe by id（live 優先）
  const seen = new Set<string>();
  const dedup: Order[] = [];
  for (const o of merged) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    const overrideStatus = statusOverrides.get(o.id);
    dedup.push(overrideStatus ? { ...o, status: overrideStatus } : o);
  }
  return dedup.sort((a, b) =>
    String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
  );
}

/** 給學生畫面：列出 user 自己下的訂單（live + 靜態 user-orders 由 caller 合併） */
export function listDemoOrdersForStudent(userId: string): Order[] {
  return liveOrders
    .filter((o) => o.userId === userId)
    .map((o) => {
      const override = statusOverrides.get(o.id);
      return override ? { ...o, status: override } : o;
    });
}

/** 給 caller：判斷某 orderId 是不是 demo store 內的單 */
export function isDemoOrderId(orderId: string): boolean {
  return liveOrders.some((o) => o.id === orderId);
}

export function resetDemoOrderStore(): void {
  liveOrders.length = 0;
  statusOverrides.clear();
  notify();
}
