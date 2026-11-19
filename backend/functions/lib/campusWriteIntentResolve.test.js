'use strict';

const {
  resolveRepairInput,
  messageLooksLikeDormRepairActionMessage,
  resolveReserveSeatInput,
} = require('./campusWriteIntentResolve');

describe('messageLooksLikeDormRepairActionMessage', () => {
  test('matches explicit 報修', () => {
    expect(messageLooksLikeDormRepairActionMessage('幫我宿舍冷氣報修')).toBe(true);
  });

  test('matches 冷氣怪怪的 without 報修 keyword', () => {
    expect(messageLooksLikeDormRepairActionMessage('A棟301冷氣怪怪的')).toBe(true);
  });

  test('matches 房間好熱 with facility', () => {
    expect(messageLooksLikeDormRepairActionMessage('房間好熱 冷氣好像沒風')).toBe(true);
  });

  test('does not match unrelated health text', () => {
    expect(messageLooksLikeDormRepairActionMessage('我頭好痛想休息')).toBe(false);
  });
});

describe('resolveReserveSeatInput', () => {
  const prefix = '幫我預約 2026-11-20 ';
  test.each([
    ['14:05 到 16:35 座位編號：lib-3F-A15', 'lib-3F-A15', '14:05', '16:35'],
    ['14:05–16:35 lib-3F-A01', 'lib-3F-A01', '14:05', '16:35'],
    ['上午9點15分到10點45分 圖書館三樓 A-15', 'lib-3F-A15', '09:15', '10:45'],
    ['下午3:15 到 4:45 座位編號：S1', 'S1', '15:15', '16:45'],
    ['下午三點半至四點十五分 圖書館三樓 A15', 'lib-3F-A15', '15:30', '16:15'],
    ['14:05 座位編號：S1，預約 90 分鐘', 'S1', '14:05', '15:35'],
    ['早上9點 座位編號：S1，預約 2 小時 15 分鐘', 'S1', '09:00', '11:15'],
    ['14:05 座位編號：S1，預約半小時', 'S1', '14:05', '14:35'],
  ])('preserves explicit seat and exact range: %s', (message, seatId, startTime, endTime) => {
    expect(resolveReserveSeatInput(prefix + message, 'Asia/Taipei')).toEqual({
      seatId, date: '2026-11-20', startTime, endTime,
    });
  });

  test.each([
    '14:00 到 16:30 圖書館三樓隨便一席',
    '14:00 到 16:30 圖書館三樓',
    '14:00 到 16:30 任一席',
    '14:00 座位編號：S1',
    '14:00 到下課 座位編號：S1',
    '14:00 到 16:30 或 17:30 座位編號：S1',
    '14:00 到 16:30 座位編號：S1 或座位編號：S2',
    '14:00 到 16:30 lib-3F-A01 不要，改 lib-3F-A02',
    '23:00 到 01:00 座位編號：S1',
    '14:00 到 14:00 座位編號：S1',
    '14:00 到隔天16:00 座位編號：S1',
    '25:00 到 26:00 座位編號：S1',
    '09:60 到 10:30 座位編號：S1',
    '14:000 到 16:30 座位編號：S1',
    '14:00 到 16:30 座位編號：schools/other-seat',
    '23:30 座位編號：S1，預約 90 分鐘',
    '14:00 座位編號：S1，預約 0 分鐘',
    '14:00 座位編號：S1，預約 1.5 小時',
    '14:00 到 16:30 座位編號：S1，預約 30 分鐘',
    '不要預約 14:00 到 16:30 座位編號：S1',
    '如果有空位才預約 14:00 到 16:30 座位編號：S1',
    '「預約 14:00 到 16:30 lib-3F-A01」',
    '14:00 到 16:30 座位編號：S1，或2026-11-21',
    '14:00 座位編號：S1，預約 1 小時半',
    '14:00 座位編號：S1，預約 -30 分鐘',
    '14:00 座位編號：S1，預約一百二十分鐘',
    'PM 9:00 到 10:00 座位編號：S1',
    '下午，3:00 到 4:00 座位編號：S1',
    '3:15 到 4:45pm 座位編號：S1',
    '09:00 到 10:00 UTC 座位編號：S1',
    '09:00 到 10:00 GMT+9 座位編號：S1',
    '約14:00 到 16:00 座位編號：S1',
    '最早14:00 到 16:00 座位編號：S1',
    '14:00 到 16:00 圖書館三樓 A015X',
    '14:00 到 16:00 圖書館三樓 A1.5',
    '14:00 到 16:00 lib-3F-A01.v2',
    '14:00 到 16:00 圖書館三樓 A01與A02',
    '晚上12點到1點 座位編號：S1',
    '下午0點到1點 座位編號：S1',
    '14:00 之後預約90分鐘 座位編號：S1',
    '14:00 到 16:00 左右 座位編號：S1',
    '14:00 座位編號：S1 預約30-90分鐘',
  ])('does not guess an incomplete, ambiguous or invalid reservation: %s', message => {
    expect(resolveReserveSeatInput(prefix + message, 'Asia/Taipei')).toBeNull();
  });

  test('rejects a nonexistent calendar date before preparing a card', () => {
    expect(resolveReserveSeatInput('2026-02-30 14:00 到 16:30 座位編號：S1', 'Asia/Taipei')).toBeNull();
  });
  test.each(['2027年11月20日', '12026-11-20', '2026-11-201', '2026-11-20到21日'])('does not truncate an unsupported date: %s', date => {
    expect(resolveReserveSeatInput(date + ' 14:00 到 16:30 座位編號：S1', 'Asia/Taipei')).toBeNull();
  });
  test('does not use the date inside an exact seat ID instead of the requested date', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-17T02:00:00.000Z'));
    try {
      expect(resolveReserveSeatInput('明天14:00到16:00 座位:seat-2026-11-20', 'Asia/Taipei')).toEqual({
        seatId: 'seat-2026-11-20', date: '2026-11-18', startTime: '14:00', endTime: '16:00',
      });
    } finally { jest.useRealTimers(); }
  });
  test.each([
    ['1/2', '2026-12-31T16:30:00.000Z', 'Asia/Taipei', '2027-01-02'],
    ['1月2日', '2026-12-31T16:30:00.000Z', 'Asia/Taipei', '2027-01-02'],
    ['1/2', '2027-01-01T02:30:00.000Z', 'America/Los_Angeles', '2026-01-02'],
  ])('uses the selected timezone year for %s at %s in %s', (date, now, timeZone, expectedDate) => {
    jest.useFakeTimers().setSystemTime(new Date(now));
    try {
      expect(resolveReserveSeatInput(`${date} 09:00到10:00 seat:S1`, timeZone)).toEqual({
        seatId: 'S1', date: expectedDate, startTime: '09:00', endTime: '10:00',
      });
    } finally { jest.useRealTimers(); }
  });
});

describe('resolveRepairInput', () => {
  test('parses 不冷 without 報修 keyword', () => {
    const r = resolveRepairInput('A棟 302 冷氣不冷');
    expect(r).not.toBeNull();
    expect(r.category).toBe('hvac');
    expect(r.room).toBe('302');
  });

  test('parses 怪怪的 + 冷氣', () => {
    const r = resolveRepairInput('宿舍冷氣怪怪的 聲音很大');
    expect(r).not.toBeNull();
    expect(r.category).toBe('hvac');
  });
});
