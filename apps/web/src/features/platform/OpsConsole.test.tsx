import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OpsConsole } from './OpsConsole';
import { adminLoginHref, readOpsSchool, readOpsTab } from './constants';

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
vi.mock('@/features/admin/AdminSchools', () => ({
  AdminSchools: () => <p>學校分頁</p>,
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
    pendingLogout: mocks.pendingLogout,
    refresh: vi.fn(),
    logout: vi.fn(),
  }),
}));

const fetcher = vi.fn();

beforeEach(() => {
  mocks.session = null;
  mocks.loading = false;
  mocks.pendingLogout = false;
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

it.each([
  ['/admin/ops?tab=people', '/admin/login?returnUrl=%2Fadmin%2Fops%3Ftab%3Dpeople'],
  ['/admin/ops#affiliation', '/admin/login?returnUrl=%2Fadmin%2Fops%23affiliation#'],
  ['/admin/ops#affiliation#affiliation', '/admin/login?returnUrl=%2Fadmin%2Fops%23affiliation#'],
  ['/admin/ops', '/admin/login?returnUrl=%2Fadmin%2Fops'],
])('carries the current ops path %s into admin login without leaving the page hash', (location, href) => {
  window.history.replaceState(null, '', location);
  render(<OpsConsole />);
  expect(screen.getByRole('link', { name: '前往管理員登入' }).getAttribute('href')).toBe(href);
});

it('clears the current ops hash when building the admin login href', () => {
  expect(adminLoginHref('/admin/ops#affiliation')).toBe(
    '/admin/login?returnUrl=%2Fadmin%2Fops%23affiliation#',
  );
  expect(adminLoginHref('/admin/ops#affiliation#affiliation')).toBe(
    '/admin/login?returnUrl=%2Fadmin%2Fops%23affiliation#',
  );
});

it('reads an ops tab from a stacked leftover hash', () => {
  expect(readOpsTab('', '#affiliation#affiliation')).toBe('affiliation');
  expect(readOpsTab('tab=people', '#affiliation#affiliation')).toBe('people');
  expect(readOpsTab('', 'affiliation#affiliation')).toBe('affiliation');
});

it('selects affiliation when a leftover login hash is stacked on the ops fragment', async () => {
  mocks.session = {
    platformAccountId: 'pa_1',
    context: 'a'.repeat(43),
    isPlatformOperator: true,
  };
  window.history.replaceState(null, '', '/admin/ops#affiliation#affiliation');
  render(<OpsConsole />);
  expect((await screen.findByRole('tab', { name: '課班掛靠' })).getAttribute('aria-selected')).toBe(
    'true',
  );
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
  expect(await screen.findByRole('heading', { name: '學校管理授權總覽' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '加人' })).toBeTruthy();
});

const principal = {
  platformAccountId: 'pa_1',
  context: 'a'.repeat(43),
  isPlatformOperator: true,
};

function ok(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function peopleStatus(tenantId: string, hasRoleAdmin = true, tenantState = 'open') {
  return {
    tenantId,
    displayName: tenantId,
    tenantState,
    hasRoleAdmin,
    roleAdmins: hasRoleAdmin ? [{ personId: 'admin-1', displayName: '既有管理員' }] : [],
    people: [],
    honesty: '平台授權總覽',
  };
}

function setupPeople({
  lifecycle = 'open',
  hasRoleAdmin = true,
  proxyActive = true,
}: {
  lifecycle?: 'open' | 'provisioned' | 'suspended';
  hasRoleAdmin?: boolean;
  proxyActive?: boolean;
} = {}) {
  mocks.session = { ...principal };
  window.history.replaceState(null, '', '/admin/ops#people');
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === '/api/platform-admin/schools') {
      return ok({
        schools: ['school-a', 'school-b'].map((tenantId) => ({
          kind: 'tenant',
          applicationId: null,
          tenantId,
          displayName: tenantId,
          emailDomain: null,
          lifecycle,
          description: '',
          modules: { leave: false, identity: false, food: false },
          peopleCount: 0,
          merchantCount: 0,
        })),
      });
    }
    if (url.startsWith('/api/platform-admin/people?')) {
      const tenantId = new URL(url, 'https://nuni.tw').searchParams.get('tenantId');
      return ok(peopleStatus(tenantId!, hasRoleAdmin, lifecycle));
    }
    const proxyTenant = /^\/api\/platform-admin\/schools\/(school-[ab])\/proxy$/.exec(url)?.[1];
    if (proxyTenant) {
      return ok({
        tenantId: proxyTenant,
        expiresAt: new Date(proxyActive ? Date.now() + 60000 : 0).toISOString(),
        extended: false,
        ended: !proxyActive,
      });
    }
    if (url === '/api/platform-admin/people/bind' && options?.method === 'POST') {
      const input = JSON.parse(String(options.body));
      if (
        !['school-a', 'school-b'].includes(input.tenantId) ||
        !['school_admin', 'school_staff'].includes(input.role) ||
        !(typeof input.email === 'string' || typeof input.personId === 'string') ||
        typeof input.idempotencyKey !== 'string'
      )
        return ok({}, 400);
      return ok(peopleStatus(input.tenantId, true, lifecycle));
    }
    // Do not invent successful legacy endpoints: the pinned API has no schools/:id/people route.
    return ok({}, 404);
  });
}

