import {
  studyTaskStatus,
  type NuniStudyAgenda,
} from '@campus/shared/src/nuniStudyAgenda';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import {
  outsideAssignmentNames, parseAssignmentDeadlineWindow, withoutDeadlineConstraint,
  type AssignmentDeadlineWindow,
} from './assignmentDeadlineWindow';
import { taipeiDayNumber } from './campusStudyAgenda';
import { filterAssignmentQuery } from './assignmentQueryFilter';

export type NuniReceiptRow = {
  item: {
    courseId: string;
    id: string;
    groupName: string;
    title: string;
    dueAt: string | null;
  };
  due: number;
  submittedAt: string | null;
  receiptStatus: 'pending' | 'submitted' | 'feedback' | 'closed';
};

export type NuniReceiptDeadlineScope = { window: AssignmentDeadlineWindow; checkedAt: number };
export type NuniReceiptSource = { courseId: string; id: string };

type ReceiptAnswer =
  | { kind: 'clarify'; message: string; scope: string; dateClarification?: 'deadline-window' | 'submission-date' }
  | { kind: 'results'; rows: NuniReceiptRow[]; total: number;
      deadlineScope?: NuniReceiptDeadlineScope; undatedOutsideWindow: number };

const RECEIPT_LIST = /有哪些|哪些|列出|幾份|幾筆/;

/** Completed-record wording, excluding an intention or obligation to submit. */
function asksForSubmittedRecords(text: string): boolean {
  const completed = text.replace(/(?:還沒(?:有)?|尚未|未|沒(?:有)?|待|需要?|要|將(?:要)?)(?:繳交|提交|交|繳)/g, ' ');
  return /(?:已經|已|有)(?:繳交|提交|繳|交)|(?:繳交|提交)(?:紀錄|記錄)|(?:繳交|提交|交|繳)(?:了|過|的)/.test(completed);
}

/** Calendar parsing stays in assignmentDeadlineWindow; this only disambiguates the date's meaning. */
function asksForSubmissionDate(scopeQuestion: string): boolean {
  const text = outsideAssignmentNames(scopeQuestion.normalize('NFKC'));
  if (/截止|參考期限|繳交期限|到期/.test(text)) return false;
  return asksForSubmittedRecords(text);
}

/** This is a lookup, never permission to submit or modify an assignment. */
export function isNuniReceiptQuestion(question: string): boolean {
  const text = outsideAssignmentNames(question.normalize('NFKC').trim());
  if (/公告|通知|課表|翻譯|寫作|幫我寫|刪除|修改|上傳|代交|自動繳交|直接送出|幫我送出|我要交/.test(text)) return false;
  return (/(?:已經|已|還沒|尚未|未)(?:繳交|繳|交)|(?:繳交|提交)(?:紀錄|記錄)|(?:交|繳)(?:了嗎|了沒|了沒有|過嗎)|有沒有(?:繳交|交)|是否(?:已)?(?:繳交|交)/.test(text) ||
    (RECEIPT_LIST.test(text) && asksForSubmittedRecords(text))) &&
    /作業|功課|報告|習題|提交|繳交|繳|交/.test(text);
}

/** A short status-only question can narrow the previous, source-scoped receipt result. */
export function isNuniReceiptStatusFollowUp(question: string): boolean {
  const text = question.normalize('NFKC').replace(/\s+/g, '').replace(/[?!。！？，,、]+$/u, '');
  // A complete first-person list request starts a new query; “那我…” remains contextual.
  if (/^我(?:的)?/.test(text) && /作業(?:有哪些|哪些)$/.test(text)) return false;
  return /^(?:那(?:麼)?|改查|改看)?(?:我(?:的)?)?(?:已經|已|還沒|尚未|未)(?:繳交|繳|交)(?:的)?(?:作業)?(?:有哪些|哪些|呢)?$/u.test(text);
}

/** An explicit row selection can resolve a singular reference, never an unselected guess. */
export function isNuniReceiptReferenceQuestion(question: string): boolean {
  const text = question.normalize('NFKC').replace(/\s+/g, '').replace(/[?!。！？，,、]+$/u, '');
  return /^(?:這份|這個|那份|那個)(?:作業|報告|習題)?(?:已經|已|還沒|尚未|未)?(?:繳交|交|繳)(?:了嗎|了沒|了沒有|過嗎)?$/u.test(text);
}

/**
 * Read only the currently loaded student workspaces and their submission receipts.
 * Missing cached receipts are not proof of a missing submission at the server.
 */
