import type { AssistantWorkSessionIntent } from '@campus/shared/src/assistantWorkSessionIntent';
import type { AssistantCalendarEvent } from '@campus/shared/src/assistantExecution';
import { parsePlatformAssistantPermissionState } from '@campus/shared/src/platformAssistantPermissions';
import { abortableCampusRead } from '../services/abortableCampusRead';
import {
  assistantCalendarOwner, createAssistantCalendarTask, recheckAssistantCalendarTask,
  type AssistantCalendarAvailabilityCheck, type AssistantCalendarContext, type AssistantCalendarTask,
} from '../services/assistantCalendarExecution';
import { readAssistantCalendarJournal, type AssistantCalendarJournalEntry } from '../services/assistantCalendarJournal';
import type { AssistantServiceSelection } from '../services/assistantServiceNavigation';
import { findWorkSessionSlot, recheckWorkSessionTime } from '../services/courseworkStudyAvailability';

type Answer = { content: string; calendarTask?: AssistantCalendarTask; serviceSelection?: AssistantServiceSelection };
type ReadPermission = () => Promise<unknown>;
const TIME_SOURCE = '依本機已存課表與個人行程，在 08:00–22:00 的課間空堂尋找，前後各留 10 分鐘。';
const STOPPED = '帳號、學校或本次查詢已變更，請重新查詢工作時段。';
const PERMISSION = '請核對助理的「新增個人行程」權限，或用「找」查詢空檔。';

async function canCreate(context: AssistantCalendarContext, read: ReadPermission | undefined, signal?: AbortSignal) {
  const platform = context.platformTimetable;
  if (!read || !platform || signal?.aborted) return false;
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, 10_000);
  try {
    const state = parsePlatformAssistantPermissionState(await abortableCampusRead(read, controller.signal));
    return !controller.signal.aborted && state.accountId === platform.accountId &&
      state.permissions.createPersonalEvent && assistantCalendarOwner(context) === 'nuni:' + state.accountId;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

/** An earlier matching event may have been requested using an explicit time. Never attribute it to this workflow. */
function matchesRequest(entry: AssistantCalendarJournalEntry, intent: AssistantWorkSessionIntent) {
  const { event } = entry.proposal;
  if (event.allDay || event.title !== intent.title || event.date !== intent.date ||
      (event.endDate && event.endDate !== event.date) || !event.startTime || !event.endTime ||
      event.startTime < intent.from || event.endTime > intent.to) return false;
  const start = Date.parse(event.date + 'T' + event.startTime + ':00+08:00');
  const end = Date.parse(event.date + 'T' + event.endTime + ':00+08:00');
  return end - start === intent.minutes * 60_000;
}

/** Called with the shared parser's intent after the conversation has matched its selected work profile. */
export async function answerNuniWorkSession(parsedIntent: AssistantWorkSessionIntent, context: AssistantCalendarContext,
  signal?: AbortSignal, readPermission?: ReadPermission): Promise<Answer> {
  const owner = assistantCalendarOwner(context);
  if (!owner || !context.platformTimetable || context.uid || signal?.aborted) return { content: STOPPED };
  // The confirmation and duplicate check must retain precisely the reviewed request.
  const intent = Object.freeze({ ...parsedIntent });
  const schoolId = context.schoolId;
  const current = () => !signal?.aborted && assistantCalendarOwner(context) === owner && context.schoolId === schoolId;

  if (intent.mode === 'prepare') {
    try {
      const entries = await abortableCampusRead(() => readAssistantCalendarJournal({ owner, schoolId }, current), signal);
      if (!current()) return { content: STOPPED };
      const matching = entries.filter(entry => matchesRequest(entry, intent));
      if (matching.length > 1) return { content: '這個範圍已有多筆符合的行程，請到個人行事曆核對。',
        serviceSelection: { kind: 'open', serviceIds: ['calendar'] } };
      if (matching.length === 1) {
        const task = await abortableCampusRead(() => recheckAssistantCalendarTask(matching[0].proposal, context), signal);
        if (!current()) return { content: STOPPED };
        return { content: '這個範圍已有相同名稱與長度的行程操作，以下是原紀錄的核對結果。', calendarTask: task };
      }
    } catch {
      return current() ? { content: '目前無法核對先前的行程操作，請稍後重試或查看個人行事曆。',
        serviceSelection: { kind: 'open', serviceIds: ['calendar'] } } : { content: STOPPED };
    }
  }

  const found = await findWorkSessionSlot(context, intent, { signal });
  if (!current()) return { content: STOPPED };
  if (found.kind === 'unavailable') return { content: found.message, serviceSelection: { kind: 'open', serviceIds: ['timetable'] } };
  if (found.kind !== 'available') return { content: found.kind === 'no-slot' ? found.message + ' ' + TIME_SOURCE : found.message };
  const { slot } = found;
  const when = slot.date + ' ' + slot.startTime + '–' + slot.endTime + '（台灣時間）';
  if (intent.mode === 'find') return { content: intent.title + '可安排在 ' + when + '。' + TIME_SOURCE };
  if (!(await canCreate(context, readPermission, signal))) return current()
    ? { content: PERMISSION, serviceSelection: { kind: 'open', serviceIds: ['assistant-permissions'] } } : { content: STOPPED };
  if (!current()) return { content: STOPPED };

  const availabilityCheck: AssistantCalendarAvailabilityCheck = async (access, gate) => {
    const checked = await recheckWorkSessionTime(slot, intent, access, gate);
    if (checked.kind !== 'ready') return checked;
    if (!(await canCreate(access, readPermission, gate))) return { kind: 'blocked', message: PERMISSION };
    return { kind: 'ready', writeCheck: { ...checked.writeCheck, conflictsWithJournalEntry: entry => matchesRequest(entry, intent) } };
  };
  const event: AssistantCalendarEvent = { title: intent.title, date: slot.date, allDay: false,
    startTime: slot.startTime, endTime: slot.endTime };
  return { content: '找到' + intent.minutes + '分鐘的' + intent.title + '時段。' + TIME_SOURCE + ' 請核對下方行程。',
    calendarTask: createAssistantCalendarTask(event, context, undefined, { availabilityCheck }) };
}