async function selectSchool(tenantId: string, waitUntilReady = true) {
  fireEvent.change(await screen.findByRole('combobox', { name: '選擇學校' }), {
    target: { value: tenantId },
  });
  const input = await screen.findByRole('textbox', { name: 'Google 登入信箱或人員代號' });
  if (waitUntilReady) await waitFor(() => expect(input).toHaveProperty('disabled', false));
  return input;
}

it('starts a new add-person draft when switching schools', async () => {
  setupPeople();
  render(<OpsConsole />);
  fireEvent.change(await selectSchool('school-a'), { target: { value: 'a@example.test' } });
  fireEvent.change(screen.getByRole('combobox', { name: '角色' }), {
    target: { value: 'school_staff' },
  });
  expect(await selectSchool('school-b')).toHaveProperty('value', '');
  expect(screen.getByRole('combobox', { name: '角色' })).toHaveProperty('value', 'school_admin');
  expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

it.each([200, 403])(
  'keeps the new school draft when the previous school add-person response arrives (%s)',
  async (status) => {
    setupPeople();
    const previous = deferredResponse();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url: string, options?: RequestInit) =>
      url === '/api/platform-admin/people/bind' &&
      JSON.parse(String(options?.body)).tenantId === 'school-a'
        ? previous.promise
        : original(url, options),
    );
    render(<OpsConsole />);
    fireEvent.change(await selectSchool('school-a'), { target: { value: 'a@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: '加人' }));
    fireEvent.change(await selectSchool('school-b'), { target: { value: 'b@example.test' } });
    fireEvent.change(screen.getByRole('combobox', { name: '角色' }), {
      target: { value: 'school_staff' },
    });
    await act(async () => {
      previous.resolve(ok(peopleStatus('school-a'), status));
    });
    expect(screen.getByRole('textbox', { name: 'Google 登入信箱或人員代號' })).toHaveProperty(
      'value',
      'b@example.test',
    );
    expect(screen.getByRole('combobox', { name: '角色' })).toHaveProperty('value', 'school_staff');
    expect(screen.queryByText('已為school-a送出加人。')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '加人' }));
    await screen.findByText('已為school-b送出加人。');
    const posts = fetcher.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(posts.map(([url]) => url)).toEqual([
      '/api/platform-admin/people/bind',
      '/api/platform-admin/people/bind',
    ]);
    expect(JSON.parse(posts[0][1].body)).toMatchObject({
      tenantId: 'school-a',
      email: 'a@example.test',
    });
    expect(JSON.parse(posts[1][1].body)).toMatchObject({
      tenantId: 'school-b',
      email: 'b@example.test',
      role: 'school_staff',
    });
  },
);

it.each(['context', 'platformAccountId'] as const)(
  'isolates a pending add-person request when %s changes',
  async (field) => {
    setupPeople();
    const previous = deferredResponse();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url: string, options?: RequestInit) =>
      options?.method === 'POST' ? previous.promise : original(url, options),
    );
    const view = render(<OpsConsole />);
    fireEvent.change(await selectSchool('school-a'), { target: { value: 'old@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: '加人' }));
    mocks.session = { ...principal, [field]: field === 'context' ? 'b'.repeat(43) : 'pa_2' };
    view.rerender(<OpsConsole />);
    expect(screen.queryByRole('textbox', { name: 'Google 登入信箱或人員代號' })).toBeNull();
    const newAccount = await screen.findByRole('textbox', { name: 'Google 登入信箱或人員代號' });
    await waitFor(() => expect(newAccount).toHaveProperty('disabled', false));
    expect(newAccount).toHaveProperty('value', '');
    fireEvent.change(newAccount, { target: { value: 'new@example.test' } });
    await act(async () => {
      previous.resolve(ok({}));
    });
    expect(newAccount).toHaveProperty('value', 'new@example.test');
    expect(screen.queryByText('已為school-a送出加人。')).toBeNull();
    expect(screen.getByRole('button', { name: '加人' })).toHaveProperty('disabled', false);
  },
);

it.each(['loading', 'pendingLogout'] as const)(
  'blocks add-person actions while %s pauses authorization and discards old completions',
  async (field) => {
    setupPeople();
    const previous = deferredResponse();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url: string, options?: RequestInit) =>
      options?.method === 'POST' ? previous.promise : original(url, options),
    );
    const view = render(<OpsConsole />);
    const account = await selectSchool('school-a');
    fireEvent.change(account, { target: { value: 'old@example.test' } });
    const form = account.closest('form')!;
    fireEvent.submit(form);
    mocks[field] = true;
    view.rerender(<OpsConsole />);
    expect(screen.queryByRole('button', { name: '加人' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Google 登入信箱或人員代號' })).toBeNull();
    fireEvent.submit(form);
    await act(async () => {
      previous.resolve(ok({}));
    });
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    mocks[field] = false;
    view.rerender(<OpsConsole />);
    expect(
      await screen.findByRole('textbox', { name: 'Google 登入信箱或人員代號' }),
    ).toHaveProperty('value', '');
    expect(screen.queryByText('已為school-a送出加人。')).toBeNull();
  },
);

it('sends only one add-person request while a submission is pending', async () => {
  setupPeople();
  const pending = deferredResponse();
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, options?: RequestInit) =>
    options?.method === 'POST' ? pending.promise : original(url, options),
  );
  render(<OpsConsole />);
  const account = await selectSchool('school-a');
  fireEvent.change(account, { target: { value: 'person-1' } });
  const form = account.closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  expect(screen.getByRole('combobox', { name: '角色' })).toHaveProperty('disabled', true);
  await act(async () => {
    pending.resolve(ok(peopleStatus('school-a')));
  });
  await waitFor(() => expect(account).toHaveProperty('value', ''));
});

it('uses the existing people bind endpoint and accepts only its matching tenant response', async () => {
  setupPeople();
  render(<OpsConsole />);
  fireEvent.change(await selectSchool('school-a'), { target: { value: 'teacher@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: '加人' }));
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true),
  );
  const posted = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!;
  expect(posted[0]).toBe('/api/platform-admin/people/bind');
  expect(posted[1].method).toBe('POST');
  expect(posted[1].headers).toMatchObject({ 'X-Campus-Session': principal.context });
  expect(JSON.parse(posted[1].body)).toMatchObject({
    tenantId: 'school-a',
    email: 'teacher@example.test',
    role: 'school_admin',
  });
  await screen.findByText('已為school-a送出加人。');
});

it('binds the first school administrator through the existing API before allowing staff roles', async () => {
  setupPeople({ lifecycle: 'provisioned', hasRoleAdmin: false, proxyActive: false });
  render(<OpsConsole />);
  const input = await selectSchool('school-a');
  expect(screen.queryByRole('option', { name: '學校職員' })).toBeNull();
  fireEvent.change(input, { target: { value: 'first-admin@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: '加人' }));
  await screen.findByText('已為school-a送出加人。');
  const posted = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!;
  expect(posted[0]).toBe('/api/platform-admin/people/bind');
  expect(posted[1].method).toBe('POST');
  expect(JSON.parse(posted[1].body)).toMatchObject({
    tenantId: 'school-a',
    email: 'first-admin@example.test',
    role: 'school_admin',
    idempotencyKey: expect.stringMatching(/^web-people-.+/),
  });
  expect(screen.getByRole('option', { name: '學校職員' })).toBeTruthy();
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/proxy'))).toBe(false);
});

it('requires an explicit proxy session before adding people to an open school', async () => {
  setupPeople({ proxyActive: false });
  render(<OpsConsole />);
  const input = await selectSchool('school-a', false);
  expect(await screen.findByText('已開通學校須先啟用代操作，才能加人。')).toBeTruthy();
  expect(input).toHaveProperty('disabled', true);
  fireEvent.change(input, { target: { value: 'teacher@example.test' } });
  fireEvent.submit(input.closest('form')!);
  expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '前往學校分頁啟用代操作' }));
  expect(screen.getByText('學校分頁')).toBeTruthy();
  expect(new URLSearchParams(window.location.search).get('tab')).toBe('schools');
});

it('rechecks proxy expiry at submit time before the expiry timer redraws', async () => {
  setupPeople();
  render(<OpsConsole />);
  const input = await selectSchool('school-a');
  fireEvent.change(input, { target: { value: 'teacher@example.test' } });
  const future = Date.now() + 120000;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(future);
  try {
    fireEvent.submit(input.closest('form')!);
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  } finally {
    clock.mockRestore();
  }
});

it.each([{}, peopleStatus('school-b')])(
  'does not acknowledge an invalid or mismatched bind response',
  async (response) => {
    setupPeople();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url: string, options?: RequestInit) =>
      options?.method === 'POST' ? Promise.resolve(ok(response)) : original(url, options),
    );
    render(<OpsConsole />);
    const input = await selectSchool('school-a');
    fireEvent.change(input, { target: { value: 'teacher@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: '加人' }));
    await screen.findByRole('alert');
    expect(input).toHaveProperty('value', 'teacher@example.test');
    expect(screen.queryByText('已為school-a送出加人。')).toBeNull();
  },
);

const REVIEW_REASON = '已核實申請資料並完成校方資格確認。';

async function submitReview(button: string, reason = REVIEW_REASON) {
  fireEvent.click(await screen.findByRole('button', { name: button }));
  fireEvent.change(await screen.findByRole('textbox', { name: '審核理由' }), {
    target: { value: reason },
  });
  fireEvent.click(screen.getByRole('button', { name: button === '拒絕' ? '確認拒絕' : '確認核准' }));
}

const extraOperations = [
  { tab: 'merchants', button: '核准意向' },
  { tab: 'affiliation', button: '核准掛靠' },
] as const;

const merchantInterestId = 'mpi_11111111-1111-4111-8111-111111111111';
const merchantApplicationId = 'fma_22222222-2222-4222-8222-222222222222';

function merchantsPayload(brandName = '本帳號店家') {
  return {
    interest: [
      {
        id: merchantInterestId,
        state: 'submitted',
        brandName,
        schoolName: '學校A',
        contactName: '聯絡人',
        contactEmail: 'merchant@example.test',
        note: null,
        createdAt: '2026-10-25T00:00:00Z',
        decidedAt: null,
      },
    ],
    applications: [
      {
        tenantId: 'school-a',
        tenantName: '學校A',
        applicationId: merchantApplicationId,
        brandName: '本帳號進件',
        locationName: '校內店舖',
        contactName: '聯絡人',
        contactEmail: 'merchant@example.test',
        state: 'submitted',
        version: 7,
        submittedAt: '2026-10-25T00:00:00Z',
      },
    ],
    catalog: [],
    honesty: '意向與進件需先審核。',
  };
}

function setupExtraOperation(tab: 'merchants' | 'affiliation') {
  mocks.session = { ...principal };
  window.history.replaceState(null, '', `/admin/ops#${tab}`);
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/api/platform-admin/merchants')) {
      return ok(merchantsPayload());
    }
    if (url.endsWith('/class-workspace-affiliation-applications')) {
      return ok({ applications: [{ id: 'affiliation-1', workspaceTitle: '本帳號課班' }] });
    }
    if (options?.method === 'POST') {
      if (
        url === `/api/platform-admin/merchants/interest/${merchantInterestId}/decision` ||
        url ===
          `/api/platform-admin/merchants/applications/school-a/${merchantApplicationId}/decision` ||
        url ===
          '/api/platform-admin/class-workspace-affiliation-applications/affiliation-1/decision'
      )
        return ok({});
    }
    return ok({}, 404);
  });
}

