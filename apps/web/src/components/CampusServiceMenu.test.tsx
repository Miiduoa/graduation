import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CampusServiceMenu } from './CampusServiceMenu';
import { AppHeader } from './AppHeader';

const navigation = vi.hoisted(() => ({ pathname: '/map', search: '' }));
const auth = vi.hoisted(() => ({
  session: null as null | { platformAccountId: string; isPlatformOperator: boolean },
  loading: false,
  pendingLogout: false,
  logout: vi.fn(),
}));
vi.mock('./SchoolSelector', () => ({ SchoolSelector: () => null }));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => auth,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({ user: null, signOutUser: vi.fn() }),
}));

const originalServices = [
  ['/announcements', '公告'],
  ['/timetable', '課表'],
  ['/grades', '成績'],
  ['/credit-planner', '學分規劃'],
  ['/groups', '課程與群組'],
  ['/clubs', '社團活動'],
  ['/community', '校園交流'],
  ['/messages', '通知'],
  ['/dms', '私訊'],
  ['/map', '校園地圖'],
  ['/bus', '公車'],
  ['/cafeteria', '餐廳'],
  ['/library', '圖書館'],
  ['/ai-assistant', '校園助理'],
  ['/profile', '個人資料'],
  ['/settings', '設定'],
];

beforeEach(() => {
  navigation.pathname = '/map';
  navigation.search = '';
  window.history.replaceState({}, '', '/map');
  auth.session = null;
  auth.loading = false;
  auth.pendingLogout = false;
});

it('retains all existing services and search while adding a separate classroom entry', () => {
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  for (const [href, label] of originalServices) {
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(href);
  }
  expect(screen.getByRole('link', { name: /尋找校園服務/ }).getAttribute('href')).toBe('/search');
  expect(screen.getByRole('link', { name: '課程空間' }).getAttribute('href')).toBe('/classroom');
  expect(screen.getByRole('link', { name: '跨校交流' }).getAttribute('href')).toBe('/social');
  expect(screen.getByRole('link', { name: '店家合作' }).getAttribute('href')).toBe('/merchant');
  expect(screen.getAllByRole('link')).toHaveLength(20);
});

it('preserves school context without copying unrelated session or return parameters', () => {
  navigation.search =
    'school=pu&schoolId=tw-pu&campus=other-campus&returnUrl=%2Fsettings&session=other';
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  for (const link of screen.getAllByRole('link')) {
    const target = new URL(link.getAttribute('href')!, 'https://campus.example');
    expect([...target.searchParams.entries()]).toEqual([
      ['school', 'pu'],
      ['schoolId', 'tw-pu'],
      ['campus', 'other-campus'],
    ]);
  }
});

it('routes the Nuni account to its courses and hides operator links during revalidation', () => {
  auth.session = { platformAccountId: 'a', isPlatformOperator: true };
  const view = render(<AppHeader />);
  expect(screen.getByRole('link', { name: '課程' }).getAttribute('href')).toBe('/classroom');
  expect(screen.getByRole('link', { name: '我的帳號' }).getAttribute('href')).toBe('/profile');
  expect(screen.getByRole('link', { name: '平台管理' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: '登入' })).toBeNull();
  auth.loading = true;
  view.rerender(<AppHeader />);
  expect(screen.queryByRole('link', { name: '平台管理' })).toBeNull();
  expect(screen.queryByRole('link', { name: '我的帳號' })).toBeNull();
});

it('marks classroom children as part of the added service without selecting existing groups', () => {
  navigation.pathname = '/classroom/course/cw_11111111-1111-4111-8111-111111111111';
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  expect(screen.getByRole('link', { name: '課程空間' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: '課程與群組' }).getAttribute('aria-current')).toBeNull();
});

