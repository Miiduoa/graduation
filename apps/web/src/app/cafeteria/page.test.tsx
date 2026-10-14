import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CafeteriaPage from './page';
import { fetchCafeteriaCatalog } from '@/lib/cafeteriaCatalog';
import {
  UNVERIFIED_CAFETERIA_BADGE,
  UNVERIFIED_CAFETERIA_NOTICE,
} from '@campus/shared/src/cafeteriaCatalog';

const state = vi.hoisted(() => ({
  school: 'pu',
  catalog: {
    cafeterias: [] as Array<Record<string, unknown>>,
    menus: [] as Array<Record<string, unknown>>,
  },
  fail: false,
}));

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('@/lib/pageContext', () => ({
  resolveSchoolPageContext: () => ({
    schoolId: state.school,
    schoolName: state.school,
    schoolSearch: `?schoolId=${state.school}`,
  }),
}));
vi.mock('@/lib/cafeteriaCatalog', () => ({
  fetchCafeteriaCatalog: vi.fn(async () => {
    if (state.fail) throw new Error('offline');
    return state.catalog;
  }),
}));

beforeEach(() => {
  state.school = 'pu';
  state.fail = false;
  state.catalog = { cafeterias: [], menus: [] };
  vi.mocked(fetchCafeteriaCatalog).mockClear();
});
afterEach(cleanup);

async function receive(rows?: {
  cafeterias?: Array<Record<string, unknown>>;
  menus?: Array<Record<string, unknown>>;
}) {
  if (rows) state.catalog = { cafeterias: rows.cafeterias ?? [], menus: rows.menus ?? [] };
  await act(async () => {
    render(<CafeteriaPage />);
  });
}

it('shows a brandless payment disclaimer on the restaurant list', async () => {
  await receive({
    cafeterias: [{ id: 'stall', name: '校內咖啡店', reviewStatus: 'verified' }],
    menus: [],
  });
  expect(
    screen.getByText(/價格、是否賣完、是否接單以店家訂餐頁為準，付款與退款由店家處理。/),
  ).toBeTruthy();
  expect(screen.queryByText(/Nuni|nuni/)).toBeNull();
  expect(
    screen.queryByText('價格、是否賣完、是否接單以店家訂餐頁為準。Nuni 不處理這筆的付款與退款。'),
  ).toBeNull();
});

it('reads restaurants from the backend catalog and hides sample copy', async () => {
  await receive({
    cafeterias: [{ id: 'stall', name: '校內咖啡店', reviewStatus: 'verified' }],
    menus: [
      {
        id: 'meal',
        cafeteriaId: 'stall',
        cafeteria: '校內咖啡店',
        name: '蔬菜吐司',
        price: 60,
        availableOn: '2026-10-08',
        available: true,
      },
    ],
  });
  expect(await screen.findByText('蔬菜吐司')).toBeTruthy();
  expect(screen.getByText('NT$60')).toBeTruthy();
  expect(screen.queryByText(/示範資料/)).toBeNull();
  expect(fetchCafeteriaCatalog).toHaveBeenCalledWith('pu');
});

it('shows a retry when the backend catalog fails and does not keep old rows after school change', async () => {
  state.fail = true;
  await act(async () => {
    render(<CafeteriaPage />);
  });
  expect(screen.getByRole('alert').textContent).toContain('暫時讀不到資料，請稍後再試');
  expect(screen.getByRole('alert').textContent).not.toContain('請確認網路後再試');
  expect(screen.queryByText(/示範資料/)).toBeNull();
  state.fail = false;
  state.catalog = {
    cafeterias: [{ id: 'stall', name: '校內咖啡店', reviewStatus: 'verified' }],
    menus: [
      {
        id: 'meal',
        cafeteriaId: 'stall',
        cafeteria: '校內咖啡店',
        name: '蔬菜吐司',
        price: 60,
        availableOn: '2026-10-08',
        available: true,
      },
    ],
  };
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  expect(await screen.findByText('蔬菜吐司')).toBeTruthy();
});

it('keeps the offline copy when the device has no network', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  state.fail = true;
  await act(async () => {
    render(<CafeteriaPage />);
  });
  expect(screen.getByRole('alert').textContent).toContain('請確認網路後再試');
  expect(screen.getByRole('alert').textContent).not.toContain('暫時讀不到資料，請稍後再試');
  expect(screen.getByRole('button', { name: '重新整理' })).toBeTruthy();
  online.mockRestore();
});

it('uses an honest empty state when this school has no restaurants', async () => {
  await receive({ cafeterias: [], menus: [] });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('這間學校的餐廳還沒上架')).toBeTruthy();
  expect(screen.queryByText('目前沒有餐廳資料')).toBeNull();
  expect(screen.queryByText(/示範資料/)).toBeNull();
});

