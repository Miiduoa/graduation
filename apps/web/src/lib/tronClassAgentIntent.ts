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
const CLAUSE_SEPARATOR = /(?:然後|接著|順便|並且|另外|同時|以及|也幫我|再幫我|並幫我|(?<![最之])後|[，,；;。！!？?、和與])+/u;

/**
 * 單一子句才由 TronClass Agent 直接回答。切成兩個以上子句時，整句仍交給原本的
 * 跨服務規劃，其中的玩課雲子句另由 tronClassCompoundClauses 交給 Agent 補充回答。
 */
function isMultiClauseRequest(question: string): boolean {
  return splitClauses(textWithoutQuotedSpans(question.normalize('NFKC'))).length >= 2;
}

const TRONCLASS_KEYWORD = /(?:\btron\s*class\b|創課|玩課雲)/i;
const LMS_SOURCE = '(?:玩課雲|創課|tron\\s*class)';
// A clause without its own TronClass keyword continues the TronClass request only
// when it names TronClass data and nothing that belongs to another service.
const TRONCLASS_CONTINUATION = /(?:作業|教材|講義|附件|檔案|未交|未繳|待交|待繳|還沒交|還沒繳|沒交|沒繳|homework|assignments?|materials?|handouts?)/i;
const OTHER_SERVICE_OR_SCHEDULE = /(?:頁面|畫面|入口|校園|學校|系上|社團|公車|交通|課表|成績|行事曆|日曆|空堂|時段|安排|排程|提醒|設定|失物|餐|活動|地圖|教室|今天|明天|後天|早上|上午|中午|下午|晚上|分鐘|小時|\d{1,2}\s*[:：點])/u;
const NEGATION_SOURCE = "不要|別|勿|不准|禁止|無須|不用|不需要|\\b(?:do\\s+not|don't|never)\\b";
const NEGATED = new RegExp(NEGATION_SOURCE, 'i');
const NEGATIONS = new RegExp(NEGATION_SOURCE, 'gi');
const MAX_COMPOUND_TRONCLASS_CLAUSES = 3;
const PLACEMENT_VERB_SOURCE = '放[入到進上]|貼[上到入]|丟[到給入]|塞[入進到]|投[入進到]|搬[到去]';
const SUBMIT_VERB_SOURCE = [
  '重新(?:繳交|提交|上傳|上載)|繳交|提交|送出|交出|上傳|上載',
  '補交|補繳|遲交|重交|重繳|上繳|遞交|呈交|交付|繳回|交回|附上|夾帶|送件|寄出',
  // Object may come before the verb, as in「把附件回傳／傳給老師」.
  '回傳|傳給|傳到|傳回|傳送|傳去|送給|送到|寄給|寄到|遞給|遞到|轉給|轉到|轉寄',
  PLACEMENT_VERB_SOURCE,
  '\\b(?:submit|upload|resubmit|hand\\s+in|turn\\s+in|send\\s+(?:in|to|back)|forward)\\b',
  // Short verbs also form commands with a preceding object or no object.
  '[交繳]',
].join('|');
const OTHER_WRITE_VERB_SOURCE = '發[佈布文]|回[覆復]|留言|刪除|撤回|填答|評分|簽到|簽退|點名|退選|選課|\\b(?:delete|post|reply|withdraw)\\b';
const WRITE_VERB = new RegExp(`(${SUBMIT_VERB_SOURCE})|${OTHER_WRITE_VERB_SOURCE}`, 'giu');
const WRITE_NEGATION_SOURCE = `(?:${NEGATION_SOURCE})\\s*(?:(?:幫我|替我|代我|自動|直接)\\s*)*`;
const WRITE_NEGATION = new RegExp(`${WRITE_NEGATION_SOURCE}$`, 'iu');
// 把／將 may place the object before the verb:「不要把玩課雲作業貼上」.
const NEGATED_BA_FILL = '(?:(?:把|將)\\s*(?:(?![，,；;。！!？?\\r\\n]|然後|接著|接下來|順便|並且|另外|同時).){0,40}?)?';
const NEGATED_WRITE_SOURCE = `${WRITE_NEGATION_SOURCE}${NEGATED_BA_FILL}(?:${SUBMIT_VERB_SOURCE}|${OTHER_WRITE_VERB_SOURCE})`;
const NEGATED_WRITE_START = new RegExp(NEGATED_WRITE_SOURCE, 'giu');
const STARTS_NEGATED_WRITE = new RegExp(`^${NEGATED_WRITE_SOURCE}`, 'iu');
const NOUN_COMPOUNDS = [
  '交通資訊', '交通', '交流', '交換', '交易', '交際', '交響', '交友', '交集', '交往',
  '交界', '交替', '交錯', '交叉', '交會', '交織', '交情', '交遊', '交涉', '交戰',
  '交鋒', '交口', '交加', '交匯', '交管', '交白',
  '調查',
];
const QUERY_VERBS = [
  '告訴我', '查詢', '查看', '顯示', '列出', '確認', '查一下', '看一下', '讀一下',
  '讀取', '調閱', '瀏覽', '檢視', '下載', '準備', '代理', '查', '看', '讀', '閱',
  'read', 'fetch', 'download', 'prepare',
];
const QUERY_COMPOUNDS = QUERY_VERBS.filter(value => value.length > 1);
const QUERY_START = new Set(QUERY_VERBS);
const NEGATED_QUERY_VERBS = [...QUERY_VERBS].sort((a, b) => b.length - a.length);
const ACTION_CUES = ['只要', '只', '改成', '改查', '而是'];
const CLAUSE_CUES = ['然後', '接著', '順便', '並且', '另外', '同時', '也幫我', '再幫我', '並幫我'];
const FUNCTION_CUES = [
  '幫我', '替我', '代我', '幫忙', '請', '麻煩', '直接', '自動',
  '不要', '不用', '不需要', '無須', '不准', '禁止', '別', '勿',
  '我們', '你們', '他們', '她們', '我', '你', '您', '他', '她', '它',
  '尚未', '還沒', '未', '待', '已經', '已', '沒',
  '剛才', '剛剛', '剛', '最後', '之後', '後', '曾經', '所', '過', '了',
  '正在', '正', '供',
  '務必', '一定', '趕緊', '立刻', '馬上', '盡快', '快',
  '去', '來', '再', '也', '又', '都', '就', '才', '還', '先', '並', '且', '跟', '而',
  '想', '要', '能', '可以', '可', '會',
];
const DOMAIN_NOUNS = [
  '作業', '報告', '附件', '檔案', '作品', '心得', '講義', '考卷', '表單',
  '公告', '通知', '教材', '課程', '課表', '修訂稿', '舊版', '新版', '這份', '那份',
  '發布時間', '發佈時間', '發文時間', '發布日期', '發佈日期', '發文日期',
  '作業準備區', '作業準備', '準備區', '下載區', '下載說明',
  '後面', '後來', '後續', '後方', '後段', '後期', '後天', '後台', '後端', '後排', '後座',
  '及時', '及格', '及第', '及至', '及早', '及其',
];
const CONJ_CUES = ['以及', '和', '與', '及', '、'];
const WRITE_COMPOUNDS = [
  '重新繳交', '重新提交', '重新上傳', '重新上載', '繳交', '提交', '送出', '交出', '上傳', '上載',
  '補交', '補繳', '遲交', '重交', '重繳', '上繳', '遞交', '呈交', '交付', '繳回', '交回',
  '轉交', '代交', '面交', '附上', '夾帶', '送件', '寄出', '回傳', '傳給', '傳到', '傳回',
  '傳送', '傳去', '送給', '送到', '寄給', '寄到', '遞給', '遞到', '轉給', '轉到', '轉寄',
  '放入', '放到', '放進', '放上', '貼上', '貼到', '丟到', '塞進', '投入', '搬到',
];
const WRITE_COMPOUND_SET = new Set(WRITE_COMPOUNDS);
const PREPARE_ACTIONS = new Set(['準備', '預覽', '草稿', '起草', 'prepare', 'draft']);
const DOWNLOAD_ACTIONS = new Set(['下載', 'download']);
const HAN_CHAR = /[\p{Script=Han}]/u;

