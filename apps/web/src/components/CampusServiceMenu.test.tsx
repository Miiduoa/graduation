import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CampusServiceMenu } from './CampusServiceMenu';
import { AppHeader } from './AppHeader';
import { CAMPUS_SERVICES } from '@/lib/campusServices';

const navigation = vi.hoisted(() => ({ pathname: '/map', search: '' }));
const auth = vi.hoisted(() => ({
  session: null as null | { platformAccountId: string; isPlatformOperator: boolean },
  loading: false,
  pendingLogout: false,
  logout: vi.fn(),
}));
const firebase = vi.hoisted(() => ({
  user: null as { uid: string } | null,
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
  useAuth: () => ({ user: firebase.user, signOutUser: vi.fn() }),
}));

const originalServices = [
  ['/announcements', '公告'],
  ['/timetable', '課表'],
  ['/appeals', '課程申訴'],
  ['/grades?tab=semester', '成績'],
  ['/credit-planner', '學分規劃'],
  ['/groups', '課程與群組'],
  ['/events', '校園活動'],
  ['/clubs', '社團活動'],
  ['/community', '校園交流'],
  ['/friends', '找人'],
  ['/messages', '通知'],
  ['/dms', '訊息'],
  ['/map', '校園地圖'],
  ['/bus', '公車'],
  ['/cafeteria', '餐廳'],
  ['/lost-found', '失物招領'],
  ['/dormitory', '宿舍'],
  ['/library', '圖書館'],
  ['/ai-assistant', '校園助理'],
  ['/support', '支援'],
  ['/account-deletion', '刪除帳號'],
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
  firebase.user = null;
});

it('retains all existing services and search while adding a separate classroom entry', () => {
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  for (const [href, label] of originalServices) {
    expect(
      screen.getByRole('link', { name: label === '成績' ? /^成績$/ : label }).getAttribute('href'),
    ).toBe(href);
  }
  expect(screen.getByRole('link', { name: /尋找校園服務/ }).getAttribute('href')).toBe('/search');
  expect(screen.getByRole('link', { name: '課程空間' }).getAttribute('href')).toBe('/classroom');
  expect(screen.getByRole('link', { name: '課業成績與回饋' }).getAttribute('href')).toBe(
    '/grades?tab=feedback',
  );
  expect(screen.queryByRole('link', { name: '跨校交流' })).toBeNull();
  expect(screen.queryByRole('link', { name: '職涯' })).toBeNull();
  expect(screen.getByRole('link', { name: '店家合作' }).getAttribute('href')).toBe('/merchant');
  expect(screen.getByRole('link', { name: '點餐與取餐' }).getAttribute('href')).toBe('/food');
  expect(screen.getByRole('link', { name: '學校資訊' }).getAttribute('href')).toBe('/school-info');
  expect(screen.getByText('目前還不能線上點餐')).toBeTruthy();
  expect(screen.queryByText('選餐點、查訂單、出示取餐憑證')).toBeNull();
  const routes = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
  expect(routes).toContain('/leave');
  expect(routes).toContain('/leave/review');
  expect(screen.getAllByRole('link')).toHaveLength(CAMPUS_SERVICES.length + 1);
});

it('preserves school context without copying unrelated session or return parameters', () => {
  navigation.search =
    'school=pu&schoolId=tw-pu&campus=other-campus&returnUrl=%2Fsettings&session=other';
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  for (const link of screen.getAllByRole('link')) {
    const target = new URL(link.getAttribute('href')!, 'https://campus.example');
    expect(target.searchParams.get('school')).toBe('pu');
    expect(target.searchParams.get('schoolId')).toBe('tw-pu');
    expect(target.searchParams.get('campus')).toBe('other-campus');
    expect(target.searchParams.has('returnUrl')).toBe(false);
    expect(target.searchParams.has('session')).toBe(false);
  }
  const feedback = new URL(
    screen.getByRole('link', { name: '課業成績與回饋' }).getAttribute('href')!,
    'https://campus.example',
  );
  expect(feedback.pathname).toBe('/grades');
  expect(feedback.searchParams.get('tab')).toBe('feedback');
});

it('sends a signed-in firebase user to profile from 我', () => {
  firebase.user = { uid: 'u1' };
  render(<AppHeader />);
  expect(screen.getByRole('link', { name: '我' }).getAttribute('href')).toBe('/profile');
});

it('sends a signed-in nuni student to profile from 我 instead of login', () => {
  auth.session = { platformAccountId: 'a', isPlatformOperator: false };
  render(<AppHeader />);
  expect(screen.getByRole('link', { name: '我' }).getAttribute('href')).toBe('/profile');
});

