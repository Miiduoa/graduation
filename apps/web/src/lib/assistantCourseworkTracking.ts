'use client';

import {
  parseAssistantCourseworkFollowup,
  type AssistantCourseworkFollowup,
} from '@campus/shared/src/assistantCourseworkFollowup';
import { parseAssistantCalendarEvent, type AssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import type { V2Card } from '@/features/nuni/assistant/types';
import { saveTodayAgentFollowup, type TodayAgentFollowupScope } from './todayAgentFollowups';

/** Fresh ordinary events need no coursework storage. Older recovery records
 * have no hint, so their signed proof must be classified by a read. */
export function needsCourseworkTracking(card: V2Card, restored = false): boolean {
  return card.tool === 'propose_personal_event' &&
    (card.coursework === true || (restored && card.coursework === undefined && card.sourceBound !== 'food-pickup'));
}

/** A display hint never supplies a task identity or grants a write. The server
 * recovers the exact source from the original signature, then the verified
 * calendar receipt permits the proof to leave the execution journal. */
export async function retainAssistantCourseworkTracking(input: {
  scope: TodayAgentFollowupScope;
  context: string;
  conversationId: string;
  card: V2Card;
  receipt: AssistantCalendarReceipt;
  active: () => boolean;
  source?: symbol;
  read: (request: { issuedContext: string; conversationId: string; token: string; args: unknown }) => Promise<unknown>;
}): Promise<AssistantCourseworkFollowup | null> {
  const requireActive = () => {
    if (!input.active()) throw new Error('登入或校園已變更，這次安排追蹤已停止。');
  };
  requireActive();
  const event = parseAssistantCalendarEvent(input.card.args);
  const raw = await input.read({ issuedContext: input.context, conversationId: input.conversationId,
    token: input.card.token, args: event });
  requireActive();
  const followup = parseAssistantCourseworkFollowup(raw, { schoolId: input.scope.schoolId,
    mutationId: input.card.mutationId, event });
  if (followup.status === 'not_coursework') return null;
  await saveTodayAgentFollowup(input.scope, {
    issuedContext: input.context,
    conversationId: input.conversationId,
    card: { tool: 'propose_personal_event', token: input.card.token, args: event,
      mutationId: input.card.mutationId, schoolId: input.card.schoolId, destination: input.card.destination },
  }, input.receipt, input.active, input.source);
  requireActive();
  return followup;
}
