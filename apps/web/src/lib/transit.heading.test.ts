import { expect, it } from 'vitest';
import {
  campusDirectionEnded, campusEtaView, campusGroupForRow, campusGroupLabel, campusHomeSummary,
  campusLiveUnavailable, campusPlaceLabel, campusSegmentRows, campusStopGroupLabels, campusUpdatedLabel,
  fetchedAgoLabel, groupCampusStops, headingAfterBoarding, headingBucket, listedCampusStops, pickCampusNext,
  publicHeadingFromStops, publicPlaceName, waitingPlaceLine, waitingStopLabel,
  type RouteStopSequence, type TransitArrival, type TransitStop,
} from './transit';

const now = Date.parse('2026-10-19T14:40:00.000Z');
const stop = (overrides: Partial<TransitStop>): TransitStop => ({
  id: 'TXG1', name: '靜宜大學(校門)', city: 'Taichung', lat: 24.2253, lon: 120.5778, distance: null, ...overrides,
});
const arrival = (overrides: Partial<TransitArrival> = {}): TransitArrival => ({
  id: 'a', route: '162', direction: 0, destination: '', status: 0, seconds: 180,
  updatedAt: new Date(now).toISOString(), ...overrides,
});

it('rewrites campus buildings to 校內 and maps familiar landmarks after leaving campus', () => {
  expect(publicPlaceName('靜宜大學主顧聖母堂')).toBe('校內');
  expect(publicPlaceName('沙鹿車站')).toBe('沙鹿火車站');
  expect(publicPlaceName('巨業沙鹿站')).toBe('巨業沙鹿站');
  expect(publicPlaceName('臺中車站(A月台)')).toBe('台中車站');
  expect(publicHeadingFromStops(['靜宜大學主顧樓', '靜宜大學主顧聖母堂'])).toBe('校內');
  expect(publicHeadingFromStops(['英才路', '沙鹿車站', '嘉陽高中'])).toBe('沙鹿火車站');
  expect(publicHeadingFromStops(['靜宜大學(專用道)', '朝馬', '臺中車站', '新光里'])).toBe('台中車站');
});

it('uses remaining stops after the boarding stop, not the inbound campus terminus', () => {
  const outbound: RouteStopSequence = {
    routeUid: 'TXG162', subRouteUid: 'TXG162', routeName: '162', direction: 0,
    stops: [
      { id: 'GATE', name: '靜宜大學(校門)' },
      { id: 'YING', name: '靜宜大學(英才路)' },
      { id: 'SHA', name: '沙鹿車站' },
      { id: 'END', name: '嘉陽高中' },
    ],
  };
  const inbound: RouteStopSequence = {
    routeUid: 'TXG368', subRouteUid: 'TXG368', routeName: '368', direction: 0,
    stops: [
      { id: 'YING', name: '靜宜大學(英才路)' },
      { id: 'GATE', name: '靜宜大學(校門)' },
      { id: 'CHAPEL', name: '靜宜大學主顧聖母堂' },
    ],
  };
  expect(headingAfterBoarding(outbound, 'YING', '靜宜大學(英才路)')).toBe('沙鹿火車站');
  expect(headingAfterBoarding(inbound, 'GATE', '靜宜大學(校門)')).toBe('校內');
});

it('groups Providence stops into at most four student-facing labels without stop codes', () => {
  const stops: TransitStop[] = [
    stop({ id: 'gate-in', name: '靜宜大學(校門)', routes: [{ name: '368', direction: '去', destination: '靜宜大學主顧聖母堂' }] }),
    stop({ id: 'ying-out', name: '靜宜大學(英才路)', lat: 24.227, lon: 120.575,
      routes: [{ name: '162', direction: '去', destination: '嘉陽高中' }, { name: '368', direction: '返', destination: '巨業沙鹿站' }] }),
    stop({ id: 'main-out', name: '靜宜大學', lat: 24.225, lon: 120.577,
      routes: [{ name: '326', direction: '去', destination: '新民高中(健行路)' }] }),
    stop({ id: 'brt', name: '靜宜大學(專用道)', routes: [{ name: '300', direction: '去', destination: '臺中車站(A月台)' }] }),
    stop({ id: 'chapel', name: '靜宜大學主顧聖母堂', routes: [{ name: '162', direction: '去', destination: '嘉陽高中' }] }),
  ];
  expect(campusPlaceLabel('靜宜大學(校門)')).toBe('校門口');
  expect(headingBucket('沙鹿火車站')).toBe('往沙鹿');
  expect(campusGroupLabel('英才路側', '往沙鹿')).toBe('校門口・往沙鹿');
  expect(campusStopGroupLabels(stops[0])).toEqual(['校門口・往校內']);
  const listed = listedCampusStops(stops);
  expect(listed.listed.map((row) => row.name)).toEqual(['校門口・往沙鹿', '校門口・往市區', '專用道', '校門口・往校內']);
  expect(listed.listed.map((row) => row.name).join()).not.toMatch(/TXG/);
  expect(groupCampusStops(stops).some((group) => group.label === '校內')).toBe(true);
  expect(listed.extra.some((group) => group.label === '校內')).toBe(true);
});

