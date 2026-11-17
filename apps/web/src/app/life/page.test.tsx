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
  selectedSchool.mockReset();
  navigation.search = '';
  navigation.suspend = false;
});

const searchServices = (query: string) =>
  fireEvent.change(screen.getByRole('searchbox', { name: '快速找服務' }), {
    target: { value: query },
  });

it('生活總覽先顯示七個常用服務與四個任務分類，其他入口可逐層展開', () => {
  render(<LifePage />);
  expect(screen.getAllByRole('link')).toHaveLength(7);
  for (const title of ['出門與交通', '吃飯與取餐', '住宿與日常', '安排課餘時間']) {
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
  }
  expect(screen.queryByRole('link', { name: /學校資訊/ })).toBeNull();
  const toggle = screen.getByRole('button', { name: /更多交通與地點服務/ });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('link', { name: /學校資訊/ }).getAttribute('href')).toBe('/school-info');
  fireEvent.click(toggle);
  expect(screen.queryByRole('link', { name: /學校資訊/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /課程與作業|共同空堂/ })).toBeNull();
});

it('點餐關閉時先提供餐廳菜單，展開仍可查看餐飲入口說明但沒有訂單入口', () => {
  render(<LifePage />);
  const food = screen.getByRole('region', { name: '吃飯與取餐' });
  expect(within(food).getByRole('link', { name: /餐廳/ }).getAttribute('href')).toBe('/cafeteria');
  expect(within(food).queryByRole('link', { name: /點餐與取餐/ })).toBeNull();
  fireEvent.click(within(food).getByRole('button', { name: /更多餐飲服務/ }));
  expect(
    within(food)
      .getByRole('link', { name: /點餐與取餐/ })
      .getAttribute('href'),
  ).toBe('/food');
  expect(document.querySelector('a[href="/orders"]')).toBeNull();
});

it('點餐開放後主入口接到點餐，展開提供餐廳與 App 餐廳訂單且沿用同一說明', () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  render(<LifePage />);
  const food = screen.getByRole('region', { name: '吃飯與取餐' });
  expect(
    within(food)
      .getByRole('link', { name: /點餐與取餐/ })
      .getAttribute('href'),
  ).toBe('/food');
  expect(within(food).queryByRole('link', { name: /App 餐廳訂單/ })).toBeNull();
  fireEvent.click(within(food).getByRole('button', { name: /更多餐飲服務/ }));
  expect(
    within(food)
      .getByRole('link', { name: /App 餐廳訂單/ })
      .getAttribute('href'),
  ).toBe('/orders');
  expect(within(food).getByText('查看在 App 餐廳下的訂單、取餐號碼與店家接單進度')).toBeTruthy();
});

it('需求搜尋涵蓋收合服務，接受全形英文與前後空白', () => {
  render(<LifePage />);
  searchServices('借書');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /圖書館/ }).getAttribute('href')).toBe('/library');
  expect(screen.getByRole('status').textContent).toBe('找到 1 項服務');
  searchServices('  ＢＵＳ  ');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /公車/ }).getAttribute('href')).toBe('/bus');
  searchServices('總機');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /學校資訊/ }).getAttribute('href')).toBe('/school-info');
});

