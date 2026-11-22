import { SchoolLmsReadonlyProvider } from '@/components/SchoolLmsReadonlyProvider';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CampusServiceMenu } from './CampusServiceMenu';
import { AppHeader } from './AppHeader';
import { visibleCampusServices } from '@/lib/campusServices';
import { MENU_RETURN_STATE_KEY, setMenuReturnScope } from '@/lib/menuNavigationReturn';
import { NuniSessionProvider, useOptionalNuniSession } from '@/features/nuni/Session';

const navigation = vi.hoisted(() => ({ pathname: '/map', search: '' }));
const selection = vi.hoisted(() => ({
  current: null as null | {
    loading: boolean;
    catalogStatus: 'loading' | 'ready' | 'error';
    selectedSchool: { id: string; name: string } | null;
  },
}));
vi.mock('./SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => selection.current,
}));
const auth = vi.hoisted(() => ({
  session: null as null | {
    platformAccountId: string;
    isPlatformOperator: boolean;
    context?: string;
  },
  loading: false,
  error: '',
  pendingLogout: false,
  logout: vi.fn(),
  useProvider: false,
}));
const firebase = vi.hoisted(() => ({
  user: null as { uid: string } | null,
  error: null as Error | null,
}));
vi.mock('./SchoolSelector', () => ({ SchoolSelector: () => null }));
vi.mock('@/features/nuni/Session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/nuni/Session')>();
  return {
    ...actual,
    useNuniSession: () => auth,
    useOptionalNuniSession: () => {
      const session = actual.useOptionalNuniSession();
      return auth.useProvider ? session : auth;
    },
  };
});
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({ user: firebase.user, error: firebase.error, signOutUser: vi.fn() }),
}));

// jsdom exposes descendants of closed <details> in role queries; check native disclosure state.
function expandedLinks() {
  return screen.getAllByRole('link').filter((link) => {
    let parent = link.parentElement;
    while (parent) {
      if (parent instanceof HTMLDetailsElement && !parent.open) return false;
      parent = parent.parentElement;
    }
    return true;
  });
}

function expandAllServices() {
  const menu = screen.getByText('所有服務').closest('details')!;
  for (const detail of menu.querySelectorAll('details')) {
    if (!detail.open) fireEvent.click(detail.querySelector('summary')!);
  }
}

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
  sessionStorage.clear();
  setMenuReturnScope(null);
  auth.session = null;
  auth.loading = false;
  auth.error = '';
  auth.pendingLogout = false;
  auth.useProvider = false;
  firebase.user = null;
  firebase.error = null;
  selection.current = null;
});

afterEach(() => vi.unstubAllGlobals());

type MenuOrigin = { url: string; state: unknown };
function captureMenuOrigin(): MenuOrigin {
  return {
    url: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    state: window.history.state,
  };
}

function visitMenuDestination(href: string) {
  const url = new URL(href, window.location.origin);
  navigation.pathname = url.pathname;
  navigation.search = url.search.slice(1);
  window.history.pushState({}, '', href);
}

// Component tests supply the browser's popstate contract; the production browser
// suite separately exercises actual Back/Forward and the Next route boundary.
function returnToMenuOrigin(origin: MenuOrigin) {
  const url = new URL(origin.url, window.location.origin);
  navigation.pathname = url.pathname;
  navigation.search = url.search.slice(1);
  window.history.replaceState(origin.state, '', origin.url);
  act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: origin.state })));
}

it('retains all existing services and search while adding a separate classroom entry', () => {
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  expandAllServices();
  for (const [href, label] of originalServices) {
    expect(
      screen.getByRole('link', { name: label === '成績' ? /^成績$/ : label }).getAttribute('href'),
    ).toBe(href);
  }
  expect(screen.getByRole('link', { name: /尋找校園服務/ }).getAttribute('href')).toBe('/search');
  expect(screen.getByRole('link', { name: '課程與作業' }).getAttribute('href')).toBe('/classroom');
  expect(screen.getByRole('link', { name: '成績回饋' }).getAttribute('href')).toBe(
    '/grades?tab=feedback',
  );
  expect(screen.getByRole('link', { name: '校方課程' }).getAttribute('href')).toBe(
    '/school-courses',
  );
  expect(screen.getByRole('link', { name: '餐廳' }).getAttribute('href')).toBe('/cafeteria');
  expect(screen.queryByRole('link', { name: '跨校交流' })).toBeNull();
  expect(screen.getByRole('link', { name: '職涯' }).getAttribute('href')).toBe('/career');
  expect(screen.getByRole('link', { name: '店家合作' }).getAttribute('href')).toBe('/merchant');
  expect(screen.getByRole('link', { name: '點餐與取餐' }).getAttribute('href')).toBe('/food');
  expect(screen.getByRole('link', { name: '學校資訊' }).getAttribute('href')).toBe('/school-info');
  expect(screen.getByText('目前還不能線上點餐')).toBeTruthy();
  expect(screen.queryByText('選餐點、查訂單、出示取餐憑證')).toBeNull();
  const routes = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
  expect(routes).toContain('/leave');
  expect(routes).toContain('/leave/review');
  expect(screen.getAllByRole('link')).toHaveLength(visibleCampusServices().length + 1);
});

it('preserves school context without copying unrelated session or return parameters', () => {
  navigation.search =
    'school=pu&schoolId=tw-pu&campus=other-campus&returnUrl=%2Fsettings&session=other';
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  expandAllServices();
  for (const link of screen.getAllByRole('link')) {
    const target = new URL(link.getAttribute('href')!, 'https://campus.example');
    expect(target.searchParams.get('school')).toBe('pu');
    expect(target.searchParams.get('schoolId')).toBe('tw-pu');
    expect(target.searchParams.get('campus')).toBe('other-campus');
    expect(target.searchParams.has('returnUrl')).toBe(false);
    expect(target.searchParams.has('session')).toBe(false);
  }
  const feedback = new URL(
    screen.getByRole('link', { name: '成績回饋' }).getAttribute('href')!,
    'https://campus.example',
  );
  expect(feedback.pathname).toBe('/grades');
  expect(feedback.searchParams.get('tab')).toBe('feedback');
});

it('sends a signed-in firebase user to profile from 我', () => {
  firebase.user = { uid: 'u1' };
  render(<AppHeader />);
  expect(screen.getByRole('link', { name: '我的' }).getAttribute('href')).toBe('/profile');
});

it('sends a signed-in nuni student to profile from 我 instead of login', () => {
  auth.session = { platformAccountId: 'a', isPlatformOperator: false };
  render(<AppHeader />);
  expect(screen.getByRole('link', { name: '我的' }).getAttribute('href')).toBe('/profile');
});

