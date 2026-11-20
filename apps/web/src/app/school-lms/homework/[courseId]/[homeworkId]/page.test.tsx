import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import HomeworkDetailPage from './LmsPageClient';
import { AcademicConnectionError } from '@/lib/academicClient';
import { loadTronClassLms } from '@/lib/tronClassLms';
import type { LmsReadonlySnapshot } from '@/lib/tronClassLmsTypes';

const context = vi.hoisted(() => ({ uid: 'one' as string | null, schoolId: 'pu', authLoading: false }));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: context.uid ? { uid: context.uid } : null, loading: context.authLoading, error: null }),
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({
    status: 'ready', schoolId: context.schoolId, schoolName: context.schoolId === 'pu' ? '靜宜大學' : '國立清華大學', schoolSearch: '?campus=' + context.schoolId,
  }),
}));
vi.mock('@/lib/signInOptions', () => ({ useSignInOptions: () => ({ studentId: true, loading: false }) }));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => null }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/PWAInstallBanner', () => ({ PWAInstallBanner: () => null }));
vi.mock('@/components/UpdateBanner', () => ({ UpdateBanner: () => null }));
vi.mock('@/components/SiteFooter', () => ({ SiteFooter: () => null }));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({ selectedSchool: { id: 'pu' }, loading: false, catalogStatus: 'ready' }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/school-lms/homework/10001/20001',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ courseId: '10001', homeworkId: '20001' }),
}));
vi.mock('@/lib/tronClassLms', () => ({
  loadTronClassLms: vi.fn(),
  findLmsHomework: (snapshot: LmsReadonlySnapshot, courseId: number, homeworkId: number) =>
    snapshot.homework.find((item) => item.courseId === courseId && item.id === homeworkId),
}));
vi.mock('@/lib/academicClient', () => ({
  AcademicConnectionError: class extends Error {
    constructor(public readonly reason: string) { super(reason); }
  },
}));

function snapshot(): LmsReadonlySnapshot {
  return {
    success: true, ownerUid: 'one', schoolId: 'pu', source: 'pu-tronclass',
    fetchedAt: '2026-05-29T04:00:00.000Z', cache: { hit: true, expiresAt: '2026-05-29T04:10:00.000Z' },
    courses: [{ id: 10001, name: '資料庫系統' }], contentsLoadedFor: [],
    homework: [{
      id: 20001, courseId: 10001, courseName: '資料庫系統', title: '期末專題提案',
      deadline: '2026-05-29T15:59:00Z', deadlineLabel: '2026/5/29 下午11:59', submitted: false,
      description: '請上傳提案 PDF', href: 'https://tronclass.pu.edu.tw/course/10001/content#/activity/20001',
    }],
    announcements: [], materials: [], courseErrors: [], siteAnnouncementError: null, upcomingCoursesError: null,
  };
}

beforeEach(() => {
  context.uid = 'one'; context.schoolId = 'pu'; context.authLoading = false;
  vi.mocked(loadTronClassLms).mockReset().mockResolvedValue(snapshot());
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('shows 正在連線玩課雲 instead of an error while the LMS session is still hanging', async () => {
  vi.useFakeTimers();
  vi.mocked(loadTronClassLms).mockRejectedValue(new AcademicConnectionError('connecting'));
  render(<HomeworkDetailPage />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('heading', { name: '正在連線玩課雲' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('heading', { name: '暫時無法讀取作業說明' })).toBeNull();
});

it('does not auto-retry a generic 503 when the school session is already ready', async () => {
  vi.useFakeTimers();
  vi.mocked(loadTronClassLms).mockRejectedValue(new AcademicConnectionError('unavailable'));
  render(<HomeworkDetailPage />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('heading', { name: '暫時無法讀取作業說明' })).toBeTruthy();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '正在連線玩課雲' })).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
  expect(loadTronClassLms).toHaveBeenCalledTimes(1);
});

it('shows the homework description and the matching WOW Class link', async () => {
  render(<HomeworkDetailPage />);
  expect(await screen.findByRole('heading', { name: '期末專題提案' })).toBeTruthy();
  expect(await screen.findByText('請上傳提案 PDF')).toBeTruthy();
  expect(screen.getByRole('link', { name: '玩課雲同一筆 ↗' }).getAttribute('href')).toBe(
    'https://tronclass.pu.edu.tw/course/10001/content#/activity/20001',
  );
});

it('removes private homework immediately on an account change and a round trip between campuses', async () => {
  context.authLoading = true;
  const view = render(<HomeworkDetailPage />);
  expect(loadTronClassLms).not.toHaveBeenCalled();
  context.authLoading = false;
  view.rerender(<HomeworkDetailPage />);
  await screen.findByRole('heading', { name: '期末專題提案' });
  expect(screen.getByRole('link', { name: '回到作業清單' }).getAttribute('href')).toBe('/school-lms?campus=pu');
  vi.mocked(loadTronClassLms).mockImplementation(() => new Promise(() => {}));
  context.uid = 'two';
  view.rerender(<HomeworkDetailPage />);
  expect(screen.queryByText('請上傳提案 PDF')).toBeNull();
  context.schoolId = 'nthu';
  view.rerender(<HomeworkDetailPage />);
  expect(screen.getByRole('link', { name: '清大 eLearn ↗' })).toBeTruthy();
  expect(loadTronClassLms).toHaveBeenCalledTimes(2);
  context.schoolId = 'pu';
  view.rerender(<HomeworkDetailPage />);
  expect(screen.queryByText('請上傳提案 PDF')).toBeNull();
  expect(screen.getByText('正在讀取作業說明…')).toBeTruthy();
});
