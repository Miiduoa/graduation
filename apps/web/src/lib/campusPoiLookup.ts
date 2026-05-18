/**
 * Web-side POI lookup table for map deep links (?route= / ?focus=).
 * Mirrors backend/functions/agent/data/campusPois.js and
 * apps/mobile/src/data/puCampusData.ts — keep in sync when POI ids change.
 *
 * Only id/name/lat/lng are needed for map polyline drawing; richer fields stay
 * on backend.
 */
export interface CampusPoiLite {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: string;
}

export const CAMPUS_POIS_LITE: CampusPoiLite[] = [
  // 教學大樓
  { id: 'pu-providence', name: '主顧樓', lat: 24.22712, lng: 120.56517, category: 'academic' },
  { id: 'pu-renyuan', name: '任垣樓', lat: 24.22765, lng: 120.56453, category: 'academic' },
  { id: 'pu-boduo', name: '伯鐸樓', lat: 24.22695, lng: 120.56398, category: 'academic' },
  { id: 'pu-jingan', name: '靜安樓', lat: 24.2263, lng: 120.5649, category: 'academic' },
  { id: 'pu-gelun', name: '格倫樓', lat: 24.2268, lng: 120.5657, category: 'academic' },
  { id: 'pu-fangji', name: '方濟樓', lat: 24.2274, lng: 120.566, category: 'academic' },
  { id: 'pu-siyuan', name: '思源樓', lat: 24.2281, lng: 120.5653, category: 'academic' },
  { id: 'pu-wenxing', name: '文興樓', lat: 24.2266, lng: 120.5644, category: 'academic' },
  // 研究
  { id: 'pu-research1', name: '第一研究大樓', lat: 24.2285, lng: 120.5648, category: 'research' },
  { id: 'pu-research2', name: '第二研究大樓', lat: 24.2287, lng: 120.5642, category: 'research' },
  // 圖書館 / 行政
  { id: 'pu-library', name: '蓋夏圖書館', lat: 24.2275, lng: 120.5635, category: 'library' },
  { id: 'pu-admin', name: '行政大樓', lat: 24.2272, lng: 120.5638, category: 'admin' },
  { id: 'pu-intl', name: '國際暨兩岸事務處', lat: 24.2273, lng: 120.5643, category: 'admin' },
  // 餐廳
  { id: 'pu-jingyuan', name: '靜園餐廳', lat: 24.22615, lng: 120.56465, category: 'cafeteria' },
  { id: 'pu-yiyuan', name: '宜園餐廳', lat: 24.2259, lng: 120.5638, category: 'cafeteria' },
  { id: 'pu-zhishan', name: '至善美食廣場', lat: 24.2256, lng: 120.5632, category: 'cafeteria' },
  // 宿舍
  { id: 'pu-dorm-faith', name: '信德宿舍', lat: 24.2254, lng: 120.5658, category: 'dormitory' },
  { id: 'pu-dorm-hope', name: '望德宿舍', lat: 24.2252, lng: 120.5655, category: 'dormitory' },
  { id: 'pu-dorm-love', name: '愛德宿舍', lat: 24.225, lng: 120.5652, category: 'dormitory' },
  { id: 'pu-dorm-ren', name: '仁愛宿舍', lat: 24.2248, lng: 120.5649, category: 'dormitory' },
  // 運動 / 停車 / 便利商店
  { id: 'pu-gym', name: '體育館', lat: 24.2258, lng: 120.5635, category: 'sports' },
  { id: 'pu-track', name: '田徑場', lat: 24.2252, lng: 120.564, category: 'sports' },
  { id: 'pu-tennis', name: '網球場', lat: 24.2255, lng: 120.5628, category: 'sports' },
  { id: 'pu-basketball', name: '室外籃球場', lat: 24.2254, lng: 120.5633, category: 'sports' },
  { id: 'pu-parking-main', name: '主停車場', lat: 24.2249, lng: 120.5644, category: 'parking' },
  { id: 'pu-parking-north', name: '北側停車場', lat: 24.2288, lng: 120.5645, category: 'parking' },
  { id: 'pu-parking-moto', name: '機車停車場', lat: 24.2251, lng: 120.5648, category: 'parking' },
  { id: 'pu-7eleven', name: '7-ELEVEN 靜宜門市', lat: 24.2265, lng: 120.5651, category: 'convenience' },
  { id: 'pu-ok-mart', name: 'OK便利商店 至善店', lat: 24.2256, lng: 120.56325, category: 'convenience' },
  { id: 'pu-atm', name: '郵局ATM', lat: 24.2264, lng: 120.5648, category: 'convenience' },
  // 醫療 / 宗教 / 校門 / 其他
  { id: 'pu-health', name: '健康中心', lat: 24.2267, lng: 120.5643, category: 'medical' },
  { id: 'pu-chapel', name: '主顧聖母堂', lat: 24.2266, lng: 120.5632, category: 'religious' },
  { id: 'pu-gate-main', name: '正門（臺灣大道）', lat: 24.22495, lng: 120.56535, category: 'gate' },
  { id: 'pu-gate-back', name: '後門（英才路）', lat: 24.2292, lng: 120.5638, category: 'gate' },
  { id: 'pu-bus-stop', name: '靜宜大學站', lat: 24.2247, lng: 120.5654, category: 'gate' },
  { id: 'pu-arts', name: '藝術中心', lat: 24.2269, lng: 120.5635, category: 'other' },
  { id: 'pu-student-center', name: '學生活動中心', lat: 24.226, lng: 120.565, category: 'other' },
  { id: 'pu-auditorium', name: '至善國際會議廳', lat: 24.2257, lng: 120.563, category: 'other' },
];

const POI_BY_ID = new Map(CAMPUS_POIS_LITE.map((p) => [p.id, p]));

export function getCampusPoiLite(id: string): CampusPoiLite | undefined {
  return POI_BY_ID.get(id);
}

/** Approx Haversine distance in meters (for ETA). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const aH =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(aH), Math.sqrt(1 - aH));
}