it('sorts campus-next live, scheduled, empty, then ended', () => {
  const rows = pickCampusNext([
    arrival({ id: 'slow', route: '301', seconds: 900, destination: '台中車站', stopName: '靜宜大學(專用道)' }),
    arrival({ id: 'fast', route: '162', seconds: 180, destination: '沙鹿火車站', stopName: '靜宜大學(英才路)' }),
    arrival({
      id: 'timed', route: '326', status: 0, seconds: null, destination: '新民高中', stopName: '靜宜大學',
      scheduledAt: new Date(now + 12 * 60_000).toISOString(),
    }),
    arrival({ id: 'done', route: '368', status: 3, seconds: null, destination: '校內', stopName: '靜宜大學(校門)' }),
  ], now, ['162', '301', '368', '326']);
  expect(rows.map((row) => row.route)).toEqual(['162', '301', '326', '368']);
  expect(campusEtaView(rows[0].arrival, now)).toEqual({ kind: 'live', text: '3 分', minutes: 3 });
  expect(campusEtaView(rows[2].arrival, now).kind).toBe('scheduled');
  expect(campusEtaView(rows[2].arrival, now).text).toMatch(/^表定 \d{2}:\d{2}$/);
  expect(campusEtaView(rows[3].arrival, now)).toEqual({ kind: 'ended', text: '今天收班' });
  expect(campusEtaView(arrival({ seconds: 40 }), now)).toEqual({ kind: 'soon', text: '進站中' });
  expect(campusEtaView(arrival({ seconds: 90 }), now)).toEqual({ kind: 'soon', text: '進站中' });
  expect(campusEtaView(null, now)).toEqual({ kind: 'empty', text: '暫無班次資訊' });
  expect(campusGroupForRow(rows[0])).toBe('校門口・往沙鹿');
  expect(waitingStopLabel('靜宜大學(英才路)')).toBe('在英才路側等');
  expect(waitingPlaceLine('靜宜大學(英才路)')).toBe('校門口站牌・英才路側');
  expect(waitingPlaceLine('靜宜大學(校門)')).toBe('校門口站牌・臺灣大道側');
  expect(fetchedAgoLabel(new Date(now).toISOString(), now)).toBe('剛剛更新');
  expect(fetchedAgoLabel(new Date(now - 30_000).toISOString(), now)).toBe('30 秒前');
  expect(campusUpdatedLabel(new Date(now).toISOString(), now)).toMatch(/^\d{2}:\d{2} 更新$/);
  expect(campusUpdatedLabel(new Date(now - 150_000).toISOString(), now)).toMatch(/^最後更新 \d{2}:\d{2}$/);
  expect(campusUpdatedLabel(new Date(now).toISOString(), now, true)).toBe('讀不到即時資料，先顯示表定時間');
  expect(campusHomeSummary(rows, now)).toBe('162 往沙鹿 3 分');
});

it('keeps a direction’s rows when switching segments and marks a fully ended direction', () => {
  const arrivals = [
    arrival({ id: 'live', route: '162', seconds: 180, destination: '沙鹿火車站', stopName: '靜宜大學(英才路)' }),
    arrival({
      id: 'timed', route: '301', status: 0, seconds: null, destination: '沙鹿火車站', stopName: '靜宜大學(英才路)',
      scheduledAt: new Date(now + 12 * 60_000).toISOString(),
    }),
    arrival({ id: 'none', route: '326', status: 0, seconds: null, destination: '嘉陽高中', stopName: '靜宜大學(英才路)' }),
    arrival({ id: 'done', route: '368', status: 3, seconds: null, destination: '巨業沙鹿站', stopName: '靜宜大學(英才路)' }),
    arrival({ id: 'in', route: '368', status: 3, seconds: null, destination: '校內', stopName: '靜宜大學(校門)' }),
  ];
  const outbound = campusSegmentRows(arrivals, '校門口・往沙鹿', now);
  expect(outbound.map((row) => [row.route, campusEtaView(row.arrival, now).kind])).toEqual([
    ['162', 'live'],
    ['301', 'scheduled'],
    ['326', 'empty'],
    ['368', 'ended'],
  ]);
  expect(campusLiveUnavailable(outbound, now)).toBe(false);
  const inbound = campusSegmentRows(arrivals, '校門口・往校內', now);
  expect(inbound.map((row) => campusEtaView(row.arrival, now).kind)).toEqual(['ended']);
  expect(campusDirectionEnded(inbound, now)).toBe(true);
  expect(campusHomeSummary(inbound, now)).toBe('今天收班');
  const scheduledOnly = campusSegmentRows([arrivals[1]], '校門口・往沙鹿', now);
  expect(campusLiveUnavailable(scheduledOnly, now)).toBe(true);
});
