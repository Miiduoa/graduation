import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LibraryPage from './page';
const context = vi.hoisted(() => ({ schoolId: 'pu', schoolName: '靜宜大學' }));
vi.mock('@/lib/pageContext', () => ({ resolveSchoolPageContext: () => context }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
beforeEach(() => {
  context.schoolId = 'pu';
});
afterEach(cleanup);
it('searches the official catalog with the chosen field and user input', () => {
  render(<LibraryPage />);
  const input = screen.getByLabelText('關鍵字') as HTMLInputElement;
  const button = screen.getByRole('button', { name: '搜尋學校館藏 ↗' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.change(input, { target: { value: '資料庫 & SQL' } });
  fireEvent.change(screen.getByLabelText('搜尋範圍'), { target: { value: 'Title' } });
  expect(button.disabled).toBe(false);
  const form = button.closest('form')!;
  expect(form.action).toBe('https://webpacx.lib.pu.edu.tw/search');
  expect(form.method).toBe('get');
  expect(form.target).toBe('_blank');
  expect(form.getAttribute('rel')).toBe('noopener noreferrer');
  expect(new FormData(form).get('searchInput')).toBe('資料庫 & SQL');
  expect(new FormData(form).get('searchField')).toBe('Title');
});
it('sends personal borrowing actions to the library instead of reporting local success', () => {
  render(<LibraryPage />);
  expect(screen.getByRole('link', { name: '前往我的借閱紀錄 ↗' }).getAttribute('href')).toBe(
    'https://webpacx.lib.pu.edu.tw/personal/',
  );
  expect(screen.queryByRole('button', { name: /續借/ })).toBeNull();
  expect(screen.queryByText(/^(已借閱|續借成功|逾期罰款)/)).toBeNull();
});
it('does not show another school’s library for an unsupported school', () => {
  context.schoolId = 'other';
  render(<LibraryPage />);
  expect(screen.getByText('尚未提供這所學校的圖書館入口')).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
});
it('clears search input when the selected school changes', () => {
  const { rerender } = render(<LibraryPage />);
  fireEvent.change(screen.getByLabelText('關鍵字'), { target: { value: 'private query' } });
  context.schoolId = 'other';
  rerender(<LibraryPage />);
  context.schoolId = 'pu';
  rerender(<LibraryPage />);
  expect((screen.getByLabelText('關鍵字') as HTMLInputElement).value).toBe('');
});
