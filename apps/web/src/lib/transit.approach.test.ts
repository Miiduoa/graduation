import { expect, it } from 'vitest';
import {
  campusApproachModel, campusApproachStatus, campusLineStopName, compactCampusRouteStops,
  pickCampusApproachRow, sequenceForCampusRow,
  type CampusNextRow, type RouteStopSequence, type TransitArrival,
} from './transit';

const now = Date.parse('2026-10-19T14:40:00.000Z');
const arrival = (overrides: Partial<TransitArrival> = {}): TransitArrival => ({
  id: 'a', route: '162', direction: 1, destination: '沙鹿火車站', status: 0, seconds: 180,
  updatedAt: new Date(now).toISOString(), stopName: '靜宜大學(英才路)', ...overrides,
});
const row = (overrides: Partial<CampusNextRow> = {}, next: Partial<TransitArrival> = {}): CampusNextRow => ({
  route: '162', heading: '沙鹿火車站', arrival: arrival(next), ...overrides,
});
const outbound: RouteStopSequence = {
  routeUid: 'TXG162', subRouteUid: 'TXG162', routeName: '162', direction: 1,
  stops: [
    { id: 'FAR', name: '巨業沙鹿站' },
    { id: 'SHA', name: '沙鹿車站' },
    { id: 'YING', name: '靜宜大學(英才路)' },
    { id: 'GATE', name: '靜宜大學(校門)' },
    { id: 'END', name: '嘉陽高中' },
  ],
};

it('shortens campus stop names for the approach line', () => {
  expect(campusLineStopName('靜宜大學(校門)')).toBe('校門');
  expect(campusLineStopName('靜宜大學(英才路)')).toBe('英才路');
  expect(campusLineStopName('靜宜大學(專用道)')).toBe('專用道');
  expect(campusLineStopName('靜宜大學主顧聖母堂')).toBe('主顧堂');
  expect(campusLineStopName('沙鹿車站')).toBe('沙鹿車站');
});

it('compacts already-loaded sequences around campus stops without inventing names', () => {
  const compact = compactCampusRouteStops([outbound, outbound, {
    routeUid: 'TXG300', subRouteUid: 'TXG300', routeName: '300', direction: 0,
    stops: [{ id: 'A', name: '市政府' }, { id: 'B', name: '秋紅谷' }],
  }]);
  expect(compact).toHaveLength(1);
  expect(compact[0]?.stops.map((stop) => stop.name)).toEqual([
    '巨業沙鹿站', '沙鹿車站', '靜宜大學(英才路)', '靜宜大學(校門)', '嘉陽高中',
  ]);
});

it('matches a campus row to the sequence that contains the boarding stop', () => {
  expect(sequenceForCampusRow(row(), [outbound])?.routeUid).toBe('TXG162');
  expect(sequenceForCampusRow(row({ route: '300' }, { route: '300' }), [outbound])).toBeNull();
});

it('marks arriving, soon and far from live remaining time', () => {
  expect(campusApproachStatus(arrival({ seconds: 40 }), now)).toBe('arriving');
  expect(campusApproachStatus(arrival({ seconds: 150 }), now)).toBe('soon');
  expect(campusApproachStatus(arrival({ seconds: 180 }), now)).toBe('soon');
  expect(campusApproachStatus(arrival({ seconds: 181 }), now)).toBe('far');
  expect(campusApproachStatus(arrival({ seconds: 480 }), now)).toBe('far');
  expect(campusApproachStatus(arrival({
    seconds: null, scheduledAt: new Date(now + 12 * 60_000).toISOString(),
  }), now)).toBe('scheduled');
  expect(campusApproachStatus(arrival({ status: 3, seconds: null }), now)).toBe('hidden');
});

it('places a live bus between previous stops and the waiting stop', () => {
  const soon = campusApproachModel(row({}, { seconds: 180 }), now, [outbound]);
  expect(soon?.status).toBe('soon');
  expect(soon?.stops.map((stop) => [stop.name, stop.here])).toEqual([
    ['巨業沙鹿站', false],
    ['沙鹿車站', false],
    ['英才路', true],
    ['校門', false],
  ]);
  expect(soon?.stopsAway).toBe(2);
  expect(soon?.minutes).toBe(3);
  expect(soon?.busIndex).toBeGreaterThan(soon!.hereIndex - 1);
  expect(soon?.busIndex).toBeLessThan(soon!.hereIndex);
  expect(soon?.a11y).toBe('162 號公車，往 沙鹿火車站，還有 2 站，約 3 分');
  expect(soon?.caption).toContain('快到');
  expect(soon?.caption).toContain('約 3 分');

  const arriving = campusApproachModel(row({}, { seconds: 50 }), now, [outbound]);
  expect(arriving?.status).toBe('arriving');
  expect(arriving?.stopsAway).toBe(0);
  expect(arriving?.busIndex).toBe(arriving?.hereIndex);
  expect(arriving?.a11y).toBe('162 號公車，往 沙鹿火車站，進站中');

  const far = campusApproachModel(row({}, { seconds: 720 }), now, [outbound]);
  expect(far?.status).toBe('far');
  expect(far?.stopsAway).toBe(8);
  expect(far?.busIndex).toBe(0);
  expect(far?.a11y).toBe('162 號公車，往 沙鹿火車站，還有 8 站，約 12 分');
  expect(far?.caption).toContain('還很久');
});

it('says scheduled with no live bus when only timetable data exists', () => {
  const model = campusApproachModel(row({}, {
    seconds: null, scheduledAt: new Date(now + 12 * 60_000).toISOString(),
  }), now, [outbound]);
  expect(model?.status).toBe('scheduled');
  expect(model?.busIndex).toBeNull();
  expect(model?.a11y).toMatch(/^162 號公車，往 沙鹿火車站，表定 \d{2}:\d{2}，沒有即時位置$/);
  expect(model?.caption).toContain('表定');
  expect(model?.caption).toContain('沒有即時位置');
});

it('falls back to a generic line when this route has no cached stop sequence', () => {
  const model = campusApproachModel(row({ route: '300' }, { route: '300', seconds: 240, stopName: '靜宜大學(專用道)' }), now, [outbound]);
  expect(model?.status).toBe('far');
  expect(model?.stops.map((stop) => stop.name)).toEqual(['更遠', '前一站', '專用道', '下一站']);
  expect(model?.stops.some((stop) => stop.here)).toBe(true);
  expect(model?.busIndex).not.toBeNull();
});

it('prefers the focused live row, otherwise the soonest bus that can be drawn', () => {
  const live = row({}, { seconds: 480 });
  const later = row({ route: '301', heading: '嘉陽高中' }, { id: 'b', route: '301', seconds: 900, destination: '嘉陽高中' });
  const scheduled = row({ route: '326', heading: '新民高中' }, {
    id: 'c', route: '326', destination: '新民高中', seconds: null,
    scheduledAt: new Date(now + 12 * 60_000).toISOString(),
  });
  expect(pickCampusApproachRow([scheduled, later, live], null, now)?.route).toBe('162');
  expect(pickCampusApproachRow([scheduled, later, live], '301:嘉陽高中', now)?.route).toBe('301');
  expect(pickCampusApproachRow([
    row({ route: '368' }, { id: 'd', route: '368', status: 3, seconds: null }),
  ], null, now)).toBeNull();
});
