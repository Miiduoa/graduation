import { afterEach, expect, it, vi } from 'vitest';
import { resolveAnnouncementSchool } from './resolveSchool';

afterEach(() => vi.unstubAllEnvs());

it('hides cms-none demo schools in production and keeps them in development', () => {
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production');
  expect(resolveAnnouncementSchool({ schoolId: 'tw-demo-uni' })).toMatchObject({
    school: { id: 'tw-demo-uni' },
    visible: false,
  });
  expect(resolveAnnouncementSchool({ schoolId: 'tw-taichung-uni-a' }).visible).toBe(false);
  expect(resolveAnnouncementSchool({ schoolId: 'pu' }).visible).toBe(true);
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'development');
  expect(resolveAnnouncementSchool({ schoolId: 'tw-demo-uni' }).visible).toBe(true);
});
