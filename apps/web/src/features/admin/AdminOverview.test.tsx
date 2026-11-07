import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminOverview } from './AdminOverview';

const createdAt = '2026-11-06T08:00:00.000Z';
const school = {
  kind: 'tenant',
  applicationId: null,
  tenantId: 'school-one',
  displayName: '青禾大學',
  emailDomain: 'school.example.test',
  lifecycle: 'provisioned',
  description: '',
  modules: { leave: false, identity: false, food: false },
  peopleCount: 0,
  merchantCount: 0,
};
const application = {
  id: 'school-application',
  state: 'pending',
  displayName: '山川大學',
  proposedTenantId: 'school-two',
  proposedEmailDomain: 'new-school.example.test',
  contactName: '校方窗口',
  contactEmail: 'contact@example.test',
  justification: '申請使用校園平台服務',
  tenantId: null,
  tenantState: null,
  createdAt,
  decidedAt: null,
};
const affiliation = {
  id: 'affiliation-one',
  workspaceId: 'workspace-one',
  workspaceTitle: '資訊管理專題',
  tenantId: 'school-one',
  sectionId: null,
  justification: '請確認課班歸屬',
  state: 'pending',
  createdAt,
  decidedAt: null,
  decisionReason: null,
};
const interest = {
  id: 'interest-one',
  brandName: '北門咖啡',
  schoolName: '青禾大學',
  contactName: '店主',
  contactEmail: 'owner@example.test',
  note: null,
  state: 'submitted',
  createdAt,
  decidedAt: null,
};
const merchantApplication = {
  tenantId: 'school-one',
  tenantName: '青禾大學',
  applicationId: 'application-one',
  brandName: '南風食堂',
  locationName: '生活館',
  contactName: '店主',
  contactEmail: 'food@example.test',
  state: 'submitted',
  version: 2,
  submittedAt: createdAt,
};
const report = {
  id: 'report-one',
  tenantId: 'school-one',
  postId: 'post-one',
  state: 'open',
  version: 1,
  reason: 'spam',
  createdAt,
  detail: '同內容重複刊登',
  decisionReason: null,
  canDecide: true,
  snapshot: {
    id: 'post-one',
    tenantId: 'school-one',
    tenantName: '青禾大學',
    communityId: 'board-one',
    communityName: '校園交流',
    text: '合成測試貼文',
    author: { displayName: '投稿者', isSelf: false },
    publishedAt: createdAt,
    version: 1,
  },
};

function payload(path: string) {
  if (path === 'schools') return { schools: [school] };
  if (path === 'school-applications?scope=pending') return { applications: [application] };
  if (path === 'class-workspace-affiliation-applications') return { applications: [affiliation] };
  if (path === 'merchants')
    return {
      interest: [interest],
      applications: [merchantApplication],
      catalog: [],
      honesty: '本次載入',
    };
  if (path === 'reports?state=open') return { items: [report] };
  throw new Error('Unexpected request: ' + path);
}

function ok(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const fetcher = vi.fn();
const onNavigate = vi.fn();
const context = 'a'.repeat(43);
beforeEach(() => {
  vi.clearAllMocks();
  fetcher
    .mockReset()
    .mockImplementation(async (url: string) =>
      ok(payload(url.replace('/api/platform-admin/', ''))),
    );
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());

it('opens the selected school, merchant, affiliation or report directly from real queues', async () => {
  render(<AdminOverview context={context} suspended={false} onNavigate={onNavigate} />);
  fireEvent.click(await screen.findByRole('button', { name: '查看學校申請：山川大學' }));
  expect(onNavigate).toHaveBeenLastCalledWith('school-review', { reviewId: 'school-application' });
  fireEvent.click(await screen.findByRole('button', { name: '查看店家申請：北門咖啡' }));
  expect(onNavigate).toHaveBeenLastCalledWith('merchants', { reviewId: 'interest:interest-one' });
  fireEvent.click(screen.getByRole('button', { name: '查看店家申請：南風食堂／生活館' }));
  expect(onNavigate).toHaveBeenLastCalledWith('merchants', {
    reviewId: 'application:school-one:application-one',
  });
  fireEvent.click(await screen.findByRole('button', { name: '查看掛靠申請：資訊管理專題' }));
  expect(onNavigate).toHaveBeenLastCalledWith('affiliation', { reviewId: 'affiliation-one' });
  fireEvent.click(await screen.findByRole('button', { name: '處理社群檢舉：校園交流' }));
  expect(onNavigate).toHaveBeenLastCalledWith('reports', {
    reportState: 'open',
    reportId: 'report-one',
  });
  expect(
    within(screen.getByRole('region', { name: '店家申請' })).getByLabelText('已載入 2 件'),
  ).toBeTruthy();
  expect(fetcher.mock.calls).toHaveLength(5);
  for (const [, options] of fetcher.mock.calls) {
    expect(options).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      headers: { 'X-Campus-Session': context },
    });
  }
});

