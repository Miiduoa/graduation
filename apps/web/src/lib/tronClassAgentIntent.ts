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
  return splitClauses(question.normalize('NFKC')).length >= 2;
}

const TRONCLASS_KEYWORD = /(?:\btron\s*class\b|創課|玩課雲)/i;
const LMS_SOURCE = '(?:玩課雲|創課|tron\\s*class)';
// A clause without its own TronClass keyword continues the TronClass request only
// when it names TronClass data and nothing that belongs to another service.
const TRONCLASS_CONTINUATION = /(?:作業|教材|講義|附件|檔案|未交|未繳|待交|待繳|還沒交|還沒繳|沒交|沒繳|homework|assignments?|materials?|handouts?)/i;
const OTHER_SERVICE_WORDS = [
  '頁面', '畫面', '入口', '校園', '學校', '系上', '社團', '公車', '交通', '課表', '成績',
  '行事曆', '日曆', '空堂', '時段', '安排', '排程', '提醒', '設定', '失物', '餐', '活動',
  '地圖', '教室', '今天', '明天', '後天', '早上', '上午', '中午', '下午', '晚上', '分鐘', '小時',
  '近期',
];
const OTHER_SERVICE_OR_SCHEDULE = new RegExp(`(?:${OTHER_SERVICE_WORDS.join('|')}|\d{1,2}\s*[:：點])`, 'u');
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Single negator table consumed by the tokenizer. Longest match wins. */
export const TRONCLASS_NEGATORS = [
  'do not', "don't", 'never',
  '不需要', '不需', '不必', '不用', '不要', '不得', '不准', '不許',
  '無需', '無須', '毋須', '毋需',
  '先不要', '先不', '暫不要', '暫不',
  '尚未', '還沒', '沒有',
  '禁止',
  '別', '勿', '免', '甭', '莫',
  '沒', '未',
  '不',
] as const;

