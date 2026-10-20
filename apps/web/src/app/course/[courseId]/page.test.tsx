import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import CoursePage from './page';
import { loadCourseWork, submitCourseText, type CourseAssignment, type CourseWork } from '@/lib/courseWork';

const auth = vi.hoisted(() => ({
  user: { uid: 'alice' } as { uid: string } | null,
  loading: false,
}));
const school = vi.hoisted(() => ({ selectedSchoolId: 'school-a', loading: false }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => auth }));
vi.mock('@/components/SelectedSchoolProvider', () => ({ useOptionalSelectedSchool: () => school }));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
vi.mock('@/components/PWAInstallBanner', () => ({ PWAInstallBanner: () => null }));
vi.mock('@/lib/courseWork', () => ({ loadCourseWork: vi.fn(), submitCourseText: vi.fn() }));

function assignment(id: string, changes: Partial<CourseAssignment> = {}): CourseAssignment {
  return {
    id, title: `作業 ${id}`, type: 'assignment', description: '', dueAt: null,
    allowLateSubmission: false, closed: false, submittedText: null, submittedAt: null,
    points: 100, grade: null, ...changes,
  };
}
function coursework(changes: Partial<CourseWork> = {}): CourseWork {
  return {
    id: 'course', name: '資料結構', description: '僅限修課者', canTeach: false,
    assignments: [assignment('A'), assignment('B')],
    modules: [{
      id: 'm1', title: '私人教材', description: '', order: 1,
      resourceUrl: null, resourceLabel: '教材',
    }],
    ...changes,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function mount() {
  const params = Promise.resolve({ courseId: 'course' });
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<CoursePage params={params} />); });
  return { view, params };
}
function answer(id: string) {
  return within(screen.getByRole('region', { name: `作業 ${id}` }))
    .getByRole('textbox', { name: '文字作業內容' }) as HTMLTextAreaElement;
}
function write(id: string, value: string) {
  fireEvent.change(answer(id), { target: { value } });
}
function submit(id: string) {
  fireEvent.click(within(screen.getByRole('region', { name: `作業 ${id}` }))
    .getByRole('button', { name: '繳交作業' }));
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.user = { uid: 'alice' };
  auth.loading = false;
  school.selectedSchoolId = 'school-a';
  school.loading = false;
  vi.mocked(loadCourseWork).mockResolvedValue(coursework());
  vi.mocked(submitCourseText).mockResolvedValue(undefined);
});

it('keeps guests outside coursework while showing its sign-in destination in the shared shell', async () => {
  auth.user = null;
  await mount();
  expect(screen.getByRole('heading', { level: 1, name: '課程內容' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '登入帳號' }).getAttribute('href')).toBe(
    '/login?redirect=%2Fcourse%2Fcourse',
  );
  expect(screen.getByRole('navigation', { name: '網站資訊' })).toBeTruthy();
  expect(loadCourseWork).not.toHaveBeenCalled();
});

it('keeps sibling edits mounted through another assignment submission and its background refresh', async () => {
  const save = deferred<void>();
  const refresh = deferred<CourseWork>();
  vi.mocked(submitCourseText).mockReturnValueOnce(save.promise);
  vi.mocked(loadCourseWork).mockResolvedValueOnce(coursework()).mockReturnValueOnce(refresh.promise);
  await mount();
  write('A', '  A 的送出內容  ');
  write('B', 'B 的草稿');
  const sibling = answer('B');
  submit('A');
  expect(answer('A').disabled).toBe(true);
  write('B', 'A 送出期間繼續寫 B');
  await act(async () => { save.resolve(undefined); });
  expect(submitCourseText).toHaveBeenCalledWith('course', 'A', 'alice', 'A 的送出內容');
  expect(screen.getByText('更新課程中，未送出的內容會保留。')).toBeTruthy();
  expect(answer('B')).toBe(sibling);
  write('B', '重新讀取期間的最新 B 草稿');
  await act(async () => {
    refresh.resolve(coursework({ assignments: [
      assignment('A', { submittedText: 'A 的送出內容', submittedAt: '2026-10-18T00:00:00Z' }),
      assignment('B'),
    ] }));
  });
  expect(answer('B')).toBe(sibling);
  expect(answer('B').value).toBe('重新讀取期間的最新 B 草稿');
  expect(within(screen.getByRole('region', { name: '作業 A' })).getByText('A 的送出內容')).toBeTruthy();
  expect(loadCourseWork).toHaveBeenCalledTimes(2);
});

it('preserves both answers after a submission failure and only sends one pending request', async () => {
  const save = deferred<void>();
  vi.mocked(submitCourseText).mockReturnValueOnce(save.promise);
  await mount();
  write('A', '送出失敗仍需保留');
  write('B', '另一份作業草稿');
  const form = answer('A').closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  write('B', '等待期間修改的另一份草稿');
  await act(async () => { save.reject(new Error('network error')); });
  expect(screen.getByRole('alert').textContent).toContain('內容已保留');
  expect(answer('A').value).toBe('送出失敗仍需保留');
  expect(answer('A').disabled).toBe(false);
  expect(answer('B').value).toBe('等待期間修改的另一份草稿');
  expect(submitCourseText).toHaveBeenCalledTimes(1);
  expect(loadCourseWork).toHaveBeenCalledTimes(1);
});

