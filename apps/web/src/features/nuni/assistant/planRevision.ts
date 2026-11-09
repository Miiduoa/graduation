import { parseAssistantCalendarEvent, type AssistantCalendarEvent } from '@campus/shared/src/assistantExecution';
import { createPlanProtection } from '@/lib/assistantPlanProtection';
import type { V2ActionStates, V2Card, V2Turn } from './types';

const EVENT_FIELDS = ['title', 'date', 'endDate', 'allDay', 'startTime', 'endTime'] as const;
export type PlanRevisionEvent = Omit<AssistantCalendarEvent, 'location'>;

function invalidPlan(): never {
  throw new Error('原安排無法完整核對，請重新提出行程預覽後再修改。');
}

function eventSnapshot(card: V2Card): PlanRevisionEvent {
  if (card.tool !== 'propose_personal_event' || !card.args || typeof card.args !== 'object' || Array.isArray(card.args))
    return invalidPlan();
  const fields: Record<string, unknown> = {};
  const descriptors = Object.getOwnPropertyDescriptors(card.args);
  for (const key of EVENT_FIELDS) {
    const descriptor = descriptors[key];
    if (!descriptor) continue;
    if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) return invalidPlan();
    fields[key] = descriptor.value;
  }
  try { return parseAssistantCalendarEvent(fields); }
  catch { return invalidPlan(); }
}

/** The exact displayed calendar details, with no source, account or execution metadata. */
export function getPlanRevisionEvents(turn: V2Turn): PlanRevisionEvent[] {
  if (!Array.isArray(turn.reply.cards) || turn.reply.cards.length === 0) return invalidPlan();
  return turn.reply.cards.map(eventSnapshot);
}

export function isUnattemptedCalendarPlan(turn: V2Turn, states: V2ActionStates): boolean {
  try {
    getPlanRevisionEvents(turn);
    return turn.reply.cards.every(card => states[card.mutationId] === undefined);
  } catch { return false; }
}

export function hasUnresolvedAssistantAction(states: V2ActionStates): boolean {
  return Object.values(states).some(state =>
    ['unknown', 'executing', 'checking', 'conflict', 'absent', 'blocked'].includes(state.status));
}

/** A new preview request only; this never rewrites a signed confirmation card. */
export function buildPlanRevisionQuestion(turn: V2Turn, instruction: string, protectedIndices: readonly number[] = []): string {
  const change = typeof instruction === 'string' ? instruction.trim() : '';
  if (!change) throw new Error('請先填寫想修改的安排。');
  if (change.length > 300) throw new Error('修改條件最多 300 字，請縮短後再預覽。');
  const protection = protectedIndices.length ? createPlanProtection(turn.reply.cards.map(card => card.args), protectedIndices) : undefined;
  const events = protection?.originalEvents || getPlanRevisionEvents(turn);
  const preserved = protection ? '\n必須保留原樣的項目（原安排編號，由 1 開始）：' + protection.protectedIndices.map(index => index + 1).join('、')
    + '。這些項目的所有欄位及筆數必須與原安排完全相同，不可更改、遺漏或複製。' : '';
  const question = '請依下列修改條件，僅重新預覽原安排並產生新的確認卡；沒有要求修改的行程請保持原樣。'
    + '這次不要執行、儲存或取消任何行程，新確認卡仍須由我另行確認。\n'
    + '原安排：' + JSON.stringify(events) + '\n修改條件：' + change + preserved;
  if (question.length > 1000) throw new Error('原安排加上修改條件超過 1000 字，請縮短修改條件或重新提出較少行程；內容不會被截斷。');
  return question;
}
