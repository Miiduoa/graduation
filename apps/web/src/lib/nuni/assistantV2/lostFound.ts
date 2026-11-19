import {
  NUNI_LOST_FOUND_CATEGORIES,
  parseNuniLostFoundResponse,
  validateNuniLostFoundRequest,
  type NuniLostFoundItem,
  type NuniLostFoundListInput,
} from '@campus/shared/src/nuniLostFound';
import { findSchoolById, mockSchools } from '@campus/shared/src/schools';
import { canonical, object, V2Error } from './contracts';

export type LostFoundArguments = Pick<NuniLostFoundListInput, 'q' | 'type' | 'category' | 'status' | 'mine' | 'limit'>;
export type LostFoundRead = {
  version: 1;
  source: 'platform-lost-found';
  schoolId: string;
  checkedAt: string;
  query: LostFoundArguments;
  status: 'ready' | 'unavailable';
  items: NuniLostFoundItem[];
  nextCursor: string | null;
  partial: boolean;
  href: string;
  unavailable?: 'NOT_CONNECTED' | 'SOURCE_UNAVAILABLE';
};

const ARGUMENTS = ['q', 'type', 'category', 'status', 'mine', 'limit'] as const;
const invalidInput = (): never => { throw new V2Error(422, 'LOST_FOUND_INVALID_INPUT'); };

/** The school is supplied by the verified assistant binding, never by a model.
 * Cursor pagination remains on the original page; each assistant read is bounded. */
export function lostFoundListInput(raw: unknown, schoolId: string): NuniLostFoundListInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(raw))) return invalidInput();
  const fields: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== 'string' || !ARGUMENTS.includes(key as typeof ARGUMENTS[number])) return invalidInput();
    const descriptor = Object.getOwnPropertyDescriptor(raw, key)!;
    if (!('value' in descriptor) || descriptor.value === undefined) return invalidInput();
    fields[key] = descriptor.value;
  }
  if (fields.limit !== undefined && (!Number.isInteger(fields.limit) || Number(fields.limit) < 1 || Number(fields.limit) > 5))
    return invalidInput();
  if (fields.q !== undefined && (typeof fields.q !== 'string' || !fields.q.trim() ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(fields.q))) return invalidInput();
  try {
    return validateNuniLostFoundRequest('list', { ...fields, schoolId, limit: fields.limit ?? 5,
      status: fields.status ?? (fields.mine === true ? 'all' : 'open') });
  } catch { return invalidInput(); }
}

export function lostFoundQuery(input: NuniLostFoundListInput): LostFoundArguments {
  return Object.fromEntries(ARGUMENTS.flatMap(key => input[key] === undefined ? [] : [[key, input[key]]])) as LostFoundArguments;
}

export function lostFoundHref(schoolId: string): string {
  return '/lost-found?' + new URLSearchParams({ schoolId, source: 'platform' });
}

const schoolNames = mockSchools.flatMap(school => [school.name, school.shortName, ...(school.aliases ?? [])])
  .filter((name): name is string => Boolean(name) && /\p{Script=Han}/u.test(name!));
const unsupported = /不要|不用|不必|不需要|先別|別幫|不是要|翻譯|假設|如果|例如|範例|每天|每日|每週|自動|持續|昨天|前天|今天|明天|本週|上週|這週|下週|本月|上月|今年|去年|\d{4}[-/]\d{1,2}|\d+月\d+日/;
const writeOrOther = /發布|刊登|新增|修改|編輯|刪除|下架|結案|撤回|匯出|聯絡|傳訊|通知|認領|領取|報名|帳號|其他學校|別校|跨校|所有學校|全部學校/;
const compound = /然後|接著|順便|並且|另外|同時|以及|也幫我|再幫我|並幫我|[，,；;。！!？?、\n]/;

/** Whole read grammar: every filter is retained, otherwise leave the request
 * on the conversational path. Possessing a lost item never means owning a post. */
