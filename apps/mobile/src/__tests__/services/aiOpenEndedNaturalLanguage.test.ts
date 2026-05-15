/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

import { mockSource } from '../../data/mockSource';
import { setDataSource } from '../../data/source';
import {
  autonomousQuery,
  resetAdaptiveLearnedPatternsForTests,
  type AgentQueryResult,
} from '../../services/aiLocalAgent';

const CTX = {
  userId: 'open-ended-language-user',
  schoolId: 'pu',
  role: 'student' as const,
  isOnline: true,
};

function observedTools(result: AgentQueryResult): Set<string> {
  return new Set([
    ...result.intents.map((i) => i.tool),
    ...result.results.map((r) => r.tool),
    ...result.executedActions.map((a) => a.tool),
    ...result.failedActions.map((a) => a.tool),
  ]);
}

async function expectNoTools(message: string, forbidden: string[]): Promise<void> {
  const result = await autonomousQuery(message, CTX, undefined, []);
  const tools = observedTools(result);

  for (const tool of forbidden) {
    expect(tools.has(tool)).toBe(false);
  }
}

describe('AI 開放式自然語言覆蓋', () => {
  beforeEach(() => {
    resetAdaptiveLearnedPatternsForTests();
    setDataSource(mockSource as any);
  });

  it('does not force general life, career, writing, or shopping prompts into campus tools', async () => {
    const broadPrompts = [
      '我想跟主管談加薪，幫我整理一個不尷尬的開場白',
      '這段英文 email 聽起來太硬，幫我改得自然一點',
      '我想買筆電但預算有限，怎麼比較規格才不會被話術帶走',
      '租屋合約看起來怪怪的，先提醒我可能要注意什麼',
      '我明天要面試，幫我模擬三題追問',
      '我想寫一個 JS 小遊戲，先幫我拆功能',
      '朋友生日快到但我預算不高，禮物怎麼挑',
      '我想跟室友談清潔分工，但怕講了變吵架',
      '我想開始運動但很容易放棄，幫我設計低門檻版本',
      '幫我把一個模糊的創業點子拆成可驗證假設',
      '我要向客服反映問題，但不想語氣太兇',
      '想做個簡單網站放作品，先幫我想頁面架構',
    ];

    for (const prompt of broadPrompts) {
      await expectNoTools(prompt, [
        'create_order',
        'send_message',
        'create_calendar_event',
        'query_courses',
        'query_assignments',
        'query_menus',
        'query_conversations',
      ]);
    }
  });

  it('keeps social-advice phrasing separate from actual messaging/conversation lookup', async () => {
    await expectNoTools('如果朋友一直已讀不回，我要怎麼講才不尷尬？', [
      'query_conversations',
      'send_message',
      'mark_notifications_read',
    ]);

    const directMessage = await autonomousQuery('幫我私訊阿銘跟他說錢還你了不要再已讀不回', CTX);
    expect(observedTools(directMessage).has('send_message')).toBe(true);
  });

  it('does not treat home-cooking dinner talk as campus menu browsing or ordering', async () => {
    await expectNoTools('今天晚餐想自己煮，冰箱只有蛋跟青菜，幫我想一下怎麼配', [
      'query_menus',
      'recommend_lunch',
      'create_order',
    ]);

    const campusFood = await autonomousQuery('今天晚餐學餐有沒有素的', CTX);
    const tools = observedTools(campusFood);
    expect(tools.has('query_menus') || tools.has('recommend_lunch')).toBe(true);
  });

  it('does not treat tool-boundary wording as a real order action', async () => {
    const boundaryPrompts = [
      '如果只是買東西建議，不要誤判成訂餐',
      '沒有明確餐點或數量不要下單，先問我缺什麼',
      '如果只是晚餐靈感，不要直接查學餐或點餐',
      '這只是代理流程訓練：沒有確認品項不能下單',
    ];

    for (const prompt of boundaryPrompts) {
      await expectNoTools(prompt, [
        'create_order',
        'cancel_order',
        'query_menus',
        'recommend_lunch',
      ]);
    }
  });

  it('does not treat messaging or notification boundary wording as real actions', async () => {
    await expectNoTools('先給草稿，不要幫我真的送出，也不要誤判成站內訊息', [
      'send_message',
      'query_conversations',
    ]);

    await expectNoTools('如果只是提到通知，不要直接標成已讀', [
      'mark_notifications_read',
    ]);
  });

  it('handles unsupported external actions as advice rather than fake execution', async () => {
    await expectNoTools('幫我打電話給房東催他修水管，不能打的話先給我講稿', [
      'send_message',
      'create_calendar_event',
      'create_order',
      'mark_notifications_read',
    ]);

    await expectNoTools('幫我打電話給房東下週催修水管，不能打就先列講稿和我要確認的資料', [
      'send_message',
      'create_calendar_event',
      'create_order',
    ]);

    await expectNoTools('幫我登入銀行轉帳給同學，但沒有權限就列出我自己操作步驟', [
      'send_message',
      'create_order',
      'mark_notifications_read',
    ]);

    await expectNoTools('幫我訂機票但我還沒給日期，不能訂就先列我要準備哪些資訊', [
      'create_order',
      'cancel_order',
      'query_menus',
      'recommend_lunch',
    ]);

    await expectNoTools('幫我叫車去高鐵站，不能操作外部 APP 就給我自己叫車的檢查清單', [
      'create_order',
      'create_calendar_event',
      'send_message',
    ]);

    await expectNoTools('幫我操作 LINE 回覆家人，不能做就先幫我擬訊息草稿', [
      'send_message',
      'query_conversations',
    ]);
  });
});
