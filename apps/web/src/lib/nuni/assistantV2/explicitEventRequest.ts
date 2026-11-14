import { parseAssistantCalendarIntent } from '@campus/shared/src/assistantCalendarIntent';
import type { AssistantCalendarEvent } from '@campus/shared/src/assistantExecution';
import { bounded, type Card, type Step } from './contracts';
import type { createTools } from './tools';

type ExplicitEventResult = {
  answer: string;
  steps: Step[];
  cards: Card[];
  stopReason: string;
};

function describe(event: AssistantCalendarEvent): string {
  return `${event.date} ${event.startTime}–${event.endTime}｜${event.title}`;
}

/** An exact appointment is already a plan: preserve it instead of asking a model
 * to choose unrelated coursework or turning it into a calendar-page shortcut.
 * This only prepares the existing signed confirmation; it never performs a write.
 */
export async function prepareExplicitEventRequest(input: {
  question: string;
  now: number;
  signal: AbortSignal;
  tools: ReturnType<typeof createTools>;
}): Promise<ExplicitEventResult | null> {
  const intent = parseAssistantCalendarIntent(input.question, input.now);
  if (!intent) return null;
  input.signal.throwIfAborted();
  if (intent.kind === 'invalid') {
    return { answer: intent.message, steps: [], cards: [], stopReason: 'INVALID_EVENT_REQUEST' };
  }
  const summary = describe(intent.event);
  try {
    const result = await bounded(
      (child) => input.tools.withSignal(child, () =>
        input.tools.call('propose_personal_event', intent.event)),
      input.signal,
      4000,
    );
    input.signal.throwIfAborted();
    const cards = input.tools.cards.filter((card) => card.tool === 'propose_personal_event');
    const step: Step = {
      name: 'propose_personal_event',
      status: result.cached ? 'cached' : 'ok',
      summary: cards.length ? '已核對時段並準備行程，等待確認' : '已整理行程內容，尚未儲存',
    };
    if (!cards.length) {
      return {
        answer: `已整理好這筆行程：\n${summary}\n目前尚未開放由助理儲存個人行程，這筆內容尚未加入行事曆。`,
        steps: [step], cards: [], stopReason: 'WRITES_DISABLED',
      };
    }
    // The card is the authoritative preview, including the existing tool's
    // title normalization. Confirmation still rechecks scope, revision and time.
    const event = cards[0].args as AssistantCalendarEvent;
    return {
      answer: `請確認這筆行程：\n${describe(event)}\n按下確認後會加入個人行事曆，儲存並讀回核對後才會顯示完成。`,
      steps: [step], cards, stopReason: '',
    };
  } catch (error) {
    if (input.signal.aborted || (error as { status?: number })?.status === 401) throw error;
    const code = (error as { code?: string })?.code;
    const reason = code === 'ASSISTANT_PERMISSION_DENIED'
      ? '目前未開啟新增個人行程權限。請到[助理權限](/settings?section=assistant)開啟後再試。'
      : code === 'ASSISTANT_PERMISSION_STORE_UNAVAILABLE'
        ? '目前無法核對你的助理權限，尚未建立行程。請稍後重試。'
        : code === 'EVENT_CONFLICT'
      ? '這個時段與課表或個人行程重疊。請換個時間，我會再核對。'
      : code === 'SCHEDULE_INCOMPLETE'
        ? '目前課表有尚未確認的時間，無法完整核對衝突。請先補齊課表時間，再建立這筆行程。'
        : code === 'EVENT_START_PASSED'
          ? '這個開始時間已經過了，請換成未來的時段。'
          : '目前無法完成行程核對，請稍後再試。';
    return {
      answer: `尚未建立這筆行程：\n${summary}\n${reason}`,
      steps: [{ name: 'propose_personal_event', status: 'error', summary: '行程尚未建立' }],
      cards: [],
      stopReason: ['EVENT_CONFLICT', 'SCHEDULE_INCOMPLETE', 'EVENT_START_PASSED',
        'ASSISTANT_PERMISSION_DENIED', 'ASSISTANT_PERMISSION_STORE_UNAVAILABLE'].includes(code || '')
        ? code! : 'EVENT_PREPARATION_UNAVAILABLE',
    };
  }
}
