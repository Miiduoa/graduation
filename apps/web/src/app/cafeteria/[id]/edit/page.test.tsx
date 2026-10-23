import { Suspense } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
vi.mock('@/lib/storefront', () => ({
  loadStorefront: vi.fn(async () => state.shop),
  saveShopStorefront: vi.fn(async (input: { websiteUrl?: string; orderingUrl?: string }) => ({
    websiteUrl: input.websiteUrl?.trim() ?? '',
    orderingUrl: input.orderingUrl?.trim() ?? '',
  })),
}));

function fieldGroup(label: string) {
  return screen.getByLabelText(label).closest('[data-field]') as HTMLElement;
}

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

it('keeps the trim hint in the card and not under the title', async () => {
  await mount();
  expect(screen.getByText(/貼網址時前後空白會自動去掉，不會當成錯誤/)).toBeTruthy();
  expect(screen.getByText('訂單和付款仍由店家處理。')).toBeTruthy();
  expect(screen.queryByText(/會先去掉前後空白再檢查/)).toBeNull();
});

it('groups the location label with its input', async () => {
  await mount();
  const group = fieldGroup('地點');
  expect(within(group).getByLabelText('地點')).toBeTruthy();
  expect(group.getAttribute('data-field')).toBe('location');
});

it('shows a non-https error under the website field', async () => {
  await mount();
  fireEvent.change(screen.getByLabelText('店家網站'), {
    target: { value: 'http://shop.example' },
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存店面' }));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(within(fieldGroup('店家網站')).getByRole('alert').textContent).toBe(
    '請貼 https:// 開頭的網址',
  );
  expect(within(fieldGroup('外連訂餐網址')).queryByRole('alert')).toBeNull();
});

it('shows a credentials error under the ordering field', async () => {
  await mount();
  fireEvent.change(screen.getByLabelText('外連訂餐網址'), {
    target: { value: 'https://user:pass@shop.example/order' },
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存店面' }));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(within(fieldGroup('外連訂餐網址')).getByRole('alert').textContent).toBe(
    '網址裡不能有帳號或密碼',
  );
  expect(within(fieldGroup('店家網站')).queryByRole('alert')).toBeNull();
});

it('shows javascript, userinfo and data errors under the website field', async () => {
  await mount();
  fireEvent.change(screen.getByLabelText('店家網站'), {
    target: { value: 'javascript:alert(1)' },
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存店面' }));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(within(fieldGroup('店家網站')).getByRole('alert').textContent).toBe(
    '請貼 https:// 開頭的網址',
  );
  fireEvent.change(screen.getByLabelText('店家網站'), {
    target: { value: 'https://a@evil.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存店面' }));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(within(fieldGroup('店家網站')).getByRole('alert').textContent).toBe(
    '網址裡不能有帳號或密碼',
  );
  fireEvent.change(screen.getByLabelText('店家網站'), {
    target: { value: 'data:text/html,hi' },
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存店面' }));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(within(fieldGroup('店家網站')).getByRole('alert').textContent).toBe(
    '請貼 https:// 開頭的網址',
  );
});

it('shows a too-long error under the website field', async () => {
  await mount();
  fireEvent.change(screen.getByLabelText('店家網站'), {
    target: { value: `https://shop.example/${'a'.repeat(2048)}` },
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存店面' }));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(within(fieldGroup('店家網站')).getByRole('alert').textContent).toBe(
    '網址太長，請改用店家網站首頁或訂餐頁的網址',
  );
});

it('treats uppercase HTTPS the same as https on save', async () => {
  await mount();
  fireEvent.change(screen.getByLabelText('店家網站'), {
    target: { value: 'HTTPS://shop.example' },
  });
  fireEvent.change(screen.getByLabelText('外連訂餐網址'), {
    target: { value: 'HTTPS://shop.example/order' },
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存店面' }));
  expect(saveShopStorefront).toHaveBeenCalled();
  expect(within(fieldGroup('店家網站')).queryByRole('alert')).toBeNull();
  expect(within(fieldGroup('外連訂餐網址')).queryByRole('alert')).toBeNull();
});

it('shows a NUL URL error under the website field', async () => {
  await mount();
  fireEvent.change(screen.getByLabelText('店家網站'), {
    target: { value: 'https://shop.example/order\u0000' },
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存店面' }));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(within(fieldGroup('店家網站')).getByRole('alert').textContent).toBe(
    '請貼 https:// 開頭的網址',
  );
});
