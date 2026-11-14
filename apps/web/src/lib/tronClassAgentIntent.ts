import type { TronClassAgentIntent } from './tronClassAgentTypes';

export type TronClassAgentQueryIntent = {
  intent: TronClassAgentIntent;
  pendingOnly: boolean;
  unsupportedReason?: 'multiple_actions';
};

/**
 * This router sees only the user's current message. Course descriptions, notices,
 * history and model output must never be passed to it as commands.
 */
export function parseTronClassAgentIntent(question: string): TronClassAgentQueryIntent | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 1000 ||
    !/(?:\btron\s*class\b|創課|玩課雲)/i.test(question)) return null;
  const original = question.trim();
  // Examples, translations and general explanations do not authorize a private read.
  if (/(?:翻譯|翻成|translate|改寫|潤飾|rewrite|舉例|例句|範例|示範|字串|這句|這段|什麼意思|意思是什麼|怎麼|如何|教我|說明一下|\bhow\s+(?:to|do|can)|\bwhat\s+(?:is|does)|\bexample)/i.test(original) ||
    /^[「『“"'][\s\S]*[」』”"']$/.test(original) ||
    /(?:不要|別|不准|禁止|無須|不用|不需要|do\s+not|don't|never)\s*.{0,80}(?:讀取|查詢|查看|查|列出|下載|準備|代理|read|fetch|download)/i.test(original)) return null;
  // "查未交作業，不要繳交" authorizes a read, not a write. Strip only
  // explicitly negated write clauses before evaluating the positive command.
  const text = original.replace(/(?:不要|別|不准|禁止|無須|不用|不需要|do\s+not|don't|never)\s*(?:幫我|替我|代我|自動|直接)?\s*(?:繳交|提交|送出|上傳|發[佈布文]|回[覆復]|留言|刪除|撤回|submit|upload|delete|post|reply)[^，。；,;]*/gi, '');
  if (/(?:能做什麼|可以做什麼|有哪些功能|支援什麼|支援哪些|功能範圍|代理權限|what\s+can|capabilit)/i.test(text)) {
    return { intent: 'capabilities', pendingOnly: false };
  }
  const pendingOnly = /(?:未交|未繳|待交|待繳|待提交|尚未(?:交|繳|提交)|還沒(?:交|繳|提交)|沒(?:交|繳)|pending|unsubmitted|not\s+submitted)/i.test(text);
  const operationText = text.replace(/(?:尚未|還沒|未|沒|待|已)(?:繳交|提交|交|繳)|not\s+submitted|unsubmitted/gi, '待辦');
  const preparation = /(?:準備|預覽|草稿|起草|prepare|draft)/i.test(text) && /(?:作業|homework|assignment)/i.test(text);
  if (preparation && /(?:下載|download)/i.test(text)) return { intent: 'unsupported', pendingOnly: false, unsupportedReason: 'multiple_actions' };
  const chainedWrite = /(?:並|再|然後|直接|自動|順便|同時|and|then).{0,25}(?:繳交|提交|送出|上傳|submit|upload)/i.test(operationText);
  if (preparation && !chainedWrite) return { intent: 'prepare', pendingOnly };
  const explicitWrite = /(?:幫我|替我|代我|請|直接|自動)\s*(?:把|將)?\s*(?:繳交|提交|送出|交出|交作業|上傳|發[佈布文]|回[覆復]|留言|刪除|撤回|填答|評分|簽到|簽退|點名)|(?:submit|upload|delete|post|reply|withdraw)\b/i.test(operationText);
  if (explicitWrite || chainedWrite || /(?:發[佈布文]|回[覆復]|留言|刪除|撤回|退選|選課|填答|評分|測驗|考試|問卷|簽到|簽退|點名)/.test(text)) {
    return { intent: 'unsupported', pendingOnly: false };
  }
  if (/(?:繳交|提交|送出|上傳)/.test(operationText) && !/(?:狀態|紀錄|記錄|情況|有哪些|是否|有沒有)/.test(text)) {
    return { intent: 'unsupported', pendingOnly: false };
  }
  if (/(?:下載|download)/i.test(text)) return { intent: 'download', pendingOnly: false };
  if (pendingOnly) return { intent: 'homework', pendingOnly: true };
  if (/(?:作業|homework|assignments?)/i.test(text)) return { intent: 'homework', pendingOnly: false };
  if (/(?:公告|通知|announcements?|notices?)/i.test(text)) return { intent: 'announcements', pendingOnly: false };
  if (/(?:教材|講義|檔案|附件|materials?|handouts?|files?)/i.test(text)) return { intent: 'materials', pendingOnly: false };
  if (/(?:課程|修課|課表|courses?|classes)/i.test(text)) return { intent: 'courses', pendingOnly: false };
  return { intent: 'capabilities', pendingOnly: false };
}

export function canAnswerTronClassQuestion(question: string): boolean {
  return parseTronClassAgentIntent(question) !== null;
}
