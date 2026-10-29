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
    ['要看學期成績', '/grades'],
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
  const shortcutSet = new Set(CAMPUS_QUICK_DESTINATIONS);

  expect(serviceRoutes.length).toBe(serviceSet.size);
  expect(shortcutSet.size).toBe(CAMPUS_QUICK_DESTINATIONS.length);
  expect(CAMPUS_QUICK_DESTINATIONS).toHaveLength(34);
  expect([...shortcutSet].every(href => serviceSet.has(href))).toBe(true);

  // The leave workflow added these two routes to main after the original voice
  // feature was developed. They are not part of the voice allowlist until the
  // related authenticated interaction and review permissions are integrated.
  expect(serviceRoutes.filter(href => !shortcutSet.has(href as (typeof CAMPUS_QUICK_DESTINATIONS)[number]))).toEqual([
    '/leave',
    '/leave/review',
    '/school-lms',
  ]);
});

it.each([
  '打開 WOW Class',
  '查看 TronClass',
  '我要看玩課雲',
  'ＷＯＷ Ｃｌａｓｓ 的課程',
  'open wowclass',
  '進入 Tron Class',
])('opens the school course service for an explicit platform name: %s', (utterance) => {
  expect(getQuickCampusActions(utterance)).toEqual([
    expect.objectContaining({ href: '/school-courses', name: 'WOW Class 課程', access: 'school' }),
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
