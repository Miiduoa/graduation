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

it('matches the complete Web service catalog without inventing destinations', () => {
  expect(CAMPUS_SERVICES).toHaveLength(33);
  expect(new Set(CAMPUS_SERVICES.map(row => row.href))).toEqual(
    new Set(CAMPUS_QUICK_DESTINATIONS),
  );
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
