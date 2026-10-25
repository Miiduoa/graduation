import { describe, expect, it } from 'vitest';
import { getQuickCampusActions } from './quickCampusActions';

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
