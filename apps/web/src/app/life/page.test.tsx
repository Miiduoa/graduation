import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LifePage from './page';

const selectedSchool = vi.hoisted(() => vi.fn());
const navigation = vi.hoisted(() => ({ search: '', suspend: false }));

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: selectedSchool,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => {
    if (navigation.suspend) throw new Promise(() => {});
    return new URLSearchParams(navigation.search);
  },
}));

beforeEach(() => {
  selectedSchool.mockReturnValue(null);
  window.history.replaceState({}, '', '/life');
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  selectedSchool.mockReset();
  navigation.search = '';
  navigation.suspend = false;
});

it('生活只列日常服務，課務、交流與學生證有自己的分類', () => {
  render(<LifePage />);
  for (const name of ['出門與交通', '吃飯與住宿', '校園資源']) {
    expect(screen.getByRole('heading', { name })).toBeTruthy();
  }
  expect(screen.queryByRole('link', { name: '跨校公開交流' })).toBeNull();
  expect(screen.queryByRole('link', { name: '校園交流' })).toBeNull();
  expect(screen.queryByRole('link', { name: '課程與作業' })).toBeNull();
  expect(screen.queryByRole('link', { name: '數位學生證' })).toBeNull();
  expect(screen.getByRole('link', { name: '宿舍' }).getAttribute('href')).toBe('/dormitory');
  expect(screen.getByRole('link', { name: '校園活動' }).getAttribute('href')).toBe('/events');
  expect(screen.getByRole('status').textContent).toBe('共 10 項服務');
});

it('點餐未開時隱藏訂單；餐廳收在同一主入口內，且不誤稱免登入點餐', () => {
  render(<LifePage />);
  const food = screen.getByRole('link', { name: '點餐與取餐' });
  expect(food.getAttribute('href')).toBe('/food');
  expect(within(food).getByText('目前還不能線上點餐')).toBeTruthy();
  expect(within(food).getByText('Google 帳號')).toBeTruthy();
  expect(document.querySelector('a[href="/orders"]')).toBeNull();
  expect(screen.queryByRole('heading', { name: '餐廳' })).toBeNull();
  fireEvent.click(screen.getByLabelText('點餐與取餐的其他入口'));
  expect(screen.getByRole('link', { name: '餐廳' }).getAttribute('href')).toBe('/cafeteria');
});

it('點餐開啟後可由同一主入口展開餐廳訂單，搜尋也能直達', () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  render(<LifePage />);
  const secondary = screen.getByRole('link', { name: 'App 餐廳訂單' }).closest('details');
  expect(secondary?.open).toBe(false);
  fireEvent.click(screen.getByLabelText('點餐與取餐的其他入口'));
  expect(secondary?.open).toBe(true);
  expect(screen.getByRole('link', { name: 'App 餐廳訂單' }).getAttribute('href')).toBe('/orders');
  fireEvent.change(screen.getByRole('searchbox', { name: '快速找服務' }), {
    target: { value: '訂單紀錄' },
  });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'App 餐廳訂單' }).getAttribute('href')).toBe('/orders');
});

it('可以用需求找服務，並接受全形英文與前後空白', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '借書' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: '圖書館' }).getAttribute('href')).toBe('/library');
  expect(screen.getByRole('status').textContent).toBe('找到 1 項服務');
  fireEvent.change(search, { target: { value: '  ＢＵＳ  ' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: '公車' }).getAttribute('href')).toBe('/bus');
});

it('分類與搜尋共同篩選，清除搜尋保留分類及輸入焦點', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.click(screen.getByRole('button', { name: '出門與交通' }));
  expect(screen.getAllByRole('link')).toHaveLength(2);
  fireEvent.change(search, { target: { value: '地點' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: '校園地圖' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
  expect(document.activeElement).toBe(search);
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(screen.getByRole('button', { name: '出門與交通' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
});

it('空結果可回完整目錄；中文輸入組字時 Escape 不清掉搜尋', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '無此服務xyz' } });
  expect(screen.getByRole('heading', { name: '沒有找到符合的服務' })).toBeTruthy();
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '顯示全部服務' }));
  expect(screen.getByRole('status').textContent).toBe('共 10 項服務');
  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: '借書' } });
  fireEvent.keyDown(search, { key: 'Escape', isComposing: true });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(screen.getByRole('status').textContent).toBe('共 10 項服務');
});