type TokenKind = 'noun' | 'query' | 'cue' | 'conj' | 'punct' | 'other';
type Token = { value: string; start: number; end: number; kind: TokenKind };

const LEXICON: { value: string; kind: TokenKind }[] = [
  ...WRITE_COMPOUNDS.map(value => ({ value, kind: 'other' as const })),
  ...DOMAIN_NOUNS.map(value => ({ value, kind: 'noun' as const })),
  ...NOUN_COMPOUNDS.map(value => ({ value, kind: 'noun' as const })),
  ...QUERY_COMPOUNDS.map(value => ({ value, kind: 'query' as const })),
  ...ACTION_CUES.map(value => ({ value, kind: 'cue' as const })),
  ...CLAUSE_CUES.map(value => ({ value, kind: 'cue' as const })),
  ...FUNCTION_CUES.map(value => ({ value, kind: 'cue' as const })),
  ...CONJ_CUES.map(value => ({ value, kind: 'conj' as const })),
].sort((a, b) => b.value.length - a.value.length);

function startsKnownQuery(text: string, index: number): boolean {
  return QUERY_COMPOUNDS.some(value => text.startsWith(value, index));
}

function startsKnownWrite(text: string, index: number): boolean {
  return WRITE_COMPOUNDS.some(value => text.startsWith(value, index));
}