export function parseLostFoundRead(question: string): { tool: 'get_lost_found'; args: LostFoundArguments } | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 240 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return null;
  let value = question.normalize('NFKC').trim().replace(/[。！？!?]+$/, '').trim();
  if (unsupported.test(value)) return null;
  value = value.replace(/^(?:(?:麻煩你|麻煩|請問|請|幫我|替我|我想|想)\s*)+/, '');
  const dropped = /^我的\s*(.+?)\s*(?:掉了|遺失了|不見了)$/.exec(value);
  if (dropped) {
    const q = keyword(dropped[1]);
    return q ? { tool: 'get_lost_found', args: { q, type: 'found' } } : null;
  }
  const reader = /^(?:(?:查詢|搜尋|搜索|查看|查一下|看一下|看看|列出|顯示|找|查|看)\s*)+/.exec(value);
  if (reader) value = value.slice(reader[0].length);
  const args: LostFoundArguments = {};
  const owned = /^(?:我|本人)(?:發布|刊登)的\s*/.exec(value);
  if (owned) { args.mine = true; value = value.slice(owned[0].length); }
  const status = /^(已結案|未結案|尋找中)的?\s*/.exec(value);
  if (status) { args.status = status[1] === '已結案' ? 'resolved' : 'open'; value = value.slice(status[0].length); }
  const generic = /^(?:校園|學校|本校)?\s*(失物招領|失物|招領|尋物)(?:\s*(?:有哪些|有什麼|資訊|資料))?(?:嗎|呢)?$/.exec(value);
  if (generic) {
    if (generic[1] === '招領') args.type = 'found';
    if (generic[1] === '尋物') args.type = 'lost';
    return { tool: 'get_lost_found', args };
  }
  if (!reader || compound.test(value)) return null;
  // An explicit keyword separator permits multiword and quoted item names.
  const prefixed = /^(?:校園|學校|本校)?\s*(失物招領|失物|招領|尋物)\s*(?:關鍵字\s*[:：]?|搜尋\s*[:：]?|[:：]|的)\s*(.+)$/.exec(value);
  const suffixed = /^(.+?)\s*的\s*(失物招領|招領|尋物)$/.exec(value);
  const match = prefixed ?? suffixed;
  if (!match) return null;
  const service = prefixed ? match[1] : match[2];
  const q = keyword(prefixed ? match[2] : match[1]);
  if (!q) return null;
  if (service === '招領') args.type = 'found';
  if (service === '尋物') args.type = 'lost';
  args.q = q;
  return { tool: 'get_lost_found', args };
}

function keyword(raw: string): string | null {
  let value = raw.trim();
  const quoted = /^(?:「([^「」]+)」|『([^『』]+)』|"([^"\n]+)")$/.exec(value);
  if (quoted) value = (quoted[1] ?? quoted[2] ?? quoted[3]).trim();
  if (!value || value.length > 100 || /[「」『』“”"'`<>]/.test(value) || compound.test(value) ||
      unsupported.test(value) || writeOrOther.test(value) ||
      /查詢|搜尋|搜索|查看|幫我|開啟|打開|前往|並|(?:和|與).*(?:查|找|看)|(?:的|在哪|在哪裡|怎麼|如何|嗎|呢)$/.test(value) ||
      (!quoted && (/^(?:我|你|他|她|本人|自己|我們|他們|別人|其他人|所有人)(?:的.*)?$/.test(value) ||
        /[和與]/.test(value) || schoolNames.some(name => value.includes(name))))) return null;
  return value;
}

/** Revalidate both the strict list response and its original query at every
 * trust boundary. Contact details or another source cannot become summaries. */
