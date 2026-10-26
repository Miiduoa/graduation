import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTransitService } from './transit-server';
import {
  MAAS_CACHE_COORD_DECIMALS, MAAS_RATE_LIMIT_PER_MINUTE,
  buildMaasPlannerUrl, clampMaasOrigin, isAllowedMaasDestination, isNearCampusOrigin,
  maasCacheKey, maasUrlHasArrivalParam, mergeDirectAndTransfers,
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

  it('sections 或 routes 是物件時仍能解析走路轉乘', () => {
    const wrapped = walkOnlyPayload() as {
      result: string;
      data: { routes: Array<{ sections: unknown }> };
    };
    const first = wrapped.data.routes[0];
    if (!first || !Array.isArray(first.sections)) throw new Error('expected sections array');
    first.sections = { section: first.sections };
    expect(parseMaasTransferPlans(wrapped)).toHaveLength(1);

    const single = walkOnlyPayload() as { data: { routes: unknown } };
    const walkRoute = (single.data.routes as unknown[])[0];
    single.data.routes = walkRoute;
    expect(parseMaasTransferPlans(single)[0]?.firstRoute).toBe('300');
  });

  it('組出來的 MaaS 網址只走路、只用出發時間、不含 arrival', () => {
    const dest = { lat: 24.112, lon: 120.616 };
    const url = buildMaasPlannerUrl({ origin: PROVIDENCE_DIRECT_ORIGIN, destination: dest, departureAt: NOW });
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/api/maas/routing');
    expect(parsed.searchParams.get('origin')).toBe(
      `${PROVIDENCE_DIRECT_ORIGIN.lat.toFixed(6)},${PROVIDENCE_DIRECT_ORIGIN.lon.toFixed(6)}`,
    );
    expect(parsed.searchParams.get('destination')).toBe('24.112000,120.616000');
    expect(parsed.searchParams.get('gc')).toBe('0');
    expect(parsed.searchParams.get('top')).toBe('5');
    expect(parsed.searchParams.get('transit')).toBe('3,4,5,6,7');
    expect(parsed.searchParams.get('depart')).toBe('2026-10-25T16:00:00');
    expect(parsed.searchParams.get('first_mile_mode')).toBe('0');
    expect(parsed.searchParams.get('last_mile_mode')).toBe('0');
    expect(parsed.searchParams.get('transfer_time')).toBe('0');
    expect(parsed.searchParams.get('firstLastMileType')).toBeNull();
    expect(parsed.searchParams.get('transitType')).toBeNull();
    expect(parsed.searchParams.get('time')).toBeNull();
    expect(parsed.searchParams.get('arrival')).toBeNull();
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
    const maas = mock.calls.filter((call) => call.url.includes('/api/maas/routing'));
    expect(maas).toHaveLength(1);
    const params = new URL(maas[0]!.url).searchParams;
    expect(params.get('first_mile_mode')).toBe('0');
    expect(params.get('last_mile_mode')).toBe('0');
    expect(params.get('transit')).toBe('3,4,5,6,7');
    expect(params.get('depart')).toBeTruthy();
    expect(params.get('arrival')).toBeNull();
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

  it('快取鍵粗化到小數 3 位，校門外定位不另開 MaaS 鍵', () => {
    expect(MAAS_CACHE_COORD_DECIMALS).toBe(3);
    expect(maasCacheKey({
      origin: { lat: 24.225388, lon: 120.577561 },
      destination: { lat: 24.11111, lon: 120.61612 },
      departureAt: NOW,
    })).toBe(maasCacheKey({
      origin: { lat: 24.225300, lon: 120.577500 },
      destination: { lat: 24.11144, lon: 120.61644 },
      departureAt: NOW,
    }));
    expect(isNearCampusOrigin(PROVIDENCE_DIRECT_ORIGIN)).toBe(true);
    expect(clampMaasOrigin({ lat: 25.033, lon: 121.565 })).toEqual(PROVIDENCE_DIRECT_ORIGIN);
    expect(isAllowedMaasDestination({ lat: 24.112, lon: 120.616 })).toBe(true);
    expect(isAllowedMaasDestination({ lat: 25.0, lon: 121.5 })).toBe(false);
    const far = transferPlannerQuery({ lat: 25.033, lon: 121.565 }, {
      query: '高鐵臺中站', label: '高鐵臺中站', kind: 'landmark',
      lat: 24.112, lon: 120.616, matchNames: ['高鐵臺中站'],
    }, NOW);
    expect(far?.origin).toEqual(PROVIDENCE_DIRECT_ORIGIN);
    expect(transferPlannerQuery(PROVIDENCE_DIRECT_ORIGIN, {
      query: '遠方', label: '遠方', kind: 'landmark',
      lat: 25.0, lon: 121.5, matchNames: ['遠方'],
    }, NOW)).toBeNull();
  });

  it('同起訖、同 5 分鐘時段共用快取，不重複打 MaaS', async () => {
    const mock = service(busThenMaas(walkOnlyPayload()));
    await mock.execute({ action: 'direct', schoolId: 'pu', destination: '高鐵臺中站' });
    mock.tick(60_000);
    await mock.execute({ action: 'direct', schoolId: 'pu', destination: '高鐵臺中站' });
    expect(mock.calls.filter((call) => call.url.includes('/api/maas/routing'))).toHaveLength(1);
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
    expect(limited.calls.filter((call) => call.url.includes('/api/maas/routing'))).toHaveLength(5);

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

  it('MaaS 失敗時只記 HTTP 狀態碼與錯誤類型，不記 token 或座標', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const mock = service((url) => {
        if (url.includes('/api/maas/')) return new Response('{}', { status: 404 });
        if (url.includes('/StopOfRoute/')) return Response.json([]);
        return Response.json([]);
      });
      const result = await mock.execute({ action: 'direct', schoolId: 'pu', destination: '高鐵臺中站' });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready' || result.kind !== 'direct') throw new Error('expected direct');
      expect(result.transfers).toEqual([]);
      expect(result.transferFallback).toBe(true);
      expect(result.googleMapsUrl).toContain('travelmode=transit');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('TDX MaaS routing failed', { status: 404, type: 'upstream' });
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toMatch(/test-token|test-only-secret|Bearer/);
      expect(logged).not.toMatch(/origin=|destination=/);
      expect(logged).not.toMatch(/24\.|120\./);
    } finally {
      warn.mockRestore();
    }
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

  it('同鍵並行只打一次上游；不同 origin 大量同時請求每分鐘最多 5 次', async () => {
    const same = service(async (url) => {
      if (url.includes('/api/maas/')) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return Response.json(walkOnlyPayload());
      }
      if (url.includes('/StopOfRoute/')) return Response.json([]);
      return Response.json([]);
    });
    const sameResults = await Promise.all(Array.from({ length: 8 }, () =>
      same.execute({ action: 'direct', schoolId: 'pu', destination: '高鐵臺中站' })));
    expect(sameResults.every((result) => result.status === 'ready')).toBe(true);
    expect(same.calls.filter((call) => call.url.includes('/api/maas/routing'))).toHaveLength(1);

    const burst = service(async (url) => {
      if (url.includes('/api/maas/')) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return Response.json(walkOnlyPayload());
      }
      if (url.includes('/StopOfRoute/')) return Response.json([]);
      return Response.json([]);
    });
    const burstResults = await Promise.all(Array.from({ length: 12 }, (_, index) => burst.execute({
      action: 'direct', schoolId: 'pu', destination: '高鐵臺中站',
      lat: 24.221 + index * 0.001, lon: 120.577561,
    })));
    expect(burstResults.every((result) => result.status === 'ready')).toBe(true);
    expect(burst.calls.filter((call) => call.url.includes('/api/maas/routing'))).toHaveLength(5);
    expect(burstResults.filter((result) => result.status === 'ready' && result.kind === 'direct' && result.transferFallback).length).toBeGreaterThan(0);
  });

  it('MaaS 429 後納入全域暫停，不再打上游', async () => {
    const mock = service((url) => {
      if (url.includes('/api/maas/')) {
        return new Response('{}', { status: 429, headers: { 'retry-after': '60' } });
      }
      if (url.includes('/StopOfRoute/')) return Response.json([]);
      return Response.json([]);
    });
    const first = await mock.execute({
      action: 'direct', schoolId: 'pu', destination: '高鐵臺中站',
      lat: 24.225388, lon: 120.577561,
    });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready' || first.kind !== 'direct') throw new Error('expected direct');
    expect(first.transferFallback).toBe(true);
    mock.tick(16_000);
    const etaAfterFirst = mock.calls.filter((call) => call.url.includes('/EstimatedTimeOfArrival/')).length;
    const second = await mock.execute({
      action: 'direct', schoolId: 'pu', destination: '高鐵臺中站',
      lat: 24.226388, lon: 120.577561,
    });
    expect(second.status).toBe('ready');
    if (second.status !== 'ready' || second.kind !== 'direct') throw new Error('expected direct');
    expect(second.transferFallback).toBe(true);
    expect(mock.calls.filter((call) => call.url.includes('/api/maas/routing'))).toHaveLength(1);
    expect(mock.calls.filter((call) => call.url.includes('/EstimatedTimeOfArrival/')).length).toBe(etaAfterFirst);
    const campus = await mock.execute({ action: 'campus-next', schoolId: 'pu' });
    expect(campus.status === 'ready' || campus.status === 'unavailable').toBe(true);
    expect(mock.calls.filter((call) => call.url.includes('/EstimatedTimeOfArrival/')).length).toBe(etaAfterFirst);
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
