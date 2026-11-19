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
  vi.restoreAllMocks();
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
  expect(screen.getByText('校內來源需使用學校帳號登入，查看或刊登遺失與拾獲物品。')).toBeTruthy();
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

it('未知分類與 access 不會藏掉全部服務，長網址搜尋最多保留 80 字', () => {
  navigation.search = 'group=admin&access=operator';
  render(<LifePage />);
  expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getAllByRole('link')).toHaveLength(7);
  cleanup();
  navigation.search = `q=${'借'.repeat(120)}`;
  render(<LifePage />);
  expect(
    (screen.getByRole('searchbox', { name: '快速找服務' }) as HTMLInputElement).value,
  ).toHaveLength(80);
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

it('搜尋與分類留在目前網址，保留校園與學期，但不滲入服務連結', () => {
  const state = { __NA: true, preserved: 'router-state' };
  window.history.replaceState(
    state,
    '',
    '/life?school=PU&schoolId=pu&campus=pu&term=115-1#services',
  );
  navigation.search = window.location.search;
  const replace = vi.spyOn(window.history, 'replaceState');
  const push = vi.spyOn(window.history, 'pushState');
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  search.focus();
  fireEvent.change(search, { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('button', { name: '免登入' }));

  const current = new URL(window.location.href);
  expect(current.pathname).toBe('/life');
  expect(current.hash).toBe('#services');
  expect(current.searchParams.get('q')).toBe('借書');
  expect(current.searchParams.get('category')).toBe('public');
  expect(current.searchParams.get('term')).toBe('115-1');
  expect(current.searchParams.get('schoolId')).toBe('pu');
  expect(replace).toHaveBeenCalledTimes(2);
  expect(replace.mock.calls.every(([data]) => data === null)).toBe(true);
  expect(push).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(search);

  const destination = new URL(
    screen.getByRole('link', { name: /圖書館/ }).getAttribute('href')!,
    window.location.href,
  );
  expect(destination.pathname).toBe('/library');
  expect(destination.searchParams.get('school')).toBe('PU');
  expect(destination.searchParams.get('schoolId')).toBe('pu');
  expect(destination.searchParams.get('campus')).toBe('pu');
  expect(destination.searchParams.has('q')).toBe(false);
  expect(destination.searchParams.has('category')).toBe(false);
});

it('重新開啟網址即可還原原本搜尋，返回與前進的參數更新也不搶焦點', () => {
  const first = render(<LifePage />);
  fireEvent.change(screen.getByRole('searchbox', { name: '快速找服務' }), {
    target: { value: '借書' },
  });
  fireEvent.click(screen.getByRole('button', { name: '免登入' }));
  const savedUrl = window.location.href;
  first.unmount();

  navigation.search = new URL(savedUrl).search;
  const restored = render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  expect((search as HTMLInputElement).value).toBe('借書');
  expect(screen.getByRole('button', { name: '免登入' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  const publicFilter = screen.getByRole('button', { name: '免登入' });
  publicFilter.focus();

  navigation.search = '?q=好友&category=community&campus=nthu';
  window.history.replaceState(window.history.state, '', `/life${navigation.search}`);
  restored.rerender(<LifePage />);
  expect((search as HTMLInputElement).value).toBe('好友');
  expect(screen.getByRole('button', { name: '交流與互助' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByRole('link', { name: /找人/ }).getAttribute('href')).toBe(
    '/friends?campus=nthu',
  );
  expect(document.activeElement).toBe(publicFilter);

  navigation.search = new URL(savedUrl).search;
  window.history.replaceState(window.history.state, '', savedUrl);
  restored.rerender(<LifePage />);
  expect((search as HTMLInputElement).value).toBe('借書');
  expect(screen.getByRole('button', { name: '免登入' }).getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).toBe(publicFilter);
});

it('網址中的分類只接受生活頁分類，過長查詢與控制字元會被安全限制', () => {
  navigation.search = `?q=${encodeURIComponent('\u0000' + '書'.repeat(100))}&category=admin`;
  window.history.replaceState(null, '', `/life${navigation.search}`);
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  expect((search as HTMLInputElement).value).toBe('書'.repeat(80));
  expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');

  fireEvent.click(screen.getByRole('button', { name: '回到生活總覽' }));
  const current = new URL(window.location.href);
  expect(current.searchParams.has('q')).toBe(false);
  expect(current.searchParams.has('category')).toBe(false);
  expect(screen.getAllByRole('link')).toHaveLength(7);
  expect(document.activeElement).toBe(search);
});

it('組字期間保留輸入與焦點，完成後才更新網址，Escape 不會刪除組字', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  const replace = vi.spyOn(window.history, 'replaceState');
  search.focus();
  fireEvent.compositionStart(search);
  fireEvent.change(search, { target: { value: '借' } });
  fireEvent.keyDown(search, { key: 'Escape' });
  expect((search as HTMLInputElement).value).toBe('借');
  expect(replace).not.toHaveBeenCalled();
  fireEvent.change(search, { target: { value: '  借書  ' } });
  fireEvent.compositionEnd(search);
  expect((search as HTMLInputElement).value).toBe('  借書  ');
  expect(new URL(window.location.href).searchParams.get('q')).toBe('  借書  ');
  expect(replace).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(document.activeElement).toBe(search);
});

it('較早的網址回報晚到時不覆蓋正在組字的草稿，完成後以最後輸入為準', () => {
  const view = render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  search.focus();
  fireEvent.change(search, { target: { value: '借' } });
  const firstUrl = window.location.search;
  fireEvent.change(search, { target: { value: '借書' } });
  const secondUrl = window.location.search;
  fireEvent.compositionStart(search);
  fireEvent.change(search, { target: { value: '借書館' } });

  // Next's transition can acknowledge earlier replaceState calls after the draft changed.
  navigation.search = firstUrl;
  view.rerender(<LifePage />);
  expect((search as HTMLInputElement).value).toBe('借書館');
  navigation.search = secondUrl;
  view.rerender(<LifePage />);
  expect((search as HTMLInputElement).value).toBe('借書館');
  expect(document.activeElement).toBe(search);

  fireEvent.compositionEnd(search);
  expect(new URL(window.location.href).searchParams.get('q')).toBe('借書館');
  navigation.search = window.location.search;
  view.rerender(<LifePage />);
  expect((search as HTMLInputElement).value).toBe('借書館');

  // Once acknowledged, an earlier URL is a genuine external change, not a pending echo.
  navigation.search = firstUrl;
  window.history.replaceState(null, '', `/life${firstUrl}`);
  view.rerender(<LifePage />);
  expect((search as HTMLInputElement).value).toBe('借');
});

it('真實返回會清除尚未回報的寫入，即使目的網址與待確認查詢相同', () => {
  const view = render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '借' } });
  fireEvent.compositionStart(search);
  fireEvent.change(search, { target: { value: '借書' } });
  expect((search as HTMLInputElement).value).toBe('借書');

  // Another history entry may carry the same URL as our pending replaceState.
  fireEvent.popState(window);
  expect((search as HTMLInputElement).value).toBe('借');
  navigation.search = window.location.search;
  view.rerender(<LifePage />);
  expect((search as HTMLInputElement).value).toBe('借');
});

it('組字期間收到真正的校園網址切換時，採用新校園的查詢與服務目的地', () => {
  const view = render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '借' } });
  fireEvent.compositionStart(search);
  fireEvent.change(search, { target: { value: '借書' } });

  navigation.search = '?q=搭車&category=public&campus=nchu&schoolId=nchu';
  window.history.replaceState(null, '', `/life${navigation.search}`);
  view.rerender(<LifePage />);
  expect((search as HTMLInputElement).value).toBe('搭車');
  expect(screen.getByRole('button', { name: '免登入' }).getAttribute('aria-pressed')).toBe('true');
  const destination = new URL(
    screen.getByRole('link', { name: /公車/ }).getAttribute('href')!,
    window.location.href,
  );
  expect(destination.searchParams.get('schoolId')).toBe('nchu');
  expect(destination.searchParams.get('campus')).toBe('nchu');
  expect(destination.searchParams.has('q')).toBe(false);
});

