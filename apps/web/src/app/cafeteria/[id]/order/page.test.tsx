import { Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import HonestOrderPage from './page';

vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: { uid: 'alice' } }) }));
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
vi.mock('@/lib/storefront', () => ({
  loadStorefront: vi.fn(async () => ({
    id: 'stall',
    name: '校內咖啡店',
    merchantMode: 'showcase_link',
    orderingUrl: 'https://shop.example/order',
  })),
  recordExternalOrderClick: vi.fn(),
}));

it('sends the student to the shop site and does not pretend Nuni took the order', async () => {
  await act(async () => {
    render(
      <Suspense fallback={<p>載入訂餐</p>}>
        <HonestOrderPage
          params={Promise.resolve({ id: 'stall' })}
          searchParams={Promise.resolve({ schoolId: 'pu' })}
        />
      </Suspense>,
    );
  });
  expect(await screen.findByText(/訂單在店家系統/)).toBeTruthy();
  const link = await screen.findByRole('link', { name: '到店家網站訂餐' });
  expect(link.getAttribute('href')).toContain('utm_source=nuni');
  expect(link.getAttribute('href')).toContain('ref=nuni-pu-stall');
  expect(
    screen.getByText('會開啟店家自己的網站，訂單和付款由店家處理，Campus One 查不到這筆訂單'),
  ).toBeTruthy();
  expect(screen.queryByRole('link', { name: /點餐|下單/ })).toBeNull();
});
