import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import LifePage from './page';

const selectedSchool = vi.hoisted(() => vi.fn());
const navigation = vi.hoisted(() => ({
  search: '',
  suspend: false,
}));

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: selectedSchool,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => {
    if (navigation.suspend) {
      throw new Promise(() => {});
    }
    return new URLSearchParams(navigation.search);
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  selectedSchool.mockReset();
  navigation.search = '';
  navigation.suspend = false;
});

it('線上點餐還沒開：生活頁不放「我的訂單」', () => {
  render(<LifePage />);
  expect(screen.queryByText('我的訂單')).toBeNull();
  expect(screen.queryByText('看訂單狀態和取餐號碼。')).toBeNull();
  expect(document.querySelector('a[href="/orders"]')).toBeNull();
  expect(screen.getByText('餐廳')).toBeTruthy();
});

it('線上點餐打開之後，生活頁再出現「我的訂單」', () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  render(<LifePage />);
  expect(screen.getByText('我的訂單')).toBeTruthy();
  expect(screen.getByText('看訂單狀態和取餐號碼。')).toBeTruthy();
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
  expect(screen.getAllByRole('link')).toHaveLength(7);
  expect(screen.getByRole('button', { name: '免登入' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.change(search, { target: { value: '教室' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /校園地圖/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
  expect(document.activeElement).toBe(search);
  expect(screen.getAllByRole('link')).toHaveLength(7);
  expect(screen.getByRole('button', { name: '免登入' }).getAttribute('aria-pressed')).toBe('true');
});

it('空結果可以恢復完整目錄，Escape 也可清除輸入', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '無此服務xyz' } });
  expect(screen.getByRole('heading', { name: '沒有找到符合的服務' })).toBeTruthy();
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.getByRole('status').textContent).toBe('找到 0 項服務');
  fireEvent.click(screen.getByRole('button', { name: '顯示全部服務' }));
  expect(screen.getAllByRole('link')).toHaveLength(12);
  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: '教室' } });
  fireEvent.keyDown(search, { key: 'Escape', isComposing: true });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(screen.getAllByRole('link')).toHaveLength(12);
});

it('搜尋不會繞過訂單開關，也不會將報修顯示為可使用服務', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '取餐' } });
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.queryByText('我的訂單')).toBeNull();
  fireEvent.change(search, { target: { value: '維修' } });
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.getByRole('complementary', { name: '報修 尚未開放' })).toBeTruthy();
  expect(screen.getByText('報修還沒開，有問題先找系辦或總務處。')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('找到 0 項服務，報修尚未開放');
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
  expect(screen.getByText('使用學校帳號，以同學給你的代號加好友。')).toBeTruthy();
});

it('失物招領說明指向學校帳號，不承諾 Google 可完成', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '失物' } });
  expect(screen.getByText('使用學校帳號登入後，查看或刊登遺失與拾獲物品。')).toBeTruthy();
  expect(screen.queryByText(/Google 帳號登入後，查看或刊登遺失/)).toBeNull();
  expect(screen.getByRole('link', { name: /失物招領/ }).getAttribute('href')).toBe('/lost-found');
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
        ({
          '/map': '校園地圖',
          '/library': '圖書館',
          '/school-info': '學校資訊',
          '/lost-found': '失物招領',
          '/friends': '找人',
          '/timetable': '共同空堂',
        } as Record<string, string>)[pathname],
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
    new URL(screen.getByRole('link', { name: /校園地圖/ }).getAttribute('href')!, 'https://campus.example')
      .searchParams.get('campus'),
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
  expect(screen.getByRole('status').textContent).toBe('共 12 項服務');
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