it('retains drafts on a failed background refresh and through retry', async () => {
  vi.mocked(loadCourseWork)
    .mockResolvedValueOnce(coursework())
    .mockRejectedValueOnce(Object.assign(new Error('network error'), { code: 'unavailable' }))
    .mockResolvedValueOnce(coursework());
  await mount();
  write('B', '網路失敗時仍保留的內容');
  const sibling = answer('B');
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('無法讀取課程'));
  expect(answer('B')).toBe(sibling);
  expect(answer('B').value).toBe('網路失敗時仍保留的內容');
  fireEvent.click(screen.getByRole('button', { name: '重試' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(answer('B')).toBe(sibling);
  expect(answer('B').value).toBe('網路失敗時仍保留的內容');
});

it.each([
  new Error('permission-denied'),
  Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }),
  new Error('找不到課程，或你尚未加入這門課。'),
])('clears coursework and drafts when a server recheck rejects access: %s', async (rejection) => {
  vi.mocked(loadCourseWork).mockResolvedValueOnce(coursework()).mockRejectedValueOnce(rejection);
  await mount();
  write('B', '不得保留在失去權限的畫面');
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('無法讀取課程'));
  expect(screen.queryByText('私人教材')).toBeNull();
  expect(screen.queryByText('僅限修課者')).toBeNull();
  expect(screen.queryByDisplayValue('不得保留在失去權限的畫面')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重試' }));
  await screen.findByRole('region', { name: '作業 B' });
  expect(answer('B').value).toBe('');
});

it.each(['account', 'school', 'course'] as const)(
  'discards stale reads and saves after a %s switch and does not carry drafts across scopes',
  async (change) => {
    const save = deferred<void>();
    const oldRefresh = deferred<CourseWork>();
    const newLoad = deferred<CourseWork>();
    vi.mocked(submitCourseText).mockReturnValueOnce(save.promise);
    vi.mocked(loadCourseWork)
      .mockResolvedValueOnce(coursework())
      .mockReturnValueOnce(oldRefresh.promise)
      .mockReturnValueOnce(newLoad.promise);
    const { view, params } = await mount();
    write('A', '舊範圍送出內容');
    write('B', '舊範圍私人草稿');
    submit('A');
    fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
    if (change === 'account') auth.user = { uid: 'bob' };
    if (change === 'school') school.selectedSchoolId = 'school-b';
    const nextParams = change === 'course' ? Promise.resolve({ courseId: 'course-b' }) : params;
    await act(async () => { view.rerender(<CoursePage params={nextParams} />); });
    expect(screen.queryByText('私人教材')).toBeNull();
    expect(screen.queryByDisplayValue('舊範圍私人草稿')).toBeNull();
    await act(async () => {
      newLoad.resolve(coursework({ id: change === 'course' ? 'course-b' : 'course', name: '新範圍課程' }));
    });
    expect(answer('B').value).toBe('');
    write('B', '新範圍草稿');
    await act(async () => {
      oldRefresh.resolve(coursework({ name: '過期的課程回應' }));
      save.resolve(undefined);
    });
    expect(screen.getByRole('heading', { level: 1, name: '新範圍課程' })).toBeTruthy();
    expect(screen.queryByText('過期的課程回應')).toBeNull();
    expect(screen.queryByText('舊範圍送出內容')).toBeNull();
    expect(answer('B').value).toBe('新範圍草稿');
    expect(loadCourseWork).toHaveBeenCalledTimes(3);
    expect(loadCourseWork).toHaveBeenLastCalledWith(
      change === 'course' ? 'course-b' : 'course', change === 'account' ? 'bob' : 'alice',
    );
  },
);

it('hides coursework during auth verification and rechecks access before restoring the same account', async () => {
  const recheck = deferred<CourseWork>();
  vi.mocked(loadCourseWork).mockResolvedValueOnce(coursework()).mockReturnValueOnce(recheck.promise);
  const { view, params } = await mount();
  write('B', '登入前的草稿');
  auth.loading = true;
  await act(async () => { view.rerender(<CoursePage params={params} />); });
  expect(screen.queryByText('私人教材')).toBeNull();
  expect(screen.queryByDisplayValue('登入前的草稿')).toBeNull();
  auth.loading = false;
  await act(async () => { view.rerender(<CoursePage params={params} />); });
  expect(screen.queryByText('私人教材')).toBeNull();
  await act(async () => { recheck.resolve(coursework()); });
  expect(answer('B').value).toBe('');
  expect(loadCourseWork).toHaveBeenCalledTimes(2);
});
