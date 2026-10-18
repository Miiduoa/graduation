'use strict';

const {
  announcementQualityFlags,
  chineseDisplayTitle,
  parseAnnouncementDate,
  selectStudentAnnouncements,
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
