import { afterEach, expect, it, vi } from 'vitest';
import {
  allowsPlaceholderAnnouncementSchools,
  announcementEmptyKind,
  announcementViewPhase,
  announcementMatchesSearch,
  announcementSourceIdsForSchool,
  formatStaleAnnouncementNotice,
  isAnnouncementSchoolVisibleToPublic,
  isPlaceholderAnnouncementSchool,
  chineseDisplayTitle,
  listAnnouncementCatalogLinks,
  mergeAnnouncementsById,
  parseAnnouncementDate,
  selectStudentAnnouncements,
  PLACEHOLDER_ANNOUNCEMENT_SCHOOL_IDS,
  FIRESTORE_UNAVAILABLE_WITH_CACHE_TEXT,
  SOURCE_DOWN_EMPTY_TEXT,
  SOURCE_DOWN_WITH_CACHE_TEXT,
  ANNOUNCEMENT_EMPTY_CONNECTED_TEXT,
  ANNOUNCEMENT_EMPTY_SCHOOL_TEXT,
  ANNOUNCEMENT_OFFICIAL_SITE_BUTTON,
  ANNOUNCEMENT_READ_FAILURE_TEXT,
  ANNOUNCEMENT_RETRY_TEXT,
  announcementEmptyHeading,
  SOURCE_NOT_CONNECTED_TEXT,
  selectOfficialAnnouncements,
  tallyStudentWallFilter,
  verifiedOfficialAnnouncementUrl,
  staleAnnouncementUpdatedAt,
} from '@campus/shared/src/campusAnnouncements';
import { TEMPORARY_UNAVAILABLE_TEXT } from '@campus/shared/src/loadFailureCopy';

afterEach(() => vi.unstubAllEnvs());

it('hides cms-none demo schools unless the environment is explicitly development, preview or test', () => {
  expect(PLACEHOLDER_ANNOUNCEMENT_SCHOOL_IDS).toEqual([
    'tw-demo-uni',
    'tw-taichung-uni-a',
    'tw-taichung-uni-b',
  ]);
  expect(isPlaceholderAnnouncementSchool({ cms: 'none' })).toBe(true);
  expect(isPlaceholderAnnouncementSchool({ schoolId: 'tw-demo-uni' })).toBe(true);
  expect(isPlaceholderAnnouncementSchool({ schoolId: 'pu', cms: 'iweb' })).toBe(false);
  expect(allowsPlaceholderAnnouncementSchools(undefined)).toBe(false);
  expect(allowsPlaceholderAnnouncementSchools('')).toBe(false);
  expect(allowsPlaceholderAnnouncementSchools('staging')).toBe(false);
  expect(allowsPlaceholderAnnouncementSchools('production')).toBe(false);
  expect(isAnnouncementSchoolVisibleToPublic({ schoolId: 'tw-demo-uni' })).toBe(false);
  expect(isAnnouncementSchoolVisibleToPublic({ schoolId: 'tw-demo-uni' }, '')).toBe(false);
  expect(isAnnouncementSchoolVisibleToPublic({ schoolId: 'tw-demo-uni' }, 'unknown')).toBe(false);
  expect(isAnnouncementSchoolVisibleToPublic({ schoolId: 'tw-demo-uni' }, 'production')).toBe(
    false,
  );
  expect(isAnnouncementSchoolVisibleToPublic({ schoolId: 'tw-demo-uni' }, 'test')).toBe(true);
  expect(isAnnouncementSchoolVisibleToPublic({ schoolId: 'tw-demo-uni' }, 'development')).toBe(
    true,
  );
  expect(isAnnouncementSchoolVisibleToPublic({ schoolId: 'tw-demo-uni' }, 'preview')).toBe(true);
  expect(isAnnouncementSchoolVisibleToPublic({ schoolId: 'pu' }, '')).toBe(true);
  expect(isAnnouncementSchoolVisibleToPublic({ schoolId: 'pu' }, 'production')).toBe(true);
});

