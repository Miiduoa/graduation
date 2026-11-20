import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminMerchantReview } from './AdminMerchantReview';
import { AdminAffiliationReview } from './AdminAffiliationReview';
import { AdminPeopleManagement } from './AdminPeopleManagement';

const context = 'a'.repeat(43);
const fetcher = vi.fn();
const reason = '已確認聯絡資料及校方資格。';

function ok(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function merchantData() {
  return {
    interest: [
      {
        id: 'interest-a',
        brandName: '咖啡合作',
        schoolName: '第一大學',
        contactName: '聯絡甲',
        contactEmail: 'a@example.test',
        note: null,
        state: 'submitted',
        createdAt: '2026-11-01T00:00:00Z',
        decidedAt: null,
      },
      {
        id: 'interest-b',
        brandName: '便當合作',
        schoolName: '第二大學',
        contactName: '聯絡乙',
        contactEmail: 'b@example.test',
        note: null,
        state: 'submitted',
        createdAt: '2026-11-02T00:00:00Z',
        decidedAt: null,
      },
      {
        id: 'interest-complete',
        brandName: '已核准合作',
        schoolName: '第一大學',
        contactName: '聯絡丙',
        contactEmail: 'c@example.test',
        note: null,
        state: 'approved',
        createdAt: '2026-10-01T00:00:00Z',
        decidedAt: '2026-10-02T00:00:00Z',
      },
    ],
    applications: [
      {
        tenantId: 'school-a',
        tenantName: '第一大學',
        applicationId: 'application-a',
        brandName: '餐飲進件',
        locationName: '校內店舖',
        contactName: '聯絡丁',
        contactEmail: 'd@example.test',
        state: 'submitted',
        version: 7,
        submittedAt: '2026-11-03T00:00:00Z',
      },
    ],
    catalog: [
      {
        tenantId: 'school-a',
        tenantName: '第一大學',
        locationId: 'location-a',
        locationName: '已登錄店舖',
        merchantMode: 'info_only',
        merchantModeLabel: '資訊展示',
        sourceLabel: '校方提供',
        sourceUpdatedAt: null,
        published: true,
        locationStatus: 'open',
        publicAccess: true,
      },
    ],
    honesty: '接入狀態依本次讀取資料顯示。',
  };
}

function applicationDecisionPayload(state = 'approved', version = 8) {
  const row = merchantData().applications[0];
  return {
    tenantId: row.tenantId,
    applicationId: row.applicationId,
    businessKind: 'campus-stall',
    legalName: row.brandName,
    brandName: row.brandName,
    businessRegistrationNumber: null,
    foodBusinessRegistrationNumber: null,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: '0900000000',
    locationName: row.locationName,
    operatingAddress: '合成校區',
    campusLabel: '第一大學',
    campusId: 'campus-a',
    serviceModes: ['pickup'],
    state,
    version,
    businessRegistryCheck: 'not-applicable',
    foodRegistryCheck: 'not-applicable',
    reasonCode: 'platform-operator-reviewed',
    reviewerNote: reason,
    merchantId: state === 'approved' ? 'merchant-a' : null,
    locationId: state === 'approved' ? 'location-a' : null,
    submittedAt: row.submittedAt,
    updatedAt: '2026-11-06T00:00:00Z',
  };
}

beforeEach(() => {
  fetcher.mockReset().mockResolvedValue(ok(merchantData()));
  vi.stubGlobal('fetch', fetcher);
  window.history.replaceState(null, '', '/admin#merchants');
});

afterEach(() => vi.unstubAllGlobals());

it('loads review and catalog from one request and renders each pending application once', async () => {
  render(<AdminMerchantReview context={context} suspended={false} />);
  await screen.findByRole('article', { name: '咖啡合作／第一大學合作意向' });
  expect(screen.getAllByText('咖啡合作 · 第一大學')).toHaveLength(1);
  expect(screen.getAllByText('餐飲進件／校內店舖')).toHaveLength(1);
  expect(screen.getByText('已登錄店舖 · 第一大學')).toBeTruthy();
  expect(screen.getByText('已核准合作 · 第一大學')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '前往完整管理台審核' })).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('/api/platform-admin/merchants');
});

