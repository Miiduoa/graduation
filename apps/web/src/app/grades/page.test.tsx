import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { PersonalImportRecord } from '@campus/shared';
import { loadAcademicRecords } from '@/lib/academicClient';
import { personalImportsStorageKey } from '@/lib/personalImports';
import GradesPage from './page';

const context = vi.hoisted(() => ({
  uid: 'one' as string | null,
  schoolId: 'pu' as string | null,
  search: '',
  catalogStatus: 'ready' as 'loading' | 'ready' | 'error',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(context.search),
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: context.uid ? { uid: context.uid } : null, loading: false }),
}));
vi.mock('@/features/nuni/Session', () => ({
  useOptionalNuniSession: () => ({
    session: context.uid ? { platformAccountId: context.uid } : null,
    loading: false,
  }),
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({
    selectedSchoolId: context.schoolId,
    selectedSchool: context.schoolId ? { id: context.schoolId, name: context.schoolId } : null,
    loading: context.catalogStatus === 'loading',
    catalogStatus: context.catalogStatus,
  }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <main><h1>{title}</h1>{children}</main>
  ),
}));
vi.mock('@/features/nuni/StudentGrades', () => ({
  StudentGradesPage: () => <h1>原生課堂成績與回饋</h1>,
}));
vi.mock('@/lib/academicClient', () => ({ loadAcademicRecords: vi.fn() }));

function storeGrade(owner = 'platform:one', schoolId = 'pu', title = '已匯入的資料庫成績') {
  const grade: PersonalImportRecord = {
    id: `${owner}-${schoolId}`,
    kind: 'grades',
    title,
    schoolId,
    academicYear: '115',
    semester: '1',
    credits: 3,
    grade: '87',
    source: { type: 'file', name: '成績.csv', line: 1, rawText: `${title},87` },
    batchId: 'batch-one',
    importedAt: '2026-10-30T00:00:00.000Z',
  };
  const key = personalImportsStorageKey({ owner, schoolId });
  const value = JSON.stringify({ version: 1, records: [grade] });
  localStorage.setItem(key, value);
  return { key, value };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  context.uid = 'one';
  context.schoolId = 'pu';
  context.search = '';
  context.catalogStatus = 'ready';
});

it('keeps imported grades and editing available without requesting retired school records', () => {
  const stored = storeGrade();
  render(<GradesPage />);
  expect(screen.getByRole('heading', { name: '學校成績已不再同步' })).toBeTruthy();
  expect(screen.getByText('已匯入的資料庫成績')).toBeTruthy();
  expect(screen.getByText('115／1 · 3 學分 · 87')).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看與編輯全部個人紀錄 →' }).getAttribute('href')).toBe('/import?kind=grades');
  expect(screen.getByRole('link', { name: '匯入截圖或檔案' }).getAttribute('href')).toBe('/import?kind=grades');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('link', { name: /連線|學校帳號/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /重新讀取|更新資料|重新連線/ })).toBeNull();
  expect(loadAcademicRecords).not.toHaveBeenCalled();
  expect(localStorage.getItem(stored.key)).toBe(stored.value);
});

it.each([
  { name: 'signed-in PU', uid: 'one', schoolId: 'pu', catalogStatus: 'ready' },
  { name: 'guest PU', uid: null, schoolId: 'pu', catalogStatus: 'ready' },
  { name: 'another campus', uid: 'one', schoolId: 'nthu', catalogStatus: 'ready' },
  { name: 'all campuses', uid: null, schoolId: null, catalogStatus: 'ready' },
  { name: 'loading catalog', uid: 'one', schoolId: null, catalogStatus: 'loading' },
  { name: 'failed catalog', uid: 'one', schoolId: null, catalogStatus: 'error' },
] as const)('shows retirement without school login or a school request for $name', (state) => {
  Object.assign(context, state);
  render(<GradesPage />);
  expect(screen.getByRole('heading', { name: '學校成績已不再同步' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '自行匯入的資料' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('link', { name: /學校帳號|e 校園/ })).toBeNull();
  expect(loadAcademicRecords).not.toHaveBeenCalled();
});

it('keeps imported grades scoped to the current account and campus without deleting them', () => {
  const first = storeGrade();
  const otherSchool = storeGrade('platform:one', 'nthu', '清華個人成績');
  const otherAccount = storeGrade('platform:two', 'nthu', '另一帳號個人成績');
  const view = render(<GradesPage />);
  expect(screen.getByText('已匯入的資料庫成績')).toBeTruthy();
  context.schoolId = 'nthu';
  view.rerender(<GradesPage />);
  expect(screen.queryByText('已匯入的資料庫成績')).toBeNull();
  expect(screen.getByText('清華個人成績')).toBeTruthy();
  context.uid = 'two';
  view.rerender(<GradesPage />);
  expect(screen.queryByText('清華個人成績')).toBeNull();
  expect(screen.getByText('另一帳號個人成績')).toBeTruthy();
  context.uid = null;
  view.rerender(<GradesPage />);
  expect(screen.queryByText('另一帳號個人成績')).toBeNull();
  for (const stored of [first, otherSchool, otherAccount]) {
    expect(localStorage.getItem(stored.key)).toBe(stored.value);
  }
  expect(loadAcademicRecords).not.toHaveBeenCalled();
});

it('preserves campus context on grade tabs and the native classroom link', () => {
  context.schoolId = 'nthu';
  render(<GradesPage />);
  for (const [name, pathname, tab] of [
    ['學期成績', '/grades', null],
    ['課堂回饋', '/grades', 'feedback'],
    ['前往課堂', '/classroom', null],
  ] as const) {
    const href = new URL(screen.getByRole('link', { name }).getAttribute('href')!, 'https://campus.example');
    expect(href.pathname).toBe(pathname);
    expect(href.searchParams.get('tab')).toBe(tab);
    expect(href.searchParams.get('campus')).toBe('nthu');
    expect(href.searchParams.get('schoolId')).toBe('nthu');
    expect(href.searchParams.get('school')).toBe('NTHU');
  }
  expect(screen.getByRole('link', { name: '學期成績' }).getAttribute('aria-current')).toBe('page');
});

it('still renders native classroom feedback when its tab is selected', () => {
  context.search = 'tab=feedback';
  render(<GradesPage />);
  expect(screen.getByRole('heading', { name: '原生課堂成績與回饋' })).toBeTruthy();
  expect(screen.queryByText('學校成績已不再同步')).toBeNull();
  expect(loadAcademicRecords).not.toHaveBeenCalled();
});
