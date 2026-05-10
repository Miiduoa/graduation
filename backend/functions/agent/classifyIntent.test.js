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
});
