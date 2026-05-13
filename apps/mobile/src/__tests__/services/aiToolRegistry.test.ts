/**
 * aiToolRegistry — 4 階段契約驗證
 *  Stage 1：必填/選填/預設值
 *  Stage 2：role policy / auth / school 檢查
 *  Stage 3：choiceMenu「第 N 個」自然語言 → 真實參數
 *  Stage 4：success && isWrite && !isDraft 才是真完成
 */

const mockAiOrderFoodCallable = jest.fn(async (payload: any) => ({
  data: {
    orderNo: 'order-1',
    id: 'order-1',
    vendorName: '伯鐸樓 B1',
    itemName: '牛肉麵',
    quantity: payload.quantity ?? 1,
    status: 'pending',
  },
}));

jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn((_functions: unknown, name: string) => {
    if (name === 'aiOrderFood') return mockAiOrderFoodCallable;
    return jest.fn(async () => ({ data: {} }));
  }),
}));

jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  getCloudFunctionRegion: jest.fn(() => 'asia-east1'),
  getDb: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

jest.mock('../../services/cloudFunctions', () => ({
  getCloudFunctionUrl: jest.fn((name: string) => `https://functions.test/${name}`),
  getFirebaseAuthHeaders: jest.fn(async () => ({})),
  getAIServerBaseUrl: jest.fn(() => 'https://ai.test'),
}));

import {
  executeToolStandard,
  listToolSpecs,
  formatStandardToolMessage,
  getResultBadge,
  type ToolExecutionContext,
} from '../../services/aiToolRegistry';

// 將 DataSource 模組替換成 mock，避免實際打 Firestore
jest.mock('../../data/source', () => {
  const ds = {
    listMenus: jest.fn(async () => [
      { id: 'm1', name: '牛肉麵', price: 100, cafeteriaId: 'v1' },
      { id: 'm2', name: '雞排飯', price: 90, cafeteriaId: 'v1' },
    ]),
    listCafeterias: jest.fn(async () => [
      {
        id: 'v1',
        name: '伯鐸樓 B1',
        merchantId: 'v1-mid',
        orderingEnabled: true,
        pilotStatus: 'active',
        activeOperatorCount: 1,
      },
    ]),
    createOrder: jest.fn(async (data: any) => ({ id: 'order-1', status: 'pending', ...data })),
    createCalendarEvent: jest.fn(async (data: any) => ({ id: 'cal-1', ...data })),
    createConversation: jest.fn(async () => ({ id: 'conv-1' })),
    sendMessage: jest.fn(async () => ({ id: 'msg-1' })),
    borrowBook: jest.fn(async () => ({ id: 'loan-1' })),
    listSeats: jest.fn(async () => [
      { id: 'seat-1', name: 'A-1', status: 'available', zone: 'quiet', floor: '3F' },
    ]),
    reserveSeat: jest.fn(async () => ({ id: 'res-1' })),
    createRepairRequest: jest.fn(async (data: any) => ({
      id: 'repair-1',
      status: 'pending',
      ...data,
    })),
  };
  return {
    hasDataSource: () => true,
    getDataSource: () => ds,
  };
});

jest.mock('../../data/puDiningCatalog', () => ({
  getPuDiningCafeterias: () => [],
  getPuDiningMenuItems: () => [],
  isProvidenceDiningSchoolId: () => false,
}));

const baseCtx: ToolExecutionContext = {
  userId: 'u1',
  schoolId: 'pu',
  role: 'student',
  isOnline: true,
};

describe('aiToolRegistry — Stage 1：標準化工具契約', () => {
  it('註冊使用者列出的 7 個正規 tool', () => {
    const names = listToolSpecs().map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'order_food',
        'reserve_seat',
        'borrow_book',
        'create_repair_request',
        'request_leave',
        'create_reminder',
        'send_message',
      ]),
    );
  });

  it('每個 spec 都標明 kind / allowedRoles / fields', () => {
    for (const spec of listToolSpecs()) {
      expect(spec.kind).toMatch(/read|write|cross_role_write/);
      expect(spec.allowedRoles.length).toBeGreaterThan(0);
      expect(Array.isArray(spec.fields)).toBe(true);
      expect(typeof spec.handler).toBe('function');
    }
  });
});

