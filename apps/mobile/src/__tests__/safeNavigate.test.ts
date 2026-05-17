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
    expect(resolveTabForRoute('GradeWhatIf')).toBe('學習');
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
  });

  test('未知 route → null', () => {
    expect(resolveTabForRoute('TotallyMadeUpRoute')).toBeNull();
  });
});

describe('safeNavigate / same-stack', () => {
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
