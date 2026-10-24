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
  sessionStorage.clear();
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
  expect(screen.getByRole('alert').textContent).toContain(
    '服務暫時停止，我們正在處理，請稍後再來。',
  );
  expect(screen.getByRole('alert').textContent).not.toContain('請確認網路後再試');
  expect(screen.queryByRole('button', { name: '重新整理' })).toBeNull();
  expect(screen.queryByText(/示範資料/)).toBeNull();
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

it('hides availability marks on unverified and demo menus', async () => {
  await receive({
    cafeterias: [
      { id: 'stall', name: '校內咖啡店', reviewStatus: 'unverified' },
      { id: 'cafe-1', name: '校園小棧', reviewStatus: 'demo' },
    ],
    menus: [
      { id: 'sold-out', cafeteriaId: 'stall', name: '售完餐點', available: true, soldOut: true },
      { id: 'available', cafeteriaId: 'stall', name: '現有餐點', available: true },
      { id: 'demo-sold', cafeteriaId: 'cafe-1', name: '示範售完', available: true, soldOut: true },
    ],
  });
  const unverified = within(screen.getByRole('region', { name: '校內咖啡店' }));
  expect(unverified.getByText('2 道餐點')).toBeTruthy();
  expect(unverified.queryByText(/標記供應中/)).toBeNull();
  expect(unverified.queryByText('供應中')).toBeNull();
  expect(unverified.queryByText('已售完')).toBeNull();
  const demo = within(screen.getByRole('region', { name: '校園小棧' }));
  expect(demo.queryByText('已售完')).toBeNull();
  expect(demo.queryByText('供應中')).toBeNull();
  expect(screen.queryByText(/標記為售完/)).toBeNull();
});

it('distinguishes unknown availability, paused supply and sold-out meals without claiming ordering is available', async () => {
  await receive({
    cafeterias: [
      {
        id: 'stall',
        name: '校內咖啡店',
        orderingEnabled: true,
        pilotStatus: 'live',
        reviewStatus: 'verified',
      },
    ],
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
  expect(restaurant.queryByText('現有餐點')).toBeNull();
  fireEvent.click(restaurant.getByRole('button', { name: '再看 1 道餐點' }));
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

it('restores menus and budget when clearing an empty search', async () => {
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
  fireEvent.change(screen.getByRole('combobox', { name: '餐點預算' }), {
    target: { value: '100' },
  });
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋餐點或餐廳' }), {
    target: { value: '不存在的餐點' },
  });
  expect(screen.queryByText('蔬菜吐司')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  expect(screen.getByText('蔬菜吐司')).toBeTruthy();
  expect((screen.getByRole('combobox', { name: '餐點預算' }) as HTMLSelectElement).value).toBe(
    'all',
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

it('searches restaurant locations and dish descriptions without case or full-width differences', async () => {
  await receive({
    cafeterias: [
      { id: 'cafe', name: 'Campus Cafe', location: '圖書館 2F' },
      { id: 'noodles', name: '麵店', location: '學生餐廳' },
    ],
    menus: [
      { id: 'tea', cafeteriaId: 'cafe', name: '紅茶', description: 'Earl Grey', price: 40 },
      { id: 'coffee', cafeteriaId: 'cafe', name: '咖啡', price: 60 },
    ],
  });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ＣＡＭＰＵＳ grey' } });
  expect(screen.getByText('紅茶')).toBeTruthy();
  expect(screen.queryByText('咖啡')).toBeNull();
  expect(screen.queryByRole('region', { name: '麵店' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '學生餐廳' } });
  expect(screen.getByRole('region', { name: '麵店' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Campus Cafe' })).toBeNull();
});

it('combines category and budget and never counts unknown prices as affordable', async () => {
  await receive({
    cafeterias: [
      { id: 'stall', name: '午餐店' },
      { id: 'empty', name: '未提供菜單的店' },
    ],
    menus: [
      { id: 'rice', cafeteriaId: 'stall', name: '蔬菜飯', category: '主食', price: 80 },
      { id: 'set', cafeteriaId: 'stall', name: '午餐套餐', category: '主食', price: 160 },
      { id: 'unknown', cafeteriaId: 'stall', name: '今日特餐', category: '主食' },
      { id: 'tea', cafeteriaId: 'stall', name: '紅茶', category: '飲料', price: 30 },
    ],
  });
  fireEvent.click(screen.getByRole('button', { name: '主食' }));
  fireEvent.change(screen.getByRole('combobox', { name: '餐點預算' }), {
    target: { value: '100' },
  });
  expect(screen.getByText('蔬菜飯')).toBeTruthy();
  expect(screen.queryByText('午餐套餐')).toBeNull();
  expect(screen.queryByText('今日特餐')).toBeNull();
  expect(screen.queryByText('紅茶')).toBeNull();
  expect(screen.queryByRole('region', { name: '未提供菜單的店' })).toBeNull();
  expect(screen.getByText('1 間 · 1 道符合餐點')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  expect(screen.getByRole('region', { name: '未提供菜單的店' })).toBeTruthy();
});

it('keeps search and budget on return but uses separate preferences for each school', async () => {
  state.catalog = {
    cafeterias: [{ id: 'stall', name: '早餐店' }],
    menus: [{ id: 'meal', cafeteriaId: 'stall', name: '吐司', price: 50 }],
  };
  const first = await act(async () => render(<CafeteriaPage />));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '吐司' } });
  fireEvent.change(screen.getByRole('combobox', { name: '餐點預算' }), {
    target: { value: '100' },
  });
  first.unmount();
  const returned = await act(async () => render(<CafeteriaPage />));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('吐司');
  expect((screen.getByRole('combobox', { name: '餐點預算' }) as HTMLSelectElement).value).toBe(
    '100',
  );
  state.school = 'other';
  state.catalog = { cafeterias: [], menus: [] };
  await act(async () => returned.rerender(<CafeteriaPage />));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('combobox', { name: '餐點預算' }) as HTMLSelectElement).value).toBe(
    'all',
  );
  expect(screen.queryByText('吐司')).toBeNull();
});

it('sorts known prices first, keeps schools on links and does not expand every menu', async () => {
  await receive({
    cafeterias: [
      { id: 'unknown', name: 'A 店' },
      { id: 'priced', name: 'B 店' },
    ],
    menus: [
      { id: 'm0', cafeteriaId: 'unknown', name: '特餐' },
      ...[120, 40, 80, 90].map((price, index) => ({
        id: `m${index + 1}`,
        cafeteriaId: 'priced',
        name: `餐點${index}`,
        price,
      })),
    ],
  });
  fireEvent.change(screen.getByRole('combobox', { name: '排序' }), { target: { value: 'price' } });
  const cards = screen
    .getAllByRole('region')
    .filter((node) => ['A 店', 'B 店'].includes(node.getAttribute('aria-label') || ''));
  expect(cards.map((node) => node.getAttribute('aria-label'))).toEqual(['B 店', 'A 店']);
  const priced = within(cards[0]);
  expect(priced.queryByText('餐點0')).toBeNull();
  expect(priced.getByRole('link', { name: '進入店面' }).getAttribute('href')).toBe(
    '/cafeteria/priced?schoolId=pu',
  );
  fireEvent.click(priced.getByRole('button', { name: '再看 1 道餐點' }));
  expect(priced.getByText('餐點0')).toBeTruthy();
  fireEvent.click(priced.getByRole('button', { name: '收起餐點' }));
  expect(priced.queryByText('餐點0')).toBeNull();
});
