import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TronClassWorkspace } from './TronClassWorkspace';
import type { TronClassPreparation, TronClassSnapshot } from '@/lib/tronClassIntegrationTypes';

const state = vi.hoisted(() => ({
  platform: {
    session: { platformAccountId: 'account-a', context: 'context-a' } as {
      platformAccountId: string;
      context: string;
    } | null,
    loading: false,
    error: '',
    pendingLogout: false,
    refresh: vi.fn(),
    logout: vi.fn(),
  },
  firebase: {
    user: null as { uid: string; getIdToken: () => Promise<string> } | null,
    loading: false,
    error: null,
  },
}));
vi.mock('@/features/nuni/Session', () => ({ useOptionalNuniSession: () => state.platform }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => state.firebase }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

const revision = 'a'.repeat(32);
const connection = {
  schoolId: 'pu',
  connected: true,
  revision,
  account: 'student-a',
  userName: '同學甲',
  expiresAt: '2026-11-14T01:00:00.000Z',
  studentKey: 'd'.repeat(64),
};
const unconnected = {
  schoolId: 'pu',
  connected: false,
  revision: null,
  account: null,
  userName: null,
  expiresAt: null,
};
const homework = {
  id: 51,
  courseId: 12,
  courseName: '資訊管理',
  title: '期中報告',
  deadline: '2026-11-15T15:59:00.000Z',
  deadlineLabel: '11/15 截止',
  submitted: false,
  description: '請提交 PDF 與心得。',
  href: 'https://tronclass.pu.edu.tw/course/12/learning-activity#/51',
};
const snapshot: TronClassSnapshot = {
  revision,
  fetchedAt: '2026-11-13T01:00:00.000Z',
  courses: [
    {
      id: 12,
      name: '資訊管理',
      code: 'IM101',
      teachers: ['王老師'],
      semester: '115-1',
      status: 'ongoing',
      href: 'https://tronclass.pu.edu.tw/course/12',
    },
    {
      id: 13,
      name: '資料庫',
      code: 'DB101',
      teachers: [],
      semester: null,
      status: 'ongoing',
      href: 'https://tronclass.pu.edu.tw/course/13',
    },
  ],
  homework: [homework],
  announcements: [],
  materials: [],
  errors: [],
  partial: false,
};
const preparation: TronClassPreparation = {
  source: 'tronclass',
  schoolId: 'pu',
  courseId: 12,
  homeworkId: 51,
  revision,
  title: homework.title,
  description: homework.description,
  deadline: homework.deadline,
  canSubmit: true,
  blockedReason: null,
  maxFiles: 4,
  maxFileBytes: 10 * 1024 * 1024,
  allowedContentTypes: ['application/pdf', 'text/plain'],
  rules: { status: 'confirmed', allowsText: true, allowsAttachments: true, maxTotalBytes: 20 * 1024 * 1024 },
  receipt: null,
};
const receipt = {
  source: 'tronclass',
  id: 'receipt-1',
  courseId: 12,
  homeworkId: 51,
  status: 'submitted',
  submittedAt: '2026-11-13T02:00:00.000Z',
  content: '我的心得',
  attachments: [],
};
const fetchMock = vi.fn<typeof fetch>();
let prepareValue = preparation;
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function body(options?: RequestInit) {
  return options?.body && typeof options.body === 'string'
    ? (JSON.parse(options.body) as Record<string, unknown>)
    : {};
}
function calls(action: string) {
  return fetchMock.mock.calls.filter(([, init]) => body(init).action === action);
}
async function defaultResponse(
  url: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  const value = body(init);
  if (String(url) === '/api/tronclass/agent-permissions') return json({
    revision, version: null, permissions: { readCourseData: false, downloadMaterials: false, prepareHomework: false }, updatedAt: null,
  });
  if (init?.method === 'PUT') {
    const query = new URL(String(url), 'https://nuni.tw').searchParams;
    const file = init.body as File;
    return json({
      fileId: query.get('fileId'),
      name: file.name,
      size: file.size,
      contentType: file.type,
      sha256: 'b'.repeat(64),
      status: 'uploaded',
    });
  }
  if (value.action === 'status') return json(connection);
  if (value.action === 'connect') return json(connection);
  if (value.action === 'disconnect') return json({ ...unconnected, revision: 'b'.repeat(32) });
  if (value.action === 'sync') return json(snapshot);
  if (value.action === 'prepare') return json(prepareValue);
  if (value.action === 'submit' || value.action === 'reconcile')
    return json({ status: 'submitted', operationId: value.operationId, receipt });
  throw new Error(`Unexpected request: ${String(value.action)}`);
}
async function openAssignment() {
  fireEvent.click(await screen.findByRole('button', { name: '準備作業' }));
  await screen.findByLabelText('作業內容');
  await waitFor(() => expect(screen.queryByText('正在確認繳交條件與既有紀錄…')).toBeNull());
}
async function previewAnswer(files: File[] = []) {
  await openAssignment();
  fireEvent.change(screen.getByLabelText('作業內容'), { target: { value: '我的心得' } });
  if (files.length) fireEvent.change(screen.getByLabelText('作業附件'), { target: { files } });
  fireEvent.click(screen.getByRole('button', { name: '預覽繳交內容' }));
  fireEvent.click(screen.getByLabelText('我已確認課程、作業內容與附件正確'));
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  state.platform.session = { platformAccountId: 'account-a', context: 'context-a' };
  state.platform.loading = false;
  state.platform.error = '';
  state.platform.pendingLogout = false;
  state.firebase.user = null;
  state.firebase.loading = false;
  prepareValue = preparation;
  fetchMock.mockReset();
  fetchMock.mockImplementation(defaultResponse);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TronClass account isolation and course reads', () => {
  it('prefers the platform account even while Firebase is loading, without requesting its token', async () => {
    const token = vi.fn(async () => 'firebase-token');
    state.firebase.user = { uid: 'old-school-user', getIdToken: token };
    state.firebase.loading = true;
    render(<TronClassWorkspace />);
    expect(await screen.findByRole('heading', { name: '期中報告' })).toBeTruthy();
    expect(token).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.every(
        ([, init]) => (init?.headers as Record<string, string>)['X-Campus-Session'] === 'context-a',
      ),
    ).toBe(true);
  });

  it.each(['loading', 'pendingLogout', 'error'] as const)(
    'does not fall back to Firebase during platform %s',
    (flag) => {
      state.firebase.user = { uid: 'school-user', getIdToken: vi.fn(async () => 'token') };
      if (flag === 'error') state.platform.error = '請重新登入';
      else state.platform[flag] = true;
      render(<TronClassWorkspace />);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('uses a current Firebase token only when the platform has no session', async () => {
    state.platform.session = null;
    state.firebase.user = { uid: 'school-user', getIdToken: vi.fn(async () => 'firebase-token') };
    render(<TronClassWorkspace />);
    await screen.findByRole('heading', { name: '期中報告' });
    expect(
      fetchMock.mock.calls.every(
        ([, init]) =>
          (init?.headers as Record<string, string>).Authorization === 'Bearer firebase-token',
      ),
    ).toBe(true);
  });

  it('clears the password when a connection starts and does not store credentials', async () => {
    const pending = deferred<Response>();
    fetchMock.mockImplementation((url, init) =>
      body(init).action === 'status'
        ? Promise.resolve(json(unconnected))
        : body(init).action === 'connect'
          ? pending.promise
          : defaultResponse(url, init),
    );
    render(<TronClassWorkspace />);
    fireEvent.change(await screen.findByLabelText('學校帳號'), {
      target: { value: 'new-student' },
    });
    fireEvent.change(screen.getByLabelText('學校密碼'), {
      target: { value: 'private-school-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: '連接 TronClass' }));
    expect((screen.getByLabelText('學校密碼') as HTMLInputElement).value).toBe('');
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    await act(async () => pending.resolve(json(connection)));
    expect(await screen.findByText('已連接')).toBeTruthy();
  });

  it('ignores a previous owner’s late response and destroys their in-memory draft on owner change', async () => {
    const view = render(<TronClassWorkspace />);
    await openAssignment();
    fireEvent.change(screen.getByLabelText('作業內容'), { target: { value: '甲的私人草稿' } });
    const late = deferred<Response>();
    fetchMock.mockImplementation((url, init) =>
      body(init).action === 'sync' &&
      (init?.headers as Record<string, string>)['X-Campus-Session'] === 'context-a'
        ? late.promise
        : body(init).action === 'status'
          ? Promise.resolve(json(unconnected))
          : defaultResponse(url, init),
    );
    fireEvent.click(screen.getByRole('button', { name: '同步最新資料' }));
    state.platform.session = { platformAccountId: 'account-b', context: 'context-b' };
    view.rerender(<TronClassWorkspace />);
    await screen.findByLabelText('學校帳號');
    expect(screen.queryByDisplayValue('甲的私人草稿')).toBeNull();
    await act(async () =>
      late.resolve(json({ ...snapshot, homework: [{ ...homework, title: '甲的秘密作業' }] })),
    );
    expect(screen.queryByText('甲的秘密作業')).toBeNull();
    expect(screen.queryByText('期中報告')).toBeNull();
  });

  it('fetches selected-course announcements and ignores a late response from a previous course', async () => {
    const older = deferred<Response>();
    fetchMock.mockImplementation((url, init) => {
      const input = body(init);
      if (input.action === 'sync' && input.courseId === 12) return older.promise;
      if (input.action === 'sync' && input.courseId === 13)
        return Promise.resolve(
          json({
            ...snapshot,
            homework: [],
            announcements: [
              {
                id: 'course:13:9',
                courseId: 13,
                courseName: '資料庫',
                title: '最新課程公告',
                content: '下週上機',
                publishedAt: null,
                href: 'https://tronclass.pu.edu.tw/course/13',
                source: 'course',
              },
            ],
          }),
        );
      return defaultResponse(url, init);
    });
    render(<TronClassWorkspace />);
    await screen.findByLabelText('課程');
    fireEvent.click(screen.getByRole('button', { name: /^公告$/ }));
    expect(screen.getByText('請先選擇一門課程，查看該課程的公告。')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('課程'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('課程'), { target: { value: '13' } });
    expect(await screen.findByText('最新課程公告')).toBeTruthy();
    await act(async () => older.resolve(json(snapshot)));
    expect(screen.getByText('最新課程公告')).toBeTruthy();
  });

  it('retires an expired school session and reconnects in place without trusting its still-valid local status', async () => {
    let expired = false;
    let reconnected = false;
    const nextRevision = 'c'.repeat(32);
    fetchMock.mockImplementation((url, init) => {
      const input = body(init);
      if (String(url) === '/api/tronclass/agent-permissions' && reconnected)
        return Promise.resolve(json({ revision: nextRevision, version: null,
          permissions: { readCourseData: false, downloadMaterials: false, prepareHomework: false }, updatedAt: null }));
      if (input.action === 'connect') {
        reconnected = true;
        return Promise.resolve(json({ ...connection, revision: nextRevision }));
      }
      if (input.action === 'sync' && expired) return Promise.resolve(reconnected
        ? json({ ...snapshot, revision: nextRevision, homework: [{ ...homework, title: '重連後的新作業' }] })
        : json({ error: 'TRONCLASS_RECONNECT_REQUIRED', message: '學校登入已到期。' }, 401));
      return defaultResponse(url, init);
    });
    render(<TronClassWorkspace />);
    await screen.findByRole('heading', { name: '期中報告' });
    await screen.findByRole('checkbox', { name: /讀取課程、作業/ });
    expired = true;
    fireEvent.click(screen.getByRole('button', { name: '同步最新資料' }));
    const account = await screen.findByLabelText('學校帳號') as HTMLInputElement;
    expect(account.value).toBe('student-a');
    expect((screen.getByLabelText('學校密碼') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('TronClass 登入已失效，請重新連接後繼續。')).toBeTruthy();
    expect(screen.queryByText('已連接')).toBeNull();
    expect(screen.queryByText('期中報告')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'TronClass 助理權限' })).toBeNull();
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      String(url) === '/api/tronclass' && body(init).action === 'status')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('學校密碼'), { target: { value: 'new-school-password' } });
    fireEvent.click(screen.getByRole('button', { name: '連接 TronClass' }));
    await screen.findByRole('heading', { name: '重連後的新作業' });
    expect(screen.getByText('已連接')).toBeTruthy();
    expect(screen.queryByText('TronClass 登入已失效，請重新連接後繼續。')).toBeNull();
    expect(body(calls('connect')[0][1])).toMatchObject({ account: 'student-a', expectedRevision: revision });
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('ignores old course and grant responses after replacing the school connection', async () => {
    const oldRead = deferred<Response>();
    const oldGrant = deferred<Response>();
    let reads = 0;
    let reconnected = false;
    const nextRevision = 'c'.repeat(32);
    fetchMock.mockImplementation((url, init) => {
      const input = body(init);
      if (String(url) === '/api/tronclass/agent-permissions') return reconnected
        ? Promise.resolve(json({ revision: nextRevision, version: null,
            permissions: { readCourseData: false, downloadMaterials: false, prepareHomework: false }, updatedAt: null }))
        : oldGrant.promise;
      if (input.action === 'connect') {
        reconnected = true;
        return Promise.resolve(json({ ...connection, revision: nextRevision }));
      }
      if (input.action === 'sync') {
        if (reconnected) return Promise.resolve(json({ ...snapshot, revision: nextRevision,
          homework: [{ ...homework, title: '目前連線的作業' }] }));
        if (++reads > 1) return oldRead.promise;
      }
      return defaultResponse(url, init);
    });
    render(<TronClassWorkspace />);
    await screen.findByRole('heading', { name: '期中報告' });
    fireEvent.click(screen.getByRole('button', { name: '同步最新資料' }));
    await waitFor(() => expect(reads).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: '重新連接／更換帳號' }));
    fireEvent.change(screen.getByLabelText('學校密碼'), { target: { value: 'replacement-password' } });
    fireEvent.click(screen.getByRole('button', { name: '更新連接' }));
    await screen.findByRole('heading', { name: '目前連線的作業' });
    await act(async () => {
      oldRead.resolve(json({ ...snapshot, homework: [{ ...homework, title: '過時連線的私人作業' }] }));
      oldGrant.resolve(json({ revision, version: 'd'.repeat(32),
        permissions: { readCourseData: true, downloadMaterials: true, prepareHomework: true }, updatedAt: null }));
    });
    expect(screen.getByRole('heading', { name: '目前連線的作業' })).toBeTruthy();
    expect(screen.queryByText('過時連線的私人作業')).toBeNull();
    expect((screen.getByRole('checkbox', { name: /讀取課程、作業/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByLabelText('學校密碼')).toBeNull();
  });

  it('returns an expired Agent grant to the same connection form without a status reload loop', async () => {
    fetchMock.mockImplementation((url, init) => String(url) === '/api/tronclass/agent-permissions'
      ? Promise.resolve(json({ error: 'TRONCLASS_RECONNECT_REQUIRED', message: '學校登入已到期。' }, 401))
      : defaultResponse(url, init));
    render(<TronClassWorkspace />);
    await screen.findByLabelText('學校密碼');
    expect(screen.getByText('TronClass 登入已失效，請重新連接後繼續。')).toBeTruthy();
    expect(screen.queryByText('期中報告')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'TronClass 助理權限' })).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/tronclass/agent-permissions')).toHaveLength(1);
  });

  it('labels an already-submitted assignment without promising its remote submission content', async () => {
    fetchMock.mockImplementation((url, init) => body(init).action === 'sync'
      ? Promise.resolve(json({ ...snapshot, homework: [{ ...homework, submitted: true }] }))
      : defaultResponse(url, init));
    render(<TronClassWorkspace />);
    await screen.findByRole('button', { name: '查看作業' });
    expect(screen.queryByRole('button', { name: '查看繳交內容' })).toBeNull();
  });
});

describe('TronClass submission confirmation', () => {
  it('returns an expired assignment preparation to the connection form before any write', async () => {
    fetchMock.mockImplementation((url, init) => body(init).action === 'prepare'
      ? Promise.resolve(json({ error: 'TRONCLASS_RECONNECT_REQUIRED', message: '學校登入已到期。' }, 401))
      : defaultResponse(url, init));
    render(<TronClassWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: '準備作業' }));
    await screen.findByLabelText('學校密碼');
    expect(screen.queryByLabelText('作業內容')).toBeNull();
    expect(calls('submit')).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
  });

  it('stops after an expired upload without advancing to final submission', async () => {
    fetchMock.mockImplementation((url, init) => init?.method === 'PUT'
      ? Promise.resolve(json({ error: 'TRONCLASS_RECONNECT_REQUIRED', message: '學校登入已到期。' }, 401))
      : defaultResponse(url, init));
    render(<TronClassWorkspace />);
    await previewAnswer([new File(['report'], 'report.pdf', { type: 'application/pdf' })]);
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    await screen.findByLabelText('學校密碼');
    expect(calls('submit')).toHaveLength(0);
    expect(sessionStorage.length).toBe(0);
    expect((screen.getByRole('button', { name: '連接 TronClass' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(['submit', 'reconcile'] as const)(
    'keeps the operation after an expired %s and only verifies it with the replacement session',
    async (failureAction) => {
      let reconnected = false;
      const nextRevision = 'c'.repeat(32);
      fetchMock.mockImplementation((url, init) => {
        const input = body(init);
        if (String(url) === '/api/tronclass/agent-permissions' && reconnected)
          return Promise.resolve(json({ revision: nextRevision, version: null,
            permissions: { readCourseData: false, downloadMaterials: false, prepareHomework: false }, updatedAt: null }));
        if (input.action === 'connect') {
          reconnected = true;
          return Promise.resolve(json({ ...connection, revision: nextRevision }));
        }
        if (input.action === failureAction && !reconnected)
          return Promise.resolve(json({ error: 'TRONCLASS_RECONNECT_REQUIRED', message: '學校登入已到期。' }, 401));
        if (input.action === 'submit') return Promise.resolve(json({ status: 'unknown', operationId: input.operationId, receipt: null }));
        if (reconnected && input.action === 'sync') return Promise.resolve(json({ ...snapshot, revision: nextRevision }));
        if (reconnected && input.action === 'prepare') return Promise.resolve(json({ ...preparation, revision: nextRevision }));
        return defaultResponse(url, init);
      });
      render(<TronClassWorkspace />);
      await previewAnswer();
      fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
      if (failureAction === 'reconcile') {
        await screen.findByText('繳交結果待確認');
        fireEvent.click(screen.getByRole('button', { name: '查證繳交結果' }));
      }
      await screen.findByLabelText('學校密碼');
      expect(sessionStorage.length).toBe(1);
      const operationId = body(calls('submit')[0][1]).operationId;
      expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(operationId);
      fireEvent.change(screen.getByLabelText('學校密碼'), { target: { value: 'reconnected-password' } });
      fireEvent.click(screen.getByRole('button', { name: '連接 TronClass' }));
      fireEvent.click(await screen.findByRole('button', { name: '準備作業' }));
      await screen.findByText('繳交結果待確認');
      expect(screen.queryByRole('button', { name: '確認送出到 TronClass' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '查證繳交結果' }));
      await screen.findByText('TronClass 已確認收到');
      expect(calls('submit')).toHaveLength(1);
      expect(body(calls('reconcile').at(-1)![1])).toMatchObject({ operationId, revision: nextRevision });
      expect(sessionStorage.length).toBe(0);
    },
  );

  it('allows local preparation when the tenant cannot submit and never uploads or sends', async () => {
    prepareValue = {
      ...preparation,
      canSubmit: false,
      blockedReason: '這所學校的作業繳交尚未開放。',
    };
    render(<TronClassWorkspace />);
    await previewAnswer([new File(['report'], 'report.pdf', { type: 'application/pdf' })]);
    expect(screen.getByText('這所學校的作業繳交尚未開放。')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: '確認送出到 TronClass' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole('link', { name: /在 TronClass 查看原作業/ }).getAttribute('href')).toBe(
      homework.href,
    );
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    expect(calls('submit')).toHaveLength(0);
  });

  it('uploads files in order after explicit confirmation and waits for a scoped school receipt', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const queued: {
      url: string;
      init: RequestInit;
      pending: ReturnType<typeof deferred<Response>>;
    }[] = [];
    fetchMock.mockImplementation((url, init) => {
      if (init?.method === 'PUT') {
        const pending = queued.length === 0 ? first : second;
        queued.push({ url: String(url), init, pending });
        return pending.promise;
      }
      return defaultResponse(url, init);
    });
    render(<TronClassWorkspace />);
    await previewAnswer([
      new File(['report'], 'report.pdf', { type: 'application/pdf' }),
      new File(['answer'], 'answer.txt', { type: 'text/plain' }),
    ]);
    expect(queued).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    await waitFor(() => expect(queued).toHaveLength(1));
    expect(calls('submit')).toHaveLength(0);
    await act(async () => first.resolve(await defaultResponse(queued[0].url, queued[0].init)));
    await waitFor(() => expect(queued).toHaveLength(2));
    expect(calls('submit')).toHaveLength(0);
    await act(async () => second.resolve(await defaultResponse(queued[1].url, queued[1].init)));
    expect(await screen.findByText('TronClass 已確認收到')).toBeTruthy();
    expect(calls('submit')).toHaveLength(1);
    const submitted = body(calls('submit')[0][1]);
    expect(submitted.confirmed).toBe(true);
    expect(submitted.attachments).toHaveLength(2);
    expect(sessionStorage.length).toBe(0);
  });

  it('keeps an uncertain submission as verification-only, including after reopening the page', async () => {
    fetchMock.mockImplementation((url, init) =>
      body(init).action === 'submit'
        ? Promise.resolve(
            json({ status: 'unknown', operationId: body(init).operationId, receipt: null }),
          )
        : defaultResponse(url, init),
    );
    const view = render(<TronClassWorkspace />);
    await previewAnswer();
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    expect(await screen.findByText('繳交結果待確認')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '確認送出到 TronClass' })).toBeNull();
    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).not.toContain('我的心得');
    view.unmount();
    render(<TronClassWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: '準備作業' }));
    expect(await screen.findByText('繳交結果待確認')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查證繳交結果' }));
    expect(await screen.findByText('TronClass 已確認收到')).toBeTruthy();
    expect(calls('submit')).toHaveLength(1);
    expect(calls('reconcile')).toHaveLength(1);
  });

  it('unlocks a pending draft only when reconciliation explicitly confirms the submission never started', async () => {
    let checks = 0;
    fetchMock.mockImplementation((url, init) => {
      const input = body(init);
      if (input.action === 'submit')
        return Promise.resolve(
          json({ status: 'unknown', operationId: input.operationId, receipt: null }),
        );
      if (input.action === 'reconcile') {
        ++checks;
        return Promise.resolve(
          checks === 1
            ? json({ error: 'TRONCLASS_OPERATION_NOT_FOUND', message: '尚未找到紀錄。' }, 404)
            : json({ error: 'TRONCLASS_SUBMISSION_NOT_STARTED', message: '已確認尚未送出。' }, 409),
        );
      }
      return defaultResponse(url, init);
    });
    render(<TronClassWorkspace />);
    await previewAnswer();
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    await screen.findByText('繳交結果待確認');
    fireEvent.click(screen.getByRole('button', { name: '查證繳交結果' }));
    await screen.findByText('尚未找到紀錄。');
    expect(screen.getByText('繳交結果待確認')).toBeTruthy();
    expect(sessionStorage.length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '查證繳交結果' }));
    await screen.findByText('已確認未送出，請重新核對後再繳交。');
    expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('我的心得');
    expect(sessionStorage.length).toBe(0);
    expect(calls('submit')).toHaveLength(1);
  });

  it('treats a success-shaped receipt for another homework as unknown', async () => {
    fetchMock.mockImplementation((url, init) =>
      body(init).action === 'submit'
        ? Promise.resolve(
            json({
              status: 'submitted',
              operationId: body(init).operationId,
              receipt: { ...receipt, homeworkId: 999 },
            }),
          )
        : defaultResponse(url, init),
    );
    render(<TronClassWorkspace />);
    await previewAnswer();
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    expect(await screen.findByText('繳交結果待確認')).toBeTruthy();
    expect(screen.queryByText('TronClass 已確認收到')).toBeNull();
    expect(sessionStorage.length).toBe(1);
  });

  it('restores an uncertain operation after reconnecting and reconciles with the new revision', async () => {
    fetchMock.mockImplementation((url, init) =>
      body(init).action === 'submit'
        ? Promise.resolve(
            json({ status: 'unknown', operationId: body(init).operationId, receipt: null }),
          )
        : defaultResponse(url, init),
    );
    const view = render(<TronClassWorkspace />);
    await previewAnswer();
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    await screen.findByText('繳交結果待確認');
    const previousOperation = body(calls('submit')[0][1]).operationId;
    view.unmount();
    const nextRevision = 'c'.repeat(32);
    fetchMock.mockImplementation((url, init) => {
      const action = body(init).action;
      if (action === 'status')
        return Promise.resolve(json({ ...connection, revision: nextRevision }));
      if (action === 'sync') return Promise.resolve(json({ ...snapshot, revision: nextRevision }));
      if (action === 'prepare')
        return Promise.resolve(json({ ...preparation, revision: nextRevision }));
      return defaultResponse(url, init);
    });
    render(<TronClassWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: '準備作業' }));
    await screen.findByText('繳交結果待確認');
    fireEvent.click(screen.getByRole('button', { name: '查證繳交結果' }));
    await screen.findByText('TronClass 已確認收到');
    expect(calls('submit')).toHaveLength(1);
    expect(body(calls('reconcile')[0][1])).toMatchObject({
      revision: nextRevision,
      operationId: previousOperation,
    });
  });

  it('rechecks changed permissions before uploading or submitting', async () => {
    render(<TronClassWorkspace />);
    await previewAnswer([new File(['report'], 'report.pdf', { type: 'application/pdf' })]);
    prepareValue = { ...preparation, canSubmit: false, blockedReason: '作業已截止。' };
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('作業內容')).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    expect(calls('submit')).toHaveLength(0);
  });

  it.each([false, true])(
    'starts a fresh operation after partial upload failure; remove failed file: %s',
    async (removeFailed) => {
      let uploadCount = 0;
      const operations: string[] = [];
      fetchMock.mockImplementation((url, init) => {
        if (init?.method === 'PUT') {
          operations.push(new URL(String(url), 'https://nuni.tw').searchParams.get('operationId')!);
          ++uploadCount;
          if (uploadCount === 2)
            return Promise.resolve(
              json({ error: 'TRONCLASS_UPLOAD_UNCONFIRMED', message: '附件上傳未完成。' }, 409),
            );
        }
        return defaultResponse(url, init);
      });
      render(<TronClassWorkspace />);
      await previewAnswer([
        new File(['report'], 'report.pdf', { type: 'application/pdf' }),
        new File(['answer'], 'answer.txt', { type: 'text/plain' }),
      ]);
      fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(calls('submit')).toHaveLength(0);
      if (removeFailed) fireEvent.click(screen.getByRole('button', { name: '移除 answer.txt' }));
      fireEvent.click(screen.getByRole('button', { name: '預覽繳交內容' }));
      fireEvent.click(screen.getByLabelText('我已確認課程、作業內容與附件正確'));
      fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
      expect(await screen.findByText('TronClass 已確認收到')).toBeTruthy();
      expect(operations[0]).toBe(operations[1]);
      expect(operations[2]).not.toBe(operations[0]);
      expect(uploadCount).toBe(removeFailed ? 3 : 4);
      expect(body(calls('submit')[0][1]).attachments).toHaveLength(removeFailed ? 1 : 2);
    },
  );

  it('does not continue an in-flight upload into submission after the owner changes', async () => {
    const upload = deferred<Response>();
    let captured: { url: string; init: RequestInit } | undefined;
    fetchMock.mockImplementation((url, init) => {
      if (init?.method === 'PUT') {
        captured = { url: String(url), init };
        return upload.promise;
      }
      return defaultResponse(url, init);
    });
    const view = render(<TronClassWorkspace />);
    await previewAnswer([new File(['report'], 'report.pdf', { type: 'application/pdf' })]);
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    await waitFor(() => expect(captured).toBeDefined());
    state.platform.session = { platformAccountId: 'account-b', context: 'context-b' };
    view.rerender(<TronClassWorkspace />);
    await act(async () => upload.resolve(await defaultResponse(captured!.url, captured!.init)));
    expect(calls('submit')).toHaveLength(0);
    expect(screen.queryByText('我的心得')).toBeNull();
  });
});

