'use strict';

const getPrioritySummary = require('./getPrioritySummary');

describe('getPrioritySummary tool', () => {
  test('summarizes prefetch', async () => {
    const ctx = {
      prefetched: {
        todaySchedule: { slots: [{ name: '微積分' }] },
        assignments: [{ title: 'HW1', dueAt: null }],
        announcements: [{ title: '期末考' }],
      },
    };
    const out = await getPrioritySummary.execute(ctx, {});
    expect(out.classCount).toBe(1);
    expect(out.topAnnouncementTitle).toBe('期末考');
  });
});
