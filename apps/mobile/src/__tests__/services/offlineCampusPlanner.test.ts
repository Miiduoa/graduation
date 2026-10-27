import { buildOfflineCampusPlan } from '../../services/offlineCampusPlanner';
import type { CampusSenseSnapshot } from '../../services/campusSenseSnapshot';
import type { OnDeviceSchoolContext } from '../../services/onDeviceSchoolContext';

const context: OnDeviceSchoolContext = {
  checkedAt: '2026-10-26T01:00:00.000Z', // 09:00 Monday, Taiwan
  schoolId: 'pu',
  schoolName: '靜宜大學',
  timetable: {
    source: 'saved-device-copy',
    updatedAt: '2026-10-25T10:00:00.000Z',
    courses: [
      { name: '資料庫', day: 1, start: 2, end: 3, room: 'A301' },
      { name: '網頁程式設計', day: 1, start: 6, end: 7, room: 'A302' },
      { name: '網路概論', day: 2, start: 4, end: 5, room: 'B302' },
      { name: '未排入課表', day: 0, start: 0, end: 0 },
    ],
  },
};

const snapshot: CampusSenseSnapshot = {
  userId: 'A',
  schoolId: 'pu',
  checkedAt: '2026-10-26T01:00:00.000Z',
  schedule: { status: 'unavailable', count: null },
  assignments: {
    status: 'available',
    count: 3,
    items: [
      { title: '七天後作業', groupName: '程式設計', dueAt: '2026-11-02T10:00:00Z' },
      { title: '明天小考複習', groupName: '資料庫', dueAt: '2026-10-26T12:00:00Z' },
      { title: '作業缺截止日', groupName: '網路概論', dueAt: null },
    ],
  },
  announcements: {
    status: 'available',
    items: [{ title: '圖書館維護公告', publishedAt: '2026-10-25T03:00:00Z' }],
  },
};

function plan(
  question: string,
  updates: Partial<{
    context: OnDeviceSchoolContext;
    snapshot: CampusSenseSnapshot | null;
    uid: string;
  }> = {},
) {
  return buildOfflineCampusPlan({
    question,
    context: updates.context ?? context,
    snapshot: updates.snapshot === undefined ? snapshot : updates.snapshot,
    uid: updates.uid ?? 'A',
  });
}

test('prioritizes real deadlines, known course slots, and evidence without a model', () => {
  const result = plan('今天要先處理什麼？');
  expect(result).toBeTruthy();
  expect(result?.title).toBe('今日優先行動');
  expect(result?.steps[0]).toMatchObject({
    title: '明天小考複習',
    priority: 'urgent',
    evidence: 'authorized-assignments',
    route: '/classroom',
  });
  expect(result?.steps.find((step) => step.evidence === 'saved-timetable')).toMatchObject({
    title: '今日手機課表副本｜星期一',
    route: '/timetable',
  });
  expect(result?.content).toContain('第 4–5 節空檔');
  expect(result?.content).toContain('上次主動同步');
  expect(result?.content).toContain('沒有替你提交');
  expect(result?.content).not.toContain('七天後作業');
  expect(result?.steps.some((step) => step.evidence === 'authorized-announcements')).toBe(true);
});

test('a seven-day plan can include later deadlines but never invent clock times from period indexes', () => {
  const result = plan('幫我安排接下來七天的學習計畫');
  expect(result?.title).toBe('接下來七天的學習行動');
  expect(result?.steps[0].title).toBe('明天小考複習');
  expect(result?.steps.some((step) => step.title === '作業缺截止日')).toBe(true);
  expect(result?.content).not.toContain('08:10');
  expect(result?.content).toContain('實際鐘點');
});

test('a timetable-only plan uses verified local data but not stale or cross-user personal snapshots', () => {
  const cases = [
    { uid: 'B' },
    { snapshot: { ...snapshot, schoolId: 'other-school' } },
    { snapshot: { ...snapshot, checkedAt: '2026-10-25T01:00:00.000Z' } },
    { snapshot: null },
  ];
  for (const item of cases) {
    const result = plan('請依我的課表安排本週複習', item);
    expect(result?.steps.some((step) => step.evidence === 'authorized-assignments')).toBe(false);
    expect(result?.content).not.toContain('明天小考複習');
    expect(result?.steps.some((step) => step.evidence === 'saved-timetable')).toBe(true);
    expect(result?.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining('無法判定是否有作業待交'),
    ]));
  }
});

test('missing all trustworthy local context falls through rather than fabricating a plan', () => {
  const none: OnDeviceSchoolContext = {
    ...context, timetable: { source: 'not-available', updatedAt: null, courses: [] },
  };
  expect(plan('幫我規劃本週學習計畫', { context: none, snapshot: null })).toBeNull();
  expect(plan('直接送出作業並安排課表')).toBeNull();
  expect(plan('今天幾點有課？')).toBeNull();
});

test('overdue and unknown-deadline tasks are labeled for verification, not as completed', () => {
  const modified: CampusSenseSnapshot = {
    ...snapshot,
    assignments: {
      status: 'available',
      count: 7,
      items: [
        { title: '期限已過的任務', groupName: 'A', dueAt: '2026-10-24T12:00:00Z' },
        { title: '未提供截止的任務', groupName: 'B', dueAt: null },
      ],
    },
  };
  const result = plan('今天的待辦優先順序', { snapshot: modified });
  expect(result?.steps[0]).toMatchObject({
    title: '期限已過的任務',
    priority: 'overdue',
  });
  expect(result?.steps[1]).toMatchObject({
    title: '未提供截止的任務',
    priority: 'verify',
  });
  expect(result?.limitations).toEqual(expect.arrayContaining([
    expect.stringContaining('僅同步部分作業摘要'),
  ]));
  expect(result?.content).not.toContain('已完成');
});

test('prevents previous accounts and other campuses from leaking even when names look relevant', () => {
  const other = {
    ...snapshot,
    userId: 'different-user',
    assignments: {
      status: 'available' as const,
      count: 1,
      items: [{ title: '其他人私人作業', groupName: '秘密', dueAt: null }],
    },
  };
  const result = plan('今天要先處理什麼', { snapshot: other });
  expect(result?.content).not.toContain('其他人私人作業');
  expect(result?.steps.every((step) => step.evidence !== 'authorized-assignments')).toBe(true);
});

test('planning is deterministic and does not mutate the original snapshot ordering', () => {
  const before = JSON.stringify(snapshot);
  const first = plan('今天要先處理什麼？');
  const second = plan('今天要先處理什麼？');
  expect(first).toEqual(second);
  expect(JSON.stringify(snapshot)).toBe(before);
});

test('next-week scheduling uses Taiwan weekdays, never treating an unscheduled course as Sunday class', () => {
  const result = plan('請規劃下週課表與讀書計畫');
  expect(result?.title).toBe('下週學習行動');
  expect(result?.steps.find((step) => step.evidence === 'saved-timetable')?.detail).toContain('資料庫');
  expect(result?.content).not.toContain('未排入課表');
});