const NEGATOR_SET = new Set<string>(TRONCLASS_NEGATORS);
const NEGATION_SOURCE = TRONCLASS_NEGATORS
  .slice()
  .sort((a, b) => b.length - a.length)
  .map(value => {
    const source = escapeRegex(value).replace(/ /g, '\\s+');
    return /[A-Za-z']/.test(value) ? `\\b${source}\\b` : source;
  })
  .join('|');
const MAX_COMPOUND_TRONCLASS_CLAUSES = 3;
const PREFIX_ANCHOR_WINDOW = 160;

function suffixForEndAnchor(text: string): string {
  return text.length <= PREFIX_ANCHOR_WINDOW ? text : text.slice(-PREFIX_ANCHOR_WINDOW);
}
const NOUN_COMPOUNDS = [
  '交通資訊', '交通', '交流', '交換', '交易', '交際', '交響', '交友', '交集', '交往',
  '外交',
  '交界', '交替', '交錯', '交叉', '交會', '交織', '交情', '交遊', '交涉', '交戰',
  '交鋒', '交口', '交加', '交匯', '交管', '交白',
  '調查', '檢查', '審查',
];
const QUERY_VERBS = [
  '告訴我', '查詢', '查看', '顯示', '列出', '確認', '查一下', '看一下', '讀一下',
  '讀取', '調閱', '瀏覽', '檢視', '下載', '準備', '代理', '查', '看', '讀', '閱',
  'read', 'fetch', 'download', 'prepare',
];
const QUERY_START = new Set(QUERY_VERBS);
const ACTION_CUES = ['只要', '只', '改成', '改查', '而是'];
const CLAUSE_CUES = ['然後', '接著', '順便', '並且', '另外', '同時', '也幫我', '再幫我', '並幫我'];
const WRITE_CUE_WORDS = [
  '記得', '立即', '馬上', '然後', '接著', '接下來', '之後', '後',
  '請', '幫我', '替我', '代我', '直接', '自動',
];
const WRITE_CUE_WORD_SET = new Set(WRITE_CUE_WORDS);
const FUNCTION_CUES = [
  '記得', '立即', '接下來',
  '幫我', '替我', '代我', '幫忙', '請', '麻煩', '直接', '自動',
  '我們', '你們', '他們', '她們', '我', '你', '您', '他', '她', '它',
  '待', '已經', '已',
  '剛才', '剛剛', '剛', '最後', '之後', '後', '曾經', '曾', '所', '過', '了', '好了', '罷了', '業已', '早已', '早就',
  '正在', '正', '供',
  '把', '將',
  '務必', '一定', '趕緊', '立刻', '馬上', '盡快', '快',
  '去', '來', '再', '也', '又', '都', '就', '才', '還', '先', '並', '且', '跟', '而',
  '想', '要', '能', '可以', '可', '會', '現在',
];
const STATUS_WRITE_COMPOUNDS = [
  '尚未提交', '尚未繳交', '尚未繳', '尚未交',
  '還沒提交', '還沒繳交', '還沒繳', '還沒交',
  '未提交', '未繳交', '未繳', '未交',
  '沒提交', '沒繳交', '沒繳', '沒交',
  '待提交', '待繳交', '待繳', '待交',
];
const STATUS_PARTICLES = ['有沒有', '有無', '過了嗎', '了沒', '了嗎'];
const LMS_NAMES = ['玩課雲', '創課', 'tron class', 'tronclass'];
const READ_PARTICLES = [
  '有哪些', '哪些', '是否', '一下', '我的', '我們的', '這週', '本週', '什麼時候', '哪一天',
  '給我看', '是什麼', '是不是', '就是', '才是', '不是', '只是', '怎麼樣', '怎樣', '如何', '什麼', '哪天', '時候', '有什麼', '有幾份',
  '狀態', '紀錄', '記錄', '情況', '進度', '歷史', '期限', '截止', '截止日期', '截止日', '截止時間',
  'deadline', '日期', '時間',
  '校園', '學校', '老師', '資料', '筆記', '說明', '標題', '關於', '含', '成績',
  'PDF', 'pdf',
  '可以做什麼', '能做什麼', '有哪些功能', '支援什麼', '支援哪些', '功能範圍', '代理權限', '做什麼',
  'what can', 'capabilities',
  '開啟', '打開', '前往', '進入', 'open', 'go to',
  '的', '之', '嗎', '呢', '吧', '有', '這', '那', '個', '份', '些', '本', '幾', '日',
  '全部', '是', '給', '出', '用', '用的', '掉', '完', '到', '至', '上去', '出去', '最', '最新', '前',
  '開', '期末', '期中', '第', '週', '周',
  '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
  'the', 'a', 'an', 'of', 'for', 'to', 'from', 'with', 'my', 'your',
  'this', 'that', 'please', 'me', 'it', 'is', 'are', 'be', 'and', 'or',
  'on', 'at', 'by', 'as', 'into', 'onto', 'agent',
  ...OTHER_SERVICE_WORDS,
];

const DOMAIN_NOUNS = [
  '作業', '報告', '附件', '檔案', '作品', '心得', '講義', '考卷', '表單',
  '學習單', '課堂報告', '課堂', '學習',
  '公告', '通知', '教材', '課程', '課表', '修訂稿', '舊版', '新版', '這份', '那份',
  '討論', '問卷', '測驗', '考試', '截圖', '文件', '草稿',
  '發布時間', '發佈時間', '發文時間', '發布日期', '發佈日期', '發文日期',
  '作業準備區', '作業準備', '作業區', '準備區', '下載區', '下載說明', '下載公告', '交流區',
  '後面', '後來', '後續', '後方', '後段', '後期', '後天', '後台', '後端', '後排', '後座',
  '及時', '及格', '及第', '及至', '及早', '及其',
  '中文', '中文版', '中間', '中午', '中心', '中央', '中等', '中級', '中學', '中部',
  'homework', 'assignment', 'assignments', 'attachment', 'attachments',
  'materials', 'handouts', 'files',
  'announcements', 'notices', 'courses', 'classes', 'pending', 'unsubmitted',
];
const CONJ_CUES = ['以及', '和', '與', '及', '、'];
const WRITE_COMPOUNDS = [
  '重新繳交', '重新提交', '重新上傳', '重新上載', '繳交', '提交', '送出', '交出', '上傳', '上載',
  '補交', '補繳', '遲交', '重交', '重繳', '上繳', '遞交', '呈交', '交付', '繳回', '交回',
  '轉交', '代交', '面交', '附上', '夾帶', '送件', '寄出', '回傳', '傳給', '傳到', '傳回',
  '傳送', '傳去', '送給', '送到', '寄給', '寄到', '遞給', '遞到', '轉給', '轉到', '轉寄',
  '放入', '放到', '放進', '放上', '貼上', '貼到', '貼入', '丟到', '丟給', '丟入',
  '塞入', '塞進', '塞到', '投入', '投進', '投到', '搬到', '搬去',
  '交給', '繳給', '交出去', '繳出去', '交上去', '繳上去',
];
const OTHER_WRITE_VERBS = [
  '發布', '發佈', '發文', '回覆', '回復', '留言', '刪除', '撤回', '填答', '評分',
  '簽到', '簽退', '點名', '退選', '選課',
  'delete', 'post', 'reply', 'withdraw',
  'submit', 'upload', 'resubmit',
  'hand in', 'turn in', 'send in', 'send to', 'send back', 'forward',
];
const WRITE_VERB_SET = new Set<string>([...WRITE_COMPOUNDS, ...OTHER_WRITE_VERBS, '交', '繳']);
const WRITE_COMPOUND_SET = new Set(WRITE_COMPOUNDS);
const WRITE_VERB_PATTERN_SOURCE = [...WRITE_VERB_SET]
  .slice()
  .sort((a, b) => b.length - a.length)
  .map(value => {
    const source = escapeRegex(value).replace(/ /g, '\\s+');
    return /[A-Za-z']/.test(value) ? `\\b${source}\\b` : source;
  })
  .join('|');
const WRITE_NEGATION_SOURCE = `(?:${NEGATION_SOURCE})\\s*(?:(?:幫我|替我|代我|自動|直接)\\s*)*`;
const NEGATED_BA_FILL = '(?:(?:把|將)\\s*(?:(?![，,；;。！!？?\\r\\n]|然後|接著|接下來|順便|並且|另外|同時).){0,40}?)?';
const NEGATED_WRITE_SOURCE = `${WRITE_NEGATION_SOURCE}${NEGATED_BA_FILL}(?:${WRITE_VERB_PATTERN_SOURCE})`;
const BA_MARKERS = new Set(['把', '將']);
const BA_OBJECT_WORDS = new Set([
  '附件', '檔案', '檔', '文件', '作業', '報告', '截圖', '作品', '心得', '講義', '考卷', '表單', '修訂稿',
]);
const WRITE_HELPERS = new Set(['幫我', '替我', '代我', '自動', '直接', '請', '麻煩']);
const PREPARE_ACTIONS = new Set(['準備', '預覽', '草稿', '起草', 'prepare', 'draft']);
const DOWNLOAD_ACTIONS = new Set(['下載', 'download']);
const HAN_CHAR = /[\p{Script=Han}]/u;

type TokenKind = 'noun' | 'query' | 'cue' | 'conj' | 'punct' | 'neg' | 'write' | 'other' | 'unknown' | 'filename';
type Token = { value: string; start: number; end: number; kind: TokenKind };

const LEXICON: { value: string; kind: TokenKind }[] = [
  ...WRITE_COMPOUNDS.map(value => ({ value, kind: 'write' as const })),
  { value: '交', kind: 'write' as const },
  { value: '繳', kind: 'write' as const },
  ...STATUS_WRITE_COMPOUNDS.map(value => ({ value, kind: 'other' as const })),
  ...STATUS_PARTICLES.map(value => ({ value, kind: 'other' as const })),
  ...LMS_NAMES.map(value => ({ value, kind: 'noun' as const })),
  ...READ_PARTICLES.map(value => ({ value, kind: 'other' as const })),
  ...OTHER_WRITE_VERBS.map(value => ({ value, kind: 'write' as const })),
  ...DOMAIN_NOUNS.map(value => ({ value, kind: 'noun' as const })),
  ...NOUN_COMPOUNDS.map(value => ({ value, kind: 'noun' as const })),
  ...QUERY_VERBS.map(value => ({ value, kind: 'query' as const })),
  ...[...TRONCLASS_NEGATORS].map(value => ({ value, kind: 'neg' as const })),
  ...ACTION_CUES.map(value => ({ value, kind: 'cue' as const })),
  ...CLAUSE_CUES.map(value => ({ value, kind: 'cue' as const })),
  ...FUNCTION_CUES.map(value => ({ value, kind: 'cue' as const })),
  ...CONJ_CUES.map(value => ({ value, kind: 'conj' as const })),
].sort((a, b) => b.value.length - a.value.length);

type LexiconTerm = { value: string; kind: TokenKind };
type LexiconTrieNode = {
  children: Map<string, LexiconTrieNode>;
  space: LexiconTrieNode | null;
  term: LexiconTerm | null;
};

function newLexiconTrieNode(): LexiconTrieNode {
  return { children: new Map(), space: null, term: null };
}

const LEXICON_EXACT_TRIE = newLexiconTrieNode();
const LEXICON_LATIN_TRIE = newLexiconTrieNode();
const QUERY_PREFIX_TRIE = newLexiconTrieNode();
const WRITE_PREFIX_TRIE = newLexiconTrieNode();

function insertExactTrie(root: LexiconTrieNode, value: string, term: LexiconTerm | null): void {
  let node = root;
  for (let index = 0; index < value.length; index += 1) {
    const ch = value[index]!;
    let child = node.children.get(ch);
    if (!child) {
      child = newLexiconTrieNode();
      node.children.set(ch, child);
    }
    node = child;
  }
  if (term && (!node.term || node.term.value.length < term.value.length)) node.term = term;
  if (!term && !node.term) node.term = { value, kind: 'other' };
}

function insertLatinTrie(root: LexiconTrieNode, value: string, term: LexiconTerm): void {
  let node = root;
  const lower = value.toLowerCase();
  for (let index = 0; index < lower.length; ) {
    if (lower[index] === ' ') {
      while (index < lower.length && lower[index] === ' ') index += 1;
      node = node.space ?? (node.space = newLexiconTrieNode());
      continue;
    }
    const ch = lower[index]!;
    let child = node.children.get(ch);
    if (!child) {
      child = newLexiconTrieNode();
      node.children.set(ch, child);
    }
    node = child;
    index += 1;
  }
  if (!node.term || node.term.value.length < term.value.length) node.term = term;
}

function isLatinStartValue(value: string): boolean {
  const code = value.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || value.startsWith("'");
}

function isAsciiLetterCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

for (const item of LEXICON) {
  if (isLatinStartValue(item.value)) insertLatinTrie(LEXICON_LATIN_TRIE, item.value, item);
  else insertExactTrie(LEXICON_EXACT_TRIE, item.value, item);
}
for (const value of QUERY_VERBS) {
  if (isLatinStartValue(value)) insertLatinTrie(QUERY_PREFIX_TRIE, value, { value, kind: 'query' });
  else insertExactTrie(QUERY_PREFIX_TRIE, value, { value, kind: 'query' });
}
for (const value of WRITE_COMPOUNDS) {
  insertExactTrie(WRITE_PREFIX_TRIE, value, { value, kind: 'write' });
}

function walkExactTrie(
  root: LexiconTrieNode,
  text: string,
  index: number,
  firstTerminal: boolean,
): { term: LexiconTerm; length: number } | null {
  let node = root;
  let best: { term: LexiconTerm; length: number } | null = null;
  for (let cursor = index; cursor < text.length; cursor += 1) {
    const child = node.children.get(text[cursor]!);
    if (!child) break;
    node = child;
    if (node.term) {
      const hit = { term: node.term, length: cursor + 1 - index };
      if (firstTerminal) return hit;
      best = hit;
    }
  }
  return best;
}

function walkLatinTrie(root: LexiconTrieNode, text: string, index: number): { term: LexiconTerm; length: number } | null {
  let node = root;
  let best: { term: LexiconTerm; length: number } | null = null;
  let cursor = index;
  while (cursor < text.length) {
    if (node.space && /\s/.test(text[cursor]!)) {
      do { cursor += 1; } while (cursor < text.length && /\s/.test(text[cursor]!));
      node = node.space;
      if (node.term && (cursor >= text.length || !isAsciiLetterCode(text.charCodeAt(cursor)))) {
        best = { term: node.term, length: cursor - index };
      }
      continue;
    }
    const lower = text[cursor]!.toLowerCase();
    const child = node.children.get(lower);
    if (!child) break;
    node = child;
    cursor += 1;
    if (node.term && (cursor >= text.length || !isAsciiLetterCode(text.charCodeAt(cursor)))) {
      best = { term: node.term, length: cursor - index };
    }
  }
  return best;
}

function matchLexicon(text: string, index: number): { term: LexiconTerm; length: number } | null {
  const exact = walkExactTrie(LEXICON_EXACT_TRIE, text, index, false);
  const latin = isAsciiLetterCode(text.charCodeAt(index) || 0) || text[index] === "'"
    ? walkLatinTrie(LEXICON_LATIN_TRIE, text, index)
    : null;
  if (exact && latin) return exact.length >= latin.length ? exact : latin;
  return exact ?? latin;
}

function startsKnownQuery(text: string, index: number): boolean {
  if (isAsciiLetterCode(text.charCodeAt(index) || 0) || text[index] === "'") {
    return walkLatinTrie(QUERY_PREFIX_TRIE, text, index) !== null;
  }
  return walkExactTrie(QUERY_PREFIX_TRIE, text, index, true) !== null;
}

function startsKnownWrite(text: string, index: number): boolean {
  return walkExactTrie(WRITE_PREFIX_TRIE, text, index, true) !== null;
}

const CLAUSE_BOUNDARY_WORDS = new Set<string>([...CLAUSE_CUES, '以及', '和', '與', '及', '後', '、']);

const CLAUSE_PUNCT = /[，,；;。！!？?\r\n]/u;

function isClauseBoundaryToken(token: Token): boolean {
  return CLAUSE_BOUNDARY_WORDS.has(token.value) || CLAUSE_PUNCT.test(token.value);
}

const ADDITIVE_CONNECTORS = ['也', '還', '並', '並且', '順便', '同時', '再', '另外', '以及', '和', '跟', '與', '及'];
const ADDITIVE_CONNECTOR_SET = new Set(ADDITIVE_CONNECTORS);
const REQUEST_CONNECTORS = new Set(['也幫我', '再幫我', '並幫我']);

function separatesClause(token: Token, hasContent: boolean, hasPredicate: boolean): boolean {
  return CLAUSE_PUNCT.test(token.value) || (hasContent && CLAUSE_BOUNDARY_WORDS.has(token.value) &&
    (!REQUEST_CONNECTORS.has(token.value) || hasPredicate));
}

function isAllowedRequestPrefix(token: Token): boolean {
  return isWhitespaceToken(token) || token.kind === 'punct' || /^\p{P}+$/u.test(token.value) ||
    CLAUSE_REQUEST_HELPERS.has(token.value.toLowerCase());
}

function splitClauses(text: string): string[] {
  const clauses: string[] = [];
  let start = 0;
  let hasContent = false;
  let hasPredicate = false;
  const quotes = typographicQuoteSpans(text);
  let quoteIndex = 0;
  for (const token of tokensFor(text)) {
    while (quotes[quoteIndex] && quotes[quoteIndex]!.end <= token.start) quoteIndex++;
    const quote = quotes[quoteIndex];
    if (quote && token.start >= quote.open) {
      hasContent = true;
      continue;
    }
    if (!separatesClause(token, hasContent, hasPredicate)) {
      hasContent ||= !isAllowedRequestPrefix(token);
      hasPredicate ||= predicateKindOf(token) !== null;
      continue;
    }
    if (hasContent) {
      const part = text.slice(start, token.start).trim();
      clauses.push(token.value === '?' ? part + token.value : part);
    }
    start = token.end;
    hasContent = false;
    hasPredicate = false;
  }
  if (hasContent) clauses.push(text.slice(start).trim());
  return clauses;
}

const QUERY_CONTEXT_HOLD_CUES = new Set(['供', '正在', '正']);

function noteToken(tokens: Token[], token: Token, state: { clauseHasQuery: boolean }): void {
  tokens.push(token);
  if (isClauseBoundaryToken(token) || WRITE_CUE_WORD_SET.has(token.value) ||
    token.kind === 'neg' || token.kind === 'write' ||
    (token.kind === 'cue' && !QUERY_CONTEXT_HOLD_CUES.has(token.value))) {
    state.clauseHasQuery = false;
  } else if (token.kind === 'query' || QUERY_START.has(token.value)) {
    state.clauseHasQuery = true;
  }
}



function isWhitespaceToken(token: Token): boolean {
  return /^\s+$/u.test(token.value);
}

function isWriteVerbToken(token: Token): boolean {
  return token.kind !== 'noun' && token.kind !== 'filename' && (token.kind === 'write' || WRITE_VERB_SET.has(token.value));
}

function isNegatorToken(token: Token): boolean {
  return token.kind === 'neg' || NEGATOR_SET.has(token.value);
}

function isWriteNegatedAt(tokens: Token[], writeAt: number): boolean {
  for (let index = writeAt - 1; index >= 0; index -= 1) {
    const token = tokens[index]!;
    if (isWhitespaceToken(token)) continue;
    if (WRITE_HELPERS.has(token.value)) continue;
    return isNegatorToken(token);
  }
  return false;
}

const PUNCT_CHAR = /[，,；;。！!？?\r\n：:()（）\[\]【】《》〈〉「」『』“”‘’"'·…]/u;
const FILE_EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,7}$/u;
const BARE_FILENAME_BODY = /^[\p{L}\p{N}_-]+$/u;
const NESTED_BRACKET_PAIRS: Array<readonly [string, string]> = [
  ['（', '）'], ['(', ')'], ['【', '】'], ['[', ']'],
];
const TYPOGRAPHIC_QUOTE_PAIRS: Array<readonly [string, string]> = [
  ['「', '」'], ['『', '』'], ['“', '”'], ['‘', '’'], ['"', '"'], ["'", "'"], ['`', '`'], ['《', '》'], ['〈', '〉'],
];
function containsLexiconVerb(value: string): boolean {
  return [...WRITE_VERB_SET, ...QUERY_VERBS, ...PREPARE_ACTIONS].some(verb => verb.length > 0 && value.includes(verb));
}

function isValidBareFilename(value: string): boolean {
  if (!value || !FILE_EXTENSION.test(value)) return false;
  const body = value.replace(FILE_EXTENSION, '');
  return BARE_FILENAME_BODY.test(body) && !containsLexiconVerb(value);
}

type BracketScan =
  | { balanced: false; firstOpen: number }
  | { balanced: true; spans: { start: number; end: number; innerStart: number; innerEnd: number }[] };

function delimiterAt(text: string, index: number, pairs: Array<readonly [string, string]>, side: 'open' | 'close'): string | null {
  let found: string | null = null;
  for (const pair of pairs) {
    const token = side === 'open' ? pair[0] : pair[1];
    if (text.startsWith(token, index) && (found === null || token.length > found.length)) found = token;
  }
  return found;
}

function scanNestedBrackets(text: string): BracketScan {
  const stack: { open: string; close: string; start: number; innerStart: number }[] = [];
  const spans: { start: number; end: number; innerStart: number; innerEnd: number }[] = [];
  let index = 0;
  let firstOpen = -1;
  while (index < text.length) {
    const opened = delimiterAt(text, index, NESTED_BRACKET_PAIRS, 'open');
    const closed = delimiterAt(text, index, NESTED_BRACKET_PAIRS, 'close');
    if (opened) {
      const pair = NESTED_BRACKET_PAIRS.find(item => item[0] === opened)!;
      if (firstOpen < 0) firstOpen = index;
      stack.push({ open: opened, close: pair[1], start: index, innerStart: index + opened.length });
      index += opened.length;
      continue;
    }
    if (closed) {
      const frame = stack[stack.length - 1];
      if (!frame || frame.close !== closed) return { balanced: false, firstOpen: firstOpen < 0 ? index : firstOpen };
      stack.pop();
      spans.push({ start: frame.start, end: index + closed.length, innerStart: frame.innerStart, innerEnd: index });
      index += closed.length;
      continue;
    }
    index += 1;
  }
  if (stack.length > 0) return { balanced: false, firstOpen: firstOpen < 0 ? 0 : firstOpen };
  return { balanced: true, spans };
}

type QuoteSpan = { open: number; inner: number; close: number; end: number };

const quoteSpanCache = new Map<string, QuoteSpan[]>();

function typographicQuoteSpans(text: string): QuoteSpan[] {
  const cached = quoteSpanCache.get(text);
  if (cached) return cached;

  const spans: QuoteSpan[] = [];
  const stack: { open: number; closer: string }[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    const frame = stack[stack.length - 1];
    if (frame && ch === frame.closer && (ch !== "'" || !/[A-Za-z]/.test(text[index + 1] ?? ''))) {
      stack.pop();
      if (stack.length === 0) {
        spans.push({ open: frame.open, inner: frame.open + 1, close: index, end: index + 1 });
      }
    } else {
      const pair = TYPOGRAPHIC_QUOTE_PAIRS.find(([open]) => open === ch);
      if (pair && (ch !== "'" || !/[A-Za-z]/.test(text[index - 1] ?? ''))) {
        stack.push({ open: index, closer: pair[1] });
      }
    }
  }
  const unclosed = stack[0];
  if (unclosed) {
    spans.push({ open: unclosed.open, inner: unclosed.open + 1, close: text.length, end: text.length });
  }
  quoteSpanCache.set(text, spans);
  if (quoteSpanCache.size > 8) {
    const oldest = quoteSpanCache.keys().next().value;
    if (oldest !== undefined) quoteSpanCache.delete(oldest);
  }
  return spans;
}

function hasUnclosedQuote(text: string): boolean {
  return typographicQuoteSpans(text).some(span => span.close === span.end);
}

function hasFilenameCandidate(text: string): boolean {
  if (precomputedBareFilenames(text).size > 0) return true;
  if (tokensFor(text).some(token => token.kind === 'filename')) return true;
  return false;
}

function hasBracketContent(text: string): boolean {
  const scan = bracketsFor(text);
  if (!scan.balanced) return true;
  if (scan.spans.length > 0) return true;
  return NESTED_BRACKET_PAIRS.some(([open, close]) => text.includes(open) || text.includes(close));
}

/** File mentions or any bracket/parenthesis content block clearly-read. */
function hasReadBlockingDecoration(text: string): boolean {
  return hasUnclosedQuote(text) || hasBracketContent(text) || hasFilenameCandidate(text);
}

const BRACKET_SCAN_LIMIT = 8;
const bracketScanCache = new Map<string, BracketScan>();

function bracketsFor(text: string): BracketScan {
  const hit = bracketScanCache.get(text);
  if (hit) {
    bracketScanCache.delete(text);
    bracketScanCache.set(text, hit);
    return hit;
  }
  const scan = scanNestedBrackets(text);
  bracketScanCache.set(text, scan);
  if (bracketScanCache.size > BRACKET_SCAN_LIMIT) {
    const oldest = bracketScanCache.keys().next().value;
    if (oldest !== undefined) bracketScanCache.delete(oldest);
  }
  return scan;
}

function hasFilenameExtensionAt(text: string, start: number, end: number): boolean {
  // The extension is at most nine characters, even for overlapping bracket spans.
  return FILE_EXTENSION.test(text.slice(Math.max(start, end - 9), end));
}

function precomputedQuotedFilenames(text: string): Map<number, QuoteSpan> {
  const found = new Map<number, QuoteSpan>();
  for (const quoted of typographicQuoteSpans(text)) {
    if (quoted.close < quoted.end && hasFilenameExtensionAt(text, quoted.inner, quoted.close)) {
      found.set(quoted.open, quoted);
    }
  }
  const scan = bracketsFor(text);
  if (scan.balanced) {
    for (const span of scan.spans) {
      if (!hasFilenameExtensionAt(text, span.innerStart, span.innerEnd)) continue;
      found.set(span.start, { open: span.start, inner: span.innerStart, close: span.innerEnd, end: span.end });
    }
  }
  return found;
}

function isBareFilenameBodyChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  if (ch === '_' || ch === '-') return true;
  if (code >= 48 && code <= 57) return true;
  if (isAsciiLetterCode(code)) return true;
  return HAN_CHAR.test(ch) || /[\p{L}\p{N}]/u.test(ch);
}

function precomputedBareFilenames(text: string): Map<number, number> {
  const found = new Map<number, number>();
  let index = 0;
  while (index < text.length) {
    if (text[index] !== '.') {
      index += 1;
      continue;
    }
    if (index + 1 >= text.length || !isAsciiLetterCode(text.charCodeAt(index + 1))) {
      index += 1;
      continue;
    }
    let extEnd = index + 2;
    const extLimit = Math.min(text.length, index + 9);
    while (extEnd < extLimit && (
      isAsciiLetterCode(text.charCodeAt(extEnd)) ||
      (text.charCodeAt(extEnd) >= 48 && text.charCodeAt(extEnd) <= 57)
    )) extEnd += 1;
    if (extEnd < text.length && (
      isAsciiLetterCode(text.charCodeAt(extEnd)) ||
      (text.charCodeAt(extEnd) >= 48 && text.charCodeAt(extEnd) <= 57)
    )) {
      index += 1;
      continue;
    }
    let start = index;
    while (start > 0 && isBareFilenameBodyChar(text[start - 1]!)) start -= 1;
    if (start === index) {
      index = extEnd;
      continue;
    }
    const value = text.slice(start, extEnd);
    if (isValidBareFilename(value)) found.set(start, extEnd - start);
    index = extEnd;
  }
  return found;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const state = { clauseHasQuery: false };
  const quotedFiles = precomputedQuotedFilenames(text);
  const bareFiles = precomputedBareFilenames(text);
  const unclosedQuote = typographicQuoteSpans(text).find(span => span.close === span.end);
  let index = 0;
  while (index < text.length) {
    const from = index;
    if (index === unclosedQuote?.open) {
      noteToken(tokens, { value: text.slice(index), start: index, end: text.length, kind: 'punct' }, state);
      break;
    }
    const quoted = quotedFiles.get(index);
    if (quoted && (!unclosedQuote || quoted.end <= unclosedQuote.open)) {
      noteToken(tokens, { value: text.slice(quoted.open, quoted.inner), start: quoted.open, end: quoted.inner, kind: 'punct' }, state);
      noteToken(tokens, { value: text.slice(quoted.inner, quoted.close), start: quoted.inner, end: quoted.close, kind: 'filename' }, state);
      noteToken(tokens, { value: text.slice(quoted.close, quoted.end), start: quoted.close, end: quoted.end, kind: 'punct' }, state);
      index = quoted.end;
      continue;
    }
    const fileLength = bareFiles.get(index) ?? 0;
    if (fileLength > 0) {
      noteToken(tokens, { value: text.slice(from, from + fileLength), start: from, end: from + fileLength, kind: 'filename' }, state);
      index += fileLength;
      continue;
    }
    const lexicon = matchLexicon(text, index);
    if (lexicon) {
      noteToken(tokens, { value: lexicon.term.value, start: from, end: from + lexicon.length, kind: lexicon.term.kind }, state);
      index += lexicon.length;
      continue;
    }
    if (isAsciiLetterCode(text.charCodeAt(index))) {
      let end = index + 1;
      while (end < text.length && isAsciiLetterCode(text.charCodeAt(end))) end += 1;
      noteToken(tokens, { value: text.slice(from, end), start: from, end, kind: 'unknown' }, state);
      index = end;
      continue;
    }
    const ch = text[index]!;
    const next = text[index + 1] ?? '';
    // 查／看 in the second syllable of leftover content is in-word (審查、檢查).
    // 交／繳 only bind when a query already governs the clause and what follows
    // is not a submission object, so ambiguous writes stay blocked and pure reads do not.
    // 交／繳 are verbs unless the lexicon already consumed a noun such as「外交」.
    // Only 查／看 still bind as a second syllable of leftover content (審查、檢查).
    if (HAN_CHAR.test(ch) && HAN_CHAR.test(next) && /[查看]/.test(next) &&
      !/[查看交繳]/.test(ch) &&
      !startsKnownQuery(text, from) && !startsKnownWrite(text, from) &&
      !startsKnownQuery(text, from + 1) && !startsKnownWrite(text, from + 1) &&
      !matchLexicon(text, from + 1)) {
      noteToken(tokens, { value: ch + next, start: from, end: from + 2, kind: 'noun' }, state);
      index += 2;
      continue;
    }
    const kind: TokenKind = ch === '查' || ch === '看' ? 'query'
      : PUNCT_CHAR.test(ch) ? 'punct'
      : 'unknown';
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

function isModifierBoundaryToken(token: Token): boolean {
  return token.kind === 'punct';
}

function nextSignificantToken(tokens: Token[], cursor: number, nextIndex?: number[]): Token | undefined {
  if (nextIndex) {
    const index = nextIndex[cursor] ?? -1;
    return index >= 0 ? tokens[index] : undefined;
  }
  for (let index = cursor + 1; index < tokens.length; index += 1) {
    if (!isWhitespaceToken(tokens[index]!)) return tokens[index];
  }
  return undefined;
}

function previousSignificantToken(tokens: Token[], cursor: number): Token | undefined {
  for (let index = cursor - 1; index >= 0; index -= 1) {
    if (!isWhitespaceToken(tokens[index]!)) return tokens[index];
  }
  return undefined;
}

function significantNeighborIndex(tokens: Token[]): { prev: number[]; next: number[] } {
  const prev = new Array<number>(tokens.length).fill(-1);
  const next = new Array<number>(tokens.length).fill(-1);
  let last = -1;
  for (let index = 0; index < tokens.length; index += 1) {
    prev[index] = last;
    if (!isWhitespaceToken(tokens[index]!)) last = index;
  }
  last = -1;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    next[index] = last;
    if (!isWhitespaceToken(tokens[index]!)) last = index;
  }
  return { prev, next };
}

function isProgressiveCloser(tokens: Token[], cursor: number, clauseEnd: number, nextIndex?: number[]): boolean {
  if (cursor === clauseEnd) return true;
  const next = nextSignificantToken(tokens, cursor, nextIndex);
  if (!next) return true;
  return next.value === '的' || isModifierBoundaryToken(next) || ACTION_CUES.includes(next.value);
}

function isSupplyCloser(tokens: Token[], cursor: number, nextIndex?: number[]): boolean {
  const value = tokens[cursor]!.value;
  return value === '用的' || (value === '用' && nextSignificantToken(tokens, cursor, nextIndex)?.value === '的');
}

function collectModifierSpans(tokens: Token[]): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const neighbors = significantNeighborIndex(tokens);
  let index = 0;
  while (index < tokens.length) {
    if (isModifierBoundaryToken(tokens[index]!)) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < tokens.length && !isModifierBoundaryToken(tokens[end + 1]!)) end += 1;
    const supply: number[] = [];
    const progressive: number[] = [];
    let lastSupplyClose: number | undefined;
    let lastProgressiveClose: number | undefined;
    for (let cursor = index; cursor <= end; cursor += 1) {
      const value = tokens[cursor]!.value;
      if (value === '供') supply.push(cursor);
      if (isSupplyCloser(tokens, cursor, neighbors.next)) {
        lastSupplyClose = cursor;
        const start = supply.pop();
        if (start !== undefined && cursor > start) spans.push({ start, end: cursor });
      }
      if (value === '正在' || value === '正') progressive.push(cursor);
      if (value === '中' && isProgressiveCloser(tokens, cursor, end, neighbors.next)) {
        lastProgressiveClose = cursor;
        const start = progressive.pop();
        if (start !== undefined && cursor > start) spans.push({ start, end: cursor });
      }
    }
    while (supply.length > 0) {
      const start = supply.pop()!;
      if (lastSupplyClose !== undefined && lastSupplyClose > start) {
        spans.push({ start, end: lastSupplyClose });
      }
    }
    while (progressive.length > 0) {
      const start = progressive.pop()!;
      if (lastProgressiveClose !== undefined && lastProgressiveClose > start) {
        spans.push({ start, end: lastProgressiveClose });
      }
    }
    index = end + 1;
  }
  return spans;
}

