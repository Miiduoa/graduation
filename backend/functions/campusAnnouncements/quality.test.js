'use strict';

const {
  announcementQualityFlags,
  chineseDisplayTitle,
  parseAnnouncementDate,
  selectOfficialAnnouncements,
  selectStudentAnnouncements,
  tallyStudentWallFilter,
  studentWallStartUtc,
} = require('./quality');

const NOW = new Date('2026-10-18T00:00:00.000Z');

test('ROC title dates parse and scrape-time is never invented', () => {
  expect(parseAnnouncementDate('[115.09.18]機車通行證抽籤結果')).toBe('2026-09-18T00:00:00.000Z');
  expect(parseAnnouncementDate('')).toBeNull();
  expect(parseAnnouncementDate('選課公告')).toBeNull();
});

test('student titles keep Chinese and drop English tails', () => {
  expect(
    chineseDisplayTitle(
      '115學年度第1學期點名計分單下載及教材上傳相關事宜Download of Class Roll Call List and upload of teaching materials(for教師)',
    ),
  ).toBe('115學年度第1學期點名計分單下載及教材上傳相關事宜');
});

test('student wall hides static, staff, broadcast, security alerts and off-season controls', () => {
  expect(announcementQualityFlags({ title: '教務章則' }, NOW).studentFeed).toBe(false);
  expect(announcementQualityFlags({ title: '歷屆優良教師名單' }, NOW).studentFeed).toBe(false);
  expect(
    announcementQualityFlags({ title: '116學年度抵免細則修訂通知(for學系)' }, NOW).studentFeed,
  ).toBe(false);
  expect(
    announcementQualityFlags(
      { title: '國立教育廣播電臺新設Channel+網站，歡迎線上收聽！' },
      NOW,
    ).studentFeed,
  ).toBe(false);
  expect(
    announcementQualityFlags(
      {
        title: '【漏洞預警】Cisco License 存在重大資安漏洞',
        office: '計算機與網路中心',
        schoolId: 'ncku',
      },
      NOW,
    ).studentFeed,
  ).toBe(false);
  expect(
    announcementQualityFlags({ title: '114學年度機車通行證申請通告' }, NOW).studentFeed,
  ).toBe(false);
  expect(
    announcementQualityFlags(
      { title: '115學年度第1學期學生選課清單列印', publishedAt: '2026-09-28T00:00:00.000Z' },
      NOW,
    ).studentFeed,
  ).toBe(true);
});

test('NCKU missing 公告單位 is labeled 全校', () => {
  expect(
    announcementQualityFlags({ title: '全校活動', schoolId: 'ncku', sourceOffice: '全校最新消息' })
      .office,
  ).toBe('全校');
});

test('student wall start is the earlier of 90 days and this semester', () => {
  expect(studentWallStartUtc(NOW).toISOString().startsWith('2026-07-20')).toBe(true);
});

test('selectStudentAnnouncements does not treat down-source scrape rows as current news', () => {
  const rows = [
    {
      id: 'old',
      title: '選課公告',
      publishedAt: '2026-10-01T00:00:00.000Z',
      origin: 'public_scrape',
      sourceId: 'pu-acd',
    },
    {
      id: 'keep',
      title: '宿舍申請',
      publishedAt: '2026-10-08T00:00:00.000Z',
      origin: 'public_scrape',
      sourceId: 'pu-osa',
    },
  ];
  expect(
    selectStudentAnnouncements(
      rows,
      [
        { sourceId: 'pu-acd', status: 'unavailable' },
        { sourceId: 'pu-osa', status: 'healthy' },
      ],
      NOW,
    ).map((row) => row.id),
  ).toEqual(['keep']);
});

test('undated and future rows stay out of both lists; staff and security stay in 全部公告', () => {
  const rows = [
    { id: 'keep', title: '選課公告', publishedAt: '2026-10-08T00:00:00.000Z' },
    { id: 'none', title: '無日期稿' },
    { id: 'future', title: '未來稿', publishedAt: '2099-01-01T00:00:00.000Z' },
    {
      id: 'sec',
      title: '【漏洞預警】Cisco License 存在重大資安漏洞',
      publishedAt: '2026-10-08T00:00:00.000Z',
      office: '計算機與網路中心',
    },
    { id: 'staff', title: '點名計分單(for教師)', publishedAt: '2026-10-08T00:00:00.000Z' },
  ];
  expect(announcementQualityFlags({ title: '無日期稿' }, NOW)).toMatchObject({
    studentFeed: false,
    visible: false,
  });
  expect(
    announcementQualityFlags({ title: '未來稿', publishedAt: '2099-01-01T00:00:00.000Z' }, NOW),
  ).toMatchObject({ studentFeed: false, visible: false });
  expect(
    announcementQualityFlags(
      {
        title: '【漏洞預警】Cisco License 存在重大資安漏洞',
        office: '計算機與網路中心',
        publishedAt: '2026-10-08T00:00:00.000Z',
      },
      NOW,
    ),
  ).toMatchObject({ studentFeed: false, visible: true });
  expect(selectStudentAnnouncements(rows, [], NOW).map((row) => row.id)).toEqual(['keep']);
  expect(selectOfficialAnnouncements(rows, [], NOW).map((row) => row.id)).toEqual([
    'keep',
    'sec',
    'staff',
  ]);
  expect(tallyStudentWallFilter(rows, [], NOW)).toEqual({
    input: 5,
    kept: 1,
    duplicate: 0,
    hidden: 0,
    excluded: 0,
    no_date: 1,
    future_date: 1,
    stale_source: 0,
    non_announcement: 0,
    staff: 1,
    security: 1,
    off_season: 0,
    outside_wall: 0,
  });
});

test('preserves audience and visibility decisions after source titles are shortened for display', () => {
  const staff = {
    id: 'staff',
    ...announcementQualityFlags({
      title: '教師研習報名通知(for教師)', publishedAt: '2026-10-08T00:00:00.000Z',
    }, NOW),
  };
  expect(staff.title).toBe('教師研習報名通知');
  expect(staff).toMatchObject({ audience: 'staff', studentFeed: false, visible: true });
  const rows = [
    { id: 'legacy', title: '學生交流活動', publishedAt: '2026-10-08T00:00:00.000Z' },
    staff,
    { id: 'excluded', title: '其他公開資訊', publishedAt: '2026-10-08T00:00:00.000Z', studentFeed: false, visible: true },
    { id: 'hidden', title: '已撤下公告', publishedAt: '2026-10-08T00:00:00.000Z', visible: false, studentFeed: true },
    { id: 'legacy-staff', title: '課程名冊(for教師)', publishedAt: '2026-10-08T00:00:00.000Z' },
  ];
  expect(selectStudentAnnouncements(rows, [], NOW).map((row) => row.id)).toEqual(['legacy']);
  expect(selectOfficialAnnouncements(rows, [], NOW).map((row) => row.id)).toEqual(['legacy', 'staff', 'excluded', 'legacy-staff']);
  expect(tallyStudentWallFilter(rows, [], NOW)).toMatchObject({ kept: 1, staff: 2, excluded: 1, hidden: 1 });
});

test('explicit staff audience wins even when studentFeed was not supplied', () => {
  const row = { id: 'staff', title: '教職員研習', publishedAt: '2026-10-08T00:00:00.000Z', audience: 'staff' };
  expect(selectStudentAnnouncements([row], [], NOW)).toEqual([]);
  expect(selectOfficialAnnouncements([row], [], NOW)).toEqual([row]);
});
