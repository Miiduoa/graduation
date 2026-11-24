import {
  getMobileQuickActions,
  getMobileActionsForDestinations,
} from '../services/quickCampusActions';
import {
  CAMPUS_QUICK_DESTINATIONS,
  suggestCampusDestinations,
} from '@campus/shared/src/campusIntent';
import { ROUTE_TO_TAB } from '../utils/routeRegistry';

test.each([
  ['圖書館怎麼走', '/map', 'MapV2'],
  ['我要交作業', '/classroom', 'CoursesHome'],
  ['開啟 WOW Class', '/school-courses', 'CoursesHome'],
  ['查看 TronClass', '/school-courses', 'CoursesHome'],
  ['我要看玩課雲', '/school-courses', 'CoursesHome'],
  ['我想查公車到站時間', '/bus', 'BusV2'],
  ['宿舍報修', '/dormitory', 'Dormitory'],
  ['我想找社團', '/clubs', 'Clubs'],
  ['我找不到我的東西', '/lost-found', 'PlatformLostFound'],
  ['遺失錢包了', '/lost-found', 'PlatformLostFound'],
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
  expect(actions).toHaveLength(34);
  for (const action of actions) {
    expect(ROUTE_TO_TAB[action.route]).toBeTruthy();
    expect(action.description.length).toBeGreaterThan(0);
  }
});

test('keeps branded school navigation separate from general course and timetable requests', () => {
  expect(getMobileQuickActions('TronClass 教材').map((action) => action.destination)).toEqual([
    '/school-courses',
    '/classroom',
  ]);
  expect(getMobileQuickActions('課堂教材').map((action) => action.destination)).toEqual([
    '/classroom',
  ]);
  expect(getMobileQuickActions('查課表').map((action) => action.destination)).toEqual([
    '/timetable',
  ]);
  expect(getMobileQuickActions('tronclassroom')).toEqual([]);
});


test('失物捷徑與平台 Google 入口一致，並支援從其他 tab 開啟', () => {
  const [action] = getMobileActionsForDestinations(['/lost-found']);
  expect(action).toEqual({
    destination: '/lost-found',
    route: 'PlatformLostFound',
    label: '失物招領',
    description: '使用 Google 帳號查看、刊登與管理失物',
  });
  expect(ROUTE_TO_TAB.PlatformLostFound).toBe('校園');
  expect(ROUTE_TO_TAB.LostFound).toBe('校園');
});

// International students should reach the same registered screens without AI.
test.each([
  [
    "Where is the library?",
    "/map",
    "MapV2"
  ],
  [
    "Where is the bus stop?",
    "/bus",
    "BusV2"
  ],
  [
    "library catalog",
    "/library",
    "Library"
  ],
  [
    "class schedule",
    "/timetable",
    "PersonalTimetable"
  ],
  [
    "homework deadline",
    "/classroom",
    "CoursesHome"
  ],
  [
    "cafeteria menu",
    "/cafeteria",
    "餐廳總覽"
  ],
  [
    "campus events",
    "/events",
    "活動總覽"
  ],
  [
    "lost and found",
    "/lost-found",
    "PlatformLostFound"
  ],
  [
    "ＢＵＳ arrival",
    "/bus",
    "BusV2"
  ]
])('matches bilingual campus intent %s', (phrase, destination, route) => {
  expect(getMobileQuickActions(phrase)[0]).toMatchObject({ destination, route });
});

test.each(['business plan', 'busyness', 'libraryish', 'where is my wallet'])('does not infer a campus service from a partial word or ungrounded location (%s)', phrase => {
  expect(getMobileQuickActions(phrase)).toEqual([]);
});

// Dictation and pasted text can contain repeated spaces or typographic apostrophes.
test.each([
  [
    "class   schedule",
    "/timetable",
    "PersonalTimetable"
  ],
  [
    "Where’s the library?",
    "/map",
    "MapV2"
  ],
  [
    "campus\t events",
    "/events",
    "活動總覽"
  ],
  [
    "quiz",
    "/classroom",
    "CoursesHome"
  ],
  [
    "quizzes",
    "/classroom",
    "CoursesHome"
  ]
])('normalizes spoken and pasted search text %s', (phrase, destination, route) => {
  expect(getMobileQuickActions(phrase)[0]).toMatchObject({ destination, route });
});