it('keeps the account destination stable for a guest who can choose how to sign in', () => {
  render(<AppHeader />);
  expect(screen.getByRole('link', { name: '我的' }).getAttribute('href')).toBe('/profile');
});

it('routes the Nuni account to its courses and hides operator links during revalidation', () => {
  auth.session = { platformAccountId: 'a', isPlatformOperator: true };
  const view = render(<AppHeader />);
  expect(screen.getByRole('link', { name: '課務' }).getAttribute('href')).toBe('/timetable');
  expect(screen.getByRole('link', { name: '我的' }).getAttribute('href')).toBe('/profile');
  fireEvent.click(screen.getByLabelText('帳號'));
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
  expandAllServices();
  expect(screen.getByRole('link', { name: '課程與作業' }).getAttribute('aria-current')).toBe(
    'page',
  );
  expect(screen.getByRole('link', { name: '課程與群組' }).getAttribute('aria-current')).toBeNull();
});

it('marks the feedback tab instead of the general grade service and keeps campus context', () => {
  navigation.pathname = '/grades';
  navigation.search = 'tab=feedback&campus=nthu';
  const view = render(<CampusServiceMenu />);
  screen.getByText('所有服務').closest('details')!.open = true;
  const feedback = screen.getByRole('link', { name: '成績回饋' });
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

it('keeps the nuni header and original school login around the complete shared menu', () => {
  navigation.search = 'schoolId=tw-pu';
  render(<AppHeader />);
  fireEvent.click(screen.getByText('所有服務'));
  expandAllServices();
  for (const [, label] of originalServices)
    expect(screen.getByRole('link', { name: label === '成績' ? /^成績$/ : label })).toBeTruthy();
  expect(screen.getByRole('link', { name: '課程與作業' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '登入' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Fmap%3FschoolId%3Dtw-pu&schoolId=tw-pu',
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
  expect(screen.getByRole('link', { name: '課程與作業' }).getAttribute('aria-current')).toBeNull();
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
  expect(screen.getByRole('link', { name: '圖書館' }).closest('details')!.open).toBe(false);
  fireEvent.click(screen.getByText(/更多生活服務/));
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
  ['/settings', '我的'],
  ['/classroom/account', '我的'],
  ['/orders/order-1', '生活'],
  ['/school-info', '生活'],
  ['/community/post/topic-1', '交流'],
  ['/social', '交流'],
  ['/dms/chat-1', '交流'],
  ['/student-card', '我的'],
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
  window.history.replaceState({}, '', '/library');
  view.rerender(<CampusServiceMenu />);
  screen.getByText('所有服務').closest('details')!.open = true;
  expect((screen.getByRole('searchbox', { name: '搜尋服務' }) as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('link', { name: '課表' })).toBeTruthy();
});

it('reopens the directory with the same query and category after returning from a service', () => {
  const view = render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.click(screen.getByRole('button', { name: '篩選校園生活' }));
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋服務' }), {
    target: { value: '借書' },
  });
  fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
  const origin = captureMenuOrigin();
  visitMenuDestination('/library');
  view.rerender(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
  returnToMenuOrigin(origin);
  view.rerender(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
  expect((screen.getByRole('searchbox', { name: '搜尋服務' }) as HTMLInputElement).value).toBe(
    '借書',
  );
  expect(screen.getByRole('button', { name: '篩選校園生活' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByRole('link', { name: '圖書館' })).toBeTruthy();
});

it('does not reopen the directory from an off-site stored destination', () => {
  sessionStorage.setItem(
    'campus.directory.search.v1',
    JSON.stringify({
      menu: {
        path: '/map',
        destination: 'https://evil.test/library',
        query: '借書',
        category: 'campus',
        open: true,
      },
    }),
  );
  render(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
  fireEvent.click(screen.getByText('所有服務'));
  expect((screen.getByRole('searchbox', { name: '搜尋服務' }) as HTMLInputElement).value).toBe('');
});

async function dispatchToggleAfterTask(menu: HTMLDetailsElement) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    menu.dispatchEvent(new Event('toggle'));
  });
}

function restoreOpenDirectory(view: ReturnType<typeof render>, content = <CampusServiceMenu />) {
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋服務' }), {
    target: { value: '借書' },
  });
  fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
  const origin = captureMenuOrigin();
  visitMenuDestination('/library');
  view.rerender(content);
  returnToMenuOrigin(origin);
  view.rerender(content);
}

function expectDirectoryNotRestored() {
  const next = render(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
  fireEvent.click(screen.getByText('所有服務'));
  expect((screen.getByRole('searchbox', { name: '搜尋服務' }) as HTMLInputElement).value).toBe('');
  next.unmount();
}

it('keeps the snapshot when a delayed close toggle arrives after opening a service', async () => {
  const view = render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.click(screen.getByRole('button', { name: '篩選校園生活' }));
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋服務' }), {
    target: { value: '借書' },
  });
  fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
  const menu = screen.getByText('所有服務').closest('details')!;
  expect(menu.open).toBe(false);
  await dispatchToggleAfterTask(menu);
  const origin = captureMenuOrigin();
  visitMenuDestination('/library');
  view.rerender(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
  returnToMenuOrigin(origin);
  view.rerender(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
  expect((screen.getByRole('searchbox', { name: '搜尋服務' }) as HTMLInputElement).value).toBe(
    '借書',
  );
  expect(screen.getByRole('button', { name: '篩選校園生活' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByRole('link', { name: '圖書館' })).toBeTruthy();
});

it('keeps a real return open through a delayed toggle but never replays it on remount', async () => {
  const view = render(<CampusServiceMenu />);
  restoreOpenDirectory(view);
  const menu = screen.getByText('所有服務').closest('details')!;
  expect(menu.open).toBe(true);
  await dispatchToggleAfterTask(menu);
  expect(menu.open).toBe(true);
  expect((screen.getByRole('searchbox', { name: '搜尋服務' }) as HTMLInputElement).value).toBe(
    '借書',
  );
  view.unmount();
  render(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
  expect((screen.getByRole('searchbox', { name: '搜尋服務' }) as HTMLInputElement).value).toBe('');
});

it('does not close or forget when restoring open moves focus back to the page', () => {
  const view = render(
    <>
      <button type="button">頁面內容</button>
      <CampusServiceMenu />
    </>,
  );
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋服務' }), {
    target: { value: '借書' },
  });
  fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
  const origin = captureMenuOrigin();
  visitMenuDestination('/library');
  view.rerender(
    <>
      <button type="button">頁面內容</button>
      <CampusServiceMenu />
    </>,
  );
  const page = screen.getByRole('button', { name: '頁面內容' });
  page.focus();
  returnToMenuOrigin(origin);
  view.rerender(
    <>
      <button type="button">頁面內容</button>
      <CampusServiceMenu />
    </>,
  );
  const menu = screen.getByText('所有服務').closest('details')!;
  expect(menu.open).toBe(true);
  fireEvent.blur(menu, { relatedTarget: page });
  expect(menu.open).toBe(true);
  expect((screen.getByRole('searchbox', { name: '搜尋服務' }) as HTMLInputElement).value).toBe(
    '借書',
  );
  view.unmount();
  render(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
  expect((screen.getByRole('searchbox', { name: '搜尋服務' }) as HTMLInputElement).value).toBe('');
});

it('does not restore after clearing filters, viewing all services, or collapsing the summary', () => {
  const cleared = render(<CampusServiceMenu />);
  restoreOpenDirectory(cleared);
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  cleared.unmount();
  expectDirectoryNotRestored();

  const emptied = render(<CampusServiceMenu />);
  restoreOpenDirectory(emptied);
  fireEvent.click(screen.getByRole('button', { name: '篩選學習與課務' }));
  fireEvent.click(screen.getByRole('button', { name: '查看全部服務' }));
  emptied.unmount();
  expectDirectoryNotRestored();

  const collapsed = render(<CampusServiceMenu />);
  restoreOpenDirectory(collapsed);
  const menu = screen.getByText('所有服務').closest('details')!;
  expect(menu.open).toBe(true);
  fireEvent.click(screen.getByText('所有服務'));
  expect(menu.open).toBe(false);
  collapsed.unmount();
  expectDirectoryNotRestored();
});

it('does not replay a restored draft after focus dismisses the menu', async () => {
  const content = (
    <>
      <button type="button">頁面內容</button>
      <CampusServiceMenu />
    </>
  );
  const view = render(content);
  restoreOpenDirectory(view, content);
  const origin = captureMenuOrigin();
  const menu = screen.getByText('所有服務').closest('details')!;
  await dispatchToggleAfterTask(menu);
  fireEvent.blur(menu, { relatedTarget: screen.getByRole('button', { name: '頁面內容' }) });
  expect(menu.open).toBe(false);
  returnToMenuOrigin({ url: '/library', state: {} });
  view.rerender(content);
  returnToMenuOrigin(origin);
  view.rerender(content);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
});

it('keeps the directory usable when sessionStorage throws', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  try {
    render(<CampusServiceMenu />);
    fireEvent.click(screen.getByText('所有服務'));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜尋服務' }), {
      target: { value: '借書' },
    });
    expect(screen.getByRole('link', { name: '圖書館' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
    expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
  } finally {
    vi.restoreAllMocks();
  }
});

it('does not steal focus when restoring an open directory', () => {
  const view = render(
    <>
      <button type="button">頁面內容</button>
      <CampusServiceMenu />
    </>,
  );
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋服務' }), {
    target: { value: '借書' },
  });
  fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
  const origin = captureMenuOrigin();
  visitMenuDestination('/library');
  view.rerender(
    <>
      <button type="button">頁面內容</button>
      <CampusServiceMenu />
    </>,
  );
  const page = screen.getByRole('button', { name: '頁面內容' });
  page.focus();
  expect(document.activeElement).toBe(page);
  returnToMenuOrigin(origin);
  view.rerender(
    <>
      <button type="button">頁面內容</button>
      <CampusServiceMenu />
    </>,
  );
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
  expect((screen.getByRole('searchbox', { name: '搜尋服務' }) as HTMLInputElement).value).toBe(
    '借書',
  );
  expect(document.activeElement).toBe(page);
});

it('uses the existing Today conversation when its header assistant shortcut is pressed', () => {
  navigation.pathname = '/';
  const openTodayAssistant = vi.fn();
  render(<AppHeader onOpenAssistant={openTodayAssistant} />);
  fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
  expect(openTodayAssistant).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('opens a keyboard-dismissible assistant on the current service with a login return for guests', async () => {
  const view = render(<AppHeader />);
  const trigger = view.getByRole('button', { name: '開啟校園助理' });
  fireEvent.click(trigger);
  await act(async () => {
    // Wait for the real lazy entry to load, including cold transforms under CI coverage.
    await import('./TodayCampusEntry');
  });
  const dialog = view.getByRole('dialog', { name: '校園助理' });
  expect(dialog).toBeTruthy();
  const login = await view.findByRole('link', { name: '登入後，接著詢問校園助理' });
  expect(
    new URL(login.getAttribute('href')!, window.location.origin).searchParams.get('returnUrl'),
  ).toBe('/map#campus-assistant-entry');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(view.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('hides readonly homework by default and restores it when enabled', () => {
  const view = render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  expect(screen.queryByRole('link', { name: /^校方作業與教材$/ })).toBeNull();
  view.rerender(
    <SchoolLmsReadonlyProvider enabled={true}>
      <CampusServiceMenu />
    </SchoolLmsReadonlyProvider>,
  );
  fireEvent.click(screen.getByText('所有服務'));
  expect(screen.getByRole('link', { name: /^校方作業與教材$/ }).getAttribute('href')).toContain(
    '/school-lms',
  );
});

it('continues a filtered menu search in the directory while keeping only the campus context', () => {
  navigation.search = 'schoolId=nthu&session=old&q=old&category=account';
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.click(screen.getByRole('button', { name: '篩選校園生活' }));
  const links = screen.getAllByRole('link').length - 1;
  expect(screen.getByRole('status').textContent).toBe(`找到 ${links} 項服務`);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書 & 續借' } });
  const directory = new URL(
    screen.getByRole('link', { name: /尋找校園服務/ }).getAttribute('href')!,
    window.location.origin,
  );
  expect(directory.pathname).toBe('/search');
  expect(Object.fromEntries(directory.searchParams)).toEqual({
    schoolId: 'nthu',
    q: '借書 & 續借',
    category: 'campus',
  });
});

it('keeps exactly five primary destinations and moves service search out of the tab sequence', () => {
  navigation.search = 'schoolId=nthu&session=private';
  render(<AppHeader />);
  const nav = screen.getByRole('navigation', { name: '主要導覽' });
  const links = Array.from(nav.querySelectorAll('a'));
  expect(links.map((link) => link.textContent)).toEqual(['今天', '課務', '生活', '交流', '我的']);
  for (const link of links) {
    const destination = new URL(link.href);
    expect(destination.searchParams.get('schoolId')).toBe('nthu');
    expect(destination.searchParams.has('session')).toBe(false);
  }
  const menu = screen.getByText('所有服務').closest('details')!;
  expect(nav.contains(menu)).toBe(false);
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  expect(menu.open).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜尋服務' }));
});

it('starts with a small set of everyday entries and exposes secondary services on request', () => {
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  expect(expandedLinks()).toHaveLength(17);
  expect(screen.getByRole('link', { name: '刪除帳號' }).closest('details')!.open).toBe(false);
  expect(screen.getByRole('link', { name: '教材收藏' }).closest('details')!.open).toBe(false);
  fireEvent.click(screen.getByLabelText('課程與作業的相關服務'));
  expect(screen.getByRole('link', { name: '教材收藏' }).closest('details')!.open).toBe(true);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '學分' } });
  expect(screen.getByRole('link', { name: '學分規劃' })).toBeTruthy();
});

it('does not reset a category when a nested disclosure toggles', async () => {
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.click(screen.getByRole('button', { name: '篩選學習與課務' }));
  const summary = screen.getByLabelText('課程與作業的相關服務');
  fireEvent.click(summary);
  fireEvent.click(summary);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.getByRole('button', { name: '篩選學習與課務' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
});

it('restores the expanded service family when returning to the menu origin', () => {
  const view = render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.click(screen.getByLabelText('課程與作業的相關服務'));
  fireEvent.click(screen.getByRole('link', { name: '教材收藏' }));
  const origin = captureMenuOrigin();
  visitMenuDestination('/classroom/material-bookmarks');
  view.rerender(<CampusServiceMenu />);
  returnToMenuOrigin(origin);
  view.rerender(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
  expect(screen.getByRole('link', { name: '教材收藏' }).closest('details')!.open).toBe(true);
  expect(screen.getByRole('link', { name: '校園地圖' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: '教材收藏' }).getAttribute('aria-current')).toBeNull();
});

it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }])(
  'keeps the open search and current history intact for modified service clicks %j',
  (modifiers) => {
    render(<CampusServiceMenu />);
    fireEvent.click(screen.getByText('所有服務'));
    fireEvent.click(screen.getByRole('button', { name: '篩選校園生活' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
    const original = window.history.state;
    fireEvent.click(screen.getByRole('link', { name: '圖書館' }), modifiers);
    expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
    expect(screen.getByRole('button', { name: '篩選校園生活' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(window.history.state).toEqual(original);
    expect(sessionStorage.getItem('campus.directory.search.v1')).toBeNull();
  },
);

it.each(['cancelled', 'new-tab', 'download'])(
  'does not discard the search for a %s service link',
  (kind) => {
    render(<CampusServiceMenu />);
    fireEvent.click(screen.getByText('所有服務'));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
    const link = screen.getByRole('link', { name: '圖書館' });
    if (kind === 'cancelled')
      link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    if (kind === 'new-tab') link.setAttribute('target', '_blank');
    if (kind === 'download') link.setAttribute('download', 'service.txt');
    fireEvent.click(link);
    expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
    expect(window.history.state[MENU_RETURN_STATE_KEY]).toBeUndefined();
  },
);

it('keeps the search open when the full directory is opened in another tab', () => {
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: /尋找校園服務/ }), { metaKey: true });
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  expect(window.history.state[MENU_RETURN_STATE_KEY]).toBeUndefined();
});

function testSessionResponse() {
  return Response.json({
    authenticated: true,
    platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
    isPlatformOperator: false,
    context: 'a'.repeat(43),
  });
}

function SessionStatus() {
  const session = useOptionalNuniSession();
  const status = session?.loading
    ? 'checking'
    : session?.error
      ? 'verification failed'
      : session?.session
        ? 'signed-in'
        : 'guest';
  return <output>{status}</output>;
}

it.each(['unavailable', 'connection lost', 'invalid session'])(
  'restores the same account’s search after a session recheck fails (%s)',
  async (failure) => {
    auth.useProvider = true;
    if (failure !== 'unavailable') firebase.user = { uid: 'school-a' };
    const fetchSession = vi.fn().mockResolvedValueOnce(testSessionResponse());
    if (failure === 'connection lost') fetchSession.mockRejectedValueOnce(new TypeError());
    else {
      fetchSession.mockResolvedValueOnce(
        failure === 'unavailable' ? new Response(null, { status: 503 }) : Response.json({}),
      );
    }
    let finishRefresh!: (response: Response) => void;
    fetchSession.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchSession);
    const tree = () => (
      <NuniSessionProvider>
        <SessionStatus />
        <CampusServiceMenu />
      </NuniSessionProvider>
    );
    const view = render(tree());
    await screen.findByText('signed-in');
    fireEvent.click(screen.getByText('所有服務'));
    fireEvent.click(screen.getByRole('button', { name: '篩選校園生活' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
    fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
    const origin = captureMenuOrigin();
    visitMenuDestination('/library');
    view.rerender(tree());
    fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }));
    await screen.findByText('verification failed');

    returnToMenuOrigin(origin);
    view.rerender(tree());
    expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
    fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }));
    expect(screen.getByText('checking')).toBeTruthy();
    expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
    await act(async () => finishRefresh(testSessionResponse()));
    expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
    expect(screen.getByRole('button', { name: '篩選校園生活' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  },
);

it.each([
  ['visibilitychange', { ctrlKey: true }],
  ['pageshow', { metaKey: true }],
] as const)('keeps an open draft while %s rechecks the same account', async (event, modifiers) => {
  auth.useProvider = true;
  let finishRefresh!: (response: Response) => void;
  const fetchSession = vi.fn()
    .mockResolvedValueOnce(testSessionResponse())
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishRefresh = resolve; }));
  vi.stubGlobal('fetch', fetchSession);
  render(
    <NuniSessionProvider>
      <SessionStatus />
      <CampusServiceMenu />
    </NuniSessionProvider>,
  );
  await screen.findByText('signed-in');
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.click(screen.getByRole('button', { name: '篩選校園生活' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: '圖書館' }), modifiers);
  if (event === 'visibilitychange') {
    expect(document.visibilityState).toBe('visible');
    fireEvent(document, new Event(event));
  } else {
    fireEvent(window, new PageTransitionEvent(event, { persisted: true }));
  }
  expect(screen.getByText('checking')).toBeTruthy();
  const expectDraft = () => {
    expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
    expect(screen.getByRole('button', { name: '篩選校園生活' }).getAttribute('aria-pressed')).toBe('true');
  };
  expectDraft();
  await act(async () => finishRefresh(testSessionResponse()));
  expect(screen.getByText('signed-in')).toBeTruthy();
  expectDraft();
});

it('closes a normal click on the exact current service without creating a return marker', () => {
  navigation.pathname = '/library';
  navigation.search = 'campus=pu';
  window.history.replaceState({ unrelated: 'keep' }, '', '/library?campus=pu');
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
  expect(window.history.state).toEqual({ unrelated: 'keep' });
});

it('does not restore a current-format draft on a new visit or from a history marker alone', () => {
  const view = render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
  const origin = captureMenuOrigin();
  expect((origin.state as Record<string, unknown>)[MENU_RETURN_STATE_KEY]).toEqual(
    expect.any(String),
  );
  visitMenuDestination('/library');
  view.rerender(<CampusServiceMenu />);
  visitMenuDestination('/map');
  view.rerender(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
  view.unmount();
  // A retained browser marker alone is insufficient after an ordinary mount.
  sessionStorage.clear();
  window.history.replaceState(origin.state, '', origin.url);
  render(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
});

it.each([
  ['教材', 'school', 'recovers'],
  ['', 'platform', 'recovers'],
  ['', 'both', 'stays unavailable'],
  ['教材', 'school', 'switches account'],
  ['', 'platform', 'switches account'],
])(
  'restores a public legacy draft (query %j) when %s verification fails and %s',
  (query, failedSource, outcome) => {
    firebase.user = { uid: 'school-a' };
    const account = { platformAccountId: 'platform-a', isPlatformOperator: false };
    auth.session = account;
    const origin = captureMenuOrigin();
    const destination = '/classroom/material-bookmarks';
    const quick = {
      path: '/map',
      destination: '/library',
      query: '借書',
      category: 'campus',
      open: true,
    };
    sessionStorage.setItem(
      'campus.directory.search.v1',
      JSON.stringify({
        quick,
        menu: {
          path: '/map',
          destination,
          query,
          category: 'study',
          open: true,
          expanded: ['service:/classroom'],
        },
      }),
    );
    visitMenuDestination(destination);
    const view = render(<CampusServiceMenu />);
    expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
    if (failedSource !== 'platform') {
      firebase.user = null;
      firebase.error = new Error('School account unavailable');
    }
    if (failedSource !== 'school') {
      auth.session = null;
      auth.error = 'Platform account unavailable';
    }
    view.rerender(<CampusServiceMenu />);
    expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
    expect(JSON.parse(sessionStorage.getItem('campus.directory.search.v1')!)).toHaveProperty('menu');

    returnToMenuOrigin(origin);
    view.rerender(<CampusServiceMenu />);
    const expectDraft = () => {
      expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
      expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(query);
      expect(screen.getByRole('button', { name: '篩選學習與課務' }).getAttribute('aria-pressed')).toBe(
        'true',
      );
      if (!query) {
        expect(screen.getByRole('link', { name: '教材收藏' }).closest('details')!.open).toBe(true);
      }
    };
    expectDraft();
    expect(JSON.parse(sessionStorage.getItem('campus.directory.search.v1')!)).toEqual({ quick });
    const migratedOrigin = captureMenuOrigin();
    if (outcome !== 'stays unavailable') {
      firebase.error = null;
      firebase.user = { uid: outcome === 'switches account' && failedSource === 'school' ? 'school-b' : 'school-a' };
      auth.error = '';
      auth.session = outcome === 'switches account' && failedSource === 'platform'
        ? { ...account, platformAccountId: 'platform-b' }
        : account;
      view.rerender(<CampusServiceMenu />);
    }
    if (outcome === 'switches account') {
      expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
      expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('');
      expect(sessionStorage.getItem('campus.menu.return.v1')).toBeNull();
    } else {
      expectDraft();
    }
    returnToMenuOrigin({ url: destination, state: {} });
    view.rerender(<CampusServiceMenu />);
    returnToMenuOrigin(migratedOrigin);
    view.rerender(<CampusServiceMenu />);
    if (outcome === 'switches account') {
      expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
    } else {
      expectDraft();
    }
  },
);

// A fresh tab may hand an unconfirmed draft to either first account, as in
// merge-base. A known account survives a temporary failure. Logout clears drafts
// even when the next login is to the same account.
it.each(['first A', 'first B', 'same account', 'logout then A', 'logout then B'] as const)(
  'checks a draft typed during failed platform verification on %s',
  (outcome) => {
    const accountA = { platformAccountId: 'platform-a', isPlatformOperator: false };
    auth.session = outcome.startsWith('first') ? null : accountA;
    auth.error = outcome.startsWith('first') ? 'Session unavailable' : '';
    const view = render(<CampusServiceMenu />);
    auth.session = null;
    auth.error = 'Session unavailable';
    view.rerender(<CampusServiceMenu />);
    fireEvent.click(screen.getByText('所有服務'));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
    fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
    const origin = captureMenuOrigin();
    expect(origin.state).toHaveProperty(MENU_RETURN_STATE_KEY);
    visitMenuDestination('/library');
    view.rerender(<CampusServiceMenu />);
    if (outcome.startsWith('logout')) {
      auth.pendingLogout = true;
      view.rerender(<CampusServiceMenu />);
      auth.pendingLogout = false;
    }
    auth.error = '';
    auth.session = outcome.endsWith('B') ? { ...accountA, platformAccountId: 'platform-b' } : accountA;
    view.rerender(<CampusServiceMenu />);
    returnToMenuOrigin(origin);
    view.rerender(<CampusServiceMenu />);
    const restored = !outcome.startsWith('logout');
    expect(screen.getByText('所有服務').closest('details')!.open).toBe(restored);
    expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe(restored ? '借書' : '');
  },
);

it('waits for the Next route and account confirmation before restoring a pending return', () => {
  auth.session = { platformAccountId: 'a', isPlatformOperator: false };
  const routerTree = { segment: 'map', children: ['unchanged'] };
  window.history.replaceState({ __NA: true, tree: routerTree, unrelated: 'keep' }, '', '/map');
  const view = render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
  const origin = captureMenuOrigin();
  visitMenuDestination('/library');
  view.rerender(<CampusServiceMenu />);
  auth.loading = true;
  view.rerender(<CampusServiceMenu />);
  window.history.replaceState(origin.state, '', origin.url);
  act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: origin.state })));
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
  navigation.pathname = '/map';
  view.rerender(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
  auth.loading = false;
  view.rerender(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  expect(window.history.state).toMatchObject(origin.state as Record<string, unknown>);
  fireEvent.click(screen.getByRole('button', { name: '關閉所有服務' }));
  expect(window.history.state).toEqual({ __NA: true, tree: routerTree, unrelated: 'keep' });
  returnToMenuOrigin(origin);
  view.rerender(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
});

it('does not restore on Forward into the service after returning to the original menu', () => {
  const view = render(<CampusServiceMenu />);
  restoreOpenDirectory(view);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
  returnToMenuOrigin({ url: '/library', state: {} });
  view.rerender(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
});

it('preserves a real return when the destination normalizes the same campus parameters', () => {
  navigation.search = 'campus=pu';
  window.history.replaceState({}, '', '/map?campus=pu');
  const view = render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
  const origin = captureMenuOrigin();
  visitMenuDestination('/library?school=PU&schoolId=pu&campus=pu');
  view.rerender(<CampusServiceMenu />);
  returnToMenuOrigin(origin);
  view.rerender(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
});

it.each([
  ['/login?returnUrl=%2Ftimetable%2Fshare%3Ftoken%3Dfake-sensitive', 'returnUrl'],
  [
    '/events?redirect=%2Fshare%2Ffake-sensitive&access_token=fake-sensitive&access_token=second',
    'redirect',
  ],
  ['/map#access_token=fake-sensitive', 'access_token'],
  ['/share/fake-sensitive#%2Fother%3Funknown%3Dfake-sensitive', 'unknown'],
] as const)('keeps the source URL out of menu drafts and history state at %s', (url, parameter) => {
  returnToMenuOrigin({ url, state: { router: 'keep' } });
  const view = render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '教材' } });
  expect(sessionStorage.length).toBe(0);
  expect(window.history.state).toEqual({ router: 'keep' });

  const link = screen.getByRole('link', { name: '教材收藏' });
  const destination = link.getAttribute('href')!;
  fireEvent.click(link);
  const origin = captureMenuOrigin();
  expect(origin.url).toBe(url);
  expect(origin.state).toEqual({ router: 'keep', [MENU_RETURN_STATE_KEY]: expect.any(String) });
  const storageKey = 'campus.menu.return.v1';
  expect(sessionStorage.length).toBe(1);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.getItem(storageKey)).not.toContain('fake-sensitive');
  expect(sessionStorage.getItem(storageKey)).not.toContain(parameter);
  expect(sessionStorage.getItem(storageKey)).not.toContain(url);

  visitMenuDestination(destination);
  view.rerender(<CampusServiceMenu />);
  returnToMenuOrigin(origin);
  view.rerender(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
  expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('教材');
});

it.each([
  ['/map', '/library?campus=nthu', 'history'],
  ['/events', '/library', 'history'],
  ['/classroom', '/library?campus=nthu', 'legacy'],
  ['/bus', '/library', 'legacy'],
] as const)('restores a %s origin after campus loading at %s (%s)', (path, destination, kind) => {
  const school = { id: 'nthu', name: '清華大學' };
  firebase.user = { uid: 'school-a' };
  selection.current = { loading: false, catalogStatus: 'ready', selectedSchool: school };
  returnToMenuOrigin({ url: path, state: {} });
  const first = render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.click(screen.getByRole('button', { name: '篩選學習與課務' }));
  const query = destination.includes('?') ? '教材' : '';
  if (query) fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
  else fireEvent.click(screen.getByLabelText('課程與作業的相關服務'));
  fireEvent.click(screen.getByRole('link', { name: '教材收藏' }));
  const origin = captureMenuOrigin();
  const historyKey = 'campus.menu.return.v1';
  const stored = sessionStorage.getItem(historyKey)!;
  expect(stored).toBeTruthy();
  first.unmount();
  // Reset document scope while retaining the tab's persisted draft.
  setMenuReturnScope(null);
  const [snapshot] = JSON.parse(stored);
  if (kind === 'history') sessionStorage.setItem(historyKey, stored);
  else {
    sessionStorage.setItem('campus.directory.search.v1', JSON.stringify({
      menu: { ...snapshot, path, destination, open: true },
    }));
  }
  visitMenuDestination(destination);
  selection.current = { loading: true, catalogStatus: 'loading', selectedSchool: null };
  const view = render(<CampusServiceMenu />);
  const confirmCampus = () => {
    selection.current = { loading: false, catalogStatus: 'ready', selectedSchool: school };
    view.rerender(<CampusServiceMenu />);
  };
  if (query) confirmCampus();
  returnToMenuOrigin(origin);
  view.rerender(<CampusServiceMenu />);
  if (!query) {
    expect(screen.getByText('所有服務').closest('details')!.open).toBe(kind === 'legacy');
    expect(sessionStorage.length).toBe(1);
    confirmCampus();
  }
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
  expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe(query);
  expect(screen.getByRole('button', { name: '篩選學習與課務' }).getAttribute('aria-pressed')).toBe('true');
  if (!query) expect(screen.getByRole('link', { name: '教材收藏' }).closest('details')!.open).toBe(true);
});

it.each([
  ['public', 'error', 'error'],
  ['bound', 'error', 'error'],
  ['public', 'loading', 'error'],
  ['bound', 'loading', 'error'],
  ['public', 'error', 'same'],
  ['bound', 'error', 'same'],
  ['public', 'error', 'account source error'],
  ['bound', 'loading', 'different campus'],
  ['bound', 'error', 'different account'],
] as const)('restores a %s legacy draft during catalog %s, then handles %s', (kind, status, outcome) => {
  const school = { id: 'pu', name: '靜宜大學' };
  const ready = { loading: false, catalogStatus: 'ready', selectedSchool: school } as const;
  const origin = { url: '/map?campus=pu', state: {} };
  firebase.user = { uid: 'school-a' };
  selection.current = ready;
  returnToMenuOrigin(origin);
  const first = render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.click(screen.getByRole('button', { name: '篩選學習與課務' }));
  const query = status === 'loading' ? '教材' : '';
  if (query) fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
  else fireEvent.click(screen.getByLabelText('課程與作業的相關服務'));
  const link = screen.getByRole<HTMLAnchorElement>('link', { name: '教材收藏' });
  const destination = link.href;
  fireEvent.click(link);
  const [{ scope, category, expanded }] = JSON.parse(sessionStorage.getItem('campus.menu.return.v1')!);
  first.unmount();
  setMenuReturnScope(null);
  sessionStorage.setItem('campus.directory.search.v1', JSON.stringify({
    menu: {
      path: '/map', destination: new URL(destination).pathname, query, category, expanded, open: true,
      ...(kind === 'bound' ? { scope } : {}),
    },
  }));

  visitMenuDestination(destination);
  selection.current = { loading: status === 'loading', catalogStatus: status, selectedSchool: null };
  if (outcome === 'account source error') {
    firebase.user = null;
    firebase.error = new Error('School account unavailable');
  }
  const view = render(<CampusServiceMenu />);
  const menu = () => screen.getByText('所有服務').closest('details')!;
  const search = () => screen.getByRole<HTMLInputElement>('searchbox');
  expect(menu().open).toBe(false);
  expect(sessionStorage.getItem('campus.directory.search.v1')).toBeTruthy();
  returnToMenuOrigin(origin);
  view.rerender(<CampusServiceMenu />);
  const expectDraft = () => {
    expect(menu().open).toBe(true);
    expect(search().value).toBe(query);
    expect(screen.getByRole('button', { name: '篩選學習與課務' }).getAttribute('aria-pressed')).toBe('true');
    if (!query) expect(screen.getByRole('link', { name: '教材收藏' }).closest('details')!.open).toBe(true);
  };
  expectDraft();
  expect(sessionStorage.getItem('campus.directory.search.v1')).toBeNull();
  const migratedOrigin = captureMenuOrigin();

  if (outcome === 'error' || outcome === 'account source error') {
    selection.current = { loading: false, catalogStatus: 'error', selectedSchool: null };
  } else if (outcome === 'different campus') {
    selection.current = { ...ready, selectedSchool: { id: 'nthu', name: '清華大學' } };
    navigation.search = 'campus=nthu';
    window.history.replaceState(migratedOrigin.state, '', '/map?campus=nthu');
  } else if (outcome === 'different account') {
    firebase.user = { uid: 'school-b' };
  } else {
    selection.current = ready;
  }
  view.rerender(<CampusServiceMenu />);
  const changed = outcome.startsWith('different');
  if (changed) {
    expect(menu().open).toBe(false);
    expect(search().value).toBe('');
    expect(sessionStorage.getItem('campus.menu.return.v1')).toBeNull();
    firebase.user = { uid: 'school-a' };
    selection.current = ready;
  } else {
    expectDraft();
  }
  visitMenuDestination(destination);
  view.rerender(<CampusServiceMenu />);
  returnToMenuOrigin(migratedOrigin);
  view.rerender(<CampusServiceMenu />);
  if (changed) expect(menu().open).toBe(false);
  else expectDraft();
});

it('captures a real return while the header is unmounted without storing account/session material', () => {
  auth.session = {
    platformAccountId: 'private-account',
    isPlatformOperator: false,
    context: 'private-session-secret',
  };
  const view = render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
  const origin = captureMenuOrigin();
  expect(JSON.stringify(origin.state)).not.toMatch(/private-account|private-session-secret|借書/);
  expect(sessionStorage.length).toBe(1);
  expect(sessionStorage.getItem(sessionStorage.key(0)!)).not.toMatch(/private-account|private-session-secret/);
  view.unmount();
  visitMenuDestination('/library');
  returnToMenuOrigin(origin);
  render(<CampusServiceMenu />);
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
});

it.each([
  'school-account',
  'school-account during platform error',
  'platform-account',
  'session',
  'campus',
  'campus during platform error',
  'campus after selection loading',
  'school-account during selection loading',
  'logout',
])(
  'discards a pending menu after changing %s even if the old scope returns',
  (kind) => {
    firebase.user = { uid: 'school-a' };
    auth.session = {
      platformAccountId: 'platform-a',
      isPlatformOperator: false,
      context: 'session-a',
    };
    navigation.search = 'campus=pu';
    window.history.replaceState({}, '', '/map?campus=pu');
    const school = { id: 'pu', name: '靜宜大學' };
    if (kind.includes('selection loading')) {
      selection.current = { loading: false, catalogStatus: 'ready', selectedSchool: school };
    }
    const view = render(<CampusServiceMenu />);
    fireEvent.click(screen.getByText('所有服務'));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
    fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
    const origin = captureMenuOrigin();
    visitMenuDestination('/library?campus=pu');
    view.rerender(<CampusServiceMenu />);
    if (kind.endsWith('during platform error')) {
      auth.session = null;
      auth.error = 'Session unavailable';
      view.rerender(<CampusServiceMenu />);
      expect(sessionStorage.length).toBe(1);
    }
    if (kind.includes('selection loading')) {
      sessionStorage.setItem('campus.directory.search.v1', JSON.stringify({
        menu: { path: '/map', destination: '/library', query: '借書', category: 'campus', open: true },
      }));
      selection.current = { loading: true, catalogStatus: 'loading', selectedSchool: null };
      view.rerender(<CampusServiceMenu />);
      expect(sessionStorage.length).toBe(2);
    }
    if (kind.startsWith('school-account')) firebase.user = { uid: 'school-b' };
    if (kind === 'platform-account')
      auth.session = { ...auth.session!, platformAccountId: 'platform-b' };
    if (kind === 'session') auth.session = { ...auth.session!, context: 'session-b' };
    if (kind.startsWith('campus')) visitMenuDestination('/library?campus=nthu');
    if (kind === 'campus after selection loading') {
      selection.current = {
        loading: false, catalogStatus: 'ready', selectedSchool: { id: 'nthu', name: '清華大學' },
      };
    }
    if (kind === 'logout') auth.pendingLogout = true;
    view.rerender(<CampusServiceMenu />);
    expect(sessionStorage.length).toBe(0);
    if (kind.includes('selection loading')) {
      selection.current = { loading: false, catalogStatus: 'ready', selectedSchool: school };
    }
    firebase.user = { uid: 'school-a' };
    auth.session = {
      platformAccountId: 'platform-a',
      isPlatformOperator: false,
      context: 'session-a',
    };
    auth.pendingLogout = false;
    auth.error = '';
    returnToMenuOrigin(origin);
    view.rerender(<CampusServiceMenu />);
    expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  },
);

it('submits the explicit search with the same filters and campus, without forwarding unrelated parameters', () => {
  navigation.search = 'schoolId=pu&campus=pu&session=private&q=old';
  window.history.replaceState({}, '', `/map?${navigation.search}`);
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  fireEvent.click(screen.getByRole('button', { name: '篩選校園生活' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書 & 續借' } });
  const directory = screen.getByRole('link', { name: /尋找校園服務/ });
  const follow = vi.fn(() => directory.getAttribute('href'));
  directory.addEventListener('click', follow);
  fireEvent.click(screen.getByRole('button', { name: '查看結果' }));
  expect(follow).toHaveBeenCalledTimes(1);
  const destination = new URL(follow.mock.results[0].value!, window.location.origin);
  expect(destination.pathname).toBe('/search');
  expect(Object.fromEntries(destination.searchParams)).toEqual({
    schoolId: 'pu',
    campus: 'pu',
    q: '借書 & 續借',
    category: 'campus',
  });
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
});

it('lets Enter choose Chinese characters before allowing an explicit full-search submission', () => {
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  const input = screen.getByRole('searchbox');
  const form = screen.getByRole('search', { name: '搜尋校園服務' });
  const directory = screen.getByRole('link', { name: /尋找校園服務/ });
  const follow = vi.fn(() => directory.getAttribute('href'));
  directory.addEventListener('click', follow);
  input.focus();
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '圖書' } });
  fireEvent.keyDown(input, { key: 'ArrowDown', isComposing: false });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: 'Escape', isComposing: false });
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
  expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(false);
  fireEvent.submit(form);
  expect(follow).not.toHaveBeenCalled();
  expect(screen.getByText('所有服務').closest('details')!.open).toBe(true);
  fireEvent.compositionEnd(input);
  expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })).toBe(false);
  expect(follow).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '圖書館' } });
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
  fireEvent.submit(form);
  expect(follow).toHaveBeenCalledTimes(1);
  expect(follow.mock.results[0].value).toBe('/search?q=%E5%9C%96%E6%9B%B8%E9%A4%A8');
  expect(window.history.state[MENU_RETURN_STATE_KEY]).toEqual(expect.any(String));
});