it('keeps 我 on login when neither firebase nor nuni session is present', () => {
  render(<AppHeader />);
  expect(screen.getByRole('link', { name: '我' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Fprofile',
  );
});

it('routes the Nuni account to its courses and hides operator links during revalidation', () => {
  auth.session = { platformAccountId: 'a', isPlatformOperator: true };
  const view = render(<AppHeader />);
  expect(screen.getByRole('link', { name: '課務' }).getAttribute('href')).toBe('/timetable');
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

it('marks the feedback tab instead of the general grade service and keeps campus context', () => {
  navigation.pathname = '/grades';
  navigation.search = 'tab=feedback&campus=nthu';
  const view = render(<CampusServiceMenu />);
  screen.getByText('所有服務').closest('details')!.open = true;
  const feedback = screen.getByRole('link', { name: '課業成績與回饋' });
  expect(feedback.getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: /^成績$/ }).getAttribute('aria-current')).toBeNull();
  const destination = new URL(feedback.getAttribute('href')!, 'https://campus.example');
  expect(destination.searchParams.get('tab')).toBe('feedback');
  expect(destination.searchParams.get('campus')).toBe('nthu');
  navigation.search = 'tab=semester&campus=nthu';
  view.rerender(<CampusServiceMenu />);
  expect(screen.getByRole('link', { name: /^成績$/ }).getAttribute('aria-current')).toBe('page');
  expect(feedback.getAttribute('aria-current')).toBeNull();
  const semester = new URL(
    screen.getByRole('link', { name: /^成績$/ }).getAttribute('href')!,
    'https://campus.example',
  );
  expect(semester.searchParams.get('tab')).toBe('semester');
  expect(semester.searchParams.get('campus')).toBe('nthu');
  navigation.search = 'campus=nthu';
  view.rerender(<CampusServiceMenu />);
  expect(screen.getByRole('link', { name: /^成績$/ }).getAttribute('aria-current')).toBeNull();
  expect(feedback.getAttribute('aria-current')).toBeNull();
});

it('keeps the Campus One header and original school login around the complete shared menu', () => {
  navigation.search = 'schoolId=tw-pu';
  render(<AppHeader />);
  fireEvent.click(screen.getByText('所有服務'));
  for (const [, label] of originalServices)
    expect(screen.getByRole('link', { name: label === '成績' ? /^成績$/ : label })).toBeTruthy();
  expect(screen.getByRole('link', { name: '課程空間' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '登入' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Fmap%3FschoolId%3Dtw-pu',
  );
  expect(screen.getByRole('link', { name: '今天' }).getAttribute('href')).toBe('/?schoolId=tw-pu');
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

it('does not stack the school course hash when the header 登入 link is used', () => {
  navigation.pathname = '/course/cs101';
  window.history.replaceState({}, '', '/course/cs101#assignment-hw-3#assignment-hw-3');
  render(<AppHeader />);
  const login = screen.getByRole('link', { name: '登入' });
  expect(login.getAttribute('href')).toBe('/login?returnUrl=%2Fcourse%2Fcs101%23assignment-hw-3#');
  const assign = vi.fn();
  vi.stubGlobal('location', {
    ...window.location,
    pathname: '/course/cs101',
    search: '',
    hash: '#assignment-hw-3#assignment-hw-3',
    assign,
  });
  try {
    fireEvent.click(login);
    expect(assign).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/login?returnUrl=%2Fcourse%2Fcs101%23assignment-hw-3#');
    expect(String(assign.mock.calls[0][0]).includes('#assignment-hw-3#assignment-hw-3')).toBe(
      false,
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it('closes on Escape and returns keyboard focus to the service control', () => {
  render(<CampusServiceMenu />);
  const summary = screen.getByText('所有服務').closest('summary')!;
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
  fireEvent.blur(menu, { relatedTarget: screen.getByRole('button', { name: '下一個控制項' }) });
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

it('marks 生活 active for campus event list and detail without replacing 社團活動', () => {
  navigation.pathname = '/events';
  const { rerender } = render(<AppHeader />);
  expect(screen.getByRole('link', { name: '生活' }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(screen.getByText('所有服務'));
  expect(screen.getByRole('link', { name: '校園活動' }).getAttribute('href')).toBe('/events');
  expect(screen.getByRole('link', { name: '社團活動' }).getAttribute('href')).toBe('/clubs');
  navigation.pathname = '/events/talk-1';
  navigation.search = 'schoolId=nthu&source=school-club-events';
  rerender(<AppHeader />);
  expect(screen.getByRole('link', { name: '生活' }).getAttribute('aria-current')).toBe('page');
});

it('selects only the specific account service and closes its overview link on the current page', () => {
  navigation.pathname = '/classroom/account';
  const view = render(<CampusServiceMenu />);
  screen.getByText('所有服務').closest('details')!.open = true;
  expect(screen.getByRole('link', { name: '學校資格' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: '課程空間' }).getAttribute('aria-current')).toBeNull();
  navigation.pathname = '/search';
  view.rerender(<CampusServiceMenu />);
  const menu = screen.getByText('所有服務').closest('details')!;
  menu.open = true;
  fireEvent.click(screen.getByRole('link', { name: /尋找校園服務/ }));
  expect(menu.open).toBe(false);
});

it('closes from the touch control and restores focus to the service disclosure', () => {
  render(<CampusServiceMenu />);
  const summary = screen.getByText('所有服務').closest('summary')!;
  const menu = summary.closest('details')!;
  menu.open = true;
  expect(summary.getAttribute('aria-label')).toBe('所有服務');
  fireEvent.click(screen.getByRole('button', { name: '關閉所有服務' }));
  expect(menu.open).toBe(false);
  expect(document.activeElement).toBe(summary);
});

it('finds a service in place, keeps its school context, and resets an empty filtered result', () => {
  navigation.search = 'schoolId=nthu&campus=nthu&returnUrl=%2Fsettings';
  render(<CampusServiceMenu />);
  screen.getByText('所有服務').closest('details')!.open = true;
  const search = screen.getByRole('searchbox', { name: '搜尋服務' });
  fireEvent.change(search, { target: { value: '借書' } });
  expect(screen.getByRole('link', { name: '圖書館' }).getAttribute('href')).toBe(
    '/library?schoolId=nthu&campus=nthu',
  );
  expect(screen.getByRole('status').textContent).toBe('找到 1 項服務');
  expect(screen.queryByRole('link', { name: '課表' })).toBeNull();
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('link', { name: '圖書館' }));
  fireEvent.click(screen.getByRole('button', { name: '篩選學習與課務' }));
  expect(screen.getByRole('heading', { name: '沒有符合的服務' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看全部服務' }));
  expect((search as HTMLInputElement).value).toBe('');
  expect(document.activeElement).toBe(search);
  expect(screen.getByRole('link', { name: '課表' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '圖書館' })).toBeTruthy();
});

it('opens service search with the keyboard shortcut without taking over text editing or a dialog', () => {
  render(
    <>
      <CampusServiceMenu />
      <textarea aria-label="作業草稿" />
      <dialog open aria-label="正在編輯的視窗">
        <button>儲存</button>
      </dialog>
    </>,
  );
  const menu = screen.getByText('所有服務').closest('details')!;
  fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
  expect(menu.open).toBe(false);
  screen.getByRole('dialog').removeAttribute('open');
  fireEvent.keyDown(screen.getByRole('textbox', { name: '作業草稿' }), { key: 'k', ctrlKey: true });
  expect(menu.open).toBe(false);
  fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
  expect(menu.open).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜尋服務' }));
});

it.each([
  ['/cafeteria/restaurant-1', '生活'],
  ['/bus/registered', '生活'],
  ['/library', '生活'],
  ['/grades', '課務'],
  ['/credit-planner', '課務'],
  ['/classroom/grades', '課務'],
  ['/settings', '我'],
  ['/classroom/account', '我'],
  ['/orders/order-1', '生活'],
  ['/school-info', '生活'],
])('shows the parent section for %s', (pathname, label) => {
  navigation.pathname = pathname;
  render(<AppHeader />);
  expect(screen.getByRole('link', { name: label }).getAttribute('aria-current')).toBe('page');
  const main = screen.getByRole('navigation', { name: '主要導覽' });
  expect(main.querySelectorAll(':scope > a[aria-current="page"]')).toHaveLength(1);
});

it('marks the service directory as 更多 without assigning it to another section', () => {
  navigation.pathname = '/search';
  render(<AppHeader />);
  expect(screen.getByText('所有服務').closest('summary')!.getAttribute('aria-current')).toBe(
    'page',
  );
  expect(
    screen
      .getByRole('navigation', { name: '主要導覽' })
      .querySelectorAll(':scope > a[aria-current="page"]'),
  ).toHaveLength(0);
});

it('clears a completed search immediately before a route change can remove the disclosure', () => {
  const view = render(<CampusServiceMenu />);
  screen.getByText('所有服務').closest('details')!.open = true;
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋服務' }), {
    target: { value: '借書' },
  });
  fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
  navigation.pathname = '/library';
  view.rerender(<CampusServiceMenu />);
  screen.getByText('所有服務').closest('details')!.open = true;
  expect((screen.getByRole('searchbox', { name: '搜尋服務' }) as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('link', { name: '課表' })).toBeTruthy();
});


it('opens a keyboard-dismissible voice AI entry without leaving the current service', () => {
  const view = render(<AppHeader />);
  fireEvent.click(view.getByRole('button', { name: '開啟校園語音 AI' }));
  const dialog = view.getByRole('dialog', { name: '校園語音與 AI 快速操作' });
  expect(dialog).toBeTruthy();
  expect(view.getByRole('heading', { name: '說出想做的事，直接找到入口。' })).toBeTruthy();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(view.queryByRole('dialog')).toBeNull();
});
