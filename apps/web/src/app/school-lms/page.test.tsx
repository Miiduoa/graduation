import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SchoolLmsPage from './LmsPageClient';
import { AcademicConnectionError } from '@/lib/academicClient';
import { loadTronClassLms, type LmsReadonlySnapshot } from '@/lib/tronClassLms';

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
vi.mock('next/navigation', () => ({ usePathname: () => '/school-lms', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/tronClassLms', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tronClassLms')>('@/lib/tronClassLms');
  return { ...actual, loadTronClassLms: vi.fn() };
});
vi.mock('@/lib/academicClient', () => ({
  AcademicConnectionError: class extends Error {
    constructor(public readonly reason: string) { super(reason); }
  },
}));

function snapshot(): LmsReadonlySnapshot {
  return {
    success: true, ownerUid: context.uid ?? 'one', schoolId: 'pu', source: 'pu-tronclass',
    fetchedAt: '2026-05-29T04:00:00.000Z',
    cache: { hit: false, expiresAt: '2026-05-29T04:10:00.000Z' },
    courses: [{ id: 10001, name: '資料庫系統' }], contentsLoadedFor: [10001],
    homework: [{
      id: 20001, courseId: 10001, courseName: '資料庫系統', title: '期末專題提案',
      deadline: '2026-05-29T15:59:00Z', deadlineLabel: '2026/5/29 下午11:59', submitted: false,
      description: '請上傳提案 PDF', href: 'https://tronclass.pu.edu.tw/course/10001/content#/activity/20001',
    }, {
      id: 20004, courseId: 10001, courseName: '資料庫系統', title: '補交實驗報告',
      deadline: '2026-05-28T15:59:00Z', deadlineLabel: '2026/5/28 下午11:59', submitted: false,
      description: '昨天已截止', href: 'https://tronclass.pu.edu.tw/course/10001/content#/activity/20004',
    }, {
      id: 20002, courseId: 10001, courseName: '資料庫系統', title: '週次練習',
      deadline: '2026-05-29T15:59:00Z', deadlineLabel: '2026/5/29 下午11:59', submitted: true,
      description: '已交', href: 'https://tronclass.pu.edu.tw/course/10001/content#/activity/20002',
    }],
    announcements: [], materials: [{
      id: 30001, courseId: 10001, courseName: '資料庫系統', title: '簡樸生活講義', type: 'material',
      href: 'https://tronclass.pu.edu.tw/course/10001/content#/activity/30001',
      files: [{ name: 'restricted.pdf', allowDownload: false, downloadHref: null }],
    }],
    courseErrors: [], siteAnnouncementError: null, upcomingCoursesError: null,
  };
}

beforeEach(() => {
  context.uid = 'one'; context.schoolId = 'pu'; context.loading = false; context.studentId = true;
  vi.useFakeTimers({ now: new Date('2026-05-29T04:00:00Z'), toFake: ['Date'] });
  vi.mocked(loadTronClassLms).mockReset().mockResolvedValue(snapshot());
});
afterEach(() => { vi.useRealTimers(); });

it('lists today homework and reaches the description in one click', async () => {
  render(<SchoolLmsPage />);
  expect(await screen.findByRole('heading', { name: '期末專題提案' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '週次練習' })).toBeNull();
  const today = screen.getByRole('heading', { name: '今天截止' }).closest('section');
  expect(today).toBeTruthy();
  expect(within(today as HTMLElement).getByRole('link', { name: '查看說明' }).getAttribute('href')).toBe('/school-lms/homework/10001/20001');
  expect(within(today as HTMLElement).getByRole('link', { name: '玩課雲同一筆 ↗' }).getAttribute('href')).toBe(
    'https://tronclass.pu.edu.tw/course/10001/content#/activity/20001',
  );
});

it('keeps overdue homework out of today and in its own section', async () => {
  render(<SchoolLmsPage />);
  expect(await screen.findByRole('heading', { name: '已逾期' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '補交實驗報告' })).toBeTruthy();
  const today = screen.getByRole('heading', { name: '今天截止' }).closest('section');
  expect(today?.textContent).toContain('期末專題提案');
  expect(today?.textContent).not.toContain('補交實驗報告');
});

