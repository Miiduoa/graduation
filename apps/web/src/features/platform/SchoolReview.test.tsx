import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
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
  pendingLogout: false,
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
    pendingLogout: mocks.pendingLogout,
    refresh: vi.fn(),
    logout: vi.fn(),
  }),
}));

const principal = {
  platformAccountId: 'pa_1',
  context: 'a'.repeat(43),
  isPlatformOperator: true,
};

function schoolRow(tenantId: string, displayName: string) {
  return {
    kind: 'tenant',
    applicationId: null,
    tenantId,
    displayName,
    emailDomain: null,
    lifecycle: 'provisioned',
    description: '',
    modules: { leave: false, identity: false, food: false },
    peopleCount: 0,
    merchantCount: 0,
  };
}

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
  mocks.pendingLogout = false;
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
      return ok({
        schools: [schoolRow('ready-school', '待開放學校')],
      });
    }
    if (String(url).includes('/api/platform-admin/people?tenantId=')) {
      return ok({
        tenantId: 'ready-school',
        displayName: '待開放學校',
        tenantState: 'provisioned',
        hasRoleAdmin: true,
        roleAdmins: [{ personId: 'admin-1', displayName: '校方管理員' }],
        people: [],
        honesty: '依校方授權名單核對',
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
  window.history.replaceState(null, '', '/admin/school-review');
  render(<SchoolReview />);
  expect(screen.getByRole('heading', { name: '請先登入管理員帳號' })).toBeTruthy();
  const login = new URL(
    (screen.getByRole('link', { name: '前往管理員登入' }) as HTMLAnchorElement).href,
  );
  expect(login.pathname).toBe('/admin/login');
  expect(login.searchParams.get('returnUrl')).toBe('/admin/school-review');
  expect(fetcher).not.toHaveBeenCalled();
});

it('blocks non-operators before loading privileged school data', async () => {
  mocks.session = { ...principal, isPlatformOperator: false };
  fetcher.mockImplementation(async (url: string) => {
    if (String(url).includes('school-applications')) return ok({}, 403);
    return ok({}, 403);
  });
  render(<SchoolReview />);
  expect(await screen.findByText(/這台帳號不是平台營運人員/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '學校接入' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '核准申請' })).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
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
  expect(posted[1].headers).toMatchObject({ 'X-Campus-Session': principal.context });
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
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true),
  );
  const posted = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!;
  expect(JSON.parse(posted[1].body)).toMatchObject({
    decision: 'reject',
    reason: REJECT_SCHOOL_REASON,
  });
});

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each([200, 403])(
  'ignores a previous account application response (%s) without starting its schools request',
  async (status) => {
    const previous = deferredResponse();
    fetcher.mockImplementationOnce(() => previous.promise);
    const view = render(<SchoolReview />);
    mocks.session = { ...principal, platformAccountId: 'pa_2', context: 'b'.repeat(43) };
    view.rerender(<SchoolReview />);
    await screen.findByText('待開放學校');
    await act(async () => {
      previous.resolve(ok({ applications: [{ id: 'old', displayName: '前帳號申請' }] }, status));
    });
    expect(screen.queryByText('前帳號申請')).toBeNull();
    expect(screen.queryByText(/這台帳號不是平台營運人員/)).toBeNull();
    expect(screen.getByText('待審學校')).toBeTruthy();
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith('/api/platform-admin/schools')),
    ).toHaveLength(1);
  },
);

it('does not restore old schools when their response arrives after a context switch', async () => {
  const previous = deferredResponse();
  const original = fetcher.getMockImplementation()!;
  let schoolReads = 0;
  fetcher.mockImplementation((url: string, options?: RequestInit) => {
    if (url.endsWith('/api/platform-admin/schools') && ++schoolReads === 1) return previous.promise;
    return original(url, options);
  });
  const view = render(<SchoolReview />);
  await screen.findByText('待審學校');
  mocks.session = { ...principal, context: 'b'.repeat(43) };
  view.rerender(<SchoolReview />);
  await screen.findByText('待開放學校');
  await act(async () => {
    previous.resolve(
      ok({
        schools: [schoolRow('old-school', '前帳號學校')],
      }),
    );
  });
  expect(screen.queryByText('前帳號學校')).toBeNull();
  expect(screen.getByText('待開放學校')).toBeTruthy();
});

it.each(['platformAccountId', 'context', 'isPlatformOperator'] as const)(
  'clears loaded privileged data immediately when %s changes',
  async (field) => {
    const view = render(<SchoolReview />);
    await screen.findByText('待開放學校');
    const nextRead = deferredResponse();
    fetcher.mockImplementationOnce(() => nextRead.promise);
    mocks.session = {
      ...principal,
      [field]:
        field === 'platformAccountId' ? 'pa_2' : field === 'context' ? 'b'.repeat(43) : false,
    };
    view.rerender(<SchoolReview />);
    expect(screen.queryByText('待審學校')).toBeNull();
    expect(screen.queryByText('待開放學校')).toBeNull();
    expect(screen.queryByRole('button', { name: '核准申請' })).toBeNull();
    await act(async () => {
      nextRead.resolve(ok({}, 403));
    });
    expect(screen.getByText(/這台帳號不是平台營運人員/)).toBeTruthy();
  },
);

