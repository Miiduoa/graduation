// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  parsePublicEventGuard, parsePublicEventResult, parsePublicEventSource, parsePublicEventTarget,
  publicEventArgs, publicEventFingerprint, publicEventHref, publicEventSourcePath,
  type PublicEventRead, type PublicEventSourceItem, type PublicEventTarget,
} from './publicEvent';

const now = Date.parse('2026-11-16T03:00:00.000Z');
const target: PublicEventTarget = { schoolId: 'nthu', source: 'school-club-events', id: '活動-123' };
const item: PublicEventSourceItem = { ...target, title: '跨夜校園講座', startsAt: '2026-11-17T15:30:00.000Z',
  endsAt: '2026-11-17T16:30:00.000Z', href: publicEventHref(target), location: '圖書館' };
const ready = (): PublicEventRead => ({ version: 1, target, sourcePath: publicEventSourcePath(target),
  checkedAt: new Date(now).toISOString(), status: 'ready', item,
  fingerprint: publicEventFingerprint(item), args: publicEventArgs(item, now) });

describe('public event identity and source contract', () => {
  it('uses exact school, collection and encoded document IDs for links and paths', () => {
    expect(parsePublicEventTarget(target)).toEqual(target);
    expect(publicEventSourcePath(target)).toBe('schools/nthu/clubEvents');
    expect(publicEventSourcePath({ ...target, source: 'school-events' })).toBe('schools/nthu/events');
    expect(publicEventSourcePath({ ...target, source: 'legacy-events' })).toBe('events');
    expect(publicEventHref(target)).toBe('/events/%E6%B4%BB%E5%8B%95-123?schoolId=nthu&source=school-club-events');
    const long = { ...target, id: 'a'.repeat(200) };
    expect(parsePublicEventTarget(long)).toEqual(long);
  });

  it.each([
    { ...target, schoolId: 'personal' }, { ...target, schoolId: '../other' },
    { ...target, source: 'school-announcements' }, { ...target, id: '../event' },
    { ...target, id: '__proto__' }, { ...target, id: '.' }, { ...target, id: 'a'.repeat(201) },
    { ...target, id: ' event ' }, { ...target, id: 'hidden\u200bevent' },
    { ...target, title: 'UI hint' }, { ...target, sessionHandle: 'credential' },
  ])('rejects out-of-contract identity before reading (%j)', (value) => {
    expect(() => parsePublicEventTarget(value)).toThrow('INVALID_INPUT');
  });

  it('does not invoke accessor identity and rejects inherited fields', () => {
    const getter = vi.fn(() => 'nthu');
    const value = { ...target };
    Object.defineProperty(value, 'schoolId', { enumerable: true, get: getter });
    expect(() => parsePublicEventTarget(value)).toThrow('INVALID_INPUT');
    expect(getter).not.toHaveBeenCalled();
    expect(() => parsePublicEventTarget(Object.create(target))).toThrow('INVALID_INPUT');
  });

  it('requires the selected source identity and exact source link', () => {
    expect(parsePublicEventSource(item, target)).toEqual(item);
    expect(() => parsePublicEventSource(item, { ...target, schoolId: 'pu' })).toThrow('FORBIDDEN_SCOPE');
    expect(() => parsePublicEventSource({ ...item, href: '/events/other' }, target)).toThrow();
    expect(() => parsePublicEventSource({ ...item, token: 'private' }, target)).toThrow();
    expect(() => parsePublicEventSource({ ...item, title: 'a'.repeat(121) }, target)).toThrow();
  });

  it('binds the full selected identity, title, exact interval and location into the fingerprint', () => {
    const fingerprint = publicEventFingerprint(item);
    for (const change of [
      { schoolId: 'pu' }, { source: 'school-events' as const }, { id: 'other' },
      { title: '改期講座' }, { startsAt: '2026-11-17T15:00:00.000Z' },
      { endsAt: '2026-11-17T17:00:00.000Z' }, { location: '新地點' },
    ]) {
      const changed = { ...item, ...change };
      changed.href = publicEventHref({ schoolId: changed.schoolId, source: changed.source, id: changed.id });
      expect(publicEventFingerprint(changed)).not.toBe(fingerprint);
    }
    expect(parsePublicEventGuard({ target, fingerprint })).toEqual({ target, fingerprint });
    expect(() => parsePublicEventGuard({ target, fingerprint: '0'.repeat(63) })).toThrow();
    expect(() => parsePublicEventGuard({ target, fingerprint, args: {} })).toThrow();
  });
});

