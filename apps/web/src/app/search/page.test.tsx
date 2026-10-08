import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import SearchPage from './page';

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

it('keeps every service discoverable with school context, including personal information', () => {
  render(<SearchPage />);
  expect(screen.getAllByRole('link')).toHaveLength(16);
  const profile = screen.getByRole('link', { name: /個人資料 查看與更新/ });
  const destination = new URL(profile.getAttribute('href')!, 'https://campus.example');
  expect(destination.pathname).toBe('/profile');
  expect(destination.searchParams.get('schoolId')).toBe('pu');
  expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
});

it('combines category filters with keyword search and restores all services after clearing', () => {
  render(<SearchPage />);
  fireEvent.click(screen.getByRole('button', { name: '校園生活' }));
  expect(screen.queryByRole('link', { name: /^課表/ })).toBeNull();
  expect(screen.getAllByRole('link')).toHaveLength(5);
  fireEvent.change(screen.getByRole('searchbox', { name: '想找什麼？' }), {
    target: { value: '借書' },
  });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /^圖書館/ })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('找到 1 項服務');
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  expect(screen.getAllByRole('link')).toHaveLength(16);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
});

it('offers a recovery action when a query has no matching service', () => {
  render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '無此服务' } });
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.getByRole('heading', { name: '沒有符合的服務' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看所有服務' }));
  expect(screen.getAllByRole('link')).toHaveLength(16);
});

it('matches search aliases without case or surrounding-space sensitivity', () => {
  render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  BUS  ' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(within(screen.getByRole('link')).getByRole('heading', { name: '公車' })).toBeTruthy();
});