const modifierInteriorByTokens = new WeakMap<Token[], boolean[]>();

function modifierInteriorIndex(tokens: Token[]): boolean[] {
  const cached = modifierInteriorByTokens.get(tokens);
  if (cached) return cached;
  const delta = new Array(tokens.length + 1).fill(0);
  for (const span of collectModifierSpans(tokens)) {
    if (span.end > span.start) {
      delta[span.start + 1] += 1;
      delta[span.end + 1] -= 1;
    }
  }
  const interior: boolean[] = [];
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    depth += delta[index]!;
    interior.push(depth > 0);
  }
  modifierInteriorByTokens.set(tokens, interior);
  return interior;
}

function isRelativeQuery(tokens: Token[], token: Token, at: number, interior: boolean[]): boolean {
  if (at < 0) return false;
  if (interior[at]) return true;
  const next = tokens[at + 1]?.value;
  const prev = tokens[at - 1]?.value;
  return next === '的' || next === '過' || next === '了' || next === '中' ||
    prev === '剛' || prev === '剛才' || prev === '剛剛' || prev === '所' || prev === '已' || prev === '已經' ||
    prev === '曾經' || prev === '正在' || prev === '正' || prev === '供';
}

function nextNegatedWriteStop(tokens: Token[], interior: boolean[], from: number): number {
  for (let i = from; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (interior[i]) continue;
    if (token.kind === 'punct' || (token.kind === 'cue' && CLAUSE_CUES.includes(token.value))) return i;
    if (token.kind === 'cue' && ACTION_CUES.includes(token.value)) return i;
    if (token.kind === 'query' && QUERY_START.has(token.value) && !isRelativeQuery(tokens, token, i, interior)) {
      return i;
    }
    if (token.kind === 'conj') {
      let next = i + 1;
      while (next < tokens.length &&
        (isWhitespaceToken(tokens[next]!) || WRITE_HELPERS.has(tokens[next]!.value))) {
        next += 1;
      }
      const following = tokens[next];
      if (following && isWriteVerbToken(following)) return i;
    }
    const word = token.value.toLowerCase();
    if (word === 'and' || word === 'then' || word === 'also') return i;
  }
  return tokens.length;
}

