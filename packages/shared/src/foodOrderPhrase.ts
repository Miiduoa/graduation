import { NUNI_FOOD_LIMITS, type NuniFoodMenuItem } from './nuniFood';

type DraftLine = { itemId: string; quantity: number };
type PhraseResult = { ok: true; lines: DraftLine[] } | { ok: false; message: string };

export const FOOD_ORDER_PHRASE_MAX_LENGTH = 300;
const digits = '零一二三四五六七八九';
const quantityCharacters = '0123456789兩十' + digits;
const formatHint =
  '請用菜單上的完整品名，例如「雞腿飯兩份、紅茶一杯」。加入後可在各餐點下選口味、填備註。';
const normalize = (text: string) => text.normalize('NFKC').trim().toLowerCase();
const prefixQuantity = /^([0-9零一二兩三四五六七八九十]+)\s*[份杯碗盒個包組]\s*/u;
const multiplier = /[x×]\s*([0-9]+)$/u;

function quantity(value: string): number {
  if (/^[0-9]+$/.test(value)) return Number(value);
  const word = value.replace(/兩/g, '二');
  if (word.length === 1 && digits.includes(word)) return digits.indexOf(word);
  const tens = /^([一二三四五六七八九]?)十([一二三四五六七八九]?)$/u.exec(word);
  if (!tens) return NaN;
  return (tens[1] ? digits.indexOf(tens[1]) : 1) * 10 + (tens[2] ? digits.indexOf(tens[2]) : 0);
}

// Every reading consumes the entire term. Unknown options and extra instructions cannot disappear.
function* readings(term: string): Generator<[string, number]> {
  yield [term, 1];
  const prefix = prefixQuantity.exec(term);
  if (prefix) yield [term.slice(prefix[0].length), quantity(prefix[1])];
  const times = multiplier.exec(term);
  if (times) yield [term.slice(0, times.index).trimEnd(), Number(times[1])];

  if (/[份杯碗盒個包組]$/u.test(term)) {
    const body = term.slice(0, -1).trimEnd();
    // Names can end in digits too. Both “A × 11” and “A1 × 1” would fit “A11份”.
    for (let i = body.length - 1; i >= 1 && quantityCharacters.includes(body[i]); i--) {
      yield [body.slice(0, i).trimEnd(), quantity(body.slice(i))];
    }
  }
}

export function parseFoodOrderPhrase(
  text: string,
  items: readonly NuniFoodMenuItem[],
): PhraseResult {
  if (text.length > FOOD_ORDER_PHRASE_MAX_LENGTH || !text.trim())
    return { ok: false, message: formatHint };
  const phrase = normalize(text)
    .replace(/^(?:請幫我點|幫我點|我想要|我要點|我要|我想點|請給我|給我)\s*/u, '')
    .replace(/[。!！]$/u, '')
    .trim();
  if (!phrase) return { ok: false, message: formatHint };
  const menu = new Map<string, NuniFoodMenuItem | null>();
  for (const item of items) {
    const name = normalize(item.name);
    if (name) menu.set(name, menu.has(name) ? null : item);
  }
  const boundaries = Array.from(phrase.matchAll(/[,、+\n和跟]/gu), (match) => match.index);
  boundaries.push(phrase.length);

  const lines: DraftLine[] = [];
  let start = 0;
  while (start < phrase.length) {
    let next: { item: NuniFoodMenuItem; count: number; end: number } | undefined;
    // Check every possible end of this term. A separator can also occur inside a menu name.
    for (const end of boundaries) {
      if (end <= start) continue;
      const term = phrase.slice(start, end).trim();
      for (const [name, count] of readings(term)) {
        const item = menu.get(name);
        if (item === undefined) continue;
        if (!item || next)
          return { ok: false, message: '這個說法對應到不同餐點，請從菜單逐項選擇。' };
        next = { item, count, end };
      }
    }
    if (!next) return { ok: false, message: formatHint };
    const { item, count, end } = next;
    if (!item.available || !item.allowedActions.includes('add-to-quote')) {
      return { ok: false, message: `「${item.name}」目前無法加入購物車，請改選其他餐點。` };
    }
    if (!Number.isSafeInteger(count) || count < 1 || count > NUNI_FOOD_LIMITS.maxQuantityPerLine) {
      return {
        ok: false,
        message: `「${item.name}」請填 1 至 ${NUNI_FOOD_LIMITS.maxQuantityPerLine} 份。`,
      };
    }
    if (lines.some((line) => line.itemId === item.id)) {
      return { ok: false, message: `「${item.name}」重複出現了，請合併成一個數量。` };
    }
    if (lines.length >= NUNI_FOOD_LIMITS.maxQuoteLines) {
      return { ok: false, message: `一筆最多可選 ${NUNI_FOOD_LIMITS.maxQuoteLines} 種餐點。` };
    }
    lines.push({ itemId: item.id, quantity: count });
    if (end === phrase.length - 1) return { ok: false, message: formatHint };
    start = end + 1;
  }
  return { ok: true, lines };
}

/** Only touched lines are returned, with their quantities after adding the phrase. */
export function previewFoodOrderAddition(
  text: string,
  items: readonly NuniFoodMenuItem[],
  basket: ReadonlyMap<string, number>,
): { ok: true; lines: (DraftLine & { name: string })[] } | { ok: false; message: string } {
  const parsed = parseFoodOrderPhrase(text, items);
  if (parsed.ok === false) return parsed;
  const names = new Map<string, string | null>();
  for (const item of items) names.set(item.id, names.has(item.id) ? null : item.name);
  const lines = [];
  let size = basket.size;
  for (const { itemId, quantity } of parsed.lines) {
    const name = names.get(itemId);
    if (!name) return { ok: false, message: '菜單品項重複，請更新菜單後再試。' };
    const current = basket.get(itemId);
    if (current !== undefined && (!Number.isSafeInteger(current) || current < 1)) {
      return { ok: false, message: `請先調整「${name}」目前的份數。` };
    }
    const total = (current ?? 0) + quantity;
    if (total > NUNI_FOOD_LIMITS.maxQuantityPerLine) {
      return {
        ok: false,
        message: `${name}加入後會超過每項 ${NUNI_FOOD_LIMITS.maxQuantityPerLine} 份的上限。`,
      };
    }
    if (current === undefined) size++;
    lines.push({ itemId, name, quantity: total });
  }
  if (size > NUNI_FOOD_LIMITS.maxQuoteLines) {
    return {
      ok: false,
      message: `每筆訂單最多選 ${NUNI_FOOD_LIMITS.maxQuoteLines} 種餐點，請減少品項。`,
    };
  }
  return { ok: true, lines };
}