it('formats the stale banner in Taiwan time and keeps the empty-state copy', () => {
  expect(formatStaleAnnouncementNotice('2026-10-12T10:05:00.000Z')).toBe(
    '最後更新 10/12 18:05，學校網站暫時連不上',
  );
  expect(formatStaleAnnouncementNotice('2026-10-12T10:05:00.000Z', 'source_down')).toBe(
    '最後更新 10/12 18:05，學校網站暫時連不上',
  );
  expect(formatStaleAnnouncementNotice(null)).toBe('學校網站暫時連不上');
  expect(SOURCE_DOWN_WITH_CACHE_TEXT).toBe('學校網站暫時連不上');
  expect(SOURCE_DOWN_EMPTY_TEXT).toBe(ANNOUNCEMENT_READ_FAILURE_TEXT);
  expect(SOURCE_DOWN_EMPTY_TEXT).not.toContain('學校網站暫時連不上');
  expect(ANNOUNCEMENT_EMPTY_SCHOOL_TEXT).toBe('本站還沒接上這間學校的公告。');
  expect(SOURCE_NOT_CONNECTED_TEXT).toBe('本站還沒接上這間學校的公告。');
  expect(ANNOUNCEMENT_EMPTY_CONNECTED_TEXT).toBe('目前沒有學生日常公告。');
  expect(ANNOUNCEMENT_OFFICIAL_SITE_BUTTON).toBe('前往學校官方公告');
  expect(SOURCE_NOT_CONNECTED_TEXT).toBe(ANNOUNCEMENT_EMPTY_SCHOOL_TEXT);
  expect(ANNOUNCEMENT_EMPTY_SCHOOL_TEXT).not.toBe('這間學校的公告還沒上架。');
  expect(ANNOUNCEMENT_READ_FAILURE_TEXT).toBe('暫時讀不到資料，請稍後再試');
  expect(ANNOUNCEMENT_READ_FAILURE_TEXT).toBe(TEMPORARY_UNAVAILABLE_TEXT);
  expect(ANNOUNCEMENT_RETRY_TEXT).toBe('再試一次');
  expect(ANNOUNCEMENT_READ_FAILURE_TEXT).not.toBe(ANNOUNCEMENT_EMPTY_SCHOOL_TEXT);
  expect(
    formatStaleAnnouncementNotice(
      staleAnnouncementUpdatedAt(
        [{ status: 'unavailable', lastSuccessAt: '2026-10-12T10:05:00.000Z' }],
        [{ publishedAt: '2026-01-01T00:00:00.000Z' }],
      ),
      'source_down',
    ),
  ).toBe('最後更新 10/12 18:05，學校網站暫時連不上');
});

it('uses a Firestore unread banner when cached copy remains after a local read failure', () => {
  expect(FIRESTORE_UNAVAILABLE_WITH_CACHE_TEXT).toBe('暫時讀不到新公告');
  expect(formatStaleAnnouncementNotice('2026-10-12T10:05:00.000Z', 'firestore')).toBe(
    '最後更新 10/12 18:05，暫時讀不到新公告',
  );
  expect(formatStaleAnnouncementNotice(null, 'firestore')).toBe('暫時讀不到新公告');
  expect(formatStaleAnnouncementNotice('2026-10-12T10:05:00.000Z', 'firestore')).not.toContain(
    '學校網站暫時連不上',
  );
  expect(formatStaleAnnouncementNotice('2026-10-12T10:05:00.000Z', 'source_down')).not.toContain(
    '暫時讀不到新公告',
  );
});

