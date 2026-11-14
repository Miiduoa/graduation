import { isRouteRegistered, safeNavigate, resolveTabForRoute } from '../utils/safeNavigate';

jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Alert } = require('react-native');

beforeEach(() => {
  (Alert.alert as jest.Mock).mockClear();
});

function makeNavigation(routes: string[], navigateImpl?: jest.Mock) {
  const navigate = navigateImpl ?? jest.fn();
  const state = {
    routeNames: routes,
    routes: routes.map((name) => ({ name })),
  };
  return {
    navigate,
    getState: () => state,
    getParent: () => null,
  };
}

describe('isRouteRegistered', () => {
  test('找得到 → true', () => {
    const nav = makeNavigation(['Home', 'Settings']);
    expect(isRouteRegistered(nav, 'Home')).toBe(true);
  });

  test('找不到 → false', () => {
    const nav = makeNavigation(['Home']);
    expect(isRouteRegistered(nav, 'NotExist')).toBe(false);
  });

  test('navigation null → false', () => {
    expect(isRouteRegistered(null, 'X')).toBe(false);
  });
});

describe('resolveTabForRoute', () => {
  test('學習 tab 的 route', () => {
    expect(resolveTabForRoute('CourseModules')).toBe('學習');
    expect(resolveTabForRoute('CourseScores')).toBe('學習');
    expect(resolveTabForRoute('TodayCockpit')).toBe('學習');
  });

  test('校園 tab 的 route', () => {
    expect(resolveTabForRoute('餐廳總覽')).toBe('校園');
    expect(resolveTabForRoute('Ordering')).toBe('校園');
  });

  test('訊息 tab 的 route', () => {
    expect(resolveTabForRoute('Inbox')).toBe('訊息');
  });

  test('我的 tab 的 route', () => {
    expect(resolveTabForRoute('Achievements')).toBe('我的');
    expect(resolveTabForRoute('Settings')).toBe('我的');
    expect(resolveTabForRoute('StudentCard')).toBe('我的');
  });

  test('未知 route → null', () => {
    expect(resolveTabForRoute('TotallyMadeUpRoute')).toBeNull();
  });
});

