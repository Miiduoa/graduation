import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OpsConsole } from './OpsConsole';

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
vi.mock('@/features/admin/AdminSchools', () => ({
  AdminSchools: () => <p>學校分頁</p>,
}));
vi.mock('@/features/admin/AdminPeople', () => ({
  AdminPeople: () => <p>人員分頁</p>,
}));
vi.mock('@/features/admin/AdminMerchants', () => ({
  AdminMerchants: () => <p>店家分頁</p>,
}));
vi.mock('@/features/admin/AdminAudit', () => ({
  AdminAudit: () => <p>紀錄分頁</p>,
}));
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

const fetcher = vi.fn();

beforeEach(() => {
  mocks.session = null;
  mocks.loading = false;
  fetcher.mockReset().mockResolvedValue(
    new Response(JSON.stringify({ schools: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  window.history.replaceState(null, '', '/admin/ops');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('asks guests to sign in', () => {
  render(<OpsConsole />);
  expect(screen.getByRole('heading', { name: '請先登入管理員帳號' })).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});

it('blocks signed-in non-operators without loading ops data', () => {
  mocks.session = {
    platformAccountId: 'pa_1',
    context: 'a'.repeat(43),
    isPlatformOperator: false,
  };
  render(<OpsConsole />);
  expect(screen.getByRole('heading', { name: '沒有管理權限' })).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});

it('shows the operator console tabs', async () => {
  mocks.session = {
    platformAccountId: 'pa_1',
    context: 'a'.repeat(43),
    isPlatformOperator: true,
  };
  render(<OpsConsole />);
  expect(screen.getByRole('heading', { name: '完整管理台' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: '學校' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '人員' }));
  expect(await screen.findByText('人員分頁')).toBeTruthy();
  expect(screen.getByRole('heading', { name: '加人' })).toBeTruthy();
});

const merchants = {
  interest: [
    {
      id: 'interest-1',
      brandName: '意向咖啡',
      schoolName: '第一學校',
      contactName: '店長',
      contactEmail: 'interest@example.test',
      note: null,
      state: 'submitted',
      createdAt: '2026-01-02T03:04:05.000Z',
      decidedAt: null,
    },
  ],
  applications: [],
  catalog: [],
  honesty: '意向與進件都要先審過才能往下。',
};

it('posts merchant interest decisions to platform-admin', async () => {
  mocks.session = {
    platformAccountId: 'pa_1',
    context: 'a'.repeat(43),
    isPlatformOperator: true,
  };
  fetcher.mockImplementation(async (url: string) => {
    if (String(url).includes('/api/platform-admin/merchants')) {
      return new Response(JSON.stringify(merchants), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  render(<OpsConsole />);
  fireEvent.click(screen.getByRole('tab', { name: '店家' }));
  fireEvent.click(await screen.findByRole('button', { name: '核准意向' }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        ([url, options]) =>
          String(url) === '/api/platform-admin/merchant-interest/interest-1/decision' &&
          options?.method === 'POST',
      ),
    ).toBe(true),
  );
  const posted = fetcher.mock.calls.find(([url]) =>
    String(url).includes('/merchant-interest/interest-1/decision'),
  )!;
  expect(JSON.parse(posted[1].body)).toMatchObject({ decision: 'approve' });
});

it('posts affiliation decisions to class-workspace-affiliation-applications', async () => {
  mocks.session = {
    platformAccountId: 'pa_1',
    context: 'a'.repeat(43),
    isPlatformOperator: true,
  };
  fetcher.mockImplementation(async (url: string) => {
    if (String(url).includes('class-workspace-affiliation-applications') && !String(url).includes('/decision')) {
      return new Response(
        JSON.stringify({
          applications: [
            {
              id: 'aff-1',
              workspaceTitle: '設計專題',
              tenantId: 'school-one',
              sectionId: 'sec-1',
              justification: '請掛靠',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  render(<OpsConsole />);
  fireEvent.click(screen.getByRole('tab', { name: '課班掛靠' }));
  fireEvent.click(await screen.findByRole('button', { name: '核准掛靠' }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        ([url, options]) =>
          String(url) ===
            '/api/platform-admin/class-workspace-affiliation-applications/aff-1/decision' &&
          options?.method === 'POST',
      ),
    ).toBe(true),
  );
  const posted = fetcher.mock.calls.find(([url]) => String(url).includes('/aff-1/decision'))!;
  expect(JSON.parse(posted[1].body)).toMatchObject({
    decision: 'approve',
    reason: '資料已核對，准予掛靠。',
  });
});