export function queryNuniReceipts(
  data: NuniStudyAgenda, question: string, scopeQuestion = question,
  deadlineScope?: NuniReceiptDeadlineScope,
  selectedSource?: NuniReceiptSource,
  now = Date.now(),
): ReceiptAnswer {
  const calendarScope = scopeQuestion.normalize('NFKC');
  const parsedWindow = deadlineScope ? deadlineScope.window : parseAssignmentDeadlineWindow(calendarScope, now);
  if (!deadlineScope && parsedWindow && asksForSubmissionDate(calendarScope)) {
    return { kind: 'clarify', scope: withoutDeadlineConstraint(calendarScope), dateClarification: 'submission-date',
      message: '這裡目前只能依作業參考期限查日期，不能按繳交時間篩選。請明確指定要查哪一天截止的作業。' };
  }
  if (!deadlineScope && (parsedWindow === 'clarify' || !Number.isFinite(now))) {
    return { kind: 'clarify', scope: withoutDeadlineConstraint(calendarScope), dateClarification: 'deadline-window',
      message: '想查哪一天或哪一週的作業參考期限？可以指定「明天」或「下週」。' };
  }
  const resolvedDeadline = deadlineScope ?? (parsedWindow && parsedWindow !== 'clarify'
    ? { window: parsedWindow, checkedAt: now } : undefined);
  const courses = new Map(data.workspaces
    .filter((course) => course.state === 'active' && course.memberRole === 'student')
    .map((course) => [course.id, course.title]));
  const tasks = data.tasks.filter((task) => task.kind === 'assignment' && courses.has(task.courseId));
  const named = tasks.map((task) => ({ ...task, groupName: courses.get(task.courseId)! }));
  // A source comes only from a row deliberately selected in the current UI.
  // Revalidate it against this loaded, authorized student-course snapshot.
  const filtered = selectedSource
    ? { scope: null, items: named.filter((task) =>
        task.courseId === selectedSource.courseId && task.id === selectedSource.id) }
    : filterAssignmentQuery(scopeQuestion, named);
  const normalized = outsideAssignmentNames(question.normalize('NFKC').toLowerCase());
  const scopeText = scopeQuestion.normalize('NFKC').toLowerCase();
  const hasKnownName = named.some((task) => [task.title, task.groupName]
    .some((name) => name.length >= 2 && scopeText.includes(name.normalize('NFKC').toLowerCase())));
  const broad = /(?:^|請問|我想知道|幫我查|查看)(?:我(?:的|所有|全部|還有)?|所有|全部|各科|有哪些|哪些|目前|現在|這學期|已經|已|未|還沒|尚未|有幾)/
    .test(resolvedDeadline ? withoutDeadlineConstraint(scopeText).trim() : scopeText) ||
    // A broad deadline list such as "明天有哪些作業？" may be the source of
    // a follow-up. Its date is already enforced by deadlineScope, not a name.
    (Boolean(resolvedDeadline) && !filtered.scope &&
      /^(?:今天|今日|明天|明日|後天|上週|本週|這週|下週|未來[七7]天)(?:的)?(?:有哪些|哪些|作業|功課|待交)/.test(scopeText));
  if (!selectedSource && /這份|那份|這個|那個/.test(normalized) && !hasKnownName) {
    return { kind: 'clarify', scope: scopeQuestion, message: '請提供課程或作業名稱，再核對這份作業的繳交紀錄。' };
  }
  if (!selectedSource && !filtered.scope && !hasKnownName && !broad) {
    return { kind: 'clarify', scope: scopeQuestion, message: '請提供課程或作業名稱，避免把其他作業誤認成你要查的那份。' };
  }
  const list = RECEIPT_LIST.test(normalized) || isNuniReceiptStatusFollowUp(question);
  const missingOnly = list && /(?:還沒|尚未|未)(?:繳交|繳|交)/.test(normalized);
  const submittedOnly = list && !missingOnly && asksForSubmittedRecords(normalized);
  let undatedOutsideWindow = 0;
  const rows: NuniReceiptRow[] = filtered.items.flatMap((task) => {
    const receiptStatus = studyTaskStatus(task);
    const submitted = receiptStatus === 'submitted' || receiptStatus === 'feedback';
    if ((submittedOnly && !submitted) || (missingOnly && submitted)) return [];
    const due = task.dueAt ? parseTaipeiInstant(task.dueAt) : null;
    if (resolvedDeadline) {
      // Keep a status follow-up inside the prior Taiwan-time deadline window.
      // An unknown timestamp cannot be assigned to a calendar day.
      const { window, checkedAt } = resolvedDeadline;
      if (due === null) undatedOutsideWindow += 1;
      const day = taipeiDayNumber(due ?? NaN);
      if (!Number.isFinite(checkedAt) ||
          !(day >= window.startDay && day < window.endDay) ||
          (/(?:未來|接下來)/.test(window.label) && (due === null || due < checkedAt))) return [];
    }
    return [{
      item: {
        courseId: task.courseId, id: task.id, groupName: task.groupName,
        title: task.title, dueAt: task.dueAt,
      },
      due: due ?? NaN,
      submittedAt: submitted ? task.submittedAt : null,
      receiptStatus,
    }];
  });
  rows.sort((a, b) =>
    (Number.isFinite(a.due) ? a.due : Infinity) - (Number.isFinite(b.due) ? b.due : Infinity) ||
    a.item.courseId.localeCompare(b.item.courseId) ||
    a.item.id.localeCompare(b.item.id));
  return { kind: 'results', rows, total: rows.length,
    ...(resolvedDeadline ? { deadlineScope: resolvedDeadline } : {}), undatedOutsideWindow };
}
