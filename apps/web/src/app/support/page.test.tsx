import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import SupportPage from './page';

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children, title }: { children: React.ReactNode; title?: string }) => (
    <main>
      {title ? <h1>{title}</h1> : null}
      {children}
    </main>
  ),
}));

it('學校事務用功能說明，不寫特定學校名稱', () => {
  render(<SupportPage />);
  expect(screen.getByRole('heading', { name: '支援' })).toBeTruthy();
  expect(screen.getByText(/學校校務系統與各處室/)).toBeTruthy();
  expect(screen.queryByText(/靜宜/)).toBeNull();
});
