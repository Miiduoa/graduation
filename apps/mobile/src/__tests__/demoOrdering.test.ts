/**
 * Demo ordering smoke tests.
 *
 * The oral-exam demo must allow every demo role to place an order without
 * touching production restaurant infrastructure.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { createDemoDiningOrder } from '../services/demoOrdering';
import {
  DEMO_EXAM_BENTO_MERCHANT_ID,
  getDemoMerchantAssignmentsForUid,
} from '../data/demoMerchants';
import { resetDemoStore, getMessagesForRole, type DemoUserRole } from '../services/demoStore';
import { listDemoMerchantOrders, listDemoOrdersForStudent, resetDemoOrderStore } from '../services/demoMerchantOrders';
import { clearRoleEventInbox, loadVisibleRoleEventInbox } from '../services/roleEventBus';
import { executeTool } from '../services/aiAgentTools';
import { executeToolStandard } from '../services/aiToolRegistry';
import { autonomousQuery } from '../services/aiLocalAgent';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  getFunctionsInstance: jest.fn(() => ({})),
  getCloudFunctionRegion: jest.fn(() => 'asia-east1'),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

const DEMO_ACTORS: Array<{ uid: string; role: DemoUserRole; name: string }> = [
  { uid: 'demo_student_kuchih', role: 'student', name: '顧晉瑋' },
  { uid: 'demo_teacher_chang', role: 'teacher', name: '張怡君' },
  { uid: 'demo_ta_lin', role: 'ta', name: '林助教' },
  { uid: 'demo_club_wei', role: 'club_officer', name: '魏程式' },
  { uid: 'demo_admin_huang', role: 'department_head', name: '黃主任' },
  { uid: 'demo_admin_sys', role: 'admin', name: '王系管' },
  { uid: 'demo_cafeteria', role: 'vendor', name: '阿英' },
  { uid: 'demo_alumni_chang', role: 'alumni', name: '張學長' },
  { uid: 'demo_guest', role: 'guest', name: '訪客' },
];

beforeEach(async () => {
  await AsyncStorage.clear();
  await resetDemoStore();
  resetDemoOrderStore();
  await clearRoleEventInbox('__all__');
  for (const actor of DEMO_ACTORS) {
    await clearRoleEventInbox(actor.uid);
  }
  await clearRoleEventInbox('demo_cafeteria');
});

describe('demoOrdering', () => {
  test.each(DEMO_ACTORS)('$role 可以建立 demo 訂單且不漏到 student inbox', async ({ uid, role, name }) => {
    const result = await createDemoDiningOrder({
      userId: uid,
      userName: name,
      role,
      schoolId: 'pu',
      merchantName: '口試 Demo 便當店',
      itemName: '口試招牌雞腿便當',
      quantity: 1,
      paymentMethod: 'online',
      source: 'test',
    });

    expect(result.actor.role).toBe(role);
    expect(result.merchant.id).toBe(DEMO_EXAM_BENTO_MERCHANT_ID);
    expect(result.order.userId).toBe(uid);
    expect(result.order.customerName).toBe(name);
    expect(result.order.customerRole).toBe(role);
    expect(result.order.paymentMethod).toBe('online');
    expect(result.order.paymentStatus).toBe('paid');
    expect(listDemoOrdersForStudent(uid).some((order) => order.id === result.order.id)).toBe(true);
    expect(listDemoMerchantOrders(DEMO_EXAM_BENTO_MERCHANT_ID).some((order) => order.id === result.order.id)).toBe(true);

    const buyerMessages = getMessagesForRole(role);
    expect(buyerMessages.some((message) => message.relatedOrderId === result.order.id)).toBe(true);

    if (role !== 'student') {
      expect(getMessagesForRole('student').some((message) => message.relatedOrderId === result.order.id)).toBe(false);
    }
  });

  test('多品項 cart 會建立同一張口試 Demo 店家訂單並保存總金額', async () => {
    const result = await createDemoDiningOrder({
      userId: 'demo_student_kuchih',
      userName: '顧晉瑋',
      role: 'student',
      schoolId: 'pu',
      merchantId: DEMO_EXAM_BENTO_MERCHANT_ID,
      items: [
        { itemId: 'm_exam_bento_1', quantity: 2 },
        { itemId: 'm_exam_bento_4', quantity: 2 },
      ],
      paymentMethod: 'onsite',
      source: 'ordering_screen',
    });

    expect(result.merchant.id).toBe(DEMO_EXAM_BENTO_MERCHANT_ID);
    expect(result.lines).toHaveLength(2);
    expect(result.order.items).toHaveLength(2);
    expect(result.total).toBe(240);
    expect(result.order.totalAmount).toBe(240);
    expect(result.order.paymentMethod).toBe('onsite');
    expect(result.order.paymentStatus).toBe('unpaid');
    const vendorOrder = listDemoMerchantOrders(DEMO_EXAM_BENTO_MERCHANT_ID)
      .find((order) => order.id === result.order.id);
    expect(vendorOrder?.customerName).toBe('顧晉瑋');
    expect(vendorOrder?.items.map((item) => item.name)).toEqual([
      '口試招牌雞腿便當',
      'AI 助理加點紅茶',
    ]);
  });

  test('AI create_order 對 demo teacher 直接送出可被 vendor 看到的訂單', async () => {
    const result = await executeTool(
      'create_order',
      { itemName: '口試招牌雞腿便當', quantity: '1', paymentMethod: 'online' },
      {
        userId: 'demo_teacher_chang',
        schoolId: 'pu',
        role: 'teacher',
        lastUserMessage: '幫我點一份口試招牌雞腿便當，線上付款',
      },
    );

    if (!result.success) {
      throw new Error(JSON.stringify(result));
    }
    expect(result.success).toBe(true);
    expect(result.isWrite).toBe(true);
    expect(result.summary).toContain('已送出 demo 訂單');
    expect(listDemoOrdersForStudent('demo_teacher_chang')).toHaveLength(1);
    expect(listDemoMerchantOrders(DEMO_EXAM_BENTO_MERCHANT_ID).some((order) => order.userId === 'demo_teacher_chang')).toBe(true);

    const vendorInbox = await loadVisibleRoleEventInbox({
      uid: 'demo_cafeteria',
      role: 'vendor',
    });
    expect(vendorInbox.some((event) => event.kind === 'order_placed')).toBe(true);
  });

  test('AI create_order 對 demo 下單缺付款方式時會先追問', async () => {
    const result = await executeTool(
      'create_order',
      { itemName: '口試招牌雞腿便當', quantity: '1' },
      {
        userId: 'demo_student_kuchih',
        schoolId: 'pu',
        role: 'student',
        lastUserMessage: '幫我點一份口試招牌雞腿便當',
      },
    );

    expect(result.success).toBe(false);
    expect(result.isWrite).toBe(false);
    expect(result.summary).toContain('付款方式');
    expect(result.choiceMenu?.options.map((option) => option.label)).toEqual(['線上付款', '到店付款']);
    expect(listDemoOrdersForStudent('demo_student_kuchih')).toHaveLength(0);

    const followUp = await executeTool(
      'create_order',
      {},
      {
        userId: 'demo_student_kuchih',
        schoolId: 'pu',
        role: 'student',
        lastUserMessage: '線上付款',
        lastChoiceMenu: result.choiceMenu,
      },
    );

    expect(followUp.success).toBe(true);
    expect(followUp.isWrite).toBe(true);
    expect(listDemoOrdersForStudent('demo_student_kuchih')).toHaveLength(1);
  });

  test('canonical order_food 缺付款方式後可續接同一筆 demo 餐點', async () => {
    const first = await executeToolStandard(
      'order_food',
      { vendorId: DEMO_EXAM_BENTO_MERCHANT_ID, itemId: 'm_exam_bento_1', itemName: '口試招牌雞腿便當' },
      {
        userId: 'demo_student_kuchih',
        schoolId: 'pu',
        role: 'student',
        lastUserMessage: '幫我點口試招牌雞腿便當',
      },
    );

    expect(first.success).toBe(false);
    expect(first.summary).toContain('付款方式');
    expect(first.choiceMenu?.producedByTool).toBe('create_order');

    const second = await executeToolStandard(
      'order_food',
      {},
      {
        userId: 'demo_student_kuchih',
        schoolId: 'pu',
        role: 'student',
        lastUserMessage: '到店付款',
        lastChoiceMenu: first.choiceMenu,
      },
    );

    expect(second.success).toBe(true);
    expect(second.isWrite).toBe(true);
    expect(second.summary).toContain('到店付款');
    const order = listDemoOrdersForStudent('demo_student_kuchih')[0];
    expect(order?.paymentMethod).toBe('onsite');
    expect(order?.items[0]?.name).toBe('口試招牌雞腿便當');
  });

  test('AI 多輪訂餐只回答付款方式也會保留原餐點並送到餐廳', async () => {
    const first = await autonomousQuery('幫我點一份口試招牌雞腿便當', {
      userId: 'demo_student_kuchih',
      schoolId: 'pu',
      role: 'student',
      isOnline: true,
    });

    expect(first.choiceMenu?.producedByTool).toBe('create_order');
    expect(first.choiceMenu?.options.map((option) => option.label)).toEqual(['線上付款', '到店付款']);
    expect(listDemoOrdersForStudent('demo_student_kuchih')).toHaveLength(0);

    const second = await autonomousQuery('到店付款', {
      userId: 'demo_student_kuchih',
      schoolId: 'pu',
      role: 'student',
      isOnline: true,
      lastChoiceMenu: first.choiceMenu,
    });

    expect(second.executedActions.some((action) => action.tool === 'create_order' && action.result.success)).toBe(true);
    const order = listDemoOrdersForStudent('demo_student_kuchih')[0];
    expect(order?.items[0]?.name).toBe('口試招牌雞腿便當');
    expect(order?.paymentMethod).toBe('onsite');
    expect(listDemoMerchantOrders(DEMO_EXAM_BENTO_MERCHANT_ID).some((vendorOrder) => vendorOrder.id === order?.id)).toBe(true);
  });

  test('餐廳員工 demo 帳號第一個指派店家是口試 Demo 便當店', () => {
    expect(getDemoMerchantAssignmentsForUid('demo_cafeteria')[0]).toEqual({
      merchantId: DEMO_EXAM_BENTO_MERCHANT_ID,
      role: 'manager',
    });
  });
});
