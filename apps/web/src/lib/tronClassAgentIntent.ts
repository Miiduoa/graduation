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
 * 單一子句才由 TronClass Agent 直接回答。切成兩個以上子句時，整句仍交給原本的
 * 跨服務規劃，其中的玩課雲子句另由 tronClassCompoundClauses 交給 Agent 補充回答。
 */
function isMultiClauseRequest(question: string): boolean {
  const clauses = question.normalize('NFKC').split(CLAUSE_SEPARATOR).map(part => part.trim()).filter(Boolean);
  return clauses.length >= 2;
}

const TRONCLASS_KEYWORD = /(?:\btron\s*class\b|創課|玩課雲)/i;
// A clause without its own TronClass keyword continues the TronClass request only
// when it names TronClass data and nothing that belongs to another service.
const TRONCLASS_CONTINUATION = /(?:作業|教材|講義|附件|檔案|未交|未繳|待交|待繳|還沒交|還沒繳|沒交|沒繳|homework|assignments?|materials?|handouts?)/i;
const OTHER_SERVICE_OR_SCHEDULE = /(?:頁面|畫面|入口|校園|學校|系上|社團|公車|交通|課表|成績|行事曆|日曆|空堂|時段|安排|排程|提醒|設定|失物|餐|活動|地圖|教室|今天|明天|後天|早上|上午|中午|下午|晚上|分鐘|小時|\d{1,2}\s*[:：點])/u;
const NEGATION_SOURCE = "不要|別|勿|不准|禁止|無須|不用|不需要|\\b(?:do\\s+not|don't|never)\\b";
const NEGATED = new RegExp(NEGATION_SOURCE, 'i');
const NEGATIONS = new RegExp(NEGATION_SOURCE, 'gi');
const MAX_COMPOUND_TRONCLASS_CLAUSES = 3;
const SUBMIT_VERB_SOURCE = '繳交|提交|送出|交出|交作業|上傳|上載|\\b(?:submit|upload)\\b|[交繳](?=了沒)';
const OTHER_WRITE_VERB_SOURCE = '發[佈布文]|回[覆復]|留言|刪除|撤回|填答|評分|簽到|簽退|點名|退選|選課|\\b(?:delete|post|reply|withdraw)\\b';
const WRITE_VERB = new RegExp(`(${SUBMIT_VERB_SOURCE})|${OTHER_WRITE_VERB_SOURCE}`, 'giu');
const WRITE_NEGATION_SOURCE = `(?:${NEGATION_SOURCE})\\s*(?:(?:幫我|替我|代我|自動|直接)\\s*)*`;
const WRITE_NEGATION = new RegExp(`${WRITE_NEGATION_SOURCE}$`, 'iu');
const NEGATED_WRITE_SOURCE = `${WRITE_NEGATION_SOURCE}(?:${SUBMIT_VERB_SOURCE}|${OTHER_WRITE_VERB_SOURCE})`;
const NEGATED_WRITE_START = new RegExp(NEGATED_WRITE_SOURCE, 'giu');
const STARTS_NEGATED_WRITE = new RegExp(`^${NEGATED_WRITE_SOURCE}`, 'iu');
// Read routing excludes the object of a negated write so it cannot select a read tool.
const READ_ACTION_BOUNDARY = new RegExp(
  `${CLAUSE_SEPARATOR.source}|並|再|而且|[:：\\r\\n]|\\b(?:and|then|also)\\b`, 'iu',
);
function readRoutingText(text: string): string {
  let result = '';
  let start = 0;
  for (const match of text.matchAll(NEGATED_WRITE_START)) {
    if (match.index < start) continue;
    const end = match.index + match[0].length;
    const boundary = text.slice(end).search(READ_ACTION_BOUNDARY);
    result += text.slice(start, match.index) + ' ';
    start = boundary < 0 ? text.length : end + boundary;
  }
  return result + text.slice(start);
}
const WRITE_CUE = /(?:記得|立即|馬上|再|然後|接著|接下來|之後|後|請|幫我|替我|代我|直接|自動|順便|同時|並|\b(?:please|then|immediately))\s*$/iu;
const STATUS_PREFIX = /(?:(?:是否|有沒有|有無|有哪些|哪些)\s*(?:已經|已|有)?\s*|尚未|還沒|未|沒|待|已經|已)$/u;
const STATUS_SUFFIX = /^(?:了沒|(?:過的?|了的?|的|之)?\s*(?:狀態|紀錄|記錄|情況|歷史|有哪些))/u;
const WRITE_OBJECT = /^\s*(?:報告|檔|文件|版|附件|作業|report\b|files?\b|documents?\b|versions?\b|attachments?\b|assignments?\b|homework\b)/iu;