it('opens only the selected merchant case and keeps the return action in the workspace', async () => {
  const onSelect = vi.fn();
  render(
    <AdminMerchantReview
      context={context}
      suspended={false}
      selectedId="application:school-a:application-a"
      onSelect={onSelect}
    />,
  );
  const selected = await screen.findByRole('article', { name: '餐飲進件／校內店舖店家進件' });
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.queryByText('咖啡合作 · 第一大學')).toBeNull();
  expect(screen.queryByRole('heading', { name: '店家目錄與申請紀錄' })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(selected));
  fireEvent.click(screen.getByRole('button', { name: '查看全部申請' }));
  expect(onSelect).toHaveBeenCalledWith(null);
});

it('does not replace a missing merchant case with unrelated applications', async () => {
  render(
    <AdminMerchantReview
      context={context}
      suspended={false}
      selectedId="application:school-b:application-a"
      onSelect={vi.fn()}
    />,
  );
  await screen.findByText('本次載入找不到這筆店家申請。請更新清單或查看全部申請。');
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: '核准進件' })).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(['submitted', 'under-review', 'needs-information'])(
  'decides a %s merchant case and shows the refreshed result without offering another decision',
  async (state) => {
    const data = merchantData();
    data.applications[0].state = state;
    fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        data.applications[0].state = 'approved';
        data.applications[0].version = 8;
        return ok(applicationDecisionPayload());
      }
      return ok(data);
    });
    render(
      <AdminMerchantReview
        context={context}
        suspended={false}
        selectedId="application:school-a:application-a"
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '核准進件' }));
    fireEvent.change(screen.getByRole('textbox', { name: '審核理由' }), {
      target: { value: reason },
    });
    fireEvent.click(screen.getByRole('button', { name: '確認核准' }));
    await screen.findByText('店家進件 · 已核准');
    expect(screen.queryByRole('button', { name: '核准進件' })).toBeNull();
    const posts = fetcher.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe(
      '/api/platform-admin/merchants/applications/school-a/application-a/decision',
    );
    expect(JSON.parse(posts[0][1].body)).toEqual({
      decision: 'approve',
      reason,
      expectedVersion: 7,
    });
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'GET')).toHaveLength(2);
  },
);