it('搜尋不繞過點餐開關，仍可找到菜單與個人宿舍備忘', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '訂單紀錄' } });
  expect(document.querySelector('a[href="/orders"]')).toBeNull();
  fireEvent.change(search, { target: { value: '菜單' } });
  expect(screen.getByRole('link', { name: '餐廳' }).getAttribute('href')).toBe('/cafeteria');
  fireEvent.change(search, { target: { value: '維修' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: '宿舍' }).getAttribute('href')).toBe('/dormitory');
  expect(screen.getByText('可直接使用，資料保存在這台裝置')).toBeTruthy();
});

it('失物招領的帳號說明與主服務目錄一致，不再寫成只能用學校帳號', () => {
  render(<LifePage />);
  fireEvent.change(screen.getByRole('searchbox', { name: '快速找服務' }), {
    target: { value: '失物' },
  });
  const link = screen.getByRole('link', { name: '失物招領' });
  expect(link.getAttribute('href')).toBe('/lost-found');
  expect(within(link).getByText('Google 帳號')).toBeTruthy();
  expect(within(link).getByText('用 Google 帳號查看、刊登與管理失物')).toBeTruthy();
});

it('搜尋連結保留已選校園，篩選字詞不會傳到目的地', () => {
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'nthu' },
    loading: false,
    catalogStatus: 'ready',
  });
  render(<LifePage />);
  fireEvent.change(screen.getByRole('searchbox', { name: '快速找服務' }), {
    target: { value: '講座' },
  });
  const href = new URL(
    screen.getByRole('link', { name: '校園活動' }).getAttribute('href')!,
    'https://campus.example',
  );
  expect(href.pathname).toBe('/events');
  expect([...href.searchParams.entries()]).toEqual([
    ['schoolId', 'nthu'],
    ['campus', 'nthu'],
    ['school', 'NTHU'],
  ]);
  expect(href.searchParams.has('q')).toBe(false);
  expect(href.searchParams.has('group')).toBe(false);
});

it('目錄未就緒時沿用 URL 校園，不採用過期選校', () => {
  navigation.search = 'campus=nthu&school=PU&schoolId=pu';
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'pu', code: 'PU' },
    loading: true,
    catalogStatus: 'loading',
  });
  render(<LifePage />);
  for (const name of ['校園地圖', '圖書館', '學校資訊', '失物招領', '校園活動']) {
    const href = new URL(
      screen.getByRole('link', { name }).getAttribute('href')!,
      'https://campus.example',
    );
    expect([...href.searchParams.entries()]).toEqual([
      ['school', 'PU'],
      ['schoolId', 'pu'],
      ['campus', 'nthu'],
    ]);
  }
});

it('未就緒時只帶校園參數且保留編碼，不傳播 token 或 returnUrl', () => {
  navigation.search =
    'school=PU%20Main&schoolId=nthu%2Fmain&campus=north%2Bgate&token=secret&returnUrl=%2Fadmin';
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'pu' },
    loading: false,
    catalogStatus: 'loading',
  });
  render(<LifePage />);
  const href = new URL(
    screen.getByRole('link', { name: '圖書館' }).getAttribute('href')!,
    'https://campus.example',
  );
  expect(href.search).toBe('?school=PU+Main&schoolId=nthu%2Fmain&campus=north%2Bgate');
});

it('全校與未知校園查詢不被改寫成舊學校', () => {
  navigation.search = 'campus=all';
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'pu', code: 'PU' },
    loading: true,
    catalogStatus: 'loading',
  });
  const view = render(<LifePage />);
  expect(screen.getByRole('link', { name: '校園地圖' }).getAttribute('href')).toBe(
    '/map?campus=all',
  );
  navigation.search = 'campus=not-a-real-school&school=???';
  view.rerender(<LifePage />);
  const href = new URL(
    screen.getByRole('link', { name: '圖書館' }).getAttribute('href')!,
    'https://campus.example',
  );
  expect([...href.searchParams.entries()]).toEqual([
    ['school', '???'],
    ['campus', 'not-a-real-school'],
  ]);
});

