import { parseAssistantCampusEventTargets, type AssistantCampusEventTarget } from '../../assistantCampusEvent';
import { calendarLedger, signCard } from './actions';
import { readSelectedPublicEvent } from './campusEventGuard';
import { parsePublicEventTarget, type PublicEventTarget } from './publicEvent';
import { validateEventProposal } from './tools';
import { bounded, fail, requireAssistantPermission, type Adapter, type Binding, type Card, type Step } from './contracts';
import { withOperationSignal } from './operation';

export const CAMPUS_EVENT_MESSAGES: Record<string, string> = {
  CAMPUS_EVENT_CHANGED: '原活動已刪除或內容、時間已變更。請重新查詢活動並預覽，這次沒有新增行程。',
  CAMPUS_EVENT_UNAVAILABLE: '目前無法重新核對這筆公開活動的原始來源，這次沒有新增行程。請稍後重查。',
  CAMPUS_EVENT_TIME_REQUIRED: '原活動沒有明確的結束時間，無法直接建立行程。請先從活動來源確認完整時間。',
  CAMPUS_EVENT_TIME_UNSUPPORTED: '原活動的標題或起訖時間無法完整保存成個人行程，這次沒有自行截短或推測內容。請先查看活動來源。',
  CAMPUS_EVENT_START_PASSED: '這筆活動已開始，請重新選擇尚未開始的活動。這次沒有新增行程。',
  ASSISTANT_PERMISSION_DENIED: '目前未開啟新增個人行程權限。請到[助理權限](/settings?section=assistant)開啟後再試。',
  ASSISTANT_PERMISSION_STORE_UNAVAILABLE: '目前無法核對你的助理權限，這次沒有新增行程。請稍後重試。',
  EVENT_CONFLICT: '這個活動時段與已同步的課表或個人行程重疊，請先檢查行事曆。這次沒有新增行程。',
  SCHEDULE_INCOMPLETE: '已同步課表仍有無法定位時間的紀錄，現在無法可靠核對活動時段。請補齊課表後再預覽。',
  CALENDAR_INCOMPLETE: '目前無法完整核對已同步的個人行程，請檢查行事曆後再預覽。',
};

/** Source-selected event preparation uses no model, and never dispatches a write. */
export async function prepareCampusEventRequest(input: {
  target: PublicEventTarget;
  adapter: Adapter;
  binding: Binding;
  secret: string;
  writes: boolean;
  now: number;
  signal: AbortSignal;
}): Promise<{ answer: string; cards: Card[]; steps: Step[]; stopReason: string;
  eventTargets: AssistantCampusEventTarget[]; dataRead: true }> {
  const target = parsePublicEventTarget(input.target), steps: Step[] = [];
  const started = Date.now(), currentTime = () => input.now + Math.max(0, Date.now() - started);
  let eventTargets: AssistantCampusEventTarget[] = [];
  try {
    return await bounded(signal => withOperationSignal(signal, async () => {
      await requireAssistantPermission(input.adapter, 'createPersonalEvent');
      const source = await readSelectedPublicEvent(input.adapter, input.binding, target, currentTime());
      eventTargets = parseAssistantCampusEventTargets([{ ...source.item, checkedAt: source.checkedAt }], input.binding.schoolId);
      steps.push({ name: 'get_campus_event', status: 'ok', summary: '已重新核對所選活動的原始來源與完整起訖時間' });
      const ledger = await calendarLedger(input.binding, input.adapter);
      const event = validateEventProposal(ledger, source.args, [], currentTime(), true);
      steps.push({ name: 'check_calendar', status: 'ok', summary: '已核對已同步課表與個人行程的時段' });
      signal.throwIfAborted();
      const time = `${event.date} ${event.startTime}–${event.endDate ? event.endDate + ' ' : ''}${event.endTime}（台北）`;
      if (!input.writes)
        return { answer: `${source.item.title}\n${time}\n目前未開放由助理保存個人行程，這筆活動尚未加入行事曆。\n來源：${source.item.href}`,
          cards: [], steps, stopReason: 'WRITES_DISABLED', eventTargets, dataRead: true as const };
      await requireAssistantPermission(input.adapter, 'createPersonalEvent');
      signal.throwIfAborted();
      if (Date.parse(source.item.startsAt) <= currentTime()) return fail('CAMPUS_EVENT_START_PASSED', 409);
      // The endpoint issues a separate event-preview conversation. Its proposal
      // generation never replaces a pending chat or coursework plan.
      const card = signCard(input.binding, 'propose_personal_event', event, ledger.revision,
        input.secret, currentTime(), undefined, undefined, undefined, undefined,
        { target, fingerprint: source.fingerprint });
      steps.push({ name: 'propose_personal_event', status: 'ok', summary: '已備妥活動行程，等待逐項確認' });
      return { answer: `${source.item.title}\n${time}\n已核對目前已同步的課表與個人行程。確認時會再次查核原活動與行程，保存後讀回驗證。\n這張卡只保存活動標題與時間；地點請依原活動查看。加入個人行事曆不會報名活動。\n來源：${source.item.href}`,
        cards: [card], steps, stopReason: '', eventTargets, dataRead: true as const };
    }), input.signal, 16000);
  } catch (error) {
    if (input.signal.aborted || (error as { status?: number }).status === 401) throw error;
    const rawCode = (error as { code?: string }).code;
    const code = typeof rawCode === 'string' && /^[A-Z_]{1,80}$/.test(rawCode) ? rawCode : 'CAMPUS_EVENT_UNAVAILABLE';
    return { answer: CAMPUS_EVENT_MESSAGES[code] || CAMPUS_EVENT_MESSAGES.CAMPUS_EVENT_UNAVAILABLE,
      cards: [], steps: [...steps, { name: 'prepare_campus_event', status: 'error', summary: code }],
      stopReason: code, eventTargets, dataRead: true };
  }
}