it.each(extraOperations)(
  'isolates $tab data when account context changes during loading',
  async ({ tab, button }) => {
    setupExtraOperation(tab);
    const previous = deferredResponse();
    fetcher.mockImplementationOnce(() => previous.promise);
    const view = render(<OpsConsole />);
    mocks.session = { ...principal, context: 'b'.repeat(43) };
    view.rerender(<OpsConsole />);
    await screen.findByRole('button', { name: button });
    await act(async () => {
      previous.resolve(
        ok(
          tab === 'merchants'
            ? merchantsPayload('前帳號店家')
            : {
                applications: [{ id: 'old-affiliation', workspaceTitle: '前帳號課班' }],
              },
        ),
      );
    });
    expect(screen.queryByText(/前帳號/)).toBeNull();
    expect(screen.getByRole('button', { name: button })).toBeTruthy();
  },
);

it.each(extraOperations)(
  'does not apply an old $tab decision or reload after an account switch',
  async ({ tab, button }) => {
    setupExtraOperation(tab);
    const previous = deferredResponse();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url: string, options?: RequestInit) =>
      options?.method === 'POST' ? previous.promise : original(url, options),
    );
    const view = render(<OpsConsole />);
    await submitReview(button);
    mocks.session = { ...principal, context: 'b'.repeat(43) };
    view.rerender(<OpsConsole />);
    await screen.findByRole('button', { name: button });
    const requestCount = fetcher.mock.calls.length;
    await act(async () => {
      previous.resolve(ok({}));
    });
    expect(fetcher).toHaveBeenCalledTimes(requestCount);
    expect(screen.queryByText('已核准這筆店家申請。')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: button })).toHaveProperty('disabled', false);
  },
);

