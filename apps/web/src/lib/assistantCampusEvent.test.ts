import { expect, it, vi } from 'vitest';
import { campusEventIdentity, campusEventPreviewIssue, parseAssistantCampusEventTargets,
  type AssistantCampusEventTarget } from './assistantCampusEvent';

const target = (overrides: Partial<AssistantCampusEventTarget> = {}): AssistantCampusEventTarget => ({
  schoolId: 'pu', source: 'school-club-events', id: 'photography', title: '校園攝影講座',
  startsAt: '2030-11-16T06:00:00.000Z', endsAt: '2030-11-16T08:00:00.000Z',
  checkedAt: '2030-11-15T06:00:00.000Z', location: '活動中心',
  href: '/events/photography?schoolId=pu&source=school-club-events', ...overrides,
});
const now = Date.parse('2030-11-15T06:00:00.000Z');

it('copies bounded source metadata and sends only its exact identity', () => {
  const raw = target();
  const [parsed] = parseAssistantCampusEventTargets([raw], 'pu');
  expect(parsed).toEqual(raw);
  expect(parsed).not.toBe(raw);
  expect(campusEventIdentity(parsed)).toEqual({ schoolId: 'pu', source: 'school-club-events', id: 'photography' });
  expect(campusEventPreviewIssue(parsed, now)).toBeNull();
});

it.each(['school-club-events', 'school-events', 'legacy-events'] as const)('keeps the explicit %s source in links and identity', source => {
  const raw = target({ source, href: `/events/photography?schoolId=pu&source=${source}` });
  expect(parseAssistantCampusEventTargets([raw], 'pu')).toEqual([raw]);
});

it.each([
  { schoolId: 'nthu' }, { schoolId: 'personal' }, { source: 'unknown' }, { id: '../event' }, { id: '__proto__' },
  { id: ' photography' }, { title: 'source\ncommand' }, { title: '' }, { location: 'a'.repeat(121) },
  { startsAt: '2030-11-16T14:00:00+08:00' }, { checkedAt: '2030-02-30T06:00:00.000Z' },
  { href: 'https://example.invalid/event' }, { href: '/events/photography?source=school-club-events&schoolId=pu' },
  { href: '/events/photography?schoolId=pu&source=legacy-events' }, { token: 'not-display-metadata' },
])('rejects the entire group when a source field is malformed: %j', changes => {
  expect(parseAssistantCampusEventTargets([target(), { ...target({ id: 'second',
    href: '/events/second?schoolId=pu&source=school-club-events' }), ...changes }], 'pu')).toEqual([]);
});

it('rejects duplicates, sparse/oversized lists and data accessors without invoking them', () => {
  expect(parseAssistantCampusEventTargets([target(), target()])).toEqual([]);
  expect(parseAssistantCampusEventTargets(new Array(1))).toEqual([]);
  expect(parseAssistantCampusEventTargets(Array.from({ length: 13 }, () => target()))).toEqual([]);
  const getter = vi.fn(() => '校園攝影講座');
  const raw = target();
  Object.defineProperty(raw, 'title', { enumerable: true, get: getter });
  expect(parseAssistantCampusEventTargets([raw])).toEqual([]);
  expect(getter).not.toHaveBeenCalled();
  const coercion = vi.fn(() => 'school-events');
  expect(parseAssistantCampusEventTargets([{ ...target(), source: { toString: coercion } }])).toEqual([]);
  expect(coercion).not.toHaveBeenCalled();
});

it('keeps a missing end readable but never invents a duration', () => {
  const raw = target();
  delete raw.endsAt;
  expect(parseAssistantCampusEventTargets([raw])).toEqual([raw]);
  expect(campusEventPreviewIssue(raw, now)).toContain('不會猜測活動長度');
});

it.each([
  { endsAt: '2030-11-16T06:00:00.000Z' }, { endsAt: '2030-11-16T05:00:00.000Z' },
  { startsAt: '2030-11-16T06:00:01.000Z' }, { endsAt: '2030-11-16T08:00:00.001Z' },
  { endsAt: '2031-01-16T08:00:00.000Z' }, { title: 'a'.repeat(121) },
])('cannot prepare an unsupported source time or title: %j', changes => {
  expect(campusEventPreviewIssue(target(changes), now)).toBeTruthy();
});

it('uses strict future starts and supports a real Taipei cross-day interval', () => {
  expect(campusEventPreviewIssue(target(), Date.parse(target().startsAt))).toContain('已開始');
  expect(campusEventPreviewIssue(target(), NaN)).toBeTruthy();
  expect(campusEventPreviewIssue(target({ startsAt: '2030-11-16T15:00:00.000Z', endsAt: '2030-11-16T17:00:00.000Z' }), now)).toBeNull();
});
