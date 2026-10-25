import { describe, expect, it } from 'vitest';
import { campusEtaView, type RouteStopSequence, type TransitArrival } from './transit';
import { findCatalogStopsByName, searchTaichungCatalog } from './transit-catalog';
import {
  PROVIDENCE_DIRECT_ORIGIN, buildDirectPlan, googleTransitUrl, planDirectTrips, resolveDirectDestination,
  walkingMinutesFromMeters,
} from './transit-direct';

const NOW = Date.parse('2026-10-24T06:40:00.000Z');
const campusStops = searchTaichungCatalog({ action: 'campus', schoolId: 'pu' }).stops;
const stop = (name: string) => campusStops.find((entry) => entry.name === name);

function sequence(
  routeName: string,
  direction: number,
  names: string[],
): RouteStopSequence {
  return {
    routeUid: `TXG${routeName}`,
    subRouteUid: `TXG${routeName}`,
    routeName,
    direction,
    stops: names.map((name, index) => ({ id: `${routeName}-${index}`, name })),
  };
}

function arrival(overrides: Partial<TransitArrival> = {}): TransitArrival {
  return {
    id: 'a1', route: '162', direction: 0, destination: '沙鹿車站', status: 0, seconds: 180,
    updatedAt: new Date(NOW).toISOString(), stopName: '靜宜大學(英才路)', ...overrides,
  };
}

