import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import CareerPage from './page';

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children, title }: { children: React.ReactNode; title?: string }) => (
    <main>
      {title ? <h1>{title}</h1> : null}
      {children}
    </main>
  ),
}));

vi.mock('@/components/SchoolPublicServiceLinks', () => ({
  SchoolPublicServiceLinks: ({ service }: { service: string }) => (
    <section aria-label="所選學校公開服務入口" data-service={service} />
  ),
}));

it('說明個人服務狀態並提供所選學校的職涯入口，頁面本身不預設學校', () => {
  render(<CareerPage />);
  expect(screen.getByRole('heading', { name: '職涯' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '個人職涯服務尚未開放' })).toBeTruthy();
  expect(screen.getByText('履歷與個人申請紀錄尚未連結。')).toBeTruthy();
  expect(screen.getByRole('region', { name: '所選學校公開服務入口' }).getAttribute('data-service')).toBe('career');
  expect(screen.queryByText(/靜宜/)).toBeNull();
});
