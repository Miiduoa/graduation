import {
  formatPickupTime,
  pickupTimeFromMinutes,
  pickupTimeGuidance,
} from '../screens/nuni/foodPickupTime';

describe('取餐時間換算', () => {
  const now = Date.parse('2026-11-01T15:50:00.000Z');

  it.each([
    ['1', '2026-11-01T15:51:00.000Z'],
    ['15', '2026-11-01T16:05:00.000Z'],
    ['30', '2026-11-01T16:20:00.000Z'],
    ['60', '2026-11-01T16:50:00.000Z'],
    ['1440', '2026-11-02T15:50:00.000Z'],
  ])('輸入 %s 分鐘會得到對應的絕對時間', (input, expected) => {
    expect(pickupTimeFromMinutes(input, now)).toBe(expected);
  });

  it.each(['', ' ', '0', '-1', '1441', '1.5', '15.0', '1e2', '0x10', '+15', '15分鐘', ' 15'])(
    '拒絕無效分鐘數 %s',
    (input) => {
      expect(pickupTimeFromMinutes(input, now)).toBeNull();
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 8.64e15, -8.64e15 - 1])(
    '無效基準時間或換算超出日期上限時不產生取餐時間：%s',
    (invalidNow) => {
      expect(pickupTimeFromMinutes('15', invalidNow)).toBeNull();
    },
  );

  it('跨午夜會顯示隔天日期，午夜使用 00 時', () => {
    expect(formatPickupTime(pickupTimeFromMinutes('15', now)!)).toBe('2026/11/02 00:05');
    expect(formatPickupTime('2026-11-01T16:00:00.000Z')).toBe('2026/11/02 00:00');
  });

  it('跨年會顯示下一年的日期', () => {
    const newYear = Date.parse('2026-12-31T15:45:00.000Z');
    expect(formatPickupTime(pickupTimeFromMinutes('30', newYear)!)).toBe('2027/01/01 00:15');
  });

  it('不受裝置時區或來源日期偏移量影響', () => {
    const originalTimeZone = process.env.TZ;
    try {
      for (const timeZone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
        process.env.TZ = timeZone;
        expect(formatPickupTime('2026-11-01T16:05:00.000Z')).toBe('2026/11/02 00:05');
        expect(formatPickupTime('2026-11-02T00:05:00+08:00')).toBe('2026/11/02 00:05');
        expect(formatPickupTime('2026-11-01T08:05:00-08:00')).toBe('2026/11/02 00:05');
      }
    } finally {
      if (originalTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimeZone;
    }
  });

  it.each([
    '',
    'invalid',
    '2026-11-01T12:00:00',
    '2026-13-01T12:00:00Z',
    '2026-11-00T12:00:00Z',
    '2026-11-01T12:60:00Z',
    '2026-11-01T12:00:60Z',
  ])('不顯示無法確認的日期 %s', (value) => {
    expect(formatPickupTime(value)).toBeNull();
  });
});

describe('門市取餐範圍提示', () => {
  const location = {
    state: 'open' as const,
    earliestPickupAt: '2026-11-01T15:45:00.000Z',
    latestPickupAt: '2026-11-01T16:30:00.000Z',
  };

  it('完整顯示跨日範圍，不把符合範圍當成接單保證', () => {
    const result = pickupTimeGuidance(location, '2026-11-01T16:00:00Z');
    expect(result).toEqual({
      windowText: '門市提供的取餐範圍：2026/11/01 23:45 至 2026/11/02 00:30（台灣時間）。',
      warning: null,
    });
  });

  it.each([location.earliestPickupAt, location.latestPickupAt])(
    '等於範圍邊界 %s 不顯示超出警告',
    (requested) => {
      expect(pickupTimeGuidance(location, requested).warning).toBeNull();
    },
  );

  it('最早與最晚相同仍可顯示，且只對超出時間提示', () => {
    const sameBoundary = { ...location, latestPickupAt: location.earliestPickupAt };
    expect(pickupTimeGuidance(sameBoundary, location.earliestPickupAt).warning).toBeNull();
    expect(pickupTimeGuidance(sameBoundary, location.latestPickupAt).warning).toContain(
      '減少分鐘數',
    );
  });

  it('早於最早時間時提供調整與更新下一步', () => {
    expect(pickupTimeGuidance(location, '2026-11-01T15:44:59Z').warning).toBe(
      '選擇的時間早於門市提供的最早取餐時間，請增加分鐘數，或重新讀取餐點。',
    );
  });

  it('晚於最晚時間時提供調整與改選門市下一步', () => {
    expect(pickupTimeGuidance(location, '2026-11-01T16:30:01Z').warning).toBe(
      '選擇的時間晚於門市提供的最晚取餐時間，請減少分鐘數，或返回選擇其他門市。',
    );
  });

  it('只有最早邊界時仍顯示並檢查下限', () => {
    const earliestOnly = { state: 'open' as const, earliestPickupAt: location.earliestPickupAt };
    expect(pickupTimeGuidance(earliestOnly, location.latestPickupAt)).toEqual({
      windowText: '門市提供的最早取餐時間：2026/11/01 23:45（台灣時間）。',
      warning: null,
    });
    expect(pickupTimeGuidance(earliestOnly, '2026-11-01T15:00:00Z').warning).toContain(
      '增加分鐘數',
    );
  });

  it('只有最晚邊界時仍顯示並檢查上限', () => {
    const latestOnly = { state: 'open' as const, latestPickupAt: location.latestPickupAt };
    expect(pickupTimeGuidance(latestOnly, location.earliestPickupAt)).toEqual({
      windowText: '門市提供的最晚取餐時間：2026/11/02 00:30（台灣時間）。',
      warning: null,
    });
    expect(pickupTimeGuidance(latestOnly, '2026-11-01T17:00:00Z').warning).toContain('減少分鐘數');
  });

  it('沒有邊界時引導向門市確認是否能接單', () => {
    expect(pickupTimeGuidance({ state: 'open' }, location.earliestPickupAt)).toEqual({
      windowText: '門市尚未提供取餐時間範圍，請確認餐點與金額，查看是否能接單。',
      warning: null,
    });
  });

  it.each([
    { ...location, earliestPickupAt: '' },
    { ...location, earliestPickupAt: 'invalid' },
    { ...location, latestPickupAt: '2026-13-01T12:00:00Z' },
    {
      ...location,
      earliestPickupAt: location.latestPickupAt,
      latestPickupAt: location.earliestPickupAt,
    },
  ])('非法或倒置範圍不顯示可能誤導的邊界：%s', (invalidLocation) => {
    expect(pickupTimeGuidance(invalidLocation, location.earliestPickupAt)).toEqual({
      windowText: '門市提供的取餐時間範圍無法確認。',
      warning: '請重新讀取餐點以更新取餐範圍；若仍無法確認，請返回選擇其他門市。',
    });
  });

  it.each([null, 'invalid'])('沒有有效選擇時保留門市範圍，不猜測取餐時間：%s', (requested) => {
    expect(pickupTimeGuidance(location, requested).windowText).toContain('2026/11/02 00:30');
    expect(pickupTimeGuidance(location, requested).warning).toBeNull();
  });

  it.each([
    ['closed' as const, '門市目前已關店，請返回選擇其他門市，或稍後重新讀取餐點。'],
    ['paused' as const, '門市目前暫停接單，請稍後重新讀取餐點，或返回選擇其他門市。'],
  ])('%s 的提示優先於超出範圍或範圍異常', (state, warning) => {
    expect(pickupTimeGuidance({ ...location, state }, '2026-11-01T17:00:00Z').warning).toBe(
      warning,
    );
    expect(
      pickupTimeGuidance({ ...location, state, earliestPickupAt: 'invalid' }, null).warning,
    ).toBe(warning);
  });
});
