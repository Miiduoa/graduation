import { expect, it } from 'vitest';
import {
  arrivalLabel, campusDirectionEnded, campusEtaView, campusGroupForRow, campusGroupLabel, campusHomeSummary,
  campusHeadingText, campusInboundPlace, campusLaneDisplay, campusLiveUnavailable, campusPlaceLabel, campusSegmentRows,
  campusStopGroupLabels, campusUpdatedLabel, fetchedAgoLabel, groupCampusStops, headingAfterBoarding,
  headingBeforeBoarding, headingBucket, listedCampusStops, pickCampusNext, publicHeadingFromStops,
  publicPlaceName, waitingPlaceLine, waitingStopLabel,
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

it('rewrites campus buildings to named inbound termini and maps familiar landmarks after leaving campus', () => {
  expect(publicPlaceName('靜宜大學主顧聖母堂')).toBe('主顧聖母堂');
  expect(campusInboundPlace('靜宜大學靜園餐廳')).toBe('靜園餐廳');
  expect(publicPlaceName('靜宜大學(校門)')).toBe('校內');
  expect(publicPlaceName('沙鹿車站')).toBe('沙鹿火車站');
  expect(publicPlaceName('巨業沙鹿站')).toBe('巨業沙鹿站');
  expect(publicPlaceName('臺中車站(A月台)')).toBe('台中車站');
  expect(publicHeadingFromStops(['靜宜大學主顧樓', '靜宜大學主顧聖母堂'])).toBe('主顧聖母堂');
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
  expect(headingAfterBoarding(inbound, 'GATE', '靜宜大學(校門)')).toBe('主顧聖母堂');
  expect(headingBeforeBoarding(inbound, 'GATE', '靜宜大學(校門)')).toBe('');
  expect(headingBucket('主顧聖母堂')).toBe('往校內');
  expect(headingBucket('從沙鹿火車站')).toBe('往校內');
  expect(campusHeadingText({ route: '368', heading: '主顧聖母堂', arrival: null })).toBe('往 主顧聖母堂');
  expect(campusHeadingText({ route: '301', heading: '從沙鹿火車站', arrival: null })).toBe('進校園');
  expect(campusHeadingText({ route: '326', heading: '從下晉江', arrival: null })).toBe('進校園');
  expect(campusHeadingText({ route: '326', heading: '從臺中榮總', arrival: null })).toBe('進校園');
  expect(campusHeadingText({ route: '326', heading: '校內', arrival: null })).toBe('進校園');
  expect(campusHeadingText({ route: '326', heading: '', arrival: null })).toBe('');
});

it('does not regroup an inbound origin as 往沙鹿', () => {
  const inbound: RouteStopSequence = {
    routeUid: 'TXG301', subRouteUid: 'TXG301', routeName: '301', direction: 1,
    stops: [
      { id: 'SHA', name: '沙鹿車站' },
      { id: 'YING', name: '靜宜大學(英才路)' },
      { id: 'GATE', name: '靜宜大學(校門)' },
      { id: 'HALL', name: '靜宜大學(會館)' },
    ],
  };
  expect(headingAfterBoarding(inbound, 'GATE', '靜宜大學(校門)')).toBe('校內');
  expect(headingBucket(headingAfterBoarding(inbound, 'GATE', '靜宜大學(校門)'))).toBe('往校內');
  expect(campusGroupLabel('校門口', headingBucket('從沙鹿火車站'))).toBe('校門口・往校內');
  expect(campusHeadingText({
    route: '301', heading: headingAfterBoarding(inbound, 'GATE', '靜宜大學(校門)'), arrival: null,
  })).toBe('進校園');
});

it('does not use an unfamiliar village as the inbound origin', () => {
  const inbound: RouteStopSequence = {
    routeUid: 'TXG326', subRouteUid: 'TXG326', routeName: '326', direction: 1,
    stops: [
      { id: 'VILLAGE', name: '下晉江' },
      { id: 'GATE', name: '靜宜大學(校門)' },
      { id: 'HALL', name: '靜宜大學(會館)' },
    ],
  };
  expect(headingBeforeBoarding(inbound, 'GATE', '靜宜大學(校門)')).toBe('');
  expect(headingAfterBoarding(inbound, 'GATE', '靜宜大學(校門)')).toBe('校內');
  expect(campusHeadingText({
    route: '326', heading: headingAfterBoarding(inbound, 'GATE', '靜宜大學(校門)'), arrival: null,
  })).toBe('進校園');
  expect(campusHeadingText({
    route: '326', heading: headingAfterBoarding(inbound, 'GATE', '靜宜大學(校門)'), arrival: null,
  })).not.toMatch(/^從/);
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
  const brt = campusSegmentRows([
    arrival({ id: 'brt', route: '300', seconds: 240, destination: '台中車站', stopName: '靜宜大學(專用道)' }),
    arrival({ id: 'gate', route: '162', seconds: 180, destination: '沙鹿火車站', stopName: '靜宜大學(英才路)' }),
  ], '專用道', now);
  expect(brt.map((row) => row.route)).toEqual(['300']);
  expect(campusSegmentRows([], '專用道', now)).toEqual([]);
  expect(campusHomeSummary(inbound, now)).toBe('今天收班');
  const scheduledOnly = campusSegmentRows([arrivals[1]], '校門口・往沙鹿', now);
  expect(campusLiveUnavailable(scheduledOnly, now)).toBe(false);
  expect(campusLiveUnavailable(scheduledOnly, now, true)).toBe(true);
  expect(campusUpdatedLabel(new Date(now).toISOString(), now, false)).toMatch(/^\d{2}:\d{2} 更新$/);
});

it('does not list other 專用道 stops such as 市政府 in any campus segment or home', () => {
  const cityHall = arrival({
    id: 'city-301', route: '301', seconds: 60, destination: '沙鹿火車站', stopName: '市政府(專用道)',
  });
  const gate = arrival({
    id: 'gate-162', route: '162', seconds: 180, destination: '沙鹿火車站', stopName: '靜宜大學(校門)',
  });
  expect(campusSegmentRows([cityHall, gate], '校門口・往沙鹿', now).map((row) => row.route)).toEqual(['162']);
  expect(campusSegmentRows([cityHall], '專用道', now)).toEqual([]);
  expect(campusSegmentRows([cityHall], '校門口・往市區', now)).toEqual([]);
  const home = pickCampusNext([cityHall, gate], now, ['162', '301', '368', '326']);
  expect(home.find((row) => row.route === '301')?.arrival).toBeNull();
  expect(campusHomeSummary(home, now)).toBe('162 往沙鹿 3 分');
});

it('keeps 往校內 copy as a destination and never as 從', () => {
  const arrivals = [
    arrival({ id: '368', route: '368', seconds: 600, destination: '主顧聖母堂', stopName: '靜宜大學(校門)' }),
    arrival({ id: '326', route: '326', seconds: 240, destination: '從臺中榮總', stopName: '靜宜大學(校門)' }),
    arrival({ id: '301', route: '301', seconds: 420, destination: '從沙鹿火車站', stopName: '靜宜大學(校門)' }),
  ];
  const rows = campusSegmentRows(arrivals, '校門口・往校內', now);
  expect(rows.map((row) => [row.route, campusHeadingText(row)])).toEqual([
    ['326', '進校園'],
    ['301', '進校園'],
    ['368', '往 主顧聖母堂'],
  ]);
  expect(rows.every((row) => !campusHeadingText(row).includes('從'))).toBe(true);
});

it('keeps long 專用道 route names as a single heading line', () => {
  const arrivals = [
    arrival({ id: '310-2', route: '310區2', seconds: 240, destination: '台中車站', stopName: '靜宜大學(專用道)' }),
    arrival({ id: '306w', route: '306繞', seconds: 480, destination: '清水', stopName: '靜宜大學(專用道)' }),
    arrival({ id: '310-1', route: '310區1', seconds: 720, destination: '臺中港', stopName: '靜宜大學(專用道)' }),
  ];
  const rows = campusSegmentRows(arrivals, '專用道', now);
  expect(rows.map((row) => row.route)).toEqual(['310區2', '306繞', '310區1']);
  expect(rows.every((row) => !row.route.includes('\n'))).toBe(true);
  expect(campusHeadingText(rows[0])).toBe('往 台中車站');
});

it('keeps a long destination as the full heading instead of a truncated label', () => {
  expect(campusHeadingText({
    route: '300', heading: '大勇四維東路口', arrival: null,
  })).toBe('往 大勇四維東路口');
  expect(campusHeadingText({
    route: '300', heading: '大勇四維東路口', arrival: null,
  })).not.toMatch(/…|\.\.\./);
});

it('uses the first late-night scheduled hour for daytime night-bus copy, not the route name', () => {
  const afternoon = Date.parse('2026-10-19T06:41:00.000Z');
  const nightFirst = '2026-10-19T16:05:00.000Z';
  const morningFirst = '2026-10-19T22:00:00.000Z';
  const sameDayLater = '2026-10-19T10:00:00.000Z';
  const lateNightNow = Date.parse('2026-10-19T16:30:00.000Z');
  const laterTonight = '2026-10-19T17:10:00.000Z';
  const night = arrival({
    id: 'night-a', route: '900', status: 3, seconds: null, destination: '新民高中',
    stopName: '靜宜大學', scheduledAt: nightFirst, updatedAt: new Date(afternoon).toISOString(),
  });
  const otherNight = arrival({
    id: 'night-b', route: '168', status: 3, seconds: null, destination: '新民高中',
    stopName: '靜宜大學(校門)', scheduledAt: '2026-10-19T16:40:00.000Z', updatedAt: new Date(afternoon).toISOString(),
  });
  expect(campusEtaView(night, afternoon)).toEqual({ kind: 'night', text: '夜間公車，00:05 起', clock: '00:05' });
  expect(arrivalLabel(night, afternoon)).toBe('夜間公車，00:05 起');
  expect(campusEtaView(otherNight, afternoon)).toEqual({ kind: 'night', text: '夜間公車，00:40 起', clock: '00:40' });
  expect(campusDirectionEnded([{ route: '900', heading: '新民高中', arrival: night }], afternoon)).toBe(false);
  expect(campusHomeSummary([{ route: '900', heading: '新民高中', arrival: night }], afternoon))
    .toBe('900 往市區 夜間公車，00:05 起');
  expect(campusEtaView(arrival({
    id: 'day-done', route: '301', status: 3, seconds: null, destination: '台中車站',
    stopName: '靜宜大學(校門)', scheduledAt: morningFirst, updatedAt: new Date(afternoon).toISOString(),
  }), afternoon)).toEqual({ kind: 'ended', text: '今天收班' });
  expect(campusEtaView(arrival({
    id: 'false-end', route: '162', status: 3, seconds: null, destination: '沙鹿火車站',
    stopName: '靜宜大學(英才路)', scheduledAt: sameDayLater, updatedAt: new Date(afternoon).toISOString(),
  }), afternoon)).toEqual({ kind: 'scheduled', text: '表定 18:00', clock: '18:00' });
  expect(campusEtaView(arrival({
    id: 'running-night', route: '900', status: 0, seconds: null, destination: '新民高中',
    stopName: '靜宜大學', scheduledAt: laterTonight, updatedAt: new Date(lateNightNow).toISOString(),
  }), lateNightNow)).toEqual({ kind: 'scheduled', text: '表定 01:10', clock: '01:10' });
  const picked = pickCampusNext([night], afternoon, ['900']);
  expect(picked[0]?.arrival?.id).toBe('night-a');
  expect(campusEtaView(picked[0]?.arrival ?? null, afternoon).kind).toBe('night');
});

it('merges 專用道 routes that share a destination and keeps the soonest buses first', () => {
  const arrivals = [
    arrival({ id: '300', route: '300', seconds: 240, destination: '台中車站', stopName: '靜宜大學(專用道)' }),
    arrival({ id: '305', route: '305', seconds: 1200, destination: '台中車站', stopName: '靜宜大學(專用道)' }),
    arrival({ id: '306', route: '306', seconds: 1080, destination: '清水', stopName: '靜宜大學(專用道)' }),
    arrival({ id: '302', route: '302', seconds: 360, destination: '新光里', stopName: '靜宜大學(專用道)' }),
  ];
  const rows = campusSegmentRows(arrivals, '專用道', now);
  const display = campusLaneDisplay(rows, now);
  expect(display.shown.map((row) => [row.route, campusHeadingText(row)])).toEqual([
    ['300', '往 台中車站'],
    ['302', '往 新光里'],
    ['306', '往 清水'],
  ]);
  expect(display.extra.map((row) => row.route)).toEqual(['305']);
  expect(display.shown.every((row) => !campusHeadingText(row).includes('終點未提供'))).toBe(true);
});
