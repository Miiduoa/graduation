import { isRouteRegistered, safeNavigate } from '../utils/safeNavigate';

// Alert mock — react-native 預設沒有 Alert.alert 的回呼
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

describe('safeNavigate', () => {
  test('route 存在 → 呼叫 navigate', () => {
    const navigate = jest.fn();
    const nav = makeNavigation(['Home'], navigate);
    const ok = safeNavigate(nav, 'Home', { a: 1 });
    expect(ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith('Home', { a: 1 });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('route 不存在 → 顯示 Alert，不呼叫 navigate', () => {
    const navigate = jest.fn();
    const nav = makeNavigation(['Home'], navigate);
    const ok = safeNavigate(nav, 'NotExist');
    expect(ok).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  test('route 不存在 + 有 fallback route → 跳 fallback', () => {
    const navigate = jest.fn();
    const nav = makeNavigation(['Home', 'Fallback'], navigate);
    const ok = safeNavigate(nav, 'NotExist', undefined, {
      fallbackRoute: 'Fallback',
    });
    expect(ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith('Fallback', undefined);
  });

  test('fallbackMessage = null → 不顯示 Alert', () => {
    const navigate = jest.fn();
    const nav = makeNavigation(['Home'], navigate);
    safeNavigate(nav, 'NotExist', undefined, { fallbackMessage: null });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('fallbackTitle 客製', () => {
    const nav = makeNavigation(['Home']);
    safeNavigate(nav, 'NotExist', undefined, {
      fallbackTitle: '功能調整中',
      fallbackMessage: '預計下週開放',
    });
    expect(Alert.alert).toHaveBeenCalledWith('功能調整中', '預計下週開放');
  });

  test('navigation 為 null → Alert', () => {
    safeNavigate(null, 'X');
    expect(Alert.alert).toHaveBeenCalled();
  });
});
