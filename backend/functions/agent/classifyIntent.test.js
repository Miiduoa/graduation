'use strict';

const { classifyIntent } = require('./classifyIntent');

describe('classifyIntent', () => {
  test('rich: announcements keyword + pattern yields 0~1 confidence', () => {
    const r = classifyIntent('今天有什麼公告？');
    expect(r.name).toBe('announcements');
    expect(r.source).toBe('rich');
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.confidence).toBeLessThanOrEqual(1);
    expect(r.rawScore).toBeGreaterThan(0);
  });

  test('rich: food maps to menus with subIntent metadata', () => {
    const r = classifyIntent('午餐想吃點清淡的，有推薦嗎？');
    expect(r.name).toBe('menus');
    expect(r.source).toBe('rich');
    expect(r.category).toBe('food');
    expect(['recommend', 'dietary']).toContain(r.subIntent);
    expect(r.confidence).toBeGreaterThan(0.4);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  test('keyword_fallback: general has capped confidence', () => {
    const r = classifyIntent('嗯');
    expect(r.name).toBe('general');
    expect(r.source).toBe('keyword_fallback');
    expect(r.confidence).toBeLessThan(0.62);
  });

  test('richRaw linear cap: max score maps to 1', () => {
    const r = classifyIntent('想吃推薦便宜素食有哪些訂餐排隊');
    expect(r.name).toBe('menus');
    expect(r.source).toBe('rich');
    expect(r.confidence).toBe(1);
  });

  test('rich: teacher approval question maps to leave_status', () => {
    const r = classifyIntent('老師有審核了嗎');
    expect(r.name).toBe('leave_status');
    expect(r.source).toBe('rich');
    expect(r.category).toBe('leave_status');
  });

  test('leave_status: 請假通過了嗎', () => {
    const r = classifyIntent('請假通過了嗎');
    expect(r.name).toBe('leave_status');
  });

  test('rich: library seat reservation maps to reserve_seat', () => {
    const r = classifyIntent('幫我明天早上九點在圖書館三樓預約一個座位');
    expect(r.name).toBe('reserve_seat');
    expect(r.source).toBe('rich');
  });

  test('keyword_fallback: food_order', () => {
    const r = classifyIntent('幫我在學生餐廳點一份雞排飯跟一杯紅茶');
    expect(r.name).toBe('food_order');
  });

  test('查看報修狀態 maps to check_repair_status (keyword_fallback)', () => {
    const r = classifyIntent('查看報修狀態');
    expect(r.name).toBe('check_repair_status');
  });

  test('幫我宿舍冷氣報修 maps to submit_repair_request (keyword_fallback)', () => {
    const r = classifyIntent('幫我宿舍冷氣報修');
    expect(r.name).toBe('submit_repair_request');
  });
});
