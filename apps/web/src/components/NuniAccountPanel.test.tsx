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
const receipt = {
  membershipId: 'pm_11111111-1111-4111-8111-111111111111',
  tenantId: 'school-a',
  state: 'pending',
  created: true,
};
function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function writes() {
  return mocks.request.mock.calls.filter((call) => call[2] !== undefined);
}
function reads() {
  return mocks.request.mock.calls.filter(
    (call) => call[0] === 'memberships' && call[2] === undefined,
  );
}
function fill() {
  fireEvent.change(screen.getByLabelText('學校配發的電子郵件'), {
    target: { value: 'Student@school.edu.tw' },
  });
}
function submit() {
  fireEvent.submit(screen.getByRole('form', { name: '申請學校資格' }));
}
async function ready() {
  const view = render(<NuniAccountPanel />);
  await screen.findByRole('form', { name: '申請學校資格' });
  return view;
}
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
  mocks.account.refresh.mockReset().mockResolvedValue(undefined);
  mocks.account.logout.mockReset().mockResolvedValue(undefined);
  mocks.request
    .mockReset()
    .mockImplementation(async (path: string, _context, input) =>
      input ? receipt : nuniPayload(path),
    );
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
  expect(screen.getByText('甲校').closest('[hidden]')?.hasAttribute('inert')).toBe(true);
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

it('retains a confirmed draft while background verification hides and blocks its old controls', async () => {
  const view = await ready();
  fill();
  const form = screen.getByRole('form', { name: '申請學校資格' });
  const update = screen.getByRole('button', { name: '更新學校資格' });
  const before = mocks.request.mock.calls.length;
  mocks.account.loading = true;
  view.rerender(<NuniAccountPanel />);
  expect(screen.queryByRole('form')).toBeNull();
  expect(screen.getByRole('form', { name: '申請學校資格', hidden: true })).toBe(form);
  expect(form.closest('[hidden]')?.hasAttribute('inert')).toBe(true);
  expect((form.closest('[hidden]') as HTMLElement).style.display).toBe('none');
  expect(screen.queryByText('Google 帳號已登入')).toBeNull();
  fireEvent.submit(form);
  fireEvent.click(update);
  expect(mocks.request).toHaveBeenCalledTimes(before);
  expect(writes()).toHaveLength(0);
  mocks.account.loading = false;
  view.rerender(<NuniAccountPanel />);
  expect(screen.getByRole('form', { name: '申請學校資格' })).toBe(form);
  expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).value).toBe(
    'Student@school.edu.tw',
  );
  expect(reads()).toHaveLength(1);
  expect(writes()).toHaveLength(0);
});

it('retains the pending submission lock after returning from same-scope background verification', async () => {
  const view = await ready();
  const pending = deferred();
  mocks.request.mockImplementationOnce(() => pending.promise);
  fill();
  submit();
  mocks.account.loading = true;
  view.rerender(<NuniAccountPanel />);
  mocks.account.loading = false;
  view.rerender(<NuniAccountPanel />);
  const form = screen.getByRole('form', { name: '申請學校資格' });
  expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).disabled).toBe(true);
  fireEvent.submit(form);
  expect(writes()).toHaveLength(1);
  await act(async () => pending.resolve(receipt));
  await screen.findByText(/申請已收件，等待學校驗證/);
});

it.each(['receipt', 'unknown'] as const)(
  'retains a pending response that becomes %s while the confirmed form is hidden',
  async (outcome) => {
    const view = await ready();
    const pending = deferred();
    mocks.request.mockImplementationOnce(() => pending.promise);
    fill();
    submit();
    mocks.account.loading = true;
    view.rerender(<NuniAccountPanel />);
    if (outcome === 'receipt') await act(async () => pending.resolve(receipt));
    else await act(async () => pending.reject(new NuniError(0, 'NETWORK_ERROR')));
    expect(screen.queryByRole('form')).toBeNull();
    expect(writes()).toHaveLength(1);
    mocks.account.loading = false;
    view.rerender(<NuniAccountPanel />);
    if (outcome === 'receipt') {
      await screen.findByText(/申請已收件，等待學校驗證/);
      expect(reads()).toHaveLength(2);
    } else {
      await screen.findByRole('button', { name: '重試確認申請' });
      expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).value).toBe(
        'Student@school.edu.tw',
      );
      expect(reads()).toHaveLength(1);
    }
  },
);

