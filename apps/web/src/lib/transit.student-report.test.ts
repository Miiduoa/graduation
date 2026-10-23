import { expect, it } from 'vitest';
import fixture from './fixtures/tdx-providence-student-report.json';
import {
  campusArrivalA11yLabel, campusDestinationFull, campusEtaView, campusGroupForRow,
  campusHeadingText, campusSegmentRows, liveMinutesTrusted, pickCampusNext,
} from './transit';
import { normalizeRouteSequences, normalizeTransitArrivals } from './transit-server';

const eta = fixture.estimatedTimeOfArrival;
const sequences = normalizeRouteSequences(fixture.stopOfRoute);
const rowsFor = (scenario: string, nowIso: string) => {
  const now = Date.parse(nowIso);
  const arrivals = normalizeTransitArrivals(
    eta.filter((row) => row.scenario === scenario || scenario === 'all'),
    null,
    undefined,
    sequences,
  );
  return { now, arrivals };
};

it('does not attach 專用道 300 inbound live minutes to 往台中車站', () => {
  const now = Date.parse(fixture.nowIso.directionBug);
  const arrivals = normalizeTransitArrivals(
    eta.filter((row) => row.scenario === 'direction-reversed-300'),
    null,
    undefined,
    sequences,
  );
  const inbound = arrivals.find((row) => row.route === '300' && row.direction === 1);
  const outbound = arrivals.find((row) => row.route === '300' && row.direction === 0);
  expect(inbound?.seconds).toBe(480);
  expect(inbound?.destination).toBe('靜宜');
  expect(liveMinutesTrusted(inbound!)).toBe(true);
  expect(campusHeadingText({ route: '300', heading: inbound!.destination, arrival: inbound! })).toBe('往 靜宜');
  expect(campusEtaView(inbound!, now)).toEqual({ kind: 'live', text: '8 分', minutes: 8 });
  expect(outbound?.destination).toBe('台中車站');
  expect(campusEtaView(outbound!, now)).toEqual({ kind: 'scheduled', text: '表定 14:38', clock: '14:38' });
  const stolen = { ...inbound!, destination: '台中車站', scheduledAt: outbound?.scheduledAt };
  expect(liveMinutesTrusted(stolen)).toBe(false);
  expect(campusEtaView(stolen, now).kind).not.toBe('live');
  expect(campusEtaView(stolen, now).text).not.toMatch(/8 分/);
  expect(campusEtaView(stolen, now)).toEqual({ kind: 'scheduled', text: '表定 14:38', clock: '14:38' });
  const lane = campusSegmentRows(arrivals, '專用道', now);
  expect(lane.map((row) => [row.route, campusHeadingText(row), campusEtaView(row.arrival, now).text])).toEqual([
    ['300', '往 靜宜', '8 分'],
    ['300', '往 台中車站', '表定 14:38'],
  ]);
});

it('uses 英才路 162 inbound 11 minutes instead of the later gate countdown', () => {
  const now = Date.parse(fixture.nowIso.etaBug);
  const arrivals = normalizeTransitArrivals(
    eta.filter((row) => ['eta-gap-162', 'matched-368', 'matched-301', 'matched-326-ended'].includes(row.scenario)),
    null,
    undefined,
    sequences,
  );
  const inbound = campusSegmentRows(arrivals, '校門口・往校內', now);
  const oneSixTwo = inbound.find((row) => row.route === '162');
  expect(oneSixTwo?.arrival?.stopName).toBe('靜宜大學(英才路)');
  expect(campusEtaView(oneSixTwo?.arrival ?? null, now)).toEqual({ kind: 'live', text: '11 分', minutes: 11 });
  expect(campusGroupForRow(oneSixTwo!)).toBe('校門口・往校內');
  const chapel = inbound.find((row) => row.route === '368');
  expect(chapel?.arrival?.stopName).toBe('靜宜大學(校門)');
  expect(campusEtaView(chapel?.arrival ?? null, now)).toEqual({ kind: 'live', text: '10 分', minutes: 10 });
  const campus301 = inbound.find((row) => row.route === '301');
  expect(campusEtaView(campus301?.arrival ?? null, now)).toEqual({ kind: 'live', text: '7 分', minutes: 7 });
  const outbound = campusSegmentRows(arrivals, '校門口・往沙鹿', now);
  expect(outbound[0]?.route).toBe('162');
  expect(campusEtaView(outbound[0]?.arrival ?? null, now)).toEqual({ kind: 'live', text: '3 分', minutes: 3 });
  const city = campusSegmentRows(arrivals, '校門口・往市區', now);
  expect(campusEtaView(city[0]?.arrival ?? null, now)).toEqual({ kind: 'ended', text: '今天收班' });
});

it('keeps the long 307副 terminus intact for speech and the opened panel', () => {
  const { now, arrivals } = rowsFor('wrap-307-branch', fixture.nowIso.directionBug);
  const row = campusSegmentRows(arrivals, '專用道', now)[0];
  expect(row?.route).toBe('307副');
  expect(row?.heading).toBe('八德東大勇路口');
  expect(campusHeadingText(row!)).toBe('往 八德東大勇路口');
  expect(campusHeadingText(row!)).not.toMatch(/\n|／/);
  expect(campusDestinationFull(row!)).toBe('八德東大勇路口');
  expect(campusArrivalA11yLabel(row!, now)).toBe('307副 往 八德東大勇路口 12 分');
});

it('still lists matched 368 / 162 outbound / 326 ended / 301 inbound from the same snapshot', () => {
  const now = Date.parse(fixture.nowIso.etaBug);
  const arrivals = normalizeTransitArrivals(
    eta.filter((row) => ['eta-gap-162', 'matched-368', 'matched-301', 'matched-326-ended'].includes(row.scenario)),
    null,
    undefined,
    sequences,
  );
  const listed = pickCampusNext(arrivals, now, ['162', '301', '368', '326']);
  expect(listed.map((row) => [row.route, campusHeadingText({ ...row }), campusEtaView(row.arrival, now).text])).toEqual([
    ['162', '往 沙鹿火車站', '3 分'],
    ['301', '往 靜園餐廳', '7 分'],
    ['368', '往 主顧聖母堂', '10 分'],
    ['162', '往 主顧聖母堂', '11 分'],
    ['326', '往 新民高中', '今天收班'],
  ]);
});
