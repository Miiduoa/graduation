// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseCampusMapClause, parseCampusMapCommand } from './campusMapRequest';
import { crossServiceRequest } from './crossServiceRequest';
import { FIXTURE_NOW as now } from './fixtures';

describe('explicit campus map requests', () => {
  it.each([
    ['任垣樓在哪裡？', '任垣樓'], ['幫我查任垣樓在哪裡', '任垣樓'],
    ['查任垣樓', '任垣樓'], ['請問資訊202在哪裡', '資訊202'],
    ['圖書館在哪裡', '圖書館'], ['查和平樓的位置', '和平樓'],
    ['查校園地點任垣樓的位置', '任垣樓'], ['校園地圖查任垣樓', '任垣樓'],
    ['學生活動中心在哪裡', '學生活動中心'], ['行政辦公室在哪裡', '行政辦公室'], ['資管系辦在哪裡', '資管系辦'],
  ])('consumes the full location question %s', (question, query) => {
    expect(parseCampusMapCommand(question)).toEqual({ kind: 'place', query });
    const request = crossServiceRequest(question, now)!;
    expect(request.operations).toEqual([{ id: 'task-1', kind: 'read', label: '查校園地點',
      serviceId: 'map', tool: 'get_campus_map', args: { query, limit: 5 }, dependsOn: [] }]);
  });

  it.each(['下一堂課教室在哪裡', '查下一堂課，教室在哪裡', '查下一堂課然後查教室的位置',
    '幫我查下一節課的教室在哪裡？', '下一堂課在哪，幾點', '下一堂課在哪裡，幾點開始'])('binds one next-class source for %s', question => {
    expect(parseCampusMapCommand(question)).toEqual({ kind: 'next-class' });
    const request = crossServiceRequest(question, now)!;
    expect(request.operations).toHaveLength(2);
    expect(request.operations[0]).toMatchObject({ id: 'task-1', tool: 'get_schedule',
      directRead: { kind: 'next-class' }, args: { from: '2026-11-04', to: '2026-11-10' } });
    expect(request.operations[1]).toMatchObject({ kind: 'map-location', serviceId: 'map', dependsOn: ['task-1'], args: {} });
  });

  it('keeps explicit days on the full task graph without shortening the direct command', () => {
    for (const [question, day] of [
      ['明天下一堂課教室在哪裡', '2026-11-05'], ['今天下一堂課的位置', '2026-11-04'],
      ['2026-11-06下一堂課教室在哪裡', '2026-11-06'],
    ]) {
      expect(parseCampusMapCommand(question)).toBeNull();
      expect(crossServiceRequest(question, now)?.operations[0].args).toEqual({ from: day, to: day });
    }
    expect(crossServiceRequest('2026-02-30下一堂課教室在哪裡', now)).toBeNull();
  });

  it('keeps location names containing a conjunction and independent services intact', () => {
    const request = crossServiceRequest('查和平樓在哪裡，查餐廳，查公車', now)!;
    expect(request.operations.map(operation => operation.serviceId)).toEqual(['map', 'cafeteria', 'bus']);
    expect(request.operations[0].args.query).toBe('和平樓');
    expect(parseCampusMapCommand('任垣樓在哪裡，查餐廳')).toBeNull();
    expect(crossServiceRequest('查任垣樓和圖書館在哪裡', now)?.operations.map(operation => operation.args.query))
      .toEqual(['任垣樓', '圖書館']);
  });

  it.each([
    '不要查任垣樓在哪裡', '任垣樓怎麼走', '圖書館開放時間', '查圖書館',
    '任垣樓在哪裡並幫我下單', '任垣樓在哪裡，幫我新增行程',
    '翻譯任垣樓在哪裡', '如果我去任垣樓在哪裡', '任垣樓\u202e在哪裡',
    '查任垣樓的最近入口', '今天任垣樓在哪裡', '任垣樓幾樓', '開啟任垣樓的地圖',
    '教室在哪裡', '查課表，教室在哪裡', '查下一堂課，查公車，教室在哪裡',
    '活動在哪裡報名', '查第一個活動在哪裡', '查近期活動，查第一個活動在哪裡',
  ])('does not lose unsupported scope or invent a classroom for %s', question => {
    expect(parseCampusMapCommand(question)).toBeNull();
  });

  it('keeps ambiguous or unbound classroom references off the cross-service path', () => {
    for (const question of ['教室在哪裡', '查課表，教室在哪裡', '查下一堂課，查公車，教室在哪裡'])
      expect(crossServiceRequest(question, now)).toBeNull();
    expect(parseCampusMapClause('教室在哪裡')).toEqual({ kind: 'previous-next-class' });
    expect(parseCampusMapCommand('查校園地點' + '樓'.repeat(121) + '的位置')).toBeNull();
  });

  it('binds an explicit event ordinal to the latest activity source and keeps unsupported indices unconsumed', () => {
    const request = crossServiceRequest('查近期活動，查第二個活動位置，查餐廳', now)!;
    expect(request.operations[0]).toMatchObject({ tool: 'get_campus_events' });
    expect(request.operations[1]).toMatchObject({ kind: 'map-location', mapSource: { kind: 'event', index: 2 },
      dependsOn: [request.operations[0].id] });
    for (const question of ['查第一個活動在哪裡', '查公告，查第一個活動在哪裡',
      '查近期活動，查第六個活動在哪裡', '查近期活動，查第0個活動在哪裡', '查近期活動，查活動在哪裡報名'])
      expect(crossServiceRequest(question, now), question).toBeNull();
  });
});