// An ASCII apostrophe between letters is an English contraction, not a quote.
const QUOTE = /[「」『』“”‘’"`]|(?<![A-Za-z])'|'(?![A-Za-z])/u;

/** Classify each occurrence using its own context in the original request. */
function hasWriteCommand(text: string): boolean {
  for (const match of text.matchAll(WRITE_VERB)) {
    const before = text.slice(0, match.index);
    if (WRITE_NEGATION.test(before)) continue;
    if (!match[1] || WRITE_CUE.test(before)) return true;

    const after = text.slice(match.index + match[0].length);
    const statusSuffix = after.match(STATUS_SUFFIX);
    const statusPrefix = before.match(STATUS_PREFIX);
    const object = after.slice(statusSuffix?.[0].length ?? 0);
    if ((!statusPrefix && !statusSuffix) || WRITE_OBJECT.test(object) ||
      (statusPrefix && WRITE_CUE.test(before.slice(0, statusPrefix.index)))) return true;
  }
  return false;
}

/** Examples, translations, quotes, general explanations and negated reads do not authorize a private read. */
function authorizesPrivateRead(original: string): boolean {
  for (const match of original.matchAll(NEGATIONS)) {
    const rest = original.slice(match.index);
    if (!STARTS_NEGATED_WRITE.test(rest) &&
      /^.{0,80}(?:讀取|查詢|查看|查|列出|下載|準備|代理|read|fetch|download)/i.test(rest)) return false;
  }
  return !(/(?:翻譯|翻成|translate|改寫|潤飾|rewrite|舉例|例句|範例|示範|字串|這句|這段|什麼意思|意思是什麼|怎麼|如何|教我|說明一下|\bhow\s+(?:to|do|can)|\bwhat\s+(?:is|does)|\bexample)/i.test(original) ||
    /^[「『“"'][\s\S]*[」』”"']$/.test(original));
}

/**
 * Splitting a request must not drop context that covers the whole sentence:
 * a translation, quote, explanation or negated read anywhere keeps every clause
 * out of the private read, and a requested write anywhere keeps the request with
 * the original planner instead of reading beside an unhandled write.
 */
function wholeRequestAllowsCompoundRead(question: string): boolean {
  const original = question.normalize('NFKC').trim();
  // Quoted text anywhere may be split apart, so no clause can be trusted as a command.
  return !QUOTE.test(original) && !hasWriteCommand(original) &&
    authorizesPrivateRead(original);
}

/**
 * For a multi-clause request, list the clauses the TronClass Agent should also
 * answer. The whole request still goes to the original cross-service planning
 * unchanged, so nothing it plans (navigation, calendar blocks, bus, notices…)
 * is lost; these clauses only add the private TronClass read beside it.
 * Explicit navigation stays with the planner, and a clause is never rewritten
 * into a write or a schedule.
 */
export function tronClassCompoundClauses(question: string): string[] {
  if (typeof question !== 'string' || !question.trim() || question.length > 1000 ||
    !TRONCLASS_KEYWORD.test(question) || !isMultiClauseRequest(question) ||
    tronClassExplicitNavigationQuestion(question) || !wholeRequestAllowsCompoundRead(question)) return [];
  const clauses = question.normalize('NFKC').split(CLAUSE_SEPARATOR).map(part => part.trim()).filter(Boolean);
  const result: string[] = [];
  const seen = new Set<string>();
  let context = false;
  for (const clause of clauses) {
    let candidate: string | null = null;
    if (TRONCLASS_KEYWORD.test(clause)) {
      context = true;
      candidate = clause;
    } else if (context && TRONCLASS_CONTINUATION.test(clause) && !OTHER_SERVICE_OR_SCHEDULE.test(clause) && !NEGATED.test(clause)) {
      candidate = `玩課雲${clause}`;
    }
    if (!candidate || OTHER_SERVICE_OR_SCHEDULE.test(candidate.replace(TRONCLASS_KEYWORD, ''))) continue;
    const bare = candidate.replace(/[?!.。]+$/u, '').trim();
    if (tronClassExplicitNavigationQuestion(candidate) || isTronClassNavigationTarget(bare) ||
      isTronClassNavigationTarget(bare.replace(/^(?:(?:請|麻煩)?(?:幫我|替我)?(?:開啟|打開|開|前往|進入))\s*/u, ''))) continue;
    const parsed = parseTronClassAgentIntent(candidate);
    if (!parsed || parsed.intent === 'capabilities') continue;
    const key = `${parsed.intent}:${parsed.pendingOnly}:${parsed.unsupportedReason ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
    if (result.length >= MAX_COMPOUND_TRONCLASS_CLAUSES) break;
  }
  return result;
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
    !TRONCLASS_KEYWORD.test(question)) return null;
  const original = question.normalize('NFKC').trim();
  if (isExistingTronClassNavigation(original)) return null;
  const hasWrite = hasWriteCommand(original);
  if (!authorizesPrivateRead(original)) return null;
  if (isMultiClauseRequest(original)) return null;
  if (hasWrite) return { intent: 'unsupported', pendingOnly: false };
  const text = readRoutingText(original);
  if (/(?:能做什麼|可以做什麼|有哪些功能|支援什麼|支援哪些|功能範圍|代理權限|what\s+can|capabilit)/i.test(text)) {
    return { intent: 'capabilities', pendingOnly: false };
  }
  const pendingOnly = /(?:未交|未繳|待交|待繳|待提交|尚未(?:交|繳|提交)|還沒(?:交|繳|提交)|沒(?:交|繳)|pending|unsubmitted|not\s+submitted)/i.test(text);
  const preparation = /(?:準備|預覽|草稿|起草|prepare|draft)/i.test(text) && /(?:作業|homework|assignment)/i.test(text);
  if (preparation && /(?:下載|download)/i.test(text)) return { intent: 'unsupported', pendingOnly: false, unsupportedReason: 'multiple_actions' };
  if (preparation) return { intent: 'prepare', pendingOnly };
  if (/(?:測驗|考試|問卷)/.test(text)) return { intent: 'unsupported', pendingOnly: false };
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
