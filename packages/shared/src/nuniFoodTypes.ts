/** DTOs follow the pinned Nuni food API. amountMinor is whole TWD in this provider. */
export type NuniFoodMoney = { amountMinor: number; currency: 'TWD' };
export type NuniFoodRealm = { tenantId: string; name: string; services: ('food' | 'social')[] };
export type NuniFoodOrderRealm = { tenantId: string; name: string };
export type NuniFoodMerchantMode = 'full' | 'showcase_link' | 'info_only';
export type NuniFoodKitchenStation = 'hot' | 'cold' | 'drinks' | 'combo';
export type NuniFoodPaymentMethod = 'credit-card' | 'mobile-pay';
export type NuniFoodPaymentProgress =
  | 'opening'
  | 'awaiting-payment'
  | 'awaiting-offline-payment'
  | 'authorized-awaiting-settlement'
  | 'paid'
  | 'refunding'
  | 'refunded'
  | 'failed'
  | 'canceled'
  | 'expired';
export type NuniFoodPaymentMethodOption = {
  method: NuniFoodPaymentMethod;
  label: string;
  available: boolean;
  unavailableMessage?: string;
  refundRoute: 'in-app' | 'staff-handled' | 'none';
  settlesImmediately: boolean;
};
export type NuniFoodNutrition =
  | { declared: false }
  | {
      declared: true;
      basis: 'per-serving';
      caloriesKcal: number;
      proteinMg: number;
      fatMg: number;
      carbohydrateMg: number;
      sodiumMg: number;
      sugarMg: number;
      declaredAt: string;
    };
export type NuniFoodOrderCall = { sequence: number; calledAt: string };
export type NuniFoodCustomerCancelReason =
  | 'ordered-by-mistake'
  | 'changed-mind'
  | 'pickup-time-no-longer-works'
  | 'other';
export type NuniFoodStaffRejectReason =
  | 'item-unavailable'
  | 'location-closed'
  | 'preparation-capacity'
  | 'payment-problem'
  | 'other';
export type NuniFoodKeyInput = { idempotencyKey: string };
export type NuniFoodQuoteInput = NuniFoodKeyInput & {
  locationId: string;
  requestedPickupAt: string;
  tableCode?: string;
  items: {
    menuItemId: string;
    quantity: number;
    selectedOptionIds?: string[];
    customerNote?: string;
  }[];
};
export type NuniFoodCreateOrderInput = NuniFoodKeyInput & { quoteId: string };
export type NuniFoodCancelInput = NuniFoodKeyInput & {
  reason: NuniFoodCustomerCancelReason;
  reasonDetail?: string;
};
export type NuniFoodRejectInput = NuniFoodKeyInput & {
  reason: NuniFoodStaffRejectReason;
  reasonDetail?: string;
};
export type NuniFoodPaymentInput = NuniFoodKeyInput & { method: NuniFoodPaymentMethod };
export type NuniFoodOpenShiftInput = NuniFoodKeyInput & { openingCashMinor: number };
export type NuniFoodHandoverInput = NuniFoodKeyInput & {
  countedCashMinor: number;
  note?: string;
  openNext: boolean;
  nextOpeningCashMinor?: number;
};
export type NuniFoodFulfillInput = NuniFoodKeyInput & { pickupToken: string };
export type NuniFoodLocationQuery = { campusId?: string; limit?: number; cursor?: string };
export type NuniFoodOrderQuery = { state?: NuniFoodOrderState; limit?: number; cursor?: string };
export type NuniFoodMerchantOrderQuery = {
  state?: NuniFoodStaffOrderQueueItem['state'];
  station?: NuniFoodKitchenStation;
  shiftId?: string;
  currentShiftOnly?: boolean;
  limit?: number;
  cursor?: string;
};
export type NuniFoodHandoverReceipt = {
  closed: NuniFoodShiftProjection;
  next?: NuniFoodShiftProjection;
};
export type NuniFoodAcceptReceipt = NuniFoodOrderCommandResult & { kitchenTicketId: string };

export type NuniFoodLocationAllowedAction = 'view-menu';
export type NuniFoodMenuItemAllowedAction = 'add-to-quote';
export type NuniFoodQuoteAllowedAction = 'create-order' | 'refresh-quote';
export type NuniFoodCustomerOrderAllowedAction =
  | 'create-payment-session'
  | 'cancel'
  | 'show-pickup-credential';
