import {
  studyTaskStatus,
  type NuniStudyAgenda,
} from '@campus/shared/src/nuniStudyAgenda';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { outsideAssignmentNames, type AssignmentDeadlineWindow } from './assignmentDeadlineWindow';
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

type ReceiptAnswer =
  | { kind: 'clarify'; message: string }
  | { kind: 'results'; rows: NuniReceiptRow[]; total: number };

/** This is a lookup, never permission to submit or modify an assignment. */
export function isNuniReceiptQuestion(question: string): boolean {
  const text = outsideAssignmentNames(question.normalize('NFKC').trim());
  if (/公告|通知|課表|翻譯|寫作|幫我寫|刪除|修改|上傳|代交|自動繳交|直接送出|幫我送出|我要交/.test(text)) return false;
  return /(?:已經|已|還沒|尚未|未)(?:繳交|繳|交)|(?:繳交|提交)(?:紀錄|記錄)|(?:交|繳)(?:了嗎|了沒|了沒有|過嗎)|有沒有(?:繳交|交)|是否(?:已)?(?:繳交|交)/.test(text) &&
    /作業|功課|報告|習題|提交|繳交|繳|交/.test(text);
}

/** A short status-only question can narrow the previous, source-scoped receipt result. */
export function isNuniReceiptStatusFollowUp(question: string): boolean {
  const text = question.normalize('NFKC').replace(/\s+/g, '').replace(/[?!。！？，,、]+$/u, '');
  return /^(?:那(?:麼)?|改查|改看)?(?:我(?:的)?)?(?:已經|已|還沒|尚未|未)(?:繳交|繳|交)(?:的)?(?:作業)?(?:有哪些|哪些|呢)?$/u.test(text);
}

/**
 * Read only the currently loaded student workspaces and their submission receipts.
 * Missing cached receipts are not proof of a missing submission at the server.
 */
export function queryNuniReceipts(
  data: NuniStudyAgenda, question: string, scopeQuestion = question,
  deadlineScope?: NuniReceiptDeadlineScope,
): ReceiptAnswer {
  const courses = new Map(data.workspaces
    .filter((course) => course.state === 'active' && course.memberRole === 'student')
    .map((course) => [course.id, course.title]));
  const tasks = data.tasks.filter((task) => task.kind === 'assignment' && courses.has(task.courseId));
  const named = tasks.map((task) => ({ ...task, groupName: courses.get(task.courseId)! }));
  const filtered = filterAssignmentQuery(scopeQuestion, named);
  const normalized = question.normalize('NFKC').toLowerCase();
  const scopeText = scopeQuestion.normalize('NFKC').toLowerCase();
  const hasKnownName = named.some((task) => [task.title, task.groupName]
    .some((name) => name.length >= 2 && scopeText.includes(name.normalize('NFKC').toLowerCase())));
  const broad = /(?:^|請問|我想知道|幫我查|查看)(?:我(?:的|所有|全部|還有)?|所有|全部|各科|有哪些|哪些|目前|現在|這學期|已經|已|未|還沒|尚未|有幾)/.test(scopeText);
  if (/這份|那份|這個|那個/.test(normalized) && !hasKnownName) {
    return { kind: 'clarify', message: '請提供課程或作業名稱，再核對這份作業的繳交紀錄。' };
  }
  if (!filtered.scope && !hasKnownName && !broad) {
    return { kind: 'clarify', message: '請提供課程或作業名稱，避免把其他作業誤認成你要查的那份。' };
  }
  const list = /有哪些|哪些|列出|幾份|幾筆/.test(normalized) || isNuniReceiptStatusFollowUp(question);
  const missingOnly = list && /(?:還沒|尚未|未)(?:繳交|繳|交)/.test(normalized);
  const submittedOnly = list && !missingOnly && /(?:已經|已)(?:繳交|繳|交)|有繳交紀錄/.test(normalized);
  const rows: NuniReceiptRow[] = filtered.items.flatMap((task) => {
    const receiptStatus = studyTaskStatus(task);
    const submitted = receiptStatus === 'submitted' || receiptStatus === 'feedback';
    if ((submittedOnly && !submitted) || (missingOnly && submitted)) return [];
    const due = task.dueAt ? parseTaipeiInstant(task.dueAt) : null;
    if (deadlineScope) {
      // Keep a status follow-up inside the prior Taiwan-time deadline window.
      // An unknown timestamp cannot be assigned to a calendar day.
      const { window, checkedAt } = deadlineScope;
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
  return { kind: 'results', rows, total: rows.length };
}