it.each(['loading', 'pendingLogout'] as const)(
  'removes review actions while %s pauses authorization',
  async (field) => {
    const view = render(<SchoolReview />);
    await screen.findByText('待開放學校');
    mocks[field] = true;
    view.rerender(<SchoolReview />);
    expect(screen.getByText('正在確認管理權限…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '核准申請' })).toBeNull();
    expect(screen.queryByRole('button', { name: '檢查開通條件' })).toBeNull();
    expect(screen.queryByText('待審學校')).toBeNull();
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  },
);

it.each(['核准申請', '檢查開通條件'])(
  'ignores a previous account %s completion instead of reloading with new credentials',
  async (button) => {
    const mutation = deferredResponse();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url: string, options?: RequestInit) =>
      options?.method === 'POST' || String(url).includes('/people?tenantId=')
        ? mutation.promise
        : original(url, options),
    );
    const view = render(<SchoolReview />);
    await screen.findByText('待開放學校');
    fireEvent.click(screen.getByRole('button', { name: button }));
    mocks.session = { ...principal, context: 'b'.repeat(43) };
    view.rerender(<SchoolReview />);
    await screen.findByText('待開放學校');
    const requestCount = fetcher.mock.calls.length;
    await act(async () => {
      mutation.resolve(ok({}));
    });
    expect(fetcher).toHaveBeenCalledTimes(requestCount);
    expect(screen.getByRole('button', { name: button })).toHaveProperty('disabled', false);
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it('ignores reads from an effect replay even when the account context stays the same', async () => {
  const previous = deferredResponse();
  fetcher.mockImplementationOnce(() => previous.promise);
  render(
    <StrictMode>
      <SchoolReview />
    </StrictMode>,
  );
  await screen.findByText('待開放學校');
  await act(async () => {
    previous.resolve(ok({ applications: [{ id: 'old', displayName: '舊讀取申請' }] }));
  });
  expect(screen.queryByText('舊讀取申請')).toBeNull();
  expect(screen.getByText('待審學校')).toBeTruthy();
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).endsWith('/api/platform-admin/schools')),
  ).toHaveLength(1);
});

it('opens a provisioned school only after administrator verification and confirmation', async () => {
  render(<SchoolReview />);
  fireEvent.click(await screen.findByRole('button', { name: '檢查開通條件' }));
  const confirm = await screen.findByRole('button', { name: '確認開通 待開放學校' });
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/open'))).toBe(false);
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        ([url, options]) =>
          String(url) === '/api/platform-admin/schools/ready-school/open' &&
          options?.method === 'POST',
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

it('clears pending applications when the later school lookup rejects operator authority', async () => {
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, options?: RequestInit) =>
    url === '/api/platform-admin/schools' ? Promise.resolve(ok({}, 403)) : original(url, options),
  );
  render(<SchoolReview />);
  await screen.findByText(/這台帳號不是平台營運人員/);
  expect(screen.queryByText('待審學校')).toBeNull();
  expect(screen.queryByRole('button', { name: '核准申請' })).toBeNull();
  expect(screen.queryByRole('button', { name: '檢查開通條件' })).toBeNull();
});

it('blocks opening a school with no active school administrator', async () => {
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, options?: RequestInit) =>
    String(url).includes('/people?tenantId=')
      ? Promise.resolve(ok({
          tenantId: 'ready-school',
          displayName: '待開放學校',
          tenantState: 'provisioned',
          hasRoleAdmin: false,
          roleAdmins: [],
          people: [],
          honesty: '依校方授權名單核對',
        }))
      : original(url, options),
  );
  render(<SchoolReview />);
  fireEvent.click(await screen.findByRole('button', { name: '檢查開通條件' }));
  expect(await screen.findByText(/尚未指定有效的校方管理員/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '確認開通 待開放學校' })).toBeNull();
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/open'))).toBe(false);
});

it('rechecks school admin role at confirmation and rejects a revoked role', async () => {
  let reads = 0;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, options?: RequestInit) => {
    if (String(url).includes('/people?tenantId=') && ++reads === 2)
      return Promise.resolve(ok({
        tenantId: 'ready-school',
        displayName: '待開放學校',
        tenantState: 'provisioned',
        hasRoleAdmin: false,
        roleAdmins: [],
        people: [],
        honesty: '最新校方授權',
      }));
    return original(url, options);
  });
  render(<SchoolReview />);
  fireEvent.click(await screen.findByRole('button', { name: '檢查開通條件' }));
  fireEvent.click(await screen.findByRole('button', { name: '確認開通 待開放學校' }));
  expect(await screen.findByText(/目前沒有有效的校方管理員/)).toBeTruthy();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/open'))).toHaveLength(0);
});
