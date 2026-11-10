import type { NuniStudyAgenda } from '@campus/shared/src/nuniStudyAgenda';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { outsideAssignmentNames, parseAssignmentDeadlineWindow, withoutDeadlineConstraint } from './assignmentDeadlineWindow';
import { queryAssignmentDeadlines } from './queryAssignmentDeadlines';

type AttemptFilter = 'all' | 'pending' | 'attempted' | 'missing';
export type NuniQuizContext = { question: string; at: number; attempt?: AttemptFilter };
type Source = { courseId: string; id: string };
export type NuniQuizRow = {
  item: Source & { title: string; groupName: string; dueAt: string | null };
  due: number;
  submittedAt: string | null;
  state: 'open' | 'closed';
};
type Answer = { kind: 'clarify'; message: string; context?: NuniQuizContext }
  | { kind: 'results'; rows: NuniQuizRow[]; undatedOutsideWindow: number; context: NuniQuizContext };

const QUIZ = /測驗|小考|隨堂考|考試|期[中末]考|\bquiz\b/i;
const QUOTED = /「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"/g;
function clean(text: string) {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim().replace(/[?!。！，,]+$/u, '');
}

export function isNuniQuizQuestion(question: string): boolean {
  return QUIZ.test(outsideAssignmentNames(question));
}
export function isNuniQuizReferenceQuestion(question: string): boolean {
  return /^(?:那|這)(?:一)?(?:個|份|項|場)(?:(?:線上)?測驗|小考|隨堂考)?(?:我)?(?:有沒有|有|是否|是不是|已經|已|還沒|尚未|未)?(?:作答|交卷|寫)(?:過)?(?:了)?(?:嗎|沒|沒有)?$/u.test(clean(question));
}
export function isNuniQuizStatusFollowUp(question: string): boolean {
  return /^(?:那麼?|改看|改查)?(?:我(?:的)?)?(?:已經|已|還沒|尚未|未)(?:作答|交卷)(?:的)?(?:測驗|小考)?(?:有哪些|呢)?$/u.test(clean(question));
}
function requestedPeriod(question: string, now: number) {
  const text = clean(question).replace(/^(?:那麼?|改看|改查)/u, '').replace(/(?:的呢|呢|的)$/u, '');
  const period = parseAssignmentDeadlineWindow(text, now);
  return period && period !== 'clarify' && period.label === text ? text : null;
}
export function isNuniQuizDateFollowUp(question: string, now: number): boolean {
  return Boolean(requestedPeriod(question, now));
}

function iso(value: string | null): string | null {
  const ms = value ? parseTaipeiInstant(value) : null;
  return ms === null ? null : new Date(ms).toISOString();
}