it('瀏覽器拒絕更新網址時仍能搜尋與清除', () => {
  render(<LifePage />);
  vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
    throw new DOMException('History unavailable', 'SecurityError');
  });
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '借書' } });
  expect((search as HTMLInputElement).value).toBe('借書');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
  expect((search as HTMLInputElement).value).toBe('');
  expect(screen.getAllByRole('link')).toHaveLength(7);
});

it('線上點餐還沒開：生活頁不放「我的訂單」，但仍有餐飲與課務入口', () => {
  render(<LifePage />);
  for (const button of screen.getAllByRole('button', { name: /^更多/ })) fireEvent.click(button);
  expect(screen.queryByText('我的訂單')).toBeNull();
  expect(screen.queryByText('看訂單狀態和取餐號碼。')).toBeNull();
  expect(document.querySelector('a[href="/orders"]')).toBeNull();
  expect(screen.getByText('餐廳')).toBeTruthy();
  expect(screen.getByRole('link', { name: /點餐與取餐/ }).getAttribute('href')).toBe('/food');
  expect(screen.getByText('餐飲入口；線上點餐開放前可先看餐廳菜單。')).toBeTruthy();
  expect(screen.getByRole('link', { name: /課程與作業/ }).getAttribute('href')).toBe('/classroom');
});

