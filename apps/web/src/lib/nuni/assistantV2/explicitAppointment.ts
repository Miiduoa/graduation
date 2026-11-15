import { parseAssistantCalendarIntent } from '@campus/shared/src/assistantCalendarIntent';
import { bounded, type Step } from './contracts';
import type { createTools } from './tools';

/** A fully specified appointment already has all the inputs the proposal needs. */
export async function prepareExplicitAppointment(input: {
  question: string;
  now: number;
  signal: AbortSignal;
  tools: ReturnType<typeof createTools>;
}) {
  const intent = parseAssistantCalendarIntent(input.question, input.now);
  if (!intent) return null;
  if (intent.kind === 'invalid') return { answer: intent.message, steps: [] as Step[], cards: [] };
  const { event } = intent;
  const description = `${event.title}｜${event.date} ${event.startTime}–${event.endTime}`;
  try {
    const result = await bounded(
      (child) => input.tools.withSignal(child, () => input.tools.call('propose_personal_event', event)),
      input.signal,
      4000,
    );
    const cards = input.tools.cards;
    return {
      answer: description + (cards.length
        ? '\n請核對下方行程，按確認後才會儲存到個人行事曆。'
        : '\n目前尚未開啟助理新增個人行程，這筆行程尚未儲存。'),
      steps: [{ name: 'propose_personal_event', status: result.cached ? 'cached' : 'ok', summary: '已檢查行程提議' }] as Step[],
      cards,
    };
  } catch (error) {
    if ((error as { status?: number }).status === 401 || input.signal.aborted) throw error;
    const code = (error as { code?: string }).code;
    const message = code === 'EVENT_CONFLICT'
      ? '這個時段和已同步的課程或行程重疊，請換個時間；尚未新增行程。'
      : code === 'SCHEDULE_INCOMPLETE' || code === 'CALENDAR_INCOMPLETE'
        ? '課表或行程資料尚不完整，暫時無法確認時段，尚未新增行程。'
        : '目前無法準備這筆行程，尚未新增，請稍後再試。';
    return {
      answer: description + '\n' + message,
      steps: [{ name: 'propose_personal_event', status: 'error', summary: '行程尚未建立' }] as Step[],
      cards: [],
    };
  }
}
