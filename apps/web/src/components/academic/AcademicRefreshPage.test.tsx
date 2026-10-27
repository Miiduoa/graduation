import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AcademicPage } from './AcademicPage';
import { loadAcademicRecords, type AcademicSnapshot } from '@/lib/academicClient';
import { ACADEMIC_REFRESH_INTERVAL_MS as INTERVAL } from '@/lib/academicRefreshController';

const context = vi.hoisted(() => ({ uid: 'a', schoolId: 'pu' }));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: { uid: context.uid }, loading: false, error: null }),
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
  usePathname: () => '/grades',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/academicClient', () => ({
  AcademicConnectionError: class extends Error {
    constructor(public readonly reason: string) { super(reason); }
  },
  loadAcademicRecords: vi.fn(),
}));

const flush = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
const page = () => (
  <AcademicPage kind="grades" title="成績" subtitle="校務資料" closedAlternative="請先連線學校">
    {(snapshot) => <p>已讀取帳號：{snapshot.ownerUid}</p>}
  </AcademicPage>
);

beforeEach(() => {
  vi.useFakeTimers();
  context.uid = 'a';
  context.schoolId = 'pu';
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.mocked(loadAcademicRecords).mockReset().mockImplementation(async (_kind, uid) => ({
    ownerUid: uid,
    schoolId: 'pu',
    fetchedAt: '2026-10-27T00:00:00.000Z',
    records: { grades: [], semesters: [], allSemesters: [], summary: {} },
  } as AcademicSnapshot<'grades'>));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('exposes an opt-in switch that starts updating without altering manual imports', async () => {
  const view = render(page());
  await flush();
  const toggle = screen.getByRole('checkbox', { name: '此頁自動更新學校資料' });
  expect((toggle as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText(/不會修改學校紀錄或覆蓋自行匯入資料/)).toBeTruthy();
  fireEvent.click(toggle);
  expect((toggle as HTMLInputElement).checked).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL); });
  expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
  view.unmount();
});

it('resets automatic refresh consent when the signed-in account changes', async () => {
  const view = render(page());
  await flush();
  fireEvent.click(screen.getByRole('checkbox', { name: '此頁自動更新學校資料' }));
  context.uid = 'b';
  view.rerender(page());
  await flush();
  expect((screen.getByRole('checkbox', { name: '此頁自動更新學校資料' }) as HTMLInputElement).checked).toBe(false);
  expect(screen.queryByText('已讀取帳號：a')).toBeNull();
  expect(screen.getByText('已讀取帳號：b')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL * 3); });
  expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
  view.unmount();
});

it('does not offer live refresh or send school requests for an unsupported campus', async () => {
  context.schoolId = 'nthu';
  const view = render(page());
  await flush();
  expect(screen.queryByRole('checkbox', { name: '此頁自動更新學校資料' })).toBeNull();
  expect(loadAcademicRecords).not.toHaveBeenCalled();
  view.unmount();
});