it('classifies empty feeds as never connected, source down, or confirmed empty', () => {
  expect(announcementEmptyKind([], [])).toBe('not_connected');
  expect(announcementEmptyKind([], [{ status: 'unavailable' }])).toBe('source_down');
  expect(
    announcementEmptyKind(
      [],
      [{ status: 'unavailable', lastSuccessAt: '2026-10-12T10:05:00.000Z' }],
    ),
  ).toBe('source_down');
  expect(
    announcementEmptyKind([], [{ status: 'healthy', lastSuccessAt: '2026-10-12T10:05:00.000Z' }]),
  ).toBe('empty');
  expect(announcementEmptyKind([{ title: '舊稿' }], [{ status: 'unavailable' }])).toBe('has_items');
  expect(announcementEmptyHeading('not_connected')).toBe(SOURCE_NOT_CONNECTED_TEXT);
  expect(announcementEmptyHeading('empty')).toBe(ANNOUNCEMENT_EMPTY_CONNECTED_TEXT);
  expect(announcementEmptyHeading('source_down')).toBe(ANNOUNCEMENT_READ_FAILURE_TEXT);
  expect(announcementEmptyHeading('source_down')).not.toBe(SOURCE_NOT_CONNECTED_TEXT);
  expect(announcementEmptyHeading('has_items')).toBeNull();
  expect(announcementViewPhase(true, [], [])).toBe('loading');
  expect(announcementViewPhase(true, [{ title: '舊稿' }], [])).toBe('loading');
  expect(announcementViewPhase(false, [{ title: '舊稿' }], [])).toBe('has_items');
  expect(announcementViewPhase(false, [], [])).toBe('not_connected');
  expect(announcementViewPhase(true, [], [], true)).toBe('loading');
  expect(announcementViewPhase(false, [], [], true)).toBe('failed');
  expect(announcementViewPhase(false, [{ title: '舊稿' }], [], true)).toBe('has_items');
  expect(
    announcementViewPhase(
      false,
      [],
      [{ status: 'healthy', lastSuccessAt: '2026-10-12T10:05:00.000Z' }],
    ),
  ).toBe('empty');
  expect(
    announcementViewPhase(
      false,
      [],
      [{ status: 'healthy', lastSuccessAt: '2026-10-12T10:05:00.000Z' }],
      true,
    ),
  ).toBe('failed');
});

it('exposes official NCKU and NTPU announcement pages already connected in the catalog', () => {
  expect(listAnnouncementCatalogLinks('ncku')).toEqual(
    expect.arrayContaining([
      {
        sourceId: 'ncku-campus',
        office: '全校最新消息',
        listUrl: 'https://web.ncku.edu.tw/p/422-1000-1026.php?Lang=zh-tw',
      },
    ]),
  );
  expect(listAnnouncementCatalogLinks('ntpu')).toEqual(
    expect.arrayContaining([
      {
        sourceId: 'ntpu-campus',
        office: '電子公文一般公告（含教務處）',
        listUrl: 'https://fms.ntpu.edu.tw/km/24662',
      },
    ]),
  );
});

it('exposes catalog office urls for a school that has never been fetched', () => {
  expect(listAnnouncementCatalogLinks('pu')).toEqual(
    expect.arrayContaining([
      {
        sourceId: 'pu-acd',
        office: '教務處',
        listUrl: 'https://acd.pu.edu.tw/p/403-1042-885-1.php',
      },
      {
        sourceId: 'pu-dorac',
        office: '綜合業務組',
        listUrl: 'https://dorac.pu.edu.tw/p/403-1059-719-1.php',
      },
    ]),
  );
  expect(listAnnouncementCatalogLinks('tw-demo-uni')).toEqual([]);
});

it('finds office announcements by 學務處 or 住宿 even when source is missing', () => {
  expect(announcementMatchesSearch({ title: '生活輔導', office: '學務處' }, '學務處')).toBe(true);
  expect(announcementMatchesSearch({ title: '宿舍開放', office: '住宿' }, '住宿')).toBe(true);
  expect(
    announcementMatchesSearch({ title: '選課', source: '教務處', office: '教務處' }, '學務處'),
  ).toBe(false);
  expect(announcementSourceIdsForSchool('pu')).toEqual(
    expect.arrayContaining(['pu-osa', 'pu-dorm', 'pu-acd']),
  );
  expect(announcementSourceIdsForSchool('nthu')).not.toEqual(
    expect.arrayContaining(['pu-osa', 'pu-dorm']),
  );
  expect(
    mergeAnnouncementsById([
      [{ id: 'a', publishedAt: '2026-10-01T00:00:00.000Z' }],
      [
        { id: 'a', publishedAt: '2026-09-01T00:00:00.000Z' },
        { id: 'b', publishedAt: '2026-10-02T00:00:00.000Z' },
      ],
    ]).map((item) => item.id),
  ).toEqual(['b', 'a']);
});

it('keeps Chinese titles, parses ROC dates, and hides stale scrape rows from a down source', () => {
  const now = new Date('2026-10-18T00:00:00.000Z');
  expect(parseAnnouncementDate('[115.09.18]機車通行證抽籤結果')).toBe('2026-09-18T00:00:00.000Z');
  expect(
    chineseDisplayTitle(
      '115學年度第1學期學生選課清單列印及相關規定Printout of the Course Registration List',
    ),
  ).toBe('115學年度第1學期學生選課清單列印及相關規定');
  expect(
    selectStudentAnnouncements(
      [
        {
          id: 'old',
          title: '選課公告',
          publishedAt: '2026-10-01T00:00:00.000Z',
          origin: 'public_scrape',
          sourceId: 'pu-acd',
        },
      ],
      [{ sourceId: 'pu-acd', status: 'unavailable' }],
      now,
    ),
  ).toEqual([]);
});

