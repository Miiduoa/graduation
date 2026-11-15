import { parseAssistantCalendarEvent } from '@campus/shared/src/assistantExecution';
import { exclusiveAllDayEnd } from '@campus/shared/src/imports/eventCalendar';
import type { PlanRevisionEvent } from './planRevision';

const FIELDS = ['title', 'date', 'endDate', 'allDay', 'startTime', 'endTime'] as const;
export type PlanComparisonField = typeof FIELDS[number];
export type PlanComparisonEvent = Omit<PlanRevisionEvent, 'endDate'> & { endDate: string };
export type PlanModification = {
  before: PlanComparisonEvent;
  after: PlanComparisonEvent;
  fields: Array<{ field: PlanComparisonField; before: string | boolean | null; after: string | boolean | null }>;
  basis: 'title' | 'schedule' | 'both';
};
export type PlanComparison =
  | { kind: 'unavailable'; message: string }
  | {
    kind: 'available';
    unchanged: number;
    modified: PlanModification[];
    added: PlanComparisonEvent[];
    removed: PlanComparisonEvent[];
    ambiguous: { before: PlanComparisonEvent[]; after: PlanComparisonEvent[] };
    orderChanged: boolean;
  };

type IndexedEvent = { event: PlanComparisonEvent; index: number; full: string; schedule: string };

function snapshot(raw: unknown): PlanComparisonEvent[] {
  if (!Array.isArray(raw)) throw new Error('Missing snapshot');
  const events: PlanComparisonEvent[] = [];
  for (let index = 0; index < raw.length; index++) {
    const row = Object.getOwnPropertyDescriptor(raw, String(index));
    if (!row || !('value' in row)) throw new Error('Missing event');
    const value = row.value;
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new Error('Invalid event');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const fields: Record<string, unknown> = {};
    for (const field of FIELDS) {
      const descriptor = descriptors[field];
      if (!descriptor) continue;
      if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) throw new Error('Invalid field');
      fields[field] = descriptor.value;
    }
    const event = parseAssistantCalendarEvent(fields);
    // Shared calendar semantics: all-day endDate is exclusive; a missing end
    // means the next day. Timed events without endDate end on their start date.
    const endDate = event.allDay ? exclusiveAllDayEnd(event.date, event.endDate) : event.endDate || event.date;
    if (!endDate) throw new Error('Missing end date');
    events.push({ ...event, endDate });
  }
  return events;
}

function fieldValue(event: PlanComparisonEvent, field: PlanComparisonField): string | boolean | null {
  return event[field] ?? null;
}
function indexed(events: PlanComparisonEvent[]): IndexedEvent[] {
  return events.map((event, index) => ({ event, index,
    full: JSON.stringify(FIELDS.map(field => fieldValue(event, field))),
    schedule: JSON.stringify(FIELDS.slice(1).map(field => fieldValue(event, field))),
  }));
}
function groupBy(rows: IndexedEvent[], key: (row: IndexedEvent) => string) {
  const groups = new Map<string, IndexedEvent[]>();
  for (const row of rows) {
    const value = key(row), group = groups.get(value);
    if (group) group.push(row);
    else groups.set(value, [row]);
  }
  return groups;
}

