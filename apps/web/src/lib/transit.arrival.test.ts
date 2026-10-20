import { expect, it } from 'vitest';
import {
  arrivalKind, arrivalLabel, campusStopRank, directionLabel, nextLiveArrival, pickCampusNext,
  type TransitArrival,
} from './transit';

const now = Date.parse('2026-10-19T14:40:00.000Z');
const row = (overrides: Partial<TransitArrival> = {}): TransitArrival => ({
  id: 'r1', route: '162', direction: 1, destination: '', status: 0, seconds: 180,
  updatedAt: new Date(now).toISOString(), ...overrides,
});

it('classifies live, not-started, ended and stale arrivals honestly', () => {
  expect(arrivalKind(row(), now)).toBe('live');
  expect(arrivalKind(row({ status: 1, seconds: null }), now)).toBe('not-started');
  expect(arrivalKind(row({ status: 3, seconds: null }), now)).toBe('ended');
  expect(arrivalKind(row({ updatedAt: new Date(now - 120_000).toISOString() }), now)).toBe('stale');
  expect(arrivalKind(row({ seconds: 10, updatedAt: new Date(now - 80_000).toISOString() }), now)).toBe('stale');
  expect(arrivalKind(row({ status: null, seconds: null }), now)).toBe('other');
});

it('picks the soonest live arrival and never treats an ended bus as next', () => {
  const ended = row({ id: 'ended', route: '326', status: 3, seconds: null });
  const later = row({ id: 'later', route: '301', seconds: 2820 });
  const sooner = row({ id: 'sooner', route: '162', seconds: 180 });
  expect(nextLiveArrival([ended, later, sooner], now)?.route).toBe('162');
  expect(nextLiveArrival([ended], now)).toBeNull();
});

it('says the destination is not provided instead of leaving only 去程／返程 jargon', () => {
  expect(directionLabel(row({ destination: '臺中車站' }))).toBe('往 台中車站');
  expect(directionLabel(row({ destination: '靜宜大學主顧聖母堂' }))).toBe('往 校內');
  expect(directionLabel(row({ destination: '', direction: 0 }))).toBe('去程（終點未提供）');
  expect(directionLabel(row({ destination: '', direction: 1 }))).toBe('返程（終點未提供）');
  expect(directionLabel(row({ destination: '', direction: null }))).toBe('方向未提供');
});

it('uses the timetable clock from the source when there is no live countdown', () => {
  const scheduled = row({
    status: 3, seconds: null, scheduledAt: new Date(now + 20 * 60_000).toISOString(), stopName: '靜宜大學(校門)',
  });
  expect(arrivalLabel(scheduled, now)).toBe('表定 23:00（非即時）');
  expect(arrivalLabel(row({ status: 3, seconds: null }), now)).toBe('末班車已駛離');
});

it('picks the campus-gate arrival per route and does not invent a missing route', () => {
  expect(campusStopRank('靜宜大學(校門)')).toBeLessThan(campusStopRank('靜宜大學'));
  const gate = row({
    id: 'gate', route: '162', seconds: 240, stopName: '靜宜大學(校門)',
  });
  const side = row({
    id: 'side', route: '162', seconds: 60, stopName: '靜宜大學(英才路)',
  });
  const later = row({
    id: 'later', route: '301', seconds: 900, stopName: '靜宜大學(校門)',
  });
  const ended = row({
    id: 'ended', route: '326', status: 3, seconds: null, stopName: '靜宜大學',
  });
  const rows = pickCampusNext([side, gate, later, ended], now, ['162', '301', '368', '326']);
  expect(rows.map((item) => [item.route, item.arrival?.id ?? null])).toEqual([
    ['162', 'gate'],
    ['301', 'later'],
    ['326', null],
    ['368', null],
  ]);
  const stale = row({
    id: 'stale-162', route: '162', seconds: 120, updatedAt: new Date(now - 120_000).toISOString(),
    stopName: '靜宜大學(校門)',
  });
  expect(pickCampusNext([stale], now, ['162'])[0]?.arrival?.id).toBe('stale-162');
});