it('only exposes verified official announcement URLs and keeps categorized posts in the official list', () => {
  const now = new Date('2026-10-18T00:00:00.000Z');
  expect(verifiedOfficialAnnouncementUrl('pu')).toBe(
    'https://dorac.pu.edu.tw/p/403-1059-719-1.php',
  );
  expect(verifiedOfficialAnnouncementUrl('ncku')).toBe(
    'https://web.ncku.edu.tw/p/422-1000-1026.php?Lang=zh-tw',
  );
  expect(verifiedOfficialAnnouncementUrl('ntpu')).toBe('https://fms.ntpu.edu.tw/km/24662');
  expect(verifiedOfficialAnnouncementUrl('scu')).toBe('https://news.scu.edu.tw/news-3');
  expect(verifiedOfficialAnnouncementUrl('cgu')).toBeNull();
  expect(verifiedOfficialAnnouncementUrl('nthu')).toBeNull();
  expect(verifiedOfficialAnnouncementUrl('tmu')).toBeNull();
  expect(verifiedOfficialAnnouncementUrl('thu')).toBeNull();
  expect(verifiedOfficialAnnouncementUrl('nchu')).toBeNull();
  expect(verifiedOfficialAnnouncementUrl('tw-nchu')).toBeNull();
  const rows = [
    { id: 'keep', title: '選課公告', publishedAt: '2026-10-08T00:00:00.000Z' },
    { id: 'none', title: '無日期稿', publishedAt: '' },
    { id: 'future', title: '未來稿', publishedAt: '2099-01-01T00:00:00.000Z' },
    {
      id: 'sec',
      title: '【漏洞預警】Cisco License 存在重大資安漏洞',
      publishedAt: '2026-10-08T00:00:00.000Z',
      office: '計算機與網路中心',
    },
    {
      id: 'staff',
      title: '點名計分單(for教師)',
      publishedAt: '2026-10-08T00:00:00.000Z',
    },
  ];
  expect(selectStudentAnnouncements(rows, [], now).map((row) => row.id)).toEqual(['keep']);
  expect(selectOfficialAnnouncements(rows, [], now).map((row) => row.id)).toEqual([
    'keep',
    'sec',
    'staff',
  ]);
  expect(tallyStudentWallFilter(rows, [], now)).toMatchObject({
    input: 5,
    kept: 1,
    no_date: 1,
    future_date: 1,
    security: 1,
    staff: 1,
  });
});

it('honors stored audience, student feed and visibility after titles lose audience suffixes', () => {
  const now = new Date('2026-10-18T00:00:00.000Z');
  const rows = [
    { id: 'legacy', title: '學生交流活動', publishedAt: '2026-10-08T00:00:00.000Z' },
    {
      id: 'staff',
      title: '教師研習報名通知',
      publishedAt: '2026-10-08T00:00:00.000Z',
      audience: 'staff',
    },
    {
      id: 'excluded',
      title: '其他公開資訊',
      publishedAt: '2026-10-08T00:00:00.000Z',
      studentFeed: false,
    },
    {
      id: 'hidden',
      title: '已撤下公告',
      publishedAt: '2026-10-08T00:00:00.000Z',
      visible: false,
      studentFeed: true,
    },
    { id: 'legacy-staff', title: '課程名冊(for教師)', publishedAt: '2026-10-08T00:00:00.000Z' },
  ];
  expect(selectStudentAnnouncements(rows, [], now).map((row) => row.id)).toEqual(['legacy']);
  expect(selectOfficialAnnouncements(rows, [], now).map((row) => row.id)).toEqual([
    'legacy',
    'staff',
    'excluded',
    'legacy-staff',
  ]);
  expect(tallyStudentWallFilter(rows, [], now)).toMatchObject({
    kept: 1,
    staff: 2,
    excluded: 1,
    hidden: 1,
  });
});