it.each(extraOperations)(
  'suspends $tab actions and ignores earlier mutation completions during authorization refresh',
  async ({ tab, button }) => {
    setupExtraOperation(tab);
    const previous = deferredResponse();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url: string, options?: RequestInit) =>
      options?.method === 'POST' ? previous.promise : original(url, options),
    );
    const view = render(<OpsConsole />);
    await submitReview(button);
    mocks.loading = true;
    view.rerender(<OpsConsole />);
    expect(screen.getByText('正在確認管理權限…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: button })).toBeNull();
    const requestCount = fetcher.mock.calls.length;
    await act(async () => {
      previous.resolve(ok({}));
    });
    expect(fetcher).toHaveBeenCalledTimes(requestCount);
    mocks.loading = false;
    view.rerender(<OpsConsole />);
    expect(await screen.findByRole('button', { name: button })).toHaveProperty('disabled', false);
    expect(screen.queryByText('已核准這筆店家申請。')).toBeNull();
  },
);

it.each(extraOperations)(
  'does not load $tab privileged data while logout is pending',
  async ({ tab, button }) => {
    setupExtraOperation(tab);
    mocks.pendingLogout = true;
    render(<OpsConsole />);
    expect(screen.getByText('正在確認管理權限…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: button })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('reports merchant load failures without leaving an unhandled request rejection', async () => {
  setupExtraOperation('merchants');
  fetcher.mockRejectedValue(new Error('offline'));
  render(<OpsConsole />);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '目前讀不到待審店家。');
});

it.each(['approve', 'reject'] as const)(
  'sends merchant interest %s to the existing nested endpoint',
  async (decision) => {
    setupExtraOperation('merchants');
    render(<OpsConsole />);
    const article = (await screen.findByText('本帳號店家 · 學校A')).closest('article')!;
    fireEvent.click(
      within(article).getByRole('button', { name: decision === 'approve' ? '核准意向' : '拒絕' }),
    );
    fireEvent.change(within(article).getByRole('textbox', { name: '審核理由' }), {
      target: { value: REVIEW_REASON },
    });
    fireEvent.click(within(article).getByRole('button', {
      name: decision === 'approve' ? '確認核准' : '確認拒絕',
    }));
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true),
    );
    const posted = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(posted[0]).toBe(`/api/platform-admin/merchants/interest/${merchantInterestId}/decision`);
    expect(posted[1].method).toBe('POST');
    expect(JSON.parse(posted[1].body)).toEqual({
      decision,
      reason: REVIEW_REASON,
      idempotencyKey: expect.stringMatching(/^web-merchant-decide-.+/),
    });
    await screen.findByText(
      decision === 'approve' ? '已核准這筆店家申請。' : '已拒絕這筆店家申請。',
    );
  },
);

