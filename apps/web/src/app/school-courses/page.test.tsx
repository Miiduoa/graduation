import { SchoolLmsReadonlyProvider } from '@/components/SchoolLmsReadonlyProvider';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SchoolCoursesPage from './page';
import { AcademicConnectionError } from '@/lib/academicClient';
import { loadTronClassCourses, type SchoolLmsSnapshot, type TronClassCourseStatus } from '@/lib/tronClassCourses';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';

const context = vi.hoisted(() => ({
  uid: 'one' as string | null,
  schoolId: 'pu',
  loading: false,
  studentId: true,
  search: '',
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: context.uid ? { uid: context.uid } : null, loading: context.loading, error: null }),
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: vi.fn(() => ({
    status: 'ready', schoolId: context.schoolId,
    schoolName: ({ ncnu: '國立暨南國際大學', pu: '靜宜大學', nthu: '國立清華大學', 'tw-nchu': '國立中興大學' } as Record<string, string>)[context.schoolId] || '未知學校',
    schoolSearch: `?schoolId=${context.schoolId}&campus=${context.schoolId}`,
  })),
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
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/school-courses', useSearchParams: () => new URLSearchParams(context.search) }));
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
  context.search = '';
  vi.mocked(useCampusBrowseContext).mockClear();
  vi.mocked(loadTronClassCourses).mockReset().mockImplementation(async (_uid, status) => snapshot(status));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(['ncnu', 'nthu'])('carries the assistant link into the existing %s public search without a private session', async (schoolId) => {
  context.uid = null;
  context.schoolId = schoolId;
  context.search = new URLSearchParams({ schoolId, q: '資料庫' }).toString();
  const sourceUrl = schoolId === 'nthu'
    ? 'https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/JH/OPENDATA/open_course_data.json'
    : 'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall';
  const fetcher = vi.fn().mockResolvedValue(Response.json({ schoolId, sourceUrl, courses: [], truncated: false }));
  vi.stubGlobal('fetch', fetcher);
  render(<SchoolCoursesPage />);
  expect(await screen.findByText(/沒有找到「資料庫」課程/)).toBeTruthy();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('資料庫');
  expect(useCampusBrowseContext).toHaveBeenCalledWith({ school: undefined, schoolId, campus: undefined });
  expect(fetcher).toHaveBeenCalledWith(`/api/public-course-catalog?schoolId=${schoolId}&q=${encodeURIComponent('資料庫')}`,
    expect.objectContaining({ credentials: 'omit' }));
  expect(loadTronClassCourses).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
});

it('carries the assistant keyword and every filter into public search without reading private courses', async () => {
  context.uid = null;
  context.schoolId = 'nthu';
  context.search = new URLSearchParams({ schoolId: 'nthu', campus: 'nthu', q: '資料庫', weekday: '3', credits: '3' }).toString();
  const fetcher = vi.fn().mockResolvedValue(Response.json({
    schoolId: 'nthu', sourceUrl: 'https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/JH/OPENDATA/open_course_data.json',
    fetchedAt: '2026-11-07T08:00:00.000Z', courses: [], truncated: false,
    filters: { weekday: 3, credits: 3 }, unresolvedCount: 1,
    operation: { id: 'nthu.courses.search', version: 2, responseSchemaVersion: 2, access: 'anonymous-public' },
  }));
  vi.stubGlobal('fetch', fetcher);
  render(<SchoolCoursesPage />);
  await screen.findByText(/沒有找到「資料庫」課程/);
  expect(screen.getByText('已套用條件：關鍵字「資料庫」 · 星期三有課 · 3 學分')).toBeTruthy();
  expect(fetcher).toHaveBeenCalledWith('/api/public-course-catalog?schoolId=nthu&q=' + encodeURIComponent('資料庫') + '&weekday=3&credits=3', expect.anything());
  expect(loadTronClassCourses).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
});

it('preserves duplicate filters from the URL so the public form can reject them', () => {
  context.uid = null;
  context.schoolId = 'nthu';
  context.search = 'schoolId=nthu&q=CS&weekday=1&weekday=3&credits=3';
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  render(<SchoolCoursesPage />);
  expect(screen.getByRole('alert').textContent).toContain('篩選條件無效或重複');
  expect(fetcher).not.toHaveBeenCalled();
  expect(loadTronClassCourses).not.toHaveBeenCalled();
});

it('distinguishes a missing URL query from an explicitly empty browse request', async () => {
  context.uid = null;
  context.schoolId = 'ncnu';
  const fetcher = vi.fn().mockResolvedValue(Response.json({
    schoolId: 'ncnu', sourceUrl: 'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall', courses: [], truncated: false,
  }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<SchoolCoursesPage />);
  expect(fetcher).not.toHaveBeenCalled();
  context.search = 'schoolId=ncnu&q=';
  view.rerender(<SchoolCoursesPage />);
  expect(await screen.findByText('這次查詢沒有找到課程。')).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith('/api/public-course-catalog?schoolId=ncnu', expect.anything());
});

it.each([
  'q=第一個&q=第二個',
  'q=' + '𠮷'.repeat(81),
])('does not automatically read an invalid query from the URL: %s', (search) => {
  context.uid = null;
  context.schoolId = 'nthu';
  context.search = 'schoolId=nthu&' + search;
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  render(<SchoolCoursesPage />);
  expect(screen.getByRole('alert').textContent).toMatch(/多個查詢條件|最多 80 個字/);
  expect(fetcher).not.toHaveBeenCalled();
  expect(loadTronClassCourses).not.toHaveBeenCalled();
});

it('reads real course records for the selected account and searches locally', async () => {
  render(<SchoolCoursesPage />);
  expect(await screen.findByRole('heading', { name: '資料庫管理' })).toBeTruthy();
  expect(loadTronClassCourses).toHaveBeenCalledWith('one', 'ongoing', 'pu');
  expect(screen.getByText('進行中 · 已讀取 1 門課程')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '本課作業與教材' })).toBeNull();
  expect(screen.getByRole('link', { name: 'nuni 課程空間' }).getAttribute('href')).toBe('/classroom');
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
  expect(within(navigation).getByRole('link', { name: '校方課程' }).getAttribute('aria-current')).toBe('page');
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
  expect(screen.getByRole('link', { name: '清大 eLearn ↗' }).getAttribute('href')).toBe('https://elearn.nthu.edu.tw/');
  expect(screen.getByRole('link', { name: '清大 eeclass ↗' }).getAttribute('href')).toBe('https://eeclass.nthu.edu.tw/');
  expect(loadTronClassCourses).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('link', { name: '前往 WOW Class ↗' })).toBeNull();
  context.schoolId = 'pu'; context.uid = null; view.rerender(<SchoolCoursesPage />);
  expect(screen.getByText('需要學校帳號')).toBeTruthy();
  expect(loadTronClassCourses).toHaveBeenCalledTimes(1);
});

