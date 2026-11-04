import { runOfflineCampusTool } from '../../services/offlineCampusTools';
import type { OnDeviceSchoolContext } from '../../services/onDeviceSchoolContext';
import type { CampusSenseSnapshot } from '../../services/campusSenseSnapshot';

const snapshot: OnDeviceSchoolContext = {
  schoolId: 'pu',
  schoolName: '靜宜大學',
  checkedAt: '2026-10-26T01:00:00.000Z', // Monday morning in Taiwan
  timetable: {
    source: 'saved-device-copy',
    updatedAt: '2026-10-25T10:00:00.000Z',
    courses: [
      { name: '資訊管理', day: 1, start: 2, end: 3, room: 'A301' },
      { name: '資料庫', day: 1, start: 6, end: 7, room: 'A302' },
      { name: '程式設計', day: 2, start: 4, end: 5, room: 'B102' },
      { name: '待安排選修', day: 0, start: 0, end: 0 },
    ],
  },
};

test('returns Monday classes from the actual saved timetable in Taiwan timezone', () => {
  const result = runOfflineCampusTool('我今天有哪些課？', snapshot);
  expect(result).toMatchObject({ tool: 'saved-timetable', route: '/timetable' });
  expect(result?.content).toContain('星期一');
  expect(result?.content).toContain('資訊管理');
  expect(result?.content).toContain('資料庫');
  expect(result?.content).toContain('第 2–3 節');
  expect(result?.content).not.toContain('程式設計');
  expect(result?.content).toContain('不是校方即時課務');
});

test('tomorrow correctly advances date and does not include stale Monday lessons', () => {
  const result = runOfflineCampusTool('明天課表', snapshot);
  expect(result?.content).toContain('星期二');
  expect(result?.content).toContain('程式設計');
  expect(result?.content).not.toContain('資訊管理');
});

test('computes only gaps between known lessons, not arbitrary free time', () => {
  const result = runOfflineCampusTool('今天有沒有空堂？', snapshot);
  expect(result?.content).toContain('第 4–5 節');
  expect(result?.content).not.toContain('第 1 節');
  expect(result?.content).not.toContain('第 8 節');
});

test('shows an evidence-based weekly overview and does not invent clock times', () => {
  const result = runOfflineCampusTool('這週課表有幾堂？', snapshot);
  expect(result?.content).toContain('星期一：2 堂');
  expect(result?.content).toContain('星期二：1 堂');
  expect(result?.content).toContain('星期三：副本未排定課程');
  expect(result?.content).not.toContain('08:10');
});

test('missing personal cache is not claimed to be an empty school schedule', () => {
  const result = runOfflineCampusTool('今天有課嗎？', {
    ...snapshot, timetable: { source: 'not-available', updatedAt: null, courses: [] },
  });
  expect(result?.content).toContain('沒有可確認的個人課表副本');
  expect(result?.content).not.toContain('沒課');
});

test('online-only announcements and actions cannot be fabricated in offline mode', () => {
  const announcements = runOfflineCampusTool('查最新校園公告', snapshot);
  expect(announcements).toMatchObject({ tool: 'online-required', route: '/announcements' });
  expect(announcements?.content).toContain('需要正式資料來源');
  const write = runOfflineCampusTool('幫我送出請假申請', snapshot);
  expect(write).toMatchObject({ tool: 'open-service', route: '/classroom' });
  expect(write?.content).toContain('沒有建立任何申請或付款');
  expect(runOfflineCampusTool('幫我完成報告大綱', snapshot)).toBeNull();
});

test('never treats an unscheduled course as a class on Sunday', () => {
  const sunday = { ...snapshot, checkedAt: '2026-11-01T01:00:00.000Z' };
  const result = runOfflineCampusTool('今天有課嗎？', sunday);
  expect(result?.content).toContain('星期日');
  expect(result?.content).toContain('副本沒有排定這一天');
  expect(result?.content).not.toContain('待安排選修');
});

