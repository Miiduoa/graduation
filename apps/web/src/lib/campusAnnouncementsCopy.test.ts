import { afterEach, expect, it, vi } from 'vitest';
import {
  formatStaleAnnouncementNotice,
  isAnnouncementSchoolVisibleToPublic,
  isPlaceholderAnnouncementSchool,
  PLACEHOLDER_ANNOUNCEMENT_SCHOOL_IDS,
  SOURCE_DOWN_EMPTY_TEXT,
  staleAnnouncementUpdatedAt,
} from '@campus/shared/src/campusAnnouncements';

afterEach(() => vi.unstubAllEnvs());

it('treats cms-none demo schools as placeholders hidden only in production', () => {
  expect(PLACEHOLDER_ANNOUNCEMENT_SCHOOL_IDS).toEqual([
    'tw-demo-uni',
    'tw-taichung-uni-a',
    'tw-taichung-uni-b',
  ]);
  expect(isPlaceholderAnnouncementSchool({ cms: 'none' })).toBe(true);
  expect(isPlaceholderAnnouncementSchool({ schoolId: 'tw-demo-uni' })).toBe(true);
  expect(isPlaceholderAnnouncementSchool({ schoolId: 'pu', cms: 'iweb' })).toBe(false);
  expect(isAnnouncementSchoolVisibleToPublic({ schoolId: 'tw-demo-uni' }, 'production')).toBe(
    false,
  );
  expect(isAnnouncementSchoolVisibleToPublic({ schoolId: 'tw-demo-uni' }, 'development')).toBe(
    true,
  );
  expect(isAnnouncementSchoolVisibleToPublic({ schoolId: 'pu' }, 'production')).toBe(true);
});

it('formats the stale banner in Taiwan time and keeps the empty-state copy', () => {
  expect(formatStaleAnnouncementNotice('2026-10-12T10:05:00.000Z')).toBe(
    '最後更新 10/12 18:05，學校網站暫時連不上',
  );
  expect(formatStaleAnnouncementNotice(null)).toBe('學校網站暫時連不上');
  expect(SOURCE_DOWN_EMPTY_TEXT).toBe('學校網站暫時連不上，可以先到學校網站看最新消息');
  expect(
    formatStaleAnnouncementNotice(
      staleAnnouncementUpdatedAt(
        [{ status: 'unavailable', lastSuccessAt: '2026-10-12T10:05:00.000Z' }],
        [{ publishedAt: '2026-01-01T00:00:00.000Z' }],
      ),
    ),
  ).toBe('最後更新 10/12 18:05，學校網站暫時連不上');
});
