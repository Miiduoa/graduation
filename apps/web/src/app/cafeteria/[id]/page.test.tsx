import { Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import StorefrontPage from './page';
import type { Cafeteria, MenuItem } from '@/lib/firebase';
import { fetchCafeteriaDetail } from '@/lib/cafeteriaCatalog';
import { UNVERIFIED_CAFETERIA_NOTICE } from '@campus/shared/src/cafeteriaCatalog';
import {
  isFollowingStorefront,
  loadStorefrontComments,
  loadStorefrontPosts,
  type StorefrontPost,
} from '@/lib/storefront';

const state = vi.hoisted(() => ({
  user: { uid: 'alice' } as { uid: string } | null,
  shop: {
    id: 'stall',
    name: '校內咖啡店',
    intro: '紙感小店',
    merchantMode: 'showcase_link' as const,
    orderingUrl: 'https://shop.example/order',
    location: '學生餐廳',
    openingHours: undefined as string | undefined,
  } as Cafeteria,
  posts: [] as StorefrontPost[],
  menus: [] as MenuItem[],
}));

vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({
    title,
    subtitle,
    children,
  }: {
    title: string;
    subtitle?: string;
    children: React.ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
      {children}
    </main>
  ),
}));
vi.mock('@/lib/pageContext', () => ({
  resolveSchoolPageContext: () => ({ schoolId: 'pu', schoolName: '靜宜大學' }),
}));
vi.mock('@/lib/cafeteriaCatalog', () => ({
  fetchCafeteriaDetail: vi.fn(async () => ({ cafeteria: state.shop, menus: state.menus })),
}));
vi.mock('@/lib/storefront', () => ({
  loadStorefrontPosts: vi.fn(async () => state.posts),
  isFollowingStorefront: vi.fn(async () => false),
  followStorefront: vi.fn(),
  loadStorefrontComments: vi.fn(async () => []),
  addStorefrontComment: vi.fn(),
  toggleStorefrontLike: vi.fn(),
}));

const showcaseShop: Cafeteria = {
  id: 'stall',
  name: '校內咖啡店',
  intro: '紙感小店',
  merchantMode: 'showcase_link',
  orderingUrl: 'https://shop.example/order',
  location: '學生餐廳',
};

const toastMenu: MenuItem = {
  id: 'meal',
  cafeteria: 'stall',
  cafeteriaId: 'stall',
  name: '蔬菜吐司',
  price: 60,
  availableOn: '2026-10-13',
};