function readRoutingText(text: string): string {
  const mask = typographicQuoteMask(text);
  const tokens = tokensFor(text).filter(token => !tokenIsProtected(token, mask));
  const writeTargets = negatedWriteTargets(tokens);
  const interior = modifierInteriorIndex(tokens);
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < tokens.length;) {
    const writeAt = writeTargets[index];
    if (writeAt === undefined) {
      index += 1;
      continue;
    }
    parts.push(text.slice(start, tokens[index]!.start), ' ');
    index = nextNegatedWriteStop(tokens, interior, writeAt + 1);
    start = tokens[index]?.start ?? text.length;
  }
  parts.push(text.slice(start));
  return parts.join('');
}

const ADDITIVE_CUE = new RegExp(`(?:${ADDITIVE_CONNECTORS.join('|')})\\s*$`, 'u');
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
const SUBMISSION_DEADLINE_QUERY = new RegExp(`(?:${WRITE_VERB_PATTERN_SOURCE})\\s*${DEADLINE_SUFFIX_SOURCE}`, 'iu');
const HOMEWORK_STATUS_SUFFIX = new RegExp(
  `^\\s*(?:的?作業)?\\s*的?(?:有哪些)?(?:${STATUS_BOUNDARY_SOURCE}|\\s*(?=${CLAUSE_SEPARATOR.source}|${NEGATED_WRITE_SOURCE}))`, 'iu',
);
const STATUS_EXPLANATION = new RegExp(
  `((?:${WRITE_VERB_PATTERN_SOURCE})${STATUS_NOUN_SOURCE})\\s*(?:如何|怎麼樣)${STATUS_BOUNDARY_SOURCE}`, 'giu',
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

function isSubmitWriteToken(token: Token): boolean {
  return WRITE_COMPOUND_SET.has(token.value) || token.value === '交' || token.value === '繳';
}

function isBaClausePunct(token: Token): boolean {
  return token.kind === 'punct' && /[,;。！!？?、]/u.test(token.value);
}

/** Classify each occurrence using its own context in the original request. */
function writeCommandRoute(text: string): 'planner' | 'unsupported' | 'ambiguous' | null {
  const tokens = tokensFor(text);
  const provenWrites = provenPredicateIndexes(tokens, 'write');
  let lastPunctEnd = 0;
  let clauseHasBa = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind === 'punct') {
      lastPunctEnd = token.end;
      clauseHasBa = false;
      continue;
    }
    if (BA_MARKERS.has(token.value)) {
      if (!isWriteNegatedAt(tokens, index)) clauseHasBa = true;
      continue;
    }
    if (token.kind === 'noun' || !isWriteVerbToken(token)) continue;
    if (isWriteNegatedAt(tokens, index)) continue;
    if (!provenWrites.has(index)) continue;
    // Field nouns such as「發布時間」are consumed as nouns and never reach here.
    // Other writes such as「刪除」are never status filters.
    if (!isSubmitWriteToken(token)) return 'unsupported';

    const before = text.slice(0, token.start);
    const beforeTail = suffixForEndAnchor(before);
    const after = text.slice(token.end).trimStart();
    const segment = text.slice(lastPunctEnd, token.start).trimStart();
    if (ADDITIVE_CUE.test(beforeTail)) return STATUS_NOUN.test(after) ? 'planner' : 'unsupported';
    if (WRITE_CUE.test(beforeTail)) return 'unsupported';
    if (clauseHasBa) return 'unsupported';
    if ((GOVERNED_STATUS.test(after) || SUBMISSION_QUESTION.test(after)) &&
      (readGovernsStatus(segment) || HOMEWORK_SUBJECT.test(segment))) continue;
    if (SUBMISSION_DEADLINE.test(after) &&
      (readGovernsStatus(segment) || HOMEWORK_SUBJECT.test(segment) || LMS_SUBJECT.test(segment))) continue;

    // Preserve homework filters such as「尚未提交的作業」.
    const statusPrefix = beforeTail.match(STATUS_PREFIX);
    if (statusPrefix && HOMEWORK_STATUS_SUFFIX.test(after)) {
      const filterContext = before.slice(0, before.length - beforeTail.length + (statusPrefix.index ?? 0));
      if (!ADDITIVE_CUE.test(suffixForEndAnchor(filterContext)) && !WRITE_CUE.test(suffixForEndAnchor(filterContext))) continue;
    }
    return 'unsupported';
  }
  const ba = baConstructionState(text);
  if (ba === 'unresolved') return 'ambiguous';
  if (ba === 'write') {
    return provenWrites.size > 0 ? 'unsupported' : 'ambiguous';
  }
  return null;
}


function baSpanKind(tokens: Token[], baAt: number, end: number): 'write' | 'query' | 'unresolved' | 'none' {
  let objectAt = -1;
  for (let index = baAt + 1; index < end; index += 1) {
    const token = tokens[index]!;
    if (isWhitespaceToken(token) || token.value === ':' || token.value === '：') continue;
    if (BA_OBJECT_WORDS.has(token.value) || token.kind === 'noun') {
      objectAt = index;
      break;
    }
    if (isWriteVerbToken(token) || token.kind === 'query' || QUERY_START.has(token.value) ||
      isClauseBoundaryToken(token) || isBaClausePunct(token)) {
      break;
    }
  }
  if (objectAt < 0) return 'none';
  let sawWrite = false;
  let sawQuery = false;
  let sawContent = false;
  for (let index = objectAt + 1; index < end; index += 1) {
    const token = tokens[index]!;
    if (isWhitespaceToken(token) || token.value === ':' || token.value === '：') continue;
    sawContent = true;
    if (isWriteVerbToken(token)) sawWrite = true;
    else if (token.kind === 'query' || QUERY_START.has(token.value)) sawQuery = true;
  }
  if (sawWrite && !sawQuery) return 'write';
  if (sawQuery && !sawWrite) return 'query';
  if (sawWrite && sawQuery) return 'unresolved';
  if (!sawContent) return 'unresolved';
  return 'unresolved';
}

function baConstructionState(text: string): 'write' | 'query' | 'none' | 'unresolved' {
  const tokens = tokensFor(text);
  let baAt = -1;
  let result: 'write' | 'query' | 'none' = 'none';
  const finish = (end: number): 'unresolved' | null => {
    if (baAt < 0) return null;
    const kind = baSpanKind(tokens, baAt, end);
    baAt = -1;
    if (kind === 'unresolved') return 'unresolved';
    if (kind === 'write') result = 'write';
    else if (kind === 'query' && result !== 'write') result = 'query';
    return null;
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (isBaClausePunct(token)) {
      if (finish(index) === 'unresolved') return 'unresolved';
      continue;
    }
    if (BA_MARKERS.has(token.value) && !isWriteNegatedAt(tokens, index)) baAt = index;
  }
  if (finish(tokens.length) === 'unresolved') return 'unresolved';
  return result;
}

type NegationScan = 'clear' | 'negated-write' | 'negated-query' | 'unresolved';

function isClauseScanBoundary(token: Token): boolean {
  return token.kind === 'punct' || (token.kind === 'cue' && (CLAUSE_CUES.includes(token.value) || ACTION_CUES.includes(token.value)));
}

/** Single-pass linear scan: every negator in the clause is considered; never jump to the clause end. */
function scanNegation(tokens: Token[], interior: boolean[]): NegationScan {
  let result: NegationScan = 'clear';
  let pending: 'open' | 'ba' | null = null;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (isClauseScanBoundary(token)) {
      if (pending) return 'unresolved';
      continue;
    }
    if (isNegatorToken(token)) {
      if (pending === 'open') return 'unresolved';
      pending = pending ?? 'open';
      continue;
    }
    if (!pending) continue;
    if (isWhitespaceToken(token) || token.value === ':' || token.value === '：') continue;
    if (WRITE_HELPERS.has(token.value) || token.kind === 'cue') continue;
    if (BA_MARKERS.has(token.value)) {
      pending = 'ba';
      continue;
    }
    if (pending === 'ba' && (BA_OBJECT_WORDS.has(token.value) || token.kind === 'noun' || token.kind === 'other')) {
      continue;
    }
    if (interior[index] && !isWriteVerbToken(token) && token.kind !== 'query' && !QUERY_START.has(token.value)) {
      continue;
    }
    if (isWriteVerbToken(token)) {
      if (result !== 'negated-query') result = 'negated-write';
      pending = null;
      continue;
    }
    if (token.kind === 'query' || QUERY_START.has(token.value)) {
      result = 'negated-query';
      pending = null;
      continue;
    }
    if (pending === 'ba') continue;
    // 不／未／沒 plus an unknown token is a negator span, never a filename,
    // unless that span was already consumed as a file name or sits in quotes.
    return 'unresolved';
  }
  if (pending) return 'unresolved';
  return result;
}

function writeLexiconAndRegexDisagree(text: string): boolean {
  const tokens = tokensFor(text);
  const covering: Array<Token | undefined> = new Array(text.length);
  for (const token of tokens) {
    const last = Math.min(token.end, text.length);
    for (let index = token.start; index < last; index += 1) covering[index] = token;
  }
  const pattern = new RegExp(WRITE_VERB_PATTERN_SOURCE, 'giu');
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const token = covering[start];
    const writeToken = !!token && token.start === start && token.end === end && isWriteVerbToken(token);
    const consumedAsNonWrite = !!token && token.start <= start && token.end >= end &&
      (token.kind === 'noun' || token.kind === 'other' || token.kind === 'filename');
    if (!writeToken && !consumedAsNonWrite) return true;
  }
  return false;
}

function negatedWriteTargets(tokens: Token[]): Array<number | undefined> {
  const targets: Array<number | undefined> = new Array(tokens.length);
  // Track both suffix states so negators sharing a 把／將 span reuse its write target.
  let directWrite: number | undefined;
  let baWrite: number | undefined;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]!;
    if (isNegatorToken(token)) targets[index] = directWrite;
    if (isWhitespaceToken(token)) continue;
    if (token.kind === 'punct' || (token.kind === 'cue' && CLAUSE_CUES.includes(token.value))) {
      directWrite = baWrite = undefined;
    } else if (WRITE_HELPERS.has(token.value)) {
      continue;
    } else if (BA_MARKERS.has(token.value)) {
      directWrite = baWrite;
    } else if (isWriteVerbToken(token)) {
      directWrite = baWrite = index;
    } else {
      directWrite = undefined;
    }
  }
  return targets;
}

function textWithoutQuotedSpans(text: string, replacement = ' '): string {
  const parts: string[] = [];
  let start = 0;
  for (const span of typographicQuoteSpans(text)) {
    parts.push(text.slice(start, span.open), replacement);
    start = span.end;
  }
  parts.push(text.slice(start));
  return parts.join('');
}

function keywordOnlyInsideQuotes(text: string): boolean {
  return TRONCLASS_KEYWORD.test(text) && !parseReadRequest(text).hasOutsideQuotes(TRONCLASS_KEYWORD);
}