it('keeps the workspace dirty while another merchant review remains open', async () => {
  const onDraftChange = vi.fn();
  render(<AdminMerchantReview context={context} suspended={false} onDraftChange={onDraftChange} />);
  const first = within(await screen.findByRole('article', { name: '咖啡合作／第一大學合作意向' }));
  const second = within(screen.getByRole('article', { name: '便當合作／第二大學合作意向' }));
  fireEvent.click(first.getByRole('button', { name: '核准意向' }));
  fireEvent.change(first.getByRole('textbox', { name: '審核理由' }), { target: { value: reason } });
  fireEvent.click(second.getByRole('button', { name: '拒絕' }));
  expect(onDraftChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(first.getByRole('button', { name: '取消' }));
  expect(onDraftChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(second.getByRole('button', { name: '取消' }));
  expect(onDraftChange).toHaveBeenLastCalledWith(false);
  expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

it('discards a decision completion after selecting another merchant case', async () => {
  const pending = deferred();
  fetcher.mockImplementation(async (_url: string, options?: RequestInit) =>
    options?.method === 'POST' ? pending.promise : ok(merchantData()),
  );
  const view = render(
    <AdminMerchantReview context={context} suspended={false} selectedId="interest:interest-a" />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '核准意向' }));
  fireEvent.change(screen.getByRole('textbox', { name: '審核理由' }), {
    target: { value: reason },
  });
  fireEvent.click(screen.getByRole('button', { name: '確認核准' }));
  view.rerender(
    <AdminMerchantReview context={context} suspended={false} selectedId="interest:interest-b" />,
  );
  await screen.findByRole('article', { name: '便當合作／第二大學合作意向' });
  const calls = fetcher.mock.calls.length;
  await act(async () => pending.resolve(ok({})));
  expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(screen.queryByText('已核准這筆店家申請。')).toBeNull();
});

const affiliationData = {
  applications: [
    {
      id: 'affiliation-a',
      workspaceId: 'workspace-a',
      workspaceTitle: '專題課班',
      tenantId: 'school-a',
      sectionId: null,
      justification: '已確認課班及目標學校。',
      state: 'pending',
      createdAt: '2026-11-01T00:00:00Z',
      decidedAt: null,
      decisionReason: null,
    },
    {
      id: 'affiliation-b',
      workspaceId: 'workspace-b',
      workspaceTitle: '資訊課班',
      tenantId: 'school-b',
      sectionId: null,
      justification: '已確認課班及目標學校。',
      state: 'pending',
      createdAt: '2026-11-02T00:00:00Z',
      decidedAt: null,
      decisionReason: null,
    },
  ],
};

function installAffiliationApi() {
  fetcher.mockImplementation(async (url: string) => {
    if (url === '/api/platform-admin/schools')
      return ok({
        schools: ['school-a', 'school-b'].map((tenantId, index) => ({
          kind: 'tenant',
          applicationId: null,
          tenantId,
          displayName: index === 0 ? '第一大學' : '第二大學',
          emailDomain: null,
          lifecycle: 'open',
          description: '',
          modules: { leave: false, identity: false, food: false },
          peopleCount: 1,
          merchantCount: 0,
        })),
      });
    return ok(affiliationData);
  });
}

it('opens a specific affiliation with a visible return to all cases', async () => {
  installAffiliationApi();
  const onSelect = vi.fn();
  render(
    <AdminAffiliationReview
      context={context}
      suspended={false}
      selectedId="affiliation-b"
      onSelect={onSelect}
    />,
  );
  const article = await screen.findByRole('article', { name: '資訊課班／第二大學掛靠申請' });
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.queryByText('專題課班')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(article));
  fireEvent.click(screen.getByRole('button', { name: '查看全部申請' }));
  expect(onSelect).toHaveBeenCalledWith(null);
});

it('explains a missing affiliation without rendering another school case', async () => {
  installAffiliationApi();
  render(
    <AdminAffiliationReview
      context={context}
      suspended={false}
      selectedId="missing"
      onSelect={vi.fn()}
    />,
  );
  await screen.findByText('本次載入找不到這筆掛靠申請。請更新清單或查看全部申請。');
  expect(screen.queryAllByRole('article')).toHaveLength(0);
});

it('marks affiliation review drafts dirty and removes them during permission revalidation', async () => {
  installAffiliationApi();
  const onDraftChange = vi.fn();
  const view = render(
    <AdminAffiliationReview
      context={context}
      suspended={false}
      selectedId="affiliation-a"
      onDraftChange={onDraftChange}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '核准掛靠' }));
  fireEvent.change(screen.getByRole('textbox', { name: '審核理由' }), {
    target: { value: reason },
  });
  expect(onDraftChange).toHaveBeenLastCalledWith(true);
  const calls = fetcher.mock.calls.length;
  view.rerender(
    <AdminAffiliationReview
      context={context}
      suspended
      selectedId="affiliation-a"
      onDraftChange={onDraftChange}
    />,
  );
  expect(screen.queryByRole('textbox', { name: '審核理由' })).toBeNull();
  expect(onDraftChange).toHaveBeenLastCalledWith(false);
  expect(fetcher).toHaveBeenCalledTimes(calls);
});

function peopleData() {
  return {
    tenantId: 'school-a',
    displayName: '第一大學',
    tenantState: 'open',
    hasRoleAdmin: true,
    roleAdmins: [{ personId: 'admin-a', displayName: '現任管理員' }],
    people: [],
    honesty: '目前校方授權。',
  };
}

