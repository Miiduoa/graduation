import { Suspense } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import HonestOrderPage from './page';
import { loadStorefront, recordExternalOrderClick } from '@/lib/storefront';

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
  vi.mocked(loadStorefront)
    .mockReset()
    .mockImplementation(async () => state.shop as never);
  vi.mocked(recordExternalOrderClick).mockReset().mockResolvedValue('https://shop.example/order');
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
  expect(
    await screen.findByText(
      '訂單在店家系統，請到店家查看。我們沒有這筆的訂單號碼、餐點明細或付款狀態。',
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/Nuni 不會產生取餐號碼/)).toBeNull();
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
    'https://shop.example/order\u0000',
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

it('keeps an outbound button for uppercase HTTPS', async () => {
  state.shop = {
    id: 'stall',
    name: '校內咖啡店',
    merchantMode: 'showcase_link',
    orderingUrl: 'HTTPS://shop.example/order',
  };
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
  expect(await screen.findByRole('link', { name: '到店家網站訂餐' })).toBeTruthy();
});

async function mountOrder() {
  await act(async () =>
    render(
      <Suspense fallback={<p>載入訂餐</p>}>
        <HonestOrderPage
          params={Promise.resolve({ id: 'stall' })}
          searchParams={Promise.resolve({ schoolId: 'pu' })}
        />
      </Suspense>,
    ),
  );
}

it('shows the destination before leaving and preserves the school when returning', async () => {
  await mountOrder();
  expect(screen.getByText('shop.example')).toBeTruthy();
  const link = screen.getByRole('link', { name: '到店家網站訂餐' });
  expect(link.getAttribute('target')).toBe('_blank');
  expect(screen.getByRole('link', { name: '返回店面' }).getAttribute('href')).toBe(
    '/cafeteria/stall?schoolId=pu',
  );
  expect(screen.getByRole('link', { name: '再看看菜單' }).getAttribute('href')).toBe(
    '/cafeteria/stall?schoolId=pu',
  );
});

it('offers retry after catalog failure instead of claiming there is no ordering link', async () => {
  vi.mocked(loadStorefront).mockRejectedValueOnce(new Error('offline'));
  await mountOrder();
  expect(screen.getByRole('alert').textContent).toContain('暫時無法確認店家連結');
  expect(screen.queryByText('目前沒有可使用的店家訂餐連結')).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '再試一次' })));
  expect(screen.getByRole('link', { name: '到店家網站訂餐' })).toBeTruthy();
  expect(loadStorefront).toHaveBeenLastCalledWith('pu', 'stall');
});

it('keeps the vendor link usable when optional click recording fails', async () => {
  vi.mocked(recordExternalOrderClick).mockRejectedValueOnce(new Error('offline'));
  await mountOrder();
  const link = screen.getByRole('link', { name: '到店家網站訂餐' });
  await act(async () => fireEvent.click(link));
  expect(link.getAttribute('href')).toContain('https://shop.example/order');
  expect(screen.getByRole('status').textContent).toContain('新分頁');
  expect(screen.queryByText(/已下單|訂餐成功/)).toBeNull();
});
