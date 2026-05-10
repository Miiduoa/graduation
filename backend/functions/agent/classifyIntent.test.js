'use strict';

const { classifyIntent } = require('./classifyIntent');

describe('classifyIntent', () => {
  test('maps announcements keyword', () => {
    const r = classifyIntent('今天有什麼公告？');
    expect(r.name).toBe('announcements');
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  test('general has lower confidence', () => {
    const r = classifyIntent('嗯');
    expect(r.name).toBe('general');
    expect(r.confidence).toBeLessThan(0.7);
  });
});