/** Examples, translations, quotes, general explanations and negated reads do not authorize a private read. */
function authorizesPrivateRead(original: string): boolean {
  if (keywordOnlyInsideQuotes(original)) return false;
  const tokens = tokensFor(original);
  const interior = modifierInteriorIndex(tokens);
  const negation = scanNegation(tokens, interior);
  if (negation === 'negated-query' || negation === 'unresolved') return false;
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
const quoteMasksBySpans = new WeakMap<QuoteSpan[], readonly boolean[]>();
const dataTypeMasksByTokens = new WeakMap<Token[], readonly boolean[]>();

function typographicQuoteMask(text: string): readonly boolean[] {
  const spans = typographicQuoteSpans(text);
  const cached = quoteMasksBySpans.get(spans);
  if (cached) return cached;
  const mask = Array.from({ length: text.length }, () => false);
  for (const quoted of spans) {
    mask.fill(true, quoted.open, quoted.end);
  }
  quoteMasksBySpans.set(spans, mask);
  return mask;
}

function dataTypeMask(text: string, includeQuotes = true): readonly boolean[] {
  const tokens = tokensFor(text);
  const cached = includeQuotes && dataTypeMasksByTokens.get(tokens);
  if (cached) return cached;
  const mask = includeQuotes ? [...typographicQuoteMask(text)] : new Array<boolean>(text.length).fill(false);
  const delta = new Array<number>(text.length + 1).fill(0);
  const add = (start: number, end: number) => {
    if (end <= start) return;
    const from = Math.max(0, start);
    const to = Math.min(text.length, end);
    if (to <= from) return;
    delta[from] += 1;
    delta[to] -= 1;
  };
  for (const token of tokens) {
    if (token.kind === 'filename') add(token.start, token.end);
  }
  const scan = bracketsFor(text);
  if (!scan.balanced) {
    add(scan.firstOpen, text.length);
  } else {
    for (const span of scan.spans) {
      add(span.start, span.end);
    }
  }
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    depth += delta[index]!;
    if (depth > 0) mask[index] = true;
  }
  if (includeQuotes) dataTypeMasksByTokens.set(tokens, mask);
  return mask;
}

function tokenIsProtected(token: Token, mask: readonly boolean[]): boolean {
  if (token.start >= token.end) return false;
  for (let index = token.start; index < token.end; index += 1) {
    if (!mask[index]) return false;
  }
  return true;
}

function isKnownReadToken(token: Token, mask: readonly boolean[]): boolean {
  if (isAllowedRequestPrefix(token) || token.kind === 'filename') return true;
  if (isWriteVerbToken(token)) return true;
  if (token.kind === 'unknown') return tokenIsProtected(token, mask);
  return true;
}

function allTokensKnown(text: string): boolean {
  const mask = typographicQuoteMask(text);
  return tokensFor(text).every(token => isKnownReadToken(token, mask));
}

function hasReadOrStatusPredicate(text: string): boolean {
  const tokens = tokensFor(text);
  if (tokens.some(token => token.kind === 'query' || QUERY_START.has(token.value))) return true;
  const statusWords = new Set<string>([
    ...STATUS_PARTICLES,
    ...STATUS_WRITE_COMPOUNDS,
    '狀態', '期限', '截止', '截止日期', '截止日', '截止時間', 'deadline',
    '進度', '紀錄', '記錄', '情況', '歷史', '有哪些', '哪些', '有什麼', '是否', '有沒有',
  ]);
  if (tokens.some(token => statusWords.has(token.value))) return true;
  return writeCommandRoute(textWithoutQuotedSpans(text)) === null &&
    tokens.some(isWriteVerbToken);
}

function hasDomainOrLmsSubstance(text: string): boolean {
  const lms = new Set(LMS_NAMES.map(value => value.toLowerCase()));
  return tokensFor(text).some(token => {
    if (token.kind === 'noun') return true;
    if (token.kind === 'query') return true;
    return lms.has(token.value.toLowerCase());
  });
}

const ACTION_COMPLETION_MARKERS = new Set([
  '已', '已經', '曾', '曾經', '剛', '剛才', '剛剛', '業已', '早已', '早就',
  '過', '了', '完', '好了', '罷了', '過了嗎', '了嗎', '了沒',
]);
const DESCRIPTIVE_ACTION_PREFIXES = new Set(['尚未', '還沒', '未', '沒', '待', '正在', '正']);

function hasDescriptiveAction(text: string): boolean {
  const tokens = visibleCommandTokens(text).filter(token => !isWhitespaceToken(token));
  let descriptivePrefix = false;
  let experiencePrefix = false;
  let submissionStatus = false;
  let readOnlyStatus: boolean | undefined;
  let sawQuery = false;
  let declarativeComplement = false;
  let questionComplement = false;
  let terminalQuestion = false;
  for (const [index, token] of tokens.entries()) {
    if (token.kind === 'punct' && CLAUSE_PUNCT.test(token.value)) {
      if (declarativeComplement && !questionComplement && !terminalQuestion && token.value !== '?') return true;
      sawQuery = false;
      declarativeComplement = false;
      questionComplement = false;
      terminalQuestion = false;
      descriptivePrefix = false;
      experiencePrefix = false;
      submissionStatus = false;
      continue;
    }
    const value = token.value.toLowerCase();
    terminalQuestion = value === '嗎' || value === '呢';
    if (sawQuery && COPULAS.has(value)) {
      declarativeComplement = true;
      questionComplement = false;
    } else if (declarativeComplement && READ_QUESTION_WORDS.has(value)) {
      questionComplement = true;
    }
    // Download history and other nominal uses do not name a supported read.
    if (DOWNLOAD_ACTIONS.has(value) && !isDownloadCommand(tokens, index)) return true;
    sawQuery ||= token.kind === 'query' || value === '改查';
    const write = isWriteVerbToken(token);
    const action = write || (token.kind !== 'noun' && (token.kind === 'query' ||
      isPrepareActionValue(token.value) || DOWNLOAD_ACTIONS.has(token.value.toLowerCase())));
    // A governed submission status can own aspect particles, as in
    // 「查作業交過了嗎」 or 「查作業繳交進度了沒」.
    if (ACTION_COMPLETION_MARKERS.has(token.value)) {
      const next = tokens[index + 1];
      const submissionFilter = (token.value === '已' || token.value === '已經') &&
        next && isWriteVerbToken(next) && isSubmitWriteToken(next) &&
        HOMEWORK_STATUS_SUFFIX.test(text.slice(next.end).trimStart());
      const submissionQuestion = submissionStatus &&
        (SUBMISSION_QUESTION.test(text.slice(token.start)) || GOVERNED_STATUS.test(text.slice(token.start)));
      if (!submissionFilter && !submissionQuestion) return true;
      readOnlyStatus ??= writeCommandRoute(text) === null;
      if (!readOnlyStatus) return true;
      continue;
    }
    if (action) {
      if (experiencePrefix) return true;
      if (descriptivePrefix) {
        if (!write || !isSubmitWriteToken(token)) return true;
        readOnlyStatus ??= writeCommandRoute(text) === null;
        if (!readOnlyStatus) return true;
        descriptivePrefix = false;
      }
    }
    if (DESCRIPTIVE_ACTION_PREFIXES.has(token.value)) descriptivePrefix = true;
    // 有沒有 and 有哪些 are atomic. Standalone 有 is only evidence of
    // experience if an action follows in the clause, regardless of interveners.
    if (token.value === '有') experiencePrefix = true;
    submissionStatus = (write && isSubmitWriteToken(token) && !isWriteNegatedAt(tokens, index)) ||
      (submissionStatus && STATUS_NOUN.test(token.value));
  }
  return declarativeComplement && !questionComplement && !terminalQuestion;
}

const COPULAS = new Set(['是', '就是', '才是', '不是', '只是', 'is', 'are']);
const READ_QUESTION_WORDS = new Set([
  '有沒有', '有無', '有哪些', '哪些', '是否', '有什麼', '有幾份',
  '什麼時候', '哪一天', '哪天', '是什麼', '是不是', '什麼', '如何', '怎樣', '怎麼樣', '過了嗎', '了沒', '了嗎',
  '可以做什麼', '能做什麼', '有哪些功能', '支援什麼', '支援哪些', '做什麼', 'what can',
]);

const OBJECT_SPECIFIERS = new Set([
  ...LMS_NAMES,
  '我', '我們', '你', '您', '你們', '他', '她', '它', '他們', '她們',
  '這份', '那份', '這個', '那個', '這些', '那些', '全部', '這', '那',
  'my', 'the', 'a', 'an', 'this', 'that', 'these', 'those', 'all',
]);
const OBJECT_ADJUNCTS = new Set([
  ...STATUS_WRITE_COMPOUNDS,
  '我的', '我們的', '這週', '本週', '最新', '舊版', '新版', '全部',
  'pending', 'unsubmitted',
  '最後', '之後', '後面', '前面', '之前', '以前', '以後', '裡面', '中間',
]);
const OBJECT_PREPOSITIONS = new Set(['關於', '含', '和', '與', '跟', '及', '以及', '標題']);
const READ_OBJECT_HEADS = new Set([
  '作業', '教材', '講義', '附件', '公告', '課程', '討論', '功課', '檔案', '資料',
  'homework', 'assignment', 'materials', 'announcement', 'course',
]);
const VERBAL_PARTICLES = new Set(['一下', '出去', '上去', '掉', '給老師', '給我']);

const CLAUSE_REQUEST_HELPERS = new Set(['請', '幫我', '替我', '代我', '麻煩', 'please']);
type PredicateKind = 'read' | 'prepare' | 'download' | 'write';
type ClausePredicate = {
  index: number;
  kind: PredicateKind;
  blockedPrefix: boolean;
  objectEndsClause: boolean;
  residueCopula: boolean;
  residueAspect: boolean;
  residueUnknown: boolean;
};
type ClauseAnalysis = {
  hasHomework: boolean;
  hasLmsName: boolean;
  hasUnsupportedOwner: boolean;
  hasBlockedPredicate: boolean;
  predicates: ClausePredicate[];
  trailingQuestion: boolean;
  hasQuestionCopula: boolean;
  hasUnknown: boolean;
};

function predicateKindOf(token: Token): PredicateKind | null {
  const value = token.value.toLowerCase();
  if (token.kind === 'noun' || READ_QUESTION_WORDS.has(value) || COPULAS.has(value)) return null;
  if (DOWNLOAD_ACTIONS.has(value)) return 'download';
  if (isPrepareActionValue(token.value)) return 'prepare';
  if (isWriteVerbToken(token)) return 'write';
  if (token.kind === 'query' || QUERY_START.has(token.value)) return 'read';
  return null;
}

type StatusSuffix = { homework: boolean; governed: boolean; question: boolean; deadline: boolean };

function matchesStatusSuffix(text: string, start: number): StatusSuffix | undefined {
  // Status grammar is local to the verb. Bound lookahead and prevent a
  // truncated window from matching a pattern anchored at the end of input.
  const end = start + PREFIX_ANCHOR_WINDOW;
  const suffix = text.slice(start, end) + (end < text.length ? '\u0000' : '');
  const homework = HOMEWORK_STATUS_SUFFIX.test(suffix);
  const governed = GOVERNED_STATUS.test(suffix);
  const question = SUBMISSION_QUESTION.test(suffix);
  const deadline = SUBMISSION_DEADLINE.test(suffix);
  if (homework || governed || question || deadline) return { homework, governed, question, deadline };
  return undefined;
}

function clauseTokenContext(tokens: Token[]) {
  const offsets: number[] = [];
  const parts: string[] = [];
  let offset = 0;
  for (const token of tokens) {
    offsets.push(offset);
    const value = /[\r\n]/u.test(token.value) && isWhitespaceToken(token)
      ? '\n'
      : token.value.replace(/\s+/gu, ' ');
    parts.push(value);
    offset += value.length;
  }
  offsets.push(offset);
  const text = parts.join('');
  const next: number[] = [];
  const previous: number[] = [];
  const statusSuffixes: (StatusSuffix | undefined)[] = [];
  let significant = tokens.length;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    next[index] = significant;
    if (!isWhitespaceToken(tokens[index]!)) significant = index;
  }
  significant = -1;
  for (const [index, token] of tokens.entries()) {
    previous[index] = significant;
    if (!isWhitespaceToken(token)) significant = index;
    if (!isWriteVerbToken(token) || !isSubmitWriteToken(token)) continue;
    statusSuffixes[index] = matchesStatusSuffix(text, offsets[next[index]!]!);
  }
  return { offsets, text, next, previous, statusSuffixes };
}

/**
 * Record predicate prefixes and object boundaries in one pass. Adjacent
 * significant tokens and submission suffixes are indexed before the pass,
 * so a clause with many write candidates still takes linear time.
 */
const clauseAnalysisByTokens = new WeakMap<Token[], ClauseAnalysis[]>();

