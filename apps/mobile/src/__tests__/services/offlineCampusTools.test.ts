import { runOfflineCampusTool } from '../../services/offlineCampusTools';
import type { OnDeviceSchoolContext } from '../../services/onDeviceSchoolContext';

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