test('routes each live personal status to its own service instead of the generic classroom', () => {
  expect(runOfflineCampusTool('我有幾份作業還沒交', snapshot))
    .toMatchObject({ tool: 'online-required', route: '/classroom' });
  expect(runOfflineCampusTool('幫我查宿舍報修進度', snapshot))
    .toMatchObject({ tool: 'online-required', route: '/dormitory' });
  expect(runOfflineCampusTool('我的訂單狀態', snapshot))
    .toMatchObject({ tool: 'online-required', route: '/cafeteria' });
  expect(runOfflineCampusTool('我的圖書借閱紀錄', snapshot))
    .toMatchObject({ tool: 'online-required', route: '/library' });
  expect(runOfflineCampusTool('這週有什麼校園活動', snapshot))
    .toMatchObject({ tool: 'online-required', route: '/events' });
});

test('does not invent current weather when offline', () => {
  const result = runOfflineCampusTool('今天的天氣如何？', snapshot);
  expect(result).toMatchObject({ tool: 'online-required' });
  expect(result?.content).toContain('需要正式資料來源');
  expect(result?.route).toBeUndefined();
});

test('reports saved classes beyond the first eight instead of falsely claiming no class', () => {
  const more = Array.from({ length: 9 }, (_, index) => ({
    name: `星期一課程${index}`, day: 1, start: index + 1, end: index + 1,
  }));
  const large = {
    ...snapshot,
    timetable: {
      ...snapshot.timetable,
      courses: [
        ...more,
        { name: '最後一門星期五課程', day: 5, start: 5, end: 6 },
      ],
    },
  } as OnDeviceSchoolContext;
  const friday = runOfflineCampusTool('星期五有哪些課', large);
  expect(friday?.content).toContain('最後一門星期五課程');
  const weekly = runOfflineCampusTool('這週課表', large);
  expect(weekly?.content).toContain('星期五：1 堂');
  expect(weekly?.content).toContain('星期一：9 堂');
});

test('opens known read-only campus services directly without a local model', () => {
  const library = runOfflineCampusTool('幫我開啟圖書館', snapshot);
  expect(library).toMatchObject({ tool: 'open-service', route: '/library' });
  expect(library?.content).toContain('沒有替你送出任何申請');
  expect(runOfflineCampusTool('圖書館怎麼走', snapshot))
    .toMatchObject({ tool: 'open-service', route: '/map' });
  expect(runOfflineCampusTool('打開我的課表', snapshot))
    .toMatchObject({ tool: 'open-service', route: '/timetable' });
  // A destructive screen is not on the no-model navigation allowlist.
  expect(runOfflineCampusTool('幫我刪除帳號', snapshot)).toBeNull();
});

test('offline local data checks take precedence over navigation shortcuts', () => {
  expect(runOfflineCampusTool('幫我查最新校園公告', snapshot))
    .toMatchObject({ tool: 'online-required', route: '/announcements' });
  expect(runOfflineCampusTool('幫我查宿舍報修進度', snapshot))
    .toMatchObject({ tool: 'online-required', route: '/dormitory' });
});

const authorizedSense: CampusSenseSnapshot = {
  userId: 'alice',
  schoolId: 'pu',
  checkedAt: snapshot.checkedAt,
  schedule: { status: 'unavailable', count: null },
  assignments: {
    status: 'available',
    count: 9,
    items: [
      { title: '資料庫期末報告', groupName: '資料庫', dueAt: '2026-10-30T09:00:00Z' },
      { title: '程式設計練習', groupName: '程式設計', dueAt: null },
    ],
  },
  announcements: {
    status: 'available',
    items: [{ title: '校園網路維護公告', publishedAt: '2026-10-25T01:00:00Z' }],
  },
};

test('uses an explicitly synced snapshot for factual offline agent tools', () => {
  const pending = runOfflineCampusTool('我還有哪些作業待交？', snapshot, authorizedSense, 'alice');
  expect(pending).toMatchObject({ tool: 'campus-snapshot', route: '/classroom' });
  expect(pending?.content).toContain('資料庫期末報告');
  expect(pending?.content).toContain('9 筆');
  expect(pending?.content).toContain('非即時查詢');
  expect(pending?.content).not.toContain('即時已更新');

  const notice = runOfflineCampusTool('有哪些校園公告？', snapshot, authorizedSense, 'alice');
  expect(notice).toMatchObject({ tool: 'campus-snapshot', route: '/announcements' });
  expect(notice?.content).toContain('校園網路維護公告');
});

