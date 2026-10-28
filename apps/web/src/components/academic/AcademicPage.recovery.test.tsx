import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import GradesPage from '@/app/grades/page';
import { AcademicConnectionError, loadAcademicRecords, type AcademicSnapshot } from '@/lib/academicClient';
import { normalizeGradeRecords } from '@/lib/academicRecords';

const context = vi.hoisted(() => ({ uid: 'one', loading: false, schoolId: 'pu' }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: { uid: context.uid }, loading: context.loading, error: null }) }));
vi.mock('@/lib/signInOptions', () => ({ useSignInOptions: () => ({ studentId: true, loading: false }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/grades', useSearchParams: () => new URLSearchParams(`schoolId=${context.schoolId}`) }));
vi.mock('@/lib/useCampusBrowseContext', () => ({ useCampusBrowseContext: () => ({ status: 'ready', schoolId: context.schoolId, schoolName: '靜宜大學', schoolSearch: `?schoolId=${context.schoolId}` }) }));
vi.mock('@/components/SiteShell', () => ({ SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/components/SchoolAccountRequired', () => ({ SchoolAccountRequired: () => <p>學校帳號未連線</p> }));
vi.mock('@/components/imports/PersonalImportSummary', () => ({ PersonalImportSummary: () => <p>個人匯入入口</p> }));
vi.mock('./GradesTabs', () => ({ GradesTabs: () => null, isGradesFeedbackTab: () => false }));
vi.mock('@/features/nuni/StudentGrades', () => ({ StudentGradesPage: () => null }));
vi.mock('@/lib/academicClient', async (original) => ({ ...await original<typeof import('@/lib/academicClient')>(), loadAcademicRecords: vi.fn() }));

function grades(uid = 'one', score = 86, semester = '1151', time = '2026-10-28T00:00:00Z'): AcademicSnapshot<'grades'> {
  return { ownerUid: uid, schoolId: 'pu', fetchedAt: time, records: normalizeGradeRecords({
    success: true, grades: [{ semester, courseName: 'AI 資料分析', credits: 3, score, courseType: '必修' },
      { semester: '1142', courseName: '程式設計', credits: 2, score: '通過', courseType: '選修' }],
    allSemesters: [semester, '1142'], summary: {},
  }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function start() { const view = render(<GradesPage />); await screen.findByRole('heading', { name: 'AI 資料分析' }); return view; }
const refresh = () => fireEvent.click(screen.getByRole('button', { name: '更新資料' }));
beforeEach(() => { context.uid = 'one'; context.loading = false; context.schoolId = 'pu'; vi.mocked(loadAcademicRecords).mockReset().mockResolvedValue(grades()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('keeps the same grade controls, selected semester, search and ordering through failure and successful retry', async () => {
  await start();
  const semester = screen.getByLabelText('學期'); const search = screen.getByLabelText('搜尋科目'); const sort = screen.getByLabelText('排序');
  const source = screen.getByRole('region', { name: '學校資料讀取結果' }); const originalTime = source.textContent;
  fireEvent.change(semester, { target: { value: '1151' } }); fireEvent.change(search, { target: { value: '資料' } }); fireEvent.change(sort, { target: { value: 'score' } });
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('unavailable')); refresh(); await screen.findByRole('alert');
  expect(screen.getByText('前次資料')).toBeTruthy(); expect(screen.queryByRole('region', { name: '校務更新差異' })).toBeNull();
  expect(screen.getByLabelText('學期')).toBe(semester); expect(screen.getByLabelText('搜尋科目')).toBe(search); expect(screen.getByLabelText('排序')).toBe(sort);
  expect((semester as HTMLSelectElement).value).toBe('1151'); expect((search as HTMLInputElement).value).toBe('資料'); expect((sort as HTMLSelectElement).value).toBe('score');
  expect(source.textContent).toContain('10/28'); expect(originalTime).toContain('10/28');
  const pending = deferred<AcademicSnapshot<'grades'>>(); vi.mocked(loadAcademicRecords).mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' })); await screen.findByRole('button', { name: '更新中…' });
  expect(screen.getByLabelText('搜尋科目')).toBe(search); expect(screen.getByRole('button', { name: '更新中…' }).hasAttribute('disabled')).toBe(true);
  await act(async () => { pending.resolve(grades('one', 91, '1151', '2026-10-29T00:10:00Z')); });
  await screen.findByRole('button', { name: '更新資料' });
  expect(screen.queryByText('前次資料')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByLabelText('搜尋科目')).toBe(search); expect((search as HTMLInputElement).value).toBe('資料');
  expect(screen.getByRole('region', { name: '學校資料讀取結果' }).textContent).toContain('10/29');
  await screen.findByText(/新增 0 組 · 變更 1 組/);
});

it.each(['reconnect', 'permission', 'unconfigured'] as const)('removes grade controls and old values when refresh fails with %s', async (reason) => {
  await start(); vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError(reason)); refresh();
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'AI 資料分析' })).toBeNull());
  expect(screen.queryByLabelText('搜尋科目')).toBeNull(); expect(screen.queryByText('前次資料')).toBeNull();
  expect(screen.getByText('個人匯入入口')).toBeTruthy();
});

it('rejects a mismatched owner and establishes a new comparison baseline after reconnecting', async () => {
  await start(); vi.mocked(loadAcademicRecords).mockResolvedValueOnce(grades('other')); refresh(); await screen.findByRole('alert');
  expect(screen.queryByRole('heading', { name: 'AI 資料分析' })).toBeNull();
  vi.mocked(loadAcademicRecords).mockResolvedValueOnce(grades('one', 99, '1151', '2026-10-29T00:10:00Z'));
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' })); await screen.findByRole('heading', { name: 'AI 資料分析' });
  await screen.findByText('已建立本次檢視的比對基準；下次成功更新後會列出差異。');
  expect(screen.queryByText(/變更 1 組/)).toBeNull();
});

it('labels a selected semester missing from the new response instead of displaying an incorrect selection', async () => {
  await start(); fireEvent.change(screen.getByLabelText('學期'), { target: { value: '1151' } });
  vi.mocked(loadAcademicRecords).mockResolvedValueOnce(grades('one', 91, '1141', '2026-10-29T00:00:00Z')); refresh();
  await screen.findByRole('option', { name: /本次未取得/ });
  expect((screen.getByLabelText('學期') as HTMLSelectElement).value).toBe('1151');
  expect(screen.getByText(/這次資料未包含你選擇的學期/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  expect(screen.getByRole('heading', { name: 'AI 資料分析' })).toBeTruthy();
  expect((screen.getByLabelText('學期') as HTMLSelectElement).value).toBe('');
  expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
});

it('normalizes full-width search locally without issuing another school request', async () => {
  await start(); fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: ' ＡＩ ' } });
  expect(screen.getByRole('heading', { name: 'AI 資料分析' })).toBeTruthy(); expect(screen.queryByRole('heading', { name: '程式設計' })).toBeNull();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});

it('does not show stale-data success copy when the first read fails', async () => {
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('unavailable'));
  render(<GradesPage />); await screen.findByRole('alert');
  expect(screen.queryByText('前次資料')).toBeNull(); expect(screen.queryByLabelText('搜尋科目')).toBeNull();
});

it('aborts an in-flight refresh and removes the earlier records when the account changes', async () => {
  const view = await start(); const pending = deferred<AcademicSnapshot<'grades'>>(); vi.mocked(loadAcademicRecords).mockReturnValueOnce(pending.promise);
  refresh(); await screen.findByRole('button', { name: '更新中…' }); const signal = vi.mocked(loadAcademicRecords).mock.calls.at(-1)?.[3]?.signal;
  context.uid = 'two'; vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('unavailable')); view.rerender(<GradesPage />);
  expect(signal?.aborted).toBe(true); expect(screen.queryByLabelText('搜尋科目')).toBeNull(); await screen.findByRole('alert');
  await act(async () => { pending.resolve(grades()); }); expect(screen.queryByRole('heading', { name: 'AI 資料分析' })).toBeNull();
});
