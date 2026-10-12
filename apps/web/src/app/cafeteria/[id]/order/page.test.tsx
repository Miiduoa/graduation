import { Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import HonestOrderPage from './page';

const state = vi.hoisted(() => ({
  shop: {
    id: 'stall',
    name: '校內咖啡店',
    merchantMode: 'showcase_link',
    orderingUrl: 'https://shop.example/order',
  },
}));

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
  loadStorefront: vi.fn(async () => state.shop),
  recordExternalOrderClick: vi.fn(),
}));

beforeEach(() => {
  state.shop = {
    id: 'stall',
    name: '校內咖啡店',
    merchantMode: 'showcase_link',
    orderingUrl: 'https://shop.example/order',
  };
});

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
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  expect(
    screen.getByText('會開啟店家自己的網站，訂單和付款由店家處理，Campus One 查不到這筆訂單'),
  ).toBeTruthy();
  expect(screen.queryByRole('link', { name: /點餐|下單/ })).toBeNull();
});

it('does not put an outbound button on javascript, userinfo, overlong, padded, http or data URLs', async () => {
  const unsafe = [
    'javascript:alert(1)',
    'https://a@evil.com',
    `https://shop.example/${'a'.repeat(2048)}`,
    ' https://shop.example/order',
    'https://shop.example/order ',
    'http://shop.example/order',
    'data:text/html,hi',
  ];
  for (const orderingUrl of unsafe) {
    state.shop = {
      id: 'stall',
      name: '校內咖啡店',
      merchantMode: 'showcase_link',
      orderingUrl,
    };
    const view = await act(async () =>
      render(
        <Suspense fallback={<p>載入訂餐</p>}>
          <HonestOrderPage
            params={Promise.resolve({ id: 'stall' })}
            searchParams={Promise.resolve({ schoolId: 'pu' })}
          />
        </Suspense>,
      ),
    );
    expect(await screen.findByText('這間店還沒有可打開的訂餐連結')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '到店家網站訂餐' })).toBeNull();
    view.unmount();
  }
});
