import type { MapLocation } from './mapService';

/**
 * 靜宜大學校園地圖第一版的隨附地點資料。
 *
 * 建築與設施座標逐筆取自 OpenStreetMap 已命名的圖徵（查詢日期 2026-10-19，
 * Asia/Taipei），每筆都保留可回查的 OSM 元件網址；底圖與地點資料皆屬
 * OpenStreetMap 貢獻者，授權與署名見 https://www.openstreetmap.org/copyright
 * （ODbL）。校方校區平面圖只用來核對校舍名稱，不把平面圖當成座標來源。
 * 公車站牌取自 repo 內臺中市政府交通局靜態站牌快照（資料集
 * https://data.gov.tw/dataset/81555 ，快照日期 2026-10-18），同一座標的
 * 去返程合併為一個站牌點，路線只列名稱，到站時間一律回公車頁查即時資料。
 *
 * 這份資料只在 Firestore 查不到任何地點（確認為空）時使用；讀取失敗時
 * 不會拿這份資料假裝即時同步成功。出入口目前只有一筆 OSM 閘門標記，
 * 名稱待校方資料確認，其餘出入口標待補，不自行猜測位置。
 */

export const PROVIDENCE_CAMPUS_SOURCE = {
  retrievedAt: '2026-10-19',
  mapDataLabel: 'OpenStreetMap 貢獻者',
  mapDataUrl: 'https://www.openstreetmap.org/copyright',
  officialCampusMapUrl: 'https://gnl.pu.edu.tw/p/426-1007-8.php?Lang=zh-tw',
  officialDirectionsUrl: 'https://www.pu.edu.tw/p/406-1000-2733,r192.php?Lang=zh-tw',
  transitDatasetUrl: 'https://data.gov.tw/dataset/81555',
  transitCatalogDate: '2026-10-18',
} as const;

/** OpenStreetMap「靜宜大學」校園範圍（way 117553450）的外框與中心。 */
export const PROVIDENCE_CAMPUS_BOUNDS = {
  south: 24.224505,
  west: 120.5769241,
  north: 24.2298942,
  east: 120.5844232,
} as const;

export const PROVIDENCE_CAMPUS_CENTER = { lat: 24.2268822, lng: 120.580697 } as const;

type ProvidencePlace = MapLocation & { sourceUrl: string };

const osmWay = (id: number) => `https://www.openstreetmap.org/way/${id}`;
const osmNode = (id: number) => `https://www.openstreetmap.org/node/${id}`;

export const PROVIDENCE_CAMPUS_PLACES: readonly ProvidencePlace[] = [
  { id: 'pu-zhugu', name: '主顧樓', category: '教學', description: '', lat: 24.226939, lng: 120.583587, sourceUrl: osmWay(255784268) },
  { id: 'pu-renyuan', name: '任垣樓', category: '教學', description: '', lat: 24.226415, lng: 120.580067, sourceUrl: osmWay(255783833) },
  { id: 'pu-boduo', name: '伯鐸樓', category: '教學', description: '', lat: 24.22606, lng: 120.580649, sourceUrl: osmWay(255783866) },
  { id: 'pu-wenxing', name: '文興樓', category: '教學', description: '', lat: 24.226953, lng: 120.581189, sourceUrl: osmWay(255783884) },
  { id: 'pu-gelun', name: '格倫樓', category: '教學', description: '', lat: 24.226197, lng: 120.583373, sourceUrl: osmWay(255784254) },
  { id: 'pu-fangji', name: '方濟樓', category: '教學', description: '', lat: 24.227864, lng: 120.583509, sourceUrl: osmWay(255784368) },
  { id: 'pu-siyuan', name: '思源樓', category: '教學', description: '', lat: 24.226931, lng: 120.582346, sourceUrl: osmWay(295684731) },
  { id: 'pu-jingan', name: '靜安樓', category: '教學', description: '', lat: 24.226214, lng: 120.5823, sourceUrl: osmWay(293503497) },
  { id: 'pu-zhishan', name: '至善樓', category: '教學', description: '', lat: 24.228147, lng: 120.579773, sourceUrl: osmWay(255784219) },
  { id: 'pu-library', name: '蓋夏圖書館', category: '圖書館', description: '', lat: 24.226282, lng: 120.581377, sourceUrl: osmWay(255784049) },
  { id: 'pu-chapel', name: '主顧聖母堂', category: '宗教', description: '', lat: 24.228164, lng: 120.581515, sourceUrl: osmWay(665651135) },
  { id: 'pu-monastery', name: '修院', category: '宗教', description: '', lat: 24.227833, lng: 120.582498, sourceUrl: osmWay(255784429) },
  { id: 'pu-jingyuan', name: '靜園餐廳', category: '餐飲', description: '', lat: 24.227517, lng: 120.58157, sourceUrl: osmWay(255784235) },
  { id: 'pu-yiyuan', name: '宜園', category: '餐飲', description: '', lat: 24.227152, lng: 120.579543, sourceUrl: osmWay(255784490) },
  { id: 'pu-sigao', name: '思高學苑', category: '住宿', description: '', lat: 24.22906, lng: 120.58206, sourceUrl: osmWay(255784179) },
  { id: 'pu-gym', name: '若望保祿二世體育館', category: '運動', description: '', lat: 24.229194, lng: 120.581062, sourceUrl: osmWay(255784165) },
  { id: 'pu-pool', name: '游泳池', category: '運動', description: '', lat: 24.229419, lng: 120.580272, sourceUrl: osmWay(255784072) },
  { id: 'pu-health', name: '保健中心', category: '健康', description: '', lat: 24.228113, lng: 120.579668, sourceUrl: osmNode(4081270496) },
  { id: 'pu-post', name: '靜宜大學郵局', category: '生活', description: '', lat: 24.227962, lng: 120.579806, sourceUrl: osmNode(4081204265) },
  { id: 'pu-atm', name: '郵局 ATM', category: '生活', description: '', lat: 24.227058, lng: 120.582979, sourceUrl: osmNode(4081204266) },
  { id: 'pu-parking-p1', name: 'P1 停車場', category: '停車', description: '', lat: 24.226068, lng: 120.579524, sourceUrl: osmWay(295686299) },
  { id: 'pu-parking-p2', name: 'P2 停車場', category: '停車', description: '', lat: 24.228698, lng: 120.582938, sourceUrl: osmWay(295686298) },
  { id: 'pu-parking-moto', name: '機車停車場', category: '停車', description: '', lat: 24.224905, lng: 120.578225, sourceUrl: osmWay(405993001) },
  {
    id: 'pu-gate-osm',
    name: '校園出入口（名稱待補）',
    category: '交通',
    description: '此點是 OpenStreetMap 上的閘門標記，正式名稱待校方資料確認。',
    lat: 24.225714,
    lng: 120.577096,
    sourceUrl: osmNode(4692506551),
  },
];

