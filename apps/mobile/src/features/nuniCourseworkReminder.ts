import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { nuniReminderWindow } from '../services/nuniAssignmentReminderWindow';
import { assignmentOrdinal } from '../services/assignmentResultPage';
import type { PlatformTimetableAccess } from '../services/assistantTimetableSource';
import type { NuniClassCoursework } from '../services/nuniClassCoursework';
import { answerNuniCoursework, type CourseworkRead, type CourseworkRequests } from './nuniCourseworkFollowUp';
import type { CourseworkView } from './nuniCourseworkSnapshot';

export const reminderLeads = [
  { minutes: 15, label: '提前 15 分鐘' }, { minutes: 60, label: '提前 1 小時' }, { minutes: 1440, label: '提前 1 天' },
] as const;

type Lead = typeof reminderLeads[number]['minutes'];
type ReminderAction = 'set' | 'remove';
type Row = Extract<NuniClassCoursework, { kind: 'assignments' }>['assignments'][number];
export type ReminderChoice =
  | { reminder: 'pick' | 'confirm' | 'remove'; id: string }
  | { reminder: 'lead'; id: string; minutes: Lead };

export type ReminderView = { kind: 'reminder'; action: ReminderAction } & (
  | { step: 'choose' }
  | { step: 'review'; minutes: Lead }
  | { step: 'cancel-review' }
  | { step: 'result'; next?: 'retry' | 'remove'; minutes?: Lead }
);
type Reply = { content: string; courseworkRead?: CourseworkRead };
export function reminderOptions(dueAt: string | null) {
  const due = dueAt && parseTaipeiInstant(dueAt);
  return reminderLeads.filter(({ minutes }) => typeof due === 'number' && nuniReminderWindow(due, due - minutes * 60000) === 'ready');
}

function normalize(value: string) {
  return value.normalize('NFKC').replace(/\s/g, '').replace(/[？！?!。]+$/u, '');
}

function reminderRequest(text: string): { action: ReminderAction; ref: string } | undefined {
  const set = /^(?:請)?(?:幫我)?提醒我(?:要|記得)?(?:繳交|提交|交|繳)(.*)$/u.exec(text);
  const remove = /^(?:請)?(?:幫我)?取消(.*?)的?(?:作業)?提醒$/u.exec(text);
  if (!set && !remove) return;
  const raw = (set ?? remove)![1];
  const ref = /^(?:這|那)(?:一)?(?:份|個)(?:作業)?$|^作業$/u.test(raw) ? '' : raw.replace(/^[「『"](.+)[」』"]$/u, '$1');
  return { action: set ? 'set' : 'remove', ref };
}

export function isCourseworkReminderQuestion(question: string) {
  return !!reminderRequest(normalize(question));
}

function respond(read: CourseworkRead, view: CourseworkView): Reply {
  return { content: view.message, courseworkRead: { ...read, view, openedAssignmentId: undefined } };
}

function review(read: CourseworkRead, row: Row, action: ReminderAction, minutes?: Lead) {
  const common = { kind: 'reminder' as const, action, ids: [row.id] };
  if (action === 'remove') return respond(read, { ...common, step: 'cancel-review', message: '要取消這份作業在這台裝置上的提醒嗎？' });
  const due = row.dueAt && parseTaipeiInstant(row.dueAt);
  const reason = row.submittedAt ? '這份作業已有繳交紀錄。' : row.state === 'closed' ? '這份作業已停止收件。'
    : typeof due !== 'number' ? '這份作業沒有明確的截止時間。'
    : nuniReminderWindow(due, due) === 'too-far' ? '距離截止超過一年，請在接近截止日後再設定提醒。' : '';
  const options = reminderOptions(row.dueAt);
  if (reason || !options.length) return respond(read, { ...common, step: 'result',
    message: reason || '距離截止時間太近，已沒有可用的提前提醒時段。' });
  const selected = options.find((option) => option.minutes === (minutes ?? 60)) ?? options[0];
  return respond(read, { ...common, step: 'review', minutes: selected.minutes,
    message: '請核對作業和提醒時間。確認後，這台裝置會在指定時間通知你。' });
}

