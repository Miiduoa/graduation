import { parseAssistantCalendarEvent } from '@campus/shared/src/assistantExecution';

export type PlanProtectionEvent = {
  title: string;
  date: string;
  endDate?: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
};
export type PlanProtection = {
  originalEvents: PlanProtectionEvent[];
  protectedIndices: number[];
};
export type PlanProtectionResult = { ok: true } | { ok: false; message: string };

const FIELDS = ['title', 'date', 'endDate', 'allDay', 'startTime', 'endTime'] as const;
const MAX_EVENTS = 16;
const INVALID_ORIGINAL = '原提議內容無法完整核對，請重新取得行程預覽。';
const INVALID_INDICES = '保留項目不正確，請重新選擇原提議中的行程。';
const PARTIAL_DUPLICATES = '完全相同的行程需一起標記保留，請勾選該組全部項目後再試。';

/** Read JSON-like own data properties without evaluating getters or dropping fields. */
function ownFields(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(raw))) throw new Error(INVALID_ORIGINAL);
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw new Error(INVALID_ORIGINAL);
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) throw new Error(INVALID_ORIGINAL);
    result[key] = descriptor.value;
  }
  return result;
}
function arrayValues(raw: unknown, limit: number): unknown[] {
  if (!Array.isArray(raw) || raw.length > limit) throw new Error(INVALID_ORIGINAL);
  const values: unknown[] = [];
  for (let index = 0; index < raw.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
    if (!descriptor || !('value' in descriptor)) throw new Error(INVALID_ORIGINAL);
    values.push(descriptor.value);
  }
  return values;
}
function events(raw: unknown): PlanProtectionEvent[] {
  return arrayValues(raw, MAX_EVENTS).map(value => {
    const fields = ownFields(value, FIELDS);
    parseAssistantCalendarEvent(fields);
    // Keep raw optional-field presence: an implicit endDate is not rewritten.
    return fields as PlanProtectionEvent;
  });
}
function key(event: PlanProtectionEvent, fields: readonly (typeof FIELDS[number])[] = FIELDS): string {
  return JSON.stringify(fields.map(field => Object.hasOwn(event, field) ? [true, event[field]] : [false]));
}
function counts(values: PlanProtectionEvent[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const event of values) result.set(key(event), (result.get(key(event)) || 0) + 1);
  return result;
}

/** Freeze the reviewed content by value; no account, token or mutation metadata belongs here. */
export function createPlanProtection(originalEvents: unknown, indices: unknown): PlanProtection {
  let original: PlanProtectionEvent[];
  try { original = events(originalEvents); }
  catch { throw new Error(INVALID_ORIGINAL); }
  if (!original.length) throw new Error('原提議需包含 1 到 16 項行程。');
  let selection: unknown[];
  try { selection = arrayValues(indices, MAX_EVENTS); }
  catch { throw new Error(INVALID_INDICES); }
  const selected = new Set<number>();
  for (const value of selection) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= original.length || selected.has(value))
      throw new Error(INVALID_INDICES);
    selected.add(value);
  }
  const protectedIndices = [...selected].sort((left, right) => left - right);
  const allCounts = counts(original);
  const protectedCounts = counts(protectedIndices.map(index => original[index]));
  for (const [content, count] of protectedCounts) {
    if (count !== allCounts.get(content)) throw new Error(PARTIAL_DUPLICATES);
  }
  return { originalEvents: original, protectedIndices };
}

/** Reject the whole candidate proposal on failure; this function never repairs or inserts cards. */
export function validatePlanProtection(plan: PlanProtection, candidateEvents: unknown): PlanProtectionResult {
  let protection: PlanProtection;
  try {
    const fields = ownFields(plan, ['originalEvents', 'protectedIndices']);
    protection = createPlanProtection(fields.originalEvents, fields.protectedIndices);
  } catch { return { ok: false, message: '保留設定無法核對，請重新選擇原提議中的項目。' }; }
  // No selected preservation constraint means no additional candidate enforcement.
  if (!protection.protectedIndices.length) return { ok: true };
  let candidate: PlanProtectionEvent[];
  try { candidate = events(candidateEvents); }
  catch { return { ok: false, message: '新預覽的行程內容無法完整核對，請調整條件後重新預覽。' }; }

  const originalCounts = counts(protection.originalEvents), candidateCounts = counts(candidate);
  const locked = protection.protectedIndices.map(index => protection.originalEvents[index]);
  for (const event of locked) {
    if (candidateCounts.get(key(event)) !== originalCounts.get(key(event)))
      return { ok: false, message: '新預覽未完整保留指定行程的內容與數量，請調整條件後重新預覽。' };
  }

  const remaining = new Map(originalCounts);
  const lockedTitles = new Set(locked.map(event => event.title));
  const lockedSchedules = new Set(locked.map(event => key(event, FIELDS.slice(1))));
  for (const event of candidate) {
    const content = key(event), count = remaining.get(content) || 0;
    if (count > 0) {
      remaining.set(content, count - 1);
      continue;
    }
    if (lockedTitles.has(event.title) || lockedSchedules.has(key(event, FIELDS.slice(1))))
      return { ok: false, message: '新預覽與保留項目的對應不明，請調整條件後重新預覽。' };
  }
  return { ok: true };
}
