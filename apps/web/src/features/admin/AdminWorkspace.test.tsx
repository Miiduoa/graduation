import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminWorkspace } from './AdminWorkspace';
import { AdminLogin } from './AdminLogin';

const mocks = vi.hoisted(() => ({
  auth: {
    session: null as null | {
      platformAccountId: string;
      context: string;
      isPlatformOperator: boolean;
    },
    loading: false,
    error: '',
    pendingLogout: false,
    refresh: vi.fn(),
    logout: vi.fn(),
  },
  replace: vi.fn(),
}));
vi.mock('@/features/nuni/Session', () => ({ useNuniSession: () => mocks.auth }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
const tenant = {
  kind: 'tenant',
  applicationId: null,
  tenantId: 'school-one',
  displayName: '第一學校',
  emailDomain: 'one.edu.tw',
  lifecycle: 'open',
  description: '原有說明',
  modules: { leave: true, identity: true, food: false },
  peopleCount: 2,
  merchantCount: 0,
};
const context = 'a'.repeat(43);
const principal = {
  platformAccountId: 'pa_00000000-0000-0000-0000-000000000001',
  context,
  isPlatformOperator: true,
};
const inactiveProxy = {
  tenantId: tenant.tenantId,
  expiresAt: new Date(0).toISOString(),
  extended: false,
  ended: true,
};
function ok(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const fetcher = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth = {
    session: { ...principal },
    loading: false,
    error: '',
    pendingLogout: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  fetcher
    .mockReset()
    .mockImplementation(async (url: string) =>
      url.endsWith('/proxy') ? ok(inactiveProxy) : ok({ schools: [tenant] }),
    );
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderSchools() {
  const view = render(<AdminWorkspace />);
  const button = screen.queryByRole('button', { name: '學校管理' });
  if (button) fireEvent.click(button);
  return view;
}

it('does not request management data for guests or non-operators', () => {
  mocks.auth.session = null;
  const view = renderSchools();
  expect(screen.getByText('請先登入管理員帳號')).toBeTruthy();
  mocks.auth.session = { ...principal, isPlatformOperator: false };
  view.rerender(<AdminWorkspace />);
  expect(screen.getByText('沒有管理權限')).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});

it('uses the current operator session and keeps an open school read-only until proxy starts', async () => {
  let proxy = inactiveProxy;
  fetcher.mockImplementation(async (url: string) => {
    if (url.endsWith('/proxy/start')) {
      proxy = {
        ...inactiveProxy,
        ended: false,
        expiresAt: new Date(Date.now() + 900000).toISOString(),
      };
      return ok(proxy);
    }
    if (url.endsWith('/proxy')) return ok(proxy);
    return ok({ schools: [tenant] });
  });
  renderSchools();
  fireEvent.click(await screen.findByRole('button', { name: '管理第一學校' }));
  expect(
    (screen.getByLabelText('學校名稱') as HTMLInputElement).closest('fieldset')!.disabled,
  ).toBe(true);
  fireEvent.click(await screen.findByRole('button', { name: '開始代操作' }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText('學校名稱') as HTMLInputElement).closest('fieldset')!.disabled,
    ).toBe(false),
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'X-Campus-Session': context },
  });
  expect(screen.getByText('已使用平台管理員帳號登入')).toBeTruthy();
});

it('requires a reason and confirmation before closing a school', async () => {
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith('/suspend')
      ? ok({ tenantId: tenant.tenantId, tenantState: 'suspended' })
      : url.endsWith('/proxy')
        ? ok(inactiveProxy)
        : ok({ schools: [tenant] }),
  );
  renderSchools();
  fireEvent.click(await screen.findByRole('button', { name: '管理第一學校' }));
  fireEvent.click(screen.getByRole('button', { name: '關閉學校' }));
  expect(fetcher.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
  const form = screen.getByLabelText('操作原因').closest('form')!;
  fireEvent.submit(form);
  expect(fetcher.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('操作原因'), { target: { value: '校方要求暫時關閉' } });
  fireEvent.submit(form);
  await screen.findByText('學校已關閉。');
  const post = fetcher.mock.calls.find(([, options]) => options.method === 'POST')!;
  expect(post[0]).toBe('/api/platform-admin/schools/school-one/suspend');
  expect(JSON.parse(post[1].body)).toMatchObject({
    reason: '校方要求暫時關閉',
    idempotencyKey: expect.any(String),
  });
});

it('blocks same-tick duplicate mutations and keeps a retry key after an uncertain failure', async () => {
  const pending = deferred<Response>();
  const row = { ...tenant, lifecycle: 'provisioned' };
  fetcher.mockImplementation(async (url: string, options: RequestInit) =>
    options.method === 'POST'
      ? pending.promise
      : url.endsWith('/proxy')
        ? ok(inactiveProxy)
        : ok({ schools: [row] }),
  );
  renderSchools();
  fireEvent.click(await screen.findByRole('button', { name: '管理第一學校' }));
  fireEvent.change(screen.getByLabelText('學校名稱'), { target: { value: '更新學校' } });
  const form = screen.getByLabelText('學校名稱').closest('form')!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  expect(fetcher.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  await act(async () => {
    pending.resolve(new Response('{}', { status: 503 }));
  });
  await screen.findByRole('alert');
  fireEvent.submit(form);
  const posts = fetcher.mock.calls.filter(([, options]) => options.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(JSON.parse(posts[1][1].body).idempotencyKey).toBe(
    JSON.parse(posts[0][1].body).idempotencyKey,
  );
});

it('masks previous account data and rejects a late response after account change', async () => {
  const first = deferred<Response>();
  fetcher.mockImplementation((_url: string, options: RequestInit) =>
    (options.headers as Record<string, string>)['X-Campus-Session'] === context
      ? first.promise
      : Promise.resolve(ok({ schools: [{ ...tenant, displayName: '第二帳號學校' }] })),
  );
  const view = renderSchools();
  const oldSignal = fetcher.mock.calls[0][1].signal as AbortSignal;
  mocks.auth.session = {
    ...principal,
    platformAccountId: 'pa_00000000-0000-0000-0000-000000000002',
    context: 'b'.repeat(43),
  };
  view.rerender(<AdminWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '學校管理' }));
  await screen.findByRole('button', { name: '管理第二帳號學校' });
  await act(async () => first.resolve(ok({ schools: [tenant] })));
  expect(screen.queryByText('第一學校')).toBeNull();
  expect(oldSignal.aborted).toBe(true);
  mocks.auth.session = { ...principal, isPlatformOperator: false };
  view.rerender(<AdminWorkspace />);
  expect(screen.queryByText('第二帳號學校')).toBeNull();
});

it('preserves an unfinished school form while session verification refreshes', async () => {
  const view = renderSchools();
  fireEvent.click(await screen.findByRole('button', { name: '管理第一學校' }));
  fireEvent.change(screen.getByLabelText('學校名稱'), { target: { value: '尚未儲存的名稱' } });
  mocks.auth.loading = true;
  view.rerender(<AdminWorkspace />);
  expect(screen.getByText('正在重新確認管理權限…')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '收起學校設定' })).toBeNull();
  mocks.auth.loading = false;
  view.rerender(<AdminWorkspace />);
  await screen.findByRole('button', { name: '收起學校設定' });
  expect((screen.getByLabelText('學校名稱') as HTMLInputElement).value).toBe('尚未儲存的名稱');
});

