import { beginProposal, calendarLedger, signCard, verifyRevokedCalendarPlan } from './actions';
import { canonical, eventArgs, fail, id, object, type Adapter, type Binding, type Card } from './contracts';
import { operationSignal } from './operation';
import { validateEventProposal } from './tools';

/** Replace one timed event's dates/clocks; source cards are never edited or reused. */
export async function directPlanRevision(
  binding: Binding, originalCards: unknown, rawChange: unknown, secret: string, adapter: Adapter,
) {
  operationSignal()?.throwIfAborted();
  const source = verifyRevokedCalendarPlan(binding, originalCards, secret, Date.now());
  const change = object(rawChange, ['mutationId', 'date', 'endDate', 'startTime', 'endTime']);
  const target = source.findIndex(card => card.mutationId === id(change.mutationId));
  if (target < 0) return fail('INVALID_PLAN_REVISION');
  const events = source.map(card => eventArgs(card.args));
  const previous = events[target];
  if (previous.allDay) return fail('INVALID_PLAN_REVISION');
  if (Object.hasOwn(change, 'endDate') && typeof change.endDate !== 'string') return fail();
  const effectiveEnd = change.endDate ?? change.date;
  const changed = eventArgs({
    title: previous.title, allDay: previous.allDay, date: change.date,
    startTime: change.startTime, endTime: change.endTime,
    ...(Object.hasOwn(previous, 'endDate') || effectiveEnd !== change.date ? { endDate: effectiveEnd } : {}),
  });
  if (canonical(changed) === canonical(previous)) return fail('PLAN_REVISION_UNCHANGED');
  const candidates = events.map((event, index) => index === target ? changed : event);

  // The manifest proves every source was revoked without any dispatched or
  // unresolved write. One fresh scoped ledger checks the whole batch for actual
  // records; per-card read-back would exhaust the unchanged 12-call API budget.
  const ledger = await calendarLedger(binding, adapter);
  if (ledger.records.some(row => source.some(card => card.mutationId === row.id)))
    return fail('PLAN_REVISION_UNRESOLVED', 409);

  // Keep this validation instant as the new token iat so a start that passes
  // during synchronous validation remains prospective at confirmation time.
  const issuedAt = Date.now();
  for (const [index, event] of candidates.entries())
    validateEventProposal(ledger, event, candidates.slice(0, index), issuedAt, true);

  // All I/O and validation finish before rotating the source. Keep the final
  // source/expiry check and complete issuance synchronous so retries cannot
  // consume the same source twice or expose only a partially validated plan.
  operationSignal()?.throwIfAborted();
  verifyRevokedCalendarPlan(binding, originalCards, secret, Date.now());
  const sequence = beginProposal(binding, issuedAt);
  const cards: Card[] = [];
  for (const event of candidates)
    cards.push(signCard(binding, 'propose_personal_event', event, ledger.revision + cards.length,
      secret, issuedAt, sequence, cards.at(-1)));
  return {
    version: 2, answer: '已依指定日期與時間更新預覽，其他行程保持原樣。請逐筆核對新卡；確認前不會寫入行程。',
    steps: [], cards, simulation: adapter.simulation,
  };
}
