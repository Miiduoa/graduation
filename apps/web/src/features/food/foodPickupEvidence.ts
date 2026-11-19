import { parseAssistantCalendarEvent } from '@campus/shared/src/assistantExecution';
import { parseAssistantFoodPickupTarget, type AssistantFoodPickupTarget } from '@campus/shared/src/assistantFoodPickupTarget';
import type { AssistantExecutionJournalEntry } from '@/lib/assistantExecutionJournal';
import type { V2Card, V2Reply } from '@/features/nuni/assistant/types';

function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('取餐安排無法核對，請重新預覽。');
  return raw as Record<string, unknown>;
}

/** A display/recovery selector only. The server still authenticates the complete original proof. */
export function matchesFoodPickupTarget(card: Pick<V2Card, 'token' | 'mutationId' | 'sourceBound'>,
  target: Pick<AssistantFoodPickupTarget, 'tenantId' | 'orderId'>): boolean {
  try {
    if (card.sourceBound !== 'food-pickup' || typeof card.token !== 'string' || card.token.length > 2048) return false;
    const [body, signature, extra] = card.token.split('.');
    if (extra !== undefined || !body || !signature || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(signature)) return false;
    const bytes = Uint8Array.from(atob(body.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
    const payload = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    const guard = record(payload.pickupGuard);
    return payload.v === 2 && payload.stage === 'execute' && payload.tool === 'propose_personal_event' &&
      payload.mutationId === card.mutationId && guard.tenantId === target.tenantId && guard.orderId === target.orderId;
  } catch { return false; }
}

export function foodPickupRecovery(entries: AssistantExecutionJournalEntry[], target: AssistantFoodPickupTarget) {
  const matching = entries.filter(entry => matchesFoodPickupTarget(entry.card, target));
  return {
    cards: matching.map(entry => ({ ...entry.card, args: { ...entry.card.args }, conversationId: entry.conversationId })) as V2Card[],
    otherPending: entries.length !== matching.length,
  };
}

export function parseFoodPickupReply(raw: unknown, schoolId: string, conversationId: string, target: AssistantFoodPickupTarget): V2Reply {
  const value = record(raw), selected = parseAssistantFoodPickupTarget(value.pickupTarget), expected = parseAssistantFoodPickupTarget(target);
  if (selected.tenantId !== expected.tenantId || selected.orderId !== expected.orderId || selected.durationMinutes !== expected.durationMinutes ||
      value.version !== 2 || value.dataRead !== true || value.modelCalls !== 0 || value.simulation !== false ||
      typeof value.answer !== 'string' || !value.answer.trim() || value.answer.length > 12000 ||
      !Array.isArray(value.cards) || value.cards.length > 1 || !Array.isArray(value.steps) || value.steps.length > 10)
    throw new Error('這份安排與選取的訂單不一致，請重新預覽。');
  const cards = value.cards.map((rawCard): V2Card => {
    const card = record(rawCard);
    if (card.tool !== 'propose_personal_event' || card.sourceBound !== 'food-pickup' || card.schoolId !== schoolId ||
        typeof card.token !== 'string' || !/^[A-Za-z0-9_.-]{1,2048}$/.test(card.token) ||
        typeof card.mutationId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(card.mutationId) ||
        typeof card.destination !== 'string' || !card.destination.trim() || card.destination.length > 300)
      throw new Error('取餐安排無法核對，沒有送出任何操作。');
    const result: V2Card = { tool: card.tool, sourceBound: 'food-pickup', schoolId, token: card.token,
      mutationId: card.mutationId, destination: card.destination,
      args: { ...parseAssistantCalendarEvent(card.args) }, conversationId };
    if (!matchesFoodPickupTarget(result, target)) throw new Error('取餐安排的原訂單無法核對，請重新預覽。');
    return result;
  });
  const steps = value.steps.map(rawStep => {
    const step = record(rawStep);
    if (typeof step.name !== 'string' || step.name.length > 100 ||
        !['ok', 'error', 'cached'].includes(String(step.status)) ||
        typeof step.summary !== 'string' || step.summary.length > 1000)
      throw new Error('取餐安排的核對步驟不完整，請重新預覽。');
    return { name: step.name, status: String(step.status), summary: step.summary };
  });
  return { answer: value.answer, cards, steps, dataRead: true };
}
