import { ASSIGNMENT_PAGE_SIZE, type AssignmentPageRequest, type AssignmentRead, type OfflineCampusToolResult } from './offlineCampusTools';
import { validCampusSenseSnapshot, type CampusSenseSnapshot } from './campusSenseSnapshot';
import { confirmedTimestamp } from './campusStudyAgenda';
import { parseAssignmentDeadlineWindow } from './assignmentDeadlineWindow';
import { resolveCampusAssignmentTarget } from './campusAssignmentTarget';
import { assignmentDeadlineLabel } from './campusAssignmentQuery';

type FollowUp = { question: string; filter: string; page?: AssignmentPageRequest } | { reply: OfflineCampusToolResult };

const ordinal = /^(?:我(?:想|要)?(?:看|選)|(?:幫我)?(?:看|選)|就)?第([一二三四五六七八九十]|\d{1,2})(?:個|份|筆|項)(?:作業)?(?:呢|的(?:截止)?時間|什麼時候交|何時截止|幾點截止)?$/u;
const reminder = /^(?:這份(?:作業)?|這個(?:作業)?)?(?:請)?(?:幫我|替我|我要|我想)?(?:為這份(?:作業)?)?(?:設(?:定)?(?:一?個)?(?:截止)?提醒|提醒我)(?:交(?:這份)?作業)?$/u;

function chineseOrDecimal(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = '零一二三四五六七八九';
  if (value.length === 1 && digits.includes(value)) return digits.indexOf(value);
  const tens = value.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/u);
  return tens ? (tens[1] ? digits.indexOf(tens[1]) : 1) * 10 + (tens[2] ? digits.indexOf(tens[2]) : 0) : NaN;
}

function pageChoice(text: string): 'next' | 'previous' | 'last' | number | null {
  if (/^(?:(?:看|查看|顯示)?下一頁|還有(?:其他的?)?(?:呢|嗎)?|(?:再看)?更多(?:作業)?)$/u.test(text)) return 'next';
  if (/^(?:回到|返回|看)?(?:上|前)一頁$/u.test(text)) return 'previous';
  if (/^(?:跳到|回到|返回|看)?最後一頁$/u.test(text)) return 'last';
  const jump = text.match(/^(?:跳到|回到|返回|看)?第([零一二三四五六七八九十百千\d]+)頁$/u);
  return jump ? chineseOrDecimal(jump[1]) : null;
}

export function assignmentFollowUp(
  question: string,
  previous: AssignmentRead | undefined,
  snapshot: CampusSenseSnapshot | null,
  now: number,
): FollowUp | null {
  if (!previous) return null;
  const text = question.normalize('NFKC').replace(/\s+/g, '').replace(/[?!。！？，,、]+$/u, '');
  const period = text.replace(/^(?:那麼?|改看|改查)/u, '').replace(/(?:的呢|呢|的)$/u, '');
  const window = parseAssignmentDeadlineWindow(period, now);
  const clarifyDate = window === 'clarify' && /^[上下本這個和與或及還是、未來接下周週星期禮拜昨今明後天日末一二兩三四五六七八九十年月號至到以之前年內0-9/-]+$/u.test(period);
  const date = window && window !== 'clarify' && window.label === period;
  const choice = text.match(ordinal);
  const wantsReminder = reminder.test(text);
  const move = pageChoice(text);
  if (!date && !clarifyDate && !choice && !wantsReminder && move === null) return null;

  const reply = (content: string, assignmentRead?: AssignmentRead): FollowUp => ({
    reply: { content, tool: assignmentRead ? 'campus-snapshot' : 'online-required', route: '/classroom',
      ...(assignmentRead ? { assignmentRead } : {}) },
  });
  const scope = { uid: previous.userId, schoolId: previous.schoolId };
  if (!Number.isFinite(now) || !validCampusSenseSnapshot(snapshot, scope, now) ||
      snapshot.checkedAt !== previous.checkedAt || snapshot.assignments.status !== 'available') {
    return reply('上次查詢的作業清單已失效。請重新同步校園資料，再查一次作業。');
  }
  if (clarifyDate) return reply('想查哪一天或哪一週？可以回覆「下週五」或「下週」。', previous);
  if (date) return { question: period + '有哪些待交作業？', filter: previous.filterQuestion };

  // Match the displayed order to the same authorized rows. Conversation text
  // never supplies an assignment ID, deadline, or permission to act.
  const rows = previous.items.map((item) => snapshot.assignments.items.find((row) =>
    row.title === item.title && row.groupName === item.groupName && row.dueAt === item.dueAt &&
    row.source?.groupId === item.source?.groupId && row.source?.assignmentId === item.source?.assignmentId));
  if (rows.some((row) => !row)) return reply('作業清單已有異動，請重新查詢後再選擇。');
  if (move !== null) {
    const page = previous.page;
    if (!page) return reply('這則回覆只有一頁。可以輸入其他課程或作業名稱重新查詢。', previous);
    const last = Math.ceil(page.total / ASSIGNMENT_PAGE_SIZE);
    const current = 1 + page.offset / ASSIGNMENT_PAGE_SIZE;
    if (move === 'previous' && current === 1) return reply('已經是第一頁了。', previous);
    if (move === 'next' && current === last) return reply('已經是最後一頁，符合條件的已同步作業共 ' + page.total + ' 筆。', previous);
    const target = move === 'next' ? current + 1 : move === 'previous' ? current - 1 : move === 'last' ? last : move;
    if (!Number.isInteger(target) || target < 1 || target > last) {
      return reply('查詢結果共 ' + last + ' 頁，請選擇第 1 至 ' + last + ' 頁。', previous);
    }
    return { question: page.question, filter: previous.filterQuestion, page: {
      offset: (target - 1) * ASSIGNMENT_PAGE_SIZE, asOf: page.asOf,
      ...(previous.reviewReminder ? { reviewReminder: true } : {}),
    } };
  }
  if (!rows.length) return reply('上一個查詢沒有列出可選的作業，請輸入課程或作業名稱重新查詢。', previous);
  if (!choice && rows.length > 1) {
    return reply('要為哪一份作業設定提醒？請點選作業，或回覆「第幾筆」。', { ...previous, reviewReminder: true });
  }
  const number = choice && chineseOrDecimal(choice[1]);
  const row = rows[(number ?? 1) - 1];
  if (!row) return reply('上次只列出 ' + rows.length + ' 筆作業，請選擇清單內的編號。', previous);
  const due = confirmedTimestamp(row.dueAt);
  const description = [row.groupName, row.title,
    assignmentDeadlineLabel({ ...row, dueAt: Number.isFinite(due) ? row.dueAt : null }, now)].filter(Boolean).join('｜');
  const reviewReminder = wantsReminder || previous.reviewReminder;
  const selected = { ...previous, page: undefined, items: [row], reviewReminder };
  if (!reviewReminder) return reply(description, selected);
  const target = resolveCampusAssignmentTarget({ assignment: row, snapshot, now,
    scope: { uid: snapshot.userId, schoolId: snapshot.schoolId } });
  const next = !target || !Number.isFinite(due) ? '請先到課程頁核對作業來源與截止時間。'
    : due <= now + 61 * 60_000 ? '距離截止不足以設定提前一小時的提醒，請到課程頁核對。'
    : '請核對下方的提醒時間與設定狀態。';
  return reply(description + '\n' + next, selected);
}
