/**
 * Demo Ordering — single reliable order path for oral-exam demos.
 *
 * Demo users cannot depend on the production restaurant backend being seeded or
 * Firestore rules accepting demo_* uids. This helper writes the same order into:
 *   - demoStore messages
 *   - demoMerchantOrders live order list
 *   - roleEventBus order_placed event
 *
 * Any demo role may order. The buyer role is preserved so confirmations do not
 * leak into the student inbox when a teacher/vendor/alumni/guest places an order.
 */
import type { Cafeteria, MenuItem, Order } from '../data/types';
import {
  DEMO_EXAM_BENTO_MERCHANT_ID,
  DEMO_MENU,
  DEMO_MERCHANTS,
  getDemoMerchantById,
  type DemoMenuItem,
  type DemoMerchant,
} from '../data/demoMerchants';
import { getDemoUserStory } from '../data/demoUserStories';
import { addDemoOrder } from './demoMerchantOrders';
import { simulateStudentOrderFood } from './demoActionSimulator';
import { placeOrder, type DemoUserRole, type StoreOrder } from './demoStore';

export const DEMO_ORDERABLE_MERCHANT_ID = DEMO_EXAM_BENTO_MERCHANT_ID;
const DEMO_FALLBACK_MENU_ID = 'm_exam_bento_1';

export type DemoOrderActor = {
  uid: string;
  name: string;
  role: DemoUserRole;
};

export type DemoDiningOrderLine = {
  itemId?: string | null;
  itemName?: string | null;
  quantity?: number | string | null;
  price?: number | string | null;
  note?: string | null;
};

export type DemoDiningOrderInput = {
  userId: string;
  schoolId?: string;
  userName?: string;
  role?: string | null;
  merchantId?: string | null;
  merchantName?: string | null;
  cafeteriaId?: string | null;
  cafeteriaName?: string | null;
  itemId?: string | null;
  itemName?: string | null;
  quantity?: number | string | null;
  price?: number | string | null;
  note?: string | null;
  items?: DemoDiningOrderLine[];
  source?: string;
};

export type DemoDiningOrderResult = {
  order: Order;
  storeOrder: StoreOrder;
  actor: DemoOrderActor;
  merchant: DemoMerchant;
  item: DemoMenuItem;
  lines: Array<{
    item: DemoMenuItem;
    quantity: number;
    price: number;
    total: number;
    substituted: boolean;
  }>;
  quantity: number;
  total: number;
  substituted: boolean;
};

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s｜|／/,，、\-—_()（）]/g, '');
}

function toPositiveInt(value: unknown, fallback = 1): number {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 20);
}

function toDemoUserRole(role: string | null | undefined): DemoUserRole {
  switch (role) {
    case 'teacher':
    case 'professor':
    case 'faculty':
      return 'teacher';
    case 'ta':
      return 'ta';
    case 'club_officer':
      return 'club_officer';
    case 'department_head':
    case 'department':
    case 'principal':
      return 'department_head';
    case 'admin':
    case 'staff':
    case 'school':
      return 'admin';
    case 'vendor':
      return 'vendor';
    case 'alumni':
      return 'alumni';
    case 'guest':
      return 'guest';
    case 'student':
    default:
      return 'student';
  }
}

export function resolveDemoOrderActor(input: {
  userId: string;
  userName?: string | null;
  role?: string | null;
}): DemoOrderActor {
  const story = getDemoUserStory(input.userId);
  return {
    uid: input.userId,
    name: input.userName?.trim() || story?.fullName || 'Demo 使用者',
    role: story?.role ?? toDemoUserRole(input.role),
  };
}

