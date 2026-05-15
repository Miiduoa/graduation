import { evaluateAssistantReplyQuality } from '../services/assistantReplySupervisor';

describe('evaluateAssistantReplyQuality', () => {
  it('flags fabricated completion without write tool success', () => {
    const q = evaluateAssistantReplyQuality({
      reply: '已幫你成功繳交作業，請放心。',
      userQuestion: '幫我交程式設計作業',
      agentResult: {
        intents: [],
        results: [],
        totalTimeMs: 0,
        contextText: '',
        executedActions: [],
        failedActions: [],
        pendingWriteActions: [],
      },
    });
    expect(q.ok).toBe(false);
    expect(q.reasons.some((r) => /寫入工具紀錄/.test(r))).toBe(true);
  });

  it('allows completion wording after supplemental successful write', () => {
    const q = evaluateAssistantReplyQuality({
      reply: '已幫你完成繳交。',
      userQuestion: '交作業',
      agentResult: null,
      supplementalSuccessfulWrite: true,
    });
    expect(q.ok).toBe(true);
  });

  it('skips strict checks for very short user message', () => {
    const q = evaluateAssistantReplyQuality({
      reply: '',
      userQuestion: 'ok',
      agentResult: null,
    });
    expect(q.ok).toBe(true);
  });
});
