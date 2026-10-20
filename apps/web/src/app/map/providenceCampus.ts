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
 *
 * 逐筆核對紀錄（2026-10-19）：建築點位逐筆檢查是否落在 OpenStreetMap
 * 對應建築範圍內，並與校方「校園地圖實境導覽」的建築名單核對名稱。
 * 對得上標 cross-checked；只有單一來源的標 single-source，畫面會顯示
 * 「待確認」。「郵局 ATM」只有單一節點、又不在任何已核對建築範圍內，
 * 已先拿下，不為了湊數留著。完整逐筆表見 docs/campus-map-providence.md。
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

export type ProvidenceVerification = 'cross-checked' | 'single-source';

export type ProvidencePlace = MapLocation & {
  sourceUrl: string;
  verification: ProvidenceVerification;
  /** 公車站牌在臺中靜態資料中的代碼（TXG 快照 ID），供與公車資料逐筆對照。 */
  transitStopIds?: readonly string[];
};

const osmWay = (id: number) => `https://www.openstreetmap.org/way/${id}`;
const osmNode = (id: number) => `https://www.openstreetmap.org/node/${id}`;

export const PROVIDENCE_CAMPUS_PLACES: readonly ProvidencePlace[] = [
  { id: 'pu-zhugu', name: '主顧樓', category: '教學', description: '', lat: 24.226939, lng: 120.583587, sourceUrl: osmWay(255784268) , verification: 'cross-checked' },
  { id: 'pu-renyuan', name: '任垣樓', category: '教學', description: '', lat: 24.226415, lng: 120.580067, sourceUrl: osmWay(255783833) , verification: 'cross-checked' },
  { id: 'pu-boduo', name: '伯鐸樓', category: '教學', description: '', lat: 24.22606, lng: 120.580649, sourceUrl: osmWay(255783866) , verification: 'cross-checked' },
  { id: 'pu-wenxing', name: '文興樓', category: '教學', description: '', lat: 24.226953, lng: 120.581189, sourceUrl: osmWay(255783884) , verification: 'cross-checked' },
  { id: 'pu-gelun', name: '格倫樓', category: '教學', description: '', lat: 24.226197, lng: 120.583373, sourceUrl: osmWay(255784254) , verification: 'cross-checked' },
  { id: 'pu-fangji', name: '方濟樓', category: '教學', description: '', lat: 24.227864, lng: 120.583509, sourceUrl: osmWay(255784368) , verification: 'cross-checked' },
  { id: 'pu-siyuan', name: '思源樓', category: '教學', description: '', lat: 24.226931, lng: 120.582346, sourceUrl: osmWay(295684731) , verification: 'cross-checked' },
  { id: 'pu-jingan', name: '靜安樓', category: '教學', description: '', lat: 24.226214, lng: 120.5823, sourceUrl: osmWay(293503497) , verification: 'cross-checked' },
  { id: 'pu-zhishan', name: '至善樓', category: '教學', description: '', lat: 24.228147, lng: 120.579773, sourceUrl: osmWay(255784219) , verification: 'cross-checked' },
  { id: 'pu-library', name: '蓋夏圖書館', category: '圖書館', description: '', lat: 24.226282, lng: 120.581377, sourceUrl: osmWay(255784049) , verification: 'cross-checked' },
  { id: 'pu-chapel', name: '主顧聖母堂', category: '宗教', description: '', lat: 24.228164, lng: 120.581515, sourceUrl: osmWay(665651135) , verification: 'cross-checked' },
  { id: 'pu-monastery', name: '修院', category: '宗教', description: '', lat: 24.227833, lng: 120.582498, sourceUrl: osmWay(255784429) , verification: 'cross-checked' },
  { id: 'pu-jingyuan', name: '靜園餐廳', category: '餐飲', description: '', lat: 24.227517, lng: 120.58157, sourceUrl: osmWay(255784235) , verification: 'cross-checked' },
  { id: 'pu-yiyuan', name: '宜園餐廳', category: '餐飲', description: '', lat: 24.227152, lng: 120.579543, sourceUrl: osmWay(255784490) , verification: 'cross-checked' },
  { id: 'pu-sigao', name: '思高學苑', category: '住宿', description: '', lat: 24.22906, lng: 120.58206, sourceUrl: osmWay(255784179) , verification: 'cross-checked' },
  { id: 'pu-gym', name: '若望保祿二世體育館', category: '運動', description: '', lat: 24.229194, lng: 120.581062, sourceUrl: osmWay(255784165) , verification: 'cross-checked' },
  { id: 'pu-pool', name: '溫水游泳池', category: '運動', description: '', lat: 24.229419, lng: 120.580272, sourceUrl: osmWay(255784072) , verification: 'cross-checked' },
  { id: 'pu-health', name: '保健中心', category: '健康', description: '', lat: 24.228113, lng: 120.579668, sourceUrl: osmNode(4081270496) , verification: 'cross-checked' },
  { id: 'pu-post', name: '靜宜大學郵局', category: '生活', description: '', lat: 24.227962, lng: 120.579806, sourceUrl: osmNode(4081204265) , verification: 'cross-checked' },
  { id: 'pu-parking-p1', name: 'P1 停車場', category: '停車', description: '', lat: 24.226068, lng: 120.579524, sourceUrl: osmWay(295686299) , verification: 'single-source' },
  { id: 'pu-parking-p2', name: 'P2 停車場', category: '停車', description: '', lat: 24.228698, lng: 120.582938, sourceUrl: osmWay(295686298) , verification: 'single-source' },
  { id: 'pu-parking-moto', name: '機車停車場', category: '停車', description: '', lat: 24.224905, lng: 120.578225, sourceUrl: osmWay(405993001) , verification: 'single-source' },
  {
    id: 'pu-gate-osm',
    name: '校園出入口（名稱待補）',
    category: '交通',
    description: '此點是 OpenStreetMap 上的閘門標記，正式名稱待校方資料確認。',
    lat: 24.225714,
    lng: 120.577096,
    sourceUrl: osmNode(4692506551),
    verification: 'single-source',
  },
];

