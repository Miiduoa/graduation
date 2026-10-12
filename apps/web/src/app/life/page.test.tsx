import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import LifePage from './page';

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

afterEach(() => {
  vi.unstubAllEnvs();
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