function installPeopleApi() {
  let active = false;
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === '/api/platform-admin/schools')
      return ok({
        schools: [
          {
            kind: 'tenant',
            applicationId: null,
            tenantId: 'school-a',
            displayName: '第一大學',
            emailDomain: 'a.edu.tw',
            lifecycle: 'open',
            description: '',
            modules: { leave: false, identity: false, food: false },
            peopleCount: 1,
            merchantCount: 0,
          },
        ],
      });
    if (url === '/api/platform-admin/people?tenantId=school-a') return ok(peopleData());
    if (url === '/api/platform-admin/people/bind' && options?.method === 'POST')
      return ok(peopleData());
    if (url.startsWith('/api/platform-admin/schools/school-a/proxy')) {
      if (url.endsWith('/start')) active = true;
      if (url.endsWith('/end')) active = false;
      return ok({
        tenantId: 'school-a',
        expiresAt: new Date(active ? Date.now() + 900000 : 0).toISOString(),
        extended: false,
        ended: !active,
      });
    }
    return ok({}, 404);
  });
}

it('starts delegation, grants a role, and ends delegation without leaving the people workspace', async () => {
  installPeopleApi();
  const onManageSchool = vi.fn();
  const onDraftChange = vi.fn();
  render(
    <AdminPeopleManagement
      context={context}
      suspended={false}
      selectedSchool="school-a"
      onSchool={vi.fn()}
      onManageSchool={onManageSchool}
      onDraftChange={onDraftChange}
    />,
  );
  const input = await screen.findByRole('textbox', { name: 'Google 登入信箱或人員代號' });
  expect(input).toHaveProperty('disabled', true);
  fireEvent.click(await screen.findByRole('button', { name: '開始 15 分鐘代操作' }));
  await waitFor(() => expect(input).toHaveProperty('disabled', false));
  expect(screen.getByRole('combobox', { name: '角色' })).toHaveProperty('value', 'school_staff');
  fireEvent.change(input, { target: { value: 'staff@example.test' } });
  fireEvent.change(screen.getByRole('combobox', { name: '角色' }), {
    target: { value: 'school_staff' },
  });
  expect(onDraftChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '新增授權' }));
  await screen.findByText('已為第一大學新增校方授權。');
  await waitFor(() => expect(onDraftChange).toHaveBeenLastCalledWith(false));
  fireEvent.click(screen.getByRole('button', { name: '結束代操作' }));
  await screen.findByRole('button', { name: '開始 15 分鐘代操作' });
  expect(input).toHaveProperty('disabled', true);
  expect(onManageSchool).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: '新增或調整校方人員' })).toBeNull();
  const posts = fetcher.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(posts.map(([url]) => url)).toEqual([
    '/api/platform-admin/schools/school-a/proxy/start',
    '/api/platform-admin/people/bind',
    '/api/platform-admin/schools/school-a/proxy/end',
  ]);
  expect(JSON.parse(posts[1][1].body)).toMatchObject({
    tenantId: 'school-a',
    role: 'school_staff',
    email: 'staff@example.test',
  });
  expect(posts.every(([, options]) => options.headers['X-Campus-Session'] === context)).toBe(true);
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/platform-admin/schools')).toHaveLength(
    1,
  );
});

it('requires an explicit administrator choice and reuses the same grant key after a failed response', async () => {
  installPeopleApi();
  const fallback = fetcher.getMockImplementation()!;
  let grants = 0;
  fetcher.mockImplementation((url: string, options?: RequestInit) =>
    url.endsWith('/people/bind') && ++grants === 1
      ? Promise.resolve(ok({}, 503))
      : fallback(url, options),
  );
  render(
    <AdminPeopleManagement
      context={context}
      suspended={false}
      selectedSchool="school-a"
      onSchool={vi.fn()}
      onManageSchool={vi.fn()}
    />,
  );
  const input = await screen.findByRole('textbox', { name: 'Google 登入信箱或人員代號' });
  fireEvent.click(await screen.findByRole('button', { name: '開始 15 分鐘代操作' }));
  await waitFor(() => expect(input).toHaveProperty('disabled', false));
  expect(screen.getByRole('combobox', { name: '角色' })).toHaveProperty('value', 'school_staff');
  fireEvent.change(input, { target: { value: 'second-admin@example.test' } });
  fireEvent.change(screen.getByRole('combobox', { name: '角色' }), {
    target: { value: 'school_admin' },
  });
  fireEvent.click(screen.getByRole('button', { name: '新增授權' }));
  await screen.findByText('新增授權沒有完成，請稍後再試。');
  fireEvent.click(screen.getByRole('button', { name: '新增授權' }));
  await screen.findByText('已為第一大學新增校方授權。');
  const bodies = fetcher.mock.calls
    .filter(([url]) => url.endsWith('/people/bind'))
    .map(([, options]) => JSON.parse(options.body));
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0]).toMatchObject({ role: 'school_admin', email: 'second-admin@example.test' });
});

