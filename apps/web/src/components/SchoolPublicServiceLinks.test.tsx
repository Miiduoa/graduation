import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SchoolPublicServiceLinks } from './SchoolPublicServiceLinks';

const navigation = vi.hoisted(() => ({ search: '' }));
const browsing = vi.hoisted(() => ({
  id: 'pu' as string | null,
  name: '靜宜大學',
  loading: false,
  catalogStatus: 'ready' as 'ready' | 'loading' | 'error',
  missingProvider: false,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () =>
    browsing.missingProvider
      ? null
      : {
          selectedSchoolId: browsing.id,
          selectedSchool: browsing.id ? { id: browsing.id, name: browsing.name } : null,
          loading: browsing.loading,
          catalogStatus: browsing.catalogStatus,
        },
}));

beforeEach(() => {
  navigation.search = '';
  browsing.id = 'pu';
  browsing.name = '靜宜大學';
  browsing.loading = false;
  browsing.catalogStatus = 'ready';
  browsing.missingProvider = false;
});

it('shows the selected school career resource and switches immediately', () => {
  const view = render(<SchoolPublicServiceLinks service="career" />);
  expect(screen.getByRole('link', { name: '靜宜職涯發展暨產業促進處' }).getAttribute('href')).toBe(
    'https://cdif.pu.edu.tw/',
  );
  expect(screen.getByText(/來源：靜宜大學職涯發展暨產業促進處公開網站/)).toBeTruthy();

  browsing.id = 'ncku';
  browsing.name = '國立成功大學';
  view.rerender(<SchoolPublicServiceLinks service="career" />);
  expect(screen.queryByRole('link', { name: '靜宜職涯發展暨產業促進處' })).toBeNull();
  expect(screen.getByRole('link', { name: '成大生涯發展與就業輔導組' }).getAttribute('href')).toBe(
    'https://grad-osa.ncku.edu.tw/',
  );
});

it('lets an explicit URL school override the header selection', () => {
  browsing.id = 'pu';
  navigation.search = 'schoolId=ntpu';
  render(<SchoolPublicServiceLinks service="career" />);
  expect(screen.getByRole('link', { name: '北大職涯發展中心' }).getAttribute('href')).toBe(
    'https://career.ntpu.edu.tw/cht/index.php',
  );
  expect(screen.queryByRole('link', { name: '靜宜職涯發展暨產業促進處' })).toBeNull();
});

it('does not default to Providence when provider is missing without an explicit URL', () => {
  browsing.missingProvider = true;
  render(<SchoolPublicServiceLinks />);
  expect(screen.getByRole('status').textContent).toMatch(/請先在頁首選擇學校/);
  expect(screen.queryByRole('link', { name: /靜宜/ })).toBeNull();
});

it('requires a school for campus=all and when nothing is selected', () => {
  browsing.id = null;
  navigation.search = 'campus=all';
  const view = render(<SchoolPublicServiceLinks />);
  expect(screen.getByRole('status').textContent).toMatch(/請先在頁首選擇學校/);
  expect(screen.queryByRole('link')).toBeNull();

  navigation.search = '';
  view.rerender(<SchoolPublicServiceLinks />);
  expect(screen.getByRole('status').textContent).toMatch(/請先在頁首選擇學校/);
});

it('holds back links while catalog loading or on catalog error', () => {
  browsing.loading = true;
  const view = render(<SchoolPublicServiceLinks />);
  expect(screen.getByRole('status').textContent).toMatch(/正在載入學校資訊/);
  expect(screen.queryByRole('link')).toBeNull();

  browsing.loading = false;
  browsing.catalogStatus = 'error';
  view.rerender(<SchoolPublicServiceLinks />);
  expect(screen.getByRole('status').textContent).toMatch(/暫時無法載入學校清單/);
  expect(screen.queryByRole('link')).toBeNull();
});

it('keeps unknown schools without substituting another campus link', () => {
  browsing.id = 'nthu';
  browsing.name = '國立清華大學';
  render(<SchoolPublicServiceLinks service="career" />);
  expect(screen.getByRole('status').textContent).toMatch(/尚未提供/);
  expect(screen.queryByRole('link')).toBeNull();
});

it('describes NTU career entry as a student portal fallback with provenance', () => {
  browsing.id = 'ntu';
  browsing.name = '國立臺灣大學';
  render(<SchoolPublicServiceLinks service="career" />);
  expect(
    screen.getByRole('link', { name: '臺大學生專區（職涯資訊入口）' }).getAttribute('href'),
  ).toBe('https://www.ntu.edu.tw/student.html');
  expect(screen.getByText('請在臺大學生專區查找職涯與實習資訊。')).toBeTruthy();
  expect(screen.getByText(/來源：國立臺灣大學學生專區公開網頁/)).toBeTruthy();
});

it('does not fall back to Providence for an unknown legacy school code', () => {
  browsing.missingProvider = true;
  navigation.search = 'school=BOGUS';
  render(<SchoolPublicServiceLinks service="career" />);
  expect(screen.getByRole('status').textContent).toMatch(/無法辨識/);
  expect(screen.queryByRole('link', { name: /靜宜/ })).toBeNull();
});

it('treats legacy school=all as no selected school', () => {
  browsing.missingProvider = true;
  navigation.search = 'school=all';
  render(<SchoolPublicServiceLinks service="career" />);
  expect(screen.getByRole('status').textContent).toMatch(/請先在頁首選擇學校/);
  expect(screen.queryByRole('link')).toBeNull();
});

it('resolves a valid legacy school=NTU code', () => {
  browsing.id = 'pu';
  navigation.search = 'school=NTU';
  render(<SchoolPublicServiceLinks service="career" />);
  expect(
    screen.getByRole('link', { name: '臺大學生專區（職涯資訊入口）' }).getAttribute('href'),
  ).toBe('https://www.ntu.edu.tw/student.html');
});

it('shows an explicit school URL without a provider', () => {
  browsing.missingProvider = true;
  navigation.search = 'schoolId=ncku';
  render(<SchoolPublicServiceLinks service="career" />);
  expect(screen.getByRole('link', { name: '成大生涯發展與就業輔導組' }).getAttribute('href')).toBe(
    'https://grad-osa.ncku.edu.tw/',
  );
});

it('lets campus=ncku win over stale schoolId=all or school=PU', () => {
  browsing.id = 'pu';
  navigation.search = 'campus=ncku&schoolId=all&school=PU';
  render(<SchoolPublicServiceLinks service="career" />);
  expect(screen.getByRole('link', { name: '成大生涯發展與就業輔導組' }).getAttribute('href')).toBe(
    'https://grad-osa.ncku.edu.tw/',
  );
  expect(screen.queryByRole('link', { name: /靜宜/ })).toBeNull();
});

it('does not inherit the header school for an invalid campus in the URL', () => {
  browsing.id = 'pu';
  browsing.name = '靜宜大學';
  navigation.search = 'campus=not-a-real-campus';
  render(<SchoolPublicServiceLinks service="career" />);
  expect(screen.queryByRole('link', { name: /靜宜/ })).toBeNull();
  expect(screen.getByRole('status').textContent).toMatch(/尚未提供/);
  expect(screen.getByRole('status').textContent).not.toMatch(/靜宜大學/);
});
