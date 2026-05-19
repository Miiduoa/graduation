'use strict';

const { parseLeaveDateYmd } = require('./leaveIntentResolve');

describe('parseLeaveDateYmd', () => {
  const tz = 'Asia/Taipei';

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('下禮拜三 when today is 2026-05-10 (Sun, Asia/Taipei) => 2026-05-20', () => {
    jest.setSystemTime(new Date('2026-05-09T16:00:00.000Z'));
    expect(parseLeaveDateYmd('下禮拜三', tz)).toBe('2026-05-20');
  });

  test('下禮拜三 when today is Thursday (2025-05-08, Asia/Taipei) => 2025-05-21', () => {
    jest.setSystemTime(new Date('2025-05-07T16:00:00.000Z'));
    expect(parseLeaveDateYmd('下禮拜三', tz)).toBe('2025-05-21');
  });
});