describe('aiToolRegistry — Stage 2：全域 Action 執行層', () => {
  it('未登入 → auth_required', async () => {
    const r = await executeToolStandard('order_food', { vendorId: 'v1', itemId: 'm1' }, {
      schoolId: 'pu',
      role: 'student',
    });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('auth_required');
    expect(r.isWrite).toBe(true);
    expect(r.isDraft).toBe(false);
  });

  it('沒 schoolId → school_required（寫入工具）', async () => {
    const r = await executeToolStandard('order_food', { vendorId: 'v1', itemId: 'm1' }, {
      userId: 'u1',
      schoolId: '' as any,
      role: 'student',
    });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('school_required');
  });

  it('角色不允許 → role_denied', async () => {
    // create_assignment 只開放教學角色
    const r = await executeToolStandard('create_assignment', { groupId: 'g1', title: 't' }, baseCtx);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('role_denied');
  });

  it('未知 tool → tool_not_found', async () => {
    const r = await executeToolStandard('this_tool_does_not_exist', {}, baseCtx);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('tool_not_found');
  });

  it('離線寫入 → offline', async () => {
    const r = await executeToolStandard(
      'order_food',
      { vendorId: 'v1', itemId: 'm1' },
      { ...baseCtx, isOnline: false },
    );
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('offline');
  });
});

describe('aiToolRegistry — Stage 3：自然語言 → 工具參數', () => {
  it('缺必填欄位 → missing_info（並回傳追問字串）', async () => {
    const r = await executeToolStandard('order_food', { vendorId: 'v1' }, baseCtx);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('missing_info');
    expect(r.missingInfo?.[0]?.field).toBe('itemId');
    expect(r.missingInfo?.[0]?.prompt).toMatch(/餐點|itemId/);
  });

  it('沒給數量時自動套預設值 quantity=1', async () => {
    const r = await executeToolStandard(
      'order_food',
      { vendorId: 'v1', itemId: 'm1' },
      baseCtx,
    );
    expect(r.success).toBe(true);
    const lastCall = (mockAiOrderFoodCallable.mock.calls.at(-1) ?? [])[0];
    expect(lastCall?.quantity).toBe(1);
  });

  it('負數或零數量不可送出訂餐', async () => {
    mockAiOrderFoodCallable.mockClear();
    const r = await executeToolStandard(
      'order_food',
      { vendorId: 'v1', itemId: 'm1', quantity: '-3' },
      baseCtx,
    );

    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('missing_info');
    expect(r.missingInfo?.[0]?.field).toBe('quantity');
    expect(mockAiOrderFoodCallable).not.toHaveBeenCalled();
  });

  it('「幫我點第 2 個」+ lastChoiceMenu → 自動填 itemId/vendorId', async () => {
    const r = await executeToolStandard('order_food', {}, {
      ...baseCtx,
      lastUserMessage: '幫我點第 2 個',
      lastChoiceMenu: {
        title: '請選擇',
        options: [
          { id: 'm1@@v1', label: '牛肉麵' },
          { id: 'm2@@v1', label: '雞排飯' },
        ],
      },
    });
    expect(r.success).toBe(true);
    expect(r.isWrite).toBe(true);
    expect(r.isDraft).toBe(false);
    const lastCall = (mockAiOrderFoodCallable.mock.calls.at(-1) ?? [])[0];
    expect(lastCall?.itemId).toBe('m2');
    expect(lastCall?.vendorId).toBe('v1');
  });
});

describe('aiToolRegistry — Stage 4：草稿 vs 真送出', () => {
  it('成功寫入 → success && isWrite && !isDraft → ✅ 已完成', async () => {
    const r = await executeToolStandard(
      'create_reminder',
      { title: '測試提醒', time: new Date(Date.now() + 3600_000).toISOString() },
      baseCtx,
    );
    expect(r.success).toBe(true);
    expect(r.isWrite).toBe(true);
    expect(r.isDraft).toBe(false);
    const msg = formatStandardToolMessage(r);
    expect(msg).toMatch(/✅/);
    expect(getResultBadge(r).badge).toBe('executed');
  });

  it('legacy 工具回傳 isWrite=false 但 success=true → 包成 isDraft=true', async () => {
    // request_leave 在沒指定 courseId 時，legacy 會回 success=true、isWrite=false（請使用者選課）
    // → registry 應該標 isDraft=true
    const r = await executeToolStandard(
      'request_leave',
      { reason: '生病', leaveType: 'sick' },
      baseCtx,
    );
    expect(r.isWrite).toBe(true);
    if (r.success) {
      expect(r.isDraft).toBe(true);
      const msg = formatStandardToolMessage(r);
      expect(msg).toMatch(/草稿/);
      expect(getResultBadge(r).badge).toMatch(/drafted|executed/);
    }
  });

  it('missing_info 的 badge 是 pending_input', async () => {
    const r = await executeToolStandard('order_food', { vendorId: 'v1' }, baseCtx);
    expect(getResultBadge(r).badge).toBe('pending_input');
  });
});
