import { describe, expect, it } from 'vitest';
import { getQuickCampusActions } from './quickCampusActions';
import { CAMPUS_SERVICES } from './campusServices';
import { CAMPUS_QUICK_DESTINATIONS } from '@campus/shared/src/campusIntent';

describe('natural-language campus shortcuts', () => {
  it.each([
    ['今天要上什麼課？', '/timetable'],
    ['幫我交作業', '/classroom'],
    ['我要借書', '/library'],
    ['圖書館怎麼走', '/map'],
    ['我想查公車的到站時間', '/bus'],
    ['宿舍洗衣機報修', '/dormitory'],
    ['要看學期成績', '/grades?tab=semester'],
    ['開啟成績單', '/grades?tab=semester'],
    ['開啟我的成績', '/grades?tab=semester'],
    ['開啟成績回饋', '/grades?tab=feedback'],
    ['找附近的餐廳菜單', '/cafeteria'],
  ])('matches a spoken goal without inventing a service: %s', (utterance, href) => {
    expect(getQuickCampusActions(utterance)[0]?.href).toBe(href);
  });

  it('only returns existing service destinations and never a write operation', () => {
    const results = getQuickCampusActions('想先看課表再交作業');
    expect(results.map((result) => result.href)).toEqual(['/classroom', '/timetable']);
    expect(results.every((result) => result.href.startsWith('/'))).toBe(true);
  });

  it('does not guess for open-ended questions or empty speech', () => {
    expect(getQuickCampusActions('我最近好煩')).toEqual([]);
    expect(getQuickCampusActions('   ')).toEqual([]);
  });
});

it('keeps 34 navigable voice shortcuts inside the expanded service catalog', () => {
  const serviceRoutes = CAMPUS_SERVICES.map(row => row.href);
  const serviceSet = new Set(serviceRoutes);
  const shortcutSet = new Set<string>(
    CAMPUS_QUICK_DESTINATIONS.map(href => href === '/grades' ? '/grades?tab=semester' : href),
  );

  expect(serviceRoutes.length).toBe(serviceSet.size);
  expect(shortcutSet.size).toBe(CAMPUS_QUICK_DESTINATIONS.length);
  expect(CAMPUS_QUICK_DESTINATIONS).toHaveLength(34);
  expect([...shortcutSet].every(href => serviceSet.has(href))).toBe(true);

  // These entries are outside the legacy destination suggestion list of 34.
  // Explicit service-open requests are covered separately by assistantServices;
  // publishing a directory entry does not authorize a mutation through speech.
  expect(serviceRoutes.filter(href => !shortcutSet.has(href)).sort()).toEqual([
    '/career', '/classroom/material-bookmarks', '/leave', '/leave/review', '/orders', '/school-lms', '/social', '/student-card',
  ]);
});

it.each(['school', 'platform'] as const)(
  'opens the career service from an explicit request for a %s account',
  (audience) => {
    expect(getQuickCampusActions('開啟職涯', false, audience)).toEqual([
      expect.objectContaining({ href: '/career', destination: '/career', serviceId: 'career', access: 'public' }),
    ]);
  },
);

it.each([
  '打開 WOW Class',
  '查看 TronClass',
  '我要看玩課雲',
  'ＷＯＷ Ｃｌａｓｓ 的課程',
  'open wowclass',
  '進入 Tron Class',
])('opens the school course service for an explicit platform name: %s', (utterance) => {
  expect(getQuickCampusActions(utterance)).toEqual([
    expect.objectContaining({ href: '/school-courses', name: '校方課程', access: 'public' }),
  ]);
});

it('prioritizes a named school platform while preserving generic course suggestions', () => {
  expect(getQuickCampusActions('TronClass 上的作業').map((action) => action.href)).toEqual([
    '/school-courses', '/classroom',
  ]);
  expect(getQuickCampusActions('今天要上什麼課？').map((action) => action.href)).toEqual(['/timetable']);
  expect(getQuickCampusActions('我要看課堂教材').map((action) => action.href)).toEqual(['/classroom']);
});

it.each(['我的課堂', '課程', 'classroom', 'wow classical music', 'tronclassroom'])('does not infer WOW Class from a generic or partial name: %s', (utterance) => {
  expect(getQuickCampusActions(utterance).map((action) => action.href)).not.toContain('/school-courses');
});

it.each([
  ['匯入課表', '/import'],
  ['課程申訴單', '/appeals'],
  ['老師工作台', '/teacher'],
  ['我的課程群組', '/groups'],
  ['我的取餐訂單', '/food'],
  ['校園社群', '/community'],
  ['查看私訊', '/dms'],
  ['學校資格驗證', '/classroom/account'],
  ['刪除帳號', '/account-deletion'],
])('matches the existing service directory for %s', (utterance, expected) => {
  expect(getQuickCampusActions(utterance).map(row => row.href)).toContain(expected);
});

