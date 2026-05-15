import {
  buildBroadNaturalLanguageRuntimeGuide,
  generateDynamicNaturalLanguagePrompt,
  summarizeAgentProcessTrace,
} from '../../services/aiDynamicTraining';
import type { AgentQueryResult } from '../../services/aiLocalAgent';

describe('aiDynamicTraining', () => {
  it('generates varied broad natural-language prompts from seed and index', () => {
    const prompts = Array.from({ length: 40 }, (_, i) =>
      generateDynamicNaturalLanguagePrompt(12345, i),
    );

    expect(new Set(prompts).size).toBeGreaterThan(30);
    expect(prompts.some((p) => /主管|email|租屋|面試|作品集|客服|創業/.test(p))).toBe(true);
    expect(prompts.some((p) => /課表|作業|成績|圖書館|宿舍|校車/.test(p))).toBe(true);
    expect(prompts.some((p) => /打電話|銀行|轉帳|機票|IG|叫車|外部/.test(p))).toBe(true);
    const agentAwarePrompts = prompts.filter((p) =>
      /先|工具|追問|寫入|草稿|步驟|處理|判斷|執行|查資料|缺什麼|送出|最急/.test(p),
    );
    expect(agentAwarePrompts.length).toBeGreaterThan(30);
  });

  it('summarizes the full agent process, not only the final tool', () => {
    const result: AgentQueryResult = {
      intents: [{ tool: 'send_message', args: {}, priority: 10, reason: '發送訊息' }],
      results: [{ tool: 'query_conversations', reason: '前置查詢', result: { success: true } }],
      executedActions: [
        { tool: 'send_message', reason: '發送訊息', result: { success: true, summary: '已送出' } },
      ],
      failedActions: [{ tool: 'create_order', reason: '訂餐', missingInfo: '缺少餐點' }],
      pendingWriteActions: [],
      contextText: 'context',
      totalTimeMs: 42,
    };

    const summary = summarizeAgentProcessTrace(result);
    expect(summary).toContain('意圖=send_message');
    expect(summary).toContain('讀取=query_conversations:ok');
    expect(summary).toContain('寫入=send_message:ok');
    expect(summary).toContain('缺口=create_order:缺少餐點');
  });

  it('provides runtime guidance that prevents forcing broad chat into campus tools', () => {
    const guide = buildBroadNaturalLanguageRuntimeGuide();
    expect(guide).toContain('不一定只聊校園');
    expect(guide).toContain('不要因為句子含');
    expect(guide).toContain('代理流程');
    expect(guide).toContain('寫入型動作');
    expect(guide).toContain('能力外問題');
  });
});
