/**
 * 取消 / 拒單原因列舉化
 *
 * 用途：
 *   - 學生取消：UI 選單
 *   - 店家拒單：UI 選單（必填）
 *   - 系統：自動觸發超時、稽查連動
 *
 * 每個原因綁定：
 *   - label（i18n 友善文字）
 *   - initiator（誰能用）
 *   - triggersRefund（是否自動退款）
 */

import type {
  CancelReasonCode,
  CancelReasonInfo,
  StudentCancelReason,
  VendorCancelReason,
  SystemCancelReason,
} from './types';

export const STUDENT_CANCEL_REASONS: CancelReasonInfo[] = [
  {
    code: 'student_changed_mind',
    label: '我改變主意了',
    initiator: 'student',
    triggersRefund: true,
  },
  {
    code: 'student_wait_too_long',
    label: '等太久了',
    initiator: 'student',
    triggersRefund: true,
  },
  {
    code: 'student_wrong_order',
    label: '我點錯了',
    initiator: 'student',
    triggersRefund: true,
  },
  {
    code: 'student_emergency',
    label: '臨時有事',
    initiator: 'student',
    triggersRefund: true,
  },
  {
    code: 'student_other',
    label: '其他原因',
    initiator: 'student',
    triggersRefund: true,
  },
];

export const VENDOR_CANCEL_REASONS: CancelReasonInfo[] = [
  {
    code: 'vendor_sold_out',
    label: '食材用完',
    initiator: 'vendor',
    triggersRefund: true,
  },
  {
    code: 'vendor_equipment_failure',
    label: '設備故障',
    initiator: 'vendor',
    triggersRefund: true,
  },
  {
    code: 'vendor_closing_soon',
    label: '即將打烊',
    initiator: 'vendor',
    triggersRefund: true,
  },
  {
    code: 'vendor_unable_to_fulfill',
    label: '無法滿足客製化需求',
    initiator: 'vendor',
    triggersRefund: true,
  },
  {
    code: 'vendor_other',
    label: '其他原因',
    initiator: 'vendor',
    triggersRefund: true,
  },
];

export const SYSTEM_CANCEL_REASONS: CancelReasonInfo[] = [
  {
    code: 'system_timeout',
    label: '製作超時自動取消',
    initiator: 'system',
    triggersRefund: true,
  },
  {
    code: 'system_no_show',
    label: '學生未取餐（NoShow）',
    initiator: 'system',
    triggersRefund: false, // NoShow 不退款，由 admin 個案處理
  },
  {
    code: 'system_payment_failed',
    label: '付款失敗',
    initiator: 'system',
    triggersRefund: false, // 沒扣款不退款
  },
  {
    code: 'admin_vendor_suspended',
    label: '店家被停權（衛生稽查）',
    initiator: 'admin',
    triggersRefund: true,
  },
  {
    code: 'admin_force_refund',
    label: '管理員強制退款',
    initiator: 'admin',
    triggersRefund: true,
  },
];

const ALL_REASONS: CancelReasonInfo[] = [
  ...STUDENT_CANCEL_REASONS,
  ...VENDOR_CANCEL_REASONS,
  ...SYSTEM_CANCEL_REASONS,
];

const REASON_MAP = new Map<CancelReasonCode, CancelReasonInfo>(
  ALL_REASONS.map((r) => [r.code, r]),
);

export function getCancelReasonInfo(code: CancelReasonCode): CancelReasonInfo {
  return (
    REASON_MAP.get(code) ?? {
      code: 'student_other',
      label: '其他原因',
      initiator: 'student',
      triggersRefund: true,
    }
  );
}

export function isStudentReason(code: CancelReasonCode): code is StudentCancelReason {
  return STUDENT_CANCEL_REASONS.some((r) => r.code === code);
}

export function isVendorReason(code: CancelReasonCode): code is VendorCancelReason {
  return VENDOR_CANCEL_REASONS.some((r) => r.code === code);
}

export function isSystemReason(code: CancelReasonCode): code is SystemCancelReason {
  return SYSTEM_CANCEL_REASONS.some((r) => r.code === code);
}

/** 給 UI Picker 用：依角色取得可用原因 */
export function getReasonsForRole(
  role: 'student' | 'vendor' | 'admin' | 'system',
): CancelReasonInfo[] {
  switch (role) {
    case 'student':
      return STUDENT_CANCEL_REASONS;
    case 'vendor':
      return VENDOR_CANCEL_REASONS;
    case 'admin':
      return [...SYSTEM_CANCEL_REASONS, ...VENDOR_CANCEL_REASONS];
    case 'system':
    default:
      return SYSTEM_CANCEL_REASONS;
  }
}