export const PROVIDENCE_BUS_STOPS: readonly ProvidencePlace[] = [
  { id: 'pu-bus-main-a', name: '靜宜大學', category: '公車站', description: '326 往新民高中（健行路）；353 往南社路二段；659 往臺中榮總（臺灣大道）。到站時間請到公車頁查詢。', lat: 24.224972, lng: 120.577034, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl, verification: 'cross-checked', transitStopIds: ['TCOD_5c1820048469418ab14e3b627afcf1e54cc4b91d', 'TCOD_6eed6192caf38e275f36febed73a6acda48c41f7'] },
  { id: 'pu-bus-main-b', name: '靜宜大學', category: '公車站', description: '326 進校；659 往幼獅工業區。到站時間請到公車頁查詢。', lat: 24.22637, lng: 120.576622, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl, verification: 'cross-checked', transitStopIds: ['TCOD_01e2e328dbd476564cbe8cd4ceab9346047a906e'] },
  { id: 'pu-bus-brt-a', name: '靜宜大學（專用道）', category: '公車站', description: '300、302、303、304、305、306、307、308、309、310 等往臺中車站／新民高中方向，以及返程往清水／梧棲／臺中港方向；逐路線方向請到公車頁確認。到站時間請到公車頁查詢。', lat: 24.225323, lng: 120.577202, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl, verification: 'cross-checked', transitStopIds: ['TCOD_a3eb12cd7bc5ef5e7beb42408b9015c16d04436a', 'TCOD_ec4bd6eea19fc0c5182e0860be9ac4dade525bae'] },
  { id: 'pu-bus-brt-b', name: '靜宜大學（專用道）', category: '公車站', description: '300、302、303、304、305、306、307、308、309、310 等往臺中車站（A月台）／新民高中方向。到站時間請到公車頁查詢。', lat: 24.225899, lng: 120.576538, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl, verification: 'cross-checked', transitStopIds: ['TCOD_30c48dcd80accb2daac3ca68a15fa443fd2088c3'] },
  { id: 'pu-bus-gate', name: '靜宜大學（校門）', category: '公車站', description: '162、301、368 進校有停；出校往沙鹿請到英才路側。到站時間請到公車頁查詢。', lat: 24.2253, lng: 120.577797, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl, verification: 'cross-checked', transitStopIds: ['TCOD_72dfbfbef3bc543b96291675dad44ca8a2701d35', 'TCOD_eba67998023fcd2725c1e14fcd9e045a542bae41'] },
  { id: 'pu-bus-yingcai-a', name: '靜宜大學（英才路）', category: '公車站', description: '368 往巨業沙鹿站；162 進校。到站時間請到公車頁查詢。', lat: 24.226645, lng: 120.574837, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl, verification: 'cross-checked', transitStopIds: ['TCOD_b1fdcc851bf598230da5a5253eeb0f6675e5076f'] },
  { id: 'pu-bus-yingcai-b', name: '靜宜大學（英才路）', category: '公車站', description: '162 往沙鹿火車站；368 進校。到站時間請到公車頁查詢。', lat: 24.227036, lng: 120.575356, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl, verification: 'cross-checked', transitStopIds: ['TCOD_de7d2ad63a55afc2c7bab7f102d30eac34f05934'] },
  { id: 'pu-bus-zhugu', name: '靜宜大學主顧樓', category: '公車站', description: '162、301、368 往校內。到站時間請到公車頁查詢。', lat: 24.226601, lng: 120.583099, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl, verification: 'cross-checked', transitStopIds: ['TCOD_3293280bbcdc116a7fb6923d0166ed6b6e57d2e1', 'TCOD_bfc972150caa9ed8e86a9fa5a71db938f697fefc'] },
  { id: 'pu-bus-chapel', name: '靜宜大學主顧聖母堂', category: '公車站', description: '162 往沙鹿火車站或往校內；368 往巨業沙鹿站或往校內，方向請到公車頁確認。到站時間請到公車頁查詢。', lat: 24.227301, lng: 120.580704, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl, verification: 'cross-checked', transitStopIds: ['TCOD_06f064b92a8186aba9b9c6037d4d9100d09466d2', 'TCOD_22c78ecf778fb3683041a7ca5253cd143308096c'] },
  { id: 'pu-bus-jingyuan', name: '靜宜大學靜園餐廳', category: '公車站', description: '301 往台中車站或往校內，方向請到公車頁確認。到站時間請到公車頁查詢。', lat: 24.227364, lng: 120.581741, sourceUrl: PROVIDENCE_CAMPUS_SOURCE.transitDatasetUrl, verification: 'cross-checked', transitStopIds: ['TCOD_aa06abf0361ecf11cd5e97609aa9b851ff0e3a3d', 'TCOD_aa355281c75ccfb3b062cb7d80a530d77c287a6d'] },
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

/** 有內建、已核對地點的學校；這些地點不必等外部資料就能先顯示。 */
export function hasBundledCampusPlaces(schoolId: string): boolean {
  return schoolId === 'pu';
}

export function providencePlaceSourceUrl(location: MapLocation): string | null {
  const place = [...PROVIDENCE_CAMPUS_PLACES, ...PROVIDENCE_BUS_STOPS].find(
    (entry) => entry.id === location.id,
  );
  return place?.sourceUrl ?? null;
}

/** 只有單一來源、還沒交叉確認的地點，畫面會老實標「待確認」。 */
export function isProvidencePendingVerification(location: MapLocation): boolean {
  const place = [...PROVIDENCE_CAMPUS_PLACES, ...PROVIDENCE_BUS_STOPS].find(
    (entry) => entry.id === location.id,
  );
  return place?.verification === 'single-source';
}

/**
 * 用直線距離粗估步行時間（約每分鐘 80 公尺）。
 * 這只是幫忙判斷遠近，不是路線導航時間，畫面必須照實標明。
 */
export function walkingEstimateLabel(distanceInMeters: number): string {
  if (!Number.isFinite(distanceInMeters) || distanceInMeters < 0) return '';
  const minutes = Math.max(1, Math.round(distanceInMeters / 80));
  return `步行約 ${minutes} 分鐘（直線估算，實際路線會更長）`;
}
