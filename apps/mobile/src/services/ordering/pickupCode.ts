/**
 * 取餐碼 (PickupCode) — 出餐窗口核銷
 *
 * 設計考量：
 *   - 6 位英數短碼，人眼可讀（店家肉眼比對 / 學生唸出來都行）
 *   - 同時生成 SHA256 hash 存雲端，店家輸入短碼 → 後端比對 hash → 一次性核銷
 *   - 加 nonce 防重放
 *   - expiresAt 預設 = ready 後 30 分鐘
 *   - status = 'consumed' 後不可再用
 *
 * 雲端流程：
 *   學生下單 → 後端產生 (shortCode, hash, nonce) → hash 存 schools/{schoolId}/pickupCodes/{orderId}
 *           → shortCode 回給學生（只在學生 app 顯示，不存雲端明碼）
 *   店家核銷 → 輸入 shortCode → 後端比對 hash → 標記 consumed
 *
 * 客戶端 fallback（無雲端時）：
 *   直接本機儲存明碼，店家輸入時本機比對
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { digestStringAsync, CryptoDigestAlgorithm, getRandomBytesAsync } from 'expo-crypto';
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { getDb } from '../../firebase';
import type { PickupCode, PickupVerifyResult } from './types';

const PICKUP_LOCAL_KEY = '@ordering_pickup_codes';
const DEFAULT_EXPIRY_MIN = 30;

function tryFirestore(): boolean {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}

/** 產生 6 位短碼（去除易混淆字元：0/O/1/I/L） */
async function generateShortCode(): Promise<string> {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = await getRandomBytesAsync(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

async function generateNonce(): Promise<string> {
  const bytes = await getRandomBytesAsync(12);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashCode(shortCode: string, nonce: string): Promise<string> {
  return digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    `${shortCode}::${nonce}`,
  );
}

async function readLocalCodes(): Promise<Record<string, PickupCode>> {
  try {
    const raw = await AsyncStorage.getItem(PICKUP_LOCAL_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeLocalCodes(map: Record<string, PickupCode>): Promise<void> {
  await AsyncStorage.setItem(PICKUP_LOCAL_KEY, JSON.stringify(map));
}

/**
 * 為訂單建立取餐碼
 *
 * @returns 完整 PickupCode（shortCode 為明碼，僅在學生 app 顯示，不可傳給其他人）
 */
export async function issuePickupCode(args: {
  orderId: string;
  vendorId: string;
  studentUid: string;
  schoolId: string;
  expiryMinutes?: number;
}): Promise<PickupCode> {
  const shortCode = await generateShortCode();
  const nonce = await generateNonce();
  const hash = await hashCode(shortCode, nonce);

  const expiresAt = new Date(
    Date.now() + (args.expiryMinutes ?? DEFAULT_EXPIRY_MIN) * 60 * 1000,
  ).toISOString();

  const code: PickupCode = {
    id: `pc-${args.orderId}`,
    orderId: args.orderId,
    vendorId: args.vendorId,
    studentUid: args.studentUid,
    shortCode, // 學生本機顯示
    hash, // 雲端比對
    nonce,
    status: 'active',
    issuedAt: new Date().toISOString(),
    expiresAt,
    consumedAt: null,
    consumedByOperator: null,
  };

  // 雲端：只存 hash + nonce（不存 shortCode 明碼）
  if (tryFirestore()) {
    try {
      const db = getDb();
      const ref = doc(db, 'schools', args.schoolId, 'pickupCodes', code.id);
      await setDoc(ref, {
        ...code,
        shortCode: null, // 明碼不上雲
        issuedAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn('[pickupCode] firestore issue failed:', err);
    }
  }

  // 本機：完整存（含明碼，學生 app 要顯示）
  const local = await readLocalCodes();
  local[args.orderId] = code;
  await writeLocalCodes(local);

  return code;
}

/** 學生取得自己訂單的取餐碼（顯示用） */
export async function getMyPickupCode(orderId: string): Promise<PickupCode | null> {
  const local = await readLocalCodes();
  return local[orderId] ?? null;
}

/**
 * 店家核銷取餐碼
 *
 * @param shortCode 學生唸出 / 輸入的 6 位短碼
 * @param expectedOrderId 訂單 ID（店家從訂單卡片點進去時帶入）
 * @param operatorUid 核銷者（店員）
 */
export async function consumePickupCode(args: {
  schoolId: string;
  orderId: string;
  shortCode: string;
  operatorUid: string;
}): Promise<PickupVerifyResult> {
  const cleanCode = args.shortCode.trim().toUpperCase();
  if (!cleanCode || cleanCode.length !== 6) {
    return { ok: false, reason: 'not_found' };
  }

  if (tryFirestore()) {
    try {
      const db = getDb();
      const ref = doc(db, 'schools', args.schoolId, 'pickupCodes', `pc-${args.orderId}`);

      return await runTransaction<PickupVerifyResult>(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return { ok: false, reason: 'not_found' };

        const data = snap.data() as PickupCode;
        if (data.status === 'consumed') return { ok: false, reason: 'already_consumed' };
        if (data.status === 'revoked') return { ok: false, reason: 'revoked' };
        if (new Date(data.expiresAt).getTime() < Date.now()) {
          return { ok: false, reason: 'expired' };
        }

        const expectedHash = await hashCode(cleanCode, data.nonce);
        if (expectedHash !== data.hash) {
          return { ok: false, reason: 'not_found' };
        }

        tx.update(ref, {
          status: 'consumed',
          consumedAt: serverTimestamp(),
          consumedByOperator: args.operatorUid,
        });

        return { ok: true, orderId: data.orderId };
      });
    } catch (err) {
      console.warn('[pickupCode] firestore consume failed, fallback local:', err);
    }
  }

  // 本機降級
  const local = await readLocalCodes();
  const code = local[args.orderId];
  if (!code) return { ok: false, reason: 'not_found' };
  if (code.status === 'consumed') return { ok: false, reason: 'already_consumed' };
  if (code.status === 'revoked') return { ok: false, reason: 'revoked' };
  if (new Date(code.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (code.shortCode !== cleanCode) {
    return { ok: false, reason: 'not_found' };
  }

  code.status = 'consumed';
  code.consumedAt = new Date().toISOString();
  code.consumedByOperator = args.operatorUid;
  local[args.orderId] = code;
  await writeLocalCodes(local);
  return { ok: true, orderId: code.orderId };
}

/** 取消訂單時撤銷取餐碼 */
export async function revokePickupCode(
  schoolId: string,
  orderId: string,
): Promise<void> {
  if (tryFirestore()) {
    try {
      const db = getDb();
      const ref = doc(db, 'schools', schoolId, 'pickupCodes', `pc-${orderId}`);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await setDoc(
          ref,
          { status: 'revoked', updatedAt: serverTimestamp() },
          { merge: true },
        );
      }
    } catch {
      // ignore
    }
  }
  const local = await readLocalCodes();
  if (local[orderId]) {
    local[orderId].status = 'revoked';
    await writeLocalCodes(local);
  }
}
