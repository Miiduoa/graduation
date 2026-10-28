import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import SchoolCoursesPage from './page';
import { AcademicConnectionError, loadAcademicRecords, type AcademicSnapshot } from '@/lib/academicClient';
import { loadTronClassCourses, type SchoolLmsSnapshot, type TronClassCourseStatus } from '@/lib/tronClassCourses';

const context = vi.hoisted(() => ({ uid: 'one' as string | null, schoolId: 'pu' }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: context.uid ? { uid: context.uid } : null, loading: false, error: null }) }));
vi.mock('@/lib/useCampusBrowseContext', () => ({ useCampusBrowseContext: () => ({ status: 'ready', schoolId: context.schoolId, schoolName: context.schoolId, schoolSearch: `?schoolId=${context.schoolId}` }) }));
vi.mock('@/lib/signInOptions', () => ({ useSignInOptions: () => ({ studentId: true, loading: false }) }));
vi.mock('@/components/SiteShell', () => ({ SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/components/SchoolAccountRequired', () => ({ SchoolAccountRequired: () => <p>需要學校帳號</p> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/school-courses', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/tronClassCourses', () => ({ loadTronClassCourses: vi.fn() }));
vi.mock('@/lib/academicClient', () => ({
  loadAcademicRecords: vi.fn(),
  AcademicConnectionError: class extends Error { constructor(public readonly reason: string) { super(reason); } },
}));
function lms(status: TronClassCourseStatus = 'ongoing', id = 100): SchoolLmsSnapshot {
  return { ownerUid: context.uid ?? 'one', schoolId: 'pu', source: 'pu-tronclass', status,
    fetchedAt: '2026-10-28T00:01:00Z', courses: [{ id, name: '網路課堂', code: '1234', teachers: [], semester: '1151', status, href: `https://tronclass.pu.edu.tw/course/${id}/content` }] };
}
function academic(): AcademicSnapshot<'courses'> {
  return { ownerUid: context.uid ?? 'one', schoolId: 'pu', fetchedAt: '2026-10-28T00:00:00Z', records: {
    semester: '1151', totalCredits: 2, sourceTotalCredits: 2,
    studentInfo: { class: null, studentId: null, name: null },
    courses: [{ id: 'one', code: '1234', name: '正式資料庫', nameEn: '', semester: '1151', classOffered: '三B', courseType: '必修', credits: 2,
      teacherName: '', teacherEmail: '', timePlaceRaw: '三 2–4', location: '1655', dayOfWeek: 3, periods: [2, 3, 4], startTime: null, endTime: null, scheduleWarning: null }],
  } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const matchedLink = () => screen.queryByRole('link', { name: '前往 正式資料庫 的對應課堂' });
async function readAcademic() {
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  await screen.findByRole('heading', { name: '正式資料庫' });
}
beforeEach(() => {
  context.uid = 'one'; context.schoolId = 'pu';
  vi.mocked(loadTronClassCourses).mockReset().mockImplementation(async (_uid, status) => lms(status));
  vi.mocked(loadAcademicRecords).mockReset().mockImplementation(async () => academic());
});
it('LMS 未完成時即可讀校方學分，完成後在同一工作區補上課堂', async () => {
  const pending = deferred<SchoolLmsSnapshot>(); vi.mocked(loadTronClassCourses).mockReturnValueOnce(pending.promise);
  render(<SchoolCoursesPage />);
  expect(loadAcademicRecords).not.toHaveBeenCalled(); await readAcademic();
  expect(screen.getByText('等待課堂資料')).toBeTruthy(); expect(matchedLink()).toBeNull();
  await act(async () => { pending.resolve(lms()); });
  expect(await screen.findByRole('heading', { name: '網路課堂' })).toBeTruthy(); expect(matchedLink()).toBeTruthy();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});
it('LMS 失敗後重試，不清掉已取得的校方學分', async () => {
  vi.mocked(loadTronClassCourses).mockRejectedValueOnce(new AcademicConnectionError('unavailable'));
  render(<SchoolCoursesPage />); await screen.findByRole('alert'); await readAcademic();
  const pending = deferred<SchoolLmsSnapshot>(); vi.mocked(loadTronClassCourses).mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取課程' }));
  expect(screen.getByRole('heading', { name: '正式資料庫' })).toBeTruthy(); expect(matchedLink()).toBeNull();
  await act(async () => { pending.resolve(lms()); });
  await waitFor(() => expect(matchedLink()).toBeTruthy()); expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});
it('更新 LMS 時保留校方搜尋，隱藏舊配對並採用新的課堂 ID', async () => {
  render(<SchoolCoursesPage />); await screen.findByRole('heading', { name: '網路課堂' }); await readAcademic();
  fireEvent.change(screen.getByLabelText('搜尋校方課程'), { target: { value: '１２３４' } });
  const pending = deferred<SchoolLmsSnapshot>(); vi.mocked(loadTronClassCourses).mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole('button', { name: '更新課程' }));
  expect(screen.getByRole('heading', { name: '正式資料庫' })).toBeTruthy(); expect(matchedLink()).toBeNull();
  await act(async () => { pending.resolve(lms('ongoing', 201)); });
  await waitFor(() => expect(matchedLink()?.getAttribute('href')).toContain('/201/content'));
  expect((screen.getByLabelText('搜尋校方課程') as HTMLInputElement).value).toBe('１２３４');
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});
it('切換課堂狀態仍忽略晚到的舊 LMS，但不重抓校方資料', async () => {
  const pending = deferred<SchoolLmsSnapshot>(); vi.mocked(loadTronClassCourses).mockReturnValueOnce(pending.promise);
  render(<SchoolCoursesPage />); await readAcademic();
  fireEvent.click(screen.getByRole('tab', { name: '已結束' }));
  await screen.findByText('已結束 · 已讀取 1 門課程');
  await act(async () => { pending.resolve(lms('ongoing', 999)); });
  expect(matchedLink()?.getAttribute('href')).toContain('/100/content');
  expect(screen.getByRole('heading', { name: '正式資料庫' })).toBeTruthy(); expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});
it('校方讀取失敗不移除已成功的 WOW Class 課堂', async () => {
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('unavailable'));
  render(<SchoolCoursesPage />); await screen.findByRole('heading', { name: '網路課堂' });
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' })); await screen.findByRole('alert');
  expect(screen.getByRole('link', { name: '前往 網路課堂 的 WOW Class 課堂' })).toBeTruthy(); expect(matchedLink()).toBeNull();
});
it('切換帳號後拒收舊的校方回應，切換學校後移除入口', async () => {
  const old = academic(); const pending = deferred<AcademicSnapshot<'courses'>>(); vi.mocked(loadAcademicRecords).mockReturnValueOnce(pending.promise);
  const view = render(<SchoolCoursesPage />); fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  context.uid = 'two'; view.rerender(<SchoolCoursesPage />);
  await act(async () => { pending.resolve(old); });
  expect(screen.queryByRole('heading', { name: '正式資料庫' })).toBeNull();
  context.schoolId = 'nthu'; view.rerender(<SchoolCoursesPage />);
  expect(screen.queryByRole('button', { name: '核對校方課表' })).toBeNull(); expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});
