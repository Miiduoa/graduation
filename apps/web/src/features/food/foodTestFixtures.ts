import type {
  NuniFoodCustomerOrderDetail,
  NuniFoodMenuProjection,
  NuniFoodQuoteProjection,
  NuniFoodShiftProjection,
  NuniFoodStaffOrderQueueItem,
} from '@campus/shared/src/nuniFood';
export const future = '2099-10-13T12:00:00.000Z';
export const money = (amountMinor = 120) => ({ amountMinor, currency: 'TWD' as const });
export const menuFixture = (): NuniFoodMenuProjection => ({
  location: {
    id: 'store-1',
    campusId: 'main',
    name: '米飯店',
    description: '現做餐點',
    zoneLabel: '一樓',
    timeZone: 'Asia/Taipei',
    state: 'open',
    merchantMode: 'full',
    sourceLabel: '店家',
    sourceUpdatedAt: null,
    allowedActions: ['view-menu'],
  },
  menuVersion: 'menu-1',
  generatedAt: future,
  sections: [
    {
      id: 'meals',
      name: '主餐',
      items: [
        {
          id: 'rice',
          name: '蔬菜便當',
          description: '時蔬與白飯',
          basePrice: money(100),
          available: true,
          dietaryTags: [],
          allergenTags: ['大豆'],
          nutrition: { declared: false },
          allowedActions: ['add-to-quote'],
          optionGroups: [
            {
              id: 'size',
              name: '份量',
              minimumSelections: 1,
              maximumSelections: 1,
              options: [{ id: 'large', name: '加飯', priceDelta: money(20), available: true }],
            },
          ],
        },
      ],
    },
  ],
});
export const quoteFixture = (requestedPickupAt = future): NuniFoodQuoteProjection => ({
  id: 'quote-1',
  locationId: 'store-1',
  menuVersion: 'menu-1',
  state: 'active',
  requestedPickupAt,
  lines: [
    {
      menuItemId: 'rice',
      nameSnapshot: '蔬菜便當',
      quantity: 1,
      selectedOptions: [{ optionId: 'large', nameSnapshot: '加飯', priceDelta: money(20) }],
      unitPrice: money(),
      lineTotal: money(),
    },
  ],
  subtotal: money(),
  fees: [],
  total: money(),
  expiresAt: future,
  allowedActions: ['create-order'],
});
export const orderFixture = (): NuniFoodCustomerOrderDetail => ({
  id: 'order-1',
  locationId: 'store-1',
  locationName: '米飯店',
  state: 'payment-pending',
  requestedPickupAt: future,
  itemCount: 1,
  total: money(),
  createdAt: future,
  updatedAt: future,
  allowedActions: ['cancel'],
  quoteId: 'quote-1',
  lines: quoteFixture().lines,
  pickup: {
    state: 'awaiting-preparation',
    displayCode: 'A101',
    calls: [],
    callCount: 0,
    allowedActions: [],
  },
});
export const readyOrder = (): NuniFoodCustomerOrderDetail => ({
  ...orderFixture(),
  state: 'ready',
  allowedActions: ['show-pickup-credential'],
  pickup: {
    state: 'ready',
    displayCode: 'A101',
    readyAt: future,
    calls: [],
    callCount: 0,
    credential: { kind: 'one-time-token', token: 't'.repeat(43), expiresAt: future },
    allowedActions: ['present-one-time-token'],
  },
});
export function orderSummary(order: NuniFoodCustomerOrderDetail) {
  return {
    id: order.id,
    locationId: order.locationId,
    locationName: order.locationName,
    state: order.state,
    requestedPickupAt: order.requestedPickupAt,
    itemCount: order.itemCount,
    total: order.total,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    allowedActions: order.allowedActions,
  };
}
export const shiftFixture = (): NuniFoodShiftProjection => ({
  id: 'shift-1',
  locationId: 'store-1',
  state: 'open',
  openedAt: future,
  openingCash: money(500),
  campusLedgerTotal: money(0),
  allowedActions: ['handover', 'view'],
});
export const queueFixture = (): NuniFoodStaffOrderQueueItem => ({
  id: 'order-1',
  locationId: 'store-1',
  state: 'payment-pending',
  requestedPickupAt: future,
  pickupDisplayCode: 'A101',
  allowedActions: ['record-counter-payment'],
  viewerScope: 'cash-register',
  lines: quoteFixture().lines,
  total: money(),
  kitchenTickets: [],
});
