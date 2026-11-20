import { resolveDeprecatedRouteRedirect } from '../app/deprecatedRouteRedirect';

test.each(['Clubs', 'Career'])(
  'retired campus route %s remaps to today',
  (route) => {
    expect(resolveDeprecatedRouteRedirect(route)).toEqual({
      tab: 'Today',
      screen: 'TodayHome',
    });
  },
);

test.each(['DormitoryScreen', 'Dormitory'])('%s redirects to the registered campus dormitory', (route) => {
  expect(resolveDeprecatedRouteRedirect(route)).toEqual({ tab: '校園', screen: 'Dormitory' });
  expect(resolveDeprecatedRouteRedirect('CampusHome')).toBeUndefined();
});
