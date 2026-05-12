/**
 * 庫存管理 — 預扣 / 釋放 / 確認銷售
 *
 * 三狀態：available → reserved → sold
 *   - 下單時：reservedQty++
 *   - 取餐完成：reservedQty--, soldQty++
 *   - 取消：reservedQty--
 *
 * 本機 + Firestore 雙層：
 *   - Firestore：以 transaction 保證 atomicity（schools/{schoolId}/stock/{vendorId}_{menuItemId}_{date}）
 *   - AsyncStorage：離線降級
 *
 * 每日凌晨 server 端 scheduled task 會清掉前一天的 reserved（已用 date 隔離）
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { getDb } from '../../firebase';
import type { StockLevel, StockReservationResult } from './types';

const STOCK_LOCAL_KEY = '@ordering_stock_levels';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function stockDocId(vendorId: string, menuItemId: string, date: string): string {
  return `${vendorId}__${menuItemId}__${date}`;
}

function defaultStock(
  vendorId: string,
  menuItemId: string,
  dailyCap: number | null = null,
): StockLevel {
  return {
    vendorId,
    menuItemId,
    dailyCap,
    reservedQty: 0,
    soldQty: 0,
    date: todayKey(),
    manualSoldOut: false,
  };
}

async function readLocalStock(): Promise<Record<string, StockLevel>> {
  try {
    const raw = await AsyncStorage.getItem(STOCK_LOCAL_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeLocalStock(map: Record<string, StockLevel>): Promise<void> {
  await AsyncStorage.setItem(STOCK_LOCAL_KEY, JSON.stringify(map));
}

function tryFirestore(): boolean {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}

/** 讀取單一品項當日庫存 */
export async function getStock(
  schoolId: string,
  vendorId: string,
  menuItemId: string,
): Promise<StockLevel> {
  const date = todayKey();
  const id = stockDocId(vendorId, menuItemId, date);

  if (tryFirestore()) {
    try {
      const db = getDb();
      const ref = doc(db, 'schools', schoolId, 'stock', id);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        return snap.data() as StockLevel;
      }
    } catch {
      // fall through to local
    }
  }

  const local = await readLocalStock();
  return local[id] ?? defaultStock(vendorId, menuItemId);
}

