import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SchoolReview } from './SchoolReview';
import { APPROVE_SCHOOL_REASON, REJECT_SCHOOL_REASON } from './constants';

const mocks = vi.hoisted(() => ({
  session: null as null | {
    platformAccountId: string;
    context: string;
    isPlatformOperator: boolean;
  },
  loading: false,
}));

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/features/admin/AdminHeader', () => ({ AdminHeader: () => <header>管理</header> }));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({
    session: mocks.session,
    loading: mocks.loading,
    error: '',
    pendingLogout: false,
    refresh: vi.fn(),
    logout: vi.fn(),
  }),
}));

const principal = {
  platformAccountId: 'pa_1',
  context: 'a'.repeat(43),
  isPlatformOperator: true,
};

const provisioned = {
  kind: 'tenant',
  applicationId: null,
  tenantId: 'ready-school',
  displayName: '待開放學校',
  emailDomain: 'ready.edu.tw',
  lifecycle: 'provisioned',
  description: '',
  modules: { leave: false, identity: false, food: false },
  peopleCount: 0,
  merchantCount: 0,
};

function ok(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetcher = vi.fn();

beforeEach(() => {
  mocks.session = { ...principal };
  mocks.loading = false;
  fetcher.mockReset().mockImplementation(async (url: string) => {
    if (String(url).includes('school-applications?scope=pending')) {
      return ok({
        applications: [
          {
            id: 'app-1',
            displayName: '待審學校',
            proposedTenantId: 'pending-school',
            proposedEmailDomain: 'pending.edu.tw',
            contactName: '王老師',
            contactEmail: 'wang@pending.edu.tw',
            justification: '請協助接入',
          },
        ],
      });
    }
    if (String(url).endsWith('/api/platform-admin/schools')) {
      return ok({ schools: [provisioned] });
    }
    return ok({});
  });
  vi.stubGlobal('fetch', fetcher);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('asks guests to sign in and does not load applications', () => {
  mocks.session = null;
  render(<SchoolReview />);
  expect(screen.getByRole('heading', { name: '請先登入管理員帳號' })).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});

it('does not render pending sections or call APIs for signed-in non-operators', () => {
  mocks.session = { ...principal, isPlatformOperator: false };
  render(<SchoolReview />);
  expect(screen.getByRole('heading', { name: '沒有管理權限' })).toBeTruthy();
  expect(screen.getByText(/這台帳號不是平台營運人員/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '學校接入' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '待審申請' })).toBeNull();
  expect(screen.queryByRole('heading', { name: '待開放' })).toBeNull();
  expect(screen.queryByRole('button', { name: '核准申請' })).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it('approves a pending application through platform-admin', async () => {
  render(<SchoolReview />);
  expect(await screen.findByText('待審學校')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '核准申請' }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        ([url, options]) =>
          String(url) === '/api/platform-admin/school-applications/app-1/decision' &&
          options?.method === 'POST',
      ),
    ).toBe(true),
  );
  const posted = fetcher.mock.calls.find(
    ([url, options]) => String(url).includes('/decision') && options?.method === 'POST',
  )!;
  expect(JSON.parse(posted[1].body)).toMatchObject({
    decision: 'approve',
    reason: APPROVE_SCHOOL_REASON,
  });
  expect(posted[1].headers['Content-Type']).toBe('application/json');
});

it('rejects with the original insufficient-data reason', async () => {
  render(<SchoolReview />);
  await screen.findByText('待審學校');
  fireEvent.click(screen.getByRole('button', { name: '拒絕' }));
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true),
  );
  const posted = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!;
  expect(String(posted[0])).toBe('/api/platform-admin/school-applications/app-1/decision');
  expect(JSON.parse(posted[1].body)).toMatchObject({
    decision: 'reject',
    reason: REJECT_SCHOOL_REASON,
  });
});

it('opens a provisioned school through the existing schools open path', async () => {
  render(<SchoolReview />);
  fireEvent.click(await screen.findByRole('button', { name: '一鍵開通' }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        ([url, options]) =>
          String(url) === '/api/platform-admin/schools/ready-school/open' && options?.method === 'POST',
      ),
    ).toBe(true),
  );
});

it('redirects to account login when the Campus One session is gone', async () => {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace });
  fetcher.mockResolvedValue(ok({ error: 'SIGN_IN_REQUIRED' }, 401));
  render(<SchoolReview />);
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith(
      `/auth/account?returnUrl=${encodeURIComponent('/admin/school-review')}`,
    ),
  );
  expect(String(fetcher.mock.calls[0][0])).toContain('/api/platform-admin/');
  expect(fetcher.mock.calls.some(([url]) => String(url).startsWith('/auth/platform/'))).toBe(false);
});