it('marks unverified and demo shops beside the shop name and leaves verified unmarked', async () => {
  await receive({
    cafeterias: [
      { id: 'cafe-1', name: '校園小棧', reviewStatus: 'demo', location: '活動中心' },
      { id: 'stall', name: '校內咖啡店', reviewStatus: 'unverified', location: '學生餐廳' },
      { id: 'jingyuan', name: '靜園餐廳', reviewStatus: 'verified', location: '文興樓對面' },
      { id: 'louisa', name: '路易莎咖啡', location: '圖書館' },
    ],
    menus: [],
  });
  const demo = within(screen.getByRole('region', { name: '校園小棧' }));
  expect(demo.getByText('示範')).toBeTruthy();
  expect(demo.queryByText(UNVERIFIED_CAFETERIA_BADGE)).toBeNull();
  const unverified = within(screen.getByRole('region', { name: '校內咖啡店' }));
  expect(unverified.getByText(UNVERIFIED_CAFETERIA_BADGE)).toBeTruthy();
  expect(unverified.queryByText('示範')).toBeNull();
  const missing = within(screen.getByRole('region', { name: '路易莎咖啡' }));
  expect(missing.getByText(UNVERIFIED_CAFETERIA_BADGE)).toBeTruthy();
  const verified = within(screen.getByRole('region', { name: '靜園餐廳' }));
  expect(verified.queryByText('示範')).toBeNull();
  expect(verified.queryByText(UNVERIFIED_CAFETERIA_BADGE)).toBeNull();
  expect(screen.queryByText('這是示範店家，菜單和價格不是真的，不能點餐。')).toBeNull();
  expect(screen.queryByText(UNVERIFIED_CAFETERIA_NOTICE)).toBeNull();
});

it('distinguishes unknown availability, paused supply and sold-out meals without claiming ordering is available', async () => {
  await receive({
    cafeterias: [{ id: 'stall', name: '校內咖啡店', orderingEnabled: true, pilotStatus: 'live' }],
    menus: [
      { id: 'unknown', cafeteriaId: 'stall', name: '未知供應餐點' },
      { id: 'paused', cafeteriaId: 'stall', name: '暫停餐點', available: false },
      { id: 'sold-out', cafeteriaId: 'stall', name: '售完餐點', available: true, soldOut: true },
      { id: 'available', cafeteriaId: 'stall', name: '現有餐點', available: true },
    ],
  });
  const restaurant = within(screen.getByRole('region', { name: '校內咖啡店' }));
  expect(restaurant.getByText('4 道餐點 · 1 道標記供應中')).toBeTruthy();
  expect(restaurant.getByText('供應狀態未確認')).toBeTruthy();
  expect(restaurant.getByText('暫停供應')).toBeTruthy();
  expect(restaurant.getByText('已售完')).toBeTruthy();
  expect(restaurant.getAllByText('供應中')).toHaveLength(1);
  expect(screen.getByText(/目前還不能線上點餐/)).toBeTruthy();
  expect(screen.queryByText('可點餐餐廳')).toBeNull();
  expect(screen.getByRole('link', { name: '進入店面' }).getAttribute('href')).toContain(
    '/cafeteria/stall',
  );
});

it('shows an outbound order link only when the shop has an https ordering URL', async () => {
  await receive({
    cafeterias: [
      {
        id: 'linked',
        name: '外連店',
        merchantMode: 'showcase_link',
        orderingUrl: 'https://shop.example/order',
        location: '學生餐廳',
        openingHours: '11:00–14:00',
      },
      {
        id: 'info',
        name: '只看資訊',
        merchantMode: 'showcase_link',
        location: '活動中心',
        openingHours: '週一到週五',
      },
    ],
    menus: [],
  });
  const linked = within(screen.getByRole('region', { name: '外連店' }));
  expect(linked.getByRole('link', { name: '到店家網站訂餐' }).getAttribute('href')).toContain(
    '/cafeteria/linked/order',
  );
  expect(linked.queryByRole('link', { name: /點餐|下單/ })).toBeNull();
  const info = within(screen.getByRole('region', { name: '只看資訊' }));
  expect(info.queryByRole('link', { name: '到店家網站訂餐' })).toBeNull();
  expect(info.getByText('位置：活動中心')).toBeTruthy();
  expect(info.getByText('營業時間：週一到週五')).toBeTruthy();
});

it('exposes the selected restaurant and restores menus when clearing an empty search', async () => {
  await receive({
    cafeterias: [{ id: 'stall', name: '校內咖啡店' }],
    menus: [
      {
        id: 'meal',
        cafeteriaId: 'stall',
        cafeteria: '校內咖啡店',
        name: '蔬菜吐司',
        price: 60,
        availableOn: '2026-10-08',
        available: true,
      },
    ],
  });
  fireEvent.click(screen.getByRole('button', { name: '校內咖啡店' }));
  expect(screen.getByRole('button', { name: '校內咖啡店' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋餐點或餐廳' }), {
    target: { value: '不存在的餐點' },
  });
  expect(screen.queryByText('蔬菜吐司')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  expect(screen.getByText('蔬菜吐司')).toBeTruthy();
  expect(screen.getByRole('button', { name: '全部餐廳' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
});

it('clears loaded menus after changing school and does not keep the previous school catalog', async () => {
  state.catalog = {
    cafeterias: [{ id: 'stall', name: '校內咖啡店' }],
    menus: [
      {
        id: 'meal',
        cafeteriaId: 'stall',
        cafeteria: '校內咖啡店',
        name: '蔬菜吐司',
        price: 60,
        availableOn: '2026-10-08',
        available: true,
      },
    ],
  };
  const view = await act(async () => render(<CafeteriaPage />));
  expect(await screen.findByText('蔬菜吐司')).toBeTruthy();
  state.school = 'cgu';
  state.catalog = { cafeterias: [], menus: [] };
  await act(async () => {
    view.rerender(<CafeteriaPage />);
  });
  expect(await screen.findByText('這間學校的餐廳還沒上架')).toBeTruthy();
  expect(screen.queryByText('蔬菜吐司')).toBeNull();
  expect(fetchCafeteriaCatalog).toHaveBeenCalledWith('cgu');
});