export function parseLostFoundResult(raw: unknown, schoolId: string, args: unknown = {}): LostFoundRead {
  try {
    const input = lostFoundListInput(args, schoolId);
    const value = object(raw, ['version', 'source', 'schoolId', 'checkedAt', 'query', 'status', 'items', 'nextCursor', 'partial', 'href', 'unavailable']);
    const query = lostFoundQuery(lostFoundListInput(value.query, schoolId));
    if (value.version !== 1 || value.source !== 'platform-lost-found' || value.schoolId !== schoolId ||
        canonical(query) !== canonical(lostFoundQuery(input)) || value.href !== lostFoundHref(schoolId) ||
        typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt)) ||
        new Date(value.checkedAt).toISOString() !== value.checkedAt ||
        !['ready', 'unavailable'].includes(String(value.status)) || typeof value.partial !== 'boolean') throw new Error('Invalid scope');
    const page = parseNuniLostFoundResponse('list', { schoolId: value.schoolId, items: value.items, nextCursor: value.nextCursor }, input);
    if (value.status === 'unavailable' ? !['NOT_CONNECTED', 'SOURCE_UNAVAILABLE'].includes(String(value.unavailable)) ||
      page.items.length > 0 || page.nextCursor !== null || value.partial
      : value.unavailable !== undefined || value.partial !== (page.nextCursor !== null)) throw new Error('Invalid coverage');
    return { version: 1, source: 'platform-lost-found', schoolId, checkedAt: value.checkedAt,
      query, status: value.status as LostFoundRead['status'], items: page.items, nextCursor: page.nextCursor,
      partial: value.partial, href: value.href as string,
      ...(value.unavailable ? { unavailable: value.unavailable as LostFoundRead['unavailable'] } : {}) };
  } catch { throw new V2Error(502, 'INVALID_LOST_FOUND_RESULT'); }
}

const categoryNames: Record<typeof NUNI_LOST_FOUND_CATEGORIES[number], string> = {
  electronics: '電子產品', cards: '卡片', documents: '證件文件', wallet: '錢包', clothing: '衣物',
  accessories: '配件', books: '書籍', keys: '鑰匙', other: '其他',
};
function excerpt(value: string, max: number): string {
  const plain = value.replace(/<[^>]*>/g, ' ').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ').trim().replace(/[\\`*_{}[\]()#+!>|]/g, '');
  return plain.length > max ? plain.slice(0, max - 1) + '…' : plain;
}

/** Source, query and incomplete coverage precede excerpts to survive the task
 * card's summary limit. User-authored post text is display data, never commands. */
export function formatLostFoundRead(read: LostFoundRead): string {
  const time = new Date(Date.parse(read.checkedAt) + 28800000).toISOString().slice(0, 16).replace('T', ' ');
  const query = read.query;
  const filters = [query.mine ? '我發布的刊登' : '所選校園的平台刊登',
    query.type === 'found' ? '招領' : query.type === 'lost' ? '尋物' : '尋物與招領',
    query.status === 'all' ? '含已結案' : query.status === 'resolved' ? '已結案' : '尋找中',
    ...(query.category ? ['分類：' + categoryNames[query.category as keyof typeof categoryNames]] : []),
    ...(query.q ? ['關鍵字：' + excerpt(query.q, 100)] : [])];
  const lines = [`校園：${findSchoolById(read.schoolId)?.name || read.schoolId}；查詢時間：${time}（台北）。`,
    `範圍：${filters.join('；')}。`, `來源：${read.href}`];
  if (read.status === 'unavailable') {
    lines.push(read.unavailable === 'NOT_CONNECTED' ? '平台失物招領目前尚未接通，無法確認搜尋結果。'
      : '平台失物招領來源暫時無法核對，請稍後重試。');
    return lines.join('\n');
  }
  if (read.partial) lines.push('仍有其他頁面未讀取，這是部分搜尋結果。');
  lines.push('已讀取平台刊登摘要，不含學校帳號的舊刊登或聯絡方式：');
  if (!read.items.length) lines.push('本次查詢範圍沒有符合的刊登；不代表校內沒有相關失物。');
  let shown = 0;
  for (const item of read.items) {
    const entry = `・${item.type === 'found' ? '招領' : '尋物'}｜${excerpt(item.title, 55)}｜${item.date}｜${item.status === 'open' ? '尋找中' : '已結案'}` +
      `\n地點：${excerpt(item.location, 40)}；摘要：${excerpt(item.description, 70)}` +
      `\n/lost-found/platform/${item.id}?${new URLSearchParams({ schoolId: read.schoolId })}`;
    if (shown >= 3 || lines.join('\n').length + entry.length > 1080) break;
    lines.push(entry);
    shown++;
  }
  if (shown < read.items.length) lines.push(`另有 ${read.items.length - shown} 筆已讀取摘要未展開，可至來源核對。`);
  return lines.join('\n');
}
