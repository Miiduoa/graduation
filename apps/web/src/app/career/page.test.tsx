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

it('職涯還沒接通時用通用說法，不寫特定學校名稱', () => {
  render(<CareerPage />);
  expect(screen.getByRole('heading', { name: '職涯' })).toBeTruthy();
  expect(screen.getByText(/學校職涯或校友服務單位/)).toBeTruthy();
  expect(screen.queryByText(/靜宜/)).toBeNull();
});
