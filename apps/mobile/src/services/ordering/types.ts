/**
 * 訂餐強化模組 — 統一型別定義
 *
 * 這檔案集中所有「真實餐廳訂餐」流程在原 cafeteriaData.ts 之外新增的型別：
 *   - StockLevel（庫存）
 *   - PickupCode（取餐碼）
 *   - WalletHold（餘額預扣）
 *   - Refund（退款單）
 *   - CancelReasonCode（取消原因列舉）
 *   - AllergenCheckResult（過敏原比對結果）
 *   - GroupOrderSplitPayment（揪團拆帳）
 *   - InspectionEnforcement（稽查連動）
 *   - OrderTimeoutPolicy（訂單超時規則）
 *   - DailyQueueCounter（號碼牌計數器）
 */

import type { CafeteriaId, OrderStatus, OrderItem } from '../cafeteriaData';

// ────────────────────────────────────────────────
// 庫存
// ────────────────────────────────────────────────

/** 單一品項的當日庫存 */
export type StockLevel = {
  vendorId: string;
  menuItemId: string;
  /** 當日上限（凌晨重置） */
  dailyCap: number | null;
  /** 已預扣（下單但未取餐） */
  reservedQty: number;
  /** 已銷出（取餐完成） */
  soldQty: number;
  /** ISO 日期 (YYYY-MM-DD)，用於跨日重置 */
  date: string;
  /** 由店家鎖定為「賣完」（null = 自動依 cap 判斷） */
  manualSoldOut: boolean;
};

/** 庫存預扣的結果 */
export type StockReservationResult = {
  ok: boolean;
  reservationId: string | null;
  reason?: 'sold_out' | 'manual_sold_out' | 'vendor_closed' | 'not_found' | 'over_cap';
  remaining?: number;
};

// ────────────────────────────────────────────────
// 號碼牌計數器（每店每日唯一遞增）
// ────────────────────────────────────────────────

export type DailyQueueCounter = {
  vendorId: string;
  date: string; // YYYY-MM-DD
  nextSerial: number;
  updatedAt: string;
};

// ────────────────────────────────────────────────
// 取餐碼
// ────────────────────────────────────────────────

export type PickupCodeStatus = 'active' | 'consumed' | 'expired' | 'revoked';

export type PickupCode = {
  id: string;
  orderId: string;
  vendorId: string;
  studentUid: string;
  /** 6 位短碼，店家肉眼讀 */
  shortCode: string;
  /** 不可逆 hash（雲端核銷使用），客戶端不存明碼 */
  hash: string;
  /** 一次性 nonce，防重放 */
  nonce: string;
  status: PickupCodeStatus;
  issuedAt: string;
  /** 有效期限（通常 = ready + 30 分鐘） */
  expiresAt: string;
  consumedAt: string | null;
  consumedByOperator: string | null;
};

export type PickupVerifyResult = {
  ok: boolean;
  orderId?: string;
  reason?:
    | 'not_found'
    | 'expired'
    | 'already_consumed'
    | 'wrong_vendor'
    | 'order_not_ready'
    | 'revoked';
};

// ────────────────────────────────────────────────
// 錢包 hold-capture
// ────────────────────────────────────────────────

export type WalletHoldStatus = 'held' | 'captured' | 'released' | 'failed';

export type WalletHold = {
  id: string;
  uid: string;
  orderId: string;
  /** 凍結的金額 */
  amount: number;
  currency: string; // 'TWD'
  status: WalletHoldStatus;
  paymentMethod: 'campus_card' | 'mobile_pay' | 'credit_card' | 'group_split';
  /** Stripe / 校園卡的閘道授權碼 */
  gatewayAuthCode: string | null;
  createdAt: string;
  capturedAt: string | null;
  releasedAt: string | null;
  failReason: string | null;
};

export type WalletOperationResult = {
  ok: boolean;
  holdId?: string;
  reason?:
    | 'insufficient_balance'
    | 'card_declined'
    | 'wallet_not_found'
    | 'already_captured'
    | 'already_released'
    | 'unknown';
};