const CLAUSE_BOUNDARY_WORDS = new Set<string>([...CLAUSE_CUES, '以及', '和', '與', '及', '後', '、']);

function isClauseBoundaryToken(token: Token): boolean {
  return token.kind === 'punct' || CLAUSE_BOUNDARY_WORDS.has(token.value);
}

function splitClauses(text: string): string[] {
  const tokens = tokensFor(text);
  const clauses: string[] = [];
  let start = 0;
  for (const token of tokens) {
    if (!isClauseBoundaryToken(token)) continue;
    const part = text.slice(start, token.start).trim();
    if (part) clauses.push(part);
    start = token.end;
  }
  const tail = text.slice(start).trim();
  if (tail) clauses.push(tail);
  return clauses;
}

function isInWordWriteMorpheme(text: string, from: number, clauseHasQuery: boolean): boolean {
  const after = text.slice(from + 2);
  // A leftover content character plus 交／繳 is in-word when this clause is a
  // query (外交作業／外交課程). A new clause must not inherit a previous 查.
  if (!clauseHasQuery && !/^(?:課|程|生|系|部|際|學|官)/u.test(after)) return false;
  return true;
}

function noteToken(tokens: Token[], token: Token, state: { clauseHasQuery: boolean }): void {
  tokens.push(token);
  if (isClauseBoundaryToken(token)) state.clauseHasQuery = false;
  else if (token.kind === 'query' || QUERY_START.has(token.value)) state.clauseHasQuery = true;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const state = { clauseHasQuery: false };
  let index = 0;
  while (index < text.length) {
    const from = index;
    const entry = LEXICON.find(item => text.startsWith(item.value, index));
    if (entry) {
      noteToken(tokens, { value: entry.value, start: from, end: from + entry.value.length, kind: entry.kind }, state);
      index += entry.value.length;
      continue;
    }
    const ch = text[index]!;
    const next = text[index + 1] ?? '';
    // 查／看 in the second syllable of leftover content is in-word (審查、檢查).
    // 交／繳 only bind when a query already governs the clause and what follows
    // is not a submission object, so ambiguous writes stay blocked and pure reads do not.
    if (HAN_CHAR.test(ch) && HAN_CHAR.test(next) && /[查看交繳]/.test(next) &&
      !/[查看交繳]/.test(ch) &&
      !startsKnownQuery(text, from) && !startsKnownWrite(text, from) &&
      ( /[查看]/.test(next) || isInWordWriteMorpheme(text, from, state.clauseHasQuery) )) {
      noteToken(tokens, { value: ch + next, start: from, end: from + 2, kind: 'noun' }, state);
      index += 2;
      continue;
    }
    const kind: TokenKind = ch === '查' || ch === '看' ? 'query'
      : /[，,；;。！!？?\r\n]/.test(ch) ? 'punct'
      : 'other';
    noteToken(tokens, { value: ch, start: from, end: from + 1, kind }, state);
    index += 1;
  }
  return tokens;
}

