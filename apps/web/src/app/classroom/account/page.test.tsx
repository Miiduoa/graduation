import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError, type NuniPrincipal } from '@campus/shared/src/nuni';
import type { NuniMembership } from '@campus/shared/src/nuniAccount';
import ClassroomAccountPage from './page';

type AccountSession = NuniPrincipal & { context: string };

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  session: null as AccountSession | null,
  loading: false,
  pendingLogout: false,
  error: '',
  search: '',
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/classroom/account',
  useSearchParams: () => new URLSearchParams(mocks.search),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>nuni</header> }));
vi.mock('@/components/SchoolSelector', () => ({ SchoolSelector: () => null }));
vi.mock('@/components/PWAInstallBanner', () => ({ PWAInstallBanner: () => null }));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: null, loading: false, signOutUser: vi.fn() }),
  GuestAuthProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => mocks,
  browserRequest: (...args: unknown[]) => mocks.request(...args),
}));

const accountA: AccountSession = {
  platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
  context: 'a'.repeat(43),
  isPlatformOperator: false,
};
const accountB: AccountSession = {
  platformAccountId: 'pa_22222222-2222-4222-8222-222222222222',
  context: 'b'.repeat(43),
  isPlatformOperator: false,
};
const receipt = {
  membershipId: 'pm_11111111-1111-4111-8111-111111111111',
  tenantId: 'school-a',
  state: 'pending',
  created: true,
};
function membership(campusName: string, state: NuniMembership['state'] = 'verified') {
  return {
    membershipId: `member-${campusName}`,
    tenantId: `school-${campusName}`,
    campusName,
    state,
    assurance: 'synthetic-server-evidence',
  };
}
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function writes() {
  return mocks.request.mock.calls.filter((call) => call[2] !== undefined);
}
function fill(email = 'Student@school.edu.tw') {
  fireEvent.change(screen.getByLabelText('學校配發的電子郵件'), { target: { value: email } });
}
function submit() {
  fireEvent.submit(screen.getByRole('form', { name: '申請學校資格' }));
}
async function ready() {
  const view = render(<ClassroomAccountPage />);
  await screen.findByRole('form', { name: '申請學校資格' });
  return view;
}

beforeEach(() => {
  mocks.session = { ...accountA };
  mocks.loading = false;
  mocks.pendingLogout = false;
  mocks.error = '';
  mocks.search = '';
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.logout.mockReset().mockResolvedValue(undefined);
  mocks.request.mockReset().mockImplementation(async (path: string, _context, input) => {
    if (path === 'sign-in-options') return { google: true };
    if (path === 'memberships') return input ? receipt : { memberships: [] };
    throw new Error(`Unexpected account-page request: ${path}`);
  });
  window.history.replaceState({}, '', '/classroom/account');
});

it('opens school qualifications and the real application from the account route', async () => {
  await ready();
  expect(screen.getAllByRole('region', { name: '學校資格' })).toHaveLength(1);
  expect(screen.getAllByRole('form', { name: '申請學校資格' })).toHaveLength(1);
  expect(screen.getByRole('link', { name: '前往我的課程' }).getAttribute('href')).toBe(
    '/classroom',
  );
  expect(mocks.request.mock.calls).toEqual([['memberships', accountA.context]]);
  expect(writes()).toHaveLength(0);
});

it.each([false, true])(
  'keeps all four server qualification states for operator=%s',
  async (isPlatformOperator) => {
    mocks.session = { ...accountA, isPlatformOperator };
    mocks.request.mockResolvedValue({
      memberships: [
        membership('甲校', 'verified'),
        membership('乙校', 'pending'),
        membership('丙校', 'rejected'),
        membership('丁校', 'revoked'),
      ],
    });
    await ready();
    for (const [school, label] of [
      ['甲校', '已驗證'],
      ['乙校', '待驗證'],
      ['丙校', '未通過'],
      ['丁校', '已撤銷'],
    ]) {
      expect(screen.getByText(school).closest('li')?.textContent).toBe(`${school}${label}`);
    }
    expect(screen.queryByText('synthetic-server-evidence')).toBeNull();
    expect(screen.queryByRole('button', { name: /授權|教師|學生|管理員/ })).toBeNull();
    expect(writes()).toHaveLength(0);
  },
);

