import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NuniSessionProvider } from '@/features/nuni/Session';
import { TronClassWorkspace } from './TronClassWorkspace';

const auth = vi.hoisted(() => ({
  user: null as { uid: string; getIdToken: () => Promise<string> } | null,
  loading: false, error: null,
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => auth }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
// Keep the real NuniSessionProvider: the simpler workspace tests mock its hook
// and cannot exercise pageshow -> loading -> verified identity transitions.
const CONTEXT = 'b'.repeat(43);
const REVISION = 'a'.repeat(32);
const STUDENT_KEY = 'd'.repeat(64);
const PRINCIPAL = { authenticated: true, context: CONTEXT,
  platformAccountId: 'pa_00000000-0000-4000-8000-000000000001', isPlatformOperator: false };
const PRIVATE_TEXT = '同一個登入情境暫時保留的私人作業文字';
const PRIVATE_FILE = '私人作業草稿.txt';
const STAMP = '2027-02-16T01:00:00.000Z';
const COURSE = { id: 12, name: '合成課程', code: 'IM101', teachers: [], semester: '115-1',
  status: 'ongoing', href: 'https://tronclass.pu.edu.tw/course/12/content' };
const HOMEWORK = { id: 51, courseId: 12, courseName: COURSE.name, title: '合成作業',
  deadline: null, deadlineLabel: '無截止資訊', submitted: false, description: '合成作業說明',
  href: 'https://tronclass.pu.edu.tw/course/12/learning-activity#/51' };
const connection = (revision = REVISION, studentKey = STUDENT_KEY) => ({
  schoolId: 'pu', connected: true, revision, studentKey, account: 'synthetic-student',
  userName: '合成同學', expiresAt: '2027-02-16T12:00:00.000Z',
});
const preparation = (revision = REVISION) => ({
  source: 'tronclass', schoolId: 'pu', courseId: 12, homeworkId: 51, revision,
  title: HOMEWORK.title, description: HOMEWORK.description, deadline: null,
  canSubmit: true, blockedReason: null, maxFiles: 4, maxFileBytes: 10 * 1024 * 1024,
  allowedContentTypes: ['text/plain'],
  rules: { status: 'confirmed', allowsText: true, allowsAttachments: true, maxTotalBytes: 20 * 1024 * 1024 }, receipt: null,
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function body(init?: RequestInit): Record<string, unknown> {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : {};
}
const fetchMock = vi.fn<typeof fetch>();

function fixture() {
  const state = { revision: REVISION, studentKey: STUDENT_KEY };
  const sessions: Promise<Response>[] = [];
  const statuses: Promise<Response>[] = [];
  const preparations: Promise<Response>[] = [];
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url) === '/api/nuni/session') return sessions.shift() ?? json(PRINCIPAL);
    if (String(url) === '/api/tronclass/agent-permissions') return json({
      revision: state.revision, version: null, updatedAt: null,
      permissions: { readCourseData: false, downloadMaterials: false, prepareHomework: false },
    });
    const input = body(init);
    if (input.action === 'status') return statuses.shift() ?? json(connection(state.revision, state.studentKey));
    if (input.action === 'courses') return json({ kind: 'course-index', revision: state.revision,
      fetchedAt: STAMP, courses: [COURSE], errors: [], partial: false });
    if (input.action === 'sync') return json({ revision: state.revision, fetchedAt: STAMP,
      courses: [COURSE], homework: [HOMEWORK], materials: [], announcements: [], errors: [], partial: false });
    if (input.action === 'prepare') return preparations.shift() ?? json(preparation(state.revision));
    throw new Error(`Unexpected synthetic action: ${String(input.action)}`);
  });
  return { state, sessions, statuses, preparations };
}
const calls = (action: string) => fetchMock.mock.calls.filter(([, init]) => body(init).action === action);
const mutations = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT' ||
  ['upload', 'submit'].includes(String(body(init).action)));