// Match the same public and study journeys as the native app.
it.each([
  [
    "Where is the library?",
    "/map"
  ],
  [
    "Where is the bus stop?",
    "/bus"
  ],
  [
    "library catalog",
    "/library"
  ],
  [
    "class schedule",
    "/timetable"
  ],
  [
    "homework deadline",
    "/classroom"
  ],
  [
    "cafeteria menu",
    "/cafeteria"
  ],
  [
    "campus events",
    "/events"
  ],
  [
    "lost and found",
    "/lost-found"
  ],
  [
    "ＢＵＳ arrival",
    "/bus"
  ]
])('finds the same bilingual service for %s', (phrase, href) => {
  expect(getQuickCampusActions(phrase)[0]?.href).toBe(href);
});

it.each(['business plan', 'busyness', 'libraryish', 'where is my wallet'])('does not guess from a partial word or ungrounded location (%s)', phrase => {
  expect(getQuickCampusActions(phrase)).toEqual([]);
});

it.each([
  [
    "class   schedule",
    "/timetable"
  ],
  [
    "Where’s the library?",
    "/map"
  ],
  [
    "campus\t events",
    "/events"
  ],
  [
    "quiz",
    "/classroom"
  ],
  [
    "quizzes",
    "/classroom"
  ]
])('normalizes spoken and pasted search text %s', (phrase, href) => {
  expect(getQuickCampusActions(phrase)[0]?.href).toBe(href);
});

it.each([
  ['Where can I find the library?', '/map'],
  ['Where are the classrooms?', '/map'],
  ['Where can I find the campus buildings?', '/map'],
  ['Where are the libraries?', '/map'],
  ['lost-and-found', '/lost-found'],
  ['lost&found', '/lost-found'],
  ['Where can I find a bus stop?', '/bus'],
])('resolves natural location and directory wording: %s', (phrase, href) => {
  expect(getQuickCampusActions(phrase)[0]?.href).toBe(href);
});

it.each(['where are my keys', 'where can i find my wallet', 'lostandfoundry'])(
  'does not invent a service for an unrelated request: %s',
  phrase => {
    expect(getQuickCampusActions(phrase)).toEqual([]);
  },
);

it.each([
  ['Where can I find the library catalog?', '/library'],
  ['Where is the library catalogue?', '/library'],
  ['Where’s the library catalog?', '/library'],
  ['Where can I find the library   catalog?', '/library'],
  ['Where can I find the library?', '/map'],
  ['Where can I find the library cataloging department?', '/map'],
])('distinguishes online library resources from physical navigation: %s', (phrase, href) => {
  expect(getQuickCampusActions(phrase).map(action => action.href)).toEqual([href]);
});

it.each([
  ['Directions to the library to use the library catalog', '/map'],
  ['Where can I find the library catalog and classrooms?', '/map'],
  ['Where can I find the library catalogue and bus stop?', '/bus'],
])('keeps both the physical route and catalog for an explicit mixed request: %s', (phrase, first) => {
  expect(getQuickCampusActions(phrase).map(action => action.href)).toEqual([first, '/library']);
});

it.each([
  ["館藏查詢在哪裡？", ["/library"]],
  ["圖書館館藏目錄在哪裡？", ["/library"]],
  ["館藏查詢系統的入口在哪裡？", ["/library"]],
  ["館藏搜尋在哪裡看？", ["/library"]],
  ["圖書館在哪裡？", ["/map"]],
  ["圖書館館藏查詢在哪一層？", ["/map"]],
  ["教室在哪裡？館藏查詢在哪裡？", ["/map","/library"]],
  ["館藏查詢在哪裡，圖書館怎麼走？", ["/map","/library"]],
  ["館藏查詢在哪裡？公車站在哪裡？", ["/bus","/library"]],
  ["館藏查詢在哪裡？今天課表", ["/timetable","/library"]],
])('distinguishes Chinese catalog access from physical navigation: %s', (phrase, expected) => {
  expect(getQuickCampusActions(phrase).map(action => action.href)).toEqual(expected);
});

it.each([
  ["作業在哪裡交？",["/classroom"]],
  ["作業在哪裡可以上傳？",["/classroom"]],
  ["教材在哪裡下載？",["/classroom"]],
  ["課表在哪裡看？",["/timetable"]],
  ["成績在哪裡查詢？",["/grades?tab=semester"]],
  ["行事曆在哪裡查看？",["/calendar"]],
  ["公告在哪裡看？",["/announcements"]],
  ["通知在哪裡看？",["/messages"]],
  ["課表在哪裡看？教室怎麼走？",["/map","/timetable"]],
  ["作業在哪裡交？圖書館在哪裡？",["/map","/classroom"]],
  ["作業在哪一間教室交？",["/map","/classroom"]],
  ["課表在哪裡看？館藏查詢在哪裡？",["/timetable","/library"]],
  ["課表在哪裡看？公車站在哪裡？",["/bus","/timetable"]],
  ["課表在哪裡看？作業在哪裡交？成績在哪裡查？",["/classroom","/timetable","/grades?tab=semester"]],
  ["作業在哪裡交給老師？",["/map","/classroom"]],
  ["教材在哪一層領取？",["/map","/classroom"]],
])('routes digital coursework and service access without losing physical destinations: %s', (phrase, expected) => {
  expect(getQuickCampusActions(phrase).map(action => action.href)).toEqual(expected);
});