it.each(['loading', 'error', 'pendingLogout'] as const)(
  'does not mount a private reader while the retained session is %s',
  async (state) => {
    if (state === 'error') mocks.error = '無法確認登入狀態';
    else mocks[state] = true;
    const view = render(<ClassroomAccountPage />);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(screen.queryByRole('form', { hidden: true })).toBeNull();
    mocks.loading = false;
    mocks.pendingLogout = false;
    mocks.error = '';
    view.rerender(<ClassroomAccountPage />);
    await screen.findByRole('form', { name: '申請學校資格' });
    expect(mocks.request.mock.calls).toEqual([['memberships', accountA.context]]);
  },
);

it.each(['error', 'pendingLogout'] as const)(
  'unmounts an existing qualification draft when account verification becomes %s',
  async (state) => {
    const view = await ready();
    fill();
    if (state === 'error') mocks.error = '無法確認登入狀態';
    else mocks[state] = true;
    view.rerender(<ClassroomAccountPage />);
    expect(screen.queryByRole('form', { hidden: true })).toBeNull();
    mocks.loading = false;
    mocks.pendingLogout = false;
    mocks.error = '';
    view.rerender(<ClassroomAccountPage />);
    await screen.findByRole('form', { name: '申請學校資格' });
    expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).value).toBe('');
    expect(writes()).toHaveLength(0);
  },
);

it('pauses a confirmed same-account draft during background verification without rereading or submitting', async () => {
  const view = await ready();
  fill();
  const form = screen.getByRole('form', { name: '申請學校資格' });
  mocks.loading = true;
  view.rerender(<ClassroomAccountPage />);
  expect(screen.getByRole('form', { name: '申請學校資格', hidden: true })).toBe(form);
  expect(form.closest('[hidden]')?.hasAttribute('inert')).toBe(true);
  const email = screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement;
  expect(email.value).toBe('Student@school.edu.tw');
  expect(email.disabled).toBe(true);
  fireEvent.submit(form);
  fireEvent.click(screen.getByRole('button', { name: '更新學校資格', hidden: true }));
  expect(mocks.request.mock.calls).toEqual([['memberships', accountA.context]]);
  mocks.loading = false;
  view.rerender(<ClassroomAccountPage />);
  expect(screen.getByRole('form', { name: '申請學校資格' })).toBe(form);
  expect(email.value).toBe('Student@school.edu.tw');
  expect(email.disabled).toBe(false);
  expect(mocks.request).toHaveBeenCalledOnce();
});

it('preserves an unknown application through background verification and retries the original email', async () => {
  const view = await ready();
  mocks.request.mockRejectedValueOnce(new NuniError(0, 'NETWORK_ERROR'));
  fill();
  submit();
  await screen.findByRole('button', { name: '重試確認申請' });
  mocks.loading = true;
  view.rerender(<ClassroomAccountPage />);
  expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).value).toBe(
    'Student@school.edu.tw',
  );
  mocks.loading = false;
  view.rerender(<ClassroomAccountPage />);
  expect((screen.getByRole('button', { name: '更新學校資格' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).disabled).toBe(true);
  expect(mocks.request.mock.calls).toHaveLength(2);
  mocks.request.mockResolvedValueOnce({ ...receipt, created: false });
  fireEvent.click(screen.getByRole('button', { name: '重試確認申請' }));
  await screen.findByText(/未建立重複申請/);
  expect(writes()).toHaveLength(2);
  expect(writes()[1]).toEqual(writes()[0]);
});