it.each(['account', 'campus', 'temporary failure', 'different account', 'different campus'])(
  'keeps live menu state and focus until a real boundary changes (%s)',
  (transition) => {
    const school = { id: 'pu', name: '靜宜大學' };
    const ready = { loading: false, catalogStatus: 'ready', selectedSchool: school } as const;
    const loading = { loading: true, catalogStatus: 'loading', selectedSchool: null } as const;
    firebase.user = { uid: 'school-a' };
    selection.current = transition === 'campus' ? loading : ready;
    auth.loading = transition === 'account';
    navigation.search = 'campus=pu';
    window.history.replaceState({}, '', '/map?campus=pu');
    const view = render(<CampusServiceMenu />);
    fireEvent.click(screen.getByText('所有服務'));
    fireEvent.click(screen.getByRole('button', { name: '篩選學習與課務' }));
    fireEvent.click(screen.getByLabelText('課程與作業的相關服務'));
    const menu = screen.getByText('所有服務').closest('details')!;
    const search = screen.getByRole<HTMLInputElement>('searchbox');
    const related = screen.getByRole('link', { name: '教材收藏' }).closest('details')!;
    act(() => search.focus());

    if (transition === 'temporary failure') {
      firebase.user = null;
      firebase.error = new Error('Verification unavailable');
      selection.current = loading;
      navigation.search = '';
      window.history.replaceState({}, '', '/map');
      view.rerender(<CampusServiceMenu />);
      expect(menu.open).toBe(true);
      expect(document.activeElement).toBe(search);
      expect(related.open).toBe(true);
    }

    auth.loading = false;
    auth.session =
      transition === 'account' ? { platformAccountId: 'a', isPlatformOperator: false } : null;
    firebase.error = null;
    firebase.user = { uid: transition === 'different account' ? 'school-b' : 'school-a' };
    selection.current =
      transition === 'different campus'
        ? { ...ready, selectedSchool: { id: 'nthu', name: '清華大學' } }
        : ready;
    navigation.search = transition === 'different campus' ? 'campus=nthu' : 'campus=pu';
    window.history.replaceState({}, '', `/map?${navigation.search}`);
    if (transition === 'account' || transition === 'temporary failure') {
      fireEvent.change(search, { target: { value: '教材' } });
    }
    view.rerender(<CampusServiceMenu />);

    expect(screen.getByRole('searchbox')).toBe(search);
    if (transition.startsWith('different')) {
      expect(menu.open).toBe(false);
      expect(related.open).toBe(false);
      expect(search.value).toBe('');
      expect(
        screen.getByRole('button', { name: '篩選學習與課務' }).getAttribute('aria-pressed'),
      ).toBe('false');
      return;
    }
    expect(menu.open).toBe(true);
    expect(document.activeElement).toBe(search);
    expect(
      screen.getByRole('button', { name: '篩選學習與課務' }).getAttribute('aria-pressed'),
    ).toBe('true');
    if (transition === 'campus') expect(related.open).toBe(true);
    else expect(search.value).toBe('教材');
  },
);

