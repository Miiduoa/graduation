import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTransitService } from './transit-server';
import {
  MAAS_RATE_LIMIT_PER_MINUTE,
  buildMaasPlannerUrl, maasCacheKey, maasUrlHasArrivalParam, mergeDirectAndTransfers,
  parseMaasTransferPlans, shouldRequestMaas, transferPlannerQuery,
} from './transit-transfer';
import { PROVIDENCE_DIRECT_ORIGIN, PROVIDENCE_ZHUGU_HALL, buildDirectPlan, resolveDirectDestination } from './transit-direct';
import fixture from './fixtures/tdx-maas-walk-and-taxi.json';
import type { DirectTrip } from './transit-direct';
import type { TransitArrival } from './transit';

const NOW = Date.parse('2026-10-25T08:00:00.000Z');
const HSR_START = '2026-10-25T16:10:00+08:00';

function walkOnlyPayload() {
  return structuredClone(fixture);
}

function arrival(overrides: Partial<TransitArrival> = {}): TransitArrival {
  return {
    id: 'a1', route: '162', direction: 0, destination: '沙鹿車站', status: 0, seconds: 180,
    updatedAt: new Date(NOW).toISOString(), stopName: '靜宜大學(英才路)', ...overrides,
  };
}

function direct(overrides: Partial<DirectTrip> = {}): DirectTrip {
  return {
    route: '300', boardStopName: '靜宜大學(專用道)', alightStopName: '臺中車站',
    walkMeters: 200, walkMinutes: 3, arrival: arrival({ route: '300', stopName: '靜宜大學(專用道)', destination: '台中車站' }),
    evidence: 'terminus',
    ...overrides,
  };
}

function service(data: (url: string) => Response | Promise<Response>, override: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let time = NOW;
  const execute = createTransitService({
    credentials: () => ({ clientId: 'test-client', clientSecret: 'test-only-secret' }),
    now: () => time,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/openid-connect/token')) {
        return Response.json({ access_token: 'test-token', expires_in: 3600 });
      }
      return data(String(url));
    },
    ...override,
  });
  return { execute, calls, tick: (ms: number) => { time += ms; } };
}

function busThenMaas(maas: unknown) {
  return (url: string) => {
    if (url.includes('/api/maas/')) return Response.json(maas);
    if (url.includes('/StopOfRoute/')) return Response.json([]);
    return Response.json([]);
  };
}