it('任務分類、免登入與關鍵字可一起篩選，清除搜尋保留分類與輸入焦點', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.click(screen.getByRole('button', { name: '交通與地點' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '只看免登入服務' }));
  expect(screen.getAllByRole('link')).toHaveLength(3);
  searchServices('教室');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /校園地圖/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
  expect(document.activeElement).toBe(search);
  expect(screen.getAllByRole('link')).toHaveLength(3);
  expect(screen.getByRole('button', { name: '交通與地點' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(
    (screen.getByRole('checkbox', { name: '只看免登入服務' }) as HTMLInputElement).checked,
  ).toBe(true);
});

it('免登入篩選包含可直接使用的本機服務，仍排除需要 Google 的入口', () => {
  render(<LifePage />);
  fireEvent.click(screen.getByRole('checkbox', { name: '只看免登入服務' }));
  expect(screen.getByRole('link', { name: /圖書館/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /校園地圖/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /宿舍/ })).toBeTruthy();
  expect(screen.getByText('可直接使用，資料保存在這台裝置')).toBeTruthy();
  expect(screen.queryByRole('link', { name: /失物招領|跨校公開交流/ })).toBeNull();
});

it('空結果可回到總覽，Escape 清除輸入但不打斷中文輸入法', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  searchServices('無此服務xyz');
  expect(screen.getByRole('heading', { name: '沒有找到符合的服務' })).toBeTruthy();
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.getByRole('status').textContent).toBe('找到 0 項服務');
  fireEvent.click(screen.getByRole('button', { name: '回到生活總覽' }));
  expect(screen.getAllByRole('link')).toHaveLength(7);
  expect(document.activeElement).toBe(search);
  searchServices('教室');
  fireEvent.keyDown(search, { key: 'Escape', isComposing: true });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(screen.getAllByRole('link')).toHaveLength(7);
});

it('搜尋不能繞過訂單開關，亦可直達宿舍工作區', () => {
  render(<LifePage />);
  searchServices('取餐');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /點餐與取餐/ }).getAttribute('href')).toBe('/food');
  expect(document.querySelector('a[href="/orders"]')).toBeNull();
  searchServices('維修');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /宿舍/ }).getAttribute('href')).toBe('/dormitory');
});

it('失物招領與全站目錄一致使用 Google 帳號說明', () => {
  render(<LifePage />);
  searchServices('失物');
  expect(screen.getByText('用 Google 帳號查看、刊登與管理失物')).toBeTruthy();
  expect(screen.getByText('Google 帳號')).toBeTruthy();
  expect(screen.queryByText('使用學校帳號登入後，查看或刊登遺失與拾獲物品。')).toBeNull();
  expect(screen.getByRole('link', { name: /失物招領/ }).getAttribute('href')).toBe('/lost-found');
});

it('好友搜尋保留清華校園與原有學校帳號需求', () => {
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'nthu' },
    loading: false,
    catalogStatus: 'ready',
  });
  render(<LifePage />);
  searchServices('好友');
  const href = new URL(
    screen.getByRole('link', { name: /找人/ }).getAttribute('href')!,
    'https://campus.example',
  );
  expect(href.pathname).toBe('/friends');
  expect(href.searchParams.get('schoolId')).toBe('nthu');
  expect(href.searchParams.get('campus')).toBe('nthu');
  expect(href.searchParams.get('school')).toBe('NTHU');
  expect(screen.getByText('學校帳號')).toBeTruthy();
});

it('Google 公開交流可直接查找，保留校園且不錯放入免登入結果', () => {
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'nthu' },
    loading: false,
    catalogStatus: 'ready',
  });
  render(<LifePage />);
  fireEvent.click(screen.getByRole('button', { name: '活動與交流' }));
  searchServices('Google');
  const href = new URL(
    screen.getByRole('link', { name: /跨校公開交流/ }).getAttribute('href')!,
    'https://campus.example',
  );
  expect(href.pathname).toBe('/social');
  expect(href.searchParams.get('campus')).toBe('nthu');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  fireEvent.click(screen.getByRole('checkbox', { name: '只看免登入服務' }));
  expect(screen.queryByRole('link', { name: /跨校公開交流/ })).toBeNull();
});

it('目錄尚未就緒時沿用 URL 校園，不使用過期 provider 選定，也涵蓋展開的服務', () => {
  navigation.search = 'campus=nthu&school=PU&schoolId=pu';
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'pu', code: 'PU' },
    loading: true,
    catalogStatus: 'loading',
  });
  render(<LifePage />);
  for (const button of screen.getAllByRole('button', { name: /^更多/ })) fireEvent.click(button);
  for (const name of ['校園地圖', '圖書館', '學校資訊', '失物招領', '找人']) {
    const href = new URL(
      screen.getByRole('link', { name: new RegExp(name) }).getAttribute('href')!,
      'https://campus.example',
    );
    expect([...href.searchParams.entries()]).toEqual([
      ['school', 'PU'],
      ['schoolId', 'pu'],
      ['campus', 'nthu'],
    ]);
  }
});

