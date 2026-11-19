import { campusEventDetailPath } from '@campus/shared/src/campusEventLinks';
import type { CampusEventSource } from '../../campusEvents';
import { canonical, eventArgs, fail, hash, type EventArgs, type Obj, V2Error } from './contracts';

export type PublicEventTarget = { schoolId: string; source: CampusEventSource; id: string };
export type PublicEventSourceItem = PublicEventTarget & {
  title: string;
  startsAt: string;
  endsAt: string;
  href: string;
  location?: string;
};
export type PublicEventGuard = { target: PublicEventTarget; fingerprint: string };
export type PublicEventUnavailable = 'HIDDEN_SCHOOL' | 'NOT_FOUND' | 'SOURCE_UNAVAILABLE' |
  'INVALID_EVENT' | 'EVENT_NOT_FUTURE' | 'MISSING_END_TIME';
type PublicEventReadBase = {
  version: 1;
  target: PublicEventTarget;
  sourcePath: string;
  checkedAt: string;
};
export type PublicEventRead = PublicEventReadBase & (
  { status: 'ready'; item: PublicEventSourceItem; fingerprint: string; args: EventArgs } |
  { status: 'unavailable'; unavailable: PublicEventUnavailable }
);

const SOURCES = ['school-club-events', 'school-events', 'legacy-events'] as const;
const UNAVAILABLE = ['HIDDEN_SCHOOL', 'NOT_FOUND', 'SOURCE_UNAVAILABLE', 'INVALID_EVENT',
  'EVENT_NOT_FUTURE', 'MISSING_END_TIME'] as const;
const TARGET_KEYS = ['schoolId', 'source', 'id'];
const TEXT_CONTROLS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Only plain JSON data is accepted; getters and inherited identity cannot select a source. */
function record(raw: unknown, keys: string[]): Obj {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== null && prototype !== Object.prototype) return fail();
  const result: Obj = {};
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== 'string' || !keys.includes(key)) return fail();
    const property = Object.getOwnPropertyDescriptor(raw, key);
    if (!property?.enumerable || !('value' in property) || property.value === undefined) return fail();
    result[key] = property.value;
  }
  return result;
}

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > max ||
      TEXT_CONTROLS.test(value)) return fail();
  return value;
}

function instant(value: unknown): string {
  const raw = clean(value, 24);
  const time = Date.parse(raw);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw) ||
      !Number.isFinite(time) || new Date(time).toISOString() !== raw) return fail();
  return raw;
}

/** Server actions accept identity alone. UI display hints are never source facts. */
export function parsePublicEventTarget(raw: unknown): PublicEventTarget {
  const value = record(raw, TARGET_KEYS);
  const schoolId = clean(value.schoolId, 80), id = clean(value.id, 200);
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(schoolId) || schoolId === 'personal' ||
      id.includes('/') || ['.', '..', '__proto__', 'prototype', 'constructor'].includes(id) ||
      !SOURCES.includes(value.source as CampusEventSource)) return fail();
  return { schoolId, source: value.source as CampusEventSource, id };
}

export const publicEventTarget = parsePublicEventTarget;

export function publicEventSourcePath(raw: PublicEventTarget): string {
  const target = parsePublicEventTarget(raw);
  return target.source === 'legacy-events' ? 'events'
    : `schools/${target.schoolId}/${target.source === 'school-club-events' ? 'clubEvents' : 'events'}`;
}

export function publicEventHref(raw: PublicEventTarget): string {
  return campusEventDetailPath(parsePublicEventTarget(raw));
}

/** Parse the bounded, canonical source projection and keep it on the selected document. */
export function parsePublicEventSource(raw: unknown, expected?: PublicEventTarget): PublicEventSourceItem {
  const value = record(raw, [...TARGET_KEYS, 'title', 'startsAt', 'endsAt', 'href', 'location']);
  const target = parsePublicEventTarget({ schoolId: value.schoolId, source: value.source, id: value.id });
  if (expected && canonical(target) !== canonical(parsePublicEventTarget(expected))) return fail('FORBIDDEN_SCOPE', 403);
  const href = publicEventHref(target);
  if (value.href !== href) return fail();
  return { ...target, title: clean(value.title, 120), startsAt: instant(value.startsAt),
    endsAt: instant(value.endsAt), href,
    ...(value.location === undefined ? {} : { location: clean(value.location, 120) }) };
}

