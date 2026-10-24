import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SchoolInfoPage from './page';
import { isPublicCampusPath, publicCampusServices } from '@/lib/publicCampusServices';

const context = vi.hoisted(() => ({
  status: 'ready' as 'ready' | 'loading' | 'error' | 'unselected',
  schoolId: 'pu' as string | null,
  schoolName: '靜宜大學' as string | null,
  schoolSearch: '?schoolId=pu&campus=pu',
}));

vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => context,
}));

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({
    children,
    schoolName,
  }: {
    children: React.ReactNode;
    schoolName?: string;
  }) => (
    <main>
      {schoolName ? <p data-testid="shell-school">{schoolName}</p> : null}
      {children}
    </main>
  ),
}));

beforeEach(() => {
  context.status = 'ready';
  context.schoolId = 'pu';
  context.schoolName = '靜宜大學';
  context.schoolSearch = '?schoolId=pu&campus=pu';
});

afterEach(cleanup);

it('shows official contact fields for the selected school', () => {
  render(<SchoolInfoPage />);
  expect(screen.getByRole('heading', { name: '靜宜大學' })).toBeTruthy();
  expect(screen.getByText(/臺中市/)).toBeTruthy();
  expect(screen.getByText(/臺中市沙鹿區臺灣大道七段200號/)).toBeTruthy();
  expect(screen.getByText(/學校總機：\(04\)26328001/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '撥打學校總機' }).getAttribute('href')).toBe(
    'tel:0426328001',
  );
  expect(screen.getByRole('link', { name: '官方網站 ↗' }).getAttribute('href')).toBe(
    'http://www.pu.edu.tw',
  );
  const maps = new URL(
    screen.getByRole('link', { name: '用地圖搜尋校名與地址 ↗' }).getAttribute('href')!,
  );
  expect(maps.origin + maps.pathname).toBe('https://www.google.com/maps/search/');
  expect(maps.searchParams.get('query')).toContain('靜宜大學');
  expect(maps.searchParams.get('query')).not.toMatch(/-?\d+\.\d+,-?\d+\.\d+/);
  expect(screen.getByText(/快照日期 2026-10-24/)).toBeTruthy();
  expect(screen.getByText(/此頁提供公開聯絡方式；校務服務依學校目前開放項目使用/)).toBeTruthy();
  expect(
    screen.getByRole('link', { name: '政府資料開放平台名錄 ↗' }).getAttribute('href'),
  ).toBe('https://data.gov.tw/dataset/6091');
  expect(screen.getByRole('link', { name: '官方網站 ↗' }).getAttribute('rel')).toBe(
    'noopener noreferrer',
  );
  expect(screen.getByRole('link', { name: '官方網站 ↗' }).getAttribute('target')).toBe('_blank');
});

it('offers copy instead of dial for ambiguous range telephone rows', async () => {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  context.schoolId = 'chu';
  context.schoolName = '中華大學';
  render(<SchoolInfoPage />);
  expect(screen.getByText(/學校總機：\(03\)5374281~5/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: '撥打學校總機' })).toBeNull();
  screen.getByRole('button', { name: '複製學校總機' }).click();
  expect(writeText).toHaveBeenCalledWith('(03)5374281~5');
  expect(await screen.findByText('已複製學校總機號碼。')).toBeTruthy();
});

it('shows loading, error, and unselected states without foreign school content', () => {
  context.status = 'loading';
  context.schoolId = null;
  const { rerender } = render(<SchoolInfoPage />);
  expect(screen.getByText('正在讀取所選校園…')).toBeTruthy();
  expect(screen.queryByText('靜宜大學')).toBeNull();
  expect(screen.queryByTestId('shell-school')).toBeNull();

  context.status = 'error';
  rerender(<SchoolInfoPage />);
  expect(screen.getByText('暫時無法確認校園')).toBeTruthy();

  context.status = 'unselected';
  rerender(<SchoolInfoPage />);
  expect(screen.getByText('先選擇一所學校')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '官方網站 ↗' })).toBeNull();
});

it('keeps unknown or conflicting identities unavailable', () => {
  context.schoolId = 'unknown-campus';
  context.schoolName = '未知學校';
  const { rerender } = render(<SchoolInfoPage />);
  expect(screen.getByText('目前沒有這所學校的公開聯絡資料')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '官方網站 ↗' })).toBeNull();

  context.schoolId = 'pu';
  context.schoolName = '國立清華大學';
  rerender(<SchoolInfoPage />);
  expect(screen.getByText('目前沒有這所學校的公開聯絡資料')).toBeTruthy();
  expect(screen.queryByText('靜宜大學')).toBeNull();
  expect(screen.queryByTestId('shell-school')).toBeNull();

  context.schoolId = 'nthu';
  context.schoolName = '靜宜大學';
  rerender(<SchoolInfoPage />);
  expect(screen.queryByText('靜宜大學')).toBeNull();
  expect(screen.queryByTestId('shell-school')).toBeNull();
});

it('clears previous school content when the selection switches', () => {
  const { rerender } = render(<SchoolInfoPage />);
  expect(screen.getByRole('heading', { name: '靜宜大學' })).toBeTruthy();

  context.schoolId = 'nthu';
  context.schoolName = '國立清華大學';
  rerender(<SchoolInfoPage />);
  expect(screen.getByRole('heading', { name: '國立清華大學' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '靜宜大學' })).toBeNull();
  expect(screen.getByTestId('shell-school').textContent).toBe('國立清華大學');
  expect(screen.getByRole('link', { name: '官方網站 ↗' }).getAttribute('href')).toBe(
    'http://www.nthu.edu.tw',
  );
});

it('registers school-info as a public campus entry that preserves selection', () => {
  expect(isPublicCampusPath('/school-info')).toBe(true);
  expect(publicCampusServices.some((service) => service.href === '/school-info')).toBe(true);
});