it.each(['approve', 'reject'] as const)(
  'sends merchant application %s with its tenant and reviewed version',
  async (decision) => {
    setupExtraOperation('merchants');
    render(<OpsConsole />);
    const article = (await screen.findByText('本帳號進件／校內店舖')).closest('article')!;
    fireEvent.click(
      within(article).getByRole('button', { name: decision === 'approve' ? '核准進件' : '拒絕' }),
    );
    fireEvent.change(within(article).getByRole('textbox', { name: '審核理由' }), {
      target: { value: REVIEW_REASON },
    });
    fireEvent.click(within(article).getByRole('button', {
      name: decision === 'approve' ? '確認核准' : '確認拒絕',
    }));
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true),
    );
    const posted = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(posted[0]).toBe(
      `/api/platform-admin/merchants/applications/school-a/${merchantApplicationId}/decision`,
    );
    expect(posted[1].method).toBe('POST');
    expect(JSON.parse(posted[1].body)).toEqual({
      decision,
      reason: REVIEW_REASON,
      expectedVersion: 7,
    });
    await screen.findByText(
      decision === 'approve' ? '已核准這筆店家申請。' : '已拒絕這筆店家申請。',
    );
  },
);

it('does not submit a merchant application whose reviewed version is missing', async () => {
  setupExtraOperation('merchants');
  const data = merchantsPayload();
  fetcher.mockResolvedValue(
    ok({ ...data, applications: [{ ...data.applications[0], version: undefined }] }),
  );
  render(<OpsConsole />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: '核准進件' })).toBeNull();
  expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