export type NuniFoodStaffOrderAllowedAction =
  | 'record-counter-payment'
  | 'accept'
  | 'reject'
  | 'confirm-counter-refund'
  | 'start-preparation'
  | 'cancel-accepted'
  | 'mark-ready'
  | 'fulfill-pickup';
export type NuniFoodPickupAllowedAction = 'present-one-time-token';

export interface NuniFoodLocationSummary {
  id: string;
  campusId: string;
  name: string;
  description: string;
  zoneLabel: string;
  timeZone: 'Asia/Taipei';
  state: 'open' | 'paused' | 'closed';
  earliestPickupAt?: string;
  latestPickupAt?: string;

  merchantMode: NuniFoodMerchantMode;
  sourceLabel: string;
  sourceUpdatedAt: string | null;
  sourceUrl?: string;
  externalOrderUrl?: string;
  allowedActions: NuniFoodLocationAllowedAction[];
}

export interface NuniFoodLocationListResponse {
  locations: NuniFoodLocationSummary[];
  nextCursor?: string;
}

export interface NuniFoodMenuOption {
  id: string;
  name: string;
  priceDelta: NuniFoodMoney;
  available: boolean;
}

export interface NuniFoodMenuOptionGroup {
  id: string;
  name: string;
  minimumSelections: number;
  maximumSelections: number;
  options: NuniFoodMenuOption[];
}

export interface NuniFoodMenuItem {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  basePrice: NuniFoodMoney;
  available: boolean;
  dietaryTags: string[];
  allergenTags: string[];

  nutrition: NuniFoodNutrition;
  optionGroups: NuniFoodMenuOptionGroup[];
  allowedActions: NuniFoodMenuItemAllowedAction[];
}

export interface NuniFoodMenuSection {
  id: string;
  name: string;
  items: NuniFoodMenuItem[];
}

export interface NuniFoodMenuProjection {
  location: NuniFoodLocationSummary;
  menuVersion: string;
  generatedAt: string;
  sections: NuniFoodMenuSection[];
}

export interface NuniFoodQuoteLine {
  menuItemId: string;
  nameSnapshot: string;
  quantity: number;
  selectedOptions: Array<{
    optionId: string;
    nameSnapshot: string;
    priceDelta: NuniFoodMoney;
  }>;
  customerNote?: string;
  unitPrice: NuniFoodMoney;
  lineTotal: NuniFoodMoney;
}

export interface NuniFoodQuoteProjection {
  id: string;
  locationId: string;
  menuVersion: string;
  state: 'active' | 'expired' | 'consumed';
  requestedPickupAt: string;
  tableSessionId?: string;
  tableCode?: string;
  lines: NuniFoodQuoteLine[];
  subtotal: NuniFoodMoney;
  fees: Array<{ code: string; label: string; amount: NuniFoodMoney }>;
  total: NuniFoodMoney;
  expiresAt: string;
  allowedActions: NuniFoodQuoteAllowedAction[];
}

export type NuniFoodOrderState =
  | 'payment-pending'
  | 'paid'
  | 'accepted'
  | 'cancellation-pending-refund'
  | 'rejection-pending-refund'
  | 'rejected'
  | 'preparing'
  | 'ready'
  | 'fulfilled'
  | 'canceled'
  | 'payment-expired';

export interface NuniFoodPaymentSessionProjection {
  id: string;
  orderId: string;

  progress: NuniFoodPaymentProgress;
  method: NuniFoodPaymentMethod;

  checkoutUrl: string;
  expiresAt: string;
  failureReason?: string;
  allowedActions: Array<'open-checkout' | 'start-over'>;
}

export interface NuniFoodPaymentMethodsProjection {
  methods: Array<NuniFoodPaymentMethodOption & { method: NuniFoodPaymentMethod }>;

  unavailableMessage?: string;
}

export interface NuniFoodPickupCredentialProjection {
  kind: 'one-time-token';
  token: string;
  expiresAt: string;
}

export interface NuniFoodPickupProjection {
  state: 'awaiting-preparation' | 'preparing' | 'ready' | 'fulfilled';
  displayCode: string;
  readyAt?: string;
  fulfilledAt?: string;
  credential?: NuniFoodPickupCredentialProjection;