it.each(['receipt', 'unknown'] as const)(
  'retains a pending application that settles as %s during background verification',
  async (outcome) => {
    const view = await ready();
    const pending = deferred();
    mocks.request.mockImplementationOnce(() => pending.promise);
    fill();
    submit();
    mocks.loading = true;
    view.rerender(<ClassroomAccountPage />);
    if (outcome === 'receipt') await act(async () => pending.resolve(receipt));
    else await act(async () => pending.reject(new NuniError(0, 'NETWORK_ERROR')));
    expect(mocks.request.mock.calls).toHaveLength(2);
    mocks.loading = false;
    view.rerender(<ClassroomAccountPage />);
    if (outcome === 'receipt') {
      await screen.findByRole('form', { name: '申請學校資格' });
      expect(screen.getByText(/申請已收件，等待學校驗證/)).toBeTruthy();
      expect(mocks.request.mock.calls).toHaveLength(3);
    } else {
      await screen.findByRole('button', { name: '重試確認申請' });
      expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).value).toBe(
        'Student@school.edu.tw',
      );
      expect(
        (screen.getByRole('button', { name: '更新學校資格' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(mocks.request.mock.calls).toHaveLength(2);
    }
  },
);

it('keeps a receipt when the read deferred by background verification fails and retries only the list', async () => {
  const view = await ready();
  const pending = deferred();
  mocks.request.mockImplementationOnce(() => pending.promise);
  fill();
  submit();
  mocks.loading = true;
  view.rerender(<ClassroomAccountPage />);
  await act(async () => pending.resolve(receipt));
  expect(mocks.request.mock.calls).toHaveLength(2);
  mocks.request.mockRejectedValueOnce(new NuniError(503, 'UNAVAILABLE'));
  mocks.loading = false;
  view.rerender(<ClassroomAccountPage />);
  await screen.findByText('目前無法讀取學校資格，請稍後再試。');
  expect(screen.getByText(/申請已收件，等待學校驗證/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取學校資格' }));
  await screen.findByRole('form', { name: '申請學校資格' });
  expect(mocks.request.mock.calls).toHaveLength(4);
  expect(writes()).toHaveLength(1);
});

it('drops an interrupted first read and resumes it only after background verification succeeds', async () => {
  const pending = deferred();
  mocks.request.mockImplementationOnce(() => pending.promise);
  const view = render(<ClassroomAccountPage />);
  await screen.findByText('正在確認學校資格…');
  mocks.loading = true;
  view.rerender(<ClassroomAccountPage />);
  await act(async () => pending.resolve({ memberships: [membership('舊甲校')] }));
  expect(screen.queryByText('舊甲校')).toBeNull();
  expect(mocks.request).toHaveBeenCalledOnce();
  mocks.loading = false;
  view.rerender(<ClassroomAccountPage />);
  await screen.findByRole('form', { name: '申請學校資格' });
  expect(screen.queryByText('舊甲校')).toBeNull();
  expect(mocks.request).toHaveBeenCalledTimes(2);
});

it.each(['account-b', 'account-a-again', 'failed-verification'] as const)(
  'discards the paused application after background verification changes to %s',
  async (outcome) => {
    const view = await ready();
    const pending = deferred();
    mocks.request.mockImplementationOnce(() => pending.promise);
    fill();
    submit();
    mocks.loading = true;
    view.rerender(<ClassroomAccountPage />);
    if (outcome === 'failed-verification') mocks.error = '無法確認登入狀態';
    else mocks.session = { ...accountB };
    view.rerender(<ClassroomAccountPage />);
    expect(screen.queryByRole('form', { hidden: true })).toBeNull();
    if (outcome === 'account-a-again') {
      mocks.session = { ...accountA };
      view.rerender(<ClassroomAccountPage />);
    }
    await act(async () => pending.resolve(receipt));
    expect(mocks.request.mock.calls).toHaveLength(2);
    mocks.loading = false;
    mocks.error = '';
    view.rerender(<ClassroomAccountPage />);
    await screen.findByRole('form', { name: '申請學校資格' });
    expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(/申請已收件，等待/)).toBeNull();
    expect(mocks.request.mock.calls).toHaveLength(3);
  },
);

it('keeps the guest account URL, campus query and hash through Google sign-in', async () => {
  mocks.session = null;
  mocks.search = 'campus=tw-pu';
  const destination = `/classroom/account?${mocks.search}#qualifications`;
  window.history.replaceState({}, '', destination);
  render(<ClassroomAccountPage />);
  const button = await screen.findByRole('button', { name: '使用 Google 帳號繼續' });
  const form = button.closest('form')!;
  expect(form.method).toBe('post');
  expect(new URL(form.action).pathname).toBe('/auth/platform/start');
  expect(new URL(form.action).searchParams.get('returnUrl')).toBe(destination);
  expect(mocks.request.mock.calls).toEqual([['sign-in-options']]);
  expect(screen.queryByRole('region', { name: '學校資格' })).toBeNull();
  act(() => {
    window.history.replaceState({}, '', '/classroom/account?campus=tw-pu#application');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(new URL(form.action).searchParams.get('returnUrl')).toBe(
    '/classroom/account?campus=tw-pu#application',
  );
});

it('preserves a cancelled login destination and lets unavailable sign-in options recover', async () => {
  mocks.session = null;
  const destination = '/classroom/account?campus=tw-nthu#qualifications';
  mocks.search = new URLSearchParams({ returnUrl: destination, issue: 'cancelled' }).toString();
  mocks.request.mockRejectedValueOnce(new NuniError(503, 'UNAVAILABLE'));
  render(<ClassroomAccountPage />);
  expect(screen.getByText('這次登入沒有完成，請重新登入。')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: '重新確認' }));
  const button = await screen.findByRole('button', { name: '使用 Google 帳號繼續' });
  expect(new URL(button.closest('form')!.action).searchParams.get('returnUrl')).toBe(destination);
  expect(mocks.request.mock.calls).toEqual([['sign-in-options'], ['sign-in-options']]);
});

it.each(['error', 'pendingLogout'] as const)(
  'keeps guest %s recovery without reading memberships',
  async (state) => {
    mocks.session = null;
    mocks.error = '帳號尚未確認';
    mocks.pendingLogout = state === 'pendingLogout';
    const view = render(<ClassroomAccountPage />);
    fireEvent.click(
      screen.getByRole('button', { name: state === 'pendingLogout' ? '重試登出' : '重新確認帳號' }),
    );
    expect(state === 'pendingLogout' ? mocks.logout : mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.error = '';
    mocks.pendingLogout = false;
    mocks.loading = true;
    view.rerender(<ClassroomAccountPage />);
    expect(screen.queryByRole('form')).toBeNull();
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.loading = false;
    view.rerender(<ClassroomAccountPage />);
    await screen.findByRole('button', { name: '使用 Google 帳號繼續' });
    expect(mocks.request.mock.calls).toEqual([['sign-in-options']]);
  },
);

it('keeps a failed qualification read distinct from an empty list and retries on request', async () => {
  mocks.request.mockRejectedValueOnce(new NuniError(503, 'UNAVAILABLE'));
  render(<ClassroomAccountPage />);
  await screen.findByText('目前無法讀取學校資格，請稍後再試。');
  expect(screen.queryByText(/目前沒有學校資格紀錄/)).toBeNull();
  expect(screen.queryByRole('form')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取學校資格' }));
  await screen.findByRole('form', { name: '申請學校資格' });
  expect(writes()).toHaveLength(0);
});

it('does not infer application details from the browsing campus or submit until asked', async () => {
  const view = await ready();
  fill('Student@school.edu.tw');
  mocks.search = 'campus=tw-nthu';
  view.rerender(<ClassroomAccountPage />);
  expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).value).toBe(
    'Student@school.edu.tw',
  );
  expect(mocks.request.mock.calls).toEqual([['memberships', accountA.context]]);
  const pending = deferred();
  mocks.request.mockImplementationOnce(() => pending.promise);
  act(() => {
    submit();
    submit();
  });
  expect(writes()).toEqual([
    ['memberships', accountA.context, { claimedEmail: 'student@school.edu.tw' }],
  ]);
  await act(async () => pending.resolve(receipt));
  await screen.findByText('申請已收件，等待學校驗證。送出申請不會授予學生、教師或管理權限。');
  expect(writes()).toHaveLength(1);
});

it('keeps an unknown submission on its original email and reports an existing receipt without duplication', async () => {
  await ready();
  mocks.request.mockRejectedValueOnce(new NuniError(0, 'NETWORK_ERROR'));
  fill();
  submit();
  await screen.findByText('尚未確認申請結果。信箱已保留，請重試確認同一筆申請。');
  expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).disabled).toBe(true);
  mocks.request.mockResolvedValueOnce({ ...receipt, created: false });
  fireEvent.click(screen.getByRole('button', { name: '重試確認申請' }));
  await screen.findByText(/未建立重複申請/);
  expect(writes()).toHaveLength(2);
  expect(writes()[1]).toEqual(writes()[0]);
  expect(screen.queryByText(/申請已收件，等待/)).toBeNull();
});

it.each(['pending', 'unknown'] as const)(
  'does not reset a %s application by manually refreshing qualifications',
  async (state) => {
    await ready();
    const pending = deferred();
    mocks.request.mockImplementationOnce(() => pending.promise);
    fill();
    const refresh = screen.getByRole('button', { name: '更新學校資格' });
    act(() => {
      submit();
      fireEvent.click(refresh);
    });
    if (state === 'unknown') {
      await act(async () => pending.reject(new NuniError(0, 'NETWORK_ERROR')));
      await screen.findByRole('button', { name: '重試確認申請' });
    }
    fireEvent.click(refresh);
    expect(mocks.request.mock.calls).toHaveLength(2);
    expect((refresh as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).value).toBe(
      'Student@school.edu.tw',
    );
    expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).disabled).toBe(true);
    if (state === 'pending') await act(async () => pending.resolve(receipt));
    else {
      mocks.request.mockResolvedValueOnce({ ...receipt, created: false });
      fireEvent.click(screen.getByRole('button', { name: '重試確認申請' }));
    }
    await screen.findByRole('form', { name: '申請學校資格' });
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: '更新學校資格' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  },
);

