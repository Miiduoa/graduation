import { formatTaipeiDateTime, parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { assignmentOrdinal } from '../services/assignmentResultPage';
import type { NuniClassCoursework } from '../services/nuniClassCoursework';
import type { CourseworkRead } from './nuniCourseworkFollowUp';

type Snapshot = Extract<NuniClassCoursework, { kind: 'assignments' }>;
type Row = Snapshot['assignments'][number];
export type CourseworkView = {
  kind: 'priority' | 'choose-receipt' | 'receipt';
  ids: string[];
  message: string;
  rankedAt?: string;
};

function textKey(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, '').replace(/[？?！!。]+$/u, '');
}

function priority(rows: Row[], instant: number, upcomingOnly: boolean): CourseworkView {
  const pending = rows.filter((row) => !row.submittedAt && row.state === 'open');
  const dated = pending.flatMap((row) => {
    const due = row.dueAt && parseTaipeiInstant(row.dueAt);
    return typeof due === 'number' && (!upcomingOnly || due >= instant) ? [{ id: row.id, due }] : [];
  });
  const soonest = Math.min(...dated.map((item) => item.due));
  // Keep every tie in source order, including the exact deadline minute.
  const ids = dated.filter((item) => item.due === soonest).map((item) => item.id);
  let message: string;
  if (!pending.length) message = '這次查到的作業裡，沒有仍收件的待繳作業。';
  else if (!ids.length) {
    const undated = pending.filter((row) => !row.dueAt || parseTaipeiInstant(row.dueAt) === null);
    message = upcomingOnly ? '這次紀錄沒有尚未到期且有明確期限的待繳作業。'
      : '這次查到的待繳作業都沒有明確期限，無法依截止時間排序。';
    if (!upcomingOnly) ids.push(...undated.map((row) => row.id));
  } else {
    message = soonest < instant ? '這次紀錄中，這是最早逾期且仍收件的待繳作業。'
      : '這次紀錄中，這是最先到期的待繳作業。';
    if (ids.length > 1) message += `共有 ${ids.length} 份在同一時間截止。`;
  }
  return { kind: 'priority', ids, message, rankedAt: new Date(instant).toISOString() };
}

export function receiptView(row: Row): CourseworkView {
  const message = row.submittedAt ? `「${row.title}」有繳交紀錄，於 ${formatTaipeiDateTime(row.submittedAt, { seconds: false })}（台灣時間）送出。`
    : `這次查詢沒有「${row.title}」的繳交紀錄。${row.state === 'closed' ? '查詢時已停止收件。' : '查詢時仍在收件。'}`;
  return { kind: 'receipt', ids: [row.id], message };
}

// Use the newest checked list for this workspace when resuming an older chat card.
export function resumeOpenedCoursework(
  messages: readonly { courseworkRead?: CourseworkRead }[], opened: CourseworkRead, assignmentId: string,
): CourseworkRead | undefined {
  if (opened.result.kind !== 'assignments') return;
  const workspaceId = opened.result.workspace.id;
  for (let i = messages.length - 1; i >= 0; i--) {
    const read = messages[i].courseworkRead;
    if (!read || read.anchor.uid || read.anchor.owner !== opened.anchor.owner ||
        read.anchor.schoolId !== opened.anchor.schoolId) continue;
    if (read.result.kind !== 'assignments') {
      const workspace = read.selectedWorkspaceId ?? read.expectedLinkedWorkspaceId;
      if (read.result.kind === 'unavailable' && workspace === workspaceId) return { ...read, retryAssignmentId: assignmentId };
      const prior = opened.anchor.classes[0], now = read.anchor.classes[0];
      if ((read.result.kind === 'changed' || read.result.kind === 'unlinked') && prior && now &&
          prior.courseId === now.courseId && prior.term === now.term) return read;
      continue;
    }
    if (read.result.workspace.id !== workspaceId) continue;
    const found = read.result.assignments.find((row) => row.id === assignmentId);
    return found ? { ...read, openedAssignmentId: assignmentId, view: receiptView(found) }
      : { ...read, openedAssignmentId: undefined, view: {
        kind: 'choose-receipt', ids: [], message: '較新的查詢沒有這份作業。請重新查詢這門課的作業。',
      } };
  }
}

function receiptReference(text: string): string | null {
  if (/^(?:那|所以)?(?:這份|那份|這個|那個)?(?:作業)?(?:我)?(?:(?:已經|有)?(?:繳交|繳|交)(?:了嗎|了沒|了沒有|過嗎|嗎)|有沒有(?:繳交|交|繳)(?:過)?|(?:的)?繳交(?:紀錄|狀態)(?:呢)?)$/u.test(text)) return '';
  const named = /^(.+?)(?:的)?(?:我)?(?:(?:已經|有)?(?:交|繳|繳交)(?:了嗎|了沒|過嗎|嗎)|有沒有(?:交|繳交)|繳交(?:狀態|紀錄)(?:呢)?)$/u.exec(text);
  const reversed = /^我(?:有沒有(?:繳交|交)|(?:繳交|交)了)(.+?)(?:了嗎|嗎)$/u.exec(text);
  const ref = reversed?.[1] ?? named?.[1] ?? (assignmentOrdinal(text) !== null ? text : null);
  return ref?.replace(/^[「『"](.+)[」』"]$/u, '$1') ?? null;
}

