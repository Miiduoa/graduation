import { confirmedTimestamp, taipeiDayNumber, type AgendaAssignment } from './campusStudyAgenda';
import {
  outsideAssignmentNames, parseAssignmentDeadlineWindow, stripAssignmentDeadlinePeriods, withoutDeadlineConstraint,
  type AssignmentDeadlineWindow,
} from './assignmentDeadlineWindow';
import { filterAssignmentQuery } from './assignmentQueryFilter';

// A bare “截止” could refer to event registration, library loans, or another service.
export function asksForAssignments(question: string): boolean {
  if (!/作業|功課|報告|習題|測驗/.test(question) &&
      /借閱|還書|圖書館|報名|活動|繳費|學費|帳單|註冊|住宿|水費|電費/.test(question)) return false;
  return /作業|功課|待交|待繳/.test(question) ||
    /(?:報告|習題|測驗).*(?:繳交期限|截止|到期)|(?:哪天|幾號|何時|什麼時候|幾點)(?:要|得|需|必須)?(?:繳交|繳|交)/.test(question);
}

// When a saved name directly precedes a due-date question, a weekday inside that name
// belongs to the title (“星期一報告什麼時候交”), even if its actual deadline is on Friday.
function protectCalendarTitle(question: string, items: readonly AgendaAssignment[]): string {
  const prefix = question.match(/^(.*?)(?:的)?(?:什麼時候|何時|幾點|幾號|哪天|哪一天)(?:要|得|需)?(?:繳交|交|繳|截止|到期)/)?.[1];
  if (!prefix || prefix === stripAssignmentDeadlinePeriods(prefix)) return question;
  const title = items.reduce((best, item) =>
    item.title.length > best.length && prefix.endsWith(item.title) ? item.title : best, '');
  if (!title || title === stripAssignmentDeadlinePeriods(title)) return question;
  return prefix.slice(0, -title.length) + '「' + title + '」' + question.slice(prefix.length);
}

/** A standalone pending-work lookup; multi-service, writing and planning requests go to their own workflows. */
export function isAssignmentDeadlineQuestion(question: string): boolean {
  const intent = outsideAssignmentNames(question.trim().slice(0, 1600));
  if (/公告|通知|提醒|課表|空堂|安排|規劃|計畫|翻譯|翻成|改寫|潤飾|寫一篇|怎麼寫|幫我寫|解釋|什麼意思|什麼是|造句|分數|成績|上傳|批改|評分/.test(intent)) return false;
  if (/已(?:經)?[交繳]|[交繳]了(?:沒|嗎)|是否已[交繳]|代交|自動繳交|(?:幫我|替我|請|我要).{0,8}(?:提交|[繳交](?:交)?(?:這份|這個)?作業|刪除|修改)/.test(intent)) return false;
  return asksForAssignments(intent) && /截止|期限|逾期|到期|哪(?:些|幾|天|時|一)|何時|什麼時候|幾(?:點|號|份|個|筆)|待[交繳]|還沒[交繳]|未[交繳]|有(?:沒有|哪些|什麼)|(?:作業|功課)[？?。！!]*$/.test(intent.trim());
}

type DeadlineQuery<T> =
  | { kind: 'clarify'; filterQuestion: string }
  | { kind: 'results'; rows: Array<{ item: T; due: number }>; scope: string | null;
      window: AssignmentDeadlineWindow | null; status: string; undated: number };

/** Select from the complete authorized input before any UI pagination. An empty query only sorts the rows. */
export function queryAssignmentDeadlines<T extends AgendaAssignment>(
  items: readonly T[], question: string, now: number, filterQuestion = question,
): DeadlineQuery<T> {
  const filterText = protectCalendarTitle(filterQuestion, items);
  const window = parseAssignmentDeadlineWindow(question === filterQuestion ? filterText : question, now);
  if (window === 'clarify') return { kind: 'clarify', filterQuestion: withoutDeadlineConstraint(filterText) };
  const filtered = filterText ? filterAssignmentQuery(filterText, items) : { scope: null, items };
  const dated = filtered.items.map((item) => ({ item, due: confirmedTimestamp(item.dueAt) }));
  const qualifier = outsideAssignmentNames(filterQuestion);
  const status = /(?:沒有|未提供|沒有提供|未確認)(?:截止日期|截止時間|期限)|(?:截止日期|截止時間|期限)(?:未提供|未確認)/.test(qualifier)
    ? '期限未確認' : /(?:未|還沒|尚未)逾期/.test(qualifier)
      ? '尚未逾期' : /逾期|期限已過/.test(qualifier) ? '已逾期' : '';
  const rows = dated.filter(({ due }) => {
    if (status === '期限未確認' && Number.isFinite(due)) return false;
    if (status === '已逾期' && !(due < now)) return false;
    if (status === '尚未逾期' && !(due >= now)) return false;
    if (!window) return true;
    const day = taipeiDayNumber(due);
    return day >= window.startDay && day < window.endDay &&
      (!/未來|接下來/.test(window.label) || due >= now);
  }).sort((a, b) =>
    (Number.isFinite(a.due) ? a.due : Infinity) - (Number.isFinite(b.due) ? b.due : Infinity));
  const undated = dated.filter(({ due }) => !Number.isFinite(due)).length;
  return { kind: 'results', rows, scope: filtered.scope, window, status, undated };
}