function analyzeClauses(tokens: Token[], splitAdditive = false): ClauseAnalysis[] {
  const cached = !splitAdditive && clauseAnalysisByTokens.get(tokens);
  if (cached) return cached;
  const clauses: ClauseAnalysis[] = [];
  const { offsets, text, next, previous, statusSuffixes } = clauseTokenContext(tokens);
  let predicates: ClausePredicate[] = [];
  let trailingQuestion = false;
  let hasCopula = false;
  let hasQuestionCopula = false;
  let hasUnknown = false;
  let blockedPrefix = false;
  let hasContent = false;
  let predicate: ClausePredicate | null = null;
  let baAt = -1;
  let objectHead = false;
  let pendingDe = false;
  let pendingStatusWrite = false;
  let objectEnds = true;
  let readGoverns = false;
  let clauseStart = 0;
  let hasHomework = false;
  let hasLmsName = false;
  let hasUnsupportedOwner = false;
  let inObjectModifier = false;
  let hasBlockedPredicate = false;

  const flush = (): void => {
    if (predicate) {
      predicate.objectEndsClause = objectEnds;
      predicates.push(predicate);
    }
    clauses.push({
      hasHomework, hasLmsName, hasUnsupportedOwner, hasBlockedPredicate,
      predicates, trailingQuestion, hasQuestionCopula, hasUnknown,
    });
  };
  const reset = (): void => {
    predicates = [];
    trailingQuestion = false;
    hasCopula = false;
    hasQuestionCopula = false;
    hasUnknown = false;
    blockedPrefix = false;
    hasContent = false;
    predicate = null;
    baAt = -1;
    objectHead = false;
    pendingDe = false;
    pendingStatusWrite = false;
    objectEnds = true;
    readGoverns = false;
    hasHomework = false;
    hasLmsName = false;
    hasUnsupportedOwner = false;
    inObjectModifier = false;
    hasBlockedPredicate = false;
  };

  const isStatusAspect = (index: number): boolean => !!statusSuffixes[next[index]!];
  const noteObjectToken = (token: Token, index: number, afterBaVerb = false): void => {
    const value = token.value.toLowerCase();
    if (isWhitespaceToken(token) || isTrailingClausePunct(token) || token.kind === 'filename') return;
    if (value === '嗎' || value === '呢' || value === '吧') {
      trailingQuestion = true;
      return;
    }
    if (READ_QUESTION_WORDS.has(value) || READ_QUESTION_WORDS.has(token.value)) {
      if (hasCopula) hasQuestionCopula = true;
      return;
    }
    if (COPULAS.has(value)) {
      hasCopula = true;
      if (predicate) predicate.residueCopula = true;
      return;
    }
    if (ACTION_COMPLETION_MARKERS.has(token.value) && !isStatusAspect(index)) {
      if (predicate) predicate.residueAspect = true;
      return;
    }
    if (token.kind === 'unknown') {
      hasUnknown = true;
      if (predicate) predicate.residueUnknown = true;
      return;
    }
    if (value === '的' || value === '之') {
      if (objectHead || afterBaVerb) pendingDe = true;
      return;
    }
    if (pendingDe) {
      const allowRead = predicate?.kind === 'read' || readGoverns;
      if (allowRead && isSubmitWriteToken(token)) {
        pendingStatusWrite = true;
        return;
      }
      if (allowRead && pendingStatusWrite && STATUS_NOUN.test(token.value)) {
        pendingDe = false;
        pendingStatusWrite = false;
        objectHead = true;
        return;
      }
      if (allowRead && (READ_OBJECT_HEADS.has(value) || READ_OBJECT_HEADS.has(token.value))) {
        pendingDe = false;
        pendingStatusWrite = false;
        objectHead = true;
        return;
      }
      objectEnds = false;
      pendingDe = false;
      pendingStatusWrite = false;
      return;
    }
    if (OBJECT_SPECIFIERS.has(value) || OBJECT_ADJUNCTS.has(value) || OBJECT_ADJUNCTS.has(token.value)) return;
    if (OBJECT_PREPOSITIONS.has(token.value) || OBJECT_PREPOSITIONS.has(value) || VERBAL_PARTICLES.has(token.value)) return;
    if (token.kind === 'neg' || DESCRIPTIVE_ACTION_PREFIXES.has(token.value)) return;
    objectHead = true;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (separatesClause(token, hasContent, predicate !== null) ||
      (splitAdditive && predicate && ADDITIVE_CONNECTOR_SET.has(token.value))) {
      if (token.value === '?' || token.value === '？') trailingQuestion = true;
      flush();
      reset();
      clauseStart = index + 1;
      continue;
    }
    if (isWhitespaceToken(token) || token.kind === 'punct' || /^\p{P}+$/u.test(token.value)) continue;
    hasContent ||= !isAllowedRequestPrefix(token);
    const value = token.value.toLowerCase();
    if (READ_QUESTION_WORDS.has(value) || READ_QUESTION_WORDS.has(token.value)) {
      if (hasCopula) hasQuestionCopula = true;
    }
    if (token.kind === 'unknown') hasUnknown = true;
    if (COPULAS.has(value)) hasCopula = true;
    if (value === '嗎' || value === '呢' || token.value === '?') trailingQuestion = true;

    hasHomework ||= DATA_TYPES[0].pattern.test(value);
    hasLmsName ||= LMS_NAMES.includes(value);
    const prev = tokens[previous[index]!];
    const following = tokens[next[index]!];
    if (value === '關於' || value === '含') inObjectModifier = true;
    if (value === '的' || value === '之') {
      const modifier = prev?.value.toLowerCase() ?? '';
      // Platform, status, and topic modifiers are already supported object syntax.
      const statusModifier = prev && isSubmitWriteToken(prev) && statusSuffixes[previous[index]!];
      const statusAttribute = prev && READ_OBJECT_HEADS.has(modifier) && statusSuffixes[next[index]!]?.governed;
      const topicModifier = inObjectModifier && (modifier === '含' || READ_OBJECT_HEADS.has(modifier));
      if (!topicModifier && !statusModifier && !statusAttribute && !LMS_NAMES.includes(modifier) &&
        !OBJECT_ADJUNCTS.has(modifier)) {
        hasUnsupportedOwner = true;
      }
      inObjectModifier = false;
    }

    if (BA_MARKERS.has(token.value) && !predicate && baAt < 0) {
      baAt = index;
      continue;
    }

    const kind = predicateKindOf(token);
    const suffix = statusSuffixes[index];
    if (kind === 'write' && suffix && baAt < 0) {
      const start = offsets[clauseStart]!;
      const end = prev && previous[index]! >= clauseStart ? offsets[previous[index]! + 1]! : start;
      const tail = text.slice(Math.max(start, end - PREFIX_ANCHOR_WINDOW), end);
      const shortPrefix = end - start <= PREFIX_ANCHOR_WINDOW ? text.slice(start, end).trimStart() : '';
      const statusPrefix = prev && (DESCRIPTIVE_ACTION_PREFIXES.has(prev.value) ||
        ACTION_COMPLETION_MARKERS.has(prev.value) || READ_QUESTION_WORDS.has(prev.value));
      if (!ADDITIVE_CUE.test(tail) && !WRITE_CUE.test(tail) &&
        ((suffix.homework && statusPrefix) || ((suffix.governed || suffix.question || suffix.deadline) &&
          (readGoverns || HOMEWORK_SUBJECT.test(shortPrefix) || LMS_SUBJECT.test(shortPrefix))))) {
        if (!predicate) blockedPrefix = true;
        noteObjectToken(token, index);
        continue;
      }
    }
    if (kind && kind !== 'write' &&
      (prev?.value === '的' || prev?.value === '之' || following?.value === '的' || following?.value === '之')) {
      hasBlockedPredicate = true;
      if (!predicate && baAt < 0) blockedPrefix = true;
      noteObjectToken(token, index);
      continue;
    }
    if (kind) {
      const followsPredicate: boolean = predicate !== null;
      if (predicate) {
        predicate.objectEndsClause = objectEnds;
        predicates.push(predicate);
      }
      predicate = {
        index, kind,
        blockedPrefix: blockedPrefix || followsPredicate || (baAt >= 0 && !objectEnds),
        objectEndsClause: true, residueCopula: false, residueAspect: false, residueUnknown: false,
      };
      objectHead = false;
      pendingDe = false;
      pendingStatusWrite = false;
      objectEnds = true;
      readGoverns ||= kind === 'read';
      continue;
    }

    if (predicate) {
      noteObjectToken(token, index, baAt >= 0);
      continue;
    }
    if (baAt >= 0) {
      noteObjectToken(token, index);
      continue;
    }
    if (!CLAUSE_REQUEST_HELPERS.has(value)) blockedPrefix = true;
  }
  flush();
  if (!splitAdditive) clauseAnalysisByTokens.set(tokens, clauses);
  return clauses;
}

function clauseAllowsQuestionCopula(clause: ClauseAnalysis): boolean {
  return clause.hasQuestionCopula || clause.trailingQuestion;
}

function isProvenPredicate(clause: ClauseAnalysis, predicate: ClausePredicate): boolean {
  if (predicate.blockedPrefix || !predicate.objectEndsClause || predicate.residueUnknown) return false;
  if (predicate.kind === 'read') {
    return !predicate.residueAspect && !clause.hasUnknown &&
      (!predicate.residueCopula || clauseAllowsQuestionCopula(clause));
  }
  return !predicate.residueCopula && !predicate.residueAspect;
}

function hasSkippedAction(clause: ClauseAnalysis): boolean {
  return clause.predicates.some(predicate =>
    predicate.kind !== 'read' && !isProvenPredicate(clause, predicate));
}

const provenIndexesByTokens = new WeakMap<Token[], Map<PredicateKind, Set<number>>>();

function provenPredicateIndexes(tokens: Token[], kind: PredicateKind): Set<number> {
  let byKind = provenIndexesByTokens.get(tokens);
  if (!byKind) {
    byKind = new Map();
    provenIndexesByTokens.set(tokens, byKind);
  }
  const cached = byKind.get(kind);
  if (cached) return cached;
  const proven = new Set<number>();
  for (const clause of analyzeClauses(tokens)) {
    for (const predicate of clause.predicates) {
      if (predicate.kind === kind && isProvenPredicate(clause, predicate)) proven.add(predicate.index);
    }
  }
  byKind.set(kind, proven);
  return proven;
}

export function tronClassReadRequestVerbs(): string[] {
  return QUERY_VERBS.filter(value =>
    !DOWNLOAD_ACTIONS.has(value) && !DOWNLOAD_ACTIONS.has(value.toLowerCase()) &&
    !isPrepareActionValue(value));
}


function isTrailingClausePunct(token: Token): boolean {
  return token.kind === 'punct' && /[?。！!]+/u.test(token.value);
}

export function tronClassAutoExecuteActionVerbs(): string[] {
  return [...DOWNLOAD_ACTIONS, ...PREPARE_ACTIONS, ...WRITE_VERB_SET];
}

function isDownloadCommand(tokens: Token[], index: number): boolean {
  if (!provenPredicateIndexes(tokens, 'download').has(index)) return false;
  return hasDownloadCommandTail(tokens, index);
}

function hasDownloadCommandTail(tokens: Token[], index: number): boolean {
  const next = nextSignificantToken(tokens, index);
  return !next || (next.value !== '的' && next.value !== '之' && !STATUS_NOUN.test(next.value));
}

function hasPositiveReadForm(text: string): boolean {
  const tokens = visibleCommandTokens(text);
  return analyzeClauses(tokens).some(clause => {
    if (!clause.hasLmsName || clause.hasUnsupportedOwner || clause.hasBlockedPredicate || hasSkippedAction(clause)) return false;
    const reads = clause.predicates.filter(predicate => predicate.kind === 'read' || predicate.kind === 'download');
    return reads.length > 0 && reads.every(predicate => isProvenPredicate(clause, predicate));
  });
}

/** A clearly-read clause needs a proven read or download verb. */
function isPositivelyProvenRead(text: string): boolean {
  const original = text.normalize('NFKC').trim();
  if (!original || !TRONCLASS_KEYWORD.test(original)) return false;
  if (hasReadBlockingDecoration(original) || hasDescriptiveAction(original)) return false;
  if (!allTokensKnown(original)) return false;
  const quoteMask = typographicQuoteMask(original);
  if (tokensFor(original).some(token => isNegatorToken(token) && !tokenIsProtected(token, quoteMask))) return false;
  if (writeCommandRoute(textWithoutQuotedSpans(original)) !== null) return false;
  if (scanNegation(tokensFor(original), modifierInteriorIndex(tokensFor(original))) !== 'clear') return false;
  return hasPositiveReadForm(original);
}

