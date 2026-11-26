import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AccountIdentity } from './AccountIdentity';
import {
  IDENTITY_LOOKUP_FAILED_COPY,
  IDENTITY_LOOKUP_FAILED_HINT,
  IDENTITY_NO_MERCHANT_COPY,
  IDENTITY_NO_TEACHING_COPY,
  IDENTITY_RETRY_COPY,
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
      .getByRole('link', { name: '測試餐坊／第一門市 · 主校區 · 暫停接單' })
      .getAttribute('href'),
  ).toBe('/merchant/workspace?tenant=school-one&location=loc-1');
  expect(screen.getByRole('link', { name: '林家麵 · 已送出' }).getAttribute('href')).toBe(
    '/merchant/workspace',
  );
});

it('links stores with the same brand and campus to their own location, including after a reorder', async () => {
  const second = { ...store, locationId: 'loc-2', locationName: '第二門市' };
  let workspaces = [store, second];
  request.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') return { workspaces: [] };
    if (path === 'merchant-applications') return { applications: [] };
    if (path === 'merchant-workspaces') return { workspaces };
    throw new Error(path);
  });
  const view = render(
    <AccountIdentity context="ctx-a" accountId="pa_33333333-3333-4333-8333-333333333333" />,
  );
  const firstLink = await screen.findByRole('link', { name: /測試餐坊／第一門市/ });
  expect(firstLink.getAttribute('href')).toBe(
    '/merchant/workspace?tenant=school-one&location=loc-1',
  );
  expect(screen.getByRole('link', { name: /測試餐坊／第二門市/ }).getAttribute('href')).toBe(
    '/merchant/workspace?tenant=school-one&location=loc-2',
  );
  workspaces = [second, store];
  view.rerender(
    <AccountIdentity context="ctx-renewed" accountId="pa_33333333-3333-4333-8333-333333333333" />,
  );
  await screen.findByRole('link', { name: /測試餐坊／第二門市/ });
  const stores = screen.getAllByRole('link');
  expect(stores.map((link) => link.getAttribute('href'))).toEqual([
    '/merchant/workspace?tenant=school-one&location=loc-2',
    '/merchant/workspace?tenant=school-one&location=loc-1',
  ]);
});

it('offers the first two stores on home and keeps further stores and application progress reachable', async () => {
  request.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') return { workspaces: [] };
    if (path === 'merchant-applications') return { applications: [application] };
    if (path === 'merchant-workspaces')
      return {
        workspaces: [
          store,
          { ...store, locationId: 'loc-2', locationName: '第二門市' },
          { ...store, locationId: 'loc-3', locationName: '第三門市' },
        ],
      };
    throw new Error(path);
  });
  render(
    <AccountIdentity
      variant="home"
      context="ctx-a"
      accountId="pa_33333333-3333-4333-8333-333333333333"
    />,
  );
  const group = await screen.findByRole('region', { name: '門市工作' });
  const links = within(group);
  expect(links.getByRole('link', { name: /測試餐坊／第一門市/ }).getAttribute('href')).toBe(
    '/merchant/workspace?tenant=school-one&location=loc-1',
  );
  expect(links.getByRole('link', { name: /測試餐坊／第二門市/ }).getAttribute('href')).toBe(
    '/merchant/workspace?tenant=school-one&location=loc-2',
  );
  const more = group.querySelector('details')!;
  expect(more.open).toBe(false);
  expect(more.querySelector('summary')?.textContent).toBe('其他門市（1）');
  fireEvent.click(more.querySelector('summary')!);
  expect(more.open).toBe(true);
  expect(links.getByRole('link', { name: /測試餐坊／第三門市/ }).getAttribute('href')).toBe(
    '/merchant/workspace?tenant=school-one&location=loc-3',
  );
  expect(links.getByRole('link', { name: '查看申請進度（1）' }).getAttribute('href')).toBe(
    '/merchant/workspace?view=applications#merchant-applications-title',
  );
  expect(links.getByRole('link', { name: /開始今天的門市工作/ })).toBeTruthy();
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
  expect(screen.getByRole('link', { name: '申請店家進駐' }).getAttribute('href')).toBe(
    '/merchant/apply',
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

it('keeps students on daily work without offering unrelated teacher or merchant setup', async () => {
  const view = render(
    <AccountIdentity
      variant="home"
      context="ctx-a"
      accountId="pa_33333333-3333-4333-8333-333333333333"
    />,
  );
  await act(async () => {});
  expect(request).toHaveBeenCalledTimes(3);
  expect(view.container.textContent).toBe('');
  expect(screen.queryByRole('link', { name: '申請店家進駐' })).toBeNull();
});

it('shows concurrent teaching, merchant and platform responsibilities without changing the account role', async () => {
  request.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') return { workspaces: [course] };
    if (path === 'merchant-applications')
      return { applications: [{ ...application, state: 'needs-information' }] };
    if (path === 'merchant-workspaces') return { workspaces: [store] };
    throw new Error(path);
  });
  render(
    <AccountIdentity
      variant="home"
      context="ctx-a"
      accountId="pa_33333333-3333-4333-8333-333333333333"
      isPlatformOperator
    />,
  );
  const teaching = await screen.findByRole('region', { name: '教學工作' });
  expect(
    within(teaching)
      .getByRole('link', { name: /設計專題/ })
      .getAttribute('href'),
  ).toBe(`/classroom/course/${course.id}`);
  expect(screen.getByRole('link', { name: /1 筆申請需要補件/ }).getAttribute('href')).toBe(
    '/merchant/workspace',
  );
  expect(screen.getByRole('link', { name: /進入平台工作台/ }).getAttribute('href')).toBe('/admin');
  expect(screen.queryByRole('link', { name: '申請店家進駐' })).toBeNull();
});

