/**
 * Wallet hold-capture — 模擬信用卡 pre-auth 行為
 *
 * 真實世界流程：
 *   - 下單時：hold (凍結金額，未實扣)
 *   - 取餐時：capture (從凍結轉為實扣)
 *   - 取消時：release (退回 available)
 *   - 拒單時：release
 *
 * 為什麼這樣設計？
 *   - 校園卡 / 第三方支付都該如此，避免「店家沒接單但學生錢已扣」
 *   - 簡化退款流程：90% 的取消發生在 hold 階段，release 即可，無需走真退款
 *
 * 雲端：呼叫 Cloud Function `walletHold` / `walletCapture` / `walletRelease`
 * 本機：fallback，AsyncStorage 模擬 available/pending balance
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { httpsCallable } from 'firebase/functions';
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { getDb, getFunctionsInstance, getAuthInstance } from '../../firebase';
import type {
  WalletHold,
  WalletHoldStatus,
  WalletOperationResult,
} from './types';

const WALLET_LOCAL_KEY = '@ordering_wallet';
const HOLDS_LOCAL_KEY = '@ordering_wallet_holds';

type LocalWallet = {
  uid: string;
  available: number;
  pending: number;
  currency: string;
  updatedAt: string;
};

function tryFirebase(): boolean {
  try {
    getDb();
    getAuthInstance();
    return true;
  } catch {
    return false;
  }
}

async function readLocalWallet(uid: string): Promise<LocalWallet> {
  const raw = await AsyncStorage.getItem(`${WALLET_LOCAL_KEY}_${uid}`);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      // ignore
    }
  }
  // 預設給 demo 帳戶 1000 元，方便測試
  return {
    uid,
    available: 1000,
    pending: 0,
    currency: 'TWD',
    updatedAt: new Date().toISOString(),
  };
}

async function writeLocalWallet(w: LocalWallet): Promise<void> {
  await AsyncStorage.setItem(`${WALLET_LOCAL_KEY}_${w.uid}`, JSON.stringify(w));
}

async function readLocalHolds(): Promise<Record<string, WalletHold>> {
  try {
    const raw = await AsyncStorage.getItem(HOLDS_LOCAL_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeLocalHolds(map: Record<string, WalletHold>): Promise<void> {
  await AsyncStorage.setItem(HOLDS_LOCAL_KEY, JSON.stringify(map));
}

/** 取得目前 wallet 餘額（available + pending） */
export async function getWalletSummary(
  uid: string,
  schoolId?: string,
): Promise<{ available: number; pending: number; currency: string }> {
  if (tryFirebase() && schoolId) {
    try {
      const db = getDb();
      const ref = doc(db, 'users', uid, 'schools', schoolId, 'wallet', 'balance');
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        return {
          available: Number(data.available ?? 0),
          pending: Number(data.pending ?? 0),
          currency: String(data.currency ?? 'TWD'),
        };
      }
    } catch {
      // fall through
    }
  }
  const local = await readLocalWallet(uid);
  return {
    available: local.available,
    pending: local.pending,
    currency: local.currency,
  };
}

/**
 * 凍結金額（hold）— 下單時呼叫
 *
 * 雲端走 Cloud Function `walletHold`，client 端做樂觀 UI。
 */
export async function holdWallet(args: {
  uid: string;
  schoolId: string;
  orderId: string;
  amount: number;
  paymentMethod: WalletHold['paymentMethod'];
}): Promise<WalletOperationResult & { hold?: WalletHold }> {
  if (args.amount <= 0) {
    return { ok: false, reason: 'unknown' };
  }

  // 嘗試 Cloud Function
  if (tryFirebase() && getAuthInstance().currentUser) {
    try {
      const fn = httpsCallable<
        Record<string, unknown>,
        { ok?: boolean; holdId?: string; reason?: string }
      >(getFunctionsInstance(), 'walletHold');
      const result = await fn({
        schoolId: args.schoolId,
        orderId: args.orderId,
        amount: args.amount,
        paymentMethod: args.paymentMethod,
      });
      if (result.data?.ok && result.data?.holdId) {
        const hold: WalletHold = {
          id: result.data.holdId,
          uid: args.uid,
          orderId: args.orderId,
          amount: args.amount,
          currency: 'TWD',
          status: 'held',
          paymentMethod: args.paymentMethod,
          gatewayAuthCode: null,
          createdAt: new Date().toISOString(),
          capturedAt: null,
          releasedAt: null,
          failReason: null,
        };
        const local = await readLocalHolds();
        local[hold.id] = hold;
        await writeLocalHolds(local);
        return { ok: true, holdId: hold.id, hold };
      }
      const reason = (result.data?.reason ?? 'unknown') as WalletOperationResult['reason'];
      return { ok: false, reason };
    } catch (err) {
      console.warn('[wallet] cloud hold failed, fallback local:', err);
    }
  }

  // 本機 fallback：直接從 available 扣到 pending
  const wallet = await readLocalWallet(args.uid);
  if (wallet.available < args.amount) {
    return { ok: false, reason: 'insufficient_balance' };
  }
  wallet.available -= args.amount;
  wallet.pending += args.amount;
  wallet.updatedAt = new Date().toISOString();
  await writeLocalWallet(wallet);

  const hold: WalletHold = {
    id: `hold-${args.orderId}`,
    uid: args.uid,
    orderId: args.orderId,
    amount: args.amount,
    currency: 'TWD',
    status: 'held',
    paymentMethod: args.paymentMethod,
    gatewayAuthCode: null,
    createdAt: new Date().toISOString(),
    capturedAt: null,
    releasedAt: null,
    failReason: null,
  };
  const localHolds = await readLocalHolds();
  localHolds[hold.id] = hold;
  await writeLocalHolds(localHolds);
  return { ok: true, holdId: hold.id, hold };
}