it('opens the selected catalog and carries that campus into personal timetable import', () => {
  context.uid = null;
  context.schoolId = 'tw-nchu';
  const view = render(<SchoolCoursesPage />);
  expect(screen.getByRole('link', { name: '中興大學課程查詢系統 ↗' }).getAttribute('href')).toBe('https://onepiece.nchu.edu.tw/cofsys/plsql/crseqry_home');
  const href = screen.getByRole('link', { name: '匯入我的課表' }).getAttribute('href');
  const url = new URL(href!, 'https://campus.local');
  expect(url.pathname).toBe('/import');
  expect(url.searchParams.get('kind')).toBe('timetable');
  expect(url.searchParams.get('campus')).toBe('tw-nchu');
  context.schoolId = 'other-campus';
  view.rerender(<SchoolCoursesPage />);
  expect(screen.queryByRole('link', { name: /中興|興大/ })).toBeNull();
  expect(loadTronClassCourses).not.toHaveBeenCalled();
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

it('keeps the readonly course link when enabled', async () => {
  render(<SchoolLmsReadonlyProvider enabled={true}><SchoolCoursesPage /></SchoolLmsReadonlyProvider>);
  await screen.findByRole('heading', { name: '資料庫管理' });
  expect(screen.getByRole('link', { name: '本課作業與教材' }).getAttribute('href')).toBe('/school-lms?course=100&campus=pu');
});

it.each(['ncnu', 'nthu'])('clears the %s public search when switching campuses without opening a private school session', async (schoolId) => {
  let finish!: (response: Response) => void;
  const pending = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { finish = resolve; }));
  vi.stubGlobal('fetch', pending);
  try {
    context.uid = null;
    context.schoolId = schoolId;
    const view = render(<SchoolCoursesPage />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '切校前的查詢' } });
    fireEvent.submit(screen.getByRole('search', { name: '搜尋校方開課資料' }));
    expect(screen.getByText(/正在查詢「切校前的查詢」開課資料/)).toBeTruthy();
    expect(pending).toHaveBeenCalledWith(`/api/public-course-catalog?schoolId=${schoolId}&q=${encodeURIComponent('切校前的查詢')}`, expect.anything());
    context.schoolId = schoolId === 'ncnu' ? 'nthu' : 'ncnu';
    view.rerender(<SchoolCoursesPage />);
    const nextName = context.schoolId === 'nthu' ? '國立清華大學' : '國立暨南國際大學';
    expect(screen.getByRole('heading', { name: `${nextName}開課查詢` })).toBeTruthy();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(/正在查詢/)).toBeNull();
    expect(pending.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => { finish(Response.json({ schoolId, sourceUrl: 'https://example.invalid/', courses: [], truncated: false })); });
    expect(screen.queryByText(/這次查詢沒有找到/)).toBeNull();
    context.schoolId = 'tw-nchu';
    view.rerender(<SchoolCoursesPage />);
    expect(screen.queryByRole('search', { name: '搜尋校方開課資料' })).toBeNull();
    context.schoolId = schoolId;
    view.rerender(<SchoolCoursesPage />);
    expect(screen.queryByText(/正在查詢/)).toBeNull();
    expect(loadTronClassCourses).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
