import { Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import StorefrontPage from './page';

const state = vi.hoisted(() => ({
  user: { uid: 'alice' } as { uid: string } | null,
  shop: {
    id: 'stall',
    name: '校內咖啡店',
    intro: '紙感小店',
    merchantMode: 'showcase_link',
    orderingUrl: 'https://shop.example/order',
    location: '學生餐廳',
  },
  posts: [] as Array<{ id: string; title: string; text: string; kind: string; createdAt: string; likeCount: number; liked: boolean }>,
}));

vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: state.user }) }));
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
vi.mock('@/lib/firebase', () => ({
  fetchMenus: vi.fn(async () => []),
}));
vi.mock('@/lib/storefront', () => ({
  loadStorefront: vi.fn(async () => state.shop),
  loadStorefrontPosts: vi.fn(async () => state.posts),
  isFollowingStorefront: vi.fn(async () => false),
  followStorefront: vi.fn(),
  loadStorefrontComments: vi.fn(async () => []),
  addStorefrontComment: vi.fn(),
  toggleStorefrontLike: vi.fn(),
}));

const showcaseShop = {
  id: 'stall',
  name: '校內咖啡店',
  intro: '紙感小店',
  merchantMode: 'showcase_link',
  orderingUrl: 'https://shop.example/order',
  location: '學生餐廳',
};

beforeEach(() => {
  state.user = { uid: 'alice' };
  state.shop = { ...showcaseShop };
});

it('lets a regular account open a storefront and leave to the shop order page', async () => {
  await act(async () => {
    render(
      <Suspense fallback={<p>載入店面</p>}>
        <StorefrontPage
          params={Promise.resolve({ id: 'stall' })}
          searchParams={Promise.resolve({ schoolId: 'pu' })}
        />
      </Suspense>,
    );
  });
  expect(await screen.findByText('紙感小店')).toBeTruthy();
  expect(screen.getByRole('link', { name: '到店家網站訂餐' }).getAttribute('href')).toContain(
    '/cafeteria/stall/order',
  );
  expect(
    screen.getByText('會開啟店家自己的網站，訂單和付款由店家處理，Campus One 查不到這筆訂單'),
  ).toBeTruthy();
  expect(screen.queryByRole('link', { name: /點餐|下單/ })).toBeNull();
  expect(screen.getByRole('button', { name: '追蹤店家' })).toBeTruthy();
});

it('does not show an outbound order button when the shop has no ordering URL', async () => {
  state.shop = {
    id: 'stall',
    name: '校內咖啡店',
    intro: '紙感小店',
    merchantMode: 'showcase_link',
    location: '學生餐廳',
    openingHours: '週一至週五 11:00–14:00',
  };
  await act(async () => {
    render(
      <Suspense fallback={<p>載入店面</p>}>
        <StorefrontPage
          params={Promise.resolve({ id: 'stall' })}
          searchParams={Promise.resolve({ schoolId: 'pu' })}
        />
      </Suspense>,
    );
  });
  expect(await screen.findByText('學生餐廳 · 週一至週五 11:00–14:00')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '到店家網站訂餐' })).toBeNull();
  expect(screen.queryByRole('link', { name: /點餐|下單|訂餐/ })).toBeNull();
  expect(
    screen.queryByText('會開啟店家自己的網站，訂單和付款由店家處理，Campus One 查不到這筆訂單'),
  ).toBeNull();
});