describe('safeNavigate / same-stack', () => {
  test.each(['Today', '學習'])('從 %s 開啟助理權限仍透過我的分頁', (tab) => {
    const tabs = {
      getState: () => ({
        routeNames: ['Today', '學習', '我的'],
        routes: [
          { name: tab },
          {
            name: '我的',
            state: {
              routeNames: ['MeHome', 'Settings', 'AssistantPermissions'],
              routes: [{ name: 'AssistantPermissions' }],
            },
          },
        ],
      }),
      getParent: () => null,
    };
    const nav = { ...makeNavigation(['CampusAssistant']), getParent: () => tabs };
    expect(isRouteRegistered(nav, 'AssistantPermissions')).toBe(false);
    expect(safeNavigate(nav, 'AssistantPermissions')).toBe(true);
    expect(nav.navigate).toHaveBeenCalledTimes(1);
    expect(nav.navigate).toHaveBeenCalledWith('我的', {
      screen: 'AssistantPermissions',
      params: undefined,
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('在我的分頁仍直接開啟已註冊的助理權限', () => {
    const nav = makeNavigation(['MeHome', 'Settings', 'AssistantPermissions']);
    expect(safeNavigate(nav, 'AssistantPermissions')).toBe(true);
    expect(nav.navigate).toHaveBeenCalledTimes(1);
    expect(nav.navigate).toHaveBeenCalledWith('AssistantPermissions', undefined);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('從搜尋再次開啟已拜訪分頁的課表，仍透過該分頁導航', () => {
    const tabs = {
      getState: () => ({
        routeNames: ['學習', '我的'],
        routes: [
          {
            name: '學習',
            state: {
              routeNames: ['LearnHome', 'PersonalTimetable'],
              routes: [{ name: 'PersonalTimetable' }],
            },
          },
          {
            name: '我的',
            state: { routeNames: ['MeHome', 'GlobalSearch'], routes: [{ name: 'GlobalSearch' }] },
          },
        ],
      }),
      getParent: () => null,
    };
    const nav = { ...makeNavigation(['MeHome', 'GlobalSearch']), getParent: () => tabs };
    expect(isRouteRegistered(nav, 'PersonalTimetable')).toBe(false);
    expect(safeNavigate(nav, 'PersonalTimetable', { term: '1151' })).toBe(true);
    expect(nav.navigate).toHaveBeenCalledWith('學習', {
      screen: 'PersonalTimetable',
      params: { term: '1151' },
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('內層畫面仍可直接導向祖先 navigator 的合法路由', () => {
    const parent = makeNavigation(['Main', 'Login']);
    const nav = { ...makeNavigation(['GlobalSearch']), getParent: () => parent };
    expect(isRouteRegistered(nav, 'Login')).toBe(true);
    expect(safeNavigate(nav, 'Login', { returnTo: 'GlobalSearch' })).toBe(true);
    expect(nav.navigate).toHaveBeenCalledWith('Login', { returnTo: 'GlobalSearch' });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('從搜尋或首頁可直接開啟學習頁的個人課表', () => {
    const nav = makeNavigation(['GlobalSearch']);
    expect(safeNavigate(nav, 'PersonalTimetable', { term: '1151' })).toBe(true);
    expect(nav.navigate).toHaveBeenCalledWith('學習', {
      screen: 'PersonalTimetable',
      params: { term: '1151' },
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('route 存在當前 stack → 直接 navigate', () => {
    const navigate = jest.fn();
    const nav = makeNavigation(['Home'], navigate);
    const ok = safeNavigate(nav, 'Home', { a: 1 });
    expect(ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith('Home', { a: 1 });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('route 不在當前 stack 但 registry 有對應 tab → cross-tab navigate', () => {
    const navigate = jest.fn();
    // 模擬「Today」tab 內，route='CourseModules' 應該 cross-tab 到「學習」
    const nav = makeNavigation(['TodayHome'], navigate);
    const ok = safeNavigate(nav, 'CourseModules', { groupId: 'c1' });
    expect(ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith('學習', {
      screen: 'CourseModules',
      params: { groupId: 'c1' },
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('route 既不在當前 stack 也不在 registry → Alert', () => {
    const navigate = jest.fn();
    const nav = makeNavigation(['Home'], navigate);
    const ok = safeNavigate(nav, 'TotallyMadeUp');
    expect(ok).toBe(false);
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  test('fallbackMessage = null → 不顯示 Alert', () => {
    const navigate = jest.fn();
    const nav = makeNavigation(['Home'], navigate);
    safeNavigate(nav, 'TotallyMadeUp', undefined, { fallbackMessage: null });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('navigation 為 null → Alert', () => {
    safeNavigate(null, 'X');
    expect(Alert.alert).toHaveBeenCalled();
  });

  test('Alert 文案不包含「即將推出」', () => {
    safeNavigate(makeNavigation(['Home']), 'NotExist');
    const calls = (Alert.alert as jest.Mock).mock.calls;
    const allText = calls.flat().join(' ');
    expect(allText).not.toContain('即將推出');
  });
});


test.each([
  'CampusSocialScreen',
  'BoardDetail',
  'PostCompose',
  'CreatorPostCompose',
  'PostDetail',
  'StoryCompose',
  'CreatorProfile',
])('%s 從其他分區進入交流，既有同堆疊路由仍原地開啟', (route) => {
  const fromMe = makeNavigation(['MeHome']);
  expect(safeNavigate(fromMe, route, { postId: 'p1' })).toBe(true);
  expect(fromMe.navigate).toHaveBeenCalledWith('訊息', { screen: route, params: { postId: 'p1' } });
  const currentStack = makeNavigation(['Inbox', route]);
  expect(safeNavigate(currentStack, route, { postId: 'p1' })).toBe(true);
  expect(currentStack.navigate).toHaveBeenCalledWith(route, { postId: 'p1' });
  const legacyHome = makeNavigation(['TodayHome', route]);
  expect(safeNavigate(legacyHome, route)).toBe(true);
  expect(legacyHome.navigate).toHaveBeenCalledWith(route, undefined);
});

test('通知的跨分區入口屬於交流，舊我的堆疊仍可直接返回原處', () => {
  const fromToday = makeNavigation(['TodayHome']);
  expect(safeNavigate(fromToday, 'Notifications')).toBe(true);
  expect(fromToday.navigate).toHaveBeenCalledWith('訊息', {
    screen: 'Notifications',
    params: undefined,
  });
  const legacyMe = makeNavigation(['MeHome', 'Notifications']);
  expect(safeNavigate(legacyMe, 'Notifications')).toBe(true);
  expect(legacyMe.navigate).toHaveBeenCalledWith('Notifications', undefined);
});
