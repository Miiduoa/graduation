/**
 * 訂單超時處理 — Client-side fallback
 *
 * 主要邏輯在 Cloud Function scheduled task (scheduledOrderTimeoutSweep)，
 * 但 client 端也提供同樣邏輯：
 *   - 沒登入後端時也能跑（offline demo）
 *   - 給 admin 介面手動觸發
 *
 * 規則（與 types.DEFAULT_TIMEOUT_POLICIES 對齊）：
 *   - pending 超過 10 分鐘 → 自動取消 + 退款
 *   - preparing 超過 30 分鐘 → 通知學生 + 警示店家（不自動取消）
 *   - ready 超過 20 分鐘 → 標記 system_no_show（不自動退款）
 */

import { DEFAULT_TIMEOUT_POLICIES } from './types';
import type { OrderTimeoutPolicy } from './types';
import { getOrders, type Order } from '../cafeteriaData';
import { cancelOrderAtomic } from './atomicOrder';

export type SweepResult = {
  totalScanned: number;
  pendingAutoCancelled: string[];
  preparingNotified: string[];
  readyMarkedNoShow: string[];
  errors: Array<{ orderId: string; reason: string }>;
};

function ageMinutes(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return (Date.now() - t) / 60_000;
}

/**
 * 掃描所有「進行中」的訂單，按 policy 處理超時
 *
 * @param schoolId 學校 id
 * @param policies 可自訂 policy（預設用 DEFAULT_TIMEOUT_POLICIES）
 */
export async function sweepOrderTimeouts(
  schoolId: string,
  policies: OrderTimeoutPolicy[] = DEFAULT_TIMEOUT_POLICIES,
): Promise<SweepResult> {
  const result: SweepResult = {
    totalScanned: 0,
    pendingAutoCancelled: [],
    preparingNotified: [],
    readyMarkedNoShow: [],
    errors: [],
  };

  const pendingPolicy = policies.find((p) => p.kind === 'pending_too_long');
  const preparingPolicy = policies.find((p) => p.kind === 'preparing_too_long');
  const readyPolicy = policies.find((p) => p.kind === 'ready_no_show');

  const orders = await getOrders();
  result.totalScanned = orders.length;

  for (const order of orders) {
    try {
      // pending → 超時自動取消
      if (
        order.status === 'pending' &&
        pendingPolicy &&
        ageMinutes(order.createdAt) > pendingPolicy.thresholdMinutes
      ) {
        if (pendingPolicy.action === 'auto_cancel') {
          await cancelOrderAtomic({
            order,
            schoolId,
            reasonCode: 'system_timeout',
            initiator: 'system',
          });
          result.pendingAutoCancelled.push(order.id);
        }
        continue;
      }

      // preparing → 通知（不自動取消）
      if (
        order.status === 'preparing' &&
        preparingPolicy &&
        ageMinutes(order.createdAt) > preparingPolicy.thresholdMinutes
      ) {
        if (preparingPolicy.action === 'notify') {
          // 雲端會用 sendPushToUser；客戶端只記錄即可
          result.preparingNotified.push(order.id);
        }
        continue;
      }

      // ready → 超時 NoShow
      if (
        order.status === 'ready' &&
        readyPolicy &&
        order.completedAt &&
        ageMinutes(order.completedAt) > readyPolicy.thresholdMinutes
      ) {
        if (readyPolicy.action === 'mark_no_show') {
          await cancelOrderAtomic({
            order,
            schoolId,
            reasonCode: 'system_no_show',
            initiator: 'system',
          });
          result.readyMarkedNoShow.push(order.id);
        }
      }
    } catch (err: any) {
      result.errors.push({
        orderId: order.id,
        reason: err?.message ?? 'unknown',
      });
    }
  }

  return result;
}

/**
 * 號碼牌每日重置（純 client 工具，server 端 scheduled task 為主）
 *
 * 因為號碼牌計數器是按 (vendorId, date) 為鍵，跨日後 atomicOrder 會自動拿到新的計數，
 * client 端不需主動操作 — 此函式只是清掉本機快取避免混淆。
 */
export async function resetLocalDailyCaches(): Promise<void> {
  // 目前沒有需要 client 主動 reset 的快取，因為 stock / queue 都用 date 隔離
  // 預留 hook 給未來擴充
  return;
}
