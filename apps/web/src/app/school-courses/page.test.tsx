import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SchoolCoursesPage from './page';
import { AcademicConnectionError } from '@/lib/academicClient';
import { loadTronClassCourses, type SchoolLmsSnapshot, type TronClassCourseStatus } from '@/lib/tronClassCourses';

const context = vi.hoisted(() => ({
  uid: 'one' as string | null,
  schoolId: 'pu',
  loading: false,
  studentId: true,
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: context.uid ? { uid: context.uid } : null, loading: context.loading, error: null }),
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({
    status: 'ready', schoolId: context.schoolId,
    schoolName: context.schoolId === 'pu' ? '靜宜大學' : '國立清華大學',
    schoolSearch: `?schoolId=${context.schoolId}&campus=${context.schoolId}`,
  }),
}));
vi.mock('@/lib/signInOptions', () => ({ useSignInOptions: () => ({ studentId: context.studentId, loading: false }) }));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => null }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/PWAInstallBanner', () => ({ PWAInstallBanner: () => null }));
vi.mock('@/components/UpdateBanner', () => ({ UpdateBanner: () => null }));
vi.mock('@/components/SiteFooter', () => ({ SiteFooter: () => null }));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({
    selectedSchool: { id: context.schoolId }, loading: false, catalogStatus: 'ready',
  }),
}));
vi.mock('@/components/SchoolAccountRequired', () => ({ SchoolAccountRequired: () => <p>需要學校帳號</p> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/school-courses', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/tronClassCourses', () => ({ loadTronClassCourses: vi.fn() }));
vi.mock('@/lib/academicClient', () => ({
  AcademicConnectionError: class extends Error {
    constructor(public readonly reason: string) { super(reason); }
  },
}));

function snapshot(status: TronClassCourseStatus = 'ongoing', name = '資料庫管理'): SchoolLmsSnapshot {
  return {
    ownerUid: context.uid ?? 'one', schoolId: 'pu', source: 'pu-tronclass', status,
    fetchedAt: '2026-10-27T00:00:00.000Z',
    courses: [{ id: 100, name, code: '1234', teachers: ['王老師'], semester: '1151', status, href: 'https://tronclass.pu.edu.tw/course/100/content' }],
  };
}

beforeEach(() => {
  context.uid = 'one'; context.schoolId = 'pu'; context.loading = false; context.studentId = true;
  vi.mocked(loadTronClassCourses).mockReset().mockImplementation(async (_uid, status) => snapshot(status));
});
afterEach(() => {
  vi.useRealTimers();
});

it('reads real course records for the selected account and searches locally', async () => {
  render(<SchoolCoursesPage />);
  expect(await screen.findByRole('heading', { name: '資料庫管理' })).toBeTruthy();
  expect(loadTronClassCourses).toHaveBeenCalledWith('one', 'ongoing', 'pu');
  expect(screen.getByText('進行中 · 已讀取 1 門課程')).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往 資料庫管理 的 WOW Class 課堂' }).getAttribute('href')).toBe('https://tronclass.pu.edu.tw/course/100/content');
  fireEvent.change(screen.getByLabelText('搜尋課程、代碼或老師'), { target: { value: '王老師' } });
  expect(screen.getByText('找到 1 門課程')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜尋課程、代碼或老師'), { target: { value: '找不到' } });
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
  expect(screen.getByText('找到 0 門課程')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
  expect(screen.getByRole('heading', { name: '資料庫管理' })).toBeTruthy();
  expect(loadTronClassCourses).toHaveBeenCalledTimes(1);
});

it('loads the selected course state and supports keyboard status selection', async () => {
  render(<SchoolCoursesPage />);
  await screen.findByRole('heading', { name: '資料庫管理' });
  fireEvent.click(screen.getByRole('tab', { name: '已結束' }));
  await waitFor(() => expect(loadTronClassCourses).toHaveBeenLastCalledWith('one', 'completed', 'pu'));
  expect(await screen.findByText('已結束 · 已讀取 1 門課程')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('tab', { name: '已結束' }), { key: 'ArrowRight' });
  await waitFor(() => expect(loadTronClassCourses).toHaveBeenLastCalledWith('one', 'upcoming', 'pu'));
  expect(screen.getByRole('tab', { name: '未開始' }).getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: '未開始' }));
});

it('rejects a late ongoing reply after switching to completed courses', async () => {
  let finish!: (value: SchoolLmsSnapshot) => void;
  const old = snapshot('ongoing', '過期課程不得顯示');
  vi.mocked(loadTronClassCourses).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<SchoolCoursesPage />);
  await waitFor(() => expect(loadTronClassCourses).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('tab', { name: '已結束' }));
  await screen.findByText('已結束 · 已讀取 1 門課程');
  await act(async () => { finish(old); });
  expect(screen.queryByText('過期課程不得顯示')).toBeNull();
});

it('shows WOW Class as connecting and retries instead of claiming login failed', async () => {
  vi.useFakeTimers();
  vi.mocked(loadTronClassCourses)
    .mockRejectedValueOnce(new AcademicConnectionError('connecting'))
    .mockResolvedValueOnce(snapshot());
  render(<SchoolCoursesPage />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('heading', { name: '正在連線 WOW Class' })).toBeTruthy();
  expect(screen.getByText(/約需 1 分鐘/)).toBeTruthy();
  expect(screen.getByText(/會自動再讀取課程/)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '請重新連線 WOW Class' })).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(screen.getByRole('heading', { name: '資料庫管理' })).toBeTruthy();
  expect(loadTronClassCourses).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});

