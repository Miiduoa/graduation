import { Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import StorefrontPage from './page';
import {
  isFollowingStorefront,
  loadStorefrontComments,
  loadStorefrontPosts,
} from '@/lib/storefront';

const state = vi.hoisted(() => ({
  user: { uid: 'alice' } as { uid: string } | null,
  shop: {
    id: 'stall',
    name: '校內咖啡店',
    intro: '紙感小店',
    merchantMode: 'showcase_link',
    orderingUrl: 'https://shop.example/order',
    location: '學生餐廳',
    openingHours: undefined as string | undefined,
  } as {
    id: string;
    name: string;
    intro: string;
    merchantMode: string;
    orderingUrl?: string;
    websiteUrl?: string;
    location: string;
    openingHours?: string;
  },
  posts: [] as Array<{
    id: string;
    title: string;
    text: string;
    kind: string;
    createdAt: string;
    likeCount: number;
    liked: boolean;
  }>,
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
  state.posts = [];
  vi.mocked(isFollowingStorefront).mockReset().mockResolvedValue(false);
  vi.mocked(loadStorefrontComments).mockReset().mockResolvedValue([]);
  vi.mocked(loadStorefrontPosts)
    .mockReset()
    .mockImplementation(async () => state.posts);
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

it('hides unsafe website and ordering URLs instead of rendering them as links', async () => {
  const unsafe = [
    'javascript:alert(1)',
    'https://a@evil.com',
    `https://shop.example/${'a'.repeat(2048)}`,
    ' https://shop.example/order',
    'https://shop.example/order ',
    'http://shop.example/order',
    'data:text/html,hi',
    'https://shop.example/order\u0000',
  ];
  for (const url of unsafe) {
    state.shop = {
      ...showcaseShop,
      merchantMode: 'showcase_link',
      orderingUrl: url,
      websiteUrl: url,
    };
    const view = await act(async () =>
      render(
        <Suspense fallback={<p>載入店面</p>}>
          <StorefrontPage
            params={Promise.resolve({ id: 'stall' })}
            searchParams={Promise.resolve({ schoolId: 'pu' })}
          />
        </Suspense>,
      ),
    );
    expect(await screen.findByText('紙感小店')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '到店家網站訂餐' })).toBeNull();
    expect(screen.queryByRole('link', { name: '店家網站' })).toBeNull();
    view.unmount();
  }
});

it('shows the outbound button for uppercase HTTPS the same as lowercase', async () => {
  state.shop = {
    ...showcaseShop,
    orderingUrl: 'HTTPS://shop.example/order',
    websiteUrl: 'HTTPS://shop.example',
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
  expect(await screen.findByRole('link', { name: '到店家網站訂餐' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '店家網站' }).getAttribute('href')).toBe(
    'HTTPS://shop.example',
  );
});

it('adds noopener noreferrer on a safe website link', async () => {
  state.shop = { ...showcaseShop, websiteUrl: 'https://shop.example' };
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
  const link = await screen.findByRole('link', { name: '店家網站' });
  expect(link.getAttribute('href')).toBe('https://shop.example');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
});

const prompt = '登入後才能看失物招領和評論';

it('does not read comments, likes or follows before login and shows a login prompt', async () => {
  state.user = null;
  state.posts = [
    {
      id: 'post-1',
      title: '今日優惠',
      text: '買一送一',
      kind: 'promo',
      createdAt: '',
      likeCount: 0,
      liked: false,
    },
  ];
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
  expect(screen.getByText(prompt)).toBeTruthy();
  const login = screen.getByRole('link', { name: '登入' });
  expect(login.getAttribute('href')).toBe('/login?returnUrl=%2Fcafeteria%2Fstall%3FschoolId%3Dpu');
  expect(loadStorefrontPosts).toHaveBeenCalledWith('pu', 'stall', undefined);
  expect(loadStorefrontComments).not.toHaveBeenCalled();
  expect(isFollowingStorefront).not.toHaveBeenCalled();
  expect(screen.queryByText('目前沒有資料')).toBeNull();
  expect(screen.queryByText('請確認網路')).toBeNull();
});

it('shows the same login prompt when signed-in social reads are blocked by permissions', async () => {
  state.posts = [
    {
      id: 'post-1',
      title: '今日優惠',
      text: '買一送一',
      kind: 'promo',
      createdAt: '',
      likeCount: 0,
      liked: false,
    },
  ];
  vi.mocked(isFollowingStorefront).mockRejectedValueOnce(
    Object.assign(new Error('permission-denied'), { code: 'permission-denied' }),
  );
  vi.mocked(loadStorefrontComments).mockRejectedValue(
    Object.assign(new Error('permission-denied'), { code: 'permission-denied' }),
  );
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
  expect(await screen.findByText(prompt)).toBeTruthy();
  expect(screen.queryByText('暫時讀不到這間店。')).toBeNull();
  expect(screen.queryByText('目前沒有資料')).toBeNull();
  expect(screen.queryByText('請確認網路')).toBeNull();
});
