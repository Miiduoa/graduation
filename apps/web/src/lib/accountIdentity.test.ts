import { expect, it, vi } from 'vitest';
import {
  IDENTITY_LOOKUP_FAILED_COPY,
  IDENTITY_LOOKUP_FAILED_HINT,
  IDENTITY_NO_MERCHANT_COPY,
  IDENTITY_NO_TEACHING_COPY,
  IDENTITY_RETRY_COPY,
  STORE_NOT_OPEN_COPY,
  loadAccountIdentity,
  merchantLocationOpen,
} from './accountIdentity';

const course = (role: string, title = '設計專題') => ({
  id: 'cw_11111111-1111-4111-8111-111111111111',
  title,
  state: 'active',
  memberRole: role,
});
const store = {
  tenantId: 'school-one',
  tenantName: '靜宜大學',
  merchantName: '測試餐坊',
  locationId: 'loc-1',
  locationName: '第一門市',
  campusName: '主校區',
  merchantStatus: 'active',
  locationStatus: 'open',
  publicAccess: true,
  activated: true,
  missingRequirements: [],
};
const application = {
  applicationId: 'fma_11111111-1111-4111-8111-111111111111',
  tenantId: 'school-one',
  brandName: '林家麵',
  locationName: '第二門市',
  state: 'under-review',
  reviewerNote: '',
  submittedAt: '2026-10-09T00:00:00Z',
};

it('lists only non-student course roles and keeps merchant lines separate', async () => {
  const transport = vi.fn(async (path: string) => {
    if (path === 'class-workspaces')
      return {
        workspaces: [
          course('owner-teacher'),
          {
            ...course('co-teacher'),
            id: 'cw_22222222-2222-4222-8222-222222222222',
            title: '視覺傳達',
          },
          { ...course('student'), id: 'cw_33333333-3333-4333-8333-333333333333', title: '通識' },
        ],
      };
    if (path === 'merchant-applications') return { applications: [application] };
    if (path === 'merchant-workspaces') return { workspaces: [{ ...store, activated: false }] };
    throw new Error(path);
  });
  const identity = await loadAccountIdentity(transport, 'pa_33333333-3333-4333-8333-333333333333');
  expect(identity.teaching).toEqual({
    status: 'ok',
    items: [
      {
        id: 'cw_11111111-1111-4111-8111-111111111111',
        name: '設計專題',
        role: '負責老師',
        href: '/classroom/course/cw_11111111-1111-4111-8111-111111111111',
      },
      {
        id: 'cw_22222222-2222-4222-8222-222222222222',
        name: '視覺傳達',
        role: '協同教師',
        href: '/classroom/course/cw_22222222-2222-4222-8222-222222222222',
      },
    ],
  });
  expect(identity.teaching.status === 'ok' && identity.teaching.items[0]?.href).not.toContain(
    '/teacher',
  );
  expect(identity.applications).toEqual({
    status: 'ok',
    items: [{ brand: '林家麵', progress: '審核中' }],
  });
  expect(identity.stores.status === 'ok' && identity.stores.items[0]).toMatchObject({
    name: '測試餐坊',
    campus: '主校區',
    status: STORE_NOT_OPEN_COPY,
    open: false,
  });
});

it('does not treat a failed lookup as an empty identity', async () => {
  const transport = vi.fn(async (path: string) => {
    if (path === 'class-workspaces') throw new Error('offline');
    if (path === 'merchant-applications') return { applications: [] };
    if (path === 'merchant-workspaces') return { workspaces: [] };
    throw new Error(path);
  });
  const identity = await loadAccountIdentity(transport, 'pa_33333333-3333-4333-8333-333333333333');
  expect(identity.teaching).toEqual({ status: 'error' });
  expect(identity.stores).toEqual({ status: 'ok', items: [] });
  expect(identity.applications).toEqual({ status: 'ok', items: [] });
  expect(IDENTITY_NO_TEACHING_COPY).toContain('沒有授課課程');
  expect(IDENTITY_NO_MERCHANT_COPY).toContain('店家申請');
  expect(IDENTITY_LOOKUP_FAILED_COPY).toBe('暫時查不到你的老師或店家身分');
  expect(IDENTITY_LOOKUP_FAILED_HINT).toBe('不影響一般功能，請稍後再試一次');
  expect(IDENTITY_RETRY_COPY).toBe('再試一次');
});

it('only calls a store open when the backend says it is open', () => {
  expect(merchantLocationOpen(store)).toBe(true);
  expect(merchantLocationOpen({ ...store, activated: false })).toBe(false);
  expect(merchantLocationOpen({ ...store, publicAccess: false })).toBe(false);
  expect(merchantLocationOpen({ ...store, locationStatus: 'closed' })).toBe(false);
});
