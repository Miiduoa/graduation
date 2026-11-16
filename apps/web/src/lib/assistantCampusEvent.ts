import { parseAssistantCalendarEvent } from '@campus/shared/src/assistantExecution';

export type AssistantCampusEventSource = 'school-club-events' | 'school-events' | 'legacy-events';
/** Display metadata is a selection hint. The server re-reads this exact source. */
export type AssistantCampusEventTarget = {
  schoolId: string;
  source: AssistantCampusEventSource;
  id: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  href: string;
  checkedAt: string;
  location?: string;
};

const fields = ['schoolId', 'source', 'id', 'title', 'startsAt', 'endsAt', 'href', 'checkedAt', 'location'];
const required = fields.filter(field => field !== 'endsAt' && field !== 'location');
const plain = (value: unknown, max: number): value is string => typeof value === 'string' &&
  value.length > 0 && value.length <= max && value.trim() === value && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
const instant = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function dataObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== null && prototype !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !fields.includes(key)) return null;
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) return null;
    copy[key] = descriptor.value;
  }
  return required.every(key => Object.hasOwn(copy, key)) ? copy : null;
}

export function campusEventIdentity(target: AssistantCampusEventTarget) {
  return { schoolId: target.schoolId, source: target.source, id: target.id };
}

export function campusEventTargetKey(target: AssistantCampusEventTarget): string {
  return JSON.stringify([target.schoolId, target.source, target.id]);
}

/** Accept the entire bounded list or none. Never invoke response getters or use a supplied arbitrary URL. */
export function parseAssistantCampusEventTargets(raw: unknown, schoolId?: string): AssistantCampusEventTarget[] {
  try {
    if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > 12) return [];
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(descriptors).length !== raw.length + 1) return [];
    const result: AssistantCampusEventTarget[] = [], seen = new Set<string>();
    for (let index = 0; index < raw.length; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !('value' in descriptor)) return [];
      const item = dataObject(descriptor.value);
      if (!item || typeof item.schoolId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(item.schoolId) ||
        item.schoolId === 'personal' || (schoolId !== undefined && item.schoolId !== schoolId) ||
        typeof item.source !== 'string' || !['school-club-events', 'school-events', 'legacy-events'].includes(item.source) ||
        !plain(item.id, 200) || item.id.includes('/') || ['.', '..', '__proto__', 'prototype', 'constructor'].includes(item.id) ||
        !plain(item.title, 160) || !instant(item.startsAt) || !instant(item.checkedAt) ||
        (item.endsAt !== undefined && !instant(item.endsAt)) ||
        (item.location !== undefined && !plain(item.location, 120))) return [];
      const source = item.source as AssistantCampusEventSource;
      const href = `/events/${encodeURIComponent(item.id)}?${new URLSearchParams({ schoolId: item.schoolId, source })}`;
      if (item.href !== href) return [];
      const target: AssistantCampusEventTarget = { schoolId: item.schoolId, source, id: item.id,
        title: item.title, startsAt: item.startsAt, checkedAt: item.checkedAt, href,
        ...(item.endsAt !== undefined ? { endsAt: item.endsAt as string } : {}),
        ...(item.location !== undefined ? { location: item.location as string } : {}) };
      const key = campusEventTargetKey(target);
      if (seen.has(key)) return [];
      seen.add(key);
      result.push(target);
    }
    return result;
  } catch { return []; }
}

/** Eligibility only; the server independently validates the current source before issuing a card. */
export function campusEventPreviewIssue(target: AssistantCampusEventTarget, now: number): string | null {
  const start = Date.parse(target.startsAt), end = Date.parse(target.endsAt ?? '');
  if (!target.endsAt) return '來源沒有完整的結束時間，請先查看活動來源；不會猜測活動長度。';
  if (!Number.isFinite(now) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return '活動起訖時間尚無法完整核對，請先查看活動來源。';
  if (start <= now) return '這個活動已開始，請重新查詢近期活動。';
  if (start % 60_000 || end % 60_000 || target.title.length > 120)
    return '這份活動的時間精度或名稱超出目前行程支援範圍，請從來源核對後手動建立。';
  try {
    const localStart = new Date(start + 28_800_000).toISOString(), localEnd = new Date(end + 28_800_000).toISOString();
    const date = localStart.slice(0, 10), endDate = localEnd.slice(0, 10);
    if (Date.parse(endDate) - Date.parse(date) > 31 * 86_400_000) throw new Error('Unsupported span');
    parseAssistantCalendarEvent({ title: target.title, date, allDay: false,
      startTime: localStart.slice(11, 16), endTime: localEnd.slice(11, 16),
      ...(endDate !== date ? { endDate } : {}) });
  } catch {
    return '活動日期超出目前行程支援範圍，請從來源核對後手動建立。';
  }
  return null;
}