const TOKEN_CACHE_LIMIT = 8;
const tokenCache = new Map<string, Token[]>();

function tokensFor(text: string): Token[] {
  const hit = tokenCache.get(text);
  if (hit) {
    tokenCache.delete(text);
    tokenCache.set(text, hit);
    return hit;
  }
  const tokens = tokenize(text);
  tokenCache.set(text, tokens);
  if (tokenCache.size > TOKEN_CACHE_LIMIT) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
  return tokens;
}

function tokenCovering(text: string, index: number): Token | undefined {
  const tokens = tokensFor(text);
  let low = 0;
  let high = tokens.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const token = tokens[mid]!;
    if (index < token.start) high = mid - 1;
    else if (index >= token.end) low = mid + 1;
    else return token;
  }
  return undefined;
}

function isModifierBoundaryToken(token: Token): boolean {
  return token.kind === 'punct' || CLAUSE_CUES.includes(token.value);
}

function clauseRange(tokens: Token[], at: number): { start: number; end: number } {
  let start = at;
  let end = at;
  // Modifier spans such as「供老師和助教確認…用的」may contain 和／與／以及.
  while (start > 0 && !isModifierBoundaryToken(tokens[start - 1]!)) start -= 1;
  while (end + 1 < tokens.length && !isModifierBoundaryToken(tokens[end + 1]!)) end += 1;
  return { start, end };
}

function isModifierSpanInterior(tokens: Token[], at: number): boolean {
  const { start, end } = clauseRange(tokens, at);
  let supply = -1;
  let supplyEnd = -1;
  let progressive = -1;
  let progressiveEnd = -1;
  for (let i = start; i <= end; i += 1) {
    const value = tokens[i]!.value;
    if (value === '供') supply = i;
    if (value === '用的' || (value === '用' && tokens[i + 1]?.value === '的')) supplyEnd = i;
    if (value === '正在' || value === '正') progressive = i;
    if (value === '中') progressiveEnd = i;
  }
  if (supply >= 0 && supplyEnd > supply && at > supply && at <= supplyEnd) return true;
  return progressive >= 0 && progressiveEnd > progressive && at > progressive && at <= progressiveEnd;
}

function isRelativeQuery(tokens: Token[], token: Token, at = tokens.indexOf(token)): boolean {
  if (at < 0) return false;
  if (isModifierSpanInterior(tokens, at)) return true;
  const next = tokens[at + 1]?.value;
  const prev = tokens[at - 1]?.value;
  return next === '的' || next === '過' || next === '了' || next === '中' ||
    prev === '剛' || prev === '剛才' || prev === '剛剛' || prev === '所' || prev === '已' || prev === '已經' ||
    prev === '曾經' || prev === '正在' || prev === '正' || prev === '供';
}

function nextNegatedWriteStop(text: string, from: number): number {
  const tokens = tokensFor(text);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.end <= from) continue;
    if (token.start < from) continue;
    const offset = token.start - from;
    if (token.kind === 'punct' || (token.kind === 'cue' && CLAUSE_CUES.includes(token.value))) return offset;
    if (token.kind === 'cue' && ACTION_CUES.includes(token.value)) return offset;
    if (token.kind === 'query' && QUERY_START.has(token.value) && !isRelativeQuery(tokens, token, i)) {
      return offset;
    }
    if (token.kind === 'conj') {
      const skipped = text.slice(token.end).match(/^(?:(?:請|幫我|替我|代我|直接|自動)\s*)*/u)?.[0].length ?? 0;
      const at = token.end + skipped;
      const write = new RegExp(`^(?:${SUBMIT_VERB_SOURCE}|${OTHER_WRITE_VERB_SOURCE})`, 'iu').exec(text.slice(at));
      if (write && tokenCovering(text, at)?.kind !== 'noun') return offset;
    }
    if (/^(?:and|then|also)\b/i.test(text.slice(token.start))) return offset;
  }
  return -1;
}