it('unlocks manual refresh after an explicit application rejection', async () => {
  await ready();
  mocks.request.mockRejectedValueOnce(new NuniError(400, 'MEMBERSHIP_CLAIM_INVALID'));
  fill('student@gmail.com');
  submit();
  await screen.findByText(/這個信箱無法對應目前開放資格申請的合作學校/);
  const refresh = screen.getByRole('button', { name: '更新學校資格' });
  expect((refresh as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).disabled).toBe(false);
  fireEvent.click(refresh);
  await screen.findByRole('form', { name: '申請學校資格' });
  expect(mocks.request.mock.calls).toHaveLength(3);
  expect(writes()).toHaveLength(1);
});

it('keeps a confirmed receipt when its follow-up list read fails, then allows a read-only retry', async () => {
  await ready();
  mocks.request
    .mockResolvedValueOnce(receipt)
    .mockRejectedValueOnce(new NuniError(503, 'UNAVAILABLE'));
  fill();
  submit();
  await screen.findByText('目前無法讀取學校資格，請稍後再試。');
  expect(screen.getByText(/申請已收件，等待學校驗證/)).toBeTruthy();
  expect(screen.queryByRole('form')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取學校資格' }));
  await screen.findByRole('form', { name: '申請學校資格' });
  expect(mocks.request.mock.calls).toHaveLength(4);
  expect(writes()).toHaveLength(1);
});

it.each(['account', 'context', 'account-and-context'] as const)(
  'clears the draft and ignores a late POST when changing %s',
  async (change) => {
    const view = await ready();
    const pending = deferred();
    mocks.request.mockImplementationOnce(() => pending.promise);
    fill();
    submit();
    mocks.session = {
      ...accountA,
      platformAccountId:
        change === 'context' ? accountA.platformAccountId : accountB.platformAccountId,
      context: change === 'account' ? accountA.context : accountB.context,
    };
    view.rerender(<ClassroomAccountPage />);
    await screen.findByRole('form', { name: '申請學校資格' });
    await act(async () => pending.resolve(receipt));
    expect(screen.queryByText(/申請已收件，等待/)).toBeNull();
    expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).value).toBe('');
    expect(mocks.request.mock.calls).toHaveLength(3);
    expect(writes()).toHaveLength(1);
  },
);

