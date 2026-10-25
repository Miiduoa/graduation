import { getStateFromPath } from '@react-navigation/native';
import { rewriteLegacyShopsPath } from '../app/legacyShopsPath';
import { resolveDeprecatedRouteRedirect } from '../app/deprecatedRouteRedirect';

const linkingConfig = {
  screens: {
    Today: {
      screens: {
        TodayHome: 'home',
      },
    },
    校園: {
      screens: {
        CampusHome: 'campus',
      },
    },
  },
};

test.each(['Dormitory', 'DormitoryScreen', 'Clubs', 'Career'])(
  'retired campus route %s remaps to today',
  (route) => {
    expect(resolveDeprecatedRouteRedirect(route)).toEqual({
      tab: 'Today',
      screen: 'TodayHome',
    });
  },
);

test('old dormitory deep link resolves to today home, not an unavailable page', () => {
  const rewritten = rewriteLegacyShopsPath('dormitory');
  expect(rewritten).toBe('home');
  const state = getStateFromPath(rewritten, linkingConfig);
  expect(state?.routes[0]?.name).toBe('Today');
  expect(state?.routes[0]?.state?.routes[0]?.name).toBe('TodayHome');
});

test('DormitoryScreen in-app name is not left pointing at a missing Map route', () => {
  expect(resolveDeprecatedRouteRedirect('DormitoryScreen')?.screen).toBe('TodayHome');
  expect(resolveDeprecatedRouteRedirect('CampusHome')).toBeUndefined();
});