function clauseAllowsCompoundCompanion(clause: string): boolean {
  const text = clause.normalize('NFKC').trim();
  if (!text) return true;
  if (hasReadBlockingDecoration(text) || hasDescriptiveAction(text)) return false;
  if (hasHonoredPrepareCommand(text)) return false;
  if (isPositivelyProvenRead(text)) return true;
  if (OTHER_SERVICE_OR_SCHEDULE.test(text) && !TRONCLASS_KEYWORD.test(text)) {
    if (!allTokensKnown(text)) return false;
    if (tokensFor(text).some(isWriteVerbToken)) return false;
    return true;
  }
  if (!TRONCLASS_KEYWORD.test(text) && TRONCLASS_CONTINUATION.test(text) && allTokensKnown(text) &&
    writeCommandRoute(textWithoutQuotedSpans(text)) === null &&
    !tokensFor(text).some(isWriteVerbToken) &&
    (hasReadOrStatusPredicate(text) || hasDomainOrLmsSubstance(text)) &&
    scanNegation(tokensFor(text), modifierInteriorIndex(tokensFor(text))) === 'clear') {
    return true;
  }
  const bare = text.replace(/[?!.。]+$/u, '').trim();
  if (tronClassExplicitNavigationQuestion(text) || isTronClassNavigationTarget(bare) ||
    isTronClassNavigationTarget(bare.replace(/^(?:(?:請|麻煩)?(?:幫我|替我)?(?:開啟|打開|開|前往|進入))\s*/u, ''))) {
    return allTokensKnown(text);
  }
  if (!allTokensKnown(text)) return false;
  const unquoted = textWithoutQuotedSpans(text);
  const negation = scanNegation(tokensFor(text), modifierInteriorIndex(tokensFor(text)));
  if (negation === 'unresolved') return false;
  if (writeCommandRoute(unquoted) !== null) return false;
  if (tokensFor(text).some(isWriteVerbToken) && negation !== 'negated-write') return false;
  return negation === 'negated-write';
}

function hasUnprovenWrite(text: string): boolean {
  const tokens = tokensFor(text);
  return analyzeClauses(tokens).some(clause => clause.predicates.some(predicate =>
    predicate.kind === 'write' && !isProvenPredicate(clause, predicate) &&
    !isWriteNegatedAt(tokens, predicate.index)));
}

function wholeRequestAllowsCompoundRead(question: string): boolean {
  const original = question.normalize('NFKC').trim();
  if (hasTronClassReadTargetConflict(original)) return false;
  if (hasReadBlockingDecoration(original)) return false;
  if (hasHonoredPrepareCommand(original) || isTronClassCompoundDownloadAndPrepare(original)) return false;
  if (!allTokensKnown(original)) return false;
  if (classifyTronClassSentence(question)?.outcome === 'clearly-write') return false;
  if (hasUnprovenWrite(textWithoutQuotedSpans(original))) return false;
  const routingText = readRoutingText(original);
  if (hasDescriptiveAction(textWithoutQuotedSpans(routingText)) ||
    analyzeClauses(visibleCommandTokens(routingText)).some(clause => clause.hasUnsupportedOwner)) return false;
  const clauses = splitClauses(routingText);
  if (clauses.length === 0) return false;
  return clauses.every(clauseAllowsCompoundCompanion);
}

/**
 * For a multi-clause request, list the clauses the TronClass Agent should also
 * answer. The whole request still goes to the original cross-service planning
 * unchanged, so nothing it plans (navigation, calendar blocks, bus, notices…)
 * is lost; these clauses only add the private TronClass read beside it.
 * Explicit navigation stays with the planner, and a clause is never rewritten
 * into a write or a schedule.
 */
function parseTronClassCompound(question: string) {
  if (typeof question !== 'string' || !question.trim() || question.length > 1000 ||
    !TRONCLASS_KEYWORD.test(question) || !isMultiClauseRequest(question) ||
    tronClassExplicitNavigationQuestion(question) || !wholeRequestAllowsCompoundRead(question)) return null;
  const original = question.normalize('NFKC').trim();
  const routed = readRoutingText(original);
  if (!parseReadRequest(routed).hasOutsideQuotes(TRONCLASS_KEYWORD)) return null;
  // Keep the original target spans in every clause, including clauses that
  // deduplication will omit from the set of supplemental answers.
  const clauses = splitClauses(routed);
  const courseScopes: ReturnType<typeof readCourseScope>[] = [];
  const result: string[] = [];
  const seen = new Set<string>();
  let context = false;
  for (const clause of clauses) {
    let candidate: string | null = null;
    const target = parseReadRequest(clause);
    const continuation = target.hasOutsideQuotes(TRONCLASS_CONTINUATION) &&
      !tokensFor(clause).some(isNegatorToken);
    const explicitSource = target.hasOutsideQuotes(TRONCLASS_KEYWORD);
    if (explicitSource) {
      candidate = clause;
    } else if (continuation) {
      const predicates = analyzeClauses(visibleCommandTokens(clause))[0]?.predicates ?? [];
      const questionMark = clause.endsWith('?') ? '?' : '';
      candidate = predicates.some(predicate => predicate.kind === 'read' || predicate.kind === 'download')
        ? `${clause.slice(0, clause.length - questionMark.length)} 玩課雲${questionMark}`
        : `玩課雲${clause}`;
    }
    if (!candidate) continue;
    const courseScope = target.courseScope();
    // A course qualifier can contain a service word, even when the source is inherited.
    if (target.hasOutsideQuotes(OTHER_SERVICE_OR_SCHEDULE) &&
      !(target.intent === 'homework' && (explicitSource || isPositivelyProvenRead(candidate)))) continue;
    // Earlier companions can constrain the course. Supplemental answers still require established context.
    if (!context && !explicitSource) {
      courseScopes.push(courseScope);
      continue;
    }
    if (explicitSource) context = true;
    const bare = candidate.replace(/[?!.。]+$/u, '').trim();
    if (tronClassExplicitNavigationQuestion(candidate) || isTronClassNavigationTarget(bare) ||
      isTronClassNavigationTarget(bare.replace(/^(?:(?:請|麻煩)?(?:幫我|替我)?(?:開啟|打開|開|前往|進入))\s*/u, ''))) continue;
    courseScopes.push(courseScope);
    const parsed = parseTronClassAgentIntent(candidate);
    if (!parsed || parsed.intent === 'capabilities') continue;
    const key = `${parsed.intent}:${parsed.pendingOnly}:${parsed.unsupportedReason ?? ''}`;
    if (seen.has(key) || result.length >= MAX_COMPOUND_TRONCLASS_CLAUSES) continue;
    seen.add(key);
    result.push(candidate);
  }
  return { clauses: result, courseScopes };
}

export function tronClassCompoundClauses(question: string): string[] {
  return parseTronClassCompound(question)?.clauses ?? [];
}

export function tronClassAgentHomeworkScope(question: string, compoundQuestion?: string) {
  const compound = compoundQuestion === undefined ? null : parseTronClassCompound(compoundQuestion);
  if (compoundQuestion !== undefined && !compound?.clauses.includes(question)) return null;
  const scopes = compound?.courseScopes ?? [parseReadRequest(question).courseScope()];
  const qualifiers = scopes.filter(scope => !scope.overview);
  // An unqualified clause can inherit a course, but an explicit all-course
  // clause retains its own scope even when its supplemental answer is deduplicated.
  const requiresConfirmation = !!compound && scopes.some(scope => scope.explicitAll);
  return {
    overview: !compound && qualifiers.length === 0 && !isMultiClauseRequest(question),
    requiresConfirmation,
    matches: (name: string, code: string) => !requiresConfirmation && qualifiers.length > 0 &&
      qualifiers.every(scope => scope.matches(name, code)),
  };
}

function textWithoutFilenameTokens(text: string): string {
  const mask = dataTypeMask(text);
  const chars = text.split('');
  for (let index = 0; index < chars.length; index += 1) {
    if (mask[index]) chars[index] = ' ';
  }
  return chars.join('');
}

const DATA_TYPES = [
  { intent: 'homework', pattern: /作業|homework|assignments?/iu },
  { intent: 'announcements', pattern: /公告|通知|announcements?|notices?/iu },
  { intent: 'materials', pattern: /教材|講義|檔案|附件|materials?|handouts?|files?/iu },
  { intent: 'courses', pattern: /課程|修課|課表|courses?|classes/iu },
  { intent: 'unsupported', pattern: /測驗|考試/u },
  { intent: 'unsupported', pattern: /問卷/u },
] as const;

function parseReadRequest(question: string) {
  const text = question.normalize('NFKC').trim();
  const quotes = typographicQuoteSpans(text);
  const mask = dataTypeMask(text, false);
  const quoteEnds: number[] = [];
  for (const span of quotes) quoteEnds[span.open] = span.end;
  let quoteEnd = 0;
  let scanned = 0;
  const objectTypes = new Set<(typeof DATA_TYPES)[number]>();
  let hasContent = false;
  let directType: (typeof DATA_TYPES)[number] | undefined;
  let namedType: (typeof DATA_TYPES)[number] | undefined;
  let complementAt = text.length;
  let sawRead = false;
  let conflict = false;
  for (const token of tokensFor(text)) {
    while (scanned <= token.start) {
      quoteEnd = Math.max(quoteEnd, quoteEnds[scanned++] ?? 0);
    }
    const quoted = token.start < quoteEnd;
    if (!quoted && !tokenIsProtected(token, mask) &&
      separatesClause(token, hasContent, sawRead)) {
      if (/^[?!.。]$/u.test(token.value) && !text.slice(token.end).trim()) break;
      directType = namedType = undefined;
      objectTypes.clear();
      complementAt = text.length;
      sawRead = false;
      hasContent = false;
      continue;
    }
    if (token.kind === 'filename' || isWhitespaceToken(token) || token.kind === 'punct') continue;
    if (tokenIsProtected(token, mask)) continue;
    hasContent ||= !isAllowedRequestPrefix(token);
    const value = token.value.toLowerCase();
    const kind = predicateKindOf(token);
    sawRead ||= !quoted && (kind === 'read' || kind === 'download');
    // In 「查有沒有作業」 the question introduces the object. Once the
    // object names a data type, a following question can only qualify it.
    const copula = COPULAS.has(value) || value === '是不是' || value === '是什麼';
    const questionTail = READ_QUESTION_WORDS.has(value) || value === '有' || value === '嗎' || value === '呢';
    if (!quoted && complementAt === text.length && sawRead && (copula || (directType && questionTail))) {
      complementAt = token.start;
    }
    for (const type of DATA_TYPES) {
      if (!type.pattern.test(token.value)) continue;
      if (token.start < complementAt) {
        directType = type;
        if (!quoted) namedType = type;
        objectTypes.add(type);
      } else if (type !== directType || objectTypes.size > 1) {
        conflict = true;
      }
    }
  }
  const intent = namedType?.intent;
  return {
    intent, complementAt, conflict,
    courseScope: () => readCourseScope(text, quotes, intent, conflict),
    hasOutsideQuotes(pattern: RegExp, end = text.length): boolean {
      let start = 0;
      for (const quote of quotes) {
        if (quote.open >= end) break;
        if (pattern.test(text.slice(start, quote.open))) return true;
        start = quote.end;
      }
      return start < end && pattern.test(text.slice(start, end));
    },
  };
}

export function hasTronClassReadTargetConflict(question: string): boolean {
  if (typeof question !== 'string' || question.length > 1000 || !TRONCLASS_KEYWORD.test(question)) return false;
  return parseReadRequest(question).conflict;
}

const HOMEWORK_OVERVIEW_WORDS = new Set([
  ...LMS_NAMES, ...CLAUSE_REQUEST_HELPERS, ...STATUS_WRITE_COMPOUNDS,
  '我的', '我們的', '全部', '的', '之', '作業', '功課', 'homework', 'assignment', 'assignments',
  '課程', 'course', 'courses', '未', '尚未', '還沒', '待', 'pending', 'unsubmitted',
  '一下', '有', '嗎', '呢', ...READ_QUESTION_WORDS,
  '狀態', '紀錄', '記錄', '情況', '進度', '歷史', ...STATUS_PARTICLES,
  '繳交狀態', '提交狀態', '截止', '截止日', '截止日期', '截止時間', '期限', 'deadline',
  '我想', '我要', '我', '想', '要', '可以', '能不能', '把', '將', 'my', 'the', 'all',
]);

function isCourseReadFrame(text: string, intent?: TronClassAgentIntent, targetSpans: readonly QuoteSpan[] = []): boolean {
  let index = 0;
  return tokensFor(text).every(token => {
    while (targetSpans[index] && targetSpans[index]!.end <= token.start) index++;
    const target = targetSpans[index];
    if (target && token.start >= target.open && token.end <= target.end) return true;
    const predicate = predicateKindOf(token);
    return !token.value.trim() || token.kind === 'punct' || predicate === 'read' || predicate === 'prepare' ||
      HOMEWORK_OVERVIEW_WORDS.has(token.value.toLowerCase()) ||
      (intent !== 'homework' && DATA_TYPES.some(type => type.intent === intent && type.pattern.test(token.value))) ||
      (predicate === 'write' && matchesStatusSuffix(text, token.end) !== undefined);
  });
}

