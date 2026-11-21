'use strict';
const { parseWashingReservationTarget: parse, selectWashingReservation: select, washingReservationIntent } = require('./washingReservationSelection');
const now = Date.parse('2026-11-17T09:00:00Z');
const rows = [
  { reservationId: 'r-a', machineId: 'A1', startTime: '2026-11-17T19:00:00+08:00' },
  { reservationId: 'r-b', machineId: 'A2', startTime: '2026-11-17T20:00:00+08:00' },
];
const choose = (text, data = rows) => select(data, parse(text, now));

test('matches an explicitly named machine rather than the first reservation', () => {
  expect(choose('幫我取消 A2 洗衣機預約')).toEqual({ reservation: rows[1] });
  expect(choose('取消 A999 洗衣機預約')).toEqual({ issue: 'not-found' });
});
test('only a unique target can be proposed', () => {
  expect(choose('取消洗衣預約')).toEqual({ issue: 'ambiguous' });
  expect(choose('取消洗衣預約', [rows[1]])).toEqual({ reservation: rows[1] });
  expect(choose('取消洗衣預約', [])).toEqual({ issue: 'not-found' });
});
test('combines identifiers without discarding a conflicting target', () => {
  expect(choose('取消 A2 洗衣預約 編號 r-b')).toEqual({ reservation: rows[1] });
  expect(choose('取消 A1 洗衣預約 編號 r-b')).toEqual({ issue: 'not-found' });
});
test.each([
  '不要取消 A2 洗衣預約', '怎麼取消洗衣預約', '取消全部洗衣預約',
  '取消 A1 和 A2 洗衣預約', '取消洗衣預約 編號 r-a 編號 r-b',
  '取消洗衣預約 編號 ../other', '取消洗衣預約 編號 r/a',
  '取消明天和今天洗衣預約', '取消2026-02-30洗衣預約',
  '取消晚上25:00洗衣預約', '取消信德宿舍洗衣預約',
  '取消 A2 洗衣預約然後重新預約 A3',
  '取消 A2 洗衣預約，預約 A2 洗衣機', '取消洗衣預約，預約洗衣機', '取消 A2 洗衣預約\n另外付款',
])('unknown, ambiguous or compound selector must clarify: %s', (message) => {
  expect(parse(message, now)).toEqual({ kind: 'clarify' });
});
test('resolves today at the Taipei date boundary and treats tonight as evening', () => {
  const data = [
    { reservationId: 'morning', machineId: 'A1', startTime: '2026-11-18T09:00:00+08:00' },
    { reservationId: 'evening', machineId: 'A1', startTime: '2026-11-18T19:00:00+08:00' },
  ];
  expect(select(data, parse('取消今晚洗衣預約', Date.parse('2026-11-17T16:01:00Z')))).toEqual({ reservation: data[1] });
  expect(select(data, parse('取消明天19:00洗衣預約', now))).toEqual({ reservation: data[1] });
});
test('a time without an authoritative date cannot establish a day match', () => {
  const legacy = [{ reservationId: 'legacy', machineId: 'A1', startTime: '19:00' }];
  expect(choose('取消今晚洗衣預約', legacy)).toEqual({ issue: 'not-found' });
  expect(choose('取消 A1 洗衣預約', legacy)).toEqual({ reservation: legacy[0] });
});
test('status read is separate from a cancellation request', () => {
  expect(washingReservationIntent('查我的洗衣預約')).toBe('wash_status');
  expect(washingReservationIntent('洗衣預約 編號 r-a 取消成功了嗎？')).toBe('wash_status');
  expect(washingReservationIntent('幫我預約洗衣機')).toBeNull();
});

test('a timestamp without an explicit timezone cannot establish the requested day', () => {
  expect(choose('取消今晚洗衣預約', [{ reservationId: 'naive', machineId: 'A1', startTime: '2026-11-17T19:00:00' }])).toEqual({ issue: 'not-found' });
});