it('ignores the first account read after A to B to A, even when the original context returns', async () => {
  const pending = deferred();
  mocks.request.mockImplementationOnce(() => pending.promise);
  const view = render(<ClassroomAccountPage />);
  await screen.findByText('正在確認學校資格…');
  mocks.session = { ...accountB };
  view.rerender(<ClassroomAccountPage />);
  await screen.findByRole('form', { name: '申請學校資格' });
  mocks.session = { ...accountA };
  view.rerender(<ClassroomAccountPage />);
  await screen.findByRole('form', { name: '申請學校資格' });
  await act(async () => pending.resolve({ memberships: [membership('舊甲校')] }));
  expect(screen.queryByText('舊甲校')).toBeNull();
  expect(mocks.request.mock.calls.map((call) => call[1])).toEqual([
    accountA.context,
    accountB.context,
    accountA.context,
  ]);
});

it.each(['another account', 'logout'] as const)(
  'does not accept the first application after visiting %s and returning to the same account',
  async (transition) => {
    const view = await ready();
    const pending = deferred();
    mocks.request.mockImplementationOnce(() => pending.promise);
    fill();
    submit();
    mocks.session = transition === 'logout' ? null : { ...accountB };
    view.rerender(<ClassroomAccountPage />);
    if (transition === 'logout')
      await screen.findByRole('button', { name: '使用 Google 帳號繼續' });
    else await screen.findByRole('form', { name: '申請學校資格' });
    mocks.session = { ...accountA };
    view.rerender(<ClassroomAccountPage />);
    await screen.findByRole('form', { name: '申請學校資格' });
    const requestsBeforeSettlement = mocks.request.mock.calls.length;
    await act(async () => pending.resolve(receipt));
    expect(screen.queryByText(/申請已收件，等待/)).toBeNull();
    expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).value).toBe('');
    expect(mocks.request).toHaveBeenCalledTimes(requestsBeforeSettlement);
    expect(writes()).toHaveLength(1);
  },
);