// ────────────────────────────────────────────────
// 取消 / 拒單原因列舉
// ────────────────────────────────────────────────

/** 學生方取消 */
export type StudentCancelReason =
  | 'student_changed_mind' // 不想吃了
  | 'student_wait_too_long' // 太久了
  | 'student_wrong_order' // 點錯
  | 'student_emergency' // 臨時有事
  | 'student_other';

/** 店家方拒接/取消 */
export type VendorCancelReason =
  | 'vendor_sold_out' // 食材用完
  | 'vendor_equipment_failure' // 設備故障
  | 'vendor_closing_soon' // 即將打烊
  | 'vendor_unable_to_fulfill' // 無法滿足客製化
  | 'vendor_other';

/** 系統/管理員 */
export type SystemCancelReason =
  | 'system_timeout' // 製作超時
  | 'system_no_show' // 學生未取餐
  | 'system_payment_failed' // 付款失敗
  | 'admin_vendor_suspended' // 稽查不合格 / 店家被停權
  | 'admin_force_refund'; // 客訴強制退款

export type CancelReasonCode =
  | StudentCancelReason
  | VendorCancelReason
  | SystemCancelReason;

export type CancelReasonInfo = {
  code: CancelReasonCode;
  label: string;
  initiator: 'student' | 'vendor' | 'system' | 'admin';
  /** 是否觸發自動退款 */
  triggersRefund: boolean;
};

// ────────────────────────────────────────────────
// 退款
// ────────────────────────────────────────────────

export type RefundStatus =
  | 'requested' // 已提出
  | 'approved' // 已核准（自動或人工）
  | 'processing' // 退款閘道處理中
  | 'completed' // 退款入帳
  | 'rejected' // 拒絕
  | 'failed'; // 閘道失敗

export type Refund = {
  id: string;
  orderId: string;
  studentUid: string;
  schoolId: string;
  vendorId: string;
  amount: number;
  currency: string;
  reasonCode: CancelReasonCode;
  reasonText: string;
  /** 退到哪裡（必須與付款方式對齊） */
  destination: 'campus_card' | 'mobile_pay' | 'credit_card' | 'group_split';
  status: RefundStatus;
  /** 由誰提出（student / vendor / admin / system） */
  initiator: 'student' | 'vendor' | 'system' | 'admin';
  /** 對應的 WalletHold（若是 hold 期間取消） */
  walletHoldId: string | null;
  /** 對應的 Transaction（若是已 capture 後退款） */
  transactionId: string | null;
  gatewayRefundId: string | null;
  requestedAt: string;
  processedAt: string | null;
  completedAt: string | null;
  /** 月預算回補金額（學生角色才有） */
  budgetRefunded: number | null;
};

// ────────────────────────────────────────────────
// 過敏原比對
// ────────────────────────────────────────────────

export type AllergenMatch = {
  menuItemId: string;
  menuItemName: string;
  hits: string[]; // 命中的過敏原（如 ['花生', '麩質']）
};

export type AllergenSeverity = 'none' | 'warn' | 'block';

export type AllergenCheckResult = {
  severity: AllergenSeverity;
  matches: AllergenMatch[];
  /** 給 UI 顯示的友善訊息 */
  message: string;
  /** 若 severity='block'，使用者確認後仍要下單，需明確同意此 token */
  overrideToken?: string;
};

/** 學生個人偏好（過敏原 + 飲食禁忌） */
export type DietaryProfile = {
  uid: string;
  allergens: string[]; // 嚴格禁忌（會 block）
  dislikes: string[]; // 不喜歡（warn）
  vegetarian: boolean;
  vegan: boolean;
  halal: boolean;
  updatedAt: string;
};

// ────────────────────────────────────────────────
// 揪團拆帳
// ────────────────────────────────────────────────

export type GroupSplitMode =
  | 'each_pays_own' // 各付各的（每人獨立扣自己錢包）
  | 'creator_pays' // 發起人全付
  | 'equal_split'; // 平均分攤

