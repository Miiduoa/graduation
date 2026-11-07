import { parsePublicCourseFilters, type PublicCourseFilters } from './publicCourseFilters';

const filterHelp =
  '目前可指定一個「當天有課」的星期與一個精確學分數（0–40，最多兩位小數），例如「查清大星期三 3 學分的資料庫課程」。';
const dayPattern = /(?:星期|禮拜|週|周)\s*([一二三四五六日天1-7])(?:\s*(?:有課|上課))?/g;
const creditPattern = /([+-]?\d+(?:\.\d+)?|[零〇一二兩三四五六七八九十百點]+)\s*(?:個)?學分/g;
const digits: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function creditNumber(text: string): number | null {
  if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const [whole, fraction, extra] = text.split('點');
  if (
    extra !== undefined ||
    !/^(?:[一二兩三四]?十[一二三四五六七八九]?|[零〇一二兩三四五六七八九])$/.test(whole)
  )
    return null;
  let value: number;
  if (whole.includes('十')) {
    const [tens, units] = whole.split('十');
    value = (tens ? digits[tens] : 1) * 10 + (units ? digits[units] : 0);
  } else value = digits[whole];
  if (fraction !== undefined) {
    if (!/^[零〇一二三四五六七八九]{1,2}$/.test(fraction)) return null;
    value += Number('0.' + [...fraction].map((digit) => digits[digit]).join(''));
  }
  return Number(value.toFixed(2));
}

/** Extract only explicit, supported conditions; quoted course names stay literal. */
export function extractPublicCourseAssistantFilters(
  text: string,
): { text: string; filters: PublicCourseFilters } | { error: string } {
  const quoted = [...text.matchAll(/[「『“"][^「」『』“”"]*[」』”"]/g)];
  const marker = '\uFFFC';
  if (quoted.length > 1 || text.includes(marker)) return { error: filterHelp };
  let rest = quoted.length ? text.replace(quoted[0][0], marker) : text;
  const conditionText = rest;
  const days = [...rest.matchAll(dayPattern)];
  const credits = [...rest.matchAll(creditPattern)];
  if (!days.length && !credits.length) return { text, filters: {} };
  const hasComparison =
    /至少|最多|最少|以上|以下|以內|超過|少於|不到|介於|不等於|不低於|不高於|左右|大約|大概|差不多|接近|>=|<=|[><~～]/.test(
      rest,
    );
  const hasExclusion =
    /以外|之外|除了|排除|避開|不要|不是|不在|不含|只有|僅|限定|(?:^|[^有])沒有|(?:沒|無)(?:課|上課|開課)|不(?:上課|開課)|非\s*(?:星期|禮拜|週|周|(?:\d+(?:\.\d+)?|[零〇一二兩三四五六七八九十百點]+)\s*(?:個)?學分)/.test(
      rest,
    );
  const hasCalendarDate =
    /之前|之後|以前|以後|[上下本這](?:個)?(?:星期|禮拜|週|周)|今天|明天|後天|\d{1,2}\s*月\s*\d{1,2}(?:日|號)?/.test(
      rest,
    );
  if (
    days.length > 1 ||
    credits.length > 1 ||
    hasComparison ||
    hasExclusion ||
    hasCalendarDate ||
    /[0-9零〇一二兩三四五六七八九十]\s*(?:到|至|或|和|與|及|、|-)\s*[0-9零〇一二兩三四五六七八九十]/.test(
      rest,
    )
  ) {
    return { error: filterHelp + '日期、多日、範圍與排除條件尚未支援。' };
  }
  const filters: PublicCourseFilters = {};
  if (days.length) {
    const after = rest.slice(days[0].index! + days[0][0].length);
    const followedByCredits =
      /^(?:[+-]?\d+(?:\.\d+)?|[零〇一二兩三四五六七八九十百點]+)\s*(?:個)?學分/.test(after);
    if (
      (!followedByCredits && /^[一二三四五六日天1-7]/.test(after)) ||
      /^(?:前|後)(?:的|課|$)/.test(after)
    )
      return { error: filterHelp };
    const day = days[0][1];
    filters.weekday = /[1-7]/.test(day)
      ? Number(day)
      : day === '天'
        ? 7
        : '一二三四五六日'.indexOf(day) + 1;
    rest = rest.replace(dayPattern, ' ');
  }
  if (credits.length) {
    const before = conditionText.slice(0, credits[0].index);
    if (/[A-Za-z0-9.+/-]$/.test(before)) return { error: filterHelp };
    const value = creditNumber(credits[0][1]);
    if (value === null) return { error: filterHelp };
    filters.credits = value;
    rest = rest.replace(creditPattern, ' ');
  }
  if (!parsePublicCourseFilters(filters)) return { error: filterHelp };
  if (/星期|禮拜|週|周|學分/.test(rest)) return { error: filterHelp };
  rest = rest
    .trim()
    .replace(/^(?:有哪些|有沒有|有什麼|是否有)\s*/, '')
    .replace(/^[\s、,]*(?:(?:的|在|於|有)\s*)*/, '')
    .replace(/[\s、,]+/g, ' ')
    .trim()
    .replace(/^(?:有哪些|有沒有|有什麼|是否有)\s*/, '')
    .replace(/(?:的)?(?:公開開課|開課|課程|課)$/, '')
    .replace(/(?:的|有課|上課)$/, '')
    .trim();
  if (/^(?:所有|全部|清單|目錄)$/.test(rest)) rest = '';
  if (quoted.length) rest = rest.replace(marker, quoted[0][0]);
  return { text: rest, filters };
}