it('服務連結只帶校園參數，不傳播搜尋、分類、token 或 returnUrl', () => {
  navigation.search =
    'school=PU%20Main&schoolId=nthu%2Fmain&campus=north%2Bgate&token=secret&returnUrl=%2Fadmin&q=借書&group=daily';
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'pu' },
    loading: false,
    catalogStatus: 'loading',
  });
  render(<LifePage />);
  const href = new URL(
    screen.getByRole('link', { name: /圖書館/ }).getAttribute('href')!,
    'https://campus.example',
  );
  expect(href.pathname).toBe('/library');
  expect([...href.searchParams.entries()]).toEqual([
    ['school', 'PU Main'],
    ['schoolId', 'nthu/main'],
    ['campus', 'north+gate'],
  ]);
  expect(href.search).toBe('?school=PU+Main&schoolId=nthu%2Fmain&campus=north%2Bgate');
});

it('未就緒時保留 campus=all 與未知校園，不改寫成既有選定', () => {
  navigation.search = 'campus=all';
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'pu', code: 'PU' },
    loading: true,
    catalogStatus: 'loading',
  });
  render(<LifePage />);
  expect(
    new URL(
      screen.getByRole('link', { name: /校園地圖/ }).getAttribute('href')!,
      'https://campus.example',
    ).searchParams.get('campus'),
  ).toBe('all');
  cleanup();
  navigation.search = 'campus=not-a-real-school&school=???';
  render(<LifePage />);
  const href = new URL(
    screen.getByRole('link', { name: /圖書館/ }).getAttribute('href')!,
    'https://campus.example',
  );
  expect([...href.searchParams.entries()]).toEqual([
    ['school', '???'],
    ['campus', 'not-a-real-school'],
  ]);
});

it('目錄就緒後以 provider 選定為準，空選定則使用全部校園', () => {
  navigation.search = 'campus=pu&school=PU&schoolId=pu&token=x';
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'nthu' },
    loading: false,
    catalogStatus: 'ready',
  });
  render(<LifePage />);
  const href = new URL(
    screen.getByRole('link', { name: /校園地圖/ }).getAttribute('href')!,
    'https://campus.example',
  );
  expect([...href.searchParams.entries()]).toEqual([
    ['schoolId', 'nthu'],
    ['campus', 'nthu'],
    ['school', 'NTHU'],
  ]);
  cleanup();
  selectedSchool.mockReturnValue({ selectedSchool: null, loading: false, catalogStatus: 'ready' });
  render(<LifePage />);
  expect(
    new URL(
      screen.getByRole('link', { name: /校園地圖/ }).getAttribute('href')!,
      'https://campus.example',
    ).search,
  ).toBe('?campus=all');
});

it('書籤與返回 URL 可恢復搜尋、任務分類及免登入選擇', () => {
  navigation.search = 'campus=nthu&q=借書&group=daily&access=public';
  render(<LifePage />);
  expect((screen.getByRole('searchbox', { name: '快速找服務' }) as HTMLInputElement).value).toBe(
    '借書',
  );
  expect(screen.getByRole('button', { name: '日常' }).getAttribute('aria-pressed')).toBe('true');
  expect(
    (screen.getByRole('checkbox', { name: '只看免登入服務' }) as HTMLInputElement).checked,
  ).toBe(true);
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /圖書館/ }).getAttribute('href')).toContain(
    'campus=nthu',
  );
});

