import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import MerchantApplyPage from '@/app/merchant/apply/page';
import MerchantLocationsPage from '@/app/merchant/workspace/page';
import { MerchantWorkspace } from './MerchantWorkspace';

const mocks = vi.hoisted(() => ({
  auth: {
    session: { platformAccountId: 'account-a', context: 'context-a' } as null | {
      platformAccountId: string;
      context: string;
    },
    loading: false,
    pendingLogout: false,
    error: '',
    refresh: vi.fn(),
    logout: vi.fn(),
  },
  request: vi.fn(),
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => mocks.auth,
  useOptionalNuniSession: () => mocks.auth,
  browserRequest: mocks.request,
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/NuniSignIn', () => ({
  NuniSignIn: ({ returnUrl }: { returnUrl: string }) => (
    <a href={`/login?returnUrl=${encodeURIComponent(returnUrl)}`}>登入或建立帳號</a>
  ),
}));
const programs = [
  {
    tenantId: 'campus-one',
    name: '開放申請校園',
    note: '請填寫實際營業位置',
    campuses: [{ id: 'main-campus', name: '主校區' }],
  },
  {
    tenantId: 'campus-two',
    name: '另一個校園',
    note: '',
    campuses: [{ id: 'second-campus', name: '第二校區' }],
  },
];
const application = {
  tenantId: 'campus-one',
  applicationId: 'application-1',
  brandName: '測試餐坊',
  locationName: '學生餐廳',
  state: 'submitted',
  reviewerNote: '',
  submittedAt: '2026-10-09T02:00:00.000Z',
};
function respond(path: string, _context?: string, input?: unknown) {
  if (path === 'account-demo') return Promise.resolve({ demo: null });
  if (input) return Promise.resolve(application);
  if (path === 'merchant-onboarding-programs') return Promise.resolve({ programs });
  if (path === 'merchant-applications') return Promise.resolve({ applications: [] });
  if (path === 'merchant-workspaces') return Promise.resolve({ workspaces: [] });
  return Promise.reject(new Error(`Unexpected ${path}`));
}
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/merchant/workspace');
  mocks.auth.session = { platformAccountId: 'account-a', context: 'context-a' };
  mocks.auth.loading = false;
  mocks.auth.pendingLogout = false;
  mocks.auth.error = '';
  mocks.request.mockImplementation(respond);
});
async function fillApplication() {
  await screen.findByLabelText('申請場域');
  fireEvent.change(screen.getByLabelText('申請場域'), { target: { value: 'campus-one' } });
  fireEvent.change(screen.getByLabelText('校區／營運區域'), { target: { value: 'main-campus' } });
  const fields = {
    '登記名稱／負責單位': '測試商號',
    對外品牌名稱: '測試餐坊',
    '門市／櫃位名稱': '學生餐廳',
    實際營業地址或校內位置: '學生餐廳一樓',
    聯絡人: '測試聯絡人',
    聯絡信箱: 'merchant@example.test',
    聯絡電話: '0912345678',
  };
  for (const [label, value] of Object.entries(fields))
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
it('returns new and existing accounts to the merchant task without self-assigning a role', () => {
  mocks.auth.session = null;
  render(<MerchantWorkspace />);
  expect(screen.getByRole('link', { name: '登入或建立帳號' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Fmerchant',
  );
  expect(mocks.request).not.toHaveBeenCalled();
});
it.each([
  [MerchantApplyPage, '/merchant/apply'],
  [MerchantLocationsPage, '/merchant/workspace'],
] as const)('preserves the selected merchant page when sign-in is required', (Page, path) => {
  mocks.auth.session = null;
  render(<Page />);
  expect(screen.getByRole('link', { name: '登入或建立帳號' }).getAttribute('href')).toBe(
    `/login?returnUrl=${encodeURIComponent(path)}`,
  );
  expect(mocks.request).not.toHaveBeenCalled();
});

it('lets a new applicant submit without a workspace and continue to their receipt', async () => {
  render(<MerchantApplyPage />);
  await fillApplication();
  expect(mocks.request.mock.calls.map(([path]) => path)).toEqual([
    'merchant-onboarding-programs',
    'merchant-applications',
  ]);
  fireEvent.click(screen.getByRole('button', { name: '送出進駐申請' }));
  const receipt = await screen.findByRole('link', { name: '查看收件進度' });
  expect(receipt.getAttribute('href')).toBe('/merchant/workspace');
  expect(screen.queryByRole('button', { name: '送出進駐申請' })).toBeNull();
});

it('lets a returning applicant check progress before starting a second application', async () => {
  mocks.request.mockImplementation((path, context, input) =>
    path === 'merchant-applications'
      ? Promise.resolve({ applications: [application] })
      : respond(path, context, input),
  );
  render(<MerchantApplyPage />);
  expect((await screen.findByRole('link', { name: '查看申請進度' })).getAttribute('href')).toBe(
    '/merchant/workspace',
  );
  expect(screen.queryByLabelText('申請場域')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '申請另一間門市' }));
  expect(screen.getByLabelText('申請場域')).toBeTruthy();
});

it('shows existing applications independently of open enrollment and offers account recovery', async () => {
  mocks.request.mockImplementation((path) => {
    if (path === 'merchant-applications') return Promise.resolve({ applications: [application] });
    if (path === 'merchant-workspaces') return Promise.resolve({ workspaces: [] });
    throw new Error('Enrollment unavailable');
  });
  render(<MerchantLocationsPage />);
  await screen.findByRole('heading', { name: '測試餐坊／學生餐廳' });
  expect(screen.queryByLabelText('申請場域')).toBeNull();
  expect(screen.getByRole('link', { name: '申請新門市' }).getAttribute('href')).toBe(
    '/merchant/apply',
  );
  fireEvent.click(screen.getByRole('button', { name: '登出並切換店家帳號' }));
  expect(mocks.auth.logout).toHaveBeenCalledOnce();
});

it('submits only the applicant information and displays the confirmed receipt', async () => {
  render(<MerchantWorkspace />);
  await fillApplication();
  fireEvent.click(screen.getByRole('button', { name: '送出進駐申請' }));
  await screen.findByText('申請已收件。審核通過後仍需完成營運設定，才會開放店家服務。');
  const submission = mocks.request.mock.calls.find((call) => call[2]);
  expect(submission?.[0]).toBe('merchant-applications');
  expect(submission?.[1]).toBe('context-a');
  expect(submission?.[2]).toMatchObject({
    tenantId: 'campus-one',
    campusId: 'main-campus',
    legalName: '測試商號',
    serviceModes: ['pickup'],
  });
  expect(submission?.[2]).not.toHaveProperty('role');
  expect(submission?.[2]).not.toHaveProperty('platformAccountId');
  expect(screen.getByRole('heading', { name: '測試餐坊／學生餐廳' })).toBeTruthy();
  expect(screen.queryByLabelText('對外品牌名稱')).toBeNull();
  expect(screen.getByRole('link', { name: '申請新門市' }).getAttribute('href')).toBe(
    '/merchant/apply',
  );
});
it('keeps exactly the same request and idempotency key after an uncertain response', async () => {
  let attempts = 0;
  mocks.request.mockImplementation((path, context, input) =>
    input && ++attempts === 1
      ? Promise.reject(new Error('timeout after sending'))
      : respond(path, context, input),
  );
  render(<MerchantWorkspace />);
  await fillApplication();
  fireEvent.click(screen.getByRole('button', { name: '送出進駐申請' }));
  await screen.findByText(/尚未確認是否收件/);
  expect(
    (screen.getByLabelText('對外品牌名稱').closest('fieldset') as HTMLFieldSetElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重試同一份申請' }));
  await screen.findByText(/申請已收件/);
  const submissions = mocks.request.mock.calls.filter((call) => call[2]);
  expect(submissions).toHaveLength(2);
  expect(submissions[0][2]).toEqual(submissions[1][2]);
  expect(screen.getAllByRole('heading', { name: '測試餐坊／學生餐廳' })).toHaveLength(1);
});
it('keeps a rejected draft editable and validates service modes before sending', async () => {
  mocks.request.mockImplementation((path, context, input) =>
    input ? Promise.reject(new NuniError(422, 'INVALID_INPUT')) : respond(path, context, input),
  );
  render(<MerchantWorkspace />);
  await fillApplication();
  fireEvent.click(screen.getByRole('button', { name: '送出進駐申請' }));
  await screen.findByText(/申請未被接受/);
  expect(
    (screen.getByLabelText('對外品牌名稱').closest('fieldset') as HTMLFieldSetElement).disabled,
  ).toBe(false);
  expect((screen.getByLabelText('對外品牌名稱') as HTMLInputElement).value).toBe('測試餐坊');
  fireEvent.click(screen.getByLabelText('外帶自取'));
  fireEvent.click(screen.getByRole('button', { name: '送出進駐申請' }));
  await screen.findByText(/至少選擇一種服務方式/);
  expect(mocks.request.mock.calls.filter((call) => call[2])).toHaveLength(1);
});
it('requires a new campus selection when the application program changes', async () => {
  render(<MerchantWorkspace />);
  await fillApplication();
  fireEvent.change(screen.getByLabelText('申請場域'), { target: { value: 'campus-two' } });
  expect((screen.getByLabelText('校區／營運區域') as HTMLSelectElement).value).toBe('');
  expect(screen.queryByRole('option', { name: '主校區' })).toBeNull();
});
it('does not describe a partial load failure as no applications or no permissions', async () => {
  mocks.request.mockImplementation((path, context, input) =>
    path === 'merchant-workspaces'
      ? Promise.reject(new Error('offline'))
      : respond(path, context, input),
  );
  render(<MerchantWorkspace />);
  await screen.findByRole('alert');
  expect(screen.queryByText('你還沒有送出進駐申請。')).toBeNull();
  expect(screen.queryByRole('button', { name: '送出進駐申請' })).toBeNull();
  expect(screen.queryByRole('region', { name: '開始申請第一間門市' })).toBeNull();
  mocks.request.mockImplementation(respond);
  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  await screen.findByText('你還沒有送出進駐申請。');
});
it('clears account drafts and ignores a prior account response after switching', async () => {
  let resolveOld!: (value: unknown) => void;
  mocks.request.mockImplementation((path, context, input) =>
    input
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : respond(path, context, input),
  );
  const view = render(<MerchantWorkspace />);
  await fillApplication();
  fireEvent.click(screen.getByRole('button', { name: '送出進駐申請' }));
  mocks.auth.session = { platformAccountId: 'account-b', context: 'context-b' };
  view.rerender(<MerchantWorkspace />);
  await screen.findByText('你還沒有送出進駐申請。');
  expect((screen.getByLabelText('對外品牌名稱') as HTMLInputElement).value).toBe('');
  await act(async () => resolveOld(application));
  expect(screen.queryByRole('heading', { name: '測試餐坊／學生餐廳' })).toBeNull();
});
it('hides private data and forms while the current session is being verified', async () => {
  const view = render(<MerchantWorkspace />);
  await fillApplication();
  mocks.auth.loading = true;
  view.rerender(<MerchantWorkspace />);
  expect(screen.queryByLabelText('對外品牌名稱')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('正在核對帳號資料');
  mocks.auth.pendingLogout = true;
  view.rerender(<MerchantWorkspace />);
  expect(screen.getByRole('link', { name: '登入或建立帳號' })).toBeTruthy();
});
it('does not retain a form after a session change error', async () => {
  mocks.request.mockImplementation((path, context, input) =>
    input ? Promise.reject(new NuniError(409, 'SESSION_CHANGED')) : respond(path, context, input),
  );
  render(<MerchantWorkspace />);
  await fillApplication();
  fireEvent.click(screen.getByRole('button', { name: '送出進駐申請' }));
  await waitFor(() => expect(mocks.auth.refresh).toHaveBeenCalledOnce());
  expect(screen.queryByLabelText('聯絡信箱')).toBeNull();
});
it('shows review instructions and actual authorized location readiness', async () => {
  mocks.request.mockImplementation((path, context, input) => {
    if (path === 'merchant-applications')
      return Promise.resolve({
        applications: [
          { ...application, state: 'needs-information', reviewerNote: '請補營業登記資料' },
        ],
      });
    if (path === 'merchant-workspaces')
      return Promise.resolve({
        workspaces: [
          {
            tenantId: 'campus-one',
            tenantName: '開放申請校園',
            merchantName: '已核准餐坊',
            locationId: 'location-1',
            locationName: '一樓',
            campusName: '主校區',
            merchantStatus: 'suspended',
            locationStatus: 'suspended',
            activated: false,
            publicAccess: false,
            missingRequirements: ['settings', 'menu'],
          },
        ],
      });
    return respond(path, context, input);
  });
  render(<MerchantWorkspace />);
  await screen.findByText('審核說明：請補營業登記資料');
  expect(screen.getByRole('region', { name: '1 筆申請需要補件' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看申請進度' }).getAttribute('href')).toBe(
    '#merchant-applications-title',
  );
  expect(screen.queryByLabelText('申請場域')).toBeNull();
  const locations = screen.getByRole('region', { name: '已授權門市' });
  expect(within(locations).getByText('已核准，待完成營運設定')).toBeTruthy();
  expect(within(locations).getByText(/待完成：確認營運設定與條款、建立菜單/)).toBeTruthy();
  expect(within(locations).queryByText('營業中')).toBeNull();
  fireEvent.click(within(locations).getByRole('link', { name: '管理門市：一樓' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      'merchant-workspaces/campus-one/location-1',
      'context-a',
      undefined,
      undefined,
    ),
  );
  expect(screen.queryByRole('heading', { name: '申請進駐' })).toBeNull();
});
it('sends one mutation while a submission is already in flight', async () => {
  let complete!: (value: unknown) => void;
  mocks.request.mockImplementation((path, context, input) =>
    input
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : respond(path, context, input),
  );
  render(<MerchantWorkspace />);
  await fillApplication();
  const form = screen.getByRole('button', { name: '送出進駐申請' }).closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mocks.request.mock.calls.filter((call) => call[2])).toHaveLength(1);
  await act(async () => complete(application));
  await screen.findByText(/申請已收件/);
});
it('can reload after a session error even when verification keeps the same account context', async () => {
  mocks.request.mockImplementation((path, context, input) =>
    input ? Promise.reject(new NuniError(409, 'SESSION_CHANGED')) : respond(path, context, input),
  );
  render(<MerchantWorkspace />);
  await fillApplication();
  fireEvent.click(screen.getByRole('button', { name: '送出進駐申請' }));
  await screen.findByText('登入或帳號已變更，這次店家資料與草稿已清除。');
  mocks.request.mockImplementation(respond);
  fireEvent.click(screen.getByRole('button', { name: '重新載入店家資料' }));
  await screen.findByText('你還沒有送出進駐申請。');
  expect((screen.getByLabelText('聯絡信箱') as HTMLInputElement).value).toBe('');
});

it('keeps an uncertain application locked when the program closes before retry', async () => {
  let writes = 0;
  mocks.request.mockImplementation((path: string, context: string, input?: unknown) =>
    input
      ? Promise.reject(new NuniError(++writes === 1 ? 502 : 404, 'UPSTREAM_ERROR'))
      : respond(path, context),
  );
  render(<MerchantWorkspace />);
  await fillApplication();
  fireEvent.click(screen.getByRole('button', { name: '送出進駐申請' }));
  await screen.findByText(/尚未確認是否收件/);
  fireEvent.click(screen.getByRole('button', { name: '重試同一份申請' }));
  await waitFor(() => expect(writes).toBe(2));
  await screen.findByText(/尚未確認是否收件/);
  expect(screen.getByLabelText('對外品牌名稱').closest('fieldset')?.disabled).toBe(true);
  expect(screen.queryByText(/申請未被接受/)).toBeNull();
  const requests = mocks.request.mock.calls.filter((call) => call[2]);
  expect(requests[1][2]).toEqual(requests[0][2]);
});

it('retains an uncertain menu through a session network error, but clears it for a different verified account', async () => {
  const detail = {
    tenantId: 'campus-one',
    tenantName: '開放申請校園',
    merchantName: '已核准餐坊',
    locationId: 'location-1',
    locationName: '一樓',
    campusName: '主校區',
    merchantStatus: 'suspended',
    locationStatus: 'suspended',
    activated: false,
    publicAccess: false,
    missingRequirements: ['settings', 'menu'],
    applicationId: 'application-1',
    merchantId: 'merchant-1',
    campusId: 'main-campus',
    serviceModes: ['pickup'],
    paymentMode: 'counter-only',
    onlinePaymentAvailable: false,
    paymentCapabilityState: 'not-requested',
    managerConfirmed: false,
    termsVersion: null,
    readinessVersion: 1,
    publishedMenuItems: 0,
    merchantMode: 'info_only',
    merchantModeLabel: '資訊展示',
    sourceLabel: '',
    sourceUpdatedAt: null,
    sourceLine: null,
  };
  mocks.request.mockImplementation((path, context, input) => {
    if (path.endsWith('/initial-menu')) return Promise.reject(new NuniError(0, 'NETWORK_ERROR'));
    if (path === 'merchant-workspaces') return Promise.resolve({ workspaces: [detail] });
    if (path === 'merchant-workspaces/campus-one/location-1') return Promise.resolve(detail);
    return respond(path, context, input);
  });
  const view = render(<MerchantWorkspace />);
  fireEvent.click(await screen.findByRole('link', { name: '管理門市：一樓' }));
  await screen.findByLabelText('品項 1 名稱');
  for (const [label, value] of [
    ['品項 1 名稱', '保留便當'],
    ['品項 1 售價（元）', '85'],
    ['品項 1 初始庫存', '20'],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByLabelText(/我已確認品項、元售價/));
  fireEvent.click(screen.getByRole('button', { name: '確認建立並上架菜單' }));
  await screen.findByText(/尚未確認這次操作的結果/);
  mocks.auth.session = null;
  mocks.auth.error = '無法確認登入狀態';
  view.rerender(<MerchantWorkspace />);
  expect(screen.queryByLabelText('品項 1 名稱')).toBeNull();
  mocks.auth.session = { platformAccountId: 'account-a', context: 'renewed-context' };
  mocks.auth.error = '';
  view.rerender(<MerchantWorkspace />);
  await screen.findByLabelText('品項 1 名稱');
  expect((screen.getByLabelText('品項 1 名稱') as HTMLInputElement).value).toBe('保留便當');
  expect(
    (screen.getByRole('button', { name: '確認建立並上架菜單' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.submit(screen.getByLabelText('品項 1 名稱').closest('form')!);
  expect(mocks.request.mock.calls.filter(([path]) => path.endsWith('/initial-menu'))).toHaveLength(
    1,
  );
  mocks.auth.session = { platformAccountId: 'account-b', context: 'other-context' };
  view.rerender(<MerchantWorkspace />);
  await screen.findByLabelText('品項 1 名稱');
  expect((screen.getByLabelText('品項 1 名稱') as HTMLInputElement).value).toBe('');
});

it.each(['approved', 'under-review'])(
  'offers same-campus management from a %s application',
  async (state) => {
    const workspace = {
      tenantId: 'campus-one',
      tenantName: '第一校園',
      merchantName: '餐坊',
      locationId: 'location-1',
      locationName: '第一門市',
      campusName: '主校區',
      merchantStatus: 'suspended',
      locationStatus: 'suspended',
      activated: false,
      publicAccess: false,
      missingRequirements: ['menu'],
    };
    mocks.request.mockImplementation((path, context, input) => {
      if (path === 'merchant-applications')
        return Promise.resolve({ applications: [{ ...application, state }] });
      if (path === 'merchant-workspaces')
        return Promise.resolve({
          workspaces: [
            { ...workspace, tenantId: 'campus-two', locationId: 'other', locationName: '第二門市' },
            workspace,
          ],
        });
      return respond(path, context, input);
    });
    render(<MerchantLocationsPage />);
    await screen.findByText('測試餐坊／學生餐廳');
    const applications = screen.getByRole('region', { name: '申請進度' });
    expect(within(applications).queryByRole('link', { name: '前往管理門市：第二門市' })).toBeNull();
    const link = within(applications).queryByRole('link', { name: '前往管理門市：第一門市' });
    if (state !== 'approved') {
      expect(link).toBeNull();
      return;
    }
    fireEvent.click(link!);
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        'merchant-workspaces/campus-one/location-1',
        'context-a',
        undefined,
        undefined,
      ),
    );
  },
);

it('explains how to continue when an approved application has no same-campus workspace', async () => {
  mocks.request.mockImplementation((path, context, input) =>
    path === 'merchant-applications'
      ? Promise.resolve({ applications: [{ ...application, state: 'approved' }] })
      : respond(path, context, input),
  );
  render(<MerchantLocationsPage />);
  await screen.findByText('這個場域的門市尚未出現在清單，請重新載入；若仍未出現，請聯絡受理單位。');
  expect(screen.getByRole('heading', { name: '申請已核准，等待門市權限' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /前往管理門市/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.filter(([path]) => path === 'merchant-workspaces'),
    ).toHaveLength(2),
  );
});

it.each(['submitted', 'under-review'])(
  'keeps a returning %s applicant on progress instead of reopening the enrollment form',
  async (state) => {
    mocks.request.mockImplementation((path, context, input) =>
      path === 'merchant-applications'
        ? Promise.resolve({ applications: [{ ...application, state }] })
        : respond(path, context, input),
    );
    render(<MerchantWorkspace />);
    await screen.findByRole('heading', { name: '查看這次進駐申請' });
    expect(screen.queryByRole('heading', { name: '店家如何進駐' })).toBeNull();
    expect(screen.queryByLabelText('申請場域')).toBeNull();
    expect(screen.getByRole('link', { name: '查看申請進度' }).getAttribute('href')).toBe(
      '#merchant-applications-title',
    );
    expect(mocks.request.mock.calls.filter((call) => call[2])).toHaveLength(0);
  },
);

it('keeps an in-progress application editable when refreshing reveals another application', async () => {
  render(<MerchantWorkspace />);
  await fillApplication();
  mocks.request.mockImplementation((path, context, input) =>
    path === 'merchant-applications'
      ? Promise.resolve({ applications: [{ ...application, applicationId: 'other-application' }] })
      : respond(path, context, input),
  );
  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  await screen.findByRole('heading', { name: '查看這次進駐申請' });
  expect((screen.getByLabelText('對外品牌名稱') as HTMLInputElement).value).toBe('測試餐坊');
  expect(screen.getByRole('button', { name: '送出進駐申請' })).toBeTruthy();
  expect(mocks.request.mock.calls.filter((call) => call[2])).toHaveLength(0);
});

it('prioritizes the actual authorized store for a returning operator and retains it after a failed refresh', async () => {
  const workspace = {
    tenantId: 'campus-one',
    tenantName: '第一校園',
    merchantName: '餐坊',
    locationId: 'location-1',
    locationName: '第一門市',
    campusName: '主校區',
    merchantStatus: 'active',
    locationStatus: 'open',
    activated: true,
    publicAccess: true,
    missingRequirements: [],
  };
  mocks.request.mockImplementation((path, context, input) =>
    path === 'merchant-workspaces'
      ? Promise.resolve({ workspaces: [workspace] })
      : respond(path, context, input),
  );
  render(<MerchantWorkspace />);
  await screen.findByRole('heading', { name: '開始今天的門市工作' });
  expect(screen.getByRole('link', { name: '選擇門市' }).getAttribute('href')).toBe(
    '#merchant-locations-title',
  );
  expect(screen.getByRole('link', { name: '管理門市：第一門市' })).toBeTruthy();
  expect(screen.queryByLabelText('申請場域')).toBeNull();
  mocks.request.mockRejectedValue(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('heading', { name: '開始今天的門市工作' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '管理門市：第一門市' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '開始申請第一間門市' })).toBeNull();
});

const continuityStore = {
  tenantId: 'campus-one',
  tenantName: '第一校園',
  merchantName: '餐坊',
  locationId: 'location-1',
  locationName: '第一門市',
  campusName: '主校區',
  merchantStatus: 'active',
  locationStatus: 'open',
  activated: true,
  publicAccess: true,
  missingRequirements: [],
  applicationId: 'application-1',
  merchantId: 'merchant-1',
  campusId: 'main-campus',
  serviceModes: ['pickup'],
  paymentMode: 'counter-only',
  onlinePaymentAvailable: false,
  paymentCapabilityState: 'not-requested',
  managerConfirmed: true,
  termsVersion: 'merchant-terms-v1',
  readinessVersion: 1,
  publishedMenuItems: 1,
  merchantMode: 'full',
  merchantModeLabel: '接單服務',
  sourceLabel: '',
  sourceUpdatedAt: null,
  sourceLine: null,
};

it('keeps an application receipt received inside a store across stale list reloads', async () => {
  window.history.replaceState(null, '', '/merchant');
  let showStore = false;
  let finishApplication!: (receipt: typeof application) => void;
  const receipt = new Promise<typeof application>((resolve) => {
    finishApplication = resolve;
  });
  mocks.request.mockImplementation((path, context, input) => {
    if (path === 'merchant-applications' && input) return receipt;
    if (path === 'merchant-workspaces' && showStore)
      return Promise.resolve({ workspaces: [continuityStore] });
    if (path === 'merchant-workspaces/campus-one/location-1')
      return Promise.resolve(continuityStore);
    return respond(path, context, input);
  });

  render(<MerchantWorkspace />);
  await fillApplication();
  showStore = true;
  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  const storeLink = await screen.findByRole('link', { name: '管理門市：第一門市' });
  fireEvent.click(screen.getByRole('button', { name: '送出進駐申請' }));
  await screen.findByRole('button', { name: '正在確認收件…' });
  fireEvent.click(storeLink);
  await screen.findByRole('heading', { name: '餐坊／第一門市', level: 2 });
  await act(async () => finishApplication(application));

  fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
  await waitFor(() => expect(screen.queryByText('正在載入店家資料…')).toBeNull());
  expect(screen.getByRole('heading', { name: '測試餐坊／學生餐廳' })).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新載入' })));
  expect(screen.getByRole('heading', { name: '測試餐坊／學生餐廳' })).toBeTruthy();
});

it.each([
  { scenario: 'no programs remain open', refreshedPrograms: [] },
  { scenario: 'only another program remains open', refreshedPrograms: programs.slice(1) },
  { scenario: 'the return read temporarily fails', refreshedPrograms: null },
  { scenario: 'the programs endpoint returns 404', refreshedPrograms: null, programStatus: 404 },
  { scenario: 'the programs endpoint returns 403', refreshedPrograms: null, programStatus: 403 },
])('retries after a store visit when $scenario', async ({ refreshedPrograms, programStatus }) => {
  window.history.replaceState(null, '', '/merchant');
  let showStore = false;
  let openPrograms: typeof programs | null = programs;
  let submissionAttempts = 0;
  mocks.request.mockImplementation((path, context, input) => {
    if (path === 'merchant-applications' && input && ++submissionAttempts === 1) {
      return Promise.reject(new NuniError(0, 'NETWORK_ERROR'));
    }
    if (path === 'merchant-onboarding-programs')
      return openPrograms
        ? Promise.resolve({ programs: openPrograms })
        : Promise.reject(new NuniError(programStatus ?? 0, 'UPSTREAM_ERROR'));
    if (path === 'merchant-applications' && !input && showStore)
      return Promise.resolve({ applications: [application] });
    if (path === 'merchant-workspaces' && showStore)
      return Promise.resolve({ workspaces: [continuityStore] });
    if (path === 'merchant-workspaces/campus-one/location-1')
      return Promise.resolve(continuityStore);
    return respond(path, context, input);
  });
  render(<MerchantWorkspace />);
  await fillApplication();
  showStore = true;
  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  const openStore = async () => {
    fireEvent.click(await screen.findByRole('link', { name: '管理門市：第一門市' }));
    expect(window.location.pathname + window.location.search).toBe(
      '/merchant/workspace?tenant=campus-one&location=location-1',
    );
    await screen.findByRole('heading', { name: '餐坊／第一門市', level: 2 });
    expect(screen.queryByLabelText('對外品牌名稱')).toBeNull();
  };

  await openStore();
  await act(async () => window.history.back());
  const brand = (await screen.findByLabelText('對外品牌名稱')) as HTMLInputElement;
  expect(window.location.pathname).toBe('/merchant');
  expect(brand.value).toBe('測試餐坊');
  fireEvent.change(brand, { target: { value: '更新餐坊' } });
  const submit = screen.getByRole('button', { name: '送出進駐申請' });
  await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false));
  fireEvent.click(submit);
  await screen.findByText(/尚未確認是否收件/);

  await openStore();
  openPrograms = refreshedPrograms;
  const programReads = () =>
    mocks.request.mock.calls.filter(([path]) => path === 'merchant-onboarding-programs').length;
  const readsBeforeReturn = programReads();
  fireEvent.click(screen.getByRole('link', { name: '返回我的門市' }));
  expect(window.location.pathname).toBe('/merchant');
  await waitFor(() => expect(programReads()).toBe(readsBeforeReturn + 1));
  if (!refreshedPrograms) await screen.findByText('目前無法確認店家資料，請重新載入。');
  expect(screen.getByRole('link', { name: '管理門市：第一門市' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '測試餐坊／學生餐廳' })).toBeTruthy();
  await screen.findByText(/尚未確認是否收件/);
  expect((screen.getByLabelText('對外品牌名稱') as HTMLInputElement).value).toBe('更新餐坊');
  const retry = screen.getByRole('button', { name: '重試同一份申請' });
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
  fireEvent.click(retry);
  await screen.findByText(/申請已收件/);
  const writes = mocks.request.mock.calls.filter((call) => call[2]);
  expect(writes).toHaveLength(2);
  expect(writes[0][2]).toMatchObject({ brandName: '更新餐坊' });
  expect(writes[1][2]).toEqual(writes[0][2]);
});

it.each([
  { status: 403, code: 'FORBIDDEN', message: '目前無法確認店家資料，請重新載入。' },
  { status: 404, code: 'NOT_FOUND', message: '目前無法確認店家資料，請重新載入。' },
  { status: 401, code: 'UNAUTHORIZED', message: '登入或帳號已變更，這次店家資料與草稿已清除。' },
  { status: 409, code: 'SESSION_CHANGED', message: '登入或帳號已變更，這次店家資料與草稿已清除。' },
])(
  'clears the overview when workspaces returns $code and programs returns 404',
  async ({ status, code, message }) => {
    let reload = false;
    mocks.request.mockImplementation((path) => {
      if (reload && path === 'merchant-onboarding-programs')
        return Promise.reject(new NuniError(404, 'NOT_FOUND'));
      if (reload && path === 'merchant-workspaces')
        return Promise.reject(new NuniError(status, code));
      if (path === 'merchant-applications') return Promise.resolve({ applications: [application] });
      return respond(path);
    });
    render(<MerchantWorkspace />);
    await screen.findByRole('heading', { name: '測試餐坊／學生餐廳' });
    reload = true;
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
    await screen.findByText(message);
    expect(screen.queryByRole('heading', { name: '測試餐坊／學生餐廳' })).toBeNull();
  },
);
