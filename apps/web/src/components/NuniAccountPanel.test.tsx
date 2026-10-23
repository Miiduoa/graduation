import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { NuniAccountPanel } from './NuniAccountPanel';
import { IDENTITY_NO_TEACHING_COPY } from '@/lib/accountIdentity';
const mocks = vi.hoisted(() => ({
  account: {
    session: {
      platformAccountId: 'account-a',
      context: 'context-a',
      isPlatformOperator: false,
    } as null | { platformAccountId: string; context: string; isPlatformOperator: boolean },
    loading: false,
    pendingLogout: false,
    error: '',
    refresh: vi.fn(),
    logout: vi.fn(),
  },
  request: vi.fn(),
  memberships: [] as unknown[],
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => mocks.account,
  browserRequest: mocks.request,
}));
const membership = (name: string, state = 'verified') => ({
  membershipId: `member-${name}`,
  tenantId: `tenant-${name}`,
  campusName: name,
  state,
  assurance: 'server-verified-evidence',
});
function nuniPayload(path: string) {
  if (path === 'memberships') return { memberships: mocks.memberships };
  if (path === 'class-workspaces') return { workspaces: [] };
  if (path === 'merchant-applications') return { applications: [] };
  if (path === 'merchant-workspaces') return { workspaces: [] };
  throw new Error(path);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.memberships = [];
  mocks.account.session = {
    platformAccountId: 'account-a',
    context: 'context-a',
    isPlatformOperator: false,
  };
  mocks.account.loading = false;
  mocks.account.pendingLogout = false;
  mocks.account.error = '';
  mocks.request.mockImplementation(async (path: string) => nuniPayload(path));
});
it('shows each school qualification from the authenticated account without granting a role', async () => {
  mocks.memberships = [
    membership('甲校'),
    membership('乙校', 'pending'),
    membership('丙校', 'rejected'),
    membership('丁校', 'revoked'),
  ];
  render(<NuniAccountPanel />);
  await screen.findByText('甲校');
  expect(mocks.request).toHaveBeenCalledWith('memberships', 'context-a');
  for (const [school, label] of [
    ['甲校', '已驗證'],
    ['乙校', '待驗證'],
    ['丙校', '未通過'],
    ['丁校', '已撤銷'],
  ]) {
    expect(screen.getByText(school).closest('li')?.textContent).toBe(`${school}${label}`);
  }
  expect(screen.getByText(/切換瀏覽校園不會加入該校/)).toBeTruthy();
  expect(screen.queryByText('server-verified-evidence')).toBeNull();
  expect(screen.queryByRole('button', { name: /加入|授權|教師|學生/ })).toBeNull();
  expect(screen.getByRole('link', { name: '店家合作' }).getAttribute('href')).toBe('/merchant');
  expect(screen.queryByText(/連線學校帳號/)).toBeNull();
  expect(await screen.findByRole('heading', { name: '我的身分' })).toBeTruthy();
  expect(await screen.findByText(IDENTITY_NO_TEACHING_COPY)).toBeTruthy();
});
it('hides the previous qualifications during refresh and does not turn a read failure into an empty account', async () => {
  let fail!: (error: unknown) => void;
  mocks.memberships = [membership('甲校')];
  render(<NuniAccountPanel />);
  await screen.findByText('甲校');
  mocks.request.mockImplementation((path: string) => {
    if (path === 'memberships')
      return new Promise((_resolve, reject) => {
        fail = reject;
      });
    return Promise.resolve(nuniPayload(path));
  });
  fireEvent.click(screen.getByRole('button', { name: '更新學校資格' }));
  expect(screen.queryByText('甲校')).toBeNull();
  expect(screen.getByText('正在確認學校資格…')).toBeTruthy();
  await act(async () => fail(new Error('offline')));
  expect(screen.getByRole('alert').textContent).toContain('目前無法讀取學校資格');
  expect(screen.queryByText(/目前沒有學校資格紀錄/)).toBeNull();
  mocks.memberships = [];
  mocks.request.mockImplementation(async (path: string) => nuniPayload(path));
  fireEvent.click(screen.getByRole('button', { name: '重新讀取學校資格' }));
  await screen.findByText(/目前沒有學校資格紀錄/);
});
it('never displays an old account result after the account or its context changes', async () => {
  let finish!: (value: unknown) => void;
  mocks.request.mockImplementation((path: string) => {
    if (path === 'memberships' && mocks.account.session?.context === 'context-a')
      return new Promise((resolve) => {
        finish = resolve;
      });
    return Promise.resolve(nuniPayload(path));
  });
  const view = render(<NuniAccountPanel />);
  mocks.memberships = [membership('乙校')];
  mocks.account.session = {
    platformAccountId: 'account-b',
    context: 'context-b',
    isPlatformOperator: false,
  };
  view.rerender(<NuniAccountPanel />);
  await screen.findByText('乙校');
  await act(async () => finish({ memberships: [membership('甲校')] }));
  expect(screen.queryByText('甲校')).toBeNull();
  expect(mocks.request).toHaveBeenCalledWith('memberships', 'context-b');
  mocks.memberships = [membership('丙校')];
  mocks.account.session = { ...mocks.account.session, context: 'context-b-renewed' };
  view.rerender(<NuniAccountPanel />);
  expect(screen.queryByText('乙校')).toBeNull();
  await screen.findByText('丙校');
});
it('masks memberships while revalidating and clears them on logout', async () => {
  mocks.memberships = [membership('甲校')];
  const view = render(<NuniAccountPanel />);
  await screen.findByText('甲校');
  mocks.account.loading = true;
  view.rerender(<NuniAccountPanel />);
  expect(screen.queryByText('甲校')).toBeNull();
  expect(screen.queryByRole('region', { name: '學校資格' })).toBeNull();
  mocks.account.loading = false;
  mocks.account.pendingLogout = true;
  view.rerender(<NuniAccountPanel />);
  expect(screen.queryByText('甲校')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重試登出 Google 帳號' }));
  expect(mocks.account.logout).toHaveBeenCalledOnce();
});
it('clears a session-change response and requests explicit account verification without a retry loop', async () => {
  mocks.request.mockRejectedValue(new NuniError(409, 'SESSION_CHANGED'));
  render(<NuniAccountPanel />);
  await screen.findByText('登入已失效或帳號已變更，學校資格已隱藏。');
  expect(mocks.request).toHaveBeenCalled();
  expect(mocks.account.refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重新確認帳號' }));
  expect(mocks.account.refresh).toHaveBeenCalledOnce();
});
it('rejects malformed qualifications without displaying a partly parsed result', async () => {
  mocks.memberships = [membership('甲校'), membership('乙校', 'admin')];
  render(<NuniAccountPanel />);
  await screen.findByText('目前無法讀取學校資格，請稍後再試。');
  expect(screen.queryByText('甲校')).toBeNull();
});
it('does not fetch protected membership data for a guest or an unresolved account', () => {
  mocks.account.session = null;
  const view = render(<NuniAccountPanel />);
  expect(mocks.request).not.toHaveBeenCalled();
  mocks.account.session = {
    platformAccountId: 'account-a',
    context: 'context-a',
    isPlatformOperator: true,
  };
  mocks.account.error = '無法確認帳號';
  view.rerender(<NuniAccountPanel />);
  expect(mocks.request).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: /平台管理/ })).toBeNull();
});