/** Compare proposed content only. Matching is never authorization or a claim of a saved change. */
export function comparePlanRevision(before: unknown, after: unknown): PlanComparison {
  let oldRows: IndexedEvent[], newRows: IndexedEvent[];
  try { oldRows = indexed(snapshot(before)); newRows = indexed(snapshot(after)); }
  catch { return { kind: 'unavailable', message: '無法完整比較新舊提議，請逐項核對新確認卡；沒有據此修改行事曆。' }; }

  const oldFull = groupBy(oldRows, row => row.full), newFull = groupBy(newRows, row => row.full);
  const oldTitles = groupBy(oldRows, row => row.event.title), newTitles = groupBy(newRows, row => row.event.title);
  const oldSchedules = groupBy(oldRows, row => row.schedule), newSchedules = groupBy(newRows, row => row.schedule);
  const usedOld = new Set<number>(), usedNew = new Set<number>();
  const modifiedPairs = new Set<string>();
  let unchanged = 0;

  // Equal duplicate rows are counted as a multiset, without inventing identity.
  for (const [key, oldGroup] of oldFull) {
    const newGroup = newFull.get(key) || [];
    const count = Math.min(oldGroup.length, newGroup.length);
    unchanged += count;
    for (let index = 0; index < count; index++) {
      usedOld.add(oldGroup[index].index);
      usedNew.add(newGroup[index].index);
    }
  }

  const candidates = new Map<number, Map<number, number>>();
  const incoming = new Map<number, Set<number>>();
  for (const oldRow of oldRows) {
    if (usedOld.has(oldRow.index)) continue;
    const targets = new Map<number, number>();
    const offer = (row: IndexedEvent | undefined, basis: number) => {
      if (row && !usedNew.has(row.index)) targets.set(row.index, (targets.get(row.index) || 0) | basis);
    };
    // Uniqueness is checked in the complete snapshots, not just leftovers.
    if (oldTitles.get(oldRow.event.title)?.length === 1 && newTitles.get(oldRow.event.title)?.length === 1)
      offer(newTitles.get(oldRow.event.title)?.[0], 1);
    if (oldSchedules.get(oldRow.schedule)?.length === 1 && newSchedules.get(oldRow.schedule)?.length === 1)
      offer(newSchedules.get(oldRow.schedule)?.[0], 2);
    candidates.set(oldRow.index, targets);
    for (const target of targets.keys()) {
      const sources = incoming.get(target) || new Set<number>();
      sources.add(oldRow.index);
      incoming.set(target, sources);
    }
  }

  const modifiedByNewIndex = new Map<number, PlanModification>();
  for (const [oldIndex, targets] of candidates) {
    if (targets.size !== 1) continue;
    const [newIndex, evidence] = targets.entries().next().value!;
    if (incoming.get(newIndex)?.size !== 1) continue;
    const oldEvent = oldRows[oldIndex].event, newEvent = newRows[newIndex].event;
    const fields = FIELDS.filter(field => fieldValue(oldEvent, field) !== fieldValue(newEvent, field))
      .map(field => ({ field, before: fieldValue(oldEvent, field), after: fieldValue(newEvent, field) }));
    modifiedByNewIndex.set(newIndex, { before: oldEvent, after: newEvent, fields,
      basis: evidence === 3 ? 'both' : evidence === 1 ? 'title' : 'schedule' });
    usedOld.add(oldIndex);
    usedNew.add(newIndex);
    modifiedPairs.add(oldIndex + ':' + newIndex);
  }

  const oldRest = oldRows.filter(row => !usedOld.has(row.index)).map(row => row.event);
  const newRest = newRows.filter(row => !usedNew.has(row.index)).map(row => row.event);
  const ambiguous = oldRest.length && newRest.length
    ? { before: oldRest, after: newRest } : { before: [], after: [] };
  // Find the largest order-preserving alignment of equal content or accepted
  // modifications. Duplicate identity is left open: reordering is proven only
  // when no alignment can retain every matched event in the original order.
  let previous = new Array<number>(newRows.length + 1).fill(0);
  for (const oldRow of oldRows) {
    const current = new Array<number>(newRows.length + 1).fill(0);
    for (const newRow of newRows) {
      const match = oldRow.full === newRow.full || modifiedPairs.has(oldRow.index + ':' + newRow.index);
      current[newRow.index + 1] = Math.max(previous[newRow.index + 1], current[newRow.index],
        match ? previous[newRow.index] + 1 : 0);
    }
    previous = current;
  }
  const orderChanged = previous[newRows.length] < unchanged + modifiedByNewIndex.size;
  return { kind: 'available', unchanged,
    modified: [...modifiedByNewIndex].sort(([left], [right]) => left - right).map(([, change]) => change),
    added: oldRest.length === 0 ? newRest : [], removed: newRest.length === 0 ? oldRest : [],
    ambiguous, orderChanged };
}
