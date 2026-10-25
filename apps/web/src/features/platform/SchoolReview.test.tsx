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
    if (String(url).endsWith('/ops-api/schools')) {
      return ok({
        schools: [{ tenantId: 'ready-school', displayName: '待開放學校', lifecycle: 'provisioned' }],
      });
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

it('shows the server 403 copy when the account is not an operator', async () => {
  mocks.session = { ...principal, isPlatformOperator: false };
  fetcher.mockImplementation(async (url: string) => {
    if (String(url).includes('school-applications')) return ok({}, 403);
    return ok({}, 403);
  });
  render(<SchoolReview />);
  expect(await screen.findByText(/這台帳號不是平台營運人員/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '學校接入' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '核准申請' })).toBeNull();
});

it('approves a pending application through the existing decision endpoint', async () => {
  render(<SchoolReview />);
  expect(await screen.findByText('待審學校')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '核准申請' }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        ([url, options]) =>
          String(url).includes('/school-applications/app-1/decision') && options?.method === 'POST',
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
});

it('rejects with the original insufficient-data reason', async () => {
  render(<SchoolReview />);
  await screen.findByText('待審學校');
  fireEvent.click(screen.getByRole('button', { name: '拒絕' }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(([, options]) => options?.method === 'POST'),
    ).toBe(true),
  );
  const posted = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!;
  expect(JSON.parse(posted[1].body)).toMatchObject({
    decision: 'reject',
    reason: REJECT_SCHOOL_REASON,
  });
});
