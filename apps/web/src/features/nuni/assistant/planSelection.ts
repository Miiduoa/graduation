import { exclusiveAllDayEnd } from '@campus/shared/src/imports/eventCalendar';
import { createPlanProtection, type PlanProtectionEvent } from '@/lib/assistantPlanProtection';
import type { V2Turn } from './types';

export type PlanSelectionTarget = {
  index: number;
  mutationId: string;
  event: PlanProtectionEvent;
  label: string;
};
export type PlanSelection = {
  before: PlanProtectionEvent[];
  after: PlanProtectionEvent[];
  keepMutationIds: string[];
  keptIndices: number[];
  removedIndices: number[];
  changed: boolean;
  allExcluded: boolean;
};

const ORIGINAL_ERROR = '原提議內容無法完整核對，請重新取得行程預覽。';
const SELECTION_ERROR = '保留項目無法完整核對，請重新選擇原提議中的行程。';
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const SCHOOL = /^[a-z0-9][a-z0-9-]{0,79}$/;

function ownData(raw: unknown, field: string, message = ORIGINAL_ERROR): unknown {
  if (!raw || typeof raw !== 'object') throw new Error(message);
  const descriptor = Object.getOwnPropertyDescriptor(raw, field);
  if (!descriptor?.enumerable || !('value' in descriptor) || descriptor.value === undefined) throw new Error(message);
  return descriptor.value;
}
function arrayValues(raw: unknown, message: string): unknown[] {
  if (!Array.isArray(raw) || raw.length > 16) throw new Error(message);
  if (Reflect.ownKeys(raw).some(key => key !== 'length' &&
    (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= raw.length))) throw new Error(message);
  return Array.from({ length: raw.length }, (_, index) => ownData(raw, String(index), message));
}
function snapshot(turn: V2Turn): { events: PlanProtectionEvent[]; ids: string[] } {
  const reply = ownData(turn, 'reply');
  const cards = arrayValues(ownData(reply, 'cards'), ORIGINAL_ERROR);
  if (!cards.length) throw new Error(ORIGINAL_ERROR);
  const ids = new Set<string>(), rows: unknown[] = [];
  let school: string | undefined;
  for (const card of cards) {
    if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error(ORIGINAL_ERROR);
    const mutationId = ownData(card, 'mutationId'), schoolId = ownData(card, 'schoolId'), token = ownData(card, 'token');
    if (ownData(card, 'tool') !== 'propose_personal_event' || typeof mutationId !== 'string' || !ID.test(mutationId) ||
      ids.has(mutationId) || typeof schoolId !== 'string' || !SCHOOL.test(schoolId) || schoolId === 'personal' ||
      (school !== undefined && schoolId !== school) || typeof token !== 'string' || !token.trim())
      throw new Error(ORIGINAL_ERROR);
    school = schoolId;
    ids.add(mutationId);
    rows.push(ownData(card, 'args'));
  }
  // Preserve raw optional-field presence. This validates content, not card signatures.
  return { events: createPlanProtection(rows, []).originalEvents, ids: [...ids] };
}

export function planSelectionEventTime(event: PlanProtectionEvent): string {
  if (event.allDay) {
    const endDate = exclusiveAllDayEnd(event.date, event.endDate);
    if (!endDate) throw new Error(ORIGINAL_ERROR);
    return `${event.date} · 全天（至 ${endDate}，不含結束日）`;
  }
  const range = event.endDate && event.endDate !== event.date
    ? `${event.date} ${event.startTime} – ${event.endDate} ${event.endTime}`
    : `${event.date} ${event.startTime}–${event.endTime}`;
  return range + '（台灣時間）';
}

/** Every original row stays individually selectable, including exact duplicate content. */
export function getPlanSelectionTargets(turn: V2Turn): PlanSelectionTarget[] {
  const { events, ids } = snapshot(turn);
  return events.map((event, index) => ({ index, mutationId: ids[index], event,
    label: `第 ${index + 1} 項 · ${event.title} · ${planSelectionEventTime(event)}`,
  }));
}

/** Build content snapshots only. Signing and execution remain the server's responsibility. */
export function buildPlanSelection(turn: V2Turn, keepIDs: readonly string[]): PlanSelection {
  const { events: before, ids } = snapshot(turn);
  const requested = arrayValues(keepIDs, SELECTION_ERROR), chosen = new Set<string>();
  for (const id of requested) {
    if (typeof id !== 'string' || !ID.test(id) || !ids.includes(id) || chosen.has(id)) throw new Error(SELECTION_ERROR);
    chosen.add(id);
  }
  const keptIndices: number[] = [], removedIndices: number[] = [];
  for (let index = 0; index < before.length; index++) {
    (chosen.has(ids[index]) ? keptIndices : removedIndices).push(index);
  }
  return {
    before,
    after: keptIndices.map(index => ({ ...before[index] })),
    keepMutationIds: keptIndices.map(index => ids[index]),
    keptIndices,
    removedIndices,
    changed: keptIndices.length !== before.length,
    allExcluded: keptIndices.length === 0,
  };
}