const QUOTE_PAIRS: Array<readonly [string, string]> = [
  ['「', '」'], ['『', '』'], ['“', '”'], ['‘', '’'], ['"', '"'], ['`', '`'],
];

function readRoutingText(text: string): string {
  let result = '';
  let start = 0;
  for (const match of text.matchAll(NEGATED_WRITE_START)) {
    if (match.index < start) continue;
    const end = match.index + match[0].length;
    const boundary = nextNegatedWriteStop(text, end);
    result += text.slice(start, match.index) + ' ';
    start = boundary < 0 ? text.length : end + boundary;
  }
  return result + text.slice(start);
}

const ADDITIVE_CUE = /(?:也|還|並|並且|順便|同時|再|另外|以及|和|跟|與|及)\s*$/u;
const WRITE_CUE = /(?:記得|立即|馬上|然後|接著|接下來|之後|後|請|幫我|替我|代我|直接|自動|\b(?:please|then|immediately))\s*$/iu;
const STATUS_PREFIX = /(?:(?:是否|有沒有|有無|有哪些|哪些)\s*(?:已經|已|有)?\s*|尚未|還沒|未|沒|待|已經|已)$/u;
const STATUS_NOUN_SOURCE = '(?:過的?|了的?|的|之)?\\s*(?:狀態|紀錄|記錄|情況|進度|歷史)';
const STATUS_NOUN = new RegExp(`^${STATUS_NOUN_SOURCE}`, 'u');
const STATUS_QUESTION_SOURCE = '(?:嗎|呢|了沒|如何|怎樣|怎麼樣|是什麼|有沒有)';
const STATUS_END_SOURCE = '\\s*(?=$|[?。!])';
// Preserve the existing compound read when the next clause names campus announcements.
const CAMPUS_ANNOUNCEMENT_BOUNDARY = '\\s*(?=(?:,\\s*和?|和)\\s*(?:查)?校園公告\\s*[?。!.]*$)';
const STATUS_BOUNDARY_SOURCE = `(?:${STATUS_END_SOURCE}|${CAMPUS_ANNOUNCEMENT_BOUNDARY})`;
const GOVERNED_STATUS = new RegExp(
  `^${STATUS_NOUN_SOURCE}(?:\\s*(?:${STATUS_QUESTION_SOURCE}|查詢|一下|給我看))?${STATUS_BOUNDARY_SOURCE}`, 'u',
);
const SUBMISSION_QUESTION = new RegExp(`^(?:了沒|了嗎|沒|過了嗎)${STATUS_BOUNDARY_SOURCE}`, 'u');
const DEADLINE_SUFFIX_SOURCE = `(?:作業\\s*(?:的\\s*)?)?(?:期限|截止(?:日(?:期)?|時間)?|deadline\\b)(?:\\s*(?:是)?(?:什麼時候|哪一天|哪天|嗎|呢))?${STATUS_BOUNDARY_SOURCE}`;
const SUBMISSION_DEADLINE = new RegExp(`^${DEADLINE_SUFFIX_SOURCE}`, 'iu');
const SUBMISSION_DEADLINE_QUERY = new RegExp(`(?:${SUBMIT_VERB_SOURCE})\\s*${DEADLINE_SUFFIX_SOURCE}`, 'iu');
const HOMEWORK_STATUS_SUFFIX = new RegExp(
  `^\\s*(?:的?作業)?\\s*的?(?:有哪些)?(?:${STATUS_BOUNDARY_SOURCE}|\\s*(?=${CLAUSE_SEPARATOR.source}|${NEGATED_WRITE_SOURCE}))`, 'iu',
);
const STATUS_EXPLANATION = new RegExp(
  `((?:${SUBMIT_VERB_SOURCE})${STATUS_NOUN_SOURCE})\\s*(?:如何|怎麼樣)${STATUS_BOUNDARY_SOURCE}`, 'giu',
);

