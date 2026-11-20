import { chineseOrDecimal } from './chineseOrDecimal';

export const ASSIGNMENT_PAGE_SIZE = 8;

function normalizedQuestion(question: string): string {
  return question.normalize('NFKC').replace(/\s+/g, '').replace(/[?!。！？，,、]+$/u, '');
}

export function assignmentOrdinal(question: string): number | null {
  const ordinal = /^(?:我(?:想|要)?(?:看|選)|(?:幫我)?(?:看|選)|就)?第([一二三四五六七八九十]|\d{1,2})(?:個|份|筆|項)(?:作業)?(?:呢|的(?:截止)?時間|什麼時候交|何時截止|幾點截止)?$/u;
  const match = normalizedQuestion(question).match(ordinal);
  return match ? chineseOrDecimal(match[1]) : null;
}

type PageChoice = 'next' | 'previous' | 'last' | number;

export function pageChoice(question: string): PageChoice | null {
  const text = normalizedQuestion(question);
  if (/^(?:(?:看|查看|顯示)?下一頁|還有(?:其他的?)?(?:呢|嗎)?|(?:再看)?更多(?:作業)?)$/u.test(text)) return 'next';
  if (/^(?:回到|返回|看)?(?:上|前)一頁$/u.test(text)) return 'previous';
  if (/^(?:跳到|回到|返回|看)?最後一頁$/u.test(text)) return 'last';
  const jump = text.match(/^(?:跳到|回到|返回|看)?第([零一二三四五六七八九十百千\d]+)頁$/u);
  return jump ? chineseOrDecimal(jump[1]) : null;
}

export function assignmentPageTarget(
  move: PageChoice, offset: number, total: number, itemLabel: '作業' | '測驗' = '作業',
): { offset: number } | { message: string } {
  const last = Math.max(1, Math.ceil(total / ASSIGNMENT_PAGE_SIZE));
  const current = 1 + offset / ASSIGNMENT_PAGE_SIZE;
  if (move === 'previous' && current === 1) return { message: '已經是第一頁了。' };
  if (move === 'next' && current === last) {
    return { message: '已經是最後一頁，符合條件的已同步' + itemLabel + '共 ' + total + ' 筆。' };
  }
  const target = move === 'next' ? current + 1 : move === 'previous' ? current - 1 : move === 'last' ? last : move;
  if (!Number.isInteger(target) || target < 1 || target > last) {
    return { message: '查詢結果共 ' + last + ' 頁，請選擇第 1 至 ' + last + ' 頁。' };
  }
  return { offset: (target - 1) * ASSIGNMENT_PAGE_SIZE };
}
