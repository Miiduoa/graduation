/**
 * Order Flow Integration Test — 學生下單 → 餐廳收到
 *
 * 模擬：
 *   1. 學生（demo_student_kuchih）下單到中餐部
 *   2. emitOrderPlaced 把事件 persist 到 __all__ broadcast inbox
 *   3. 餐廳（demo_cafeteria）登入後 loadRoleEventInbox(vendorUid) 應該能讀到
 *   4. payload.merchantId 正確
 *
 * 這個 test 是回歸測試：之前 LoginLanding 切角色時會 clearRoleEventInbox('__all__')
 * 導致學生剛下的訂單在切到 vendor 之後消失。修復後此 test 應該通過。
 */
import { simulateStudentOrderFood } from '../services/demoActionSimulator';
import { loadRoleEventInbox, clearRoleEventInbox, type OrderPlacedPayload } from '../services/roleEventBus';

// AsyncStorage mock（jest 環境）
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('Order Flow: 學生下單 → 餐廳收到', () => {
  beforeEach(async () => {
    // 清掉之前的 inbox 避免測試互相干擾
    await clearRoleEventInbox('demo_student_kuchih');
    await clearRoleEventInbox('demo_cafeteria');
    await clearRoleEventInbox('__all__');
  });

  test('學生下單後 vendor 能透過 loadRoleEventInbox 讀到', async () => {
    // 1. 學生下單
    const { orderId } = await simulateStudentOrderFood({
      studentUid: 'demo_student_kuchih',
      studentName: '顧晉瑋',
      merchantId: 'merchant_cafe_a',
      merchantName: '中餐部',
      items: '排骨便當',
      total: 80,
    });

    expect(orderId).toMatch(/^order_/);

    // 2. 餐廳讀 inbox（會自動 merge personal + __all__ broadcast）
    const events = await loadRoleEventInbox('demo_cafeteria');
    const orderEvents = events.filter((e) => e.kind === 'order_placed');

    // 3. 應該收到那筆訂單
    expect(orderEvents.length).toBeGreaterThanOrEqual(1);
    const matching = orderEvents.find((e) => {
      const p = e.payload as OrderPlacedPayload;
      return p.orderId === orderId;
    });
    expect(matching).toBeDefined();
    const payload = matching!.payload as OrderPlacedPayload;
    expect(payload.merchantId).toBe('merchant_cafe_a');
    expect(payload.studentName).toBe('顧晉瑋');
    expect(payload.total).toBe(80);
  });

  test('多次下單都收得到', async () => {
    await simulateStudentOrderFood({
      studentUid: 'demo_student_kuchih',
      studentName: '顧晉瑋',
      merchantId: 'merchant_cafe_a',
      merchantName: '中餐部',
      items: '排骨便當',
      total: 80,
    });
    await simulateStudentOrderFood({
      studentUid: 'demo_student_kuchih',
      studentName: '顧晉瑋',
      merchantId: 'merchant_cafe_a',
      merchantName: '中餐部',
      items: '雞腿便當',
      total: 90,
    });

    const events = await loadRoleEventInbox('demo_cafeteria');
    const orderEvents = events.filter((e) => e.kind === 'order_placed');
    expect(orderEvents.length).toBeGreaterThanOrEqual(2);
  });

  test('清掉 student 個人 inbox 不影響 __all__ broadcast', async () => {
    // 模擬 LoginLanding 切角色行為（只清 student 個人，保留 __all__）
    await simulateStudentOrderFood({
      studentUid: 'demo_student_kuchih',
      studentName: '顧晉瑋',
      merchantId: 'merchant_cafe_a',
      merchantName: '中餐部',
      items: '咖哩飯',
      total: 70,
    });
    await clearRoleEventInbox('demo_student_kuchih'); // 切角色清個人

    const events = await loadRoleEventInbox('demo_cafeteria');
    const orderEvents = events.filter((e) => e.kind === 'order_placed');
    expect(orderEvents.length).toBeGreaterThanOrEqual(1);
    const p = orderEvents[0].payload as OrderPlacedPayload;
    expect(p.items).toContain('咖哩飯');
  });

  test('學生下到 A 店，餐廳 filter 後只看到 A 店訂單', async () => {
    await simulateStudentOrderFood({
      studentUid: 'demo_student_kuchih',
      studentName: '顧晉瑋',
      merchantId: 'merchant_cafe_a',
      merchantName: '中餐部',
      items: '排骨便當',
      total: 80,
    });
    await simulateStudentOrderFood({
      studentUid: 'demo_student_kuchih',
      studentName: '顧晉瑋',
      merchantId: 'merchant_coffee_b',
      merchantName: '咖啡屋',
      items: '拿鐵',
      total: 70,
    });

    const events = await loadRoleEventInbox('demo_cafeteria');
    const orderEvents = events.filter((e) => e.kind === 'order_placed');
    const cafeOrders = orderEvents.filter((e) => {
      const p = e.payload as OrderPlacedPayload;
      return p.merchantId === 'merchant_cafe_a';
    });
    const coffeeOrders = orderEvents.filter((e) => {
      const p = e.payload as OrderPlacedPayload;
      return p.merchantId === 'merchant_coffee_b';
    });
    expect(cafeOrders.length).toBe(1);
    expect(coffeeOrders.length).toBe(1);
  });
});