it('reloads a conflicting merchant application for review without replaying the decision', async () => {
  setupExtraOperation('merchants');
  let reads = 0;
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') return ok({}, 409);
    if (url === '/api/platform-admin/merchants') {
      const data = merchantsPayload();
      data.applications[0].version = ++reads === 1 ? 7 : 8;
      return ok(data);
    }
    return ok({}, 404);
  });
  render(<OpsConsole />);
  await submitReview('核准進件');
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    '這筆申請已更新，請確認最新資料後再審核。',
  );
  await waitFor(() => expect(reads).toBe(2));
  const posts = fetcher.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0][1].body).expectedVersion).toBe(7);
  expect(screen.queryByText('已核准這筆店家申請。')).toBeNull();
});

it.each([
  { button: '核准掛靠', decision: 'approve', reason: REVIEW_REASON },
  { button: '拒絕', decision: 'reject', reason: REVIEW_REASON },
])(
  'keeps the existing affiliation $decision request contract',
  async ({ button, decision, reason }) => {
    setupExtraOperation('affiliation');
    render(<OpsConsole />);
    await submitReview(button);
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true),
    );
    const posted = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(posted[1].headers).toMatchObject({ 'X-Campus-Session': principal.context });
    expect(posted[0]).toBe(
      '/api/platform-admin/class-workspace-affiliation-applications/affiliation-1/decision',
    );
    expect(JSON.parse(posted[1].body)).toMatchObject({ decision, reason });
  },
);

