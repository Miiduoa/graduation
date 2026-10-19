'use strict';

/**
 * 靜宜大學校園 POI（backend 版本，AI tool 共用）
 *
 * 座標與名稱以 apps/web/src/app/map/providenceCampus.ts 逐筆核對過的
 * 資料為準（2026-10-19），與 apps/mobile/src/data/puCampusData.ts 同步。
 * 每筆保留 sourceUrl 可回查；verification 為 single-source 的屬待確認。
 * 舊清單中對不上核對資料的地點已移除，不沿用偏離校園約 1.6 公里的
 * 舊座標；逐筆紀錄見 docs/campus-map-providence.md。
 *
 * 舊校園路網節點同樣是未核對的錯誤座標，已移除：本模組不再提供
 * planRouteBetweenPois／findShortestPath 假路網推算，正式導航由
 * agent tools 以 Firestore 地點與外部步行路線處理。
 */

const CAMPUS_POIS = [
  { id: 'pu-zhugu', code: 'PH', name: '主顧樓', nameEn: 'Providence Hall', category: 'academic', lat: 24.226939, lng: 120.583587, floor: '1F~7F', description: '校園最大教學大樓，外語學院', departments: ['外國語文學院', '英文系', '西文系', '日文系'], openTime: '06:30', closeTime: '22:00', verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/255784268', },
  { id: 'pu-renyuan', code: 'AK', name: '任垣樓', nameEn: 'Anthony Kuo Hall', category: 'academic', lat: 24.226415, lng: 120.580067, floor: 'B1~6F', description: '理工學院（資工、資管、應化、計網中心3F）', departments: ['資訊工程學系', '資訊管理學系', '應用化學系', '計算機及網路中心'], openTime: '06:30', closeTime: '22:00', verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/255783833', },
  { id: 'pu-boduo', code: 'SP', name: '伯鐸樓', nameEn: 'St. Peter Hall', category: 'academic', lat: 24.22606, lng: 120.580649, floor: '1F~6F', description: '文學院及社會科學院', departments: ['中文系', '大傳系', '社工系', '台文系'], openTime: '06:30', closeTime: '22:00', verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/255783866', },
  { id: 'pu-wenxing', code: 'WX', name: '文興樓', nameEn: 'Wen Xing Hall', category: 'academic', lat: 24.226953, lng: 120.581189, floor: '1F~5F', description: '人文暨社會科學院', departments: ['生態人文學系', '社企碩士學程'], openTime: '06:30', closeTime: '22:00', verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/255783884', },
  { id: 'pu-gelun', code: 'TG', name: '格倫樓', nameEn: 'Theodore Guerin Hall', category: 'academic', lat: 24.226197, lng: 120.583373, floor: '1F~5F', description: '法律學院（含模擬法庭）', departments: ['法律系', '財法系'], openTime: '06:30', closeTime: '22:00', verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/255784254', },
  { id: 'pu-fangji', code: 'SF', name: '方濟樓', nameEn: 'St. Francis Hall', category: 'academic', lat: 24.227864, lng: 120.583509, floor: '1F~5F', description: '教育研究所、師培中心', departments: ['教育研究所', '師資培育中心'], openTime: '06:30', closeTime: '22:00', verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/255784368', },
  { id: 'pu-siyuan', code: 'SY', name: '思源樓', nameEn: 'Si Yuan Hall', category: 'academic', lat: 24.226931, lng: 120.582346, floor: '1F~5F', description: '通識中心、多功能教室', departments: ['通識教育中心'], openTime: '06:30', closeTime: '22:00', verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/295684731', },
  { id: 'pu-jingan', code: 'JA', name: '靜安樓', nameEn: 'Jing An Hall', category: 'academic', lat: 24.226214, lng: 120.5823, floor: '1F~6F', description: '管理學院（企管、國企、會計、觀光、財金）', departments: ['企管系', '國企系', '會計系', '觀光系', '財金系'], openTime: '06:30', closeTime: '22:00', verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/293503497', },
  { id: 'pu-zhishan', code: '', name: '至善樓', nameEn: '', category: 'academic', lat: 24.228147, lng: 120.579773, verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/255784219', floor: '', description: '', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-library', code: 'LIB', name: '蓋夏圖書館', nameEn: 'Gaesia Library', category: 'library', lat: 24.226282, lng: 120.581377, floor: 'B1~5F', description: '主圖書館（60萬冊、自習、討論室、多媒體中心）', departments: ['圖書館'], openTime: '08:00', closeTime: '22:00', verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/255784049', },
  { id: 'pu-chapel', code: 'CH', name: '主顧聖母堂', nameEn: 'Chapel', category: 'religious', lat: 24.228164, lng: 120.581515, floor: '1F~2F', description: '天主教聖堂（彌撒）', departments: ['校牧室'], openTime: '07:00', closeTime: '21:00', verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/665651135', },
  { id: 'pu-monastery', code: '', name: '修院', nameEn: '', category: 'religious', lat: 24.227833, lng: 120.582498, verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/255784429', floor: '', description: '', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-jingyuan', code: 'JYR', name: '靜園餐廳', nameEn: 'Jingyuan Cafeteria', category: 'cafeteria', lat: 24.227517, lng: 120.58157, floor: '1F~3F', description: '校園最大綜合餐廳，300席，自助餐/麵食/壽司/炸物', departments: [], openTime: '07:00', closeTime: '19:00', cafeteriaId: 'jingyuan', verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/255784235', },
  { id: 'pu-yiyuan', code: 'YYR', name: '宜園餐廳', nameEn: 'Yiyuan Cafeteria', category: 'cafeteria', lat: 24.227152, lng: 120.579543, floor: '1F~2F', description: '座位最多422席，自助餐/簡餐/韓式/水餃', departments: [], openTime: '07:00', closeTime: '19:00', cafeteriaId: 'yiyuan', verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/255784490', },
  { id: 'pu-sigao', code: '', name: '思高學苑', nameEn: '', category: 'dormitory', lat: 24.22906, lng: 120.58206, verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/255784179', floor: '', description: '', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-gym', code: 'GYM', name: '若望保祿二世體育館', nameEn: 'John Paul II Sports Hall', category: 'sports', lat: 24.229194, lng: 120.581062, floor: 'B1~3F', description: '綜合體育館（籃、羽、桌、健身、游泳）', departments: ['體育室'], openTime: '06:00', closeTime: '22:00', verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/255784165', },
  { id: 'pu-pool', code: '', name: '溫水游泳池', nameEn: '', category: 'sports', lat: 24.229419, lng: 120.580272, verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/way/255784072', floor: '', description: '', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-health', code: 'HC', name: '保健中心', nameEn: 'Health Center', category: 'medical', lat: 24.228113, lng: 120.579668, floor: '1F', description: '校園健康中心（醫療、健檢、心理諮商）', departments: ['衛保組', '諮商中心'], openTime: '08:00', closeTime: '17:00', verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/node/4081270496', },
  { id: 'pu-post', code: '', name: '靜宜大學郵局', nameEn: '', category: 'other', lat: 24.227962, lng: 120.579806, verification: 'cross-checked', sourceUrl: 'https://www.openstreetmap.org/node/4081204265', floor: '', description: '', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-parking-p1', code: '', name: 'P1 停車場', nameEn: '', category: 'parking', lat: 24.226068, lng: 120.579524, verification: 'single-source', sourceUrl: 'https://www.openstreetmap.org/way/295686299', floor: '', description: '', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-parking-p2', code: '', name: 'P2 停車場', nameEn: '', category: 'parking', lat: 24.228698, lng: 120.582938, verification: 'single-source', sourceUrl: 'https://www.openstreetmap.org/way/295686298', floor: '', description: '', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-parking-moto', code: 'PK3', name: '機車停車場', nameEn: 'Motorcycle Parking', category: 'parking', lat: 24.224905, lng: 120.578225, floor: '平面', description: '正門旁機車停車場（800格）', departments: [], openTime: '00:00', closeTime: '23:59', verification: 'single-source', sourceUrl: 'https://www.openstreetmap.org/way/405993001', },
  { id: 'pu-bus-main-a', code: '', name: '靜宜大學', nameEn: '', category: 'other', lat: 24.224972, lng: 120.577034, verification: 'cross-checked', sourceUrl: 'https://data.gov.tw/dataset/81555', floor: '', description: '326 往新民高中（健行路）；353 往南社路二段；659 往臺中榮總（臺灣大道）。到站時間請到公車頁查詢。', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-bus-main-b', code: '', name: '靜宜大學', nameEn: '', category: 'other', lat: 24.22637, lng: 120.576622, verification: 'cross-checked', sourceUrl: 'https://data.gov.tw/dataset/81555', floor: '', description: '326 往靜宜大學；659 往幼獅工業區服務中心。到站時間請到公車頁查詢。', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-bus-brt-a', code: '', name: '靜宜大學（專用道）', nameEn: '', category: 'other', lat: 24.225323, lng: 120.577202, verification: 'cross-checked', sourceUrl: 'https://data.gov.tw/dataset/81555', floor: '', description: '300、302、303、304、305、306、307、308、309、310 等往臺中車站／新民高中方向，以及返程往清水／梧棲／臺中港方向；逐路線方向請到公車頁確認。到站時間請到公車頁查詢。', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-bus-brt-b', code: '', name: '靜宜大學（專用道）', nameEn: '', category: 'other', lat: 24.225899, lng: 120.576538, verification: 'cross-checked', sourceUrl: 'https://data.gov.tw/dataset/81555', floor: '', description: '300、302、303、304、305、306、307、308、309、310 等往臺中車站（A月台）／新民高中方向。到站時間請到公車頁查詢。', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-bus-gate', code: '', name: '靜宜大學（校門）', nameEn: '', category: 'other', lat: 24.2253, lng: 120.577797, verification: 'cross-checked', sourceUrl: 'https://data.gov.tw/dataset/81555', floor: '', description: '162、301 往靜宜大學靜園餐廳／主顧聖母堂方向；368 往靜宜大學主顧聖母堂。到站時間請到公車頁查詢。', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-bus-yingcai-a', code: '', name: '靜宜大學（英才路）', nameEn: '', category: 'other', lat: 24.226645, lng: 120.574837, verification: 'cross-checked', sourceUrl: 'https://data.gov.tw/dataset/81555', floor: '', description: '162 往靜宜大學主顧聖母堂；353 往南社路二段；368 往巨業沙鹿站。到站時間請到公車頁查詢。', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-bus-yingcai-b', code: '', name: '靜宜大學（英才路）', nameEn: '', category: 'other', lat: 24.227036, lng: 120.575356, verification: 'cross-checked', sourceUrl: 'https://data.gov.tw/dataset/81555', floor: '', description: '162 往嘉陽高中；353 往巨業沙鹿站；368 往靜宜大學主顧聖母堂。到站時間請到公車頁查詢。', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-bus-zhugu', code: '', name: '靜宜大學主顧樓', nameEn: '', category: 'other', lat: 24.226601, lng: 120.583099, verification: 'cross-checked', sourceUrl: 'https://data.gov.tw/dataset/81555', floor: '', description: '162、368 往靜宜大學主顧聖母堂；301 往靜宜大學靜園餐廳。到站時間請到公車頁查詢。', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-bus-chapel', code: '', name: '靜宜大學主顧聖母堂', nameEn: '', category: 'other', lat: 24.227301, lng: 120.580704, verification: 'cross-checked', sourceUrl: 'https://data.gov.tw/dataset/81555', floor: '', description: '162 往嘉陽高中或靜宜大學主顧聖母堂；368 往靜宜大學主顧聖母堂或巨業沙鹿站，方向請到公車頁確認。到站時間請到公車頁查詢。', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-bus-jingyuan', code: '', name: '靜宜大學靜園餐廳', nameEn: '', category: 'other', lat: 24.227364, lng: 120.581741, verification: 'cross-checked', sourceUrl: 'https://data.gov.tw/dataset/81555', floor: '', description: '301 往新光里（新福路）或靜宜大學靜園餐廳，方向請到公車頁確認。到站時間請到公車頁查詢。', departments: [], openTime: '', closeTime: '' },
  { id: 'pu-gate-osm', code: '', name: '校園出入口（名稱待補）', nameEn: '', category: 'gate', lat: 24.225714, lng: 120.577096, verification: 'single-source', sourceUrl: 'https://www.openstreetmap.org/node/4692506551', floor: '', description: '此點是 OpenStreetMap 上的閘門標記，正式名稱待校方資料確認。', departments: [], openTime: '', closeTime: '' },
];

const POI_BY_ID = new Map(CAMPUS_POIS.map((p) => [p.id, p]));
function getPoiById(id) {
  return POI_BY_ID.get(id);
}

function getAllPois() {
  return CAMPUS_POIS.slice();
}

// Haversine distance in meters
function haversine(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const aH =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(aH), Math.sqrt(1 - aH));
}

/**
 * Common alias → category mapping for natural-language queries.
 * Lets users say "校門", "食堂" etc. without exact POI name match.
 */
const ALIAS_TO_CATEGORY = {
  '校門': 'gate', '大門': 'gate', '校門口': 'gate', '門口': 'gate', '出入口': 'gate',
  '餐廳': 'cafeteria', '食堂': 'cafeteria', '吃飯': 'cafeteria', '美食': 'cafeteria', '午餐': 'cafeteria', '晚餐': 'cafeteria',
  '圖書館': 'library', '圖書': 'library', '書館': 'library',
  '宿舍': 'dormitory', '寢室': 'dormitory',
  '體育': 'sports', '運動': 'sports', '健身': 'sports', '球場': 'sports', '操場': 'sports', '跑道': 'sports', '游泳': 'sports',
  '停車': 'parking', '停車場': 'parking',
  '便利商店': 'convenience', '超商': 'convenience', '小七': 'convenience', '7-11': 'convenience', '711': 'convenience',
  'atm': 'convenience',
  '健康中心': 'medical', '醫療': 'medical', '醫護': 'medical', '保健': 'medical', '心理諮商': 'medical', '諮商': 'medical',
  '聖堂': 'religious', '教堂': 'religious', '彌撒': 'religious',
  '行政': 'admin',
};

/** Specific Chinese department alias → POI id (high-priority short circuit) */
const DEPT_ALIAS_TO_POI = {
  '資工': 'pu-renyuan', '資管': 'pu-renyuan', '應化': 'pu-renyuan', '計網中心': 'pu-renyuan', '計算機中心': 'pu-renyuan',
  '英文系': 'pu-zhugu', '日文系': 'pu-zhugu', '西文系': 'pu-zhugu',
  '中文系': 'pu-boduo', '大傳': 'pu-boduo', '社工': 'pu-boduo', '台文': 'pu-boduo',
  '企管': 'pu-jingan', '國企': 'pu-jingan', '會計': 'pu-jingan', '觀光': 'pu-jingan', '財金': 'pu-jingan',
  '法律': 'pu-gelun', '財法': 'pu-gelun',
  '教育': 'pu-fangji', '師培': 'pu-fangji',
  '通識': 'pu-siyuan',
  '工程館': 'pu-renyuan',
};

/**
 * Search POIs by free-text query.
 * Matches name, nameEn, code, departments, description (case-insensitive substring).
 * Falls back to alias→category mapping if exact substring fails.
 */
function searchPois(query, category) {
  const q = String(query || '').trim().toLowerCase();
  let effectiveCategory = category;

  // Short-circuit: department alias → specific POI (highest priority)
  if (q.length > 0 && !category) {
    for (const [alias, poiId] of Object.entries(DEPT_ALIAS_TO_POI)) {
      if (q.includes(alias.toLowerCase())) {
        const target = POI_BY_ID.get(poiId);
        if (target) return [target];
      }
    }
  }

  let result = CAMPUS_POIS.slice();

  // Substring match
  const substringMatch = (p) => {
    if (p.name.toLowerCase().includes(q)) return true;
    if ((p.nameEn || '').toLowerCase().includes(q)) return true;
    if ((p.code || '').toLowerCase().includes(q)) return true;
    if ((p.description || '').toLowerCase().includes(q)) return true;
    if (Array.isArray(p.departments) && p.departments.some((d) => d.toLowerCase().includes(q))) return true;
    return false;
  };

  if (q.length > 0) {
    const matched = result.filter(substringMatch);
    if (matched.length > 0) {
      result = matched;
    } else if (!effectiveCategory) {
      // No substring match — try alias → category fallback
      for (const [alias, cat] of Object.entries(ALIAS_TO_CATEGORY)) {
        if (q.includes(alias.toLowerCase())) {
          effectiveCategory = cat;
          break;
        }
      }
      if (effectiveCategory) {
        result = result.filter((p) => p.category === effectiveCategory);
      } else {
        return [];
      }
    } else {
      return [];
    }
  }

  if (effectiveCategory) {
    result = result.filter((p) => p.category === effectiveCategory);
  }

  // Score: name match > code > nameEn > departments > description
  if (q.length > 0) {
    result.sort((a, b) => {
      const score = (p) => {
        if (p.name.toLowerCase().includes(q)) return 0;
        if ((p.code || '').toLowerCase().includes(q)) return 1;
        if ((p.nameEn || '').toLowerCase().includes(q)) return 2;
        if (Array.isArray(p.departments) && p.departments.some((d) => d.toLowerCase().includes(q))) return 3;
        return 4;
      };
      return score(a) - score(b);
    });
  }
  return result;
}

function isPoiOpenNow(poi, now = new Date()) {
  if (!poi.openTime || !poi.closeTime) return null;
  const [oh, om] = poi.openTime.split(':').map(Number);
  const [ch, cm] = poi.closeTime.split(':').map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  const open = oh * 60 + (om || 0);
  let close = ch * 60 + (cm || 0);
  if (close <= open) close += 24 * 60; // wraps midnight
  return cur >= open && cur < close;
}

module.exports = {
  CAMPUS_POIS,
  getPoiById,
  getAllPois,
  searchPois,
  isPoiOpenNow,
  haversine,
};