it('stops promising automatic reads after the connecting retry budget', async () => {
  vi.useFakeTimers();
  vi.mocked(loadTronClassCourses).mockRejectedValue(new AcademicConnectionError('connecting'));
  render(<SchoolCoursesPage />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByText(/會自動再讀取課程/)).toBeTruthy();
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  }
  expect(loadTronClassCourses).toHaveBeenCalledTimes(6);
  expect(screen.getByRole('heading', { name: '正在連線 WOW Class' })).toBeTruthy();
  expect(screen.queryByText(/會自動再讀取/)).toBeNull();
  expect(screen.getByText(/可以手動重新讀取/)).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(loadTronClassCourses).toHaveBeenCalledTimes(6);
  vi.useRealTimers();
});

it('offers a scoped reconnect without hiding access to academic records', async () => {
  vi.mocked(loadTronClassCourses).mockRejectedValueOnce(new AcademicConnectionError('reconnect'));
  render(<SchoolCoursesPage />);
  expect(await screen.findByRole('heading', { name: '請重新連線 WOW Class' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '重新連線學校帳號' }).getAttribute('href')).toContain(encodeURIComponent('/school-courses?schoolId=pu&campus=pu'));
  const navigation = screen.getByRole('navigation', { name: '課務導覽' });
  const grades = new URL(within(navigation).getByRole('link', { name: '成績' }).getAttribute('href')!, 'https://campus.local');
  expect(grades.pathname).toBe('/grades');
  expect(grades.searchParams.get('schoolId')).toBe('pu');
  expect(grades.searchParams.get('campus')).toBe('pu');
  expect(within(navigation).getByRole('link', { name: 'WOW Class 課程' }).getAttribute('aria-current')).toBe('page');
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
});

it('keeps connection failure distinct from an empty list and retries', async () => {
  vi.mocked(loadTronClassCourses).mockRejectedValueOnce(new AcademicConnectionError('unavailable'));
  render(<SchoolCoursesPage />);
  expect((await screen.findByRole('alert')).textContent).toContain('暫時無法讀取 WOW Class 課程');
  expect(screen.queryByText(/已讀取 0 門課程/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取課程' }));
  expect(await screen.findByRole('heading', { name: '資料庫管理' })).toBeTruthy();
  expect(loadTronClassCourses).toHaveBeenCalledTimes(2);
});

it('clears private courses immediately on account or school changes', async () => {
  const view = render(<SchoolCoursesPage />);
  await screen.findByRole('heading', { name: '資料庫管理' });
  context.schoolId = 'nthu'; view.rerender(<SchoolCoursesPage />);
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
  expect(screen.getByRole('heading', { name: '這所學校的課堂連線尚未接通' })).toBeTruthy();
  expect(loadTronClassCourses).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('link', { name: '前往 WOW Class ↗' })).toBeNull();
  context.schoolId = 'pu'; context.uid = null; view.rerender(<SchoolCoursesPage />);
  expect(screen.getByText('需要學校帳號')).toBeTruthy();
  expect(loadTronClassCourses).toHaveBeenCalledTimes(1);
});

it('does not read school data for guests or while their account is unresolved', () => {
  context.uid = null;
  const view = render(<SchoolCoursesPage />);
  expect(screen.getByText('需要學校帳號')).toBeTruthy();
  context.uid = 'one'; context.loading = true; view.rerender(<SchoolCoursesPage />);
  expect(screen.getByText('正在確認學校與帳號…')).toBeTruthy();
  expect(loadTronClassCourses).not.toHaveBeenCalled();
});

it('retains an explicit empty response without pretending it is the official enrollment list', async () => {
  vi.mocked(loadTronClassCourses).mockResolvedValueOnce({ ...snapshot(), courses: [] });
  render(<SchoolCoursesPage />);
  expect(await screen.findByRole('heading', { name: 'WOW Class 這次未回傳進行中課程' })).toBeTruthy();
  expect(screen.getByText(/這不表示沒有正式選課紀錄/)).toBeTruthy();
  expect(screen.queryByText(/0 學分/)).toBeNull();
});

it('does not expose a response for another account even if a loader misbehaves', async () => {
  vi.mocked(loadTronClassCourses).mockResolvedValueOnce({ ...snapshot(), ownerUid: 'other' });
  render(<SchoolCoursesPage />);
  const alert = within(await screen.findByRole('alert'));
  expect(alert.getByRole('heading', { name: '暫時無法讀取 WOW Class 課程' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
});
