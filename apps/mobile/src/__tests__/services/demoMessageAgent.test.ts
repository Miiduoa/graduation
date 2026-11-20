import AsyncStorage from '@react-native-async-storage/async-storage';

import { mockSource } from '../../data/mockSource';
import { setDataSource } from '../../data/source';
import { createDemoDiningOrder } from '../../services/demoOrdering';
import { getMessagesForRole, resetDemoStore } from '../../services/demoStore';
import { resetDemoOrderStore } from '../../services/demoMerchantOrders';
import { sendDemoMessageAsAgent } from '../../services/demoMessageAgent';
import {
  autonomousQuery,
  resetAdaptiveLearnedPatternsForTests,
} from '../../services/aiLocalAgent';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

beforeEach(async () => {
  await AsyncStorage.clear();
  await resetDemoStore();
  resetDemoOrderStore();
  resetAdaptiveLearnedPatternsForTests();
  setDataSource(mockSource as any);
});

describe('demoMessageAgent', () => {
  it('張教授別名會送到教師收件匣', () => {
    const result = sendDemoMessageAsAgent({
      senderUid: 'demo_student_kuchih',
      senderRole: 'student',
      message: '幫我傳訊息給張教授說我會晚到',
    });

    expect(result.success).toBe(true);
    const teacherMessages = getMessagesForRole('teacher');
    expect(teacherMessages).toHaveLength(1);
    expect(teacherMessages[0].subject).toContain('張怡君');
    expect(teacherMessages[0].body).toContain('我會晚到');
    expect(teacherMessages[0].body).not.toContain('傳訊息給張教授');
    expect(getMessagesForRole('student')).toHaveLength(0);
  });

  it('餐廳改訂單訊息會送到 vendor 並附最近訂單', async () => {
    const order = await createDemoDiningOrder({
      userId: 'demo_teacher_chang',
      userName: '張怡君',
      role: 'teacher',
      merchantName: '口試 Demo 便當店',
      itemName: '教授能量排骨便當',
      quantity: 1,
      paymentMethod: 'onsite',
      source: 'test',
    });

    const result = sendDemoMessageAsAgent({
      senderUid: 'demo_teacher_chang',
      senderRole: 'teacher',
      message: '幫我傳訊息給餐廳說我的訂單要改成少飯',
    });

    expect(result.success).toBe(true);
    const vendorMessages = getMessagesForRole('vendor');
    expect(vendorMessages.some((message) => message.body.includes('少飯'))).toBe(true);
    expect(vendorMessages.some((message) => message.body.includes(order.order.id.slice(0, 8)))).toBe(true);
  });

  it('沒有「說」字的餐廳改單口語也能送出乾淨內容', async () => {
    await createDemoDiningOrder({
      userId: 'demo_student_kuchih',
      userName: '顧晉瑋',
      role: 'student',
      merchantName: '口試 Demo 便當店',
      itemName: '口試招牌雞腿便當',
      quantity: 1,
      paymentMethod: 'online',
      source: 'test',
    });

    const result = sendDemoMessageAsAgent({
      senderUid: 'demo_student_kuchih',
      senderRole: 'student',
      message: '幫我傳訊息給餐廳要改訂單成不要香菜',
    });

    expect(result.success).toBe(true);
    const latest = getMessagesForRole('vendor')[0];
    expect(latest.body).toContain('改訂單成不要香菜');
    expect(latest.body).not.toContain('幫我傳訊息給餐廳');
  });

  it('未知收件人不會假裝送出', () => {
    const result = sendDemoMessageAsAgent({
      senderUid: 'demo_student_kuchih',
      senderRole: 'student',
      message: '幫我傳訊息給火星窗口說我到了',
    });

    expect(result.success).toBe(false);
    expect(result.isWrite).toBe(false);
    expect(getMessagesForRole('teacher')).toHaveLength(0);
  });

  it('草稿語意不會寫入訊息', () => {
    const result = sendDemoMessageAsAgent({
      senderUid: 'demo_student_kuchih',
      senderRole: 'student',
      message: '只幫我寫草稿給張教授說我會晚到，不要送出',
    });

    expect(result.success).toBe(false);
    expect(result.isWrite).toBe(false);
    expect(getMessagesForRole('teacher')).toHaveLength(0);
  });

  it('AI local agent 對 demo 張教授可完成 send_message', async () => {
    const result = await autonomousQuery('幫我傳訊息給張教授說我會晚到', {
      userId: 'demo_student_kuchih',
      schoolId: 'pu',
      role: 'student',
      isOnline: true,
    });

    expect(result.executedActions.some((action) => action.tool === 'send_message' && action.result.success)).toBe(true);
    const sent = getMessagesForRole('teacher').find((message) => message.body.includes('我會晚到'));
    expect(sent).toBeTruthy();
    expect(sent?.body).not.toContain('傳訊息給張教授');
  });

  it('AI local agent 對餐廳改單口語可代理送出並附訂單', async () => {
    const order = await createDemoDiningOrder({
      userId: 'demo_student_kuchih',
      userName: '顧晉瑋',
      role: 'student',
      merchantName: '口試 Demo 便當店',
      itemName: '口試招牌雞腿便當',
      quantity: 1,
      paymentMethod: 'online',
      source: 'test',
    });

    const result = await autonomousQuery('幫我傳訊息給餐廳要改訂單成不要香菜', {
      userId: 'demo_student_kuchih',
      schoolId: 'pu',
      role: 'student',
      isOnline: true,
    });

    expect(result.executedActions.some((action) => action.tool === 'send_message' && action.result.success)).toBe(true);
    const sent = getMessagesForRole('vendor').find((message) => message.body.includes('不要香菜'));
    expect(sent).toBeTruthy();
    expect(sent?.body).toContain(order.order.id.slice(0, 8));
    expect(sent?.body).not.toContain('幫我傳訊息給餐廳');
  });
});