export function getDemoDiningCafeterias(schoolId = 'pu'): Cafeteria[] {
  return DEMO_MERCHANTS.map((merchant) => ({
    id: merchant.id,
    schoolId,
    name: merchant.name,
    description: merchant.description,
    merchantId: merchant.id,
    location: merchant.location,
    openingHours: merchant.hours,
    pilotStatus: 'live',
    orderingEnabled: merchant.isOpen,
    activeOperatorCount: 1,
    rating: merchant.rating,
    reviewCount: merchant.reviewCount,
    sourceLabel: 'demo',
  }));
}

export function getDemoDiningMenuItems(schoolId = 'pu'): MenuItem[] {
  return DEMO_MENU.map((item) => {
    const merchant = getDemoMerchantById(item.merchantId);
    return {
      id: item.id,
      schoolId,
      name: item.name,
      cafeteria: merchant?.name ?? item.merchantId,
      cafeteriaId: item.merchantId,
      availableOn: 'today',
      price: item.price,
      category: item.category as any,
      description: item.tags.join('、'),
      vegetarian: item.vegetarian,
      soldOut: item.soldOut,
      popular: item.tags.includes('熱賣'),
      orderingEnabled: Boolean(merchant?.isOpen) && !item.soldOut,
      pilotStatus: 'live',
      waitTime: merchant?.id === DEMO_ORDERABLE_MERCHANT_ID ? 6 : 8,
    } as MenuItem;
  });
}

function resolveDemoMerchant(input: DemoDiningOrderInput): DemoMerchant {
  const rawId = input.merchantId ?? input.cafeteriaId ?? '';
  const rawName = input.merchantName ?? input.cafeteriaName ?? '';
  const byId = DEMO_MERCHANTS.find((merchant) => merchant.id === rawId);
  if (byId?.isOpen) return byId;

  const nameKey = normalizeText(rawName);
  if (nameKey) {
    const byName = DEMO_MERCHANTS.find((merchant) =>
      normalizeText(merchant.name).includes(nameKey) ||
      nameKey.includes(normalizeText(merchant.name)),
    );
    if (byName?.isOpen) return byName;
  }

  return getDemoMerchantById(DEMO_ORDERABLE_MERCHANT_ID) ?? DEMO_MERCHANTS[0];
}

function resolveDemoMenuItem(input: DemoDiningOrderInput | DemoDiningOrderLine, merchant: DemoMerchant): {
  item: DemoMenuItem;
  substituted: boolean;
} {
  const itemId = String(input.itemId ?? '').trim();
  const itemName = String(input.itemName ?? '').trim();
  const requestedKey = normalizeText(itemName || itemId);
  const orderable = DEMO_MENU.filter((item) => {
    const parent = getDemoMerchantById(item.merchantId);
    return Boolean(parent?.isOpen) && !item.soldOut;
  });
  const merchantItems = orderable.filter((item) => item.merchantId === merchant.id);

  const byId = orderable.find((item) => item.id === itemId);
  if (byId) return { item: byId, substituted: byId.merchantId !== merchant.id };

  if (requestedKey) {
    const merchantExact = merchantItems.find((item) => normalizeText(item.name) === requestedKey);
    if (merchantExact) return { item: merchantExact, substituted: false };

    const merchantFuzzy = merchantItems.find((item) => {
      const key = normalizeText(item.name);
      return key.includes(requestedKey) || requestedKey.includes(key);
    });
    if (merchantFuzzy) return { item: merchantFuzzy, substituted: false };

    const exact = orderable.find((item) => normalizeText(item.name) === requestedKey);
    if (exact) return { item: exact, substituted: exact.merchantId !== merchant.id };

    const fuzzy = orderable.find((item) => {
      const key = normalizeText(item.name);
      return key.includes(requestedKey) || requestedKey.includes(key);
    });
    if (fuzzy) return { item: fuzzy, substituted: fuzzy.merchantId !== merchant.id };
  }

  const fallback =
    merchantItems.find((item) => item.id === DEMO_FALLBACK_MENU_ID) ??
    merchantItems[0] ??
    orderable.find((item) => item.id === DEMO_FALLBACK_MENU_ID) ??
    orderable[0] ??
    DEMO_MENU[0];
  return { item: fallback, substituted: Boolean(requestedKey) };
}