it('目錄就緒後採用 provider；清除選校使用 campus=all', () => {
  navigation.search = 'campus=nthu&school=PU&schoolId=pu&token=x';
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'nthu' },
    loading: false,
    catalogStatus: 'ready',
  });
  const view = render(<LifePage />);
  let href = new URL(
    screen.getByRole('link', { name: '學校資訊' }).getAttribute('href')!,
    'https://campus.example',
  );
  expect([...href.searchParams.entries()]).toEqual([
    ['schoolId', 'nthu'],
    ['campus', 'nthu'],
    ['school', 'NTHU'],
  ]);
  selectedSchool.mockReturnValue({ selectedSchool: null, loading: false, catalogStatus: 'ready' });
  view.rerender(<LifePage />);
  href = new URL(
    screen.getByRole('link', { name: '校園地圖' }).getAttribute('href')!,
    'https://campus.example',
  );
  expect([...href.searchParams.entries()]).toEqual([['campus', 'all']]);
});

it('搜尋與任務分類寫進目前網址，保留校園與錨點', () => {
  window.history.replaceState({ keep: true }, '', '/life?campus=nthu#services');
  navigation.search = 'campus=nthu';
  render(<LifePage />);
  fireEvent.click(screen.getByRole('button', { name: '出門與交通' }));
  fireEvent.change(screen.getByRole('searchbox', { name: '快速找服務' }), {
    target: { value: '公車' },
  });
  const url = new URL(window.location.href);
  expect(url.pathname).toBe('/life');
  expect(url.searchParams.get('campus')).toBe('nthu');
  expect(url.searchParams.get('q')).toBe('公車');
  expect(url.searchParams.get('group')).toBe('travel');
  expect(url.hash).toBe('#services');
  expect(window.history.state).toEqual({ keep: true });
});

it('重新開啟或瀏覽器返回時從網址恢復搜尋，不殘留另一個條件', () => {
  navigation.search = 'campus=nthu&q=公車&group=travel';
  const view = render(<LifePage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('公車');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('button', { name: '出門與交通' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  navigation.search = 'campus=nthu&q=借書&group=resources';
  view.rerender(<LifePage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  expect(screen.getByRole('link', { name: '圖書館' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: '公車' })).toBeNull();
});

it('無法改寫 history 時，搜尋仍可操作', () => {
  render(<LifePage />);
  vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
    throw new DOMException('blocked');
  });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  expect(screen.getByRole('link', { name: '圖書館' })).toBeTruthy();
  expect(screen.getAllByRole('link')).toHaveLength(1);
});

it('無校園網址的載入路徑不發明預設學校', () => {
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'pu' },
    loading: true,
    catalogStatus: 'loading',
  });
  render(<LifePage />);
  for (const link of screen.getAllByRole('link'))
    expect(link.getAttribute('href')).toMatch(/^\/[a-z-]+$/);
});

it('Suspense 備援沒有錯誤範圍的可互動連結', () => {
  navigation.suspend = true;
  navigation.search = 'campus=nthu';
  render(<LifePage />);
  expect(screen.getByRole('status').textContent).toBe('正在載入生活服務…');
  expect(screen.queryAllByRole('link')).toHaveLength(0);
});

it('校園資源可以找到免登入職涯頁，搜尋保留學校且不轉送無關參數', () => {
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'pu' },
    loading: false,
    catalogStatus: 'ready',
  });
  navigation.search = 'campus=pu&token=private';
  render(<LifePage />);
  fireEvent.click(screen.getByRole('button', { name: '校園資源' }));
  fireEvent.change(screen.getByRole('searchbox', { name: '快速找服務' }), {
    target: { value: '校內工讀' },
  });
  const link = screen.getByRole('link', { name: '職涯' });
  expect(within(link).getByText('可直接瀏覽')).toBeTruthy();
  const href = new URL(link.getAttribute('href')!, 'https://nuni.tw');
  expect(href.pathname).toBe('/career');
  expect(href.searchParams.get('schoolId')).toBe('pu');
  expect(href.searchParams.get('campus')).toBe('pu');
  expect(href.searchParams.has('token')).toBe(false);
  expect(href.searchParams.has('q')).toBe(false);
  expect(screen.getAllByRole('link')).toHaveLength(1);
});