const LMS_SUBJECT = new RegExp(`^${LMS_SOURCE}\\s*(?:的\\s*)?$`, 'iu');
const HOMEWORK_SUBJECT = new RegExp(`^(?:${LMS_SOURCE}\\s*(?:的\\s*)?)?(?:我的\\s*)?作業\\s*的?\\s*$`, 'iu');
const READ_STATUS_PREFIX = new RegExp(
  `^(?:${LMS_SOURCE}\\s*(?:作業\\s*)?)?(?:(?:請|麻煩|幫我|替我|只要|只)\\s*)*` +
  `(?:查詢|查看|確認|顯示|列出|告訴我|查|看)\\s*`, 'iu',
);
const STATUS_FILLER = new RegExp(`^(?:(?:我的|這週|本週|${LMS_SOURCE}|作業|的|一下)\\s*)*$`, 'iu');
const NAMED_COURSE = /[\p{L}\p{N} ]{1,40}課程/u;
const AMBIGUOUS_COURSE_NAME = /也|還|並|順便|同時|再|另外|以及|和|跟|與|及|後|查|看|確認|顯示|列出|告訴我|狀態|紀錄|情況|進度/u;

function readGovernsStatus(segment: string): boolean {
  const read = segment.match(READ_STATUS_PREFIX);
  if (!read) return false;
  const filler = segment.slice(read[0].length);
  if (STATUS_FILLER.test(filler)) return true;

  const course = NAMED_COURSE.exec(filler);
  if (!course) return false;
  return !AMBIGUOUS_COURSE_NAME.test(course[0]) &&
    STATUS_FILLER.test(filler.slice(0, course.index)) &&
    STATUS_FILLER.test(filler.slice(course.index + course[0].length));
}

/** Classify each occurrence using its own context in the original request. */
function writeCommandRoute(text: string): 'planner' | 'unsupported' | null {
  for (const match of text.matchAll(WRITE_VERB)) {
    const before = text.slice(0, match.index);
    if (WRITE_NEGATION.test(before)) continue;
    // Writes hold only at a word boundary. Field nouns such as「發布時間」stay reads.
    // A write compound such as「轉交」is the word, even if the regex matched only「交」.
    const covering = tokenCovering(text, match.index);
    if (!covering || covering.kind === 'noun') continue;
    if (covering.start !== match.index && !WRITE_COMPOUND_SET.has(covering.value)) continue;
    if (!match[1]) return 'unsupported';

    const after = text.slice(match.index + match[0].length).trimStart();
    const segment = before.split(/[,;。?!、:\r\n]/u).at(-1)!.trimStart();
    if (ADDITIVE_CUE.test(before)) return STATUS_NOUN.test(after) ? 'planner' : 'unsupported';
    if (WRITE_CUE.test(before)) return 'unsupported';
    if (segment.includes('把')) return 'unsupported';
    if ((GOVERNED_STATUS.test(after) || SUBMISSION_QUESTION.test(after)) &&
      (readGovernsStatus(segment) || HOMEWORK_SUBJECT.test(segment))) continue;
    if (SUBMISSION_DEADLINE.test(after) &&
      (readGovernsStatus(segment) || HOMEWORK_SUBJECT.test(segment) || LMS_SUBJECT.test(segment))) continue;

    // Preserve homework filters such as「尚未提交的作業」.
    const statusPrefix = before.match(STATUS_PREFIX);
    if (statusPrefix && HOMEWORK_STATUS_SUFFIX.test(after)) {
      const filterContext = before.slice(0, statusPrefix.index);
      if (!ADDITIVE_CUE.test(filterContext) && !WRITE_CUE.test(filterContext)) continue;
    }
    return 'unsupported';
  }
  // 把／將 clauses can use a transfer verb that the list above has not named yet.
  // If the object is a submission item and a transfer or placement verb follows, treat it as a write.
  if (hasBaObjectWrite(text)) return 'unsupported';
  return null;
}