export async function createDemoDiningOrder(
  input: DemoDiningOrderInput,
): Promise<DemoDiningOrderResult> {
  const actor = resolveDemoOrderActor(input);
  const requestedMerchant = resolveDemoMerchant(input);
  const rawLines: DemoDiningOrderLine[] = input.items?.length
    ? input.items
    : [{
        itemId: input.itemId,
        itemName: input.itemName,
        quantity: input.quantity,
        price: input.price,
        note: input.note,
      }];

  const firstResolved = resolveDemoMenuItem(rawLines[0], requestedMerchant);
  const merchant = getDemoMerchantById(firstResolved.item.merchantId) ?? requestedMerchant;
  const resolvedLines = rawLines.map((line, index) => {
    const resolved = index === 0 ? firstResolved : resolveDemoMenuItem(line, merchant);
    const quantity = toPositiveInt(line.quantity, 1);
    const requestedPrice = Number(line.price);
    const price = !resolved.substituted && Number.isFinite(requestedPrice) && requestedPrice > 0
      ? requestedPrice
      : resolved.item.price;
    return {
      ...resolved,
      quantity,
      price,
      total: price * quantity,
      requestedName: String(line.itemName ?? line.itemId ?? '').trim(),
      note: line.note ?? undefined,
    };
  });
  const primary = resolvedLines[0];
  const item = primary.item;
  const quantity = primary.quantity;
  const total = resolvedLines.reduce((sum, line) => sum + line.total, 0);
  const substituted = resolvedLines.some((line) => line.substituted);
  const storeItems = resolvedLines.map((line) => {
    const itemLabel = `${line.item.name}${line.substituted && line.requestedName ? `（替代 ${line.requestedName}）` : ''}`;
    return { name: itemLabel, qty: line.quantity, price: line.price };
  });
  const itemNotes = resolvedLines
    .map((line) => line.note)
    .filter((note): note is string => Boolean(note));
  const orderNote = input.note ?? (itemNotes.length > 0 ? itemNotes.join('；') : undefined);

  const storeOrder = placeOrder({
    studentId: actor.uid,
    studentName: actor.name,
    actorRole: actor.role,
    vendorName: merchant.name,
    items: storeItems,
  });

  const order: Order = {
    id: storeOrder.id,
    userId: actor.uid,
    schoolId: input.schoolId ?? 'pu',
    items: resolvedLines.map((line) => ({
      menuItemId: line.item.id,
      name: line.item.name,
      quantity: line.quantity,
      price: line.price,
      note: line.note,
    })),
    subtotal: total,
    total,
    totalAmount: total,
    totalPrice: total,
    status: 'pending',
    paymentStatus: 'paid',
    merchantId: merchant.id,
    merchantName: merchant.name,
    cafeteria: merchant.name,
    cafeteriaId: merchant.id,
    customerName: actor.name,
    customerRole: actor.role,
    note: orderNote,
    source: input.source ?? 'demo_ai_agent',
    createdAt: storeOrder.placedAt,
  };
  addDemoOrder(order);

  try {
    await simulateStudentOrderFood({
      studentUid: actor.uid,
      studentName: actor.name,
      merchantId: merchant.id,
      merchantName: merchant.name,
      items: resolvedLines.map((line) => `${line.item.name} ×${line.quantity}`).join('、'),
      total,
      orderId: storeOrder.id,
      buyerRole: actor.role,
    });
  } catch {
    /* role event is best effort; demoStore + merchant order already contain it */
  }

  return {
    order,
    storeOrder,
    actor,
    merchant,
    item,
    lines: resolvedLines.map((line) => ({
      item: line.item,
      quantity: line.quantity,
      price: line.price,
      total: line.total,
      substituted: line.substituted,
    })),
    quantity,
    total,
    substituted,
  };
}