it('returns an expired grant session through administrator login with the exact selected school', async () => {
  installPeopleApi();
  const fallback = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, options?: RequestInit) =>
    url.endsWith('/people/bind') ? Promise.resolve(ok({}, 401)) : fallback(url, options),
  );
  window.history.replaceState(null, '', '/admin#people/school-a');
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace });
  render(
    <AdminPeopleManagement
      context={context}
      suspended={false}
      selectedSchool="school-a"
      onSchool={vi.fn()}
      onManageSchool={vi.fn()}
    />,
  );
  const input = await screen.findByRole('textbox', { name: 'Google 登入信箱或人員代號' });
  fireEvent.click(await screen.findByRole('button', { name: '開始 15 分鐘代操作' }));
  await waitFor(() => expect(input).toHaveProperty('disabled', false));
  fireEvent.change(input, { target: { value: 'staff@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: '新增授權' }));
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith('/admin/login?returnUrl=%2Fadmin%23people%2Fschool-a#'),
  );
});

it('does not revive a people form when delegation responds during session revalidation', async () => {
  installPeopleApi();
  const fallback = fetcher.getMockImplementation()!;
  const pending = deferred();
  fetcher.mockImplementation((url: string, options?: RequestInit) =>
    url.endsWith('/proxy/start') ? pending.promise : fallback(url, options),
  );
  const props = { context, selectedSchool: 'school-a', onSchool: vi.fn(), onManageSchool: vi.fn() };
  const view = render(<AdminPeopleManagement {...props} suspended={false} />);
  fireEvent.click(await screen.findByRole('button', { name: '開始 15 分鐘代操作' }));
  view.rerender(<AdminPeopleManagement {...props} suspended />);
  const calls = fetcher.mock.calls.length;
  await act(async () =>
    pending.resolve(
      ok({
        tenantId: 'school-a',
        expiresAt: new Date(Date.now() + 900000).toISOString(),
        extended: false,
        ended: false,
      }),
    ),
  );
  expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(screen.queryByRole('textbox', { name: 'Google 登入信箱或人員代號' })).toBeNull();
  expect(screen.queryByText('已開始代操作，正在重新確認授權。')).toBeNull();
});

it('keeps another merchant reason through the automatic reload after a successful decision', async () => {
  const data = merchantData();
  const reload = deferred();
  let reads = 0;
  fetcher.mockImplementation(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      data.interest[0] = {
        ...data.interest[0],
        state: 'approved',
        decidedAt: '2026-11-06T00:00:00Z',
      };
      return ok(data.interest[0]);
    }
    return ++reads === 1 ? ok(data) : reload.promise;
  });
  const onDraftChange = vi.fn();
  const confirm = vi.fn(() => true);
  vi.stubGlobal('confirm', confirm);
  render(<AdminMerchantReview context={context} suspended={false} onDraftChange={onDraftChange} />);
  const first = within(await screen.findByRole('article', { name: '咖啡合作／第一大學合作意向' }));
  const second = within(screen.getByRole('article', { name: '便當合作／第二大學合作意向' }));
  fireEvent.click(second.getByRole('button', { name: '拒絕' }));
  fireEvent.change(second.getByRole('textbox', { name: '審核理由' }), {
    target: { value: '此案需要補上實際合作資訊。' },
  });
  fireEvent.click(first.getByRole('button', { name: '核准意向' }));
  fireEvent.change(first.getByRole('textbox', { name: '審核理由' }), { target: { value: reason } });
  fireEvent.click(first.getByRole('button', { name: '確認核准' }));
  await screen.findByText('已核准這筆店家申請。');
  expect(second.getByRole('textbox', { name: '審核理由' })).toHaveProperty(
    'value',
    '此案需要補上實際合作資訊。',
  );
  expect(second.getByRole('button', { name: '確認拒絕' })).toHaveProperty('disabled', true);
  await act(async () => reload.resolve(ok(data)));
  await waitFor(() =>
    expect(second.getByRole('button', { name: '確認拒絕' })).toHaveProperty('disabled', false),
  );
  expect(second.getByRole('textbox', { name: '審核理由' })).toHaveProperty(
    'value',
    '此案需要補上實際合作資訊。',
  );
  expect(onDraftChange).toHaveBeenLastCalledWith(true);
  expect(confirm).not.toHaveBeenCalled();
});

