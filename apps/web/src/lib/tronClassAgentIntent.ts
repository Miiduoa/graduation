import { resolveAssistantServiceIntent } from '@campus/shared/src/assistantServices';
import type { TronClassAgentIntent } from './tronClassAgentTypes';

export function isTronClassNavigationTarget(text: string): boolean {
  return /^(?:玩課雲|tronclass)(?:作業|課程)?$/i.test(text);
}

function isExistingTronClassNavigation(question: string): boolean {
  const intent = resolveAssistantServiceIntent(question);
  return intent?.kind === 'open' && (intent.service.id === 'school-lms' || intent.service.id === 'school-courses');
}

export function tronClassExplicitNavigationQuestion(question: string): string | null {
  if (isExistingTronClassNavigation(question)) return question;
  if (question.length > 160 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(question)) return null;
  const text = question.normalize('NFKC').trim().replace(/[?!.。]+$/u, '').trim();
  // Match the entire page name so a command followed by a data question stays with the Agent.
  const shortcut = text.replace(/(?:,\s*)?(?:好嗎|可以嗎|嗎|吧|謝謝)$/u, '').trim();
  if (/^(?:(?:請|麻煩)?\s*(?:幫我|替我|我要|我想)?\s*(?:開啟|打開|開|前往|進入)\s*|(?:please )?(?:open|go to)\s+)(?:玩課雲|tron\s*class)(?:\s*(?:作業(?:與教材)?|課程))?\s*(?:頁面|畫面|入口|頁|page|screen)?$/iu.test(shortcut)) {
    return '開啟玩課雲作業';
  }
  return null;
}

export function tronClassDisabledNavigationQuestion(question: string): string | null {
  const intent = resolveAssistantServiceIntent(question);
  if (intent?.kind === 'open' && intent.service.id === 'school-lms') return question;
  const text = question.normalize('NFKC').trim().replace(/[?!.。]+$/u, '').trim();
  // Preserve the disabled integration's existing shortcuts and colloquial open command.
  if (isTronClassNavigationTarget(text.replace(/^(?:(?:請|麻煩)?(?:幫我|替我)?(?:開啟|打開|開|前往|進入))\s*/u, ''))) {
    return '開啟玩課雲作業';
}
  return null;
}

// 與跨服務規劃相同的分隔詞（含「和／與」），確保兩邊切句一致。
const CLAUSE_SEPARATOR = /(?:然後|接著|順便|並且|另外|同時|以及|也幫我|再幫我|並幫我|[，,；;。！!？?、和與])+/u;

/**
 * 只攔截單個子句。只要以跨服務規劃相同的分隔詞切成兩個以上子句，
 * 就整句交還原本的規劃，不由 TronClass Agent 攔截，行為與 merge-base 相同。
 */
function isMultiClauseRequest(question: string): boolean {
  const clauses = question.normalize('NFKC').split(CLAUSE_SEPARATOR).map(part => part.trim()).filter(Boolean);
  return clauses.length >= 2;
}

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
  if (isExistingTronClassNavigation(original)) return null;
  if (isMultiClauseRequest(original)) return null;
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