it('shows submitted work in the full list and never as a todo', async () => {
  render(<SchoolLmsPage />);
  await screen.findByRole('heading', { name: '期末專題提案' });
  fireEvent.click(screen.getByRole('tab', { name: '全部作業' }));
  expect(screen.getByRole('heading', { name: '週次練習' })).toBeTruthy();
  expect(screen.getByText('已交')).toBeTruthy();
});

it('does not load course materials until the user opens a course', async () => {
  vi.mocked(loadTronClassLms).mockResolvedValueOnce({
    ...snapshot(),
    contentsLoadedFor: [],
    announcements: [],
    materials: [],
  });
  render(<SchoolLmsPage />);
  await screen.findByRole('heading', { name: '期末專題提案' });
  fireEvent.click(screen.getByRole('tab', { name: '教材' }));
  expect(screen.getByRole('heading', { name: '進入課程後才讀取教材' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '讀取此課教材' }).getAttribute('href')).toBe('/school-lms?course=10001');
});

it('does not offer a download for files the school locked', async () => {
  render(<SchoolLmsPage />);
  await screen.findByRole('heading', { name: '期末專題提案' });
  fireEvent.click(screen.getByRole('tab', { name: '教材' }));
  expect(screen.getByText(/學校未開放下載/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: /下載/ })).toBeNull();
});

it('shows 正在連線玩課雲 and retries instead of jumping to an error', async () => {
  vi.useFakeTimers({ now: new Date('2026-05-29T04:00:00Z') });
  let calls = 0;
  vi.mocked(loadTronClassLms).mockImplementation(async () => {
    calls += 1;
    if (calls === 1) throw new AcademicConnectionError('connecting');
    return snapshot();
  });
  render(<SchoolLmsPage />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('heading', { name: '正在連線玩課雲' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('heading', { name: '暫時無法讀取玩課雲資料' })).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(screen.getByRole('heading', { name: '期末專題提案' })).toBeTruthy();
  expect(loadTronClassLms).toHaveBeenCalledTimes(2);
});

it('backs off connecting retries and never uses an error alert', async () => {
  vi.useRealTimers();
  vi.useFakeTimers();
  vi.mocked(loadTronClassLms).mockRejectedValue(new AcademicConnectionError('connecting'));
  render(<SchoolLmsPage />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByText(/會自動再讀取/)).toBeTruthy();
  for (const delay of [2_000, 4_000, 8_000, 16_000, 16_000]) {
    await act(async () => { await vi.advanceTimersByTimeAsync(delay); });
  }
  expect(loadTronClassLms).toHaveBeenCalledTimes(6);
  expect(screen.getByRole('heading', { name: '正在連線玩課雲' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText(/還沒連上玩課雲，請稍後按重新讀取/)).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
  expect(loadTronClassLms).toHaveBeenCalledTimes(6);
  vi.useRealTimers();
});

it('does not auto-retry a generic 503 when the school session is already ready', async () => {
  vi.useRealTimers();
  vi.useFakeTimers();
  vi.mocked(loadTronClassLms).mockRejectedValue(new AcademicConnectionError('unavailable'));
  render(<SchoolLmsPage />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('heading', { name: '暫時無法讀取玩課雲資料' })).toBeTruthy();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '正在連線玩課雲' })).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
  expect(loadTronClassLms).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});

it('offers reconnect without inventing homework rows', async () => {
  vi.mocked(loadTronClassLms).mockRejectedValueOnce(new AcademicConnectionError('reconnect'));
  render(<SchoolLmsPage />);
  expect(await screen.findByRole('heading', { name: '請重新連線 WOW Class' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '重新連線學校帳號' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '期末專題提案' })).toBeNull();
});

it('keeps partial school errors visible instead of an empty success list', async () => {
  vi.mocked(loadTronClassLms).mockResolvedValueOnce({
    ...snapshot(),
    homework: [],
    courseErrors: [{ courseId: 10001, courseName: '資料庫系統', area: 'homework', status: 500 }],
  });
  render(<SchoolLmsPage />);
  expect(await screen.findByText(/資料庫系統的作業暫時無法讀取/)).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '全部作業' }));
  expect(screen.getByRole('heading', { name: '目前沒有作業資料' })).toBeTruthy();
});

it('refreshes from the school instead of silently keeping stale rows', async () => {
  render(<SchoolLmsPage />);
  await screen.findByRole('heading', { name: '期末專題提案' });
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  expect(loadTronClassLms).toHaveBeenLastCalledWith('one', { refresh: true, expectedSchool: 'pu' });
});
