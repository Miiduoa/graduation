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
});

describe('TronClass submission confirmation', () => {
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
