/**
 * 本機助理「監督」：偵測明顯不合規回答，觸發同一輪內自動重生成（不依賴雲端）。
 */

import type { LLMMessage } from './localLLMInference';
import type { AgentQueryResult } from './aiLocalAgent';

export type ReplyQualityIssue = {
  ok: boolean;
  reasons: string[];
};

/** 宣稱已完成寫入／送出類動作，但本輪沒有任何成功寫入工具結果時視為高風險幻覺 */
const FABRICATED_WRITE_RE =
  /已(?:經)?(?:幫你|為您|替你)?(?:完成|成功|處理|搞定)|已成功|已(?:繳交|送出|上傳|預約|報修|退選|請假|下單|訂餐)|幫你(?:繳交|預約|報修|請假|退選|訂)|為您(?:繳交|預約|報修)/;

function cjkRatio(text: string): number {
  if (!text.trim()) return 0;
  const cjk = (text.match(/[\u3400-\u9FFF]/g) ?? []).length;
  return cjk / text.length;
}

function toolBackedWriteOk(agentResult: AgentQueryResult | null, supplementalSuccessfulWrite?: boolean): boolean {
  const base = !!(agentResult?.executedActions ?? []).some((a) => a.result.success && a.result.isWrite);
  return base || !!supplementalSuccessfulWrite;
}

function excessiveRepeatedSentence(text: string): boolean {
  const parts = text.split(/[。！？\n]+/).map((s) => s.trim()).filter((s) => s.length >= 10);
  const seen = new Map<string, number>();
  for (const p of parts) {
    const key = p.slice(0, 48);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if ((seen.get(key) ?? 0) >= 3) return true;
  }
  return false;
}

export function evaluateAssistantReplyQuality(params: {
  reply: string;
  userQuestion: string;
  agentResult: AgentQueryResult | null;
  /** 模型 [EXECUTE:] 補跑後若有成功寫入，可放行「已完成」類措辭 */
  supplementalSuccessfulWrite?: boolean;
}): ReplyQualityIssue {
  const reasons: string[] = [];
  const reply = params.reply.trim();
  const uq = params.userQuestion.trim();

  const writeOk = toolBackedWriteOk(params.agentResult, params.supplementalSuccessfulWrite);

  if (uq.length < 4) {
    return { ok: true, reasons: [] };
  }

  if (reply.length === 0) {
    reasons.push('空白回答');
  } else if (reply.length < 10 && uq.length > 24) {
    reasons.push('回答過短，疑未處理問題');
  }

  if (FABRICATED_WRITE_RE.test(reply) && !writeOk) {
    reasons.push('宣稱已完成預約／繳交／報修等寫入動作，但本輪沒有成功的寫入工具紀錄');
  }

  // 使用者明顯中文追問，長回答卻幾乎無中文 → 常為模型跑偏或英文 junk
  if (uq.length > 12 && cjkRatio(uq) > 0.2 && reply.length > 35 && cjkRatio(reply) < 0.06) {
    reasons.push('使用者以中文為主，回答幾乎無中文');
  }

  if (excessiveRepeatedSentence(reply)) {
    reasons.push('同一語句重複過多次');
  }

  // 殘留未解析的工具標記（模型抄格式但未走工具）
  if (/\[EXECUTE:/i.test(reply) || /\[TOOL_RESULT\]/i.test(reply)) {
    reasons.push('回答中含有未處理的工具標記語法');
  }

  return { ok: reasons.length === 0, reasons };
}

/** 以「監督員 user」接續上一則 assistant 草稿，要求模型輸出修正版（仍在本輪對話內）。 */
export function buildSupervisorRetryMessages(
  baseMessages: LLMMessage[],
  draftAssistantReply: string,
  reasons: string[],
  userQuestion: string,
): LLMMessage[] {
  const hint =
    `【監督校正】上一則助理草稿未通過檢查：${reasons.join('；')}。\n` +
    `請重新回答使用者問題：務必繁體中文；若無 App／工具資料請直說並給建議選項；` +
    `未經確認不得宣稱已完成繳交、預約、報修、退選、請假、訂餐等寫入。\n` +
    `使用者原問：${userQuestion}`;

  return [
    ...baseMessages,
    { role: 'assistant', content: draftAssistantReply },
    { role: 'user', content: hint },
  ];
}