describe('TronClass material downloads', () => {
  const material = {
    id: 71,
    courseId: 12,
    courseName: '資訊管理',
    title: '期中教材',
    type: 'courseware_activity',
    href: 'https://tronclass.pu.edu.tw/course/12/learning-activity#/71',
    files: [
      {
        name: '講義.pdf',
        allowDownload: true,
        downloadHref: 'https://tronclass.pu.edu.tw/api/uploads/material-key/blob',
      },
    ],
  };
  function downloadResponse() {
    return new Response('%PDF-1.7\nfixture', {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('講義.pdf')}`,
      },
    });
  }
  function serveMaterial(download: () => Promise<Response>) {
    fetchMock.mockImplementation((url, init) => {
      if (String(url) === '/api/tronclass/material-download') return download();
      const input = body(init);
      if (input.action === 'sync' && input.courseId === 12)
        return Promise.resolve(json({ ...snapshot, materials: [material] }));
      return defaultResponse(url, init);
    });
  }
  async function showMaterial() {
    await screen.findByLabelText('課程');
    fireEvent.change(screen.getByLabelText('課程'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /^教材$/ }));
    return screen.findByRole('button', { name: '下載 講義.pdf' });
  }

  it('downloads a material through the current nuni identity with the verified file scope', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:material');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    serveMaterial(async () => downloadResponse());
    render(<TronClassWorkspace />);
    fireEvent.click(await showMaterial());
    await screen.findByText('已開始下載。');
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('講義.pdf');
    const request = fetchMock.mock.calls.find(
      ([url]) => String(url) === '/api/tronclass/material-download',
    )!;
    expect(body(request[1])).toEqual({
      courseId: 12,
      activityId: 71,
      uploadKey: 'material-key',
      revision,
    });
    expect(request[1]?.headers).toMatchObject({ 'X-Campus-Session': 'context-a' });
  });

  it('shows a download denial without creating a file and keeps the original material link', async () => {
    const create = vi.spyOn(URL, 'createObjectURL');
    serveMaterial(async () =>
      json(
        { error: 'TRONCLASS_MATERIAL_DOWNLOAD_DENIED', message: '老師目前未開放下載這份附件。' },
        403,
      ),
    );
    render(<TronClassWorkspace />);
    fireEvent.click(await showMaterial());
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      '老師目前未開放下載這份附件。',
    );
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /開啟原始教材/ }).getAttribute('href')).toBe(
      material.href,
    );
  });

  it('returns an expired material download to the connection form without creating a file', async () => {
    const create = vi.spyOn(URL, 'createObjectURL');
    serveMaterial(async () => json(
      { error: 'TRONCLASS_RECONNECT_REQUIRED', message: '學校登入已到期。' }, 401,
    ));
    render(<TronClassWorkspace />);
    fireEvent.click(await showMaterial());
    await screen.findByLabelText('學校密碼');
    expect(screen.getByText('TronClass 登入已失效，請重新連接後繼續。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '下載 講義.pdf' })).toBeNull();
    expect(screen.queryByText('期中教材')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'TronClass 助理權限' })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('does not download a previous owner’s file after the account changes', async () => {
    const pending = deferred<Response>();
    const create = vi.spyOn(URL, 'createObjectURL');
    serveMaterial(() => pending.promise);
    const view = render(<TronClassWorkspace />);
    fireEvent.click(await showMaterial());
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url) === '/api/tronclass/material-download'),
      ).toBe(true),
    );
    state.platform.session = { platformAccountId: 'account-b', context: 'context-b' };
    view.rerender(<TronClassWorkspace />);
    await act(async () => pending.resolve(downloadResponse()));
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByText('已開始下載。')).toBeNull();
  });
});

describe('TronClass page-memory draft recovery', () => {
  const nextRevision = 'e'.repeat(32);
  const privateText = '尚在整理的私人作業文字';
  const privateFile = () => new File(['my report'], '本頁報告.pdf', { type: 'application/pdf' });

  function serveRecovery(options: {
    studentKey?: string | null;
    missingHomework?: boolean;
    prepareAfterReconnect?: () => Promise<Response>;
    expireSubmit?: boolean;
  } = {}) {
    const flags = { expired: false, reconnected: false, failConnect: false, disconnected: false };
    const nextKey = Object.prototype.hasOwnProperty.call(options, 'studentKey')
      ? options.studentKey : connection.studentKey;
    fetchMock.mockImplementation((url, init) => {
      const input = body(init);
      if (String(url) === '/api/tronclass/agent-permissions') return Promise.resolve(json({
        revision: flags.reconnected ? nextRevision : revision, version: null,
        permissions: { readCourseData: false, downloadMaterials: false, prepareHomework: false }, updatedAt: null,
      }));
      if (input.action === 'status') return Promise.resolve(json(flags.disconnected ? unconnected : connection));
      if (input.action === 'disconnect') {
        flags.disconnected = true;
        return Promise.resolve(json({ ...unconnected, revision: 'f'.repeat(32) }));
      }
      if (input.action === 'connect') {
        if (flags.failConnect) return Promise.resolve(json({ error: 'TRONCLASS_INVALID_CREDENTIALS' }, 401));
        flags.reconnected = true;
        flags.disconnected = false;
        return Promise.resolve(json({ ...connection, revision: nextRevision, studentKey: nextKey }));
      }
      if (input.action === 'sync') {
        if (flags.reconnected) return Promise.resolve(json({ ...snapshot, revision: nextRevision,
          homework: options.missingHomework ? [] : snapshot.homework }));
        if (flags.expired) return Promise.resolve(json({ error: 'TRONCLASS_RECONNECT_REQUIRED' }, 401));
      }
      if (input.action === 'prepare' && flags.reconnected) return options.prepareAfterReconnect?.() ??
        Promise.resolve(json({ ...preparation, revision: nextRevision }));
      if (input.action === 'submit' && options.expireSubmit) {
        flags.expired = true;
        return Promise.resolve(json({ error: 'TRONCLASS_RECONNECT_REQUIRED' }, 401));
      }
      return defaultResponse(url, init);
    });
    return flags;
  }

  async function editDraft() {
    await openAssignment();
    fireEvent.change(screen.getByLabelText('作業內容'), { target: { value: privateText } });
    fireEvent.change(screen.getByLabelText('作業附件'), { target: { files: [privateFile()] } });
  }

  async function expire(flags: ReturnType<typeof serveRecovery>) {
    flags.expired = true;
    fireEvent.click(screen.getByRole('button', { name: '同步最新資料' }));
    await screen.findByLabelText('學校密碼');
    expect(screen.queryByDisplayValue(privateText)).toBeNull();
    expect(screen.queryByText('本頁報告.pdf')).toBeNull();
  }

  async function reconnect() {
    fireEvent.change(screen.getByLabelText('學校密碼'), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: '連接 TronClass' }));
    await screen.findByText('已連接');
    await waitFor(() => expect((screen.getByRole('button', { name: '同步最新資料' }) as HTMLButtonElement).disabled).toBe(false));
  }

  it('restores text and files only after the same verified school identity and a fresh assignment read', async () => {
    const pendingPrepare = deferred<Response>();
    const flags = serveRecovery({ prepareAfterReconnect: () => pendingPrepare.promise });
    render(<TronClassWorkspace />);
    await editDraft();
    await expire(flags);
    expect(screen.getByText(/本頁暫時保留了作業文字與附件/)).toBeTruthy();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    await reconnect();
    fireEvent.click(await screen.findByRole('button', { name: '繼續編輯保留的草稿' }));
    const input = await screen.findByLabelText('作業內容') as HTMLTextAreaElement;
    expect(input.value).toBe('');
    expect(input.disabled).toBe(true);
    expect(screen.queryByText('本頁報告.pdf')).toBeNull();
    await act(async () => pendingPrepare.resolve(json({ ...preparation, revision: nextRevision })));
    expect((await screen.findByDisplayValue(privateText) as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.getByText('本頁報告.pdf')).toBeTruthy();
    expect(screen.getByText(/已選取/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '預覽繳交內容' }));
    expect((screen.getByLabelText('我已確認課程、作業內容與附件正確') as HTMLInputElement).checked).toBe(false);
    expect(calls('submit')).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it.each([undefined, null, 'f'.repeat(64)])(
    'does not restore for a missing or different verified student key: %s', async (studentKey) => {
      const flags = serveRecovery({ studentKey });
      render(<TronClassWorkspace />);
      await editDraft();
      await expire(flags);
      await reconnect();
      expect(screen.queryByRole('button', { name: '繼續編輯保留的草稿' })).toBeNull();
      await openAssignment();
      expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('');
      expect(screen.queryByText('本頁報告.pdf')).toBeNull();
    },
  );

  it.each(['', 'same-student', 'a'.repeat(63), 'A'.repeat(64)])(
    'rejects a malformed student key without revealing the retained draft: %s', async (studentKey) => {
      const flags = serveRecovery({ studentKey });
      render(<TronClassWorkspace />);
      await editDraft();
      await expire(flags);
      fireEvent.change(screen.getByLabelText('學校密碼'), { target: { value: 'new-password' } });
      fireEvent.click(screen.getByRole('button', { name: '連接 TronClass' }));
      await screen.findByText('尚未收到可確認的回覆，請稍後重新查詢。');
      expect(screen.queryByText('已連接')).toBeNull();
      expect(screen.queryByRole('button', { name: '繼續編輯保留的草稿' })).toBeNull();
      expect(screen.queryByDisplayValue(privateText)).toBeNull();
      expect(screen.queryByText('本頁報告.pdf')).toBeNull();
    },
  );

  it('does not disclose a draft when the reconnected student can no longer read the assignment', async () => {
    const flags = serveRecovery({ missingHomework: true });
    render(<TronClassWorkspace />);
    await editDraft();
    await expire(flags);
    await reconnect();
    const resume = await screen.findByRole('button', { name: '繼續編輯保留的草稿' });
    expect((resume as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByDisplayValue(privateText)).toBeNull();
    expect(screen.queryByText('本頁報告.pdf')).toBeNull();
    expect(calls('prepare')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '清除保留的草稿' }));
    expect(screen.queryByRole('button', { name: '繼續編輯保留的草稿' })).toBeNull();
  });

  it('keeps the draft hidden when fresh prepare fails and can retry without losing local files', async () => {
    let allowRead = false;
    const flags = serveRecovery({ prepareAfterReconnect: async () => allowRead
      ? json({ ...preparation, revision: nextRevision })
      : json({ error: 'TRONCLASS_SUBMISSION_UNAVAILABLE' }, 503) });
    render(<TronClassWorkspace />);
    await editDraft();
    await expire(flags);
    await reconnect();
    fireEvent.click(await screen.findByRole('button', { name: '繼續編輯保留的草稿' }));
    await screen.findByRole('button', { name: '重新確認繳交條件' });
    expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByText('本頁報告.pdf')).toBeNull();
    allowRead = true;
    fireEvent.click(screen.getByRole('button', { name: '重新確認繳交條件' }));
    await screen.findByDisplayValue(privateText);
    expect(screen.getByText('本頁報告.pdf')).toBeTruthy();
  });

  it('retains the sealed-off page draft after a failed login until the same student reconnects', async () => {
    const flags = serveRecovery();
    render(<TronClassWorkspace />);
    await editDraft();
    await expire(flags);
    flags.failConnect = true;
    fireEvent.change(screen.getByLabelText('學校密碼'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: '連接 TronClass' }));
    await waitFor(() => expect((screen.getByRole('button', { name: '連接 TronClass' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByDisplayValue(privateText)).toBeNull();
    expect(screen.queryByText('本頁報告.pdf')).toBeNull();
    flags.failConnect = false;
    await reconnect();
    fireEvent.click(await screen.findByRole('button', { name: '繼續編輯保留的草稿' }));
    await screen.findByDisplayValue(privateText);
  });

  it.each(['owner', 'platform-context'] as const)('clears retained drafts on a nuni %s change', async (kind) => {
    const flags = serveRecovery();
    const view = render(<TronClassWorkspace />);
    await editDraft();
    await expire(flags);
    flags.expired = false;
    state.platform.session = kind === 'owner'
      ? { platformAccountId: 'account-b', context: 'context-b' }
      : { platformAccountId: 'account-a', context: 'context-b' };
    view.rerender(<TronClassWorkspace />);
    await openAssignment();
    expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText('本頁報告.pdf')).toBeNull();
    expect(screen.queryByRole('button', { name: '繼續編輯保留的草稿' })).toBeNull();
  });

  it('clears local text and files on explicit unlink even if the same student reconnects', async () => {
    serveRecovery();
    render(<TronClassWorkspace />);
    await editDraft();
    fireEvent.click(screen.getByRole('button', { name: '解除連接' }));
    fireEvent.click(screen.getByRole('button', { name: '確認解除連接' }));
    await screen.findByLabelText('學校帳號');
    fireEvent.change(screen.getByLabelText('學校帳號'), { target: { value: 'student-a' } });
    await reconnect();
    expect(screen.queryByRole('button', { name: '繼續編輯保留的草稿' })).toBeNull();
    await openAssignment();
    expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText('本頁報告.pdf')).toBeNull();
  });

  it('honors explicit draft discard before reconnecting', async () => {
    const flags = serveRecovery();
    render(<TronClassWorkspace />);
    await editDraft();
    await expire(flags);
    fireEvent.click(screen.getByRole('button', { name: '清除保留的草稿' }));
    await reconnect();
    expect(screen.queryByRole('button', { name: '繼續編輯保留的草稿' })).toBeNull();
    await openAssignment();
    expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('');
  });

  it('resumes an uncertain submission as read-only reconciliation without another upload or send', async () => {
    serveRecovery({ expireSubmit: true });
    render(<TronClassWorkspace />);
    await editDraft();
    fireEvent.click(screen.getByRole('button', { name: '預覽繳交內容' }));
    fireEvent.click(screen.getByLabelText('我已確認課程、作業內容與附件正確'));
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    await screen.findByLabelText('學校密碼');
    expect(calls('submit')).toHaveLength(1);
    expect(sessionStorage.length).toBe(1);
    const operationId = body(calls('submit')[0][1]).operationId;
    await reconnect();
    fireEvent.click(await screen.findByRole('button', { name: '繼續編輯保留的草稿' }));
    await screen.findByRole('heading', { name: '繳交結果待確認' });
    expect(screen.queryByRole('button', { name: '確認送出到 TronClass' })).toBeNull();
    expect(calls('submit')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '查證繳交結果' }));
    await screen.findByRole('heading', { name: 'TronClass 已確認收到' });
    expect(body(calls('reconcile')[0][1])).toMatchObject({ operationId, revision: nextRevision });
    expect(calls('submit')).toHaveLength(1);
    expect(sessionStorage.length).toBe(0);
  });
});
