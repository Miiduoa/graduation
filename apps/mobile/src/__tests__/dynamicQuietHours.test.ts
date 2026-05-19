import {
  isInDynamicQuietHours,
  isHourInWindow,
  isInStaticNight,
  currentWeekSlotIndex,
  describeWindow,
} from '../services/dynamicQuietHours';

// 以「本地時區」組裝 Date，與 `dynamicQuietHours` 內 `getDay()`／`getHours()` 一致。
const at = (year: number, month: number, day: number, hour: number, minute = 0): Date =>
  new Date(year, month - 1, day, hour, minute, 0, 0);

describe('dynamicQuietHours / helpers', () => {
  test('isInStaticNight: 22-08 視為夜間', () => {
    expect(isInStaticNight(22)).toBe(true);
    expect(isInStaticNight(23)).toBe(true);
    expect(isInStaticNight(0)).toBe(true);
    expect(isInStaticNight(7)).toBe(true);
    expect(isInStaticNight(8)).toBe(false);
    expect(isInStaticNight(14)).toBe(false);
    expect(isInStaticNight(21)).toBe(false);
  });

  test('isHourInWindow: 一般窗口', () => {
    const w = { startHour: 11, endHour: 14 };
    expect(isHourInWindow(11, 1, w)).toBe(true);
    expect(isHourInWindow(13, 1, w)).toBe(true);
    expect(isHourInWindow(14, 1, w)).toBe(false);
    expect(isHourInWindow(10, 1, w)).toBe(false);
  });

  test('isHourInWindow: 跨午夜窗口', () => {
    const w = { startHour: 22, endHour: 6 };
    expect(isHourInWindow(23, 1, w)).toBe(true);
    expect(isHourInWindow(2, 1, w)).toBe(true);
    expect(isHourInWindow(7, 1, w)).toBe(false);
  });

  test('isHourInWindow: days 過濾', () => {
    const w = { startHour: 10, endHour: 12, days: [1, 3, 5] }; // 一三五
    expect(isHourInWindow(11, 1, w)).toBe(true);
    expect(isHourInWindow(11, 2, w)).toBe(false);
  });

  test('currentWeekSlotIndex 計算正確', () => {
    // 2026-05-18 為週一 14:00
    const monday14 = at(2026, 5, 18, 14);
    expect(currentWeekSlotIndex(monday14)).toBe(1 * 24 + 14);
  });

  test('describeWindow 產出可讀字串', () => {
    expect(describeWindow({ startHour: 11, endHour: 14, label: '午餐尖峰' }))
      .toContain('11:00-14:00');
    expect(describeWindow({ startHour: 22, endHour: 6, days: [1, 3] }))
      .toContain('週一、三');
  });
});

describe('dynamicQuietHours / 主入口', () => {
  test('夜間 23:00 → static_night', () => {
    const v = isInDynamicQuietHours({
      role: 'student',
      now: at(2026, 5, 18, 23),
    });
    expect(v.isQuiet).toBe(true);
    expect(v.reason).toBe('static_night');
    expect(v.msUntilOpen).toBeGreaterThan(0);
  });

  test('critical 動作即使夜間也不擋', () => {
    const v = isInDynamicQuietHours({
      role: 'student',
      now: at(2026, 5, 18, 23),
      isCritical: true,
    });
    expect(v.isQuiet).toBe(false);
    expect(v.reason).toBe('open');
  });

  test('學生上課中 → in_class', () => {
    // 週一 14:00 → idx 38
    const busy = new Array(168).fill(false);
    busy[1 * 24 + 14] = true;
    const v = isInDynamicQuietHours({
      role: 'student',
      now: at(2026, 5, 18, 14),
      weeklyBusySlots: busy,
    });
    expect(v.isQuiet).toBe(true);
    expect(v.reason).toBe('in_class');
  });

  test('餐廳午餐尖峰 → meal_peak', () => {
    const v = isInDynamicQuietHours({
      role: 'vendor',
      now: at(2026, 5, 18, 12),
    });
    expect(v.isQuiet).toBe(true);
    expect(v.reason).toBe('meal_peak');
    expect(v.explanation).toContain('午餐');
  });

  test('學生 12:00 用餐時段 → meal_peak', () => {
    const v = isInDynamicQuietHours({
      role: 'student',
      now: at(2026, 5, 18, 12, 30),
    });
    expect(v.isQuiet).toBe(true);
    expect(v.reason).toBe('meal_peak');
  });

  test('學生 19:00（晚上但不在課表也不用餐尖峰） → open', () => {
    const v = isInDynamicQuietHours({
      role: 'student',
      now: at(2026, 5, 18, 19),
    });
    expect(v.isQuiet).toBe(false);
    expect(v.reason).toBe('open');
  });

  test('customWindow 覆寫預設', () => {
    const v = isInDynamicQuietHours({
      role: 'student',
      now: at(2026, 5, 18, 19),
      customWindows: [{ startHour: 18, endHour: 20, label: '健身房' }],
    });
    expect(v.isQuiet).toBe(true);
    expect(v.reason).toBe('custom_window');
    expect(v.explanation).toContain('健身房');
  });

  test('助教 / 主任 沒有用餐尖峰預設', () => {
    const ta = isInDynamicQuietHours({
      role: 'ta',
      now: at(2026, 5, 18, 12, 30),
    });
    expect(ta.isQuiet).toBe(false);

    const dept = isInDynamicQuietHours({
      role: 'department',
      now: at(2026, 5, 18, 12, 30),
    });
    expect(dept.isQuiet).toBe(false);
  });
});