// Adapt query vocabulary to the shared course/title filter, preserving literal assessment names.
function quizScope(question: string, titles: readonly string[]) {
  const names = [...new Set(titles)].filter((t) => t.length >= 2 && question.includes(t) && !/^(?:線上測驗|測驗|小考|隨堂考|考試)$/u.test(t))
    .sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const literal = new RegExp('(' + [QUOTED.source, ...names].join('|') + ')', 'g');
  return question.split(literal).map((part, i) => {
    if (i % 2 === 1) return /^[「『“"]/.test(part) ? part : '「' + part + '」';
    return part.replace(/這(?:一)?門課|這一科/g, '')
      .replace(/待(?:作)?答/g, '')
      .replace(/(?:我)?(?:有沒有|是否|已經|已|尚未|還沒|未)?(?:作答|交卷)(?:了沒(?:有)?|了嗎|過嗎|紀錄|記錄|過|了)?(?:的)?/g, '')
      .replace(/(?:線上)?(?:測驗|小考|隨堂考)|\bquiz\b/gi, '作業')
      .replace(/有(?:沒有)?作業(?:嗎)?/g, '有哪些作業')
      .replace(/(?:參考)?期限|到期日/g, '截止');
  }).join('');
}

/** Reads only the active student's loaded platform quiz rows. Opening a row is a separate UI action. */
export function queryNuniQuizzes(
  data: NuniStudyAgenda, question: string, now: number, source?: Source, previous?: NuniQuizContext,
): Answer {
  const intent = outsideAssignmentNames(clean(question));
  const clarify = (message: string): Answer => ({ kind: 'clarify', message });
  const reference = isNuniQuizReferenceQuestion(question);
  const statusOnly = isNuniQuizStatusFollowUp(question);
  const period = requestedPeriod(question, now);
  if (!isNuniQuizQuestion(question) && !reference && !(previous && (statusOnly || period))) {
    return clarify('請指定要查的課程、測驗名稱或參考期限。');
  }
  if (/翻譯|改寫|解題|規劃|安排|解析|幫我(?:做|寫|解|作答|答|交|送)|替我(?:做|寫|解|作答|答|交|送)|代(?:答|考|交)|自動(?:作答|交卷)|交卷[吧！!]|(?:我要|請|直接).{0,6}(?:提交|交卷|送出)|答案|解答|分數|成績|提醒|刪除|修改|幫我出題/.test(intent)) {
    return clarify('這裡可以查測驗與作答紀錄。請開啟原測驗頁處理作答或繳交。');
  }
  if (/考場|教室|地點|座位|開始|開考|開放時間|考多久|時長|考什麼|幾點考|何時考|什麼時候考|哪天考|幾號考|什麼時候有考試|考試時間|考試日期|監考/.test(intent) ||
      (/(?:何時|什麼時候|幾點|哪天|幾號)/.test(intent) && !/截止|期限|到期|交卷|作答紀錄/.test(intent)) ||
      (/考試|期[中末]考/.test(intent) && !/測驗|小考|隨堂考/.test(intent))) {
    return clarify('課程資料只提供線上測驗的參考期限與作答紀錄。開考時間和地點請查課程公告。');
  }

  if (/作業|功課/.test(intent) && /和|與|跟|及|還有|、/.test(intent)) {
    return clarify('請分別查詢作業或測驗，兩者的繳交與作答紀錄分開保存。');
  }

  const courses = new Map(data.workspaces.filter((w) => w.memberRole === 'student' && w.state === 'active')
    .map((w) => [w.id, w.title]));
  const list = !source && (/哪些|列出|幾(?:筆|個|份)|(?:已|尚未|還沒|未)(?:作答|交卷)的/.test(intent) || statusOnly);
  let attempt: AttemptFilter = 'all';
  if (period && previous) attempt = previous.attempt ?? 'all';
  else if (!source && /待(?:作)?答/.test(intent)) attempt = 'pending';
  else if (list && /(?:尚未|未|(?:還)?沒(?:有)?)(?:作答|交卷)/.test(intent)) attempt = 'missing';
  else if (list && /(?:已經|已)(?:作答|交卷)|有作答紀錄/.test(intent)) attempt = 'attempted';
  const context: NuniQuizContext = previous && period
    ? { question: period + ' ' + withoutDeadlineConstraint(previous.question), at: now, attempt }
    : previous && statusOnly ? { ...previous, attempt } : { question, at: now, attempt };
  if (/這(?:一)?門課|這一科/.test(outsideAssignmentNames(context.question)) && courses.size !== 1 && !source) {
    return clarify('請選一門課或輸入課名，再查這門課的測驗。');
  }
  if (reference && !source) return clarify('請先指定是哪個測驗，可輸入課程與測驗名稱，或選擇清單中的一筆。');
  const quizzes = data.tasks.filter((t) => t.kind === 'quiz' && courses.has(t.courseId) &&
    (!source || (t.courseId === source.courseId && t.id === source.id)));
  if (source && quizzes.length !== 1) return clarify('目前的課程清單無法核對原測驗，請重新查詢。');

  const named = quizzes.map((task) => ({ id: task.id, courseId: task.courseId,
    title: task.title, groupName: courses.get(task.courseId)!, dueAt: iso(task.dueAt),
    state: task.state, submittedAt: iso(task.submittedAt) }));
  const scope = source && reference ? '' : quizScope(context.question, named.map((row) => row.title));
  const lookup = queryAssignmentDeadlines(named.filter((row) => {
    switch (attempt) {
      case 'attempted': return row.submittedAt !== null;
      case 'missing': return row.submittedAt === null;
      case 'pending': return row.submittedAt === null && row.state === 'open';
      default: return true;
    }
  }), scope, context.at);
  if (lookup.kind === 'clarify') return { kind: 'clarify', message: '想查哪一天或哪一週的測驗參考期限？可以指定「明天」或「下週」。',
    context: { ...context, question: withoutDeadlineConstraint(context.question) } };
  if (!source && !lookup.scope) {
    const unknown = withoutDeadlineConstraint(outsideAssignmentNames(scope))
      .replace(/請問|我想知道|麻煩|幫我查|查詢|查看|列出|請|所有|全部|目前|這學期|我|的|有哪些|哪些|有沒有|有|作業|參考|截止|時間|到期|逾期|幾(?:項|份|個|筆)|紀錄|記錄|還|嗎|呢|了|沒|什麼時候|何時|幾點|哪天|是否|是|待|[？?。，,：:\s]/g, '');
    if (unknown) return clarify('請提供測驗或課程名稱，或把完整名稱加上引號再查詢。');
  }
  return { kind: 'results', rows: lookup.rows.map(({ item, due }) => ({
    item: { id: item.id, courseId: item.courseId, title: item.title, groupName: item.groupName, dueAt: item.dueAt },
    due, submittedAt: item.submittedAt, state: item.state,
  })), undatedOutsideWindow: lookup.window ? lookup.undated : 0, context };
}