beforeEach(() => {
  state.user = { uid: 'alice' };
  state.shop = { ...showcaseShop };
  state.posts = [];
  state.menus = [];
  vi.mocked(isFollowingStorefront).mockReset().mockResolvedValue(false);
  vi.mocked(loadStorefrontComments).mockReset().mockResolvedValue([]);
  vi.mocked(loadStorefrontPosts).mockReset().mockImplementation(async () => state.posts);
  vi.mocked(fetchCafeteriaDetail).mockReset().mockImplementation(async () => ({
    cafeteria: state.shop,
    menus: state.menus,
  }));
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
  expect(screen.getByText('店家自己的主頁。')).toBeTruthy();
  expect(screen.queryByText('店家自己的主頁。一般帳號即可查看、追蹤與留言。')).toBeNull();
  expect(
    screen.queryByText('價格、是否賣完、是否接單以店家訂餐頁為準。Nuni 不處理這筆的付款與退款。'),
  ).toBeNull();
  expect(screen.queryByRole('link', { name: '返回餐廳列表' })).toBeNull();
  expect(screen.queryByRole('link', { name: '回餐廳列表' })).toBeNull();
  expect(screen.getByRole('link', { name: '到店家網站訂餐' }).getAttribute('href')).toContain(
    '/cafeteria/stall/order',
  );
  expect(screen.getByText('這間店要到店家自己的頁面訂餐。')).toBeTruthy();
  expect(
    screen.getByText('會開啟店家自己的網站，訂單和付款由店家處理，Campus One 查不到這筆訂單'),
  ).toBeTruthy();
  expect(screen.queryByText('沒串接的店也可以只放訂餐連結。')).toBeNull();
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
  expect(screen.queryByText('這間店要到店家自己的頁面訂餐。')).toBeNull();
  expect(
    screen.queryByText('會開啟店家自己的網站，訂單和付款由店家處理，Campus One 查不到這筆訂單'),
  ).toBeNull();
  expect(screen.getByText('還沒有菜單。')).toBeTruthy();
  expect(screen.queryByText('沒串接的店也可以只放訂餐連結。')).toBeNull();
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

const commentsPrompt = '登入後才能看評論';

it('does not read comments, likes or follows before login and shows a login prompt', async () => {
  state.user = null;
  state.menus = [toastMenu];
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
  expect(screen.getByText('蔬菜吐司 · NT$60')).toBeTruthy();
  expect(screen.getByText(commentsPrompt)).toBeTruthy();
  expect(screen.queryByText('登入後才能看失物招領和評論')).toBeNull();
  const login = screen.getByRole('link', { name: '登入' });
  expect(login.getAttribute('href')).toBe('/login?returnUrl=%2Fcafeteria%2Fstall%3FschoolId%3Dpu');
  expect(loadStorefrontPosts).toHaveBeenCalledWith('pu', 'stall', undefined);
  expect(loadStorefrontComments).not.toHaveBeenCalled();
  expect(isFollowingStorefront).not.toHaveBeenCalled();
  expect(screen.queryByText('暫時讀不到這間店。')).toBeNull();
  expect(screen.queryByText('目前沒有資料')).toBeNull();
  expect(screen.queryByText('請確認網路')).toBeNull();
});

it('keeps the shop when menus fail to load', async () => {
  vi.mocked(fetchCafeteriaDetail).mockResolvedValueOnce({
    cafeteria: state.shop,
    menus: [],
  });
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
  expect(screen.queryByText('暫時讀不到這間店。')).toBeNull();
});

it('keeps shop data and menus when comment reads are blocked', async () => {
  state.menus = [toastMenu];
  vi.mocked(loadStorefrontPosts).mockRejectedValueOnce(
    Object.assign(new Error('permission-denied'), { code: 'permission-denied' }),
  );
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
  expect(await screen.findByText('紙感小店')).toBeTruthy();
  expect(screen.getByText('蔬菜吐司 · NT$60')).toBeTruthy();
  expect(screen.getByText(commentsPrompt)).toBeTruthy();
  expect(screen.queryByText('暫時讀不到這間店。')).toBeNull();
  expect(screen.queryByText('目前沒有資料')).toBeNull();
  expect(screen.queryByText('請確認網路')).toBeNull();
});

it('keeps the not-found copy and offers a way back when the shop is missing', async () => {
  state.shop = null as never;
  await act(async () => {
    render(
      <Suspense fallback={<p>載入店面</p>}>
        <StorefrontPage
          params={Promise.resolve({ id: 'cafe-1' })}
          searchParams={Promise.resolve({ schoolId: 'pu' })}
        />
      </Suspense>,
    );
  });
  expect(await screen.findByText('找不到這間店。')).toBeTruthy();
  expect(screen.getByRole('link', { name: '回餐廳列表' }).getAttribute('href')).toBe(
    '/cafeteria?schoolId=pu',
  );
  expect(screen.queryByText('這是示範店家，菜單和價格不是真的，不能點餐。')).toBeNull();
});

it.each([
  {
    reviewStatus: 'demo' as const,
    notice: '這是示範店家，菜單和價格不是真的，不能點餐。',
    hidden: UNVERIFIED_CAFETERIA_NOTICE,
  },
  {
    reviewStatus: 'unverified' as const,
    notice: UNVERIFIED_CAFETERIA_NOTICE,
    hidden: '這是示範店家，菜單和價格不是真的，不能點餐。',
  },
  {
    reviewStatus: undefined,
    notice: UNVERIFIED_CAFETERIA_NOTICE,
    hidden: '這是示範店家，菜單和價格不是真的，不能點餐。',
  },
])('shows the review notice for $reviewStatus shops', async ({ reviewStatus, notice, hidden }) => {
  state.shop = { ...showcaseShop, id: 'cafe-1', name: '校園小棧', reviewStatus } as never;
  await act(async () => {
    render(
      <Suspense fallback={<p>載入店面</p>}>
        <StorefrontPage
          params={Promise.resolve({ id: 'cafe-1' })}
          searchParams={Promise.resolve({ schoolId: 'pu' })}
        />
      </Suspense>,
    );
  });
  expect(await screen.findByText(notice)).toBeTruthy();
  expect(screen.queryByText(hidden)).toBeNull();
  expect(screen.getByText('紙感小店')).toBeTruthy();
  const box = screen.getByTestId('cafeteria-review-notice');
  expect(box.textContent).toBe(notice);
  expect(box.className).toMatch(/reviewNotice/);
});

it('hides sold-out marks on unverified and demo storefront menus', async () => {
  state.shop = { ...showcaseShop, reviewStatus: 'unverified' } as never;
  state.menus = [{ ...toastMenu, soldOut: true }];
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
  expect(await screen.findByText('蔬菜吐司 · NT$60')).toBeTruthy();
  expect(screen.queryByText(/售完/)).toBeNull();
  expect(screen.queryByText('供應中')).toBeNull();
});

it('does not mark a verified shop page', async () => {
  state.shop = { ...showcaseShop, reviewStatus: 'verified' } as never;
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
  expect(screen.queryByText('這是示範店家，菜單和價格不是真的，不能點餐。')).toBeNull();
  expect(
    screen.queryByText(UNVERIFIED_CAFETERIA_NOTICE),
  ).toBeNull();
  expect(screen.queryByTestId('cafeteria-review-notice')).toBeNull();
  expect(screen.queryByRole('link', { name: '返回餐廳列表' })).toBeNull();
});