function readCourseScope(text: string, spans: readonly QuoteSpan[], intent: TronClassAgentIntent | undefined, conflict: boolean) {
  const quoted = spans.map(span => text.slice(span.inner, span.close));
  const normalizeTarget = (name: string) => name.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
  const targets = quoted.map(normalizeTarget);
  const complete = !conflict && !hasReadBlockingDecoration(text);
  const onlyQuotedTargets = spans.length > 0 && isCourseReadFrame(text, intent, spans);
  const overview = complete && spans.length === 0 && isCourseReadFrame(text.replace(/所有/g, '全部'), intent);
  return {
    quoted,
    overview,
    explicitAll: intent === 'homework' && overview && /全部|所有|\ball\b/iu.test(text),
    matches(...names: string[]): boolean {
      if (!complete) return false;
      const aliases = names.map(normalizeTarget).filter(Boolean);
      if (targets.length) return onlyQuotedTargets && targets.every(value => aliases.includes(value));
      return aliases.some(target => {
        if (target.length < 2) return false;
        const literal = new RegExp(Array.from(target, escapeRegex).join('\\s*'), 'u');
        const match = literal.exec(text.toLocaleLowerCase());
        // Retokenize the request frame at the boundary of an unquoted literal.
        return !!match && isCourseReadFrame(
          (text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length)).replace(/所有/g, '全部'), intent);
      });
    },
  };
}

export function isTronClassHomeworkOverview(question: string): boolean {
  const target = parseReadRequest(question);
  return (target.intent === 'homework' || target.intent === undefined) &&
    !isMultiClauseRequest(question) && target.courseScope().overview;
}

export function matchesTronClassHomeworkCourse(question: string, name: string): boolean {
  return parseReadRequest(question).courseScope().matches(name);
}

export function tronClassQuotedTargets(question: string): string[] {
  return parseReadRequest(question).courseScope().quoted;
}

export type TronClassAgentQueryIntent = {
  intent: TronClassAgentIntent;
  pendingOnly: boolean;
  unsupportedReason?: 'multiple_actions' | 'read_target_conflict';
};

export type TronClassSentenceClass =
  | { outcome: 'clearly-read'; intent: TronClassAgentQueryIntent }
  | { outcome: 'clearly-write'; intent: TronClassAgentQueryIntent | null }
  | { outcome: 'ambiguous' };


function isPrepareActionValue(value: string): boolean {
  return PREPARE_ACTIONS.has(value) || PREPARE_ACTIONS.has(value.toLowerCase());
}

function visibleCommandTokens(text: string): Token[] {
  const mask = dataTypeMask(text);
  return tokensFor(text).filter(token => token.kind !== 'filename' && !tokenIsProtected(token, mask));
}

function prepareWordRole(tokens: Token[], index: number): 'command' | 'modifier' | 'doubt' | 'none' {
  const token = tokens[index]!;
  if (!isPrepareActionValue(token.value)) return 'none';
  if (token.kind === 'noun') return 'modifier';
  const next = nextSignificantToken(tokens, index);
  const prev = previousSignificantToken(tokens, index);
  if (next && (next.value === '的' || next.value === '之')) return 'modifier';
  if (prev && (prev.value === '的' || prev.value === '之')) return 'modifier';
  return provenPredicateIndexes(tokens, 'prepare').has(index) ? 'command' : 'doubt';
}

function visiblePrepareRole(text: string, role: 'command' | 'modifier' | 'doubt'): boolean {
  const mask = dataTypeMask(text);
  const tokens = tokensFor(text);
  return tokens.some((token, index) =>
    token.kind !== 'filename' && !tokenIsProtected(token, mask) && prepareWordRole(tokens, index) === role);
}

/** Prepare/draft words are honored only as commands, never as a noun such as 作業草稿. */
function hasHonoredPrepareCommand(text: string): boolean {
  return visiblePrepareRole(text, 'command');
}

function hasDoubtfulPrepare(text: string): boolean {
  return visiblePrepareRole(text, 'doubt');
}

function hasNonPrepareQueryCommand(text: string): boolean {
  return visibleCommandTokens(text).some(token =>
    !isPrepareActionValue(token.value) && (token.kind === 'query' || QUERY_START.has(token.value)));
}

function readIntentOf(text: string, target: ReturnType<typeof parseReadRequest>): TronClassAgentQueryIntent {
  const at = target.complementAt;
  if (target.hasOutsideQuotes(/(?:能做什麼|可以做什麼|有哪些功能|支援什麼|支援哪些|功能範圍|代理權限|what\s+can|capabilit)/i, at)) {
    return { intent: 'capabilities', pendingOnly: false };
  }
  const dataIntent = target.intent;
  const pendingOnly = target.hasOutsideQuotes(
    /(?:未交|未繳|待交|待繳|待提交|尚未(?:交|繳|提交)|還沒(?:交|繳|提交)|沒(?:交|繳)|pending|unsubmitted|not\s+submitted)/i,
    dataIntent === 'homework' ? text.length : at);
  if (dataIntent === 'announcements') return { intent: 'announcements', pendingOnly: false };
  const tokens = visibleCommandTokens(text);
  const preparationRequested = hasHonoredPrepareCommand(text) && target.hasOutsideQuotes(/(?:作業|homework|assignment)/i, at);
  const preparation = preparationRequested && !hasNonPrepareQueryCommand(text);
  const downloading = tokens.some((token, index) =>
    DOWNLOAD_ACTIONS.has(token.value.toLowerCase()) && isDownloadCommand(tokens, index));
  if (preparationRequested && downloading) return { intent: 'unsupported', pendingOnly: false, unsupportedReason: 'multiple_actions' };
  if (dataIntent === 'unsupported' || target.hasOutsideQuotes(/測驗|考試|問卷/u, at)) {
    return { intent: 'unsupported', pendingOnly: false };
  }
  if (downloading) return { intent: 'download', pendingOnly: false };
  if (dataIntent === 'materials' || dataIntent === 'courses') {
    return { intent: dataIntent, pendingOnly: false };
  }
  if (preparation) return { intent: 'prepare', pendingOnly };
  if (pendingOnly) return { intent: 'homework', pendingOnly: true };
  if (target.hasOutsideQuotes(SUBMISSION_DEADLINE_QUERY, at)) return { intent: 'homework', pendingOnly: false };
  if (dataIntent) return { intent: dataIntent, pendingOnly: false };
  return { intent: 'capabilities', pendingOnly: false };
}

/** Identify a compound request for a selection reply only. */
export function isTronClassCompoundDownloadAndPrepare(question: string): boolean {
  if (typeof question !== 'string' || !question.trim() || question.length > 1000 ||
    !TRONCLASS_KEYWORD.test(question)) return false;
  const original = question.normalize('NFKC').trim();
  if (hasUnclosedQuote(original)) return false;
  const tokens = visibleCommandTokens(original);
  // Use the request grammar's prefix and predicate checks at each connector.
  let hasDownload = false;
  for (const clause of analyzeClauses(tokens, true)) {
    for (const predicate of clause.predicates) {
      if (!isProvenPredicate(clause, predicate)) continue;
      if (predicate.kind === 'prepare' && clause.hasHomework && hasDownload) return true;
      if (predicate.kind === 'download' && hasDownloadCommandTail(tokens, predicate.index)) hasDownload = true;
    }
  }
  return false;
}

/**
 * Classify a TronClass sentence as a clearly auto-readable request, a clearly
 * routed write (existing write or planner consent flow), or ambiguous. Ambiguous
 * requests never auto-read homework and never auto-write; they stay with the
 * existing planner / consent prompt so the student can confirm.
 */
export function classifyTronClassSentence(question: string): TronClassSentenceClass | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 1000 ||
    !TRONCLASS_KEYWORD.test(question)) return null;
  const original = question.normalize('NFKC').trim();
  if (isExistingTronClassNavigation(original)) return null;
  const originalTarget = parseReadRequest(original);
  if (hasUnclosedQuote(original) || originalTarget.conflict || originalTarget.hasOutsideQuotes(/[《》〈〉]/u)) {
    return { outcome: 'ambiguous' };
  }
  if (typographicQuoteSpans(original).length && analyzeClauses(tokensFor(textWithoutQuotedSpans(original, ' \uFFFC ')))
    .some(clause => clause.predicates.some(predicate => predicate.blockedPrefix))) return { outcome: 'ambiguous' };
  const unquotedText = textWithoutQuotedSpans(original);
  if (hasDescriptiveAction(unquotedText)) return { outcome: 'ambiguous' };
  const text = readRoutingText(original);
  const commandText = textWithoutQuotedSpans(text);
  const unquoted = textWithoutFilenameTokens(unquotedText);
  const tokens = tokensFor(original);
  const interior = modifierInteriorIndex(tokens);
  const negation = scanNegation(tokens, interior);
  if (negation === 'unresolved') return { outcome: 'ambiguous' };
  if (baConstructionState(unquoted) === 'unresolved') return { outcome: 'ambiguous' };
  if (writeLexiconAndRegexDisagree(unquoted)) return { outcome: 'ambiguous' };
  const writeRoute = writeCommandRoute(unquoted);
  if (writeRoute === 'ambiguous' || hasUnprovenWrite(unquoted)) return { outcome: 'ambiguous' };
  if (!authorizesPrivateRead(original)) {
    // Translation, quotation, explanation, or a negated query is not a write
    // command, even if a write-verb token appears as an example word.
    return { outcome: 'ambiguous' };
  }
  if (!allTokensKnown(original) && !allTokensKnown(unquoted)) return { outcome: 'ambiguous' };
  const hasBookTitle = /[《》〈〉]/u.test(original);
  if (hasBookTitle && (writeRoute || hasHonoredPrepareCommand(original))) return { outcome: 'ambiguous' };
  if (writeRoute === 'planner') return { outcome: 'clearly-write', intent: null };
  if (writeRoute === 'unsupported') return { outcome: 'clearly-write', intent: { intent: 'unsupported', pendingOnly: false } };
  if (!TRONCLASS_KEYWORD.test(text)) return { outcome: 'ambiguous' };
  const target = text === original ? originalTarget : parseReadRequest(text);
  if (target.conflict || analyzeClauses(visibleCommandTokens(text)).some(clause => clause.hasUnsupportedOwner)) {
    return { outcome: 'ambiguous' };
  }
  const intent = readIntentOf(text, target);
  if (hasReadBlockingDecoration(original) ||
    (hasBookTitle && intent.intent !== 'homework' && intent.intent !== 'courses')) return { outcome: 'ambiguous' };
  if (intent.intent === 'unsupported') {
    return hasPositiveReadForm(commandText) || hasHonoredPrepareCommand(commandText)
      ? { outcome: 'clearly-write', intent }
      : { outcome: 'ambiguous' };
  }
  // A query verb plus a prepare command in the same sentence is not a proven
  // read or a proven prepare; confirmation must run before either action.
  if (hasDoubtfulPrepare(original)) return { outcome: 'ambiguous' };
  if (visiblePrepareRole(original, 'modifier') && !hasNonPrepareQueryCommand(original)) {
    return { outcome: 'ambiguous' };
  }
  if (hasHonoredPrepareCommand(original) && hasNonPrepareQueryCommand(original)) {
    return { outcome: 'ambiguous' };
  }
  if (intent.intent === 'prepare' || intent.intent === 'download') {
    if (isTronClassCompoundDownloadAndPrepare(original)) return { outcome: 'ambiguous' };
    return { outcome: intent.intent === 'prepare' ? 'clearly-write' : 'clearly-read', intent };
  }
  if (!isPositivelyProvenRead(original) && !isPositivelyProvenRead(commandText)) return { outcome: 'ambiguous' };
  return { outcome: 'clearly-read', intent };
}

/**
 * This router sees only the user's current message. Course descriptions, notices,
 * history and model output must never be passed to it as commands.
 */
export function parseTronClassAgentIntent(question: string): TronClassAgentQueryIntent | null {
  const classified = classifyTronClassSentence(question);
  if (!classified || classified.outcome === 'ambiguous') return null;
  // Multi-clause requests stay with the planner; clearly-read clauses may still
  // be supplemented through tronClassCompoundClauses.
  if (isMultiClauseRequest(question.normalize('NFKC').trim())) return null;
  if (classified.outcome === 'clearly-write') return classified.intent;
  return classified.intent;
}

export function canAnswerTronClassQuestion(question: string): boolean {
  return parseTronClassAgentIntent(question) !== null;
}