  calls: NuniFoodOrderCall[];

  callCount: number;
  lastCalledAt?: string;
  allowedActions: NuniFoodPickupAllowedAction[];
}

export interface NuniFoodCustomerOrderSummary {
  id: string;
  locationId: string;
  locationName: string;
  state: NuniFoodOrderState;
  requestedPickupAt: string;
  itemCount: number;
  total: NuniFoodMoney;
  createdAt: string;
  updatedAt: string;
  allowedActions: NuniFoodCustomerOrderAllowedAction[];
}

export interface NuniFoodCustomerOrderDetail extends NuniFoodCustomerOrderSummary {
  quoteId: string;
  lines: NuniFoodQuoteLine[];
  paymentSession?: NuniFoodPaymentSessionProjection;
  pickup: NuniFoodPickupProjection;
  cancellation?: {
    reason: NuniFoodCustomerCancelReason | NuniFoodStaffRejectReason;
    reasonDetail?: string;
    requestedAt: string;
  };
  rejection?: { reason: NuniFoodStaffRejectReason; reasonDetail?: string; decidedAt: string };
  refund?: {
    state: 'pending' | 'completed';
    amount: NuniFoodMoney;
    requestedAt: string;
    completedAt?: string;
  };
}

export interface NuniFoodCustomerOrderListResponse {
  orders: NuniFoodCustomerOrderSummary[];
  nextCursor?: string;
}

export interface NuniFoodKitchenTicketProjection {
  id: string;
  station: NuniFoodKitchenStation;
  state: 'queued' | 'preparing' | 'ready' | 'fulfilled' | 'cancelled';
  allowedActions: Array<'start-preparation' | 'mark-ready'>;
}

interface NuniFoodStaffOrderQueueItemBase {
  id: string;
  kitchenTicketId?: string;
  kitchenTickets?: NuniFoodKitchenTicketProjection[];
  locationId: string;
  tableSessionId?: string;
  tableCode?: string;
  shiftId?: string;
  origin?: 'customer' | 'pos';
  state:
    | 'payment-pending'
    | 'paid'
    | 'accepted'
    | 'preparing'
    | 'ready'
    | 'cancellation-pending-refund'
    | 'rejection-pending-refund';
  requestedPickupAt: string;
  pickupDisplayCode: string;
  allowedActions: NuniFoodStaffOrderAllowedAction[];
}

export interface NuniFoodKitchenOrderLine {
  menuItemId: string;
  nameSnapshot: string;
  quantity: number;
  selectedOptions: Array<{ optionId: string; nameSnapshot: string }>;
  customerNote?: string;
}

export interface NuniFoodKitchenOrderQueueItem extends NuniFoodStaffOrderQueueItemBase {
  viewerScope: 'kitchen';
  lines: NuniFoodKitchenOrderLine[];
}

export interface NuniFoodCashRegisterOrderQueueItem extends NuniFoodStaffOrderQueueItemBase {
  viewerScope: 'cash-register';
  lines: NuniFoodQuoteLine[];
  total: NuniFoodMoney;
  paidAt?: string;

  paymentChannel?: 'cash' | 'campus-ledger' | 'counter' | 'demo' | 'online';
  qualificationDiscount?: { label: '資格折扣'; amount: NuniFoodMoney };
}

export type NuniFoodStaffOrderQueueItem =
  | NuniFoodKitchenOrderQueueItem
  | NuniFoodCashRegisterOrderQueueItem;

export interface NuniFoodStaffOrderQueueResponse {
  orders: NuniFoodStaffOrderQueueItem[];
  nextCursor?: string;
}

export interface NuniFoodOrderCommandResult {
  orderId: string;
  state: NuniFoodOrderState;
  updatedAt: string;
  replayed: boolean;
}

export interface NuniFoodPickupFulfillmentResult {
  orderId: string;
  state: 'fulfilled';
  fulfilledAt: string;
  replayed: boolean;
}

export interface NuniFoodShiftProjection {
  id: string;
  locationId: string;
  state: 'open' | 'closed';
  openedAt: string;
  closedAt?: string;
  openingCash: NuniFoodMoney;
  countedCash?: NuniFoodMoney;
  expectedCash?: NuniFoodMoney;
  campusLedgerTotal: NuniFoodMoney;

  allowedActions: Array<'handover' | 'view'>;
}