it('hides an expired application and only rechecks the account after confirmation', async () => {
  await ready();
  mocks.request.mockRejectedValueOnce(new NuniError(409, 'SESSION_CHANGED'));
  fill();
  submit();
  await screen.findByText('登入已失效或帳號已變更，學校資格已隱藏。');
  expect(screen.queryByRole('form')).toBeNull();
  expect(mocks.refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重新確認帳號' }));
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it.each([new NuniError(401, 'UNAUTHENTICATED'), new NuniError(409, 'SESSION_CHANGED')])(
  'rereads expired qualifications only after explicit same-account verification: %s',
  async (failure) => {
    mocks.request.mockRejectedValueOnce(failure);
    const verification = deferred();
    mocks.refresh.mockReturnValueOnce(verification.promise);
    const view = render(<ClassroomAccountPage />);
    const retry = await screen.findByRole('button', { name: '重新確認帳號' });
    act(() => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledOnce();
    mocks.loading = true;
    view.rerender(<ClassroomAccountPage />);
    await act(async () => verification.resolve(undefined));
    expect(mocks.request).toHaveBeenCalledOnce();
    mocks.loading = false;
    view.rerender(<ClassroomAccountPage />);
    await screen.findByRole('form', { name: '申請學校資格' });
    expect(mocks.request.mock.calls).toEqual([
      ['memberships', accountA.context],
      ['memberships', accountA.context],
    ]);
    expect(writes()).toHaveLength(0);
  },
);

it('keeps a rejected account recheck retryable without reading or submitting qualifications', async () => {
  mocks.request.mockRejectedValueOnce(new NuniError(409, 'SESSION_CHANGED'));
  mocks.refresh.mockRejectedValueOnce(new Error('Synthetic account verification failure'));
  render(<ClassroomAccountPage />);
  fireEvent.click(await screen.findByRole('button', { name: '重新確認帳號' }));
  await screen.findByText('目前無法重新確認帳號，請稍後再試。');
  expect(screen.queryByRole('form')).toBeNull();
  expect(mocks.request).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '重新確認帳號' }));
  await screen.findByRole('form', { name: '申請學校資格' });
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(writes()).toHaveLength(0);
});

it('does not apply an old account recheck to a different account or an A to B to A return', async () => {
  mocks.request.mockRejectedValueOnce(new NuniError(409, 'SESSION_CHANGED'));
  const verification = deferred();
  mocks.refresh.mockReturnValueOnce(verification.promise);
  const view = render(<ClassroomAccountPage />);
  fireEvent.click(await screen.findByRole('button', { name: '重新確認帳號' }));
  mocks.session = { ...accountB };
  view.rerender(<ClassroomAccountPage />);
  await screen.findByRole('form', { name: '申請學校資格' });
  mocks.session = { ...accountA };
  view.rerender(<ClassroomAccountPage />);
  await screen.findByRole('form', { name: '申請學校資格' });
  fill('current@school.edu.tw');
  await act(async () => verification.resolve(undefined));
  expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).value).toBe(
    'current@school.edu.tw',
  );
  expect(mocks.request.mock.calls).toHaveLength(3);
  expect(writes()).toHaveLength(0);
});

it('ignores a pending application after leaving and returning without claiming it was withdrawn', async () => {
  const view = await ready();
  const pending = deferred();
  mocks.request.mockImplementationOnce(() => pending.promise);
  fill();
  submit();
  view.unmount();
  await ready();
  await act(async () => pending.resolve(receipt));
  const section = screen.getByRole('region', { name: '學校資格' });
  expect(within(section).queryByText(/申請已收件|撤回|已取消/)).toBeNull();
  expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).value).toBe('');
  await waitFor(() => expect(mocks.request.mock.calls).toHaveLength(3));
  expect(writes()).toHaveLength(1);
});
