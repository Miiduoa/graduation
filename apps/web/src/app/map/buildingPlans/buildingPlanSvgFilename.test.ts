import { describe, expect, it } from 'vitest';
import { getBuildingPlanSvgFilename } from './buildingPlanSvgFilename';

describe('getBuildingPlanSvgFilename', () => {
  it('identifies Chinese plans and all-floor or single-floor selections', () => {
    expect(getBuildingPlanSvgFilename('教學館')).toBe('平面圖-教學館-全部樓層.svg');
    expect(getBuildingPlanSvgFilename('教學館', '地下一樓 B１')).toBe('平面圖-教學館-單層-地下一樓 B１.svg');
    expect(getBuildingPlanSvgFilename('研究館', '2F')).toBe('平面圖-研究館-單層-2F.svg');
    expect(getBuildingPlanSvgFilename('教學館', '全部樓層')).toBe('平面圖-教學館-單層-全部樓層.svg');
  });

  it('removes platform-unsafe punctuation, controls and bidi overrides', () => {
    expect(getBuildingPlanSvgFilename(' .圖面/甲:乙? .', 'B1\\機房*')).toBe('平面圖-圖面 甲 乙-單層-B1 機房.svg');
    expect(getBuildingPlanSvgFilename('甲\u0000\u001f\u007f\u202e\u2066乙', '<>:"/\\|?*')).toBe('平面圖-甲 乙-單層-未命名樓層.svg');
    expect(getBuildingPlanSvgFilename('CON', 'LPT1')).toBe('平面圖-CON-單層-LPT1.svg');
    expect(getBuildingPlanSvgFilename('AUX.txt', '-1F')).toBe('平面圖-AUX.txt-單層--1F.svg');
  });

  it.each(['', ' \t\n ', '... ', '<>:"/\\|?*', '_-()'])('uses readable fallbacks for %j', value => {
    expect(getBuildingPlanSvgFilename(value, value)).toBe('平面圖-未命名圖面-單層-未命名樓層.svg');
    expect(getBuildingPlanSvgFilename(value)).toBe('平面圖-未命名圖面-全部樓層.svg');
  });

  it.each(['校', 'A', '𠮷'])('bounds long %s names without splitting Unicode code points', character => {
    const name = getBuildingPlanSvgFilename(character.repeat(100), character.repeat(100));
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(150);
    expect(name).not.toContain('\uFFFD');
    const size = new TextEncoder().encode(character).length;
    expect(name).toBe('平面圖-' + character.repeat(Math.floor(80 / size)) + '-單層-' + character.repeat(Math.floor(48 / size)) + '.svg');
  });

  it('normalizes equivalent text and stays stable across repeated downloads', () => {
    const name = getBuildingPlanSvgFilename('Cafe\u0301・校園', '二樓（東側）');
    expect(name).toBe('平面圖-Café・校園-單層-二樓（東側）.svg');
    expect(getBuildingPlanSvgFilename('Café・校園', '二樓（東側）')).toBe(name);
    expect(getBuildingPlanSvgFilename('Cafe\u0301・校園', '二樓（東側）')).toBe(name);
  });
});