it.each([
  ['account', false],
  ['campus', false],
  ['first campus differs from fallback', false],
  ['catalog error', false],
  ['account', true],
] as const)(
  'saves a return before %s confirmation (dismiss before confirmation: %s)',
  (pending, dismiss) => {
    const school = { id: 'pu', name: '靜宜大學' };
    auth.loading = pending === 'account';
    if (pending !== 'account') {
      selection.current = pending === 'catalog error'
        ? { loading: false, catalogStatus: 'error', selectedSchool: null }
        : { loading: true, catalogStatus: 'loading', selectedSchool: null };
    }
    const view = render(<CampusServiceMenu />);
    fireEvent.click(screen.getByText('所有服務'));
    fireEvent.click(screen.getByRole('button', { name: '篩選學習與課務' }));
    if (pending === 'account') {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: '教材' } });
    } else {
      fireEvent.click(screen.getByLabelText('課程與作業的相關服務'));
    }
    const link = screen.getByRole<HTMLAnchorElement>('link', { name: '教材收藏' });
    fireEvent.click(link);
    const origin = captureMenuOrigin();
    expect(origin.state).toHaveProperty(MENU_RETURN_STATE_KEY);
    expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);
    visitMenuDestination(link.href);
    view.rerender(<CampusServiceMenu />);
    returnToMenuOrigin(origin);
    view.rerender(<CampusServiceMenu />);
    expect(screen.getByText('所有服務').closest('details')!.open).toBe(false);

    if (dismiss) {
      fireEvent.click(screen.getByText('所有服務'));
      fireEvent.click(screen.getByRole('button', { name: '關閉所有服務' }));
    }
    auth.loading = false;
    if (pending === 'account') auth.session = { platformAccountId: 'a', isPlatformOperator: false };
    else selection.current = {
      loading: false,
      catalogStatus: 'ready',
      selectedSchool: pending === 'first campus differs from fallback' ? { id: 'nthu', name: '清華大學' } : school,
    };
    view.rerender(<CampusServiceMenu />);
    expect(screen.getByText('所有服務').closest('details')!.open).toBe(!dismiss);
    if (dismiss) {
      expect(window.history.state).not.toHaveProperty(MENU_RETURN_STATE_KEY);
      expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('');
      return;
    }
    expect(
      screen.getByRole('button', { name: '篩選學習與課務' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe(pending === 'account' ? '教材' : '');
    if (pending !== 'account') {
      expect(screen.getByRole('link', { name: '教材收藏' }).closest('details')!.open).toBe(true);
    }
  },
);
