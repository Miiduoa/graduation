import { afterEach, expect, it, vi } from 'vitest';
import { resolveAnnouncementSchool } from './resolveSchool';

afterEach(() => vi.unstubAllEnvs());

it('hides cms-none demo schools unless NEXT_PUBLIC_APP_ENV is explicitly development, preview or test', () => {
  expect(resolveAnnouncementSchool({ schoolId: 'tw-demo-uni' })).toMatchObject({
    school: { id: 'tw-demo-uni' },
    visible: false,
  });
  expect(resolveAnnouncementSchool({ schoolId: 'tw-taichung-uni-a' }).visible).toBe(false);
  expect(resolveAnnouncementSchool({ schoolId: 'pu' }).visible).toBe(true);
  expect(resolveAnnouncementSchool({ campus: 'nthu' }).school.id).toBe('nthu');
  expect(resolveAnnouncementSchool({ schoolId: 'pu', campus: 'nthu' }).school.id).toBe('nthu');
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', '');
  expect(resolveAnnouncementSchool({ schoolId: 'tw-demo-uni' }).visible).toBe(false);
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'staging');
  expect(resolveAnnouncementSchool({ schoolId: 'tw-demo-uni' }).visible).toBe(false);
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production');
  expect(resolveAnnouncementSchool({ schoolId: 'tw-demo-uni' }).visible).toBe(false);
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'test');
  expect(resolveAnnouncementSchool({ schoolId: 'tw-demo-uni' }).visible).toBe(true);
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'development');
  expect(resolveAnnouncementSchool({ schoolId: 'tw-demo-uni' }).visible).toBe(true);
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'preview');
  expect(resolveAnnouncementSchool({ schoolId: 'tw-demo-uni' }).visible).toBe(true);
});

it('never falls back to Providence when the campus selection is explicitly unavailable', () => {
  expect(resolveAnnouncementSchool({ campus: 'all', schoolId: 'pu' }).visible).toBe(false);
  expect(resolveAnnouncementSchool({ campus: 'INVALID', schoolId: 'pu' }).visible).toBe(false);
  expect(resolveAnnouncementSchool({ campus: 'nthu', schoolId: 'pu' }).school.id).toBe('nthu');
});
