import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AcademicPage } from './AcademicPage';
import { AcademicConnectionError, loadAcademicRecords, type AcademicSnapshot } from '@/lib/academicClient';
import { ACADEMIC_REFRESH_INTERVAL_MS as INTERVAL } from '@/lib/academicRefreshController';

const context = vi.hoisted(() => ({ uid: 'one' as string | null, schoolId: 'pu' }));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: context.uid ? { uid: context.uid } : null, loading: false, error: null }),
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({
    status: 'ready', schoolId: context.schoolId, schoolName: '目前校園', schoolSearch: '',
  }),
}));
vi.mock('@/lib/signInOptions', () => ({ useSignInOptions: () => ({ studentId: true, loading: false }) }));
vi.mock('@/components/SiteShell', () => ({ SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/components/SchoolAccountRequired', () => ({ SchoolAccountRequired: () => null }));
vi.mock('@/components/imports/PersonalImportSummary', () => ({ PersonalImportSummary: () => null }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/grades', useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/academicClient', async (original) => ({
  ...(await original<typeof import('@/lib/academicClient')>()),
  loadAcademicRecords: vi.fn(),
}));
const flush = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
function snapshot(score: number, minute: number): AcademicSnapshot<'grades'> {
  return { ownerUid: context.uid ?? 'one', schoolId: 'pu', fetchedAt: new Date(Date.UTC(2026, 9, 27, 0, minute)).toISOString(), records: {
    grades: [{ id: `grade:${score}`, semester: '1151', courseName: '統計學', courseNameEn: '', class: '三B', courseType: '必修', credits: 3, score }],
    semesters: ['1151'], allSemesters: ['1151'], summary: {},
  } };
}
const page = () => (
  <AcademicPage kind="grades" title="成績" subtitle="校務資料" closedAlternative="請先連線學校">
    {(value) => <p>來源最新分數：{String(value.records.grades[0]?.score ?? '')}</p>}
  </AcademicPage>
);
beforeEach(() => {
  vi.useFakeTimers();
  context.uid = 'one'; context.schoolId = 'pu';
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.mocked(loadAcademicRecords).mockReset().mockResolvedValueOnce(snapshot(70, 0)).mockResolvedValue(snapshot(85, 5));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('manual refresh shows a diff from the actual loaded snapshots without a second request', async () => {
  render(page()); await flush();
  expect(screen.getByText(/已建立本次檢視的比對基準/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '更新資料' })); await flush();
  const report = within(screen.getByRole('region', { name: '校務更新差異' }));
  expect(report.getByText('70')).toBeTruthy();
  expect(report.getByText('新增 0 組 · 變更 1 組 · 待核對 0 組')).toBeTruthy();
  expect(screen.getByText('來源最新分數：85')).toBeTruthy();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
});
it('automatic refresh updates the summary through the existing real scheduler', async () => {
  render(page()); await flush();
  fireEvent.click(screen.getByRole('checkbox', { name: '此頁自動更新學校資料' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL); });
  expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
  expect(screen.getByText('新增 0 組 · 變更 1 組 · 待核對 0 組')).toBeTruthy();
});
it('does not add requests or an official diff panel for an unsupported school', async () => {
  context.schoolId = 'nthu'; render(page()); await flush();
  expect(loadAcademicRecords).not.toHaveBeenCalled();
  expect(screen.queryByRole('region', { name: '校務更新差異' })).toBeNull();
});


it('recovers a transient refresh failure without treating it as an empty success', async () => {
  render(page()); await flush();
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('unavailable'));
  fireEvent.click(screen.getByRole('button', { name: '更新資料' })); await flush();
  expect(screen.getByRole('heading', { name: '暫時無法讀取學校成績' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '重新讀取' }).className).toMatch(/primary/);
  expect(screen.queryByRole('heading', { name: '請重新連線學校帳號' })).toBeNull();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('region', { name: '校務更新差異' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' })); await flush();
  expect(screen.getByText('新增 0 組 · 變更 1 組 · 待核對 0 組')).toBeTruthy();
  expect(screen.getByText('70')).toBeTruthy();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(3);
});

it('removes the old summary and stops automatic reads when authorization expires', async () => {
  render(page()); await flush();
  fireEvent.click(screen.getByRole('checkbox', { name: '此頁自動更新學校資料' }));
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('reconnect'));
  await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL); });
  expect(screen.getByRole('heading', { name: '請重新連線學校帳號' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '連線學校帳號' }).className).toMatch(/primary/);
  expect(screen.queryByRole('button', { name: '重新讀取' })).toBeNull();
  expect(screen.queryByRole('region', { name: '校務更新差異' })).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL * 3); });
  expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
});

it('does not compare against a previous login even when the same account signs back in', async () => {
  const view = render(page()); await flush();
  fireEvent.click(screen.getByRole('button', { name: '更新資料' })); await flush();
  expect(screen.getByText('70')).toBeTruthy();
  context.uid = null; view.rerender(page()); await flush();
  expect(screen.queryByRole('region', { name: '校務更新差異' })).toBeNull();
  context.uid = 'one';
  vi.mocked(loadAcademicRecords).mockResolvedValue(snapshot(90, 10));
  view.rerender(page()); await flush();
  expect(screen.getByText(/已建立本次檢視的比對基準/)).toBeTruthy();
  expect(screen.queryByText('70')).toBeNull();
  expect((screen.getByRole('checkbox', { name: '此頁自動更新學校資料' }) as HTMLInputElement).checked).toBe(false);
});

it('ignores an old in-flight refresh after leaving and returning to the same campus', async () => {
  const view = render(page()); await flush();
  let finish!: (value: AcademicSnapshot<'grades'>) => void;
  vi.mocked(loadAcademicRecords).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '更新資料' })); await flush();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
  context.schoolId = 'nthu'; view.rerender(page()); await flush();
  expect(screen.queryByRole('region', { name: '校務更新差異' })).toBeNull();
  context.schoolId = 'pu';
  vi.mocked(loadAcademicRecords).mockResolvedValue(snapshot(90, 10));
  view.rerender(page()); await flush();
  await act(async () => { finish(snapshot(99, 15)); });
  expect(screen.getByText('來源最新分數：90')).toBeTruthy();
  expect(screen.queryByText('來源最新分數：99')).toBeNull();
  expect(screen.getByText(/已建立本次檢視的比對基準/)).toBeTruthy();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(3);
});
