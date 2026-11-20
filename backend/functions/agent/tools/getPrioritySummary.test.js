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

  test('最近一份作業的截止時間用台灣時間', async () => {
    const out = await getPrioritySummary.execute(
      { prefetched: { assignments: [{ title: 'HW2', dueAt: new Date('2026-10-12T18:35:00Z') }] } },
      {},
    );
    expect(out.nextAssignmentDue).toBe('10 月 13 日（二）02:35');
  });
});
