import { getMobileQuickActions, getMobileActionsForDestinations } from '../services/quickCampusActions';
import { CAMPUS_QUICK_DESTINATIONS, suggestCampusDestinations } from '@campus/shared/src/campusIntent';
import { ROUTE_TO_TAB } from '../utils/routeRegistry';

test.each([
  ['圖書館怎麼走', '/map', 'MapV2'],
  ['我要交作業', '/classroom', 'CoursesHome'],
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
    expect.objectContaining({ destination: '/classroom', route: 'CoursesHome' }),
  ]);
  expect(suggestCampusDestinations('')).toEqual([]);
});

test('every allowed voice route lands on a registered native screen', () => {
  const actions = getMobileActionsForDestinations(CAMPUS_QUICK_DESTINATIONS);
  expect(actions).toHaveLength(33);
  for (const action of actions) {
    expect(ROUTE_TO_TAB[action.route]).toBeTruthy();
    expect(action.description.length).toBeGreaterThan(0);
  }
});