it('preserves an unknown result through revalidation and retries only its original payload', async () => {
  const view = await ready();
  mocks.request.mockRejectedValueOnce(new NuniError(0, 'NETWORK_ERROR'));
  fill();
  submit();
  const retry = await screen.findByRole('button', { name: '重試確認申請' });
  mocks.account.loading = true;
  view.rerender(<NuniAccountPanel />);
  fireEvent.click(retry);
  fireEvent.submit(retry.closest('form')!);
  expect(writes()).toHaveLength(1);
  mocks.account.loading = false;
  view.rerender(<NuniAccountPanel />);
  expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重試確認申請' }));
  await screen.findByText(/申請已收件，等待學校驗證/);
  expect(writes()).toHaveLength(2);
  expect(writes()[1]).toEqual(writes()[0]);
});

it('does not mount private readers for an initially unconfirmed retained session', async () => {
  mocks.account.loading = true;
  const view = render(<NuniAccountPanel />);
  expect(screen.queryByRole('form', { hidden: true })).toBeNull();
  expect(mocks.request).not.toHaveBeenCalled();
  mocks.account.loading = false;
  view.rerender(<NuniAccountPanel />);
  await screen.findByRole('form', { name: '申請學校資格' });
  expect(reads()).toHaveLength(1);
});

it('unmounts identity and operator details during revalidation and rereads identity on return', async () => {
  mocks.account.session!.isPlatformOperator = true;
  const view = await ready();
  expect(await screen.findByRole('heading', { name: '我的身分' })).toBeTruthy();
  expect(screen.getByRole('link', { name: /平台管理/ })).toBeTruthy();
  mocks.account.loading = true;
  view.rerender(<NuniAccountPanel />);
  expect(screen.queryByRole('region', { name: '我的身分', hidden: true })).toBeNull();
  expect(screen.queryByRole('link', { name: /平台管理/, hidden: true })).toBeNull();
  mocks.account.session!.isPlatformOperator = false;
  mocks.account.loading = false;
  view.rerender(<NuniAccountPanel />);
  await screen.findByText(IDENTITY_NO_TEACHING_COPY);
  expect(screen.queryByRole('link', { name: /平台管理/ })).toBeNull();
  for (const path of ['class-workspaces', 'merchant-applications', 'merchant-workspaces']) {
    expect(mocks.request.mock.calls.filter((call) => call[0] === path)).toHaveLength(2);
  }
  expect(reads()).toHaveLength(1);
});

it.each(['account', 'context', 'account-aba', 'context-aba', 'guest', 'error', 'logout'])(
  'discards the hidden pending application after %s changes and ignores its late response',
  async (change) => {
    const view = await ready();
    const pending = deferred();
    mocks.request.mockImplementationOnce(() => pending.promise);
    fill();
    submit();
    mocks.account.loading = true;
    view.rerender(<NuniAccountPanel />);
    const original = { ...mocks.account.session! };
    if (change.startsWith('account')) mocks.account.session!.platformAccountId = 'account-b';
    else if (change.startsWith('context')) mocks.account.session!.context = 'context-b';
    else if (change === 'guest') mocks.account.session = null;
    else if (change === 'error') mocks.account.error = '帳號確認失敗';
    else mocks.account.pendingLogout = true;
    view.rerender(<NuniAccountPanel />);
    expect(screen.queryByRole('form', { hidden: true })).toBeNull();
    if (change.endsWith('aba')) {
      mocks.account.session = original;
      view.rerender(<NuniAccountPanel />);
      expect(screen.queryByRole('form', { hidden: true })).toBeNull();
    }
    await act(async () => pending.resolve(receipt));
    expect(screen.queryByText(/申請已收件，等待學校驗證/)).toBeNull();
    mocks.account.session = original;
    mocks.account.loading = false;
    mocks.account.pendingLogout = false;
    mocks.account.error = '';
    view.rerender(<NuniAccountPanel />);
    await screen.findByRole('form', { name: '申請學校資格' });
    expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).value).toBe('');
    expect(writes()).toHaveLength(1);
  },
);

it('ignores a late membership read after the same account/context leaves and returns', async () => {
  const pending = deferred();
  mocks.request.mockImplementation((path: string, context: string) => {
    if (path === 'memberships' && context === 'context-a') return pending.promise;
    return Promise.resolve(nuniPayload(path));
  });
  const view = render(<NuniAccountPanel />);
  const original = { ...mocks.account.session! };
  mocks.account.session = { ...original, platformAccountId: 'account-b' };
  view.rerender(<NuniAccountPanel />);
  mocks.request.mockImplementation(async (path: string) => nuniPayload(path));
  mocks.account.session = original;
  view.rerender(<NuniAccountPanel />);
  await screen.findByRole('form', { name: '申請學校資格' });
  await act(async () => pending.resolve({ memberships: [membership('舊甲校')] }));
  expect(screen.queryByText('舊甲校')).toBeNull();
});