it.each(['merchant', 'affiliation'] as const)(
  'keeps the %s reason when a manual refresh is cancelled',
  async (kind) => {
    if (kind === 'affiliation') installAffiliationApi();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    if (kind === 'merchant')
      render(
        <AdminMerchantReview
          context={context}
          suspended={false}
          selectedId="interest:interest-a"
        />,
      );
    else
      render(
        <AdminAffiliationReview context={context} suspended={false} selectedId="affiliation-a" />,
      );
    fireEvent.click(
      await screen.findByRole('button', { name: kind === 'merchant' ? '核准意向' : '核准掛靠' }),
    );
    fireEvent.change(screen.getByRole('textbox', { name: '審核理由' }), {
      target: { value: reason },
    });
    const requests = fetcher.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '更新清單' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: '審核理由' })).toHaveProperty('value', reason);
    expect(fetcher).toHaveBeenCalledTimes(requests);
  },
);

it.each([
  { label: 'empty success', value: {} },
  { label: 'another tenant', value: { ...applicationDecisionPayload(), tenantId: 'school-b' } },
  {
    label: 'another application',
    value: { ...applicationDecisionPayload(), applicationId: 'application-b' },
  },
  { label: 'wrong decision', value: applicationDecisionPayload('rejected') },
  { label: 'stale version', value: applicationDecisionPayload('approved', 7) },
])('does not claim merchant success for $label', async ({ value }) => {
  fetcher.mockImplementation(async (_url: string, options?: RequestInit) =>
    options?.method === 'POST' ? ok(value) : ok(merchantData()),
  );
  render(
    <AdminMerchantReview
      context={context}
      suspended={false}
      selectedId="application:school-a:application-a"
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '核准進件' }));
  fireEvent.change(screen.getByRole('textbox', { name: '審核理由' }), {
    target: { value: reason },
  });
  fireEvent.click(screen.getByRole('button', { name: '確認核准' }));
  await screen.findByText('伺服器回應與這筆申請不符，無法確認審核結果。請更新清單確認實際狀態。');
  expect(screen.queryByText('已核准這筆店家申請。')).toBeNull();
  expect(screen.getByRole('textbox', { name: '審核理由' })).toHaveProperty('value', reason);
});

it.each([
  {},
  { items: affiliationData.applications },
  { applications: [{ ...affiliationData.applications[0], state: 'unknown' }] },
])(
  'rejects malformed affiliation queues instead of showing an empty or actionable queue',
  async (value) => {
    installAffiliationApi();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url: string) =>
      url.endsWith('/class-workspace-affiliation-applications')
        ? Promise.resolve(ok(value))
        : original(url),
    );
    render(<AdminAffiliationReview context={context} suspended={false} />);
    await screen.findByText('目前無法確認掛靠申請資料，請更新清單再試。');
    expect(screen.queryByRole('button', { name: '核准掛靠' })).toBeNull();
    expect(screen.queryByText('目前沒有待處理的掛靠申請。')).toBeNull();
  },
);