/** Source changes in another collection, title, time or location invalidate a confirmation. */
export function publicEventFingerprint(raw: PublicEventSourceItem): string {
  const item = parsePublicEventSource(raw);
  return hash({ schoolId: item.schoolId, source: item.source, id: item.id, title: item.title,
    startsAt: item.startsAt, endsAt: item.endsAt, location: item.location ?? null });
}

export function parsePublicEventGuard(raw: unknown): PublicEventGuard {
  const value = record(raw, ['target', 'fingerprint']);
  if (typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)) return fail();
  return { target: parsePublicEventTarget(value.target), fingerprint: value.fingerprint };
}

/** Preserve the source's exact interval in Taipei, including an explicit next-day end. */
export function publicEventArgs(raw: PublicEventSourceItem, now = Date.now()): EventArgs {
  const item = parsePublicEventSource(raw);
  const start = Date.parse(item.startsAt), end = Date.parse(item.endsAt);
  if (!Number.isFinite(now)) return fail();
  if (start <= now) return fail('PUBLIC_EVENT_NOT_FUTURE', 409);
  if (end <= start || start % 60_000 !== 0 || end % 60_000 !== 0) return fail('INVALID_PUBLIC_EVENT_TIME', 409);
  const localStart = new Date(start + 28_800_000).toISOString();
  const localEnd = new Date(end + 28_800_000).toISOString();
  try {
    return eventArgs({ title: item.title, date: localStart.slice(0, 10), allDay: false,
      ...(localEnd.slice(0, 10) === localStart.slice(0, 10) ? {} : { endDate: localEnd.slice(0, 10) }),
      startTime: localStart.slice(11, 16), endTime: localEnd.slice(11, 16) });
  } catch { return fail('INVALID_PUBLIC_EVENT_TIME', 409); }
}

/** Revalidate every ready result before preparing or confirming an action. */
export function parsePublicEventResult(raw: unknown, expected: PublicEventTarget, now = Date.now()): PublicEventRead {
  try {
    const value = record(raw, ['version', 'target', 'sourcePath', 'checkedAt', 'status', 'item', 'fingerprint', 'args', 'unavailable']);
    const target = parsePublicEventTarget(value.target);
    if (!Number.isFinite(now) || value.version !== 1 ||
        canonical(target) !== canonical(parsePublicEventTarget(expected)) ||
        value.sourcePath !== publicEventSourcePath(target)) return fail();
    const checkedAt = instant(value.checkedAt);
    const base: PublicEventReadBase = { version: 1, target, sourcePath: value.sourcePath as string, checkedAt };
    if (value.status === 'unavailable') {
      if (!UNAVAILABLE.includes(value.unavailable as PublicEventUnavailable) ||
          value.item !== undefined || value.args !== undefined || value.fingerprint !== undefined) return fail();
      return { ...base, status: 'unavailable', unavailable: value.unavailable as PublicEventUnavailable };
    }
    if (value.status !== 'ready' || value.unavailable !== undefined) return fail();
    const item = parsePublicEventSource(value.item, target);
    const fingerprint = publicEventFingerprint(item), args = publicEventArgs(item, now);
    const suppliedArgs = record(value.args, ['title', 'date', 'endDate', 'allDay', 'startTime', 'endTime']);
    if (value.fingerprint !== fingerprint || canonical(suppliedArgs) !== canonical(args)) return fail();
    return { ...base, status: 'ready', item, fingerprint, args };
  } catch { throw new V2Error(502, 'INVALID_PUBLIC_EVENT_RESULT'); }
}