it('操作篩選以 replaceState 儲存在目前 URL，返回時重新讀取且不帶到目的地', () => {
  window.history.replaceState({}, '', '/life?campus=nthu');
  navigation.search = 'campus=nthu';
  const view = render(<LifePage />);
  const length = window.history.length;
  fireEvent.click(screen.getByRole('button', { name: '交通與地點' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '只看免登入服務' }));
  searchServices('公車');
  const current = new URL(window.location.href);
  expect(current.searchParams.get('q')).toBe('公車');
  expect(current.searchParams.get('group')).toBe('travel');
  expect(current.searchParams.get('access')).toBe('public');
  expect(current.searchParams.get('campus')).toBe('nthu');
  expect(window.history.length).toBe(length);
  expect(screen.getByRole('link', { name: /公車/ }).getAttribute('href')).toBe('/bus?campus=nthu');
  navigation.search = 'campus=nthu&q=借書&group=daily';
  view.rerender(<LifePage />);
  expect((screen.getByRole('searchbox', { name: '快速找服務' }) as HTMLInputElement).value).toBe(
    '借書',
  );
  expect(screen.getByRole('link', { name: /圖書館/ })).toBeTruthy();
  expect(
    (screen.getByRole('checkbox', { name: '只看免登入服務' }) as HTMLInputElement).checked,
  ).toBe(false);
});

it('總覽展開狀態寫入目前 URL，進入服務後返回仍看得到原分類內容', () => {
  window.history.replaceState({}, '', '/life?campus=nthu');
  navigation.search = 'campus=nthu';
  render(<LifePage />);
  fireEvent.click(screen.getByRole('button', { name: /更多日常服務/ }));
  expect(new URL(window.location.href).searchParams.get('expanded')).toBe('daily');
  expect(screen.getByRole('link', { name: /失物招領/ })).toBeTruthy();
  const returnedQuery = window.location.search.slice(1);
  cleanup();
  navigation.search = `${returnedQuery},unknown,travel,daily`;
  render(<LifePage />);
  expect(screen.getByRole('button', { name: /收合日常服務/ }).getAttribute('aria-expanded')).toBe(
    'true',
  );
  expect(
    screen.getByRole('button', { name: /收合交通與地點服務/ }).getAttribute('aria-expanded'),
  ).toBe('true');
  const href = screen.getByRole('link', { name: /失物招領/ }).getAttribute('href')!;
  expect(href).toBe('/lost-found?campus=nthu');
  expect(screen.getByRole('link', { name: /學校資訊/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /收合日常服務/ }));
  fireEvent.click(screen.getByRole('button', { name: /收合交通與地點服務/ }));
  expect(new URL(window.location.href).searchParams.has('expanded')).toBe(false);
  expect(screen.getAllByRole('link')).toHaveLength(7);
});

it('未知分類與 access 不會藏掉全部服務，長網址搜尋最多保留 100 字', () => {
  navigation.search = 'group=admin&access=operator';
  render(<LifePage />);
  expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getAllByRole('link')).toHaveLength(7);
  cleanup();
  navigation.search = `q=${'借'.repeat(120)}`;
  render(<LifePage />);
  expect(
    (screen.getByRole('searchbox', { name: '快速找服務' }) as HTMLInputElement).value,
  ).toHaveLength(100);
});

it('沒有校園 URL 的載入路徑不發明預設學校', () => {
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'pu' },
    loading: true,
    catalogStatus: 'loading',
  });
  render(<LifePage />);
  for (const link of screen.getAllByRole('link'))
    expect(link.getAttribute('href')).toMatch(/^\/[a-z-]+$/);
});

it('Suspense 備援只有安全載入狀態，不顯示錯誤範圍的服務連結', () => {
  navigation.suspend = true;
  navigation.search = 'campus=nthu';
  render(<LifePage />);
  expect(screen.getByRole('status').textContent).toBe('正在載入生活服務…');
  expect(screen.queryAllByRole('link')).toHaveLength(0);
});

it('校園活動與職涯可從同一生活目錄搜尋，保留目前校園', () => {
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'pu' },
    loading: false,
    catalogStatus: 'ready',
  });
  render(<LifePage />);
  searchServices('講座');
  expect(screen.getByRole('link', { name: /校園活動/ }).getAttribute('href')).toContain(
    'schoolId=pu',
  );
  searchServices('校內工讀');
  const href = new URL(
    screen.getByRole('link', { name: /職涯/ }).getAttribute('href')!,
    'https://nuni.tw',
  );
  expect(href.pathname).toBe('/career');
  expect(href.searchParams.get('schoolId')).toBe('pu');
});
