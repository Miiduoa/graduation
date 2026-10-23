import { Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import LostFoundPage from './page';
import { listLostFoundItems } from '@/lib/lostFound';

const state = vi.hoisted(() => ({
  user: { uid: 'alice' } as { uid: string } | null,
}));

vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: state.user, loading: false }) }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('@/lib/pageContext', () => ({
  resolveSchoolPageContext: () => ({ schoolId: 'pu', schoolName: '靜宜大學' }),
}));
vi.mock('@/lib/lostFound', () => ({
  listLostFoundItems: vi.fn(async () => []),
  categoryLabel: (value: string) => value,
  statusLabel: (value: string) => value,
}));

beforeEach(() => {
  state.user = { uid: 'alice' };
  vi.mocked(listLostFoundItems).mockReset().mockResolvedValue([]);
});

it('shows a login prompt instead of a 404 when the visitor is unsigned', async () => {
  state.user = null;
  await act(async () => {
    render(
      <Suspense fallback={<p>載入失物招領</p>}>
        <LostFoundPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
      </Suspense>,
    );
  });
  expect(await screen.findByText('登入後才能看失物招領和評論')).toBeTruthy();
  expect(screen.getByRole('link', { name: '登入' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Flost-found%3FschoolId%3Dpu',
  );
  expect(listLostFoundItems).not.toHaveBeenCalled();
  expect(screen.queryByText('找不到這個頁面')).toBeNull();
  expect(screen.queryByText('暫時無法讀取失物招領，請稍後再試。')).toBeNull();
});