it('preserves a draft and pauses edits when a background reload fails', async () => {
  const view = renderSchools();
  fireEvent.click(await screen.findByRole('button', { name: '管理第一學校' }));
  fireEvent.change(screen.getByLabelText('學校名稱'), { target: { value: '連線中斷前的草稿' } });
  mocks.auth.loading = true;
  view.rerender(<AdminWorkspace />);
  fetcher.mockResolvedValue(new Response('{}', { status: 503 }));
  mocks.auth.loading = false;
  view.rerender(<AdminWorkspace />);
  await screen.findByRole('button', { name: '重新讀取學校' });
  expect((screen.getByLabelText('學校名稱') as HTMLInputElement).value).toBe('連線中斷前的草稿');
  expect(screen.getByRole('button', { name: '收起學校設定' }).closest('fieldset')!.disabled).toBe(
    true,
  );
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith('/proxy') ? ok(inactiveProxy) : ok({ schools: [tenant] }),
  );
  fireEvent.click(screen.getByRole('button', { name: '重新讀取學校' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '重新讀取學校' })).toBeNull());
  expect((screen.getByLabelText('學校名稱') as HTMLInputElement).value).toBe('連線中斷前的草稿');
});

it('recovers from load errors and reads the actual audit response shape', async () => {
  let schoolReads = 0;
  fetcher.mockImplementation(async (url: string) => {
    if (url.endsWith('/schools') && ++schoolReads <= 2) return new Response('{}', { status: 503 });
    return ok({ schools: [tenant] });
  });
  renderSchools();
  fireEvent.click(await screen.findByRole('button', { name: '重新讀取學校' }));
  await screen.findByRole('button', { name: '管理第一學校' });
  fetcher.mockResolvedValueOnce(
    ok({
      records: [
        {
          id: 'audit-1',
          actionLabel: '改學校資料',
          actorName: '營運人員',
          targetSchoolName: '第一學校',
          detail: '更新說明',
          createdAt: new Date().toISOString(),
          via: 'proxy',
          before: { description: '前' },
          after: { description: '後' },
        },
      ],
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: '操作紀錄' }));
  await screen.findByText('改學校資料');
  expect(screen.getByText('營運人員 · 第一學校 · 代為操作')).toBeTruthy();
  expect(screen.getByText('查看變更內容')).toBeTruthy();
});