/** 店家設定當日庫存上限 */
export async function setDailyCap(
  schoolId: string,
  vendorId: string,
  menuItemId: string,
  cap: number | null,
): Promise<void> {
  const date = todayKey();
  const id = stockDocId(vendorId, menuItemId, date);

  if (tryFirestore()) {
    try {
      const db = getDb();
      const ref = doc(db, 'schools', schoolId, 'stock', id);
      await setDoc(
        ref,
        {
          ...defaultStock(vendorId, menuItemId, cap),
          dailyCap: cap,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      return;
    } catch {
      // fall through
    }
  }

  const local = await readLocalStock();
  const existing = local[id] ?? defaultStock(vendorId, menuItemId, cap);
  local[id] = { ...existing, dailyCap: cap };
  await writeLocalStock(local);
}

/** 店家手動切換售罄 */
export async function setManualSoldOut(
  schoolId: string,
  vendorId: string,
  menuItemId: string,
  soldOut: boolean,
): Promise<void> {
  const date = todayKey();
  const id = stockDocId(vendorId, menuItemId, date);

  if (tryFirestore()) {
    try {
      const db = getDb();
      const ref = doc(db, 'schools', schoolId, 'stock', id);
      await setDoc(
        ref,
        {
          ...defaultStock(vendorId, menuItemId),
          manualSoldOut: soldOut,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      return;
    } catch {
      // fall through
    }
  }

  const local = await readLocalStock();
  const existing = local[id] ?? defaultStock(vendorId, menuItemId);
  local[id] = { ...existing, manualSoldOut: soldOut };
  await writeLocalStock(local);
}

/**
 * 預扣庫存（atomic）
 *
 * @returns 成功時 reservationId 為 doc id；失敗回 reason
 */
export async function reserveStock(
  schoolId: string,
  vendorId: string,
  menuItemId: string,
  qty: number,
): Promise<StockReservationResult> {
  if (qty <= 0) {
    return { ok: false, reservationId: null, reason: 'not_found' };
  }

  const date = todayKey();
  const id = stockDocId(vendorId, menuItemId, date);

  if (tryFirestore()) {
    try {
      const db = getDb();
      const ref = doc(db, 'schools', schoolId, 'stock', id);
      const result = await runTransaction<StockReservationResult>(
        db,
        async (tx) => {
          const snap = await tx.get(ref);
          const current: StockLevel = snap.exists()
            ? (snap.data() as StockLevel)
            : defaultStock(vendorId, menuItemId);

          if (current.manualSoldOut) {
            return { ok: false, reservationId: null, reason: 'manual_sold_out' };
          }
          if (current.dailyCap != null) {
            const used = current.reservedQty + current.soldQty;
            const remaining = current.dailyCap - used;
            if (remaining < qty) {
              return {
                ok: false,
                reservationId: null,
                reason: 'sold_out',
                remaining: Math.max(0, remaining),
              };
            }
          }

          tx.set(
            ref,
            {
              ...current,
              reservedQty: current.reservedQty + qty,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );

          return { ok: true, reservationId: id };
        },
      );
      return result;
    } catch (err) {
      console.warn('[stock] firestore reserve failed, fallback local:', err);
    }
  }

  // 本機降級（無真正 atomic 保證，僅 demo）
  const local = await readLocalStock();
  const current = local[id] ?? defaultStock(vendorId, menuItemId);
  if (current.manualSoldOut) {
    return { ok: false, reservationId: null, reason: 'manual_sold_out' };
  }
  if (current.dailyCap != null) {
    const remaining = current.dailyCap - current.reservedQty - current.soldQty;
    if (remaining < qty) {
      return { ok: false, reservationId: null, reason: 'sold_out', remaining };
    }
  }
  current.reservedQty += qty;
  local[id] = current;
  await writeLocalStock(local);
  return { ok: true, reservationId: id };
}

/** 釋放預扣（取消訂單時） */
export async function releaseStock(
  schoolId: string,
  vendorId: string,
  menuItemId: string,
  qty: number,
): Promise<void> {
  const id = stockDocId(vendorId, menuItemId, todayKey());

  if (tryFirestore()) {
    try {
      const db = getDb();
      const ref = doc(db, 'schools', schoolId, 'stock', id);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const current = snap.data() as StockLevel;
        tx.update(ref, {
          reservedQty: Math.max(0, current.reservedQty - qty),
          updatedAt: serverTimestamp(),
        });
      });
      return;
    } catch {
      // fall through
    }
  }

  const local = await readLocalStock();
  const current = local[id];
  if (!current) return;
  current.reservedQty = Math.max(0, current.reservedQty - qty);
  local[id] = current;
  await writeLocalStock(local);
}

/** 確認銷售（取餐完成）：從 reserved 轉到 sold */
export async function commitSale(
  schoolId: string,
  vendorId: string,
  menuItemId: string,
  qty: number,
): Promise<void> {
  const id = stockDocId(vendorId, menuItemId, todayKey());

  if (tryFirestore()) {
    try {
      const db = getDb();
      const ref = doc(db, 'schools', schoolId, 'stock', id);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const current = snap.data() as StockLevel;
        tx.update(ref, {
          reservedQty: Math.max(0, current.reservedQty - qty),
          soldQty: current.soldQty + qty,
          updatedAt: serverTimestamp(),
        });
      });
      return;
    } catch {
      // fall through
    }
  }

  const local = await readLocalStock();
  const current = local[id];
  if (!current) return;
  current.reservedQty = Math.max(0, current.reservedQty - qty);
  current.soldQty += qty;
  local[id] = current;
  await writeLocalStock(local);
}
