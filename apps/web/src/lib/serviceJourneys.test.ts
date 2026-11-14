import { afterEach, expect, it, vi } from 'vitest';
import { directoryCampusServices, presentCampusService } from './campusServices';
import {
  journeyServices,
  readJourneyFilters,
  serviceJourneyGroup,
  writeJourneyFilters,
} from './serviceJourneys';

afterEach(() => vi.unstubAllEnvs());

it('分類目錄涵蓋 catalog 中所有主要生活與交流入口，沒有第二份名稱或存取設定', () => {
  for (const [journey, category] of [
    ['life', 'campus'],
    ['connect', 'connect'],
  ] as const) {
    const expected = directoryCampusServices()
      .filter((service) => service.category === category)
      .map(presentCampusService);
    expect(journeyServices(journey, { query: '', group: 'all' })).toEqual(expected);
  }
});

it('餐廳與 App 訂單共用飲食分類，但未開放的訂單不會被搜尋挖出', () => {
  expect(
    journeyServices('life', { query: '餐廳', group: 'daily' }).some(
      (service) => service.href === '/cafeteria',
    ),
  ).toBe(true);
  expect(journeyServices('life', { query: '訂單紀錄', group: 'all' })).toEqual([]);
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  const orders = journeyServices('life', { query: '訂單紀錄', group: 'daily' });
  expect(orders).toHaveLength(1);
  expect(orders[0].href).toBe('/orders');
  expect(serviceJourneyGroup('life', orders[0])).toBe('daily');
});

it('不把資訊需求與私人訊息混成一個入口', () => {
  const people = journeyServices('connect', { query: '', group: 'people' }).map(
    (service) => service.href,
  );
  const updates = journeyServices('connect', { query: '', group: 'updates' }).map(
    (service) => service.href,
  );
  expect(people).toEqual(['/dms', '/friends']);
  expect(updates).toEqual(['/announcements', '/messages']);
});

it('返回參數只接受目前目錄的分類，過長搜尋有上限', () => {
  expect(readJourneyFilters(new URLSearchParams('q=公車&group=travel'), 'life')).toEqual({
    query: '公車',
    group: 'travel',
  });
  expect(readJourneyFilters(new URLSearchParams('q=公車&group=travel'), 'connect')).toEqual({
    query: '公車',
    group: 'all',
  });
  expect(readJourneyFilters(new URLSearchParams('q=hello%00world&group=missing'), 'life')).toEqual({
    query: 'helloworld',
    group: 'all',
  });
  expect(
    readJourneyFilters(new URLSearchParams({ q: 'x'.repeat(200) }), 'life').query,
  ).toHaveLength(100);
});

it('修改或清除篩選時保留校園資訊與其它網址狀態', () => {
  const params = new URLSearchParams('campus=nthu&schoolId=nthu&extra=keep');
  writeJourneyFilters(params, { query: '公車', group: 'travel' });
  expect(params.get('campus')).toBe('nthu');
  expect(params.get('q')).toBe('公車');
  writeJourneyFilters(params, { query: '', group: 'all' });
  expect(params.toString()).toBe('campus=nthu&schoolId=nthu&extra=keep');
});
