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
  if (input) return Promise.resolve(application);
  if (path === 'merchant-onboarding-programs') return Promise.resolve({ programs });
  if (path === 'merchant-applications') return Promise.resolve({ applications: [] });
  if (path === 'merchant-workspaces') return Promise.resolve({ workspaces: [] });
  return Promise.reject(new Error(`Unexpected ${path}`));
}
beforeEach(() => {
  vi.clearAllMocks();
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
  expect((screen.getByLabelText('對外品牌名稱') as HTMLInputElement).value).toBe('');
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
  expect(screen.getByRole('status').textContent).toContain('店家資料暫時隱藏');
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
  const locations = screen.getByRole('region', { name: '已授權門市' });
  expect(within(locations).getByText('已核准，待完成營運設定')).toBeTruthy();
  expect(within(locations).getByText(/待完成：確認營運設定與條款、建立菜單/)).toBeTruthy();
  expect(within(locations).queryByText('營業中')).toBeNull();
  fireEvent.click(within(locations).getByRole('button', { name: '管理門市：一樓' }));
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
  fireEvent.click(await screen.findByRole('button', { name: '管理門市：一樓' }));
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
  fireEvent.click(await screen.findByRole('button', { name: '管理門市：一樓' }));
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
  fireEvent.click(await screen.findByRole('button', { name: '管理門市：一樓' }));
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
    expect(
      within(applications).queryByRole('button', { name: '前往管理門市：第二門市' }),
    ).toBeNull();
    const link = within(applications).queryByRole('button', { name: '前往管理門市：第一門市' });
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
  expect(screen.queryByRole('button', { name: /前往管理門市/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.filter(([path]) => path === 'merchant-workspaces'),
    ).toHaveLength(2),
  );
});