test('produces a source-aware daily summary without calling an LLM', () => {
  const result = runOfflineCampusTool('我今天要做什麼？', snapshot, authorizedSense, 'alice');
  expect(result?.tool).toBe('campus-plan');
  expect(result?.content).toContain('程式設計練習');
  expect(result?.content).toContain('核對最新校園通知');
  expect(result?.content).toContain('上次主動同步');
  expect(result?.content).toContain('今日手機課表副本');
  expect(result?.content).toContain('建議下一步');
  const alternate = runOfflineCampusTool('今天要先處理什麼？', snapshot, authorizedSense, 'alice');
  expect(alternate?.tool).toBe('campus-plan');
});

test('never uses a snapshot for a different campus, stale timestamp, or unavailable reader', () => {
  const other = runOfflineCampusTool('我還有哪些作業待交？', snapshot, {
    ...authorizedSense, schoolId: 'different-school',
  }, 'alice');
  expect(other?.tool).toBe('online-required');

  const stale = runOfflineCampusTool('我還有哪些作業待交？', snapshot, {
    ...authorizedSense, checkedAt: '2026-10-25T01:00:00.000Z',
  }, 'alice');
  expect(stale?.tool).toBe('online-required');

  const unavailable = runOfflineCampusTool('我還有哪些作業待交？', snapshot, {
    ...authorizedSense, assignments: { status: 'unavailable', count: null, items: [] },
  }, 'alice');
  expect(unavailable?.tool).toBe('online-required');
});

test('does not silently replace timetable planning with a literal course list', () => {
  expect(runOfflineCampusTool('請依我的課表幫我規劃下週的學習計畫', snapshot))
    .toBeNull();
});

describe('scoped deadline reads', () => {
  // Saturday evening UTC is Sunday morning in Taiwan.
  const checkedAt = '2026-10-31T16:10:00Z';
  const context = { ...snapshot, checkedAt };
  const task = (title: string, dueAt: string | null) => ({ title, groupName: '資料庫', dueAt });
  const sunday = task('週日截止', '2026-11-01T15:59:59Z');
  const monday = task('週一零點截止', '2026-11-01T16:00:00Z');
  const previous = task('週日已過期', '2026-10-31T16:09:00Z');
  const source = {
    ...authorizedSense, checkedAt,
    assignments: {
      status: 'available' as const, count: 8,
      items: [monday, task('未確認', null), sunday, task('無時區', '2026-11-02T09:00:00'), previous],
    },
  };
  const read = (question: string, uid = 'alice', filter?: string) =>
    runOfflineCampusTool(question, context, source, uid, filter);

  test('明天 only returns Taiwan Monday deadlines and distinguishes unknown dates from unread rows', () => {
    const answer = read('明天有哪些作業截止？');
    expect(answer?.assignmentRead).toEqual({
      checkedAt, filterQuestion: '明天有哪些作業截止？', userId: 'alice', schoolId: 'pu', items: [monday],
    });
    expect(answer?.content).toContain('1. 週一零點截止');
    expect(answer?.content).not.toContain('週日截止');
    expect(answer?.content).toContain('2 筆截止時間未確認');
    expect(answer?.content).toContain('3 筆尚未同步');
  });

  test('overdue, undated and still-open queries return only rows with the matching deadline status', () => {
    expect(read('有哪些逾期作業？')?.assignmentRead?.items).toEqual([previous]);
    expect(read('有哪些尚未逾期作業？')?.assignmentRead?.items).toEqual([sunday, monday]);
    expect(read('沒有截止日期的作業有哪些？')?.assignmentRead?.items.map((row) => row.title))
      .toEqual(['未確認', '無時區']);
  });

  test('今天 includes earlier deadlines today; the next seven days start now and do not trigger the planner', () => {
    expect(read('今天有哪些作業？')?.assignmentRead?.items).toEqual([previous, sunday]);
    expect(read('未來七天有哪些作業截止？')?.assignmentRead?.items).toEqual([sunday, monday]);
    expect(read('下週有哪些作業？')?.assignmentRead?.items).toEqual([monday]);
  });

  test('respects source and keeps the original assignment filter on an immediate date follow-up', () => {
    expect(read('那明天呢？', 'alice', '資料庫的作業有哪些？')?.assignmentRead).toMatchObject({
      filterQuestion: '資料庫的作業有哪些？', items: [monday],
    });
    for (const uid of ['', 'other-user']) {
      const result = read('明天有哪些作業截止？', uid);
      expect(result?.tool).toBe('online-required');
      expect(result?.assignmentRead).toBeUndefined();
      expect(result?.content).not.toContain(monday.title);
    }
  });

  test.each(['今天到明天', '下下週', '本週五以前', '明天下午'])('%s does not silently narrow the requested period', (date) => {
    const result = read(date + '有哪些作業截止？');
    expect(result?.content).toContain('想查哪一天');
    expect(result?.assignmentRead?.items).toEqual([]);
  });

  test('a specific weekday and weekend stay within the requested week', () => {
    expect(read('下週一有哪些作業？')?.assignmentRead?.items).toEqual([monday]);
    expect(read('本週末有哪些作業？')?.assignmentRead?.items).toEqual([previous, sunday]);
  });
});

