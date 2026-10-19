import { expect, it } from 'vitest';
import { arrivalKind, directionLabel, nextLiveArrival, type TransitArrival } from './transit';

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
  expect(directionLabel(row({ destination: '臺中車站' }))).toBe('往 臺中車站');
  expect(directionLabel(row({ destination: '', direction: 0 }))).toBe('去程（終點未提供）');
  expect(directionLabel(row({ destination: '', direction: 1 }))).toBe('返程（終點未提供）');
  expect(directionLabel(row({ destination: '', direction: null }))).toBe('方向未提供');
});
