import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AccountIdentity } from './AccountIdentity';
import {
  IDENTITY_LOOKUP_FAILED_COPY,
  IDENTITY_LOOKUP_FAILED_HINT,
  IDENTITY_NO_MERCHANT_COPY,
  IDENTITY_NO_TEACHING_COPY,
  IDENTITY_RETRY_COPY,
  STORE_NOT_OPEN_COPY,
} from '@/lib/accountIdentity';

const request = vi.fn();
vi.mock('@/features/nuni/Session', () => ({
  browserRequest: (...args: unknown[]) => request(...args),
}));

const course = {
  id: 'cw_11111111-1111-4111-8111-111111111111',
  title: '設計專題',
  state: 'active',
  memberRole: 'owner-teacher',
};
const store = {
  tenantId: 'school-one',
  tenantName: '靜宜大學',
  merchantName: '測試餐坊',
  locationId: 'loc-1',
  locationName: '第一門市',
  campusName: '主校區',
  merchantStatus: 'active',
  locationStatus: 'closed',
  publicAccess: false,
  activated: true,
  missingRequirements: [],
};
const application = {
  applicationId: 'fma_11111111-1111-4111-8111-111111111111',
  tenantId: 'school-one',
  brandName: '林家麵',
  locationName: '第二門市',
  state: 'submitted',
  reviewerNote: '',
  submittedAt: '2026-10-09T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  request.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') return { workspaces: [] };
    if (path === 'merchant-applications') return { applications: [] };
    if (path === 'merchant-workspaces') return { workspaces: [] };
    throw new Error(path);
  });
});

it('lists each role on its own line and links teaching to the course, not /teacher', async () => {
  request.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces')
      return {
        workspaces: [
          course,
          {
            ...course,
            id: 'cw_22222222-2222-4222-8222-222222222222',
            title: '視覺傳達',
            memberRole: 'co-teacher',
          },
        ],
      };
    if (path === 'merchant-applications') return { applications: [application] };
    if (path === 'merchant-workspaces') return { workspaces: [store] };
    throw new Error(path);
  });
  render(<AccountIdentity context="ctx-a" accountId="pa_33333333-3333-4333-8333-333333333333" />);
  const teacher = await screen.findByRole('link', { name: '設計專題 · 負責老師' });
  expect(teacher.getAttribute('href')).toBe(
    '/classroom/course/cw_11111111-1111-4111-8111-111111111111',
  );
  expect(
    screen.getByRole('link', { name: '視覺傳達 · 協同教師' }).getAttribute('href'),
  ).not.toContain('/teacher');
  expect(
    screen
      .getByRole('link', { name: `測試餐坊 · 主校區 · ${STORE_NOT_OPEN_COPY}` })
      .getAttribute('href'),
  ).toBe('/merchant');
  expect(screen.getByRole('link', { name: '林家麵 · 已送出' }).getAttribute('href')).toBe(
    '/merchant',
  );
});

it('says empty only after a real empty result, and retries a failed lookup', async () => {
  request.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') throw new Error('offline');
    if (path === 'merchant-applications') throw new Error('offline');
    if (path === 'merchant-workspaces') throw new Error('offline');
    throw new Error(path);
  });
  render(<AccountIdentity context="ctx-a" accountId="pa_33333333-3333-4333-8333-333333333333" />);
  const failed = await screen.findByRole('alert');
  expect(failed.textContent).toContain(IDENTITY_LOOKUP_FAILED_COPY);
  expect(failed.textContent).toContain(IDENTITY_LOOKUP_FAILED_HINT);
  expect(screen.getByRole('button', { name: IDENTITY_RETRY_COPY })).toBeTruthy();
  expect(screen.queryByText(IDENTITY_NO_TEACHING_COPY)).toBeNull();
  expect(screen.queryByText(IDENTITY_NO_MERCHANT_COPY)).toBeNull();
  request.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') return { workspaces: [] };
    if (path === 'merchant-applications') return { applications: [] };
    if (path === 'merchant-workspaces') return { workspaces: [] };
    throw new Error(path);
  });
  fireEvent.click(screen.getByRole('button', { name: '再試一次' }));
  await screen.findByText(IDENTITY_NO_TEACHING_COPY);
  expect(screen.getByRole('link', { name: IDENTITY_NO_MERCHANT_COPY }).getAttribute('href')).toBe(
    '/merchant',
  );
  expect(screen.queryByText(IDENTITY_LOOKUP_FAILED_COPY)).toBeNull();
});

it('does not keep a previous account result after the session context changes', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementation(async (path: string, context?: string) => {
    if (context === 'ctx-a' && path === 'class-workspaces')
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (path === 'class-workspaces') return { workspaces: [{ ...course, title: '新帳號課程' }] };
    if (path === 'merchant-applications') return { applications: [] };
    if (path === 'merchant-workspaces') return { workspaces: [] };
    throw new Error(path);
  });
  const view = render(
    <AccountIdentity context="ctx-a" accountId="pa_33333333-3333-4333-8333-333333333333" />,
  );
  view.rerender(
    <AccountIdentity context="ctx-b" accountId="pa_44444444-4444-4444-8444-444444444444" />,
  );
  await screen.findByRole('link', { name: '新帳號課程 · 負責老師' });
  await act(async () =>
    finish({
      workspaces: [{ ...course, title: '舊帳號課程' }],
    }),
  );
  expect(screen.queryByText(/舊帳號課程/)).toBeNull();
});