export async function answerCourseworkReminder(
  read: CourseworkRead | undefined, question: string, platform: PlatformTimetableAccess, schoolId: string,
  isCurrent: () => boolean, transport?: CourseworkRequests, choice?: ReminderChoice,
): Promise<Reply | null> {
  const text = normalize(question);
  const previous = read?.view?.kind === 'reminder' ? read.view : undefined;
  const request = reminderRequest(text);
  const choosing = previous?.step === 'choose';
  const ordinal = assignmentOrdinal(request?.ref ?? text);
  const reviewing = previous?.step === 'review' || previous?.step === 'cancel-review';
  const discard = !choice && reviewing && /^(?:放棄設定|保留提醒|先不用了?)$/u.test(text);
  const typedConfirm = !choice && reviewing && /^(?:確認(?:設定|取消)?(?:提醒)?|確定|好)$/u.test(text);
  const typedLead = previous?.step === 'review' && reminderLeads.find((item) => normalize(item.label) === text);
  const titleMatch = choosing && read?.result.kind === 'assignments' &&
    read.result.assignments.some((row) => previous.ids.includes(row.id) && normalize(row.title) === text);
  if (!choice && !request && !discard && !typedConfirm && !typedLead && !(choosing && (ordinal !== null || titleMatch))) return null;
  if (read?.result.kind !== 'assignments' || read.anchor.owner !== `nuni:${platform.accountId}` ||
      read.anchor.uid || read.anchor.schoolId !== schoolId || read.anchor.classes.length !== 1 ||
      !read.checkedAt || parseTaipeiInstant(read.checkedAt) === null ||
      (read.selectedWorkspaceId && read.selectedWorkspaceId !== read.result.workspace.id) || !isCurrent()) {
    return { content: '請先查詢這門課的 nuni 作業，再選擇要提醒的作業。' };
  }
  if (read.changedAssignmentId) return { content: '作業已更新，請先重新核對。', courseworkRead: read };
  const { assignments, workspace } = read.result;
  const action = (!choice && request ? request.action : previous?.action) ?? 'set';
  const common = { kind: 'reminder' as const, action };
  const visibleIds = read.view?.ids;
  const visible = visibleIds ? assignments.filter((item) => visibleIds.includes(item.id)) : assignments;
  if (discard) return respond(read, { ...common, step: 'result', ids: previous.ids,
    message: previous.step === 'cancel-review' ? '已保留原本的提醒。' : '已放棄這次設定。' });
  if (typedConfirm) return respond(read, { ...previous, message: previous.step === 'review' ? '請按「確認設定提醒」完成設定。'
    : '請按「確認取消提醒」移除提醒。' });
  if (choice || typedLead) {
    const row = visible.find((item) => item.id === (choice?.id ?? previous?.ids[0]));
    const invalid = { content: '這個選項已變更，請重新選擇作業提醒。', courseworkRead: read };
    if (!row || !previous) return invalid;
    if (choice?.reminder === 'pick') return choosing ? review(read, row, action) : invalid;
    const selectedLead = choice?.reminder === 'lead' ? choice.minutes : typedLead && typedLead.minutes;
    if (selectedLead) return previous.step === 'review' ? review(read, row, action, selectedLead) : invalid;
    const target = { accountId: platform.accountId, schoolId, workspaceId: workspace.id, assignmentId: row.id };
    if (choice?.reminder === 'remove' && previous.step === 'cancel-review') {
      const { cancelNuniAssignmentReminder } = require('../services/nuniAssignmentReminders') as typeof import('../services/nuniAssignmentReminders');
      const status = await cancelNuniAssignmentReminder(target, isCurrent);
      return respond(read, { ...common, step: 'result', ids: [row.id],
        ...((status === 'failed' || status === 'stale') && { next: 'remove' }),
        message: { cancelled: '已取消這份作業在這台裝置上的提醒。', absent: '這台裝置沒有這份作業的提醒。',
          failed: '未能取消提醒，可以再試一次。', stale: '帳號狀態已變更，請重新核對。', unsupported: '這個平台不支援手機通知。' }[status] });
    }
    if (choice?.reminder !== 'confirm' || previous.step !== 'review' || !row.dueAt) return invalid;
    const reviewedDue = parseTaipeiInstant(row.dueAt);
    const { confirmNuniAssignmentReminder } = require('../services/nuniAssignmentReminders') as typeof import('../services/nuniAssignmentReminders');
    let refreshed: Reply | undefined;
    const status = await confirmNuniAssignmentReminder(target, { dueAt: row.dueAt, leadMinutes: previous.minutes, isCurrent,
      recheck: async () => {
        refreshed = await answerNuniCoursework({ courseworkRead: read }, platform, schoolId, isCurrent, transport, { refreshAssignmentId: row.id });
        const newest = refreshed.courseworkRead?.result;
        const item = newest?.kind === 'assignments' && newest.workspace.id === workspace.id
          ? newest.assignments.find((candidate) => candidate.id === row.id) : undefined;
        return !!item && item.title === row.title && !item.submittedAt && item.state === 'open' && !!item.dueAt &&
          parseTaipeiInstant(item.dueAt) === reviewedDue;
      } });
    if (refreshed && refreshed.courseworkRead?.result.kind !== 'assignments') return refreshed;
    if (status === 'stale' && refreshed?.courseworkRead?.result.kind === 'assignments') {
      const updated = refreshed.courseworkRead.result.assignments.find((item) => item.id === row.id);
      if (updated) {
        const newReview = review(refreshed.courseworkRead, updated, 'set', previous.minutes);
        const view = newReview.courseworkRead?.view;
        if (view) return respond(refreshed.courseworkRead, { ...view, message: `作業資料已變更。${view.message}` });
      }
    }
    return respond(refreshed?.courseworkRead ?? read, { ...common, step: 'result', ids: [row.id], minutes: previous.minutes,
      ...((status === 'scheduled' || status === 'unchanged') ? { next: 'remove' } :
        ['expired', 'failed', 'denied', 'stale'].includes(status) ? { next: 'retry' } : {}),
      message: { scheduled: '已設定這份作業的手機提醒。', unchanged: '這台裝置已有相同時間的提醒。',
        stale: '重新核對時，作業資料已變更。請依最新紀錄重新選擇。',
        expired: '原先選擇的提醒時間已過，請重新選擇。', denied: '通知權限未開啟。可到系統設定允許此 App 傳送通知，再回來設定提醒。',
        unsupported: '這個平台不支援手機通知。請在 iOS 或 Android App 設定提醒。', failed: '未能完成提醒設定，請稍後再試。' }[status] });
  }
  const reference = request?.ref ?? text;
  const opened = !reference && visible.find((row) => row.id === read.openedAssignmentId);
  let rows = visible;
  if (opened) rows = [opened];
  else if (ordinal !== null) rows = visible.slice(ordinal - 1, ordinal);
  else if (reference) rows = (request && !choosing ? assignments : visible).filter((row) => normalize(row.title) === reference);
  if (rows.length === 1) return review(read, rows[0], action);
  return respond(read, { ...common, step: 'choose', ids: (rows.length ? rows : visible).map((row) => row.id),
    message: !visible.length ? '剛才的清單沒有可選的作業。' : !rows.length ? '找不到指定的作業，請從清單選擇。'
      : action === 'remove' ? '要取消哪一份作業的提醒？' : '要提醒你繳交哪一份作業？' });
}