/** 確認扣款（capture）— 取餐完成時呼叫 */
export async function captureWallet(args: {
  uid: string;
  schoolId: string;
  holdId: string;
}): Promise<WalletOperationResult> {
  if (tryFirebase() && getAuthInstance().currentUser) {
    try {
      const fn = httpsCallable<
        { schoolId: string; holdId: string },
        { ok?: boolean; reason?: string }
      >(getFunctionsInstance(), 'walletCapture');
      const result = await fn({ schoolId: args.schoolId, holdId: args.holdId });
      if (result.data?.ok) {
        await markLocalHoldStatus(args.holdId, 'captured');
        return { ok: true, holdId: args.holdId };
      }
      return {
        ok: false,
        reason: (result.data?.reason ?? 'unknown') as WalletOperationResult['reason'],
      };
    } catch (err) {
      console.warn('[wallet] cloud capture failed, fallback local:', err);
    }
  }

  // 本機 fallback
  const holds = await readLocalHolds();
  const hold = holds[args.holdId];
  if (!hold) return { ok: false, reason: 'wallet_not_found' };
  if (hold.status === 'captured') return { ok: false, reason: 'already_captured' };
  if (hold.status !== 'held') return { ok: false, reason: 'unknown' };

  const wallet = await readLocalWallet(args.uid);
  wallet.pending = Math.max(0, wallet.pending - hold.amount);
  wallet.updatedAt = new Date().toISOString();
  await writeLocalWallet(wallet);

  hold.status = 'captured';
  hold.capturedAt = new Date().toISOString();
  holds[args.holdId] = hold;
  await writeLocalHolds(holds);
  return { ok: true, holdId: args.holdId };
}

/** 釋放凍結（release）— 取消訂單時呼叫 */
export async function releaseWalletHold(args: {
  uid: string;
  schoolId: string;
  holdId: string;
}): Promise<WalletOperationResult> {
  if (tryFirebase() && getAuthInstance().currentUser) {
    try {
      const fn = httpsCallable<
        { schoolId: string; holdId: string },
        { ok?: boolean; reason?: string }
      >(getFunctionsInstance(), 'walletRelease');
      const result = await fn({ schoolId: args.schoolId, holdId: args.holdId });
      if (result.data?.ok) {
        await markLocalHoldStatus(args.holdId, 'released');
        // 本機餘額也回補（樂觀更新）
        const holds = await readLocalHolds();
        const hold = holds[args.holdId];
        if (hold && hold.status !== 'released') {
          const wallet = await readLocalWallet(args.uid);
          wallet.available += hold.amount;
          wallet.pending = Math.max(0, wallet.pending - hold.amount);
          wallet.updatedAt = new Date().toISOString();
          await writeLocalWallet(wallet);
        }
        return { ok: true, holdId: args.holdId };
      }
      return {
        ok: false,
        reason: (result.data?.reason ?? 'unknown') as WalletOperationResult['reason'],
      };
    } catch (err) {
      console.warn('[wallet] cloud release failed, fallback local:', err);
    }
  }

  const holds = await readLocalHolds();
  const hold = holds[args.holdId];
  if (!hold) return { ok: false, reason: 'wallet_not_found' };
  if (hold.status === 'released') return { ok: false, reason: 'already_released' };
  if (hold.status === 'captured') return { ok: false, reason: 'already_captured' };

  const wallet = await readLocalWallet(args.uid);
  wallet.available += hold.amount;
  wallet.pending = Math.max(0, wallet.pending - hold.amount);
  wallet.updatedAt = new Date().toISOString();
  await writeLocalWallet(wallet);

  hold.status = 'released';
  hold.releasedAt = new Date().toISOString();
  holds[args.holdId] = hold;
  await writeLocalHolds(holds);
  return { ok: true, holdId: args.holdId };
}

async function markLocalHoldStatus(
  holdId: string,
  status: WalletHoldStatus,
): Promise<void> {
  const holds = await readLocalHolds();
  if (holds[holdId]) {
    holds[holdId].status = status;
    if (status === 'captured') holds[holdId].capturedAt = new Date().toISOString();
    if (status === 'released') holds[holdId].releasedAt = new Date().toISOString();
    await writeLocalHolds(holds);
  }
}

/** 取得某筆 hold 紀錄（debug / UI 顯示用） */
export async function getHoldById(holdId: string): Promise<WalletHold | null> {
  const holds = await readLocalHolds();
  return holds[holdId] ?? null;
}

/** 開發用：給 demo 帳戶儲值 */
export async function topupLocalWallet(uid: string, amount: number): Promise<LocalWallet> {
  const wallet = await readLocalWallet(uid);
  wallet.available += amount;
  wallet.updatedAt = new Date().toISOString();
  await writeLocalWallet(wallet);
  return wallet;
}