it('線上點餐打開之後，生活頁再出現「我的訂單」', () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  render(<LifePage />);
  for (const button of screen.getAllByRole('button', { name: /^更多/ })) fireEvent.click(button);
  expect(screen.getByText('App 餐廳訂單')).toBeTruthy();
  expect(screen.getByText('查看在 App 餐廳下的訂單、取餐號碼與店家接單進度')).toBeTruthy();
  expect(document.querySelector('a[href="/orders"]')).toBeTruthy();
});

it('可以用需求找服務，並接受全形英文與前後空白', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '借書' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /圖書館/ }).getAttribute('href')).toBe('/library');
  expect(screen.getByRole('status').textContent).toBe('找到 1 項服務');

  fireEvent.change(search, { target: { value: '  ＢＵＳ  ' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /公車/ }).getAttribute('href')).toBe('/bus');
});

it('分類與關鍵字共同篩選，清除搜尋會保留分類及輸入焦點', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.click(screen.getByRole('button', { name: '免登入' }));
  expect(screen.getAllByRole('link')).toHaveLength(11);
  expect(screen.getByRole('button', { name: '免登入' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.change(search, { target: { value: '教室' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /校園地圖/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
  expect(document.activeElement).toBe(search);
  expect(screen.getAllByRole('link')).toHaveLength(11);
  expect(screen.getByRole('button', { name: '免登入' }).getAttribute('aria-pressed')).toBe('true');
});

it('空結果可以恢復完整目錄，Escape 也可清除輸入', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '無此服務xyz' } });
  expect(screen.getByRole('heading', { name: '沒有找到符合的服務' })).toBeTruthy();
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.getByRole('status').textContent).toBe('找到 0 項服務');
  fireEvent.click(screen.getByRole('button', { name: '回到生活總覽' }));
  expect(screen.getAllByRole('link')).toHaveLength(7);
  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: '教室' } });
  fireEvent.keyDown(search, { key: 'Escape', isComposing: true });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(screen.getAllByRole('link')).toHaveLength(7);
});

it('搜尋不會繞過訂單開關，餐飲入口仍可搜到，並可直達個人宿舍工作區', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '取餐' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /點餐與取餐/ }).getAttribute('href')).toBe('/food');
  expect(screen.queryByText('我的訂單')).toBeNull();
  fireEvent.change(search, { target: { value: '維修' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /宿舍/ }).getAttribute('href')).toBe('/dormitory');
  expect(screen.getByRole('status').textContent).toBe('找到 1 項服務');
});

it('搜尋結果維持已選校園的連結參數與原有帳號需求', () => {
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'nthu' },
    loading: false,
    catalogStatus: 'ready',
  });
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '好友' } });
  const friendLink = screen.getByRole('link', { name: /找人/ });
  const href = new URL(friendLink.getAttribute('href')!, 'https://campus.example');
  expect(href.pathname).toBe('/friends');
  expect(href.searchParams.get('schoolId')).toBe('nthu');
  expect(href.searchParams.get('campus')).toBe('nthu');
  expect(href.searchParams.get('school')).toBe('NTHU');
  expect(screen.getByText('用找人代號加好友；對方開放分享後可查看課表')).toBeTruthy();
  expect(within(friendLink).getByText('學校帳號')).toBeTruthy();
});