it('keeps existing non-operator sessions intact until explicit logout', () => {
  mocks.auth.session = { ...principal, isPlatformOperator: false };
  render(<AdminLogin />);
  expect(screen.queryByLabelText('電子郵件')).toBeNull();
  expect(mocks.auth.logout).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '登出目前帳號' }));
  expect(mocks.auth.logout).toHaveBeenCalledOnce();
  expect(fetcher).not.toHaveBeenCalled();
});

it('routes administrator Google sign-in through the shared flow and preserves the admin task', () => {
  mocks.auth.session = null;
  render(<AdminLogin />);
  const login = new URL(
    (screen.getByRole('link', { name: '使用 Google 登入' }) as HTMLAnchorElement).href,
  );
  expect(login.pathname).toBe('/classroom/login');
  expect(login.searchParams.get('returnUrl')).toBe('/admin');
  expect(fetcher).not.toHaveBeenCalled();
});

it('submits blank-default login once and refreshes before navigating', async () => {
  mocks.auth.session = null;
  const login = deferred<Response>(),
    refresh = deferred<void>();
  mocks.auth.refresh.mockReturnValue(refresh.promise);
  fetcher.mockReturnValue(login.promise);
  render(<AdminLogin />);
  expect((screen.getByLabelText('電子郵件') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('密碼') as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('電子郵件'), {
    target: { value: 'operator@example.test' },
  });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'test-only-password' } });
  const form = screen.getByLabelText('密碼').closest('form')!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    email: 'operator@example.test',
    password: 'test-only-password',
  });
  await act(async () => login.resolve(ok({ authenticated: true, ...principal })));
  expect(mocks.auth.refresh).toHaveBeenCalledOnce();
  expect(mocks.replace).not.toHaveBeenCalled();
  await act(async () => refresh.resolve());
  expect(mocks.replace).toHaveBeenCalledWith('/admin');
});

it('ignores login completion after leaving the page', async () => {
  mocks.auth.session = null;
  const login = deferred<Response>();
  fetcher.mockReturnValue(login.promise);
  const view = render(<AdminLogin />);
  fireEvent.change(screen.getByLabelText('電子郵件'), {
    target: { value: 'operator@example.test' },
  });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'test-only-password' } });
  fireEvent.submit(screen.getByLabelText('密碼').closest('form')!);
  view.unmount();
  await act(async () => login.resolve(ok({ authenticated: true, ...principal })));
  expect(mocks.auth.refresh).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
});

const report = {
  id: 'report-1',
  tenantId: 'school-one',
  postId: 'post-1',
  state: 'open',
  version: 3,
  reason: 'privacy',
  createdAt: new Date().toISOString(),
  detail: '包含他人個資',
  snapshot: {
    id: 'post-1',
    tenantId: 'school-one',
    tenantName: '第一學校',
    communityId: 'board-1',
    communityName: '校園交流',
    text: '檢舉時的公開內容',
    author: { displayName: '同學甲', isSelf: false },
    publishedAt: new Date().toISOString(),
    version: 2,
  },
  decisionReason: null,
  canDecide: true,
};