export const PROVIDENCE_BUS_STOPS: readonly ProvidencePlace[] = [
  { id: 'pu-bus-main-a', name: '靜宜大學', category: '公車站', description: '行經路線：326、353、659。到站時間請到公車頁查詢。', lat: 24.224972, lng: 120.577034, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl },
  { id: 'pu-bus-main-b', name: '靜宜大學', category: '公車站', description: '行經路線：326、659。到站時間請到公車頁查詢。', lat: 24.22637, lng: 120.576622, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl },
  { id: 'pu-bus-brt-a', name: '靜宜大學（專用道）', category: '公車站', description: '行經路線：300、302、303、304、305、305W、306、306W、306繞、307、307副、308、308副、308副繞、309、310、310區1、310區2。到站時間請到公車頁查詢。', lat: 24.225323, lng: 120.577202, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl },
  { id: 'pu-bus-brt-b', name: '靜宜大學（專用道）', category: '公車站', description: '行經路線：300、302、303、304、305、305E、306、306E、306繞、307、307副、308、308副、309、310、310區1、310區2。到站時間請到公車頁查詢。', lat: 24.225899, lng: 120.576538, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl },
  { id: 'pu-bus-gate', name: '靜宜大學（校門）', category: '公車站', description: '行經路線：162、301、368。到站時間請到公車頁查詢。', lat: 24.2253, lng: 120.577797, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl },
  { id: 'pu-bus-yingcai-a', name: '靜宜大學（英才路）', category: '公車站', description: '行經路線：162、353、368。到站時間請到公車頁查詢。', lat: 24.226645, lng: 120.574837, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl },
  { id: 'pu-bus-yingcai-b', name: '靜宜大學（英才路）', category: '公車站', description: '行經路線：162、353、368。到站時間請到公車頁查詢。', lat: 24.227036, lng: 120.575356, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl },
  { id: 'pu-bus-zhugu', name: '靜宜大學主顧樓', category: '公車站', description: '行經路線：162、301、368。到站時間請到公車頁查詢。', lat: 24.226601, lng: 120.583099, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl },
  { id: 'pu-bus-chapel', name: '靜宜大學主顧聖母堂', category: '公車站', description: '行經路線：162、368。到站時間請到公車頁查詢。', lat: 24.227301, lng: 120.580704, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl },
  { id: 'pu-bus-jingyuan', name: '靜宜大學靜園餐廳', category: '公車站', description: '行經路線：301。到站時間請到公車頁查詢。', lat: 24.227364, lng: 120.581741, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl },
];

export function isBusStopLocation(location: MapLocation): boolean {
  return location.category === '公車站';
}

function samePlace(a: MapLocation, b: MapLocation): boolean {
  const latGap = Math.abs(a.lat - b.lat);
  const lngGap = Math.abs(a.lng - b.lng);
  return a.name === b.name && latGap < 0.0005 && lngGap < 0.0005;
}

/**
 * 靜宜第一版地點組裝：
 * - Firestore 有地點時以它為準，只補上還沒有的公車站牌，讓建築與站牌同圖。
 * - Firestore 確認為空時，改用隨附的 OpenStreetMap 建築資料加站牌。
 * - 其他學校原樣回傳，不混入靜宜資料。
 */
export function withProvidenceCampusPlaces(
  schoolId: string,
  locations: readonly MapLocation[],
): MapLocation[] {
  if (schoolId !== 'pu') return [...locations];
  const base: readonly MapLocation[] = locations.length ? locations : PROVIDENCE_CAMPUS_PLACES;
  const merged = [...base];
  for (const stop of PROVIDENCE_BUS_STOPS) {
    if (!merged.some((place) => samePlace(place, stop))) merged.push(stop);
  }
  return merged.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

export function providencePlaceSourceUrl(location: MapLocation): string | null {
  const place = [...PROVIDENCE_CAMPUS_PLACES, ...PROVIDENCE_BUS_STOPS].find(
    (entry) => entry.id === location.id,
  );
  return place?.sourceUrl ?? null;
}