describe('exact Taipei event interval', () => {
  it('keeps a Taipei midnight crossing as an explicit endDate', () => {
    expect(publicEventArgs(item, now)).toEqual({ title: item.title, date: '2026-11-17', endDate: '2026-11-18',
      allDay: false, startTime: '23:30', endTime: '00:30' });
    expect(publicEventArgs({ ...item, startsAt: '2026-11-17T01:00:00.000Z', endsAt: '2026-11-17T02:00:00.000Z' }, now))
      .toEqual({ title: item.title, date: '2026-11-17', allDay: false, startTime: '09:00', endTime: '10:00' });
  });

  it('does not round seconds, guess a missing end, accept an invalid date or add a started event', () => {
    expect(() => publicEventArgs({ ...item, startsAt: '2026-11-17T15:30:01.000Z' }, now)).toThrow('INVALID_PUBLIC_EVENT_TIME');
    expect(() => publicEventArgs({ ...item, endsAt: '2026-11-17T16:30:00.001Z' }, now)).toThrow('INVALID_PUBLIC_EVENT_TIME');
    expect(() => publicEventArgs({ ...item, endsAt: item.startsAt }, now)).toThrow('INVALID_PUBLIC_EVENT_TIME');
    expect(() => publicEventArgs({ ...item, endsAt: undefined } as never, now)).toThrow();
    expect(() => publicEventArgs({ ...item, startsAt: '2026-02-30T15:30:00.000Z' }, now)).toThrow();
    expect(() => publicEventArgs(item, Date.parse(item.startsAt))).toThrow('PUBLIC_EVENT_NOT_FUTURE');
  });

  it('accepts the existing 31-day date span and rejects a longer one', () => {
    const startsAt = '2026-11-17T16:00:00.000Z';
    const endsAt = new Date(Date.parse(startsAt) + 31 * 86400000).toISOString();
    expect(publicEventArgs({ ...item, startsAt, endsAt }, now)).toMatchObject({ date: '2026-11-18', endDate: '2026-12-19' });
    expect(() => publicEventArgs({ ...item, startsAt,
      endsAt: new Date(Date.parse(startsAt) + 32 * 86400000).toISOString() }, now)).toThrow('INVALID_PUBLIC_EVENT_TIME');
  });
});

describe('read result verification', () => {
  it('revalidates source facts and derived args while accepting a read completed after action start', () => {
    const read = ready();
    expect(parsePublicEventResult(read, target, now)).toEqual(read);
    expect(parsePublicEventResult({ ...read, checkedAt: new Date(now + 100).toISOString() }, target, now))
      .toMatchObject({ status: 'ready' });
  });

  it('rejects forged args, hash, target, source path and mixed ready/unavailable states', () => {
    const read = ready();
    for (const changed of [
      { ...read, args: { title: '偽造活動' } }, { ...read, fingerprint: 'f'.repeat(64) },
      { ...read, target: { ...target, schoolId: 'pu' } }, { ...read, sourcePath: 'events' },
      { ...read, unavailable: 'NOT_FOUND' }, { ...read, status: 'unavailable', unavailable: 'NOT_FOUND' },
    ]) expect(() => parsePublicEventResult(changed, target, now)).toThrow('INVALID_PUBLIC_EVENT_RESULT');
    const args = publicEventArgs(item, now), getter = vi.fn(() => item.title);
    Object.defineProperty(args, 'title', { enumerable: true, get: getter });
    expect(() => parsePublicEventResult({ ...read, args }, target, now)).toThrow('INVALID_PUBLIC_EVENT_RESULT');
    expect(getter).not.toHaveBeenCalled();
  });

  it('allows only a scoped, recognized unavailable outcome without action fields', () => {
    const unavailable = { version: 1, target, sourcePath: publicEventSourcePath(target),
      checkedAt: new Date(now).toISOString(), status: 'unavailable', unavailable: 'NOT_FOUND' };
    expect(parsePublicEventResult(unavailable, target, now)).toEqual(unavailable);
    expect(() => parsePublicEventResult({ ...unavailable, unavailable: 'EMPTY_SUCCESS' }, target, now)).toThrow();
    expect(() => parsePublicEventResult({ ...unavailable, args: {} }, target, now)).toThrow();
  });
});