it('loads real report snapshots and sends one version-bound decision after confirmation', async () => {
  const decision = deferred<Response>();
  let closed = false;
  fetcher.mockImplementation(async (url: string, options: RequestInit) => {
    if (options.method === 'POST') return decision.promise;
    if (url.includes('/reports?')) return ok({ items: closed ? [] : [report] });
    return ok({ schools: [tenant] });
  });
  renderSchools();
  fireEvent.click(screen.getByRole('button', { name: '社群檢舉' }));
  await screen.findByText('檢舉時的公開內容');
  fireEvent.click(screen.getByRole('button', { name: '隱藏貼文' }));
  expect(fetcher.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('處理原因'), {
    target: { value: '包含未經同意公開的個資' },
  });
  const form = screen.getByLabelText('處理原因').closest('form')!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  const posts = fetcher.mock.calls.filter(([, options]) => options.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0][0]).toBe('/api/platform-admin/reports/report-1/decision');
  expect(JSON.parse(posts[0][1].body)).toEqual({
    decision: 'hide',
    reason: '包含未經同意公開的個資',
    expectedVersion: 3,
    idempotencyKey: expect.any(String),
  });
  closed = true;
  await act(async () => decision.resolve(ok({ ...report, state: 'hidden', version: 4 })));
  await screen.findByText('目前沒有待處理的檢舉。');
});

it('does not offer a report decision when the server denies that operator action', async () => {
  fetcher.mockImplementation(async (url: string) =>
    url.includes('/reports?')
      ? ok({ items: [{ ...report, canDecide: false }] })
      : ok({ schools: [tenant] }),
  );
  renderSchools();
  fireEvent.click(screen.getByRole('button', { name: '社群檢舉' }));
  await screen.findByText('這筆檢舉目前無法由你的帳號處理。');
  expect(screen.queryByRole('button', { name: '隱藏貼文' })).toBeNull();
  expect(screen.queryByRole('button', { name: '駁回檢舉' })).toBeNull();
});

it('requires a valid operator login response before refreshing or navigating', async () => {
  mocks.auth.session = null;
  fetcher.mockResolvedValue(ok({ authenticated: true, ...principal, isPlatformOperator: false }));
  render(<AdminLogin />);
  fireEvent.change(screen.getByLabelText('電子郵件'), {
    target: { value: 'operator@example.test' },
  });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'test-only-password' } });
  fireEvent.submit(screen.getByLabelText('密碼').closest('form')!);
  await screen.findByText('收到的資料不完整，請重新讀取。');
  expect(mocks.auth.refresh).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
});

it('refuses a profile write once the proxy expires, even before the timer redraws', async () => {
  const started = Date.now();
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith('/proxy')
      ? ok({ ...inactiveProxy, ended: false, expiresAt: new Date(started + 900000).toISOString() })
      : ok({ schools: [tenant] }),
  );
  renderSchools();
  fireEvent.click(await screen.findByRole('button', { name: '管理第一學校' }));
  await screen.findByRole('button', { name: '結束代操作' });
  vi.spyOn(Date, 'now').mockReturnValue(started + 900001);
  fireEvent.submit(screen.getByLabelText('學校名稱').closest('form')!);
  expect(fetcher.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
});

it('rejects mismatched tenant data in a report snapshot', async () => {
  fetcher.mockImplementation(async (url: string) =>
    url.includes('/reports?')
      ? ok({
          items: [{ ...report, snapshot: { ...report.snapshot, tenantId: 'different-school' } }],
        })
      : ok({ schools: [tenant] }),
  );
  renderSchools();
  fireEvent.click(screen.getByRole('button', { name: '社群檢舉' }));
  await screen.findByText('收到的資料不完整，請重新讀取。');
  expect(screen.queryByText('檢舉時的公開內容')).toBeNull();
  expect(screen.queryByRole('button', { name: '隱藏貼文' })).toBeNull();
});

