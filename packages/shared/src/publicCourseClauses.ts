const CONNECTORS = ['然後', '接著', '順便', '並且', '另外', '同時', '以及', '也幫我', '再幫我', '並幫我'];
const CLOSE_QUOTE: Record<string, string> = { '「': '」', '『': '』', '“': '”', '"': '"', '(': ')' };
const SCHOOL_SUFFIX = /^(?:(?:國立)?(?:清華大學|暨南國際大學)|清大|清華|暨大|暨南(?:大學)?|NTHU|NCNU)(?:的)?[?!.]*$/i;
const COMMAND = /^(?:(?:請|幫我|替我|麻煩)\s*)?(?:查詢|查看|查|找|搜尋|列出|安排|規劃|開啟|打開|比較|整理|幫我)/;
const SERVICE_COMMAND = /^(?:(?:請|幫我|替我|麻煩)\s*)?(?:查詢|查看|查|找|搜尋|列出|安排|規劃|開啟|打開)\s*(?:我的|本人|本校|今天|明天|清大|清華|暨大|暨南|NTHU|NCNU|公車|餐廳|訂單|課表|行事曆|教材|作業|測驗|社團)/i;
const FILTER_PREFIX = /^(?:(?:星期|禮拜|週|周)\s*[一二三四五六日天1-7](?:\s*(?:有課|上課))?\s*|(?:\d+(?:\.\d+)?|[零〇一二兩三四五六七八九十百點]+)\s*(?:個)?學分\s*|的\s*|在\s*)+/;

/** Split only outside quoted course names. Keep every unrecognized clause for
 * the caller; a recognized public lookup cannot consume the rest of a request.
 * 和/與 remain in course names unless a complete first request or an explicit
 * service command makes the next task unambiguous.
 */
export function splitPublicCourseClauses(question: string): string[] | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 2000 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return null;
  const text = question.normalize('NFKC').trim();
  const clauses: string[] = [];
  const quotes: string[] = [];
  let current = '';
  const append = () => {
    const value = current.trim();
    if (value) clauses.push(value);
    current = '';
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quotes.length) {
      current += character;
      if (character === quotes.at(-1)) quotes.pop();
      else if (CLOSE_QUOTE[character] && character !== '"') quotes.push(CLOSE_QUOTE[character]);
      continue;
    }
    if (CLOSE_QUOTE[character]) {
      quotes.push(CLOSE_QUOTE[character]); current += character; continue;
    }
    if (/[」』”)]/.test(character)) return null;
    const rest = text.slice(index);
    const connector = CONNECTORS.find(word => rest.startsWith(word));
    const completeCourse = /(?:課程|開課|課|\bcourses?)$/i.test(current.trim());
    const explicitAnd = /^[和與]/.test(rest) && (
      SERVICE_COMMAND.test(rest.slice(1)) || /^[和與](?:請|幫我|替我|麻煩)/.test(rest) ||
      (completeCourse && (COMMAND.test(rest.slice(1)) ||
        /^[和與](?:公車|餐廳|訂單|課表|行事曆|教材|作業|測驗|社團)(?:$|[,;。!?、])/.test(rest)))
    ) ? character : undefined;
    const english = (index === 0 || /\s/.test(text[index - 1]))
      ? /^(?:and\s+)?(?:then|also)\s+/i.exec(rest)?.[0] ??
        ((completeCourse || /^and\s+(?:check|find|search|list|show|open|plan|look)\s+(?:my|buses?|transit|dining|calendar|NTHU|NCNU)\b/i.test(rest))
          ? /^and\s+(?=(?:check|find|search|list|show|open|plan|look)\b)/i.exec(rest)?.[0] : undefined)
      : undefined;
    const delimiter = connector ?? explicitAnd ?? english;
    if (delimiter) {
      if (!text.slice(index + delimiter.length).trim()) return null;
      if (!clauses.length && !current.trim()) return null;
      append(); index += delimiter.length - 1; continue;
    }
    if (/[,;。!?、]/.test(character)) {
      const tail = text.slice(index + 1).trim();
      // A terminal campus suffix is part of the established single lookup.
      if (character === ',' && SCHOOL_SUFFIX.test(tail)) { current += character; continue; }
      // A comma within an explicit filter prefix is punctuation, not a task.
      if ((character === ',' || character === '、') &&
          /^(?:(?:星期|禮拜|週|周)\s*[一二三四五六日天1-7]|(?:\d+(?:\.\d+)?|[零〇一二兩三四五六七八九十百點]+)\s*(?:個)?學分)/.test(tail)) {
        const nextPart = tail.split(/[,;。!?、]|然後|接著|順便|並且|另外|同時|以及|也幫我|再幫我|並幫我/, 1)[0];
        const remainder = nextPart.replace(FILTER_PREFIX, '').trim();
        const previousIsPrefix = /(?:(?:星期|禮拜|週|周)\s*[一二三四五六日天1-7](?:\s*(?:有課|上課))?|學分|清大|清華(?:大學)?|暨大|暨南(?:國際大學|大學)?|NTHU|NCNU)(?:的)?$/i.test(current.trim());
        // A date before a new task belongs to that task, never to the course filter.
        if (!remainder || (previousIsPrefix && !COMMAND.test(remainder))) {
          current += character; continue;
        }
      }
      append(); continue;
    }
    current += character;
  }
  if (quotes.length) return null;
  append();
  return clauses.length ? clauses : null;
}
