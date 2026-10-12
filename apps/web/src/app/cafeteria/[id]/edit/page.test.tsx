import { Suspense } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ShopStorefrontEditPage from './page';
import { saveShopStorefront } from '@/lib/storefront';

const state = vi.hoisted(() => ({
  user: { uid: 'merchant-1' } as { uid: string } | null,
  shop: {
    id: 'stall',
    name: '校內咖啡店',
    websiteUrl: '',
    orderingUrl: '',
    openingHours: '11:00–14:00',
    location: '學生餐廳',
    intro: '',
    merchantMode: 'info_only' as const,
  },
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
vi.mock('@/lib/storefront', () => ({
  loadStorefront: vi.fn(async () => state.shop),
  saveShopStorefront: vi.fn(async (input: { websiteUrl?: string; orderingUrl?: string }) => ({
    websiteUrl: input.websiteUrl?.trim() ?? '',
    orderingUrl: input.orderingUrl?.trim() ?? '',
  })),
}));

async function mount() {
  await act(async () => {
    render(
      <Suspense fallback={<p>載入店面</p>}>
        <ShopStorefrontEditPage
          params={Promise.resolve({ id: 'stall' })}
          searchParams={Promise.resolve({ schoolId: 'pu' })}
        />
      </Suspense>,
    );
  });
}

beforeEach(() => {
  state.user = { uid: 'merchant-1' };
  state.shop = {
    id: 'stall',
    name: '校內咖啡店',
    websiteUrl: '',
    orderingUrl: '',
    openingHours: '11:00–14:00',
    location: '學生餐廳',
    intro: '',
    merchantMode: 'info_only',
  };
  vi.mocked(saveShopStorefront).mockClear();
});

it('trims surrounding spaces and saves a valid https URL without an error', async () => {
  await mount();
  fireEvent.change(screen.getByLabelText('外連訂餐網址'), {
    target: { value: '  https://shop.example/order  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存店面' }));
  expect(saveShopStorefront).toHaveBeenCalledWith(
    expect.objectContaining({ orderingUrl: '  https://shop.example/order  ' }),
  );
  expect(await screen.findByText('店面資料已更新。')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('blocks a non-https URL and explains the reason', async () => {
  await mount();
  fireEvent.change(screen.getByLabelText('店家網站'), {
    target: { value: 'http://shop.example' },
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存店面' }));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe('請貼 https:// 開頭的網址');
});

it('blocks a URL with credentials and explains the reason', async () => {
  await mount();
  fireEvent.change(screen.getByLabelText('外連訂餐網址'), {
    target: { value: 'https://user:pass@shop.example/order' },
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存店面' }));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe('網址裡不能有帳號或密碼');
});

it('blocks an overly long URL and explains the reason', async () => {
  await mount();
  fireEvent.change(screen.getByLabelText('店家網站'), {
    target: { value: `https://shop.example/${'a'.repeat(500)}` },
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存店面' }));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe(
    '網址太長，請改用店家網站首頁或訂餐頁的網址',
  );
});
