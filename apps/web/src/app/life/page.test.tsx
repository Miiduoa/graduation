import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import LifePage from './page';

const selectedSchool = vi.hoisted(() => vi.fn());

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: selectedSchool,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  selectedSchool.mockReset();
});

it('線上點餐還沒開：生活頁不放「我的訂單」', () => {
  render(<LifePage />);
  expect(screen.queryByText('我的訂單')).toBeNull();
  expect(screen.queryByText('看訂單狀態和取餐號碼。')).toBeNull();
  expect(document.querySelector('a[href="/orders"]')).toBeNull();
  expect(screen.getByText('餐廳')).toBeTruthy();
});

it('線上點餐打開之後，生活頁再出現「我的訂單」', () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  render(<LifePage />);
  expect(screen.getByText('我的訂單')).toBeTruthy();
  expect(screen.getByText('看訂單狀態和取餐號碼。')).toBeTruthy();
  expect(document.querySelector('a[href="/orders"]')).toBeTruthy();
});

it('可以用需求找服務，並接受全形英文與前後空白', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '借書' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /圖書館/ }).getAttribute('href')).toBe('/library');
  expect(screen.getByRole('status').textContent).toBe('找到 1 項服務');

  fireEvent.change(search, { target: { value: '  ＢＵＳ  ' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /公車/ }).getAttribute('href')).toBe('/bus');
});

it('分類與關鍵字共同篩選，清除搜尋會保留分類及輸入焦點', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.click(screen.getByRole('button', { name: '免登入' }));
  expect(screen.getAllByRole('link')).toHaveLength(5);
  expect(screen.getByRole('button', { name: '免登入' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.change(search, { target: { value: '教室' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /校園地圖/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
  expect(document.activeElement).toBe(search);
  expect(screen.getAllByRole('link')).toHaveLength(5);
  expect(screen.getByRole('button', { name: '免登入' }).getAttribute('aria-pressed')).toBe('true');
});

it('空結果可以恢復完整目錄，Escape 也可清除輸入', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '無此服務xyz' } });
  expect(screen.getByRole('heading', { name: '沒有找到符合的服務' })).toBeTruthy();
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.getByRole('status').textContent).toBe('找到 0 項服務');
  fireEvent.click(screen.getByRole('button', { name: '顯示全部服務' }));
  expect(screen.getAllByRole('link')).toHaveLength(9);
  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: '教室' } });
  fireEvent.keyDown(search, { key: 'Escape', isComposing: true });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(screen.getAllByRole('link')).toHaveLength(9);
});

it('搜尋不會繞過訂單開關，也不會將報修顯示為可使用服務', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '取餐' } });
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.queryByText('我的訂單')).toBeNull();
  fireEvent.change(search, { target: { value: '維修' } });
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.getByRole('complementary', { name: '報修 尚未開放' })).toBeTruthy();
  expect(screen.getByText('報修還沒開，有問題先找系辦或總務處。')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('找到 0 項服務，報修尚未開放');
});

it('搜尋結果維持已選校園的連結參數與原有帳號需求', () => {
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'nthu' },
    loading: false,
    catalogStatus: 'ready',
  });
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '好友' } });
  const friendLink = screen.getByRole('link', { name: /找人/ });
  const href = new URL(friendLink.getAttribute('href')!, 'https://campus.example');
  expect(href.pathname).toBe('/friends');
  expect(href.searchParams.get('schoolId')).toBe('nthu');
  expect(href.searchParams.get('campus')).toBe('nthu');
  expect(href.searchParams.get('school')).toBe('NTHU');
  expect(screen.getByText('使用學校帳號，以同學給你的代號加好友。')).toBeTruthy();
});
