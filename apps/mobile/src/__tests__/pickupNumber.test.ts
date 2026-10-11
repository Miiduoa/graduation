import {
  describePickupNumber,
  formatTaipeiOrderTime,
  PICKUP_NUMBER_PENDING_TEXT,
} from '@campus/shared/src/ordering/pickupNumber';

const mockCreateOrder = jest.fn();
const mockAssign = jest.fn();
jest.mock('../services/cafeteriaData', () => ({
  createOrder: (...args: unknown[]) => mockCreateOrder(...args),
  assignOrderQueueNumber: (...args: unknown[]) => mockAssign(...args),
  updateOrderStatus: jest.fn(async () => null),
  logNutrition: jest.fn(),
  trackSpending: jest.fn(),
  getVendor: () => ({ id: 'cafe', isOpen: true }),
}));
jest.mock('../services/ordering/allergens', () => ({
  checkAllergens: jest.fn(async () => ({ severity: 'none', message: '' })),
  isValidOverrideToken: () => false,
}));
jest.mock('../services/ordering/stock', () => ({
  reserveStock: jest.fn(async () => ({ ok: true })),
  releaseStock: jest.fn(async () => undefined),
  commitSale: jest.fn(),
}));
jest.mock('../services/ordering/wallet', () => ({
  holdWallet: jest.fn(async () => ({ ok: true, holdId: 'hold-1' })),
  releaseWalletHold: jest.fn(async () => ({ ok: true })),
  captureWallet: jest.fn(),
}));
jest.mock('../services/ordering/pickupCode', () => ({
  issuePickupCode: jest.fn(async () => ({ code: '1234' })),
  revokePickupCode: jest.fn(),
  consumePickupCode: jest.fn(),
}));
jest.mock('../services/ordering/refund', () => ({ createRefund: jest.fn() }));

import { placeOrderAtomic } from '../services/ordering/atomicOrder';

const request = {
  studentUid: 'alice',
  schoolId: 'pu',
  cafeteriaId: 'jingyuan',
  vendorId: 'cafe',
  items: [
    {
      menuItemId: 'rice',
      menuItemName: '雞腿飯',
      quantity: 1,
      unitPrice: 90,
      selectedOptions: [],
      subtotal: 90,
    },
  ],
  totalPrice: 90,
  note: '',
  paymentMethod: 'campus_card',
} as any;
const order = (extra = {}) => ({
  id: 'o1',
  queueNumber: null,
  createdAt: '2026-10-13T04:05:00.000Z',
  ...extra,
});

describe('取餐號碼顯示', () => {
  test('台灣時間、絕對日期加星期：UTC 04:05 是台灣 12:05', () => {
    expect(formatTaipeiOrderTime('2026-10-13T04:05:00Z')).toBe('10 月 13 日（二）12:05');
  });

  test('跨日：UTC 16:30 已經是台灣隔天 00:30', () => {
    expect(formatTaipeiOrderTime('2026-10-12T16:30:00Z')).toBe('10 月 13 日（二）00:30');
  });

  test('沒有號碼：顯示「號碼還沒拿到」，下面列下單時間和品項，狀態待確認', () => {
    const view = describePickupNumber({
      queueNumber: null,
      createdAt: '2026-10-13T04:05:00Z',
      items: [{ name: '雞腿飯', quantity: 1 }],
    });
    expect(view).toEqual({
      state: 'pending',
      label: '待確認',
      text: PICKUP_NUMBER_PENDING_TEXT,
      detail: '10 月 13 日（二）12:05・雞腿飯 ×1',
    });
    expect(PICKUP_NUMBER_PENDING_TEXT).toBe('號碼還沒拿到，請到櫃台確認。');
  });

  test('有伺服器號碼：只顯示號碼', () => {
    expect(describePickupNumber({ queueNumber: 7 })).toMatchObject({
      state: 'assigned',
      text: '取餐號碼 7',
    });
  });

  test('0、負數、字串都不算號碼', () => {
    for (const value of [0, -1, '12', 3.5, undefined]) {
      expect(describePickupNumber({ queueNumber: value }).state).toBe('pending');
    }
  });

  test('不寫今天、明天', () => {
    const view = describePickupNumber({ queueNumber: null, createdAt: new Date(), items: [] });
    expect(JSON.stringify(view)).not.toMatch(/今天|明天|今日/);
  });
});

describe('手機下單不再自己算號碼', () => {
  beforeEach(() => {
    mockCreateOrder.mockReset();
    mockAssign.mockReset();
  });

  test('伺服器建單時已經發號：直接用那個號碼', async () => {
    mockCreateOrder.mockResolvedValue(order({ queueNumber: 4 }));
    const result = await placeOrderAtomic(request, {} as any, []);
    expect(result).toMatchObject({ ok: true, orderId: 'o1', queueNumber: 4, queueStatus: 'assigned' });
    expect(mockAssign).not.toHaveBeenCalled();
  });

  test('建單沒帶號碼：用這筆訂單的 orderId 跟伺服器拿', async () => {
    mockCreateOrder.mockResolvedValue(order());
    mockAssign.mockResolvedValue({ queueNumber: 5 });
    const result = await placeOrderAtomic(request, {} as any, []);
    expect(mockAssign).toHaveBeenCalledWith('o1', { vendorId: 'cafe' });
    expect(result).toMatchObject({ ok: true, queueNumber: 5, queueStatus: 'assigned' });
  });

  test('雲端拿不到號碼：訂單照樣成立，號碼是 null、待確認，不給裝置時間算出來的假號碼', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-13T04:05:00Z') });
    try {
      mockCreateOrder.mockResolvedValue(order());
      mockAssign.mockRejectedValue(new Error('offline'));
      const result = await placeOrderAtomic(request, {} as any, []);
      expect(result).toMatchObject({
        ok: true,
        orderId: 'o1',
        queueNumber: null,
        queueStatus: 'pending_confirmation',
      });
      const note = mockCreateOrder.mock.calls[0][0].note as string;
      expect(note).not.toMatch(/\[queue:/);
    } finally {
      jest.useRealTimers();
    }
  });
});