it('creates one real public board for a provisioned school and refreshes the list', async () => {
  const pending = deferred<Response>();
  const board = {
    tenantId: tenant.tenantId,
    tenantName: tenant.displayName,
    id: 'board-2',
    name: '跨校讀書會',
    description: '交流讀書方法',
    joinPolicy: 'open',
    postingPolicy: 'members',
    canPost: true,
  };
  let created = false;
  fetcher.mockImplementation(async (url: string, options: RequestInit) => {
    if (options.method === 'POST') return pending.promise;
    if (url.endsWith('/boards')) return ok({ items: created ? [board] : [] });
    return ok({
      schools: [
        { ...tenant, lifecycle: 'provisioned' },
        { ...tenant, tenantId: 'closed-school', displayName: '已關閉學校', lifecycle: 'suspended' },
      ],
    });
  });
  renderSchools();
  fireEvent.click(screen.getByRole('button', { name: '公開看板' }));
  await screen.findByText('目前沒有公開看板。建立後，使用者即可選擇看板發文。');
  expect(screen.queryByRole('option', { name: '已關閉學校' })).toBeNull();
  fireEvent.change(screen.getByLabelText('看板所屬學校'), { target: { value: tenant.tenantId } });
  fireEvent.change(screen.getByLabelText('看板名稱'), { target: { value: '跨校讀書會' } });
  fireEvent.change(screen.getByLabelText('看板說明'), { target: { value: '交流讀書方法' } });
  const form = screen.getByLabelText('看板名稱').closest('form')!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  const posts = fetcher.mock.calls.filter(([, options]) => options.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0][0]).toBe('/api/platform-admin/boards');
  expect(JSON.parse(posts[0][1].body)).toEqual({
    tenantId: tenant.tenantId,
    name: '跨校讀書會',
    description: '交流讀書方法',
    idempotencyKey: expect.any(String),
  });
  created = true;
  await act(async () => pending.resolve(ok(board)));
  await screen.findByText('已建立「跨校讀書會」，可供跨校公開交流。');
  await screen.findByRole('cell', { name: '第一學校' });
  expect((screen.getByLabelText('看板名稱') as HTMLInputElement).value).toBe('');
});

it('does not create a public board without an eligible school or a valid name', async () => {
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith('/boards')
      ? ok({ items: [] })
      : ok({ schools: [{ ...tenant, lifecycle: 'suspended' }] }),
  );
  renderSchools();
  fireEvent.click(screen.getByRole('button', { name: '公開看板' }));
  await screen.findByText(/目前沒有可選擇的學校，請搜尋學校名稱/);
  fireEvent.submit(screen.getByLabelText('看板名稱').closest('form')!);
  expect(fetcher.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
});

it('opens with scoped responsibilities and server-backed pending work', async () => {
  fetcher.mockImplementation(async (url: string) =>
    url.includes('/reports?')
      ? ok({ items: [report] })
      : ok({
          schools: [
            tenant,
            {
              ...tenant,
              kind: 'application',
              tenantId: null,
              applicationId: 'pending-a',
              displayName: '待審學校',
              lifecycle: 'pending',
            },
          ],
        }),
  );
  render(<AdminWorkspace />);
  expect(screen.getByRole('heading', { name: '誰負責哪件事' })).toBeTruthy();
  await screen.findByText('待審學校');
  expect(screen.getByText(/1 件申請待審核/)).toBeTruthy();
  expect(screen.getByText(/本次列出 1 件待處理檢舉/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: '課程系統管理' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '處理社群檢舉' }));
  expect(screen.getByLabelText('檢舉狀態')).toBeTruthy();
});

it('does not turn failed overview reads into zero pending tasks and retries safely', async () => {
  fetcher.mockResolvedValue(new Response('{}', { status: 503 }));
  render(<AdminWorkspace />);
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  expect(screen.queryByText(/0 件申請待審核/)).toBeNull();
  expect(screen.queryByText(/本次列出 0 件/)).toBeNull();
  fetcher.mockImplementation(async (url: string) =>
    url.includes('/reports?') ? ok({ items: [] }) : ok({ schools: [tenant] }),
  );
  fireEvent.click(screen.getByRole('button', { name: '更新待辦' }));
  await screen.findByText(/本次列出 0 件待處理檢舉/);
  expect(screen.queryByRole('alert')).toBeNull();
});
