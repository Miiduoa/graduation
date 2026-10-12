import { afterEach, expect, it, vi } from 'vitest';
import {
  allowsPlaceholderAnnouncementSchools,
  announcementEmptyKind,
  formatStaleAnnouncementNotice,
  isAnnouncementSchoolVisibleToPublic,
  isPlaceholderAnnouncementSchool,
  listAnnouncementCatalogLinks,
  PLACEHOLDER_ANNOUNCEMENT_SCHOOL_IDS,
  SOURCE_DOWN_EMPTY_TEXT,
  SOURCE_NOT_CONNECTED_TEXT,
  staleAnnouncementUpdatedAt,
} from '@campus/shared/src/campusAnnouncements';

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
  expect(formatStaleAnnouncementNotice(null)).toBe('學校網站暫時連不上');
  expect(SOURCE_DOWN_EMPTY_TEXT).toBe('學校網站暫時連不上，可以先到學校網站看最新消息');
  expect(SOURCE_NOT_CONNECTED_TEXT).toBe('這裡還沒接上學校公告，請先到學校網站看最新消息');
  expect(
    formatStaleAnnouncementNotice(
      staleAnnouncementUpdatedAt(
        [{ status: 'unavailable', lastSuccessAt: '2026-10-12T10:05:00.000Z' }],
        [{ publishedAt: '2026-01-01T00:00:00.000Z' }],
      ),
    ),
  ).toBe('最後更新 10/12 18:05，學校網站暫時連不上');
});

it('classifies empty feeds as never connected, source down, or confirmed empty', () => {
  expect(announcementEmptyKind([], [])).toBe('not_connected');
  expect(announcementEmptyKind([], [{ status: 'unavailable' }])).toBe('source_down');
  expect(
    announcementEmptyKind([], [{ status: 'unavailable', lastSuccessAt: '2026-10-12T10:05:00.000Z' }]),
  ).toBe('source_down');
  expect(
    announcementEmptyKind([], [{ status: 'healthy', lastSuccessAt: '2026-10-12T10:05:00.000Z' }]),
  ).toBe('empty');
  expect(
    announcementEmptyKind([{ title: '舊稿' }], [{ status: 'unavailable' }]),
  ).toBe('has_items');
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