function view() { return render(<NuniSessionProvider><TronClassWorkspace /></NuniSessionProvider>); }
async function editDraft() {
  fireEvent.click(await screen.findByRole('button', { name: '準備作業' }));
  await waitFor(() => expect(screen.queryByText('正在確認繳交條件與既有紀錄…')).toBeNull());
  fireEvent.change(screen.getByLabelText('作業內容'), { target: { value: PRIVATE_TEXT } });
  fireEvent.change(screen.getByLabelText('作業附件'), { target: {
    files: [new File(['synthetic private work'], PRIVATE_FILE, { type: 'text/plain' })],
  } });
}
async function refresh() { await act(async () => { window.dispatchEvent(new Event('pageshow')); }); }

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  auth.user = null; auth.loading = false;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('TronClass real platform-session refresh', () => {
  it('seals same-context drafts during refresh and restores only after fresh binding and prepare reads', async () => {
    const f = fixture();
    const getIdToken = vi.fn(async () => 'must-not-fall-back');
    auth.user = { uid: 'unrelated-firebase-user', getIdToken };
    view();
    await editDraft();
    const nextSession = deferred<Response>();
    const nextStatus = deferred<Response>();
    const nextPrepare = deferred<Response>();
    const statusCount = calls('status').length;
    const prepareCount = calls('prepare').length;
    f.sessions.push(nextSession.promise);
    f.statuses.push(nextStatus.promise);
    f.preparations.push(nextPrepare.promise);
    const schoolCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/tronclass')).length;
    await refresh();
    expect(screen.queryByLabelText('作業內容')).toBeNull();
    expect(screen.queryByText(PRIVATE_FILE)).toBeNull();
    expect(screen.queryByText('合成同學 · synthetic-student')).toBeNull();
    expect(screen.getByText('正在確認登入狀態…')).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/tronclass'))).toHaveLength(schoolCalls);
    expect(getIdToken).not.toHaveBeenCalled();

    // Even a new school-binding revision may restore the same verified school
    // identity, but no editor or cached school data appears before status.
    f.state.revision = 'e'.repeat(32);
    await act(async () => nextSession.resolve(json(PRINCIPAL)));
    await waitFor(() => expect(calls('status').length).toBeGreaterThan(statusCount));
    expect(screen.queryByRole('button', { name: '準備作業' })).toBeNull();
    expect(screen.queryByDisplayValue(PRIVATE_TEXT)).toBeNull();
    await act(async () => nextStatus.resolve(json(connection(f.state.revision))));
    expect(calls('prepare')).toHaveLength(prepareCount);
    fireEvent.click(await screen.findByRole('button', { name: '繼續讀取目前帳號的課程' }));
    fireEvent.click(await screen.findByRole('button', { name: '繼續編輯保留的草稿' }));
    await waitFor(() => expect(calls('prepare')).toHaveLength(prepareCount + 1));
    const input = screen.getByLabelText('作業內容') as HTMLTextAreaElement;
    expect(input.value).toBe('');
    expect(input.disabled).toBe(true);
    expect(screen.queryByText(PRIVATE_FILE)).toBeNull();
    await act(async () => nextPrepare.resolve(json(preparation(f.state.revision))));
    expect((await screen.findByDisplayValue(PRIVATE_TEXT) as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.getByText(PRIVATE_FILE)).toBeTruthy();
    expect(mutations()).toHaveLength(0);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(getIdToken).not.toHaveBeenCalled();
  });

  it.each([
    { ...PRINCIPAL, context: 'c'.repeat(43) },
    { ...PRINCIPAL, platformAccountId: 'pa_00000000-0000-4000-8000-000000000002' },
  ])('discards drafts when the platform owner or context changes: %j', async principal => {
    const f = fixture();
    view();
    await editDraft();
    const statusCount = calls('status').length;
    f.sessions.push(Promise.resolve(json(principal)));
    await refresh();
    await waitFor(() => expect(calls('status').length).toBeGreaterThan(statusCount));
    expect((calls('status').at(-1)?.[1]?.headers as Record<string, string>)['X-Campus-Session']).toBe(principal.context);
    expect(screen.queryByRole('button', { name: '繼續編輯保留的草稿' })).toBeNull();
    const prepareCount = calls('prepare').length;
    fireEvent.click(await screen.findByRole('button', { name: '準備作業' }));
    await waitFor(() => {
      expect(calls('prepare')).toHaveLength(prepareCount + 1);
      expect(screen.queryByText('正在確認繳交條件與既有紀錄…')).toBeNull();
      expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).disabled).toBe(false);
    });
    expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText(PRIVATE_FILE)).toBeNull();
  });

  it('discards sealed drafts after a session error, even if a later retry confirms the former identity', async () => {
    const f = fixture();
    view();
    await editDraft();
    f.sessions.push(Promise.resolve(json({ error: 'UNAVAILABLE' }, 503)));
    await refresh();
    expect(await screen.findByRole('button', { name: '重新確認登入' })).toBeTruthy();
    expect(screen.queryByDisplayValue(PRIVATE_TEXT)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新確認登入' }));
    await screen.findByRole('button', { name: '準備作業' });
    expect(screen.queryByRole('button', { name: '繼續編輯保留的草稿' })).toBeNull();
  });

  it.each([{ authenticated: false }, { ...PRINCIPAL, pendingLogout: true }])(
    'discards drafts on a completed or pending platform logout: %j', async result => {
      const f = fixture();
      view();
      await editDraft();
      f.sessions.push(Promise.resolve(json(result)));
      await refresh();
      expect(await screen.findByRole('heading', { name: '連接你的學校課程' })).toBeTruthy();
      expect(screen.queryByDisplayValue(PRIVATE_TEXT)).toBeNull();
      expect(screen.queryByText(PRIVATE_FILE)).toBeNull();
      await refresh();
      await screen.findByRole('button', { name: '準備作業' });
      expect(screen.queryByRole('button', { name: '繼續編輯保留的草稿' })).toBeNull();
    },
  );

  it('discards drafts when the new binding status identifies a different school student', async () => {
    const f = fixture();
    view();
    await editDraft();
    f.state.studentKey = 'f'.repeat(64);
    await refresh();
    await screen.findByRole('button', { name: '準備作業' });
    expect(screen.queryByRole('button', { name: '繼續編輯保留的草稿' })).toBeNull();
    expect(screen.queryByDisplayValue(PRIVATE_TEXT)).toBeNull();
  });

  it('stops a pending final preparation from continuing to upload or submit after refresh unmounts the editor', async () => {
    const f = fixture();
    view();
    await editDraft();
    fireEvent.click(screen.getByRole('button', { name: '預覽繳交內容' }));
    fireEvent.click(screen.getByLabelText('我已確認課程、作業內容與附件正確'));
    const oldPrepare = deferred<Response>();
    f.preparations.push(oldPrepare.promise);
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    await waitFor(() => expect(calls('prepare')).toHaveLength(2));
    const nextSession = deferred<Response>();
    f.sessions.push(nextSession.promise);
    await refresh();
    expect(screen.queryByText(PRIVATE_FILE)).toBeNull();
    await act(async () => oldPrepare.resolve(json(preparation())));
    expect(mutations()).toHaveLength(0);
    await act(async () => nextSession.resolve(json(PRINCIPAL)));
    expect(await screen.findByRole('button', { name: '繼續編輯保留的草稿' })).toBeTruthy();
    expect(mutations()).toHaveLength(0);
  });
});
