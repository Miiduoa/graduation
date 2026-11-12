import { buildPlanShift } from '@/lib/assistantPlanShift';
import { beginProposal, calendarLedger, signCard, verifyRevokedCalendarPlan } from './actions';
import { canonical, eventArgs, fail, id, object, requireAssistantPermission, type Adapter, type Binding, type Card, type EventArgs } from './contracts';
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

  return issueReplacement(binding, originalCards, source, candidates, secret, adapter,
    '已依指定日期與時間更新預覽，其他行程保持原樣。請逐筆核對新卡；確認前不會寫入行程。');
}

/** Retain an exact subset by signed identity, always in the original issuance order. */
export async function selectPlanRevision(
  binding: Binding, originalCards: unknown, rawKeepMutationIds: unknown, secret: string, adapter: Adapter,
) {
  operationSignal()?.throwIfAborted();
  const source = verifyRevokedCalendarPlan(binding, originalCards, secret, Date.now());
  if (!Array.isArray(rawKeepMutationIds) || rawKeepMutationIds.length === 0 ||
      rawKeepMutationIds.length >= source.length)
    return fail('INVALID_PLAN_SELECTION');
  const sourceIds = new Set(source.map(card => card.mutationId)), keep = new Set<string>();
  for (const mutationId of rawKeepMutationIds) {
    if (typeof mutationId !== 'string' || !sourceIds.has(mutationId) || keep.has(mutationId))
      return fail('INVALID_PLAN_SELECTION');
    keep.add(mutationId);
  }
  const candidates = source.filter(card => keep.has(card.mutationId)).map(card => eventArgs(card.args));
  return issueReplacement(binding, originalCards, source, candidates, secret, adapter,
    '已依原順序保留選取的行程，內容保持原樣。請逐筆核對新卡；確認前不會寫入行程。');
}

/** Translate selected signed identities without changing source order or any fixed event. */
export async function shiftPlanRevision(
  binding: Binding, originalCards: unknown, rawShift: unknown, secret: string, adapter: Adapter,
) {
  operationSignal()?.throwIfAborted();
  const source = verifyRevokedCalendarPlan(binding, originalCards, secret, Date.now());
  let candidates: EventArgs[];
  try {
    const shift = object(rawShift, ['mutationIds', 'offsetMinutes', 'protectedMutationIds']);
    const positions = new Map(source.map((card, index) => [card.mutationId, index]));
    const mappedIndices = (raw: unknown) => {
      if (!Array.isArray(raw) || raw.length > 16) throw new Error();
      const seen = new Set<string>();
      return raw.map(mutationId => {
        if (typeof mutationId !== 'string' || !positions.has(mutationId) || seen.has(mutationId)) throw new Error();
        seen.add(mutationId);
        return positions.get(mutationId)!;
      });
    };
    candidates = buildPlanShift(source.map(card => eventArgs(card.args)), mappedIndices(shift.mutationIds),
      shift.offsetMinutes, mappedIndices(shift.protectedMutationIds)).after;
  } catch { return fail('INVALID_PLAN_SHIFT'); }
  return issueReplacement(binding, originalCards, source, candidates, secret, adapter,
    '已依指定分鐘數平移所選行程，其他項目保持原樣。請逐筆核對新卡；確認前不會寫入行程。');
}

async function issueReplacement(
  binding: Binding, originalCards: unknown, source: ReturnType<typeof verifyRevokedCalendarPlan>,
  candidates: EventArgs[], secret: string, adapter: Adapter, answer: string,
) {
  // The manifest proves every source was revoked without any dispatched or
  // unresolved write. One fresh scoped ledger checks the whole batch for actual
  // records; per-card read-back would exhaust the unchanged 12-call API budget.
  await requireAssistantPermission(adapter, 'createPersonalEvent');
  const ledger = await calendarLedger(binding, adapter);
  await requireAssistantPermission(adapter, 'createPersonalEvent');
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
  return { version: 2, answer, steps: [], cards, simulation: adapter.simulation };
}