const BA_OBJECT = '(?:附件|檔案?|文件|作業|報告|截圖|作品|心得|講義|考卷|表單|修訂稿)';
const BA_TRANSFER = `(?:回傳|傳(?:給|到|回|去|送)|送(?:給|到|出|件)|寄(?:給|到|出)|遞(?:給|到|交)|轉(?:給|到|寄)|[交繳]|上[傳載]|提交|${PLACEMENT_VERB_SOURCE})`;
const BA_NEGATION = new RegExp(`${WRITE_NEGATION_SOURCE}$`, 'iu');
const BA_QUERY = /(?:查詢|查看|確認|顯示|列出|告訴我|查|看)/u;
const BA_OBJECT_RE = new RegExp(BA_OBJECT, 'u');
const BA_TRANSFER_RE = new RegExp(BA_TRANSFER, 'u');

function hasBaObjectWrite(text: string): boolean {
  for (const match of text.matchAll(/[把將]/gu)) {
    const before = text.slice(0, match.index);
    if (BA_NEGATION.test(before)) continue;
    // Keep colons inside the same 把／將 command, as in「把附件：放到作業區」.
    const segmentRest = text.slice(match.index + match[0].length).split(/[,;。！!？?、\r\n]/u)[0] ?? '';
    const object = BA_OBJECT_RE.exec(segmentRest);
    if (!object) continue;
    if (BA_TRANSFER_RE.test(segmentRest)) return true;
    const afterObject = segmentRest.slice(object.index + object[0].length).replace(/^[\s:：]+/u, '');
    if (!afterObject) return true;
    if (BA_QUERY.test(afterObject) && !BA_TRANSFER_RE.test(afterObject)) continue;
    return true;
  }
  return false;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textWithoutQuotedSpans(text: string): string {
  let result = text;
  for (const [open, close] of QUOTE_PAIRS) {
    result = result.replace(new RegExp(`${escapeRegex(open)}[^${escapeRegex(close)}]*${escapeRegex(close)}`, 'gu'), ' ');
  }
  return result.replace(/(?<![A-Za-z])'[^']*'(?![A-Za-z])/gu, ' ');
}

function keywordOnlyInsideQuotes(text: string): boolean {
  return TRONCLASS_KEYWORD.test(text) && !TRONCLASS_KEYWORD.test(textWithoutQuotedSpans(text));
}

/** Examples, translations, quotes, general explanations and negated reads do not authorize a private read. */
function authorizesPrivateRead(original: string): boolean {
  if (keywordOnlyInsideQuotes(original)) return false;
  for (const match of original.matchAll(NEGATIONS)) {
    const rest = original.slice(match.index);
    if (!STARTS_NEGATED_WRITE.test(rest) &&
      new RegExp(`^.{0,80}(?:${NEGATED_QUERY_VERBS.map(escapeRegex).join('|')})`, 'i').test(rest)) return false;
  }
  // Terminal status questions ask for the current state.
  const explanationText = original.replace(STATUS_EXPLANATION, '$1');
  return !(/(?:翻譯|翻成|translate|改寫|潤飾|rewrite|舉例|例句|範例|示範|解釋|釋義|備註|字串|這句|這段|什麼意思|意思是什麼|怎麼|如何|教我|說明一下|\bhow\s+(?:to|do|can)|\bwhat\s+(?:is|does)|\bexample)/i.test(explanationText) ||
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
  const unquoted = textWithoutQuotedSpans(original);
  return !writeCommandRoute(unquoted) && authorizesPrivateRead(original);
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
  const original = question.normalize('NFKC').trim();
  if (typeof question !== 'string' || !question.trim() || question.length > 1000 ||
    !TRONCLASS_KEYWORD.test(question) || !isMultiClauseRequest(question) ||
    tronClassExplicitNavigationQuestion(question) || !wholeRequestAllowsCompoundRead(question) ||
    !TRONCLASS_KEYWORD.test(readRoutingText(original))) return [];
  // Split the text after negated writes are removed, so 和／與 inside a
  // negated object cannot become their own private-read clauses.
  const clauses = splitClauses(readRoutingText(textWithoutQuotedSpans(original)));
  const result: string[] = [];
  const seen = new Set<string>();
  let context = false;
  for (const clause of clauses) {
    let candidate: string | null = null;
    if (TRONCLASS_KEYWORD.test(clause)) {
      if (!TRONCLASS_KEYWORD.test(readRoutingText(clause))) continue;
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

function lastDataTypeIntent(text: string): TronClassAgentIntent | null {
  const types: { intent: TronClassAgentIntent; pattern: RegExp }[] = [
    { intent: 'homework', pattern: /作業|homework|assignments?/giu },
    { intent: 'announcements', pattern: /公告|通知|announcements?|notices?/giu },
    { intent: 'materials', pattern: /教材|講義|檔案|附件|materials?|handouts?|files?/giu },
    { intent: 'courses', pattern: /課程|修課|課表|courses?|classes/giu },
  ];
  let found: { intent: TronClassAgentIntent; index: number } | null = null;
  for (const type of types) {
    for (const match of text.matchAll(type.pattern)) {
      if (match.index == null) continue;
      if (!found || match.index >= found.index) found = { intent: type.intent, index: match.index };
    }
  }
  return found?.intent ?? null;
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
  const unquoted = textWithoutQuotedSpans(original);
  const writeRoute = writeCommandRoute(unquoted);
  if (!authorizesPrivateRead(original)) return null;
  if (writeRoute === 'planner' || isMultiClauseRequest(original)) return null;
  if (writeRoute) return { intent: 'unsupported', pendingOnly: false };
  const text = textWithoutQuotedSpans(readRoutingText(original));
  // Keywords that only appeared inside a negated write or a quotation do not authorize a private read.
  if (!TRONCLASS_KEYWORD.test(text)) return null;
  if (/(?:能做什麼|可以做什麼|有哪些功能|支援什麼|支援哪些|功能範圍|代理權限|what\s+can|capabilit)/i.test(text)) {
    return { intent: 'capabilities', pendingOnly: false };
  }
  const pendingOnly = /(?:未交|未繳|待交|待繳|待提交|尚未(?:交|繳|提交)|還沒(?:交|繳|提交)|沒(?:交|繳)|pending|unsubmitted|not\s+submitted)/i.test(text);
  const dataIntent = lastDataTypeIntent(text);
  if (dataIntent === 'announcements') return { intent: 'announcements', pendingOnly: false };
  const tokens = tokensFor(text);
  const preparation = tokens.some(token => PREPARE_ACTIONS.has(token.value)) && /(?:作業|homework|assignment)/i.test(text);
  const downloading = tokens.some(token => DOWNLOAD_ACTIONS.has(token.value) || DOWNLOAD_ACTIONS.has(token.value.toLowerCase()));
  if (preparation && downloading) return { intent: 'unsupported', pendingOnly: false, unsupportedReason: 'multiple_actions' };
  if (/(?:測驗|考試|問卷)/.test(text)) return { intent: 'unsupported', pendingOnly: false };
  if (downloading) return { intent: 'download', pendingOnly: false };
  if (dataIntent === 'materials' || dataIntent === 'courses') {
    return { intent: dataIntent, pendingOnly: false };
  }
  if (preparation) return { intent: 'prepare', pendingOnly };
  if (pendingOnly) return { intent: 'homework', pendingOnly: true };
  if (SUBMISSION_DEADLINE_QUERY.test(text)) return { intent: 'homework', pendingOnly: false };
  if (dataIntent) return { intent: dataIntent, pendingOnly: false };
  return { intent: 'capabilities', pendingOnly: false };
}

export function canAnswerTronClassQuestion(question: string): boolean {
  return parseTronClassAgentIntent(question) !== null;
}