describe('直達目的地演算法', () => {
  it('用站序找出從英才路上 162、在沙鹿車站下車', () => {
    const destination = resolveDirectDestination('沙鹿車站', findCatalogStopsByName('沙鹿車站'));
    expect(destination?.label).toBe('沙鹿車站');
    const trips = planDirectTrips({
      origin: PROVIDENCE_DIRECT_ORIGIN,
      destination: destination!,
      campusStops,
      destinationStops: findCatalogStopsByName('沙鹿車站'),
      sequences: [sequence('162', 0, ['靜宜大學(英才路)', '沙鹿車站', '嘉陽高中'])],
      arrivals: [arrival()],
      now: NOW,
    });
    expect(trips[0]?.route).toBe('162');
    expect(trips[0]?.boardStopName).toBe('靜宜大學(英才路)');
    expect(trips[0]?.alightStopName).toBe('沙鹿車站');
    expect(trips[0]?.evidence).toBe('sequence');
    expect(trips[0]?.walkMinutes).toBeGreaterThanOrEqual(1);
    expect(campusEtaView(trips[0]!.arrival, NOW)).toEqual({ kind: 'live', text: '3 分', minutes: 3 });
  });

  it('站序顯示目的地在上車站之前時，不把它當成直達', () => {
    const destination = resolveDirectDestination('沙鹿車站', findCatalogStopsByName('沙鹿車站'))!;
    const trips = planDirectTrips({
      origin: PROVIDENCE_DIRECT_ORIGIN,
      destination,
      campusStops,
      destinationStops: findCatalogStopsByName('沙鹿車站'),
      sequences: [sequence('162', 1, ['沙鹿車站', '靜宜大學(英才路)', '靜宜大學(校門)', '靜宜大學主顧聖母堂'])],
      arrivals: [],
      now: NOW,
    });
    expect(trips.some((trip) => trip.route === '162' && trip.evidence === 'sequence')).toBe(false);
  });

  it('專用道終點是臺中車站時，不用站序也能標直達 300', () => {
    const destination = resolveDirectDestination('臺中車站', findCatalogStopsByName('臺中車站'))!;
    expect(destination.label).toBe('臺中車站');
    const trips = planDirectTrips({
      origin: PROVIDENCE_DIRECT_ORIGIN,
      destination,
      campusStops,
      destinationStops: findCatalogStopsByName('臺中車站'),
      sequences: [],
      arrivals: [arrival({
        id: '300', route: '300', direction: 0, destination: '台中車站', seconds: 240,
        stopName: '靜宜大學(專用道)',
      })],
      now: NOW,
    });
    const brt = trips.find((trip) => trip.route === '300');
    expect(brt?.boardStopName).toContain('專用道');
    expect(brt?.alightStopName).toContain('臺中車站');
    expect(brt?.evidence).toBe('terminus');
    expect(campusEtaView(brt!.arrival, NOW).kind).toBe('live');
  });

  it('沒有即時倒數時標表定，不編造時間', () => {
    const destination = resolveDirectDestination('沙鹿車站', findCatalogStopsByName('沙鹿車站'))!;
    const scheduledAt = new Date(NOW + 20 * 60_000).toISOString();
    const trips = planDirectTrips({
      origin: PROVIDENCE_DIRECT_ORIGIN,
      destination,
      campusStops,
      destinationStops: findCatalogStopsByName('沙鹿車站'),
      sequences: [sequence('162', 0, ['靜宜大學(英才路)', '沙鹿車站'])],
      arrivals: [arrival({ seconds: null, scheduledAt })],
      now: NOW,
    });
    expect(campusEtaView(trips[0]!.arrival, NOW)).toEqual({ kind: 'scheduled', text: '表定 15:00', clock: '15:00' });
    expect(campusEtaView(trips[0]!.arrival, NOW).text).toMatch(/^表定 /);
    expect(campusEtaView(trips[0]!.arrival, NOW).text).not.toMatch(/末班/);
  });

  it('今天收班只寫收班，不假裝有末班時刻', () => {
    const destination = resolveDirectDestination('沙鹿車站', findCatalogStopsByName('沙鹿車站'))!;
    const trips = planDirectTrips({
      origin: PROVIDENCE_DIRECT_ORIGIN,
      destination,
      campusStops,
      destinationStops: findCatalogStopsByName('沙鹿車站'),
      sequences: [sequence('162', 0, ['靜宜大學(英才路)', '沙鹿車站'])],
      arrivals: [arrival({ status: 3, seconds: null, scheduledAt: null })],
      now: NOW,
    });
    const ended = trips.find((trip) => trip.route === '162' && trip.boardStopName.includes('英才'));
    expect(campusEtaView(ended!.arrival, NOW)).toEqual({ kind: 'ended', text: '今天收班' });
    expect(JSON.stringify(ended!.arrival)).not.toMatch(/末班/);
    expect(JSON.stringify(trips).includes('末班')).toBe(false);
  });

  it('高鐵臺中站沒有直達時回空清單，並附 Google 地圖外連', () => {
    const plan = buildDirectPlan({ query: '高鐵臺中站', sequences: [], arrivals: [], now: NOW });
    expect(plan.destination?.label).toBe('高鐵臺中站');
    expect(plan.trips).toEqual([]);
    expect(plan.googleMapsUrl).toContain('https://www.google.com/maps/dir/?');
    expect(plan.googleMapsUrl).toContain('travelmode=transit');
    expect(plan.googleMapsUrl).not.toMatch(/TDX|maas/i);
  });

  it('校內大樓可對到主顧樓站牌', () => {
    const destination = resolveDirectDestination('主顧樓', findCatalogStopsByName('主顧樓'));
    expect(destination?.kind).toBe('campus-place');
    expect(destination?.lon).toBe(120.583587);
    expect(destination?.lat).toBe(24.226939);
    expect(stop('靜宜大學主顧樓')?.name).toBe('靜宜大學主顧樓');
    const trips = planDirectTrips({
      origin: PROVIDENCE_DIRECT_ORIGIN,
      destination: destination!,
      campusStops,
      destinationStops: findCatalogStopsByName('主顧樓'),
      sequences: [sequence('162', 1, ['靜宜大學(校門)', '靜宜大學主顧樓', '靜宜大學主顧聖母堂'])],
      arrivals: [arrival({
        route: '162', direction: 1, destination: '主顧聖母堂', stopName: '靜宜大學(校門)', seconds: 420,
      })],
      now: NOW,
    });
    expect(trips[0]?.boardStopName).toBe('靜宜大學(校門)');
    expect(trips[0]?.alightStopName).toBe('靜宜大學主顧樓');
  });

  it('走路分鐘用直線距離公式，不拿假的末班或車程充當', () => {
    expect(walkingMinutesFromMeters(160)).toBe(2);
    expect(walkingMinutesFromMeters(0)).toBe(1);
    expect(walkingMinutesFromMeters(-3)).toBeNull();
    const url = googleTransitUrl(PROVIDENCE_DIRECT_ORIGIN, '高鐵臺中站');
    expect(url).toContain('origin=24.225388');
    expect(url).toContain('destination=%E9%AB%98%E9%90%B5');
  });
});
