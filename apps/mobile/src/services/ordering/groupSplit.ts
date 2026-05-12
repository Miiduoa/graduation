/**
 * 揪團合單拆帳
 *
 * 三種拆帳模式：
 *   - each_pays_own: 各付各的（最自然 — 每人對自己 items hold）
 *   - creator_pays:  發起人全付（適合請客）
 *   - equal_split:   平均分攤
 *
 * 流程：
 *   1. 從 GroupOrder.members 取得每人項目
 *   2. 依模式算出每人應付金額
 *   3. 對每人並行 holdWallet（其中一人失敗 → 回滾所有已成功的）
 *   4. 全員成功 → 建立合單 Order，記錄 splitPayments
 *   5. 取餐時對所有 hold 同時 capture
 *   6. 取消時對所有 hold 同時 release
 */

import { holdWallet, releaseWalletHold, captureWallet } from './wallet';
import type {
  GroupSplitMode,
  GroupSplitPayment,
  GroupSplitResult,
} from './types';
import type { GroupOrder } from '../cafeteriaData';

export type SplitInput = {
  groupOrder: GroupOrder;
  schoolId: string;
  mode: GroupSplitMode;
  /** 發起人實際付款金額（creator_pays / equal_split 時用） */
  creatorPaysFor?: { uid: string };
};

/** 計算每人應付金額 */
export function computeMemberShares(input: SplitInput): Array<{ uid: string; name: string; amount: number }> {
  const { groupOrder, mode } = input;
  const members = groupOrder.members;
  if (members.length === 0) return [];

  switch (mode) {
    case 'each_pays_own':
      return members.map((m) => ({ uid: m.uid, name: m.name, amount: m.subtotal }));
    case 'creator_pays': {
      const total = members.reduce((sum, m) => sum + m.subtotal, 0);
      return members.map((m) => ({
        uid: m.uid,
        name: m.name,
        amount: m.uid === groupOrder.creatorUid ? total : 0,
      }));
    }
    case 'equal_split': {
      const total = members.reduce((sum, m) => sum + m.subtotal, 0);
      const perPerson = Math.ceil(total / members.length);
      return members.map((m) => ({ uid: m.uid, name: m.name, amount: perPerson }));
    }
    default:
      return [];
  }
}

/**
 * 對整個揪團 hold 全部成員的金額
 *
 * 若任一人失敗，會自動 release 已成功的所有人 hold。
 */
export async function holdGroupPayments(
  input: SplitInput,
  combinedOrderId: string,
): Promise<GroupSplitResult> {
  const shares = computeMemberShares(input);
  const successful: Array<GroupSplitPayment & { _amount: number }> = [];
  const failed: Array<{ uid: string; reason: string }> = [];

  for (const share of shares) {
    if (share.amount <= 0) {
      // 不需付款者直接記錄
      successful.push({
        groupOrderId: input.groupOrder.id,
        memberUid: share.uid,
        memberName: share.name,
        amount: 0,
        walletHoldId: null,
        status: 'held',
        capturedAt: null,
        _amount: 0,
      });
      continue;
    }
    const result = await holdWallet({
      uid: share.uid,
      schoolId: input.schoolId,
      orderId: `${combinedOrderId}::${share.uid}`,
      amount: share.amount,
      paymentMethod: 'group_split',
    });
    if (result.ok && result.holdId) {
      successful.push({
        groupOrderId: input.groupOrder.id,
        memberUid: share.uid,
        memberName: share.name,
        amount: share.amount,
        walletHoldId: result.holdId,
        status: 'held',
        capturedAt: null,
        _amount: share.amount,
      });
    } else {
      failed.push({ uid: share.uid, reason: result.reason ?? 'unknown' });
      break; // 任一失敗即停止
    }
  }

  // 任一失敗：回滾所有成功的
  if (failed.length > 0) {
    for (const s of successful) {
      if (s.walletHoldId) {
        await releaseWalletHold({
          uid: s.memberUid,
          schoolId: input.schoolId,
          holdId: s.walletHoldId,
        });
      }
    }
    return {
      ok: false,
      mode: input.mode,
      combinedOrderId: null,
      payments: [],
      failedMembers: failed,
    };
  }

  const payments: GroupSplitPayment[] = successful.map((s) => ({
    groupOrderId: s.groupOrderId,
    memberUid: s.memberUid,
    memberName: s.memberName,
    amount: s.amount,
    walletHoldId: s.walletHoldId,
    status: s.status,
    capturedAt: s.capturedAt,
  }));

  return {
    ok: true,
    mode: input.mode,
    combinedOrderId,
    payments,
    failedMembers: [],
  };
}

/** 取餐時：對所有 hold 同時 capture */
export async function captureGroupPayments(
  schoolId: string,
  payments: GroupSplitPayment[],
): Promise<{ ok: boolean; failed: GroupSplitPayment[] }> {
  const failed: GroupSplitPayment[] = [];
  for (const p of payments) {
    if (!p.walletHoldId || p.amount <= 0) continue;
    const result = await captureWallet({
      uid: p.memberUid,
      schoolId,
      holdId: p.walletHoldId,
    });
    if (!result.ok) failed.push(p);
  }
  return { ok: failed.length === 0, failed };
}

/** 取消時：對所有 hold 同時 release */
export async function releaseGroupPayments(
  schoolId: string,
  payments: GroupSplitPayment[],
): Promise<{ ok: boolean; failed: GroupSplitPayment[] }> {
  const failed: GroupSplitPayment[] = [];
  for (const p of payments) {
    if (!p.walletHoldId || p.amount <= 0) continue;
    const result = await releaseWalletHold({
      uid: p.memberUid,
      schoolId,
      holdId: p.walletHoldId,
    });
    if (!result.ok) failed.push(p);
  }
  return { ok: failed.length === 0, failed };
}
