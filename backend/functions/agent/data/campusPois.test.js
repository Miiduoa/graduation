'use strict';

const { CAMPUS_POIS, getPoiById, searchPois } = require('./campusPois');

describe('campusPois 靜宜 POI 逐筆翻修', () => {
  it('與核對資料一致且座標落在校園合理範圍', () => {
    expect(CAMPUS_POIS).toHaveLength(34);
    expect(getPoiById('pu-xijia')).toMatchObject({
      name: '希嘉學苑',
      lat: 24.228017,
      lng: 120.58067,
      sourceUrl: 'https://www.openstreetmap.org/relation/9246899',
    });
    expect(searchPois('宿舍').map((p) => p.id).sort()).toEqual(['pu-sigao', 'pu-xijia']);
    expect(searchPois('廁所').map((p) => p.id).sort()).toEqual(['pu-sigao', 'pu-xijia']);
    expect(searchPois('影印').map((p) => p.id).sort()).toEqual(['pu-library', 'pu-zhishan']);
    expect(searchPois('善牧')).toEqual([]);
    for (const poi of CAMPUS_POIS) {
      expect(poi.lat).toBeGreaterThan(24.22);
      expect(poi.lat).toBeLessThan(24.235);
      expect(poi.lng).toBeGreaterThan(120.57);
      expect(poi.lng).toBeLessThan(120.59);
      expect(poi.sourceUrl).toMatch(/^https:\/\//);
      expect(['cross-checked', 'single-source']).toContain(poi.verification);
    }
    expect(getPoiById('pu-zhugu')).toMatchObject({ name: '主顧樓', lat: 24.226939, lng: 120.583587 });
    expect(getPoiById('pu-gym')?.name).toBe('若望保祿二世體育館');
    expect(getPoiById('pu-health')?.name).toBe('保健中心');
  });

  it('舊清單對不上核對資料的地點已移除，搜尋不再回舊地點', () => {
    for (const removedId of ['pu-providence', 'pu-research1', 'pu-dorm-faith', 'pu-track', 'pu-atm', 'pu-gate-main', 'pu-bus-stop']) {
      expect(getPoiById(removedId)).toBeUndefined();
    }
    expect(searchPois('主顧樓').map((p) => p.id)).toEqual(['pu-zhugu', 'pu-bus-zhugu']);
    expect(searchPois('田徑場')).toEqual([]);
  });

  it('不再提供未核對的校園路網推算', () => {
    const mod = require('./campusPois');
    expect(mod.CAMPUS_PATH_NODES).toBeUndefined();
    expect(mod.planRouteBetweenPois).toBeUndefined();
    expect(mod.findShortestPath).toBeUndefined();
  });
});
