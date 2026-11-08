import type { V2ActionState, V2ActionStates, V2Card, V2Turn } from './types';

/** A request deadline must not abort the whole account/school conversation. */
export async function withAssistantRequestDeadline<T>(
  lifetime: AbortSignal,
  milliseconds: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (lifetime.aborted) throw new Error('已取消');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: () => void = () => {};
  const stopped = new Promise<never>((_resolve, reject) => {
    stop = () => {
      controller.abort();
      reject(new Error('已取消'));
    };
    lifetime.addEventListener('abort', stop, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('連線逾時，請核對原操作結果；目前不會自動重新送出。'));
    }, milliseconds);
  });
  try {
    return await Promise.race([work(controller.signal), stopped]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    lifetime.removeEventListener('abort', stop);
  }
}

export function calendarExpectation(card: V2Card) {
  if (card.tool !== 'propose_personal_event') throw new Error('這張確認卡不是個人行程。');
  return {
    schoolId: card.schoolId,
    mutationId: card.mutationId,
    event: card.args,
    storage: 'synced' as const,
  };
}

export function canConfirmAction(state: V2ActionState | undefined): boolean {
  return !state || state.status === 'blocked' || (state.status === 'absent' && state.retryable);
}

export function priorCalendarActionsVerified(
  cards: V2Card[],
  index: number,
  states: V2ActionStates,
): boolean {
  return cards.slice(0, index).every((card) =>
    card.tool !== 'propose_personal_event' || states[card.mutationId]?.status === 'verified',
  );
}

/** Only observed results enter memory. Tokens, row IDs and source text stay in the UI. */
export function assistantAnswerWithExecution(turn: V2Turn, states: V2ActionStates): string {
  const calendar = turn.reply.cards.filter((card) => card.tool === 'propose_personal_event');
  const verified = calendar.filter((card) => states[card.mutationId]?.status === 'verified').length;
  const unknown = calendar.filter((card) => ['unknown', 'executing', 'checking'].includes(states[card.mutationId]?.status)).length;
  const summary = calendar.length
    ? `個人行程共 ${calendar.length} 項：已儲存並讀回核對 ${verified} 項，結果未明 ${unknown} 項，其餘未完成或已撤銷。結果未明不得視為完成或重新建立。`
    : '服務入口準備結果不代表服務交易已完成。';
  const results = turn.reply.cards.flatMap((card) => {
    const state = states[card.mutationId];
    if (!state) return [];
    if (state.status === 'verified') {
      const event = state.receipt.record;
      return [`已讀回核對並儲存個人行程「${event.title}」：${event.date} ${event.allDay ? '全天' : `${event.startTime}–${event.endTime}`}。${state.local === 'unavailable' ? '帳號已儲存，此裝置尚未讀回或更新，不能宣稱本機已可見。' : ''}${state.verificationWarning ? `最近的再次查核未完成，保留的是 ${state.receipt.verifiedAt} 的核對結果。` : ''}這是行程儲存結果，沒有設定推播，也不代表作業已完成或繳交。`];
    }
    if (state.status === 'unknown' || state.status === 'checking' || state.status === 'executing')
      return ['這筆操作結果尚未核對，不能宣稱已完成，也不能重新建立同一個安排。'];
    if (state.status === 'cancelled') return ['這份未執行的提議已撤銷，沒有刪除任何已建立的行程。'];
    if (state.status === 'handoff') return ['已備妥服務入口，服務中的提交、付款等操作尚未核對完成。'];
    if (state.status === 'conflict') return ['原提議與現有紀錄不一致，沒有覆寫現有資料。'];
    return ['這份提議尚未核對為完成。'];
  });
  // Put execution facts first: the server deliberately trims history to a small budget.
  return results.length
    ? `系統操作狀態：${summary}\n${results.join('\n')}\n\n原先回覆：${turn.reply.answer}`.slice(0, 4000)
    : turn.reply.answer;
}