it('失物招領沿用目錄的 Google 入口與帳號說明，不改變校內來源登入條件', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '失物' } });
  expect(screen.getByText('用 Google 帳號查看、刊登與管理失物')).toBeTruthy();
  expect(screen.getByText('校內來源需使用學校帳號登入，查看或刊登遺失與拾獲物品。')).toBeTruthy();
  expect(screen.getByText('Google 帳號')).toBeTruthy();
  expect(screen.queryByText(/Google 帳號登入後，查看或刊登遺失/)).toBeNull();
  expect(screen.getByRole('link', { name: /失物招領/ }).getAttribute('href')).toBe('/lost-found');
});

it('Google 公開交流可以直接被找到，保留校園且不要求學校登入', () => {
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'nthu' },
    loading: false,
    catalogStatus: 'ready',
  });
  render(<LifePage />);
  fireEvent.click(screen.getByRole('button', { name: '交流與互助' }));
  fireEvent.change(screen.getByRole('searchbox', { name: '快速找服務' }), {
    target: { value: 'Google' },
  });
  const link = screen.getByRole('link', { name: /跨校公開交流/ });
  const href = new URL(link.getAttribute('href')!, 'https://campus.example');
  expect(href.pathname).toBe('/social');
  expect(href.searchParams.get('campus')).toBe('nthu');
  expect(href.searchParams.get('schoolId')).toBe('nthu');
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(screen.getByText('使用 Google 帳號閱讀公開貼文，參與開放看板')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '免登入' }));
  expect(screen.queryByRole('link', { name: /跨校公開交流/ })).toBeNull();
});

it('學校資訊入口保留已選校園，並可被免登入搜尋找到', () => {
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'nthu' },
    loading: false,
    catalogStatus: 'ready',
  });
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '總機' } });
  const link = screen.getByRole('link', { name: /學校資訊/ });
  const href = new URL(link.getAttribute('href')!, 'https://campus.example');
  expect(href.pathname).toBe('/school-info');
  expect(href.searchParams.get('schoolId')).toBe('nthu');
  expect(href.searchParams.get('campus')).toBe('nthu');
});

it('目錄尚未就緒時立即沿用 URL 校園範圍，不沿用過期選定學校', () => {
  navigation.search = 'campus=nthu&school=PU&schoolId=pu';
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'pu', code: 'PU' },
    loading: true,
    catalogStatus: 'loading',
  });
  render(<LifePage />);
  for (const button of screen.getAllByRole('button', { name: /^更多/ })) fireEvent.click(button);
  const publicAndPrivate = [
    '/map',
    '/library',
    '/school-info',
    '/lost-found',
    '/friends',
    '/timetable',
  ];
  for (const pathname of publicAndPrivate) {
    const link = screen.getByRole('link', {
      name: new RegExp(
        (
          {
            '/map': '校園地圖',
            '/library': '圖書館',
            '/school-info': '學校資訊',
            '/lost-found': '失物招領',
            '/friends': '找人',
            '/timetable': '^課表 ',
          } as Record<string, string>
        )[pathname],
      ),
    });
    const href = new URL(link.getAttribute('href')!, 'https://campus.example');
    expect(href.pathname).toBe(pathname);
    expect([...href.searchParams.entries()]).toEqual([
      ['school', 'PU'],
      ['schoolId', 'pu'],
      ['campus', 'nthu'],
    ]);
  }
});

it('未就緒時只保留 school/schoolId/campus，並維持 URL 編碼且不傳播無關參數', () => {
  navigation.search =
    'school=PU%20Main&schoolId=nthu%2Fmain&campus=north%2Bgate&token=secret&returnUrl=%2Fadmin';
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
  expect(href.searchParams.get('school')).toBe('PU Main');
  expect(href.searchParams.get('schoolId')).toBe('nthu/main');
  expect(href.searchParams.get('campus')).toBe('north+gate');
  expect(href.searchParams.has('token')).toBe(false);
  expect(href.searchParams.has('returnUrl')).toBe(false);
  expect(href.search).toBe('?school=PU+Main&schoolId=nthu%2Fmain&campus=north%2Bgate');
});