it('does not infer merchant onboarding from an incomplete lookup, and recovers into the confirmed next step', async () => {
  request.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') return { workspaces: [] };
    if (path === 'merchant-applications')
      return { applications: [{ ...application, state: 'approved' }] };
    if (path === 'merchant-workspaces') throw new Error('offline');
    throw new Error(path);
  });
  render(
    <AccountIdentity
      variant="home"
      context="ctx-a"
      accountId="pa_33333333-3333-4333-8333-333333333333"
    />,
  );
  await screen.findByRole('alert');
  expect(screen.queryByText(/等待門市權限/)).toBeNull();
  expect(screen.queryByText(/開始申請第一間門市/)).toBeNull();
  expect(screen.getByRole('link', { name: /確認門市與申請/ })).toBeTruthy();
  request.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') return { workspaces: [] };
    if (path === 'merchant-applications')
      return { applications: [{ ...application, state: 'approved' }] };
    if (path === 'merchant-workspaces') return { workspaces: [] };
    throw new Error(path);
  });
  fireEvent.click(screen.getByRole('button', { name: IDENTITY_RETRY_COPY }));
  expect(await screen.findByRole('link', { name: /申請已核准，等待門市權限/ })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('removes old work destinations immediately when the account changes, including late results', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementation(async (path: string, context: string) => {
    if (path === 'class-workspaces') return { workspaces: context === 'ctx-a' ? [course] : [] };
    if (path === 'merchant-applications') return { applications: [] };
    if (path === 'merchant-workspaces' && context === 'ctx-b')
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (path === 'merchant-workspaces') return { workspaces: [store] };
    throw new Error(path);
  });
  const view = render(
    <AccountIdentity
      variant="home"
      context="ctx-a"
      accountId="pa_33333333-3333-4333-8333-333333333333"
      isPlatformOperator
    />,
  );
  await screen.findByRole('region', { name: '教學工作' });
  view.rerender(
    <AccountIdentity
      variant="home"
      context="ctx-b"
      accountId="pa_44444444-4444-4444-8444-444444444444"
    />,
  );
  expect(screen.queryByRole('link', { name: /設計專題/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /進入平台工作台/ })).toBeNull();
  view.rerender(
    <AccountIdentity
      variant="home"
      context="ctx-c"
      accountId="pa_55555555-5555-4555-8555-555555555555"
    />,
  );
  await act(async () => finish({ workspaces: [{ ...store, merchantName: '晚到的門市' }] }));
  await waitFor(() => expect(screen.queryByText(/晚到的門市/)).toBeNull());
  expect(screen.queryByRole('region', { name: '教學工作' })).toBeNull();
});

it('preserves the recovery control while rechecking and restores keyboard focus after an empty success', async () => {
  request.mockRejectedValue(new Error('offline'));
  render(
    <AccountIdentity
      variant="home"
      context="ctx-a"
      accountId="pa_33333333-3333-4333-8333-333333333333"
    />,
  );
  const retry = await screen.findByRole('button', { name: IDENTITY_RETRY_COPY });
  let finish!: (value: unknown) => void;
  request.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') return { workspaces: [] };
    if (path === 'merchant-applications') return { applications: [] };
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  retry.focus();
  fireEvent.click(retry);
  expect(screen.getByRole('button', { name: '確認中…' })).toBe(retry);
  expect(document.activeElement).toBe(retry);
  expect(retry.hasAttribute('disabled')).toBe(true);
  await act(async () => finish({ workspaces: [] }));
  expect(screen.getByRole('status').textContent).toContain('工作身分已確認');
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: '我的工作' }));
  expect(screen.queryByRole('link', { name: '申請店家進駐' })).toBeNull();
});

it('omits the teaching summary when the full teaching queue is already on this page', async () => {
  request.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') return { workspaces: [course] };
    if (path === 'merchant-applications') return { applications: [application] };
    if (path === 'merchant-workspaces') return { workspaces: [] };
    throw new Error(path);
  });
  render(
    <AccountIdentity
      variant="home"
      includeTeaching={false}
      context="ctx-a"
      accountId="pa_33333333-3333-4333-8333-333333333333"
    />,
  );
  await screen.findByRole('region', { name: '門市工作' });
  expect(screen.queryByRole('region', { name: '教學工作' })).toBeNull();
  expect(screen.queryByRole('link', { name: /設計專題/ })).toBeNull();
});

it('uses the already confirmed home course source without rereading or redirecting school courses', async () => {
  const courses = [1, 2, 3].map((id) => ({
    id: `school-${id}`,
    name: `學校授課 ${id}`,
    role: '負責老師' as const,
    href: `/course/school-${id}`,
  }));
  const view = render(
    <AccountIdentity
      variant="home"
      teaching={{ status: 'ok', items: courses }}
      context="ctx-a"
      accountId="pa_33333333-3333-4333-8333-333333333333"
    />,
  );
  expect(screen.getByRole('link', { name: /學校授課 1/ }).getAttribute('href')).toBe(
    '/course/school-1',
  );
  await act(async () => {});
  expect(request.mock.calls.some(([path]) => path === 'class-workspaces')).toBe(false);
  const more = view.container.querySelector('details')!;
  expect(more.open).toBe(false);
  fireEvent.click(more.querySelector('summary')!);
  expect(more.open).toBe(true);
  expect(screen.getByRole('link', { name: /學校授課 3/ }).getAttribute('href')).toBe(
    '/course/school-3',
  );
  expect(view.container.querySelector('a[href="/classroom"]')).toBeNull();
});