it('retains a verified affiliation receipt when the pending-only endpoint removes the decided case', async () => {
  installAffiliationApi();
  const original = fetcher.getMockImplementation()!;
  let decided = false;
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      decided = true;
      return ok({
        ...affiliationData.applications[0],
        state: 'approved',
        decidedAt: '2026-11-06T00:00:00Z',
        decisionReason: reason,
      });
    }
    if (decided && url.endsWith('/class-workspace-affiliation-applications'))
      return ok({ applications: [affiliationData.applications[1]] });
    return original(url, options);
  });
  const onDraftChange = vi.fn();
  render(
    <AdminAffiliationReview
      context={context}
      suspended={false}
      selectedId="affiliation-a"
      onDraftChange={onDraftChange}
    />,
  );
  await screen.findByRole('article', { name: '專題課班／第一大學掛靠申請' });
  fireEvent.click(screen.getByRole('button', { name: '核准掛靠' }));
  fireEvent.change(screen.getByRole('textbox', { name: '審核理由' }), {
    target: { value: reason },
  });
  fireEvent.click(screen.getByRole('button', { name: '確認核准' }));
  await screen.findByText('本次審核已完成，這筆申請無須再次審核。');
  expect(screen.queryByText('本次載入找不到這筆掛靠申請。請更新清單或查看全部申請。')).toBeNull();
  expect(screen.queryByRole('button', { name: '核准掛靠' })).toBeNull();
  await waitFor(() => expect(onDraftChange).toHaveBeenLastCalledWith(false));
});

it.each([
  {},
  {
    ...affiliationData.applications[0],
    state: 'approved',
    tenantId: 'school-b',
    decidedAt: '2026-11-06T00:00:00Z',
    decisionReason: reason,
  },
  {
    ...affiliationData.applications[0],
    state: 'rejected',
    decidedAt: '2026-11-06T00:00:00Z',
    decisionReason: reason,
  },
])(
  'keeps an unconfirmed affiliation decision as a draft instead of reporting success',
  async (value) => {
    installAffiliationApi();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url: string, options?: RequestInit) =>
      options?.method === 'POST' ? Promise.resolve(ok(value)) : original(url, options),
    );
    render(
      <AdminAffiliationReview context={context} suspended={false} selectedId="affiliation-a" />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '核准掛靠' }));
    fireEvent.change(screen.getByRole('textbox', { name: '審核理由' }), {
      target: { value: reason },
    });
    fireEvent.click(screen.getByRole('button', { name: '確認核准' }));
    await screen.findByText(
      '伺服器回應與這筆掛靠申請不符，無法確認審核結果。請更新清單確認實際狀態。',
    );
    expect(screen.queryByText('已核准掛靠申請。')).toBeNull();
    expect(screen.getByRole('textbox', { name: '審核理由' })).toHaveProperty('value', reason);
  },
);

it('identifies the target by school code when its name cannot load and still permits affiliation review', async () => {
  installAffiliationApi();
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string) =>
    url.endsWith('/schools') ? Promise.resolve(ok({}, 503)) : original(url),
  );
  render(<AdminAffiliationReview context={context} suspended={false} selectedId="affiliation-a" />);
  await screen.findByRole('article', { name: '專題課班／學校代號：school-a掛靠申請' });
  expect(screen.getByRole('button', { name: '核准掛靠' })).toHaveProperty('disabled', false);
});

it('uses one retryable school source for the people selector and the grant form', async () => {
  installPeopleApi();
  const original = fetcher.getMockImplementation()!;
  let schoolReads = 0;
  fetcher.mockImplementation((url: string, options?: RequestInit) =>
    url === '/api/platform-admin/schools' && ++schoolReads === 1
      ? Promise.resolve(ok({}, 503))
      : original(url, options),
  );
  render(
    <AdminPeopleManagement
      context={context}
      suspended={false}
      selectedSchool="school-a"
      onSchool={vi.fn()}
      onManageSchool={vi.fn()}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '重新讀取學校' }));
  await screen.findByRole('textbox', { name: 'Google 登入信箱或人員代號' });
  expect(screen.getByRole('combobox', { name: '選擇學校' })).toHaveProperty('value', 'school-a');
  expect(schoolReads).toBe(2);
});