it('未就緒時保留 campus=all 與未知校園查詢，不改寫成既有選定學校', () => {
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
  const unknown = new URL(
    screen.getByRole('link', { name: /圖書館/ }).getAttribute('href')!,
    'https://campus.example',
  );
  expect([...unknown.searchParams.entries()]).toEqual([
    ['school', '???'],
    ['campus', 'not-a-real-school'],
  ]);
  expect(unknown.searchParams.get('schoolId')).toBeNull();
});

it('目錄就緒後以 provider 選定為準，空選定則使用 campus=all', () => {
  navigation.search = 'campus=nthu&school=PU&schoolId=pu&token=x';
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'nthu' },
    loading: false,
    catalogStatus: 'ready',
  });
  render(<LifePage />);
  for (const button of screen.getAllByRole('button', { name: /^更多/ })) fireEvent.click(button);
  const ready = new URL(
    screen.getByRole('link', { name: /學校資訊/ }).getAttribute('href')!,
    'https://campus.example',
  );
  expect([...ready.searchParams.entries()]).toEqual([
    ['schoolId', 'nthu'],
    ['campus', 'nthu'],
    ['school', 'NTHU'],
  ]);
  cleanup();

  selectedSchool.mockReturnValue({
    selectedSchool: null,
    loading: false,
    catalogStatus: 'ready',
  });
  render(<LifePage />);
  const cleared = new URL(
    screen.getByRole('link', { name: /校園地圖/ }).getAttribute('href')!,
    'https://campus.example',
  );
  expect([...cleared.searchParams.entries()]).toEqual([['campus', 'all']]);
});

it('URL 校園參數不影響生活頁搜尋與分類狀態', () => {
  navigation.search = 'campus=nthu&school=NTHU&schoolId=nthu';
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'pu' },
    loading: true,
    catalogStatus: 'loading',
  });
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' }) as HTMLInputElement;
  expect(search.value).toBe('');
  expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('status').textContent).toBe('常用服務先顯示，其他服務可在各分類展開。');
  fireEvent.change(search, { target: { value: '公車' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /公車/ }).getAttribute('href')).toContain('campus=nthu');
});

it('無校園 URL 的載入路徑不發明預設學校', () => {
  navigation.search = '';
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'pu' },
    loading: true,
    catalogStatus: 'loading',
  });
  render(<LifePage />);
  for (const link of screen.getAllByRole('link')) {
    expect(link.getAttribute('href')).toMatch(/^\/[a-z-]+$/);
  }
});

it('Suspense 備援只顯示安全載入狀態，沒有錯誤範圍的可互動服務連結', () => {
  navigation.suspend = true;
  navigation.search = 'campus=nthu';
  render(<LifePage />);
  expect(screen.getByRole('status').textContent).toBe('正在載入生活服務…');
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.queryByText('校園地圖')).toBeNull();
  expect(screen.queryByText('圖書館')).toBeNull();
});

it('校園活動入口可被搜尋，並保留已選校園參數', () => {
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'nthu' },
    loading: false,
    catalogStatus: 'ready',
  });
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '講座' } });
  const link = screen.getByRole('link', { name: /校園活動/ });
  const href = new URL(link.getAttribute('href')!, 'https://campus.example');
  expect(href.pathname).toBe('/events');
  expect(href.searchParams.get('schoolId')).toBe('nthu');
  expect(href.searchParams.get('campus')).toBe('nthu');
});

it('職涯是生活頁的免登入入口，保留目前學校', () => {
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'pu' },
    loading: false,
    catalogStatus: 'ready',
  });
  render(<LifePage />);
  fireEvent.change(screen.getByRole('searchbox', { name: '快速找服務' }), {
    target: { value: '校內工讀' },
  });
  const href = new URL(
    screen.getByRole('link', { name: /職涯/ }).getAttribute('href')!,
    'https://nuni.tw',
  );
  expect(href.pathname).toBe('/career');
  expect(href.searchParams.get('schoolId')).toBe('pu');
});
