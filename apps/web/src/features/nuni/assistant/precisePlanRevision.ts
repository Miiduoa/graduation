import { createPlanProtection, type PlanProtectionEvent } from '@/lib/assistantPlanProtection';
import type { V2Turn } from './types';

export type PrecisePlanRevisionChange = {
  mutationId: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
};
export type PrecisePlanRevision = {
  before: PlanProtectionEvent[];
  after: PlanProtectionEvent[];
  index: number;
  label: string;
  changed: boolean;
};
export type PrecisePlanRevisionTarget = {
  index: number;
  mutationId: string;
  event: PlanProtectionEvent & { allDay: false; startTime: string; endTime: string };
  label: string;
};
const FIELDS = ['title', 'date', 'endDate', 'allDay', 'startTime', 'endTime'] as const;
const CHANGE_FIELDS = ['mutationId', 'date', 'endDate', 'startTime', 'endTime'];
const ORIGINAL_ERROR = '原提議內容無法完整核對，請重新取得行程預覽。';
const CHANGE_ERROR = '請確認日期與時間，結束時間必須晚於開始時間。';

function ownData(raw: unknown, field: string): unknown {
  if (!raw || typeof raw !== 'object') throw new Error(ORIGINAL_ERROR);
  const descriptor = Object.getOwnPropertyDescriptor(raw, field);
  if (!descriptor?.enumerable || !('value' in descriptor) || descriptor.value === undefined) throw new Error(ORIGINAL_ERROR);
  return descriptor.value;
}
function snapshot(turn: V2Turn) {
  const reply = ownData(turn, 'reply'), cards = ownData(reply, 'cards');
  if (!Array.isArray(cards) || !cards.length || cards.length > 16) throw new Error(ORIGINAL_ERROR);
  const ids = new Set<string>(), rows: unknown[] = [];
  let school: string | undefined;
  for (let index = 0; index < cards.length; index++) {
    const card = ownData(cards, String(index));
    if (Array.isArray(card)) throw new Error(ORIGINAL_ERROR);
    const mutationId = ownData(card, 'mutationId'), schoolId = ownData(card, 'schoolId');
    if (ownData(card, 'tool') !== 'propose_personal_event' || typeof mutationId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(mutationId) || ids.has(mutationId) ||
      typeof schoolId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(schoolId) || schoolId === 'personal' ||
      (school !== undefined && schoolId !== school)) throw new Error(ORIGINAL_ERROR);
    school = schoolId;
    ids.add(mutationId);
    rows.push(ownData(card, 'args'));
  }
  const events = createPlanProtection(rows, []).originalEvents;
  for (const event of events) {
    if (event.endDate && Date.parse(event.endDate) - Date.parse(event.date) > 31 * 86400000) throw new Error(ORIGINAL_ERROR);
  }
  return { events, ids: [...ids] };
}

export function precisePlanTimeRange(event: PlanProtectionEvent): string {
  return event.endDate && event.endDate !== event.date
    ? `${event.date} ${event.startTime} – ${event.endDate} ${event.endTime}`
    : `${event.date} ${event.startTime}–${event.endTime}`;
}
export function samePrecisePlanEvent(left: PlanProtectionEvent, right: PlanProtectionEvent): boolean {
  return FIELDS.every(field => Object.hasOwn(left, field) === Object.hasOwn(right, field) && left[field] === right[field]);
}

/** Only timed events are selectable; the ordinal always refers to the complete original plan. */
export function getPrecisePlanRevisionTargets(turn: V2Turn): PrecisePlanRevisionTarget[] {
  const { events, ids } = snapshot(turn);
  return events.flatMap((event, index) => event.allDay ? [] : [{ index, mutationId: ids[index],
    event: event as PrecisePlanRevisionTarget['event'],
    label: `第 ${index + 1} 項 · ${event.title} · ${precisePlanTimeRange(event)}`,
  }]);
}

/** Build comparison candidates only. Never edit a signed card, reuse a token, or call a model. */
export function buildPrecisePlanRevision(turn: V2Turn, change: PrecisePlanRevisionChange): PrecisePlanRevision {
  const { events: before, ids } = snapshot(turn);
  let fields: Record<string, unknown>;
  try {
    if (!change || typeof change !== 'object' || Array.isArray(change) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(change))) throw new Error();
    fields = {};
    for (const field of Reflect.ownKeys(change)) {
      if (typeof field !== 'string' || !CHANGE_FIELDS.includes(field)) throw new Error();
      fields[field] = ownData(change, field);
    }
    if (typeof fields.mutationId !== 'string' || typeof fields.date !== 'string' ||
      typeof fields.startTime !== 'string' || typeof fields.endTime !== 'string' ||
      (Object.hasOwn(fields, 'endDate') && typeof fields.endDate !== 'string')) throw new Error();
  } catch { throw new Error('請選擇要調整的行程，並填寫完整日期與時間。'); }
  const index = ids.indexOf(fields.mutationId as string);
  if (index < 0) throw new Error('找不到要調整的原提議，請重新選擇行程。');
  const original = before[index];
  if (original.allDay) throw new Error('這裡只調整有明確起訖時間的行程，全天項目不能在此修改。');
  const endDate = (fields.endDate ?? fields.date) as string;
  const next: PlanProtectionEvent = { ...original, date: fields.date as string,
    startTime: fields.startTime as string, endTime: fields.endTime as string };
  if (Object.hasOwn(original, 'endDate') || endDate !== next.date) next.endDate = endDate;
  else delete next.endDate;
  let after: PlanProtectionEvent[];
  try { after = createPlanProtection(before.map((event, position) => position === index ? next : event), []).originalEvents; }
  catch { throw new Error(CHANGE_ERROR); }
  if (Date.parse(endDate) - Date.parse(next.date) > 31 * 86400000)
    throw new Error('跨日行程的開始與結束日期最多相隔 31 天。');
  return { before, after, index, label: `第 ${index + 1} 項 · ${original.title}`,
    changed: !samePrecisePlanEvent(original, after[index]) };
}