it('keeps school selection through the setup steps without claiming a manager exists from peopleCount', async () => {
  render(<AdminOverview context={context} suspended={false} onNavigate={onNavigate} />);
  fireEvent.click(await screen.findByRole('button', { name: '確認管理員：青禾大學' }));
  expect(onNavigate).toHaveBeenLastCalledWith('people', { schoolId: 'school-one' });
  fireEvent.click(screen.getByRole('button', { name: '檢查服務與開通：青禾大學' }));
  expect(onNavigate).toHaveBeenLastCalledWith('schools', {
    schoolId: 'school-one',
    schoolLifecycle: 'all',
    schoolQuery: '',
  });
  fireEvent.click(screen.getByRole('button', { name: '查看待開通學校' }));
  expect(onNavigate).toHaveBeenLastCalledWith('schools', {
    schoolId: null,
    schoolLifecycle: 'provisioned',
    schoolQuery: '',
  });
});

it.each(['under-review', 'needs-information'])(
  'keeps a %s merchant application actionable in the work queue',
  async (state) => {
    fetcher.mockImplementation(async (url: string) =>
      ok(
        url.endsWith('/merchants')
          ? {
              interest: [],
              applications: [{ ...merchantApplication, state }],
              catalog: [],
              honesty: '本次載入',
            }
          : payload(url.replace('/api/platform-admin/', '')),
      ),
    );
    render(<AdminOverview context={context} suspended={false} onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByRole('button', { name: '查看店家申請：南風食堂／生活館' }));
    expect(onNavigate).toHaveBeenLastCalledWith('merchants', {
      reviewId: 'application:school-one:application-one',
    });
  },
);

it('keeps a malformed merchant response unknown and retries only the failed queue', async () => {
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith('/merchants') ? ok({}) : ok(payload(url.replace('/api/platform-admin/', ''))),
  );
  render(<AdminOverview context={context} suspended={false} onNavigate={onNavigate} />);
  const queue = within(screen.getByRole('region', { name: '店家申請' }));
  expect(await queue.findByRole('alert')).toHaveProperty(
    'textContent',
    '收到的資料不完整，請重新讀取。',
  );
  expect(queue.getByLabelText('件數尚未確認')).toBeTruthy();
  expect(queue.queryByText('目前沒有待審核的店家申請。')).toBeNull();
  expect(await screen.findByRole('button', { name: '查看學校申請：山川大學' })).toBeTruthy();
  fetcher.mockImplementation(async (url: string) =>
    ok(payload(url.replace('/api/platform-admin/', ''))),
  );
  const calls = fetcher.mock.calls.length;
  fireEvent.click(queue.getByRole('button', { name: '重試店家申請' }));
  await queue.findByRole('button', { name: '查看店家申請：北門咖啡' });
  expect(fetcher.mock.calls.slice(calls).map(([url]) => url)).toEqual([
    '/api/platform-admin/merchants',
  ]);
});

it('does not restore a stale queue when an old session request finishes late', async () => {
  let finish!: (value: Response) => void;
  fetcher.mockImplementation((url: string, options: RequestInit) => {
    const headers = options.headers as Record<string, string>;
    if (headers['X-Campus-Session'] === context && url.endsWith('/merchants')) {
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    return Promise.resolve(
      ok(
        url.endsWith('/merchants')
          ? { interest: [], applications: [], catalog: [], honesty: '本次載入' }
          : payload(url.replace('/api/platform-admin/', '')),
      ),
    );
  });
  const view = render(
    <AdminOverview context={context} suspended={false} onNavigate={onNavigate} />,
  );
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  view.rerender(
    <AdminOverview context={'b'.repeat(43)} suspended={false} onNavigate={onNavigate} />,
  );
  await screen.findByText('目前沒有待審核的店家申請。');
  await act(async () => finish(ok(payload('merchants'))));
  expect(screen.queryByRole('button', { name: '查看店家申請：北門咖啡' })).toBeNull();
});

it('does not fetch management queues during session revalidation', () => {
  render(<AdminOverview context={context} suspended onNavigate={onNavigate} />);
  expect(fetcher).not.toHaveBeenCalled();
});
