import { expect, it } from 'vitest';
import { campusEventPhase, campusEventPhaseLabel, compareCampusEventTime } from '@campus/shared/src/campusEventTime';

const now = Date.parse('2026-10-25T14:00:00Z');

it.each([
  ['2026-10-25T15:00:00Z', '2026-10-25T16:00:00Z', 'upcoming'],
  ['2026-10-25T14:00:00Z', '2026-10-25T15:00:00Z', 'ongoing'],
  ['2026-10-25T13:00:00Z', '2026-10-26T01:00:00+08:00', 'ongoing'],
  ['2026-10-25T13:00:00Z', '2026-10-25T14:00:00Z', 'ended'],
  ['2026-10-25T13:00:00Z', undefined, 'started'],
  ['2026-10-25T13:00:00Z', 'invalid', 'started'],
  ['2026-10-25T13:00:00Z', '2026-10-25T12:00:00Z', 'started'],
  ['2026-10-25T13:00:00Z', '2026-10-25T13:00:00Z', 'started'],
  ['', '2026-10-25T16:00:00Z', 'unscheduled'],
  ['invalid', undefined, 'unscheduled'],
])('classifies start %s and end %s as %s', (startsAt, endsAt, expected) => {
  expect(campusEventPhase({ startsAt, endsAt }, now)).toBe(expected);
});

it('keeps unknown endings distinct from confirmed endings and handles an invalid clock', () => {
  expect(campusEventPhaseLabel('started')).toBe('已開始');
  expect(campusEventPhaseLabel('ended')).toBe('已結束');
  expect(campusEventPhase({ startsAt: '2026-10-25T13:00:00Z' }, NaN)).toBe('unscheduled');
});

it('prioritizes current and nearest future events without dropping unknown dates', () => {
  const rows = [
    { id: 'unknown', startsAt: '' },
    { id: 'later', startsAt: '2026-10-27T15:00:00Z' },
    { id: 'old', startsAt: '2026-10-23T10:00:00Z', endsAt: '2026-10-23T11:00:00Z' },
    { id: 'near', startsAt: '2026-10-25T15:00:00Z' },
    { id: 'recent', startsAt: '2026-10-24T10:00:00Z', endsAt: '2026-10-24T11:00:00Z' },
    { id: 'ongoing', startsAt: '2026-10-25T13:00:00Z', endsAt: '2026-10-25T16:00:00Z' },
  ];
  expect(rows.sort((a, b) => compareCampusEventTime(a, b, now)).map((row) => row.id))
    .toEqual(['ongoing', 'near', 'later', 'recent', 'old', 'unknown']);
});