it('keeps the Campus One header and original school login around the complete shared menu', () => {
  navigation.search = 'schoolId=tw-pu';
  render(<AppHeader />);
  fireEvent.click(screen.getByText('所有服務'));
  for (const [, label] of originalServices)
    expect(screen.getByRole('link', { name: label })).toBeTruthy();
  expect(screen.getByRole('link', { name: '課程空間' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '登入' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Fmap%3FschoolId%3Dtw-pu',
  );
  expect(screen.getByRole('link', { name: '今日' }).getAttribute('href')).toBe('/?schoolId=tw-pu');
});

it.each(['/login', '/classroom/login', '/admin/login'])(
  'does not offer a second guest login from %s that would replace the existing destination',
  (pathname) => {
    navigation.pathname = pathname;
    navigation.search = 'returnUrl=%2Fadmin&issue=cancelled';
    render(<AppHeader />);
    expect(screen.queryByRole('link', { name: '登入' })).toBeNull();
    expect(screen.getByRole('navigation', { name: '主要導覽' })).toBeTruthy();
  },
);

it('keeps the linked course assignment and query when using the header login', () => {
  navigation.pathname = '/classroom/course/cw_11111111-1111-4111-8111-111111111111';
  navigation.search = 'view=assignments';
  const destination = `${navigation.pathname}?${navigation.search}#assignment-cwa_22222222-2222-4222-8222-222222222222`;
  window.history.replaceState({}, '', destination);
  render(<AppHeader />);
  const login = screen.getByRole('link', { name: '登入' }) as HTMLAnchorElement;
  expect(new URL(login.href).pathname).toBe('/login');
  expect(new URL(login.href).searchParams.get('returnUrl')).toBe(destination);

  const nextDestination = `${navigation.pathname}?${navigation.search}#assignment-cwa_33333333-3333-4333-8333-333333333333`;
  act(() => {
    window.history.replaceState({}, '', nextDestination);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(new URL(login.href).searchParams.get('returnUrl')).toBe(nextDestination);
});

it('closes on Escape and returns keyboard focus to the service control', () => {
  render(<CampusServiceMenu />);
  const summary = screen.getByText('所有服務');
  const menu = summary.closest('details')!;
  menu.open = true;
  const link = screen.getByRole('link', { name: '課表' });
  link.focus();
  fireEvent.keyDown(link, { key: 'Escape' });
  expect(menu.open).toBe(false);
  expect(document.activeElement).toBe(summary);
});

it('closes on outside interaction without dismissing interactions within the menu', () => {
  render(<CampusServiceMenu />);
  const menu = screen.getByText('所有服務').closest('details')!;
  menu.open = true;
  fireEvent.pointerDown(screen.getByRole('heading', { name: '學習與課務' }));
  expect(menu.open).toBe(true);
  fireEvent.pointerDown(document.body);
  expect(menu.open).toBe(false);
});

it('closes after choosing the current service and when keyboard focus leaves', () => {
  render(
    <>
      <CampusServiceMenu />
      <button type="button">下一個控制項</button>
    </>,
  );
  const menu = screen.getByText('所有服務').closest('details')!;
  menu.open = true;
  fireEvent.click(screen.getByRole('link', { name: '校園地圖' }));
  expect(menu.open).toBe(false);
  menu.open = true;
  fireEvent.blur(menu, { relatedTarget: screen.getByRole('button') });
  expect(menu.open).toBe(false);
});

it('identifies a nested service without selecting a route with only a matching prefix', () => {
  navigation.pathname = '/announcements/a1';
  const { rerender } = render(<CampusServiceMenu />);
  screen.getByText('所有服務').closest('details')!.open = true;
  expect(screen.getByRole('link', { name: '公告' }).getAttribute('aria-current')).toBe('page');
  navigation.pathname = '/announcements-old';
  rerender(<CampusServiceMenu />);
  screen.getByText('所有服務').closest('details')!.open = true;
  expect(screen.getByRole('link', { name: '公告' }).getAttribute('aria-current')).toBeNull();
});
