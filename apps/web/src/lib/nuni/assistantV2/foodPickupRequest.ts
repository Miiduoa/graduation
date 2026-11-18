import { parseAssistantFoodPickupIntent } from '@campus/shared/src/assistantFoodPickupIntent';
import { calendarLedger, signCard } from './actions';
import { bounded, requireAssistantPermission, type Adapter, type Binding, type Card, type Step } from './contracts';
import { foodPickupEvent, foodPickupGuardForSource, readLatestFoodPickup } from './foodPickup';
import { withOperationSignal } from './operation';
import { validateEventProposal } from './tools';

export const FOOD_PICKUP_MESSAGES: Record<string, string> = {
  FOOD_PICKUP_UNAVAILABLE: '目前無法完整核對最近一筆訂單與取餐時間，請先到點餐頁確認訂單資料，再重新安排。這次尚未建立行程。',
  FOOD_PICKUP_AMBIGUOUS: '目前無法唯一確認要安排的訂單。請先到點餐頁確認工作區與取餐時間，再於個人行事曆安排；這次尚未建立行程。',
  FOOD_PICKUP_CHANGED: '原訂單的取餐時間、地點或有效狀態已變更，請重新讀取訂單後安排。這次尚未建立行程。',
  FOOD_PICKUP_PASSED: '訂單上的取餐時間已經到了，請先確認實際取餐狀況；這次尚未建立行程。',
  FOOD_PICKUP_SOURCE_BOUND: '這筆行程依原訂單的取餐時間建立，請重新讀取訂單後安排，才能保留來源核對。',
  ASSISTANT_PERMISSION_DENIED: '目前未開啟新增個人行程權限。請到「設定 → 助理權限」開啟後再試。',
  ASSISTANT_PERMISSION_STORE_UNAVAILABLE: '目前無法核對你的助理權限，尚未建立取餐行程。請稍後重試。',
  EVENT_CONFLICT: '訂單上的取餐時段與課表或個人行程重疊。請先核對訂單取餐時間與既有安排，這次尚未建立行程。',
  SCHEDULE_INCOMPLETE: '目前課表有尚未確認的時間，無法完整核對取餐時段。請先補齊課表時間，再重新安排。',
  CALENDAR_INCOMPLETE: '目前無法完整核對個人行程，請先檢查行事曆，再重新安排取餐時段。',
};

type PickupReply = { answer: string; cards: Card[]; steps: Step[]; stopReason: string; dataRead: true };

/** Order facts feed the existing calendar transaction. No model, order mutation,
 * payment or notification scheduler participates in this operation.
 */
export async function prepareFoodPickupRequest(input: {
  question: string; adapter: Adapter; binding: Binding; secret: string;
  writes: boolean; now: number; signal: AbortSignal;
}): Promise<PickupReply | null> {
  const intent = parseAssistantFoodPickupIntent(input.question);
  if (!intent) return null;
  input.signal.throwIfAborted();
  if (intent.kind === 'invalid') return {
    answer: intent.message, cards: [], steps: [], stopReason: 'INVALID_FOOD_PICKUP_REQUEST', dataRead: true,
  };
  const steps: Step[] = [];
  const started = Date.now();
  const currentTime = () => input.now + Math.max(0, Date.now() - started);
  try {
    const result = await bounded(signal => withOperationSignal(signal, async (): Promise<PickupReply> => {
      await requireAssistantPermission(input.adapter, 'createPersonalEvent');
      signal.throwIfAborted();
      const source = await readLatestFoodPickup(input.adapter, input.binding, currentTime());
      signal.throwIfAborted();
      steps.push({ name: 'get_food_order', status: 'ok', summary: '已核對本人最近訂單的取餐時間與地點' });
      const event = foodPickupEvent(source, intent.durationMinutes);
      const ledger = await calendarLedger(input.binding, input.adapter);
      signal.throwIfAborted();
      validateEventProposal(ledger, event, [], currentTime(), true);
      steps.push({ name: 'get_calendar', status: 'ok', summary: '已核對已同步課表與個人行程的時間衝突' });
      const when = `${event.date} ${event.startTime}–${event.endDate ? event.endDate + ' ' : ''}${event.endTime}`;
      if (!input.writes) return {
        answer: `已核對取餐安排：\n${when}｜${event.title}\n依訂單上的預定取餐時間，預留${intent.durationMinutes}分鐘。目前未開放由助理儲存個人行程，這筆內容尚未加入行事曆。`,
        cards: [], steps, stopReason: 'WRITES_DISABLED', dataRead: true,
      };
      await requireAssistantPermission(input.adapter, 'createPersonalEvent');
      signal.throwIfAborted();
      const issuedAt = currentTime();
      validateEventProposal(ledger, event, [], issuedAt, true);
      const card = signCard(input.binding, 'propose_personal_event', event, ledger.revision,
        input.secret, issuedAt, undefined, undefined, undefined,
        foodPickupGuardForSource(source, intent.durationMinutes));
      steps.push({ name: 'propose_personal_event', status: 'ok', summary: '取餐行程已備妥，等待你的確認' });
      return {
        answer: `已從最近一筆訂單接好取餐安排：\n${when}｜${event.title}\n依訂單上的預定取餐時間，預留${intent.durationMinutes}分鐘，並已核對已同步課表與個人行程。\n確認後會再次核對原訂單，再儲存並讀回行程；目前尚未加入行事曆。`,
        cards: [card], steps, stopReason: '', dataRead: true,
      };
    }), input.signal, 20000);
    input.signal.throwIfAborted();
    return result;
  } catch (error) {
    const cause = error as { status?: number; code?: string };
    if (input.signal.aborted || cause.status === 401 || cause.code === 'SESSION_CHANGED') throw error;
    const code = cause.code === 'EVENT_START_PASSED' ? 'FOOD_PICKUP_PASSED'
      : cause.code && Object.hasOwn(FOOD_PICKUP_MESSAGES, cause.code) ? cause.code : 'FOOD_PICKUP_UNAVAILABLE';
    return {
      answer: FOOD_PICKUP_MESSAGES[code], cards: [],
      steps: [...steps, { name: 'propose_food_pickup_event', status: 'error', summary: code }],
      stopReason: code, dataRead: true,
    };
  }
}
