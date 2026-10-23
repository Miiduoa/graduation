import { CAMPUS_BOUNDS, CAMPUS_POIS, getCampusPoi } from '../../data/puCampusData';

// 與 apps/web/src/app/map/providenceCampus.ts 核對資料逐筆一致的預期值
// （id、名稱、座標）；資料更新時兩邊要一起改，見 docs/campus-map-providence.md。
const AUDITED: ReadonlyArray<{
  id: string;
  name: string;
  lat: number;
  lng: number;
  verification: 'cross-checked' | 'single-source';
}> = [
  { id: 'pu-zhugu', name: '主顧樓', lat: 24.226939, lng: 120.583587, verification: 'cross-checked' },
  { id: 'pu-renyuan', name: '任垣樓', lat: 24.226415, lng: 120.580067, verification: 'cross-checked' },
  { id: 'pu-boduo', name: '伯鐸樓', lat: 24.22606, lng: 120.580649, verification: 'cross-checked' },
  { id: 'pu-wenxing', name: '文興樓', lat: 24.226953, lng: 120.581189, verification: 'cross-checked' },
  { id: 'pu-gelun', name: '格倫樓', lat: 24.226197, lng: 120.583373, verification: 'cross-checked' },
  { id: 'pu-fangji', name: '方濟樓', lat: 24.227864, lng: 120.583509, verification: 'cross-checked' },
  { id: 'pu-siyuan', name: '思源樓', lat: 24.226931, lng: 120.582346, verification: 'cross-checked' },
  { id: 'pu-jingan', name: '靜安樓', lat: 24.226214, lng: 120.5823, verification: 'cross-checked' },
  { id: 'pu-zhishan', name: '至善樓', lat: 24.228147, lng: 120.579773, verification: 'cross-checked' },
  { id: 'pu-library', name: '蓋夏圖書館', lat: 24.226282, lng: 120.581377, verification: 'cross-checked' },
  { id: 'pu-chapel', name: '主顧聖母堂', lat: 24.228164, lng: 120.581515, verification: 'cross-checked' },
  { id: 'pu-monastery', name: '修院', lat: 24.227833, lng: 120.582498, verification: 'cross-checked' },
  { id: 'pu-jingyuan', name: '靜園餐廳', lat: 24.227517, lng: 120.58157, verification: 'cross-checked' },
  { id: 'pu-yiyuan', name: '宜園餐廳', lat: 24.227152, lng: 120.579543, verification: 'cross-checked' },
  { id: 'pu-xijia', name: '希嘉學苑', lat: 24.228017, lng: 120.58067, verification: 'cross-checked' },
  { id: 'pu-sigao', name: '思高學苑', lat: 24.22906, lng: 120.58206, verification: 'cross-checked' },
  { id: 'pu-gym', name: '若望保祿二世體育館', lat: 24.229194, lng: 120.581062, verification: 'cross-checked' },
  { id: 'pu-pool', name: '溫水游泳池', lat: 24.229419, lng: 120.580272, verification: 'cross-checked' },
  { id: 'pu-health', name: '保健中心', lat: 24.228113, lng: 120.579668, verification: 'cross-checked' },
  { id: 'pu-post', name: '靜宜大學郵局', lat: 24.227962, lng: 120.579806, verification: 'cross-checked' },
  { id: 'pu-parking-p1', name: 'P1 停車場', lat: 24.226068, lng: 120.579524, verification: 'single-source' },
  { id: 'pu-parking-p2', name: 'P2 停車場', lat: 24.228698, lng: 120.582938, verification: 'single-source' },
  { id: 'pu-parking-moto', name: '機車停車場', lat: 24.224905, lng: 120.578225, verification: 'single-source' },
  { id: 'pu-gate-osm', name: '校園出入口（名稱待補）', lat: 24.225714, lng: 120.577096, verification: 'single-source' },
  { id: 'pu-bus-main-a', name: '靜宜大學', lat: 24.224972, lng: 120.577034, verification: 'cross-checked' },
  { id: 'pu-bus-main-b', name: '靜宜大學', lat: 24.22637, lng: 120.576622, verification: 'cross-checked' },
  { id: 'pu-bus-brt-a', name: '靜宜大學（專用道）', lat: 24.225323, lng: 120.577202, verification: 'cross-checked' },
  { id: 'pu-bus-brt-b', name: '靜宜大學（專用道）', lat: 24.225899, lng: 120.576538, verification: 'cross-checked' },
  { id: 'pu-bus-gate', name: '靜宜大學（校門）', lat: 24.2253, lng: 120.577797, verification: 'cross-checked' },
  { id: 'pu-bus-yingcai-a', name: '靜宜大學（英才路）', lat: 24.226645, lng: 120.574837, verification: 'cross-checked' },
  { id: 'pu-bus-yingcai-b', name: '靜宜大學（英才路）', lat: 24.227036, lng: 120.575356, verification: 'cross-checked' },
  { id: 'pu-bus-zhugu', name: '靜宜大學主顧樓', lat: 24.226601, lng: 120.583099, verification: 'cross-checked' },
  { id: 'pu-bus-chapel', name: '靜宜大學主顧聖母堂', lat: 24.227301, lng: 120.580704, verification: 'cross-checked' },
  { id: 'pu-bus-jingyuan', name: '靜宜大學靜園餐廳', lat: 24.227364, lng: 120.581741, verification: 'cross-checked' },
];

describe('puCampusData 靜宜 POI 逐筆翻修', () => {
  it('與核對資料逐筆一致（id、名稱、座標、可信程度、來源）', () => {
    expect(CAMPUS_POIS).toHaveLength(AUDITED.length);
    for (const expected of AUDITED) {
      const poi = getCampusPoi(expected.id);
      expect(poi).toBeDefined();
      expect(poi?.name).toBe(expected.name);
      expect(poi?.lat).toBe(expected.lat);
      expect(poi?.lng).toBe(expected.lng);
      expect(poi?.verification).toBe(expected.verification);
      expect(poi?.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it('座標落在校園合理範圍，不再拿到偏離約 1.6 公里的舊批次', () => {
    for (const poi of CAMPUS_POIS) {
      expect(poi.lat).toBeGreaterThan(24.22);
      expect(poi.lat).toBeLessThan(24.235);
      expect(poi.lng).toBeGreaterThan(120.57);
      expect(poi.lng).toBeLessThan(120.59);
    }
    expect(CAMPUS_BOUNDS.center.lng).toBeGreaterThan(120.576);
    expect(CAMPUS_BOUNDS.center.lng).toBeLessThan(120.585);
    expect(CAMPUS_BOUNDS.west).toBeGreaterThan(120.576);
    expect(CAMPUS_BOUNDS.east).toBeLessThan(120.585);
  });

  it('舊清單對不上核對資料的地點已移除', () => {
    for (const removedId of [
      'pu-providence',
      'pu-research1',
      'pu-admin',
      'pu-dorm-faith',
      'pu-dorm-ren',
      'pu-track',
      'pu-tennis',
      'pu-7eleven',
      'pu-atm',
      'pu-convent',
      'pu-gate-main',
      'pu-gate-back',
      'pu-bus-stop',
      'pu-arts',
      'pu-greenhouse',
    ]) {
      expect(getCampusPoi(removedId)).toBeUndefined();
    }
  });
});