it.each(['with-loading', 'fast'])(
  'explicit account recovery rereads expired qualifications after confirmed same-scope refresh: %s',
  async (mode) => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path === 'memberships') throw new NuniError(409, 'SESSION_CHANGED');
      return nuniPayload(path);
    });
    const refreshed = deferred();
    mocks.account.refresh.mockReturnValueOnce(refreshed.promise);
    const view = render(<NuniAccountPanel />);
    const retry = await screen.findByRole('button', { name: '重新確認帳號' });
    act(() => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(mocks.account.refresh).toHaveBeenCalledOnce();
    if (mode === 'with-loading') {
      mocks.account.loading = true;
      view.rerender(<NuniAccountPanel />);
    }
    mocks.request.mockImplementation(async (path: string) => nuniPayload(path));
    await act(async () => refreshed.resolve());
    if (mode === 'with-loading') {
      expect(reads()).toHaveLength(1);
      expect(screen.queryByRole('form')).toBeNull();
      mocks.account.loading = false;
      view.rerender(<NuniAccountPanel />);
    }
    await screen.findByRole('form', { name: '申請學校資格' });
    expect(reads()).toHaveLength(2);
    expect(writes()).toHaveLength(0);
  },
);

it('preserves the existing expired recovery after an explicit same-context loading cycle', async () => {
  mocks.request.mockImplementation(async (path: string) => {
    if (path === 'memberships') throw new NuniError(409, 'SESSION_CHANGED');
    return nuniPayload(path);
  });
  const refreshed = deferred();
  mocks.account.refresh.mockReturnValueOnce(refreshed.promise);
  const view = render(<NuniAccountPanel />);
  fireEvent.click(await screen.findByRole('button', { name: '重新確認帳號' }));
  mocks.account.loading = true;
  view.rerender(<NuniAccountPanel />);
  mocks.request.mockImplementation(async (path: string) => nuniPayload(path));
  await act(async () => refreshed.resolve());
  expect(reads()).toHaveLength(1);
  mocks.account.loading = false;
  view.rerender(<NuniAccountPanel />);
  await screen.findByRole('form', { name: '申請學校資格' });
  expect(reads()).toHaveLength(2);
});

it('keeps explicit recovery retryable after a rejected refresh without claiming success', async () => {
  mocks.request.mockImplementation(async (path: string) => {
    if (path === 'memberships') throw new NuniError(401, 'UNAUTHENTICATED');
    return nuniPayload(path);
  });
  mocks.account.refresh.mockRejectedValueOnce(new Error('synthetic failed refresh'));
  render(<NuniAccountPanel />);
  fireEvent.click(await screen.findByRole('button', { name: '重新確認帳號' }));
  await screen.findByText('目前無法重新確認帳號，請稍後再試。');
  expect(screen.queryByRole('form')).toBeNull();
  expect(reads()).toHaveLength(1);
  mocks.request.mockImplementation(async (path: string) => nuniPayload(path));
  fireEvent.click(screen.getByRole('button', { name: '重新確認帳號' }));
  await screen.findByRole('form', { name: '申請學校資格' });
  expect(reads()).toHaveLength(2);
});

it.each(['error', 'logout', 'null', 'account-aba'])(
  'does not treat a resolved recovery as authorization after %s',
  async (outcome) => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path === 'memberships') throw new NuniError(409, 'SESSION_CHANGED');
      return nuniPayload(path);
    });
    const refreshed = deferred();
    mocks.account.refresh.mockReturnValueOnce(refreshed.promise);
    const view = render(<NuniAccountPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '重新確認帳號' }));
    const original = { ...mocks.account.session! };
    mocks.account.loading = true;
    view.rerender(<NuniAccountPanel />);
    if (outcome === 'error') mocks.account.error = '帳號確認失敗';
    else if (outcome === 'logout') mocks.account.pendingLogout = true;
    else if (outcome === 'null') mocks.account.session = null;
    else mocks.account.session = { ...original, platformAccountId: 'account-b' };
    view.rerender(<NuniAccountPanel />);
    mocks.request.mockImplementation(async (path: string) => nuniPayload(path));
    if (outcome === 'account-aba') {
      mocks.account.session = original;
      mocks.account.loading = false;
      view.rerender(<NuniAccountPanel />);
      await screen.findByRole('form', { name: '申請學校資格' });
      fill();
    }
    const before = reads().length;
    await act(async () => refreshed.resolve());
    expect(reads()).toHaveLength(before);
    if (outcome === 'account-aba') {
      expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).value).toBe(
        'Student@school.edu.tw',
      );
    } else expect(screen.queryByRole('form', { hidden: true })).toBeNull();
    expect(writes()).toHaveLength(0);
  },
);
