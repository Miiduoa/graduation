import { getMobileQuickActions, getMobileActionsForDestinations } from '../services/quickCampusActions';
import { CAMPUS_QUICK_DESTINATIONS, suggestCampusDestinations } from '@campus/shared/src/campusIntent';
import { ROUTE_TO_TAB } from '../utils/routeRegistry';

test.each([
  ['圖書館怎麼走', '/map', 'MapV2'],
  ['我要交作業', '/classroom', 'NuniWorkspace'],
  ['開啟 WOW Class', '/classroom', 'NuniWorkspace'],
  ['查看 TronClass', '/classroom', 'NuniWorkspace'],
  ['我要看玩課雲', '/classroom', 'NuniWorkspace'],
  ['我想查公車到站時間', '/bus', 'BusV2'],
  ['宿舍報修', '/dormitory', 'Dormitory'],
  ['請幫我看今天課表', '/timetable', 'PersonalTimetable'],
])('offers an existing destination for %s', (utterance, destination, screen) => {
  const actions = getMobileQuickActions(utterance);
  expect(actions[0]).toMatchObject({ destination, route: screen });
  expect(ROUTE_TO_TAB[actions[0].route]).toBeTruthy();
});

test('does not invent a write action for ambiguous or high-risk requests', () => {
  expect(getMobileQuickActions('幫我付款')).toEqual([]);
  expect(getMobileQuickActions('幫我刪除全部作業')).toEqual([
    expect.objectContaining({ destination: '/classroom', route: 'NuniWorkspace' }),
  ]);
  expect(suggestCampusDestinations('')).toEqual([]);
});

test('every allowed voice route lands on a registered native screen', () => {
  const actions = getMobileActionsForDestinations(CAMPUS_QUICK_DESTINATIONS);
  expect(actions).toHaveLength(CAMPUS_QUICK_DESTINATIONS.length);
  for (const action of actions) {
    expect(ROUTE_TO_TAB[action.route]).toBeTruthy();
    expect(action.description.length).toBeGreaterThan(0);
  }
});

test('routes retired school classroom names and course requests to the native classroom', () => {
  expect(getMobileQuickActions('TronClass 教材').map((action) => action.destination)).toEqual([
    '/classroom',
  ]);
  expect(getMobileQuickActions('課堂教材').map((action) => action.destination)).toEqual(['/classroom']);
  expect(getMobileQuickActions('查課表').map((action) => action.destination)).toEqual(['/timetable']);
  expect(getMobileQuickActions('tronclassroom')).toEqual([]);
});


test('both keyword and semantic course actions explicitly select the courses tab', () => {
  const expected = { route: 'NuniWorkspace', params: { tab: 'courses' } };
  expect(getMobileQuickActions('我要交作業')[0]).toMatchObject(expected);
  expect(getMobileActionsForDestinations(['/classroom'])[0]).toMatchObject(expected);
  expect(getMobileActionsForDestinations(['/classroom/account'])[0].params).toBeUndefined();
});
