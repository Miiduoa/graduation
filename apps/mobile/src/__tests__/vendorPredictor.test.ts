import {
  predictVendorStatus,
  currentWeekHour,
  sumOrdersInWindow,
  findPeakHours,
  type VendorHourBucket,
  type VendorHistory,
} from '../services/vendorPredictor';

const at = (year: number, month: number, day: number, hour: number, minute = 0): Date =>
  new Date(year, month - 1, day, hour, minute, 0, 0);

// 模擬一週歷史：週一 11-13 是午餐尖峰
function makeBuckets(): VendorHourBucket[] {
  const arr: VendorHourBucket[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const wh = d * 24 + h;
      let orderCount = 0;
      // 平日 11-13 午餐峰
      if (d >= 1 && d <= 5 && h >= 11 && h < 13) orderCount = 12;
      // 平日 7-9 早餐峰
      else if (d >= 1 && d <= 5 && h >= 7 && h < 9) orderCount = 8;
      // 一般營業時段
      else if (d >= 1 && d <= 5 && h >= 9 && h < 17) orderCount = 3;
      arr.push({ weekHour: wh, orderCount, revenue: orderCount * 80 });
    }
  }
  return arr;
}

describe('vendorPredictor / helpers', () => {
  test('currentWeekHour 計算正確', () => {
    expect(currentWeekHour(at(2026, 5, 18, 12))).toBe(1 * 24 + 12); // 週一 12:00
  });

  test('sumOrdersInWindow 累加區間', () => {
    const buckets = [
      { weekHour: 24, orderCount: 5, revenue: 0 },
      { weekHour: 25, orderCount: 10, revenue: 0 },
      { weekHour: 36, orderCount: 12, revenue: 0 },
    ];
    expect(sumOrdersInWindow(buckets, 24, 26)).toBe(15);
    expect(sumOrdersInWindow(buckets, 24, 37)).toBe(27);
    expect(sumOrdersInWindow(buckets, 100, 200)).toBe(0);
  });

  test('findPeakHours 找出 top 15% 時段', () => {
    const peaks = findPeakHours(makeBuckets());
    // 平日 11-12 + 12-13 應該都是 peak
    expect(peaks).toContain(1 * 24 + 11);
    expect(peaks).toContain(1 * 24 + 12);
  });
});

describe('predictVendorStatus / 主入口', () => {
  const history: VendorHistory = {
    weeklyAverage: makeBuckets(),
    sampleWeeks: 4,
  };

  test('樣本不足 → insufficient_data', () => {
    const noHistory: VendorHistory = { weeklyAverage: [], sampleWeeks: 1 };
    const v = predictVendorStatus(noHistory, {
      hourlyOrders: [],
      now: at(2026, 5, 18, 12),
    });
    expect(v.kind).toBe('insufficient_data');
  });

  test('on_track / peak_ending: 週一 12:00 累積跟歷史一致', () => {
    // 歷史 週一 0-12:00 累積 = 0*7 + 8*2 + 3*3 + 12 = 37
    const todayHourly: VendorHourBucket[] = [
      { weekHour: 1 * 24 + 7, orderCount: 8, revenue: 0 },
      { weekHour: 1 * 24 + 8, orderCount: 8, revenue: 0 },
      { weekHour: 1 * 24 + 9, orderCount: 3, revenue: 0 },
      { weekHour: 1 * 24 + 10, orderCount: 3, revenue: 0 },
      { weekHour: 1 * 24 + 11, orderCount: 12, revenue: 0 },
      { weekHour: 1 * 24 + 12, orderCount: 12, revenue: 0 },
    ];
    const v = predictVendorStatus(history, {
      hourlyOrders: todayHourly,
      now: at(2026, 5, 18, 12),
    });
    // 12:00 是 peak、13:00 不是 → peak_ending
    expect(['on_track', 'peak_ending']).toContain(v.kind);
  });

  test('overperforming: 累積超過歷史 30%', () => {
    const todayHourly: VendorHourBucket[] = [
      { weekHour: 1 * 24 + 9, orderCount: 20, revenue: 0 },
      { weekHour: 1 * 24 + 10, orderCount: 18, revenue: 0 },
    ];
    const v = predictVendorStatus(history, {
      hourlyOrders: todayHourly,
      now: at(2026, 5, 18, 10),
    });
    expect(['overperforming', 'unusual_pattern']).toContain(v.kind);
    expect(v.evidence.deviationPercent).toBeGreaterThan(15);
  });

  test('underperforming: 累積低於歷史 30%', () => {
    const todayHourly: VendorHourBucket[] = [
      { weekHour: 1 * 24 + 9, orderCount: 1, revenue: 0 },
    ];
    const v = predictVendorStatus(history, {
      hourlyOrders: todayHourly,
      now: at(2026, 5, 18, 10),
    });
    expect(['underperforming', 'unusual_pattern']).toContain(v.kind);
  });

  test('unusual_pattern: 異常高（爆量）', () => {
    const todayHourly: VendorHourBucket[] = [
      { weekHour: 1 * 24 + 9, orderCount: 50, revenue: 0 },
      { weekHour: 1 * 24 + 10, orderCount: 60, revenue: 0 },
    ];
    const v = predictVendorStatus(history, {
      hourlyOrders: todayHourly,
      now: at(2026, 5, 18, 10),
    });
    expect(v.kind).toBe('unusual_pattern');
    expect(v.evidence.deviationPercent).toBeGreaterThan(50);
  });

  test('預測下一小時數值合理', () => {
    const todayHourly: VendorHourBucket[] = [
      { weekHour: 1 * 24 + 10, orderCount: 3, revenue: 0 },
    ];
    const v = predictVendorStatus(history, {
      hourlyOrders: todayHourly,
      now: at(2026, 5, 18, 10),
    });
    // 11:00 歷史是 12 單
    expect(v.evidence.expectedNextHour).toBe(12);
  });
});
