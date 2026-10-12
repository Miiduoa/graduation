import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
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
  await screen.findByText('你還沒有送出進駐申請。');
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