describe('TDX 轉乘方案', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('校門與主顧樓座標已校正偏西問題，並註明來源', () => {
    expect(PROVIDENCE_DIRECT_ORIGIN).toEqual({ lat: 24.225388, lon: 120.577561 });
    expect(PROVIDENCE_ZHUGU_HALL.lon).toBeGreaterThan(120.577096);
    expect(PROVIDENCE_ZHUGU_HALL).toEqual({ lat: 24.226939, lon: 120.583587 });
    const hall = resolveDirectDestination('主顧樓');
    expect(hall?.lat).toBe(PROVIDENCE_ZHUGU_HALL.lat);
    expect(hall?.lon).toBe(PROVIDENCE_ZHUGU_HALL.lon);
  });

  it('只走路的過濾會丟掉 YOXI 計程車與單車首末段', () => {
    const trips = parseMaasTransferPlans(walkOnlyPayload());
    expect(trips).toHaveLength(1);
    expect(trips[0]?.firstRoute).toBe('300');
    expect(trips[0]?.secondRoute).toBe('151');
    expect(trips[0]?.boardStopName).toBe('靜宜大學(專用道)');
    expect(trips[0]?.transferStopName).toBe('臺中車站');
    expect(trips[0]?.transferWalkMinutes).toBe(3);
    expect(trips[0]?.alightStopName).toBe('高鐵臺中站');
    expect(trips[0]?.totalMinutes).toBe(45);
    expect(JSON.stringify(trips)).not.toMatch(/YOXI|YouBike|Taxi|Bike/i);
  });

  it('組出來的 MaaS 網址只走路、只用出發時間、不含 arrival', () => {
    const dest = { lat: 24.112, lon: 120.616 };
    const url = buildMaasPlannerUrl({ origin: PROVIDENCE_DIRECT_ORIGIN, destination: dest, departureAt: NOW });
    expect(url).toContain('firstLastMileType=Walk');
    expect(url).toContain('gc=0');
    expect(url).toContain('time=2026-10-25T16%3A00%3A00');
    expect(url).toContain(`origin=${PROVIDENCE_DIRECT_ORIGIN.lat.toFixed(6)}%2C${PROVIDENCE_DIRECT_ORIGIN.lon.toFixed(6)}`);
    expect(maasUrlHasArrivalParam(url)).toBe(false);
    expect(url).not.toContain('gc=1');
    expect(url).not.toMatch(/YOXI|Bike|Taxi/i);
  });

  it('主顧樓迄點用校正後的建築座標，不用偏西的站牌', () => {
    const destination = resolveDirectDestination('主顧樓')!;
    const query = transferPlannerQuery(PROVIDENCE_DIRECT_ORIGIN, destination, NOW)!;
    expect(query.destination).toEqual(PROVIDENCE_ZHUGU_HALL);
    const url = buildMaasPlannerUrl(query);
    expect(url).toContain(PROVIDENCE_ZHUGU_HALL.lon.toFixed(6));
    expect(url).not.toContain('120.583099');
  });

  it('直達優先，轉乘要明顯更快才列入，最多 3 個方案', () => {
    const origin = PROVIDENCE_DIRECT_ORIGIN;
    const destination = { lat: 24.112, lon: 120.616 };
    const directs = [
      direct(),
      direct({ route: '304', boardStopName: '靜宜大學(專用道)', alightStopName: '臺中車站' }),
      direct({ route: '305', boardStopName: '靜宜大學(專用道)', alightStopName: '臺中車站' }),
    ];
    const slow = parseMaasTransferPlans(walkOnlyPayload());
    const kept = mergeDirectAndTransfers({
      directs, transfers: slow, origin, destination, now: NOW,
    });
    expect(kept.trips.length).toBeGreaterThan(0);
    expect(kept.transfers).toEqual([]);
    const faster = [{
      boardStopName: '靜宜大學(專用道)', firstRoute: '300', transferStopName: '朝馬',
      transferWalkMinutes: 2, secondRoute: '151', alightStopName: '高鐵臺中站',
      totalMinutes: 12, firstDepartureAt: HSR_START, arrival: null,
    }];
    const mixed = mergeDirectAndTransfers({
      directs, transfers: faster, origin, destination, now: NOW,
    });
    expect(mixed.trips.length + mixed.transfers.length).toBeLessThanOrEqual(3);
    expect(mixed.trips[0]?.route).toBe('300');
    expect(mixed.transfers[0]?.secondRoute).toBe('151');
  });

  it('沒有直達時會請求 MaaS，並把走路轉乘回給頁面', async () => {
    const mock = service(busThenMaas(walkOnlyPayload()));
    const result = await mock.execute({ action: 'direct', schoolId: 'pu', destination: '高鐵臺中站' });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready' || result.kind !== 'direct') throw new Error('expected direct');
    const maas = mock.calls.filter((call) => call.url.includes('/api/maas/Routing/Planner'));
    expect(maas).toHaveLength(1);
    expect(maas[0]?.url).toContain('firstLastMileType=Walk');
    expect(maas[0]?.url).not.toContain('arrival=');
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0]?.firstRoute).toBe('300');
    expect(result.transfers[0]?.secondRoute).toBe('151');
    expect(result.googleMapsUrl).toContain('https://www.google.com/maps/dir/?');
    expect(JSON.stringify(result.transfers)).not.toMatch(/YOXI|YouBike/);
    const maasInit = JSON.stringify(maas[0]?.init ?? {});
    expect(maas[0]?.url.includes('test-only-secret')).toBe(false);
    expect(maasInit.includes('test-only-secret')).toBe(false);
    expect(maasInit).toContain('Bearer test-token');
  });

  it('同起訖、同 5 分鐘時段共用快取，不重複打 MaaS', async () => {
    const mock = service(busThenMaas(walkOnlyPayload()));
    await mock.execute({ action: 'direct', schoolId: 'pu', destination: '高鐵臺中站' });
    mock.tick(60_000);
    await mock.execute({ action: 'direct', schoolId: 'pu', destination: '高鐵臺中站' });
    expect(mock.calls.filter((call) => call.url.includes('/api/maas/Routing/Planner'))).toHaveLength(1);
    expect(maasCacheKey({
      origin: PROVIDENCE_DIRECT_ORIGIN,
      destination: { lat: 24.111, lon: 120.616 },
      departureAt: NOW,
    })).toBe(maasCacheKey({
      origin: PROVIDENCE_DIRECT_ORIGIN,
      destination: { lat: 24.111, lon: 120.616 },
      departureAt: NOW + 60_000,
    }));
  });

  it('每分鐘超過 5 次或逾時就退回直達與 Google 地圖，頁面不壞', async () => {
    const limited = service(busThenMaas(walkOnlyPayload()));
    for (let index = 0; index < MAAS_RATE_LIMIT_PER_MINUTE; index += 1) {
      const result = await limited.execute({
        action: 'direct', schoolId: 'pu', destination: '高鐵臺中站',
        lat: 24.225388 + index * 0.001, lon: 120.577561,
      });
      expect(result.status).toBe('ready');
    }
    const overflow = await limited.execute({
      action: 'direct', schoolId: 'pu', destination: '高鐵臺中站',
      lat: 24.230388, lon: 120.577561,
    });
    expect(overflow.status).toBe('ready');
    if (overflow.status !== 'ready' || overflow.kind !== 'direct') throw new Error('expected direct');
    expect(overflow.transfers).toEqual([]);
    expect(overflow.transferFallback).toBe(true);
    expect(overflow.googleMapsUrl).toContain('travelmode=transit');
    expect(limited.calls.filter((call) => call.url.includes('/api/maas/Routing/Planner'))).toHaveLength(5);

    const timed = service((url) => {
      if (url.includes('/api/maas/')) {
        return new Promise((_, reject) => {
          const error = new Error('timeout');
          error.name = 'TimeoutError';
          reject(error);
        }) as Promise<Response>;
      }
      if (url.includes('/StopOfRoute/')) return Response.json([]);
      return Response.json([]);
    }, { maasTimeoutMs: 20 });
    const fallback = await timed.execute({ action: 'direct', schoolId: 'pu', destination: '高鐵臺中站' });
    expect(fallback.status).toBe('ready');
    if (fallback.status !== 'ready' || fallback.kind !== 'direct') throw new Error('expected direct');
    expect(fallback.transfers).toEqual([]);
    expect(fallback.transferFallback).toBe(true);
    expect(fallback.googleMapsUrl).toContain('https://www.google.com/maps/dir/?');
  });

  it('即時到站失敗時仍回直達與 Google 地圖，不讓頁面壞掉', async () => {
    const mock = service((url) => {
      if (url.includes('/EstimatedTimeOfArrival/')) throw new Error('upstream');
      if (url.includes('/api/maas/')) return Response.json(walkOnlyPayload());
      return Response.json([]);
    });
    const result = await mock.execute({ action: 'direct', schoolId: 'pu', destination: '高鐵臺中站' });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready' || result.kind !== 'direct') throw new Error('expected direct');
    expect(result.googleMapsUrl).toContain('travelmode=transit');
    expect(result.transfers[0]?.firstRoute).toBe('300');
  });

  it('沒有金鑰時不呼叫 MaaS，退回直達結果加 Google 地圖', async () => {
    const calls: string[] = [];
    const execute = createTransitService({
      credentials: () => ({}),
      now: () => NOW,
      fetcher: async (url) => {
        calls.push(String(url));
        return Response.json([]);
      },
    });
    const result = await execute({ action: 'direct', schoolId: 'pu', destination: '高鐵臺中站' });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready' || result.kind !== 'direct') throw new Error('expected direct');
    expect(calls).toEqual([]);
    expect(result.trips).toEqual([]);
    expect(result.transfers).toEqual([]);
    expect(result.transferFallback).toBe(true);
    expect(result.googleMapsUrl).toContain('travelmode=transit');
    expect(buildDirectPlan({ query: '高鐵臺中站' }).googleMapsUrl).toContain('https://www.google.com/maps/dir/?');
  });

  it('有即將到站的直達時不打 MaaS', async () => {
    const mock = service((url) => {
      if (url.includes('/api/maas/')) return Response.json(walkOnlyPayload());
      if (url.includes('/StopOfRoute/')) return Response.json([]);
      return Response.json([{
        StopUID: 'TXG-BRT', RouteUID: 'TXG300', SubRouteUID: 'TXG300', RouteName: { Zh_tw: '300' },
        Direction: 0, StopStatus: 0, EstimateTime: 180, SrcUpdateTime: new Date(NOW).toISOString(),
        StopName: { Zh_tw: '靜宜大學(專用道)' }, DestinationStopNameZh: '臺中車站',
      }]);
    });
    const result = await mock.execute({ action: 'direct', schoolId: 'pu', destination: '臺中車站' });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready' || result.kind !== 'direct') throw new Error('expected direct');
    expect(result.trips.some((trip) => trip.route === '300')).toBe(true);
    expect(mock.calls.some((call) => call.url.includes('/api/maas/'))).toBe(false);
    expect(shouldRequestMaas(result.trips.map((trip) => ({
      ...trip, evidence: 'terminus' as const,
    })), NOW)).toBe(false);
  });
});