export type GroupSplitPayment = {
  groupOrderId: string;
  memberUid: string;
  memberName: string;
  amount: number;
  walletHoldId: string | null;
  status: WalletHoldStatus;
  capturedAt: string | null;
};

export type GroupSplitResult = {
  ok: boolean;
  mode: GroupSplitMode;
  combinedOrderId: string | null;
  payments: GroupSplitPayment[];
  failedMembers: Array<{ uid: string; reason: string }>;
};

// ────────────────────────────────────────────────
// 稽查連動
// ────────────────────────────────────────────────

export type InspectionEnforcementAction =
  | 'no_action' // 通過或輕微不合格
  | 'warning' // 警告
  | 'suspend_ordering' // 暫停接單
  | 'force_close' // 強制下架
  | 'recall_pending_orders'; // 召回已下未取訂單（退款）

export type InspectionEnforcement = {
  inspectionId: string;
  vendorId: string;
  triggeredAt: string;
  action: InspectionEnforcementAction;
  reason: string;
  /** 自動觸發退款的訂單列表 */
  affectedOrderIds: string[];
  /** 預計解禁時間（null = 待人工解禁） */
  resumeAt: string | null;
};

// ────────────────────────────────────────────────
// 訂單超時規則
// ────────────────────────────────────────────────

export type OrderTimeoutKind =
  | 'pending_too_long' // 店家未接單
  | 'preparing_too_long' // 製作超時
  | 'ready_no_show'; // 可取餐但學生未取

export type OrderTimeoutPolicy = {
  kind: OrderTimeoutKind;
  thresholdMinutes: number;
  action: 'notify' | 'auto_cancel' | 'mark_no_show';
};

export const DEFAULT_TIMEOUT_POLICIES: OrderTimeoutPolicy[] = [
  { kind: 'pending_too_long', thresholdMinutes: 10, action: 'auto_cancel' },
  { kind: 'preparing_too_long', thresholdMinutes: 30, action: 'notify' },
  { kind: 'ready_no_show', thresholdMinutes: 20, action: 'mark_no_show' },
];

// ────────────────────────────────────────────────
// 原子下單參數（給 atomicOrder.ts 使用）
// ────────────────────────────────────────────────

export type AtomicOrderRequest = {
  studentUid: string;
  schoolId: string;
  cafeteriaId: CafeteriaId;
  vendorId: string;
  items: OrderItem[];
  totalPrice: number;
  note: string;
  paymentMethod: 'campus_card' | 'mobile_pay' | 'credit_card';
  /** 過敏原 override（若 user 明確選擇繼續下單） */
  allergenOverrideToken?: string;
  /** AI 代下單時必填，且需 user 確認 */
  source?: 'student' | 'ai_agent';
  /** 揪團場景使用 */
  groupOrderId?: string;
  /** 取餐方式 */
  pickupType?: 'self_pickup' | 'dine_in';
};

export type AtomicOrderResponse = {
  ok: boolean;
  orderId: string | null;
  queueNumber: number | null;
  pickupCode: PickupCode | null;
  walletHoldId: string | null;
  /** 預估完成時間（分鐘） */
  estimatedMinutes: number;
  /** 失敗時的原因 */
  failure?: {
    stage:
      | 'allergen_check'
      | 'stock_reserve'
      | 'wallet_hold'
      | 'queue_assign'
      | 'order_persist'
      | 'precondition'
      | 'unknown';
    code: string;
    message: string;
    /** 是否有部分回滾失敗（需 admin 介入） */
    needsManualReconciliation?: boolean;
  };
};

/** 取消訂單時，協調退款 / 庫存回補 / 預算回補的綜合結果 */
export type CancelOrderResult = {
  ok: boolean;
  orderId: string;
  newStatus: OrderStatus;
  refund: Refund | null;
  stockReleased: boolean;
  budgetRefunded: number | null;
  reason: CancelReasonInfo;
};