function chooseReceipt(rows: Row[], message: string): CourseworkView {
  return { kind: 'choose-receipt', ids: rows.map((row) => row.id), message };
}

/** Projects a source snapshot without changing its timestamp, order or account binding. */
export function courseworkSnapshotAnswer(
  read: CourseworkRead | undefined, question: string, accountId: string, schoolId: string, chosenId?: string,
): { content: string; courseworkRead?: CourseworkRead } | { refreshAssignmentId: string } | null {
  const selecting = chosenId !== undefined;
  if (read?.result.kind !== 'assignments') return selecting ? { content: '請先查詢這門課的作業。' } : null;
  const checked = read.checkedAt && parseTaipeiInstant(read.checkedAt);
  if (read.anchor.uid || read.anchor.owner !== `nuni:${accountId}` || read.anchor.schoolId !== schoolId ||
      read.anchor.classes.length !== 1 || typeof checked !== 'number' ||
      (read.selectedWorkspaceId && read.selectedWorkspaceId !== read.result.workspace.id)) {
    return selecting ? { content: '請重新查詢這門課的作業。' } : null;
  }
  const { assignments } = read.result;
  const text = textKey(question).replace(/^請問/u, '');
  const changed = read.changedAssignmentId;
  const refreshNeeded = { content: '作業紀錄可能已變更，請重新查詢這門課的作業。', courseworkRead: read };
  const respond = (view: CourseworkView) => ({ content: view.message, courseworkRead: { ...read, openedAssignmentId: undefined, view } });
  const receipt = (row: Row) => changed ? { refreshAssignmentId: row.id } : respond(receiptView(row));
  if (!selecting && /^(?:回到|返回|再看)(?:這門課的|這堂課的)?作業(?:清單)?$/u.test(text)) {
    if (changed) return refreshNeeded;
    return { content: `${read.result.workspace.title}的課堂作業`, courseworkRead: { ...read, view: undefined, openedAssignmentId: undefined } };
  }
  const urgent = /^(?:哪(?:一)?(?:個|份|項)(?:作業)?最(?:急|緊急)|(?:我)?(?:應該|要)?先(?:做|交)哪(?:一)?(?:個|份|項)(?:作業)?|最急的(?:作業)?(?:是哪(?:一)?(?:個|份|項))?)$/u.test(text);
  const next = /^(?:哪(?:一)?(?:個|份|項)(?:作業)?(?:最(?:快|早)|先|快)截止|下(?:一)?(?:個|份|項)(?:要|快)?(?:截止|到期)的?(?:作業)?(?:是哪(?:一)?(?:個|份|項))?)$/u.test(text);
  if (!selecting && (urgent || next)) return changed ? refreshNeeded : respond(priority(assignments, Date.now(), next));

  const visibleIds = read.view && new Set(read.view.ids);
  const visible = visibleIds ? assignments.filter((row) => visibleIds.has(row.id)) : assignments;
  if (selecting) {
    const row = visible.find((item) => item.id === chosenId);
    return row && read.view?.kind === 'choose-receipt' ? receipt(row)
      : { content: '這筆作業不在剛才的選項中，請重新核對。' };
  }
  const choosing = read.view?.kind === 'choose-receipt';
  const ref = receiptReference(text);
  const directTitle = choosing && visible.some((row) => textKey(row.title) === text);
  if (ref === null && !directTitle) return null;
  const reference = ref ?? text;
  const ordinal = assignmentOrdinal(reference);
  let candidates = visible;
  if (ordinal !== null) {
    const row = visible[ordinal - 1];
    if (row) return receipt(row);
    return changed ? refreshNeeded : respond(chooseReceipt(visible, '這個序號不在剛才的清單中，請選一份作業。'));
  }
  if (reference) {
    candidates = (choosing ? visible : assignments).filter((row) => textKey(row.title) === reference);
    if (!candidates.length) return changed ? refreshNeeded : respond(chooseReceipt(visible, '這次紀錄沒有符合這個名稱的作業，請核對清單。'));
  } else {
    const opened = visible.find((row) => row.id === read.openedAssignmentId);
    if (opened) return receipt(opened);
  }
  if (candidates.length === 1) return receipt(candidates[0]);
  if (changed) {
    const edited = !reference && visible.find((row) => row.id === changed);
    return edited ? receipt(edited) : refreshNeeded;
  }
  const message = !candidates.length ? '剛才的清單沒有可核對的作業。'
    : reference ? '同名作業有多份，請依清單序號和期限選擇。' : '想確認哪一份作業的繳交紀錄？';
  return respond(chooseReceipt(candidates, message));
}