test('a missing summary directs a named deadline question to the source without exposing rows', () => {
  const reply = runOfflineCampusTool('期中報告什麼時候交？', snapshot, null, 'alice');
  expect(reply?.tool).toBe('online-required');
  expect(reply?.content).toContain('同步校園資料');
  expect(reply?.assignmentRead).toBeUndefined();
});

test.each(['幫我把作業翻譯成英文', '解釋截止日是什麼意思', '今天圖書館借閱截止到幾點'])(
  'does not divert an unrelated task into an assignment lookup: %s', (question) => {
    expect(runOfflineCampusTool(question, snapshot, authorizedSense, 'alice')).toBeNull();
    expect(runOfflineCampusTool(question, snapshot)).toBeNull();
  },
);

test('explicit homework writes and reminders do not produce an assignment list', () => {
  for (const question of ['幫我繳交這份作業', '幫我設定作業提醒', '提醒我交作業']) {
    const reply = runOfflineCampusTool(question, snapshot, authorizedSense, 'alice');
    expect(reply?.tool).toBe('open-service');
    expect(reply?.assignmentRead).toBeUndefined();
  }
});

test('a weekday in a known assignment title is not its deadline filter', () => {
  const named = { title: '星期一報告', groupName: '資管', dueAt: '2026-10-30T09:00:00Z' }; // Friday
  const source = { ...authorizedSense, assignments: {
    ...authorizedSense.assignments, count: 3, items: [named, ...authorizedSense.assignments.items],
  } };
  const result = runOfflineCampusTool('星期一報告什麼時候交？', snapshot, source, 'alice');
  expect(result?.assignmentRead?.items).toEqual([named]);
});

test('a date clarification preserves the course when the next message replaces only the date', () => {
  const source = { ...authorizedSense, assignments: { ...authorizedSense.assignments, count: 2, items: [
    { title: '查詢練習', groupName: '資料庫', dueAt: '2026-10-27T10:00:00Z' },
    { title: '閱讀心得', groupName: '英文', dueAt: '2026-10-27T10:00:00Z' },
  ] } };
  const first = runOfflineCampusTool('資料庫作業從今天到明天有哪些？', snapshot, source, 'alice');
  expect(first?.assignmentRead?.items).toEqual([]);
  const answer = runOfflineCampusTool('明天有哪些作業？', snapshot, source, 'alice', first?.assignmentRead?.filterQuestion);
  expect(answer?.assignmentRead?.items).toEqual([source.assignments.items[0]]);
});

test.each(['校園活動計畫', '翻譯練習', '公告設計'])('quoted title %s stays a deadline query', (title) => {
  const named = { title, groupName: '資管', dueAt: '2026-10-30T09:00:00Z' };
  const source = { ...authorizedSense, assignments: {
    ...authorizedSense.assignments, count: 3, items: [named, ...authorizedSense.assignments.items],
  } };
  const reply = runOfflineCampusTool('「' + title + '」這份作業什麼時候交？', snapshot, source, 'alice');
  expect(reply?.assignmentRead?.items).toEqual([named]);
});
