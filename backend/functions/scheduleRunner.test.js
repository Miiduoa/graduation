'use strict';

const { cronMatches, intervalMsForSchedule } = require('./scheduleRunner');

describe('scheduleRunner', () => {
  test('parses every-N interval schedules', () => {
    expect(intervalMsForSchedule('every 5 minutes')).toBe(5 * 60 * 1000);
    expect(intervalMsForSchedule('every 1 hours')).toBe(60 * 60 * 1000);
    expect(intervalMsForSchedule('30 7 * * *')).toBeNull();
  });

  test('matches Taipei cron expressions', () => {
    const sevenThirty = new Date('2026-10-12T23:30:00Z');
    expect(cronMatches('30 7 * * *', sevenThirty, 'Asia/Taipei')).toBe(true);
    expect(cronMatches('0 22 * * 0', sevenThirty, 'Asia/Taipei')).toBe(false);

    const sundayNight = new Date('2026-10-11T14:00:00Z');
    expect(cronMatches('0 22 * * 0', sundayNight, 'Asia/Taipei')).toBe(true);
  });
});