it('restores the selected operations tab from the query and browser history', async () => {
  setupExtraOperation('merchants');
  window.history.replaceState(null, '', '/admin/ops?tab=people');
  render(<OpsConsole />);
  expect(await screen.findByRole('heading', { name: '加人' })).toBeTruthy();
  window.history.replaceState(null, '', '/admin/ops?tab=merchants');
  fireEvent.popState(window);
  expect(await screen.findByRole('button', { name: '核准意向' })).toBeTruthy();
});

it.each(extraOperations)(
  'preserves the $tab task when a current session expires',
  async ({ tab, button }) => {
    setupExtraOperation(tab);
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, replace });
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url: string, options?: RequestInit) =>
      options?.method === 'POST' ? Promise.resolve(ok({}, 401)) : original(url, options),
    );
    render(<OpsConsole />);
    await submitReview(button);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        `/auth/account?returnUrl=${encodeURIComponent(`/admin/ops?tab=${tab}`)}`,
      ),
    );
  },
);

it('requires a specific review reason and permits cancelling before submission', async () => {
  setupExtraOperation('merchants');
  render(<OpsConsole />);
  const article = (await screen.findByText('本帳號店家 · 學校A')).closest('article')!;
  fireEvent.click(within(article).getByRole('button', { name: '拒絕' }));
  expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  const reason = within(article).getByRole('textbox', { name: '審核理由' });
  fireEvent.change(reason, { target: { value: '短' } });
  expect(within(article).getByRole('button', { name: '確認拒絕' })).toHaveProperty('disabled', true);
  fireEvent.change(reason, { target: { value: REVIEW_REASON } });
  fireEvent.click(within(article).getByRole('button', { name: '取消' }));
  expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  expect(within(article).queryByRole('textbox', { name: '審核理由' })).toBeNull();
});

it('only accepts well-formed school identifiers in management deep links', () => {
  expect(readOpsSchool('?tab=people&school=school-a')).toBe('school-a');
  expect(readOpsSchool('?school=../school-b')).toBeNull();
  expect(readOpsSchool('?school=')).toBeNull();
});

it('supports arrow-key tab navigation and restores tabs from browser history', async () => {
  setupExtraOperation('merchants');
  window.history.replaceState(null, '', '/admin/ops?tab=merchants');
  render(<OpsConsole />);
  const tab = await screen.findByRole('tab', { name: '店家' });
  fireEvent.keyDown(tab, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: '課班掛靠' }).getAttribute('aria-selected')).toBe('true');
  expect(window.location.search).toBe('?tab=affiliation');
  window.history.replaceState(null, '', '/admin/ops?tab=merchants');
  fireEvent.popState(window);
  expect(screen.getByRole('tab', { name: '店家' }).getAttribute('aria-selected')).toBe('true');
});

it('keeps different affiliation review reasons isolated', async () => {
  setupExtraOperation('affiliation');
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith('/class-workspace-affiliation-applications')
      ? ok({ applications: [
          { id: 'affiliation-1', workspaceTitle: '課班一' },
          { id: 'affiliation-2', workspaceTitle: '課班二' },
        ] })
      : ok({}, 404),
  );
  render(<OpsConsole />);
  const first = (await screen.findByText('課班一')).closest('article')!;
  const second = (await screen.findByText('課班二')).closest('article')!;
  fireEvent.click(within(first).getByRole('button', { name: '核准掛靠' }));
  fireEvent.change(within(first).getByRole('textbox', { name: '審核理由' }), {
    target: { value: REVIEW_REASON },
  });
  fireEvent.click(within(second).getByRole('button', { name: '拒絕' }));
  expect(within(second).getByRole('textbox', { name: '審核理由' })).toHaveProperty('value', '');
  expect(within(first).getByRole('textbox', { name: '審核理由' })).toHaveProperty('value', REVIEW_REASON);
});
