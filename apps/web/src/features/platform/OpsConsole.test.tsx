import { fireEvent, render, screen } from '@testing-library/react';
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
