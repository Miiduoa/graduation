'use strict';

/**
 * 靜宜大學校園 POI + 路網（backend 版本，AI tool 共用）
 * Mirrors apps/mobile/src/data/puCampusData.ts — keep both in sync when POI/path changes.
 */

const CAMPUS_PATH_NODES = [
  { id: 'gate-main', lat: 24.22495, lng: 120.56535, type: 'entrance', connectedTo: ['path-01', 'path-02'], name: '正門（臺灣大道）' },
  { id: 'gate-back', lat: 24.2292, lng: 120.5638, type: 'entrance', connectedTo: ['path-20'], name: '後門（英才路）' },
  { id: 'gate-side', lat: 24.2268, lng: 120.5625, type: 'entrance', connectedTo: ['path-15'], name: '側門' },
  { id: 'path-01', lat: 24.2252, lng: 120.565, type: 'intersection', connectedTo: ['gate-main', 'path-03', 'path-02'] },
  { id: 'path-02', lat: 24.2253, lng: 120.5645, type: 'intersection', connectedTo: ['gate-main', 'path-01', 'path-04', 'path-05'] },
  { id: 'path-03', lat: 24.2257, lng: 120.5651, type: 'intersection', connectedTo: ['path-01', 'path-06', 'path-07'] },
  { id: 'path-04', lat: 24.2258, lng: 120.5642, type: 'intersection', connectedTo: ['path-02', 'path-08', 'path-09'] },
  { id: 'path-05', lat: 24.2256, lng: 120.5636, type: 'intersection', connectedTo: ['path-02', 'path-09', 'path-15'] },
  { id: 'path-06', lat: 24.2262, lng: 120.5653, type: 'intersection', connectedTo: ['path-03', 'path-10', 'path-07'] },
  { id: 'path-07', lat: 24.2263, lng: 120.5647, type: 'intersection', connectedTo: ['path-03', 'path-06', 'path-08', 'path-11'] },
  { id: 'path-08', lat: 24.2264, lng: 120.564, type: 'intersection', connectedTo: ['path-04', 'path-07', 'path-12', 'path-09'] },
  { id: 'path-09', lat: 24.2261, lng: 120.5635, type: 'intersection', connectedTo: ['path-04', 'path-05', 'path-08', 'path-15'] },
  { id: 'path-10', lat: 24.2268, lng: 120.5655, type: 'intersection', connectedTo: ['path-06', 'path-11', 'path-13'] },
  { id: 'path-11', lat: 24.227, lng: 120.5648, type: 'intersection', connectedTo: ['path-07', 'path-10', 'path-12', 'path-14'] },
  { id: 'path-12', lat: 24.2271, lng: 120.564, type: 'intersection', connectedTo: ['path-08', 'path-11', 'path-16'] },
  { id: 'path-13', lat: 24.2274, lng: 120.5658, type: 'intersection', connectedTo: ['path-10', 'path-14', 'path-17'] },
  { id: 'path-14', lat: 24.2276, lng: 120.5646, type: 'intersection', connectedTo: ['path-11', 'path-13', 'path-16', 'path-18'] },
  { id: 'path-15', lat: 24.226, lng: 120.563, type: 'intersection', connectedTo: ['path-05', 'path-09', 'gate-side', 'path-16'] },
  { id: 'path-16', lat: 24.2274, lng: 120.5635, type: 'intersection', connectedTo: ['path-12', 'path-14', 'path-15', 'path-19'] },
  { id: 'path-17', lat: 24.228, lng: 120.5654, type: 'intersection', connectedTo: ['path-13', 'path-18'] },
  { id: 'path-18', lat: 24.2282, lng: 120.5646, type: 'intersection', connectedTo: ['path-14', 'path-17', 'path-19', 'path-20'] },
  { id: 'path-19', lat: 24.2285, lng: 120.564, type: 'intersection', connectedTo: ['path-16', 'path-18', 'path-20'] },
  { id: 'path-20', lat: 24.2289, lng: 120.5638, type: 'intersection', connectedTo: ['path-19', 'gate-back'] },
];

const CAMPUS_POIS = [
  // 教學大樓
  { id: 'pu-providence', code: 'PH', name: '主顧樓', nameEn: 'Providence Hall', category: 'academic', lat: 24.22712, lng: 120.56517, floor: '1F~7F', description: '校園最大教學大樓，外語學院', departments: ['外國語文學院', '英文系', '西文系', '日文系'], openTime: '06:30', closeTime: '22:00' },
  { id: 'pu-renyuan', code: 'AK', name: '任垣樓', nameEn: 'Anthony Kuo Hall', category: 'academic', lat: 24.22765, lng: 120.56453, floor: 'B1~6F', description: '理工學院（資工、資管、應化、計網中心3F）', departments: ['資訊工程學系', '資訊管理學系', '應用化學系', '計算機及網路中心'], openTime: '06:30', closeTime: '22:00' },
  { id: 'pu-boduo', code: 'SP', name: '伯鐸樓', nameEn: 'St. Peter Hall', category: 'academic', lat: 24.22695, lng: 120.56398, floor: '1F~6F', description: '文學院及社會科學院', departments: ['中文系', '大傳系', '社工系', '台文系'], openTime: '06:30', closeTime: '22:00' },
  { id: 'pu-jingan', code: 'JA', name: '靜安樓', nameEn: 'Jing An Hall', category: 'academic', lat: 24.2263, lng: 120.5649, floor: '1F~6F', description: '管理學院（企管、國企、會計、觀光、財金）', departments: ['企管系', '國企系', '會計系', '觀光系', '財金系'], openTime: '06:30', closeTime: '22:00' },
  { id: 'pu-gelun', code: 'TG', name: '格倫樓', nameEn: 'Theodore Guerin Hall', category: 'academic', lat: 24.2268, lng: 120.5657, floor: '1F~5F', description: '法律學院（含模擬法庭）', departments: ['法律系', '財法系'], openTime: '06:30', closeTime: '22:00' },
  { id: 'pu-fangji', code: 'SF', name: '方濟樓', nameEn: 'St. Francis Hall', category: 'academic', lat: 24.2274, lng: 120.566, floor: '1F~5F', description: '教育研究所、師培中心', departments: ['教育研究所', '師資培育中心'], openTime: '06:30', closeTime: '22:00' },
  { id: 'pu-siyuan', code: 'SY', name: '思源樓', nameEn: 'Si Yuan Hall', category: 'academic', lat: 24.2281, lng: 120.5653, floor: '1F~5F', description: '通識中心、多功能教室', departments: ['通識教育中心'], openTime: '06:30', closeTime: '22:00' },
  { id: 'pu-wenxing', code: 'WX', name: '文興樓', nameEn: 'Wen Xing Hall', category: 'academic', lat: 24.2266, lng: 120.5644, floor: '1F~5F', description: '人文暨社會科學院', departments: ['生態人文學系', '社企碩士學程'], openTime: '06:30', closeTime: '22:00' },

  // 研究大樓
  { id: 'pu-research1', code: 'R1', name: '第一研究大樓', nameEn: 'Research Building 1', category: 'research', lat: 24.2285, lng: 120.5648, floor: '1F~6F', description: '化粧品科學、食營、研發處', departments: ['化粧品科學系', '食營系', '研發處'], openTime: '07:00', closeTime: '22:00' },
  { id: 'pu-research2', code: 'R2', name: '第二研究大樓', nameEn: 'Research Building 2', category: 'research', lat: 24.2287, lng: 120.5642, floor: '1F~5F', description: '理學院研究實驗室、伺服器機房', departments: ['應化所', '資工所'], openTime: '07:00', closeTime: '22:00' },

  // 圖書館
  { id: 'pu-library', code: 'LIB', name: '蓋夏圖書館', nameEn: 'Gaesia Library', category: 'library', lat: 24.2275, lng: 120.5635, floor: 'B1~5F', description: '主圖書館（60萬冊、自習、討論室、多媒體中心）', departments: ['圖書館'], openTime: '08:00', closeTime: '22:00' },

  // 行政
  { id: 'pu-admin', code: 'ADM', name: '行政大樓', nameEn: 'Administration Building', category: 'admin', lat: 24.2272, lng: 120.5638, floor: '1F~4F', description: '校長室、教務處、學務處、總務處', departments: ['校長室', '教務處', '學務處', '總務處'], openTime: '08:00', closeTime: '17:00' },
  { id: 'pu-intl', code: 'INTL', name: '國際暨兩岸事務處', nameEn: 'Office of International Affairs', category: 'admin', lat: 24.2273, lng: 120.5643, floor: '1F~2F', description: '國際學生、交換、留學', departments: ['國際處'], openTime: '08:00', closeTime: '17:00' },

  // 餐廳（與 cafeteriaId 對應）
  { id: 'pu-jingyuan', code: 'JYR', name: '靜園餐廳', nameEn: 'Jingyuan Cafeteria', category: 'cafeteria', lat: 24.22615, lng: 120.56465, floor: '1F~3F', description: '校園最大綜合餐廳，300席，自助餐/麵食/壽司/炸物', departments: [], openTime: '07:00', closeTime: '19:00', cafeteriaId: 'jingyuan' },
  { id: 'pu-yiyuan', code: 'YYR', name: '宜園餐廳', nameEn: 'Yiyuan Cafeteria', category: 'cafeteria', lat: 24.2259, lng: 120.5638, floor: '1F~2F', description: '座位最多422席，自助餐/簡餐/韓式/水餃', departments: [], openTime: '07:00', closeTime: '19:00', cafeteriaId: 'yiyuan' },
  { id: 'pu-zhishan', code: 'ZSR', name: '至善美食廣場', nameEn: 'Zhishan Food Court', category: 'cafeteria', lat: 24.2256, lng: 120.5632, floor: '1F~2F', description: '美食廣場，含OK便利商店、滷味、鬆餅、牛肉麵', departments: [], openTime: '07:30', closeTime: '20:00', cafeteriaId: 'zhishan' },

  // 宿舍
  { id: 'pu-dorm-faith', code: 'DM1', name: '信德宿舍', nameEn: 'Faith Dormitory', category: 'dormitory', lat: 24.2254, lng: 120.5658, floor: '1F~7F', description: '女生宿舍（4人房為主）', departments: [], openTime: '00:00', closeTime: '23:59' },
  { id: 'pu-dorm-hope', code: 'DM2', name: '望德宿舍', nameEn: 'Hope Dormitory', category: 'dormitory', lat: 24.2252, lng: 120.5655, floor: '1F~7F', description: '女生宿舍', departments: [], openTime: '00:00', closeTime: '23:59' },
  { id: 'pu-dorm-love', code: 'DM3', name: '愛德宿舍', nameEn: 'Love Dormitory', category: 'dormitory', lat: 24.225, lng: 120.5652, floor: '1F~7F', description: '男生宿舍', departments: [], openTime: '00:00', closeTime: '23:59' },
  { id: 'pu-dorm-ren', code: 'DM4', name: '仁愛宿舍', nameEn: 'Ren Ai Dormitory', category: 'dormitory', lat: 24.2248, lng: 120.5649, floor: '1F~5F', description: '研究生宿舍 / BOT', departments: [], openTime: '00:00', closeTime: '23:59' },

  // 運動
  { id: 'pu-gym', code: 'GYM', name: '體育館', nameEn: 'John Paul II Sports Hall', category: 'sports', lat: 24.2258, lng: 120.5635, floor: 'B1~3F', description: '綜合體育館（籃、羽、桌、健身、游泳）', departments: ['體育室'], openTime: '06:00', closeTime: '22:00' },
  { id: 'pu-track', code: 'TRK', name: '田徑場', nameEn: 'Athletic Field', category: 'sports', lat: 24.2252, lng: 120.564, floor: '戶外', description: '400m PU跑道、足球場', departments: [], openTime: '06:00', closeTime: '22:00' },
  { id: 'pu-tennis', code: 'TEN', name: '網球場', nameEn: 'Tennis Courts', category: 'sports', lat: 24.2255, lng: 120.5628, floor: '戶外', description: '4面標準網球場', departments: [], openTime: '06:00', closeTime: '22:00' },
  { id: 'pu-basketball', code: 'BBL', name: '室外籃球場', nameEn: 'Outdoor Basketball Courts', category: 'sports', lat: 24.2254, lng: 120.5633, floor: '戶外', description: '6面室外籃球場', departments: [], openTime: '06:00', closeTime: '22:00' },

  // 停車場
  { id: 'pu-parking-main', code: 'PK1', name: '主停車場', nameEn: 'Main Parking', category: 'parking', lat: 24.2249, lng: 120.5644, floor: '平面', description: '臺灣大道旁主要停車場（汽車200/機車500）', departments: [], openTime: '06:00', closeTime: '22:00' },
  { id: 'pu-parking-north', code: 'PK2', name: '北側停車場', nameEn: 'North Parking', category: 'parking', lat: 24.2288, lng: 120.5645, floor: '平面', description: '後門旁（汽車80/機車200）', departments: [], openTime: '06:00', closeTime: '22:00' },
  { id: 'pu-parking-moto', code: 'PK3', name: '機車停車場', nameEn: 'Motorcycle Parking', category: 'parking', lat: 24.2251, lng: 120.5648, floor: '平面', description: '正門旁機車停車場（800格）', departments: [], openTime: '00:00', closeTime: '23:59' },

  // 便利商店 / 醫療 / 宗教 / 校門 / 其他
  { id: 'pu-7eleven', code: '711', name: '7-ELEVEN 靜宜門市', nameEn: '7-ELEVEN', category: 'convenience', lat: 24.2265, lng: 120.5651, floor: '1F', description: '24小時便利商店（ATM、ibon、咖啡）', departments: [], openTime: '00:00', closeTime: '23:59' },
  { id: 'pu-ok-mart', code: 'OK', name: 'OK便利商店 至善店', nameEn: 'OK Mart', category: 'convenience', lat: 24.2256, lng: 120.56325, floor: '1F', description: '至善美食廣場1樓', departments: [], openTime: '07:30', closeTime: '21:00' },
  { id: 'pu-atm', code: 'ATM', name: '郵局ATM', nameEn: 'Post Office ATM', category: 'convenience', lat: 24.2264, lng: 120.5648, floor: '1F', description: '靜安樓1樓', departments: [], openTime: '00:00', closeTime: '23:59' },
  { id: 'pu-health', code: 'HC', name: '健康中心', nameEn: 'Health Center', category: 'medical', lat: 24.2267, lng: 120.5643, floor: '1F', description: '校園健康中心（醫療、健檢、心理諮商）', departments: ['衛保組', '諮商中心'], openTime: '08:00', closeTime: '17:00' },
  { id: 'pu-chapel', code: 'CH', name: '主顧聖母堂', nameEn: 'Chapel', category: 'religious', lat: 24.2266, lng: 120.5632, floor: '1F~2F', description: '天主教聖堂（彌撒）', departments: ['校牧室'], openTime: '07:00', closeTime: '21:00' },
  { id: 'pu-gate-main', code: 'MG', name: '正門（臺灣大道）', nameEn: 'Main Gate', category: 'gate', lat: 24.22495, lng: 120.56535, floor: '地面', description: '臺灣大道主要入口', departments: ['駐警隊'], openTime: '00:00', closeTime: '23:59' },
  { id: 'pu-gate-back', code: 'BG', name: '後門（英才路）', nameEn: 'Back Gate', category: 'gate', lat: 24.2292, lng: 120.5638, floor: '地面', description: '英才路後門，通往北側停車場', departments: [], openTime: '06:00', closeTime: '22:00' },
  { id: 'pu-bus-stop', code: 'BUS', name: '靜宜大學站（公車）', nameEn: 'PU Bus Stop', category: 'gate', lat: 24.2247, lng: 120.5654, floor: '地面', description: '臺灣大道公車站牌', departments: [], openTime: '05:30', closeTime: '23:30' },
  { id: 'pu-arts', code: 'ART', name: '藝術中心', nameEn: 'Art Center', category: 'other', lat: 24.2269, lng: 120.5635, floor: '1F~2F', description: '展覽廳、藝文活動空間', departments: ['藝術中心'], openTime: '09:00', closeTime: '17:00' },
  { id: 'pu-student-center', code: 'SC', name: '學生活動中心', nameEn: 'Student Activity Center', category: 'other', lat: 24.226, lng: 120.565, floor: '1F~3F', description: '社團、學生會、活動空間', departments: ['學生會'], openTime: '08:00', closeTime: '22:00' },
  { id: 'pu-auditorium', code: 'AUD', name: '至善國際會議廳', nameEn: 'Zhishan Conference Hall', category: 'other', lat: 24.2257, lng: 120.563, floor: '1F~2F', description: '500席大型會議廳', departments: [], openTime: '08:00', closeTime: '22:00' },
];

const POI_BY_ID = new Map(CAMPUS_POIS.map((p) => [p.id, p]));
const NODE_BY_ID = new Map(CAMPUS_PATH_NODES.map((n) => [n.id, n]));

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

function findNearestPathNode(lat, lng) {
  let nearest = CAMPUS_PATH_NODES[0];
  let minDist = Infinity;
  for (const node of CAMPUS_PATH_NODES) {
    const d = (node.lat - lat) ** 2 + (node.lng - lng) ** 2;
    if (d < minDist) {
      minDist = d;
      nearest = node;
    }
  }
  return nearest;
}

/**
 * A* path search across CAMPUS_PATH_NODES.
 * Returns array of nodes (start → ... → end). Empty array if no path.
 */
function findShortestPath(startLat, startLng, endLat, endLng) {
  const start = findNearestPathNode(startLat, startLng);
  const end = findNearestPathNode(endLat, endLng);
  if (start.id === end.id) return [start];

  const gScore = new Map([[start.id, 0]]);
  const fScore = new Map([[start.id, haversine(start, end)]]);
  const cameFrom = new Map();
  const openSet = new Set([start.id]);
  const closedSet = new Set();

  while (openSet.size > 0) {
    let current = null;
    let lowestF = Infinity;
    for (const id of openSet) {
      const f = fScore.get(id) ?? Infinity;
      if (f < lowestF) {
        lowestF = f;
        current = id;
      }
    }
    if (current == null) break;

    if (current === end.id) {
      const path = [];
      let c = current;
      while (c) {
        const node = NODE_BY_ID.get(c);
        if (node) path.unshift(node);
        c = cameFrom.get(c);
      }
      return path;
    }

    openSet.delete(current);
    closedSet.add(current);
    const currentNode = NODE_BY_ID.get(current);
    if (!currentNode) continue;

    for (const neighborId of currentNode.connectedTo) {
      if (closedSet.has(neighborId)) continue;
      const neighbor = NODE_BY_ID.get(neighborId);
      if (!neighbor) continue;
      const tentativeG = (gScore.get(current) ?? Infinity) + haversine(currentNode, neighbor);
      if (!openSet.has(neighborId)) {
        openSet.add(neighborId);
      } else if (tentativeG >= (gScore.get(neighborId) ?? Infinity)) {
        continue;
      }
      cameFrom.set(neighborId, current);
      gScore.set(neighborId, tentativeG);
      fScore.set(neighborId, tentativeG + haversine(neighbor, end));
    }
  }
  return [start, end];
}

/**
 * Plan a campus route between two POIs.
 * @param {string} fromPoiId
 * @param {string} toPoiId
 * @returns {{ ok: boolean, from?: object, to?: object, polyline?: Array<{lat:number,lng:number}>, distanceMeters?: number, walkMinutes?: number, steps?: Array, errorMessage?: string }}
 */
function planRouteBetweenPois(fromPoiId, toPoiId) {
  const from = getPoiById(fromPoiId);
  const to = getPoiById(toPoiId);
  if (!from || !to) {
    return { ok: false, errorMessage: '找不到起點或終點 POI' };
  }
  const pathNodes = findShortestPath(from.lat, from.lng, to.lat, to.lng);
  const polyline = [
    { lat: from.lat, lng: from.lng, label: from.name },
    ...pathNodes.map((n) => ({ lat: n.lat, lng: n.lng, label: n.name })),
    { lat: to.lat, lng: to.lng, label: to.name },
  ];

  // total distance
  let distance = 0;
  for (let i = 1; i < polyline.length; i++) {
    distance += haversine(polyline[i - 1], polyline[i]);
  }
  const walkSpeedMps = 1.25; // 4.5 km/h 平均步行
  const walkMinutes = Math.max(1, Math.round(distance / walkSpeedMps / 60));

  const steps = buildSteps(polyline, to.name);

  return {
    ok: true,
    from: { id: from.id, name: from.name, lat: from.lat, lng: from.lng, code: from.code },
    to: { id: to.id, name: to.name, lat: to.lat, lng: to.lng, code: to.code, floor: to.floor },
    polyline,
    distanceMeters: Math.round(distance),
    walkMinutes,
    steps,
  };
}

function buildSteps(polyline, destName) {
  if (polyline.length < 2) return [{ instruction: `抵達 ${destName}`, distance: 0, direction: 'destination' }];
  const steps = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const cur = polyline[i];
    const next = polyline[i + 1];
    const d = Math.round(haversine(cur, next));
    if (i === 0) {
      steps.push({ instruction: `從 ${cur.label || '起點'} 出發，往前走 ${d} 公尺`, distance: d, direction: 'straight' });
      continue;
    }
    if (i === polyline.length - 2) {
      steps.push({ instruction: `再走 ${d} 公尺即抵達 ${destName}`, distance: d, direction: 'destination' });
      continue;
    }
    const prev = polyline[i - 1];
    const prevBearing = (Math.atan2(cur.lng - prev.lng, cur.lat - prev.lat) * 180) / Math.PI;
    const nextBearing = (Math.atan2(next.lng - cur.lng, next.lat - cur.lat) * 180) / Math.PI;
    let turn = nextBearing - prevBearing;
    if (turn > 180) turn -= 360;
    if (turn < -180) turn += 360;
    let dir = 'straight';
    let turnText = '直走';
    if (turn > 30) { dir = 'right'; turnText = '右轉'; }
    else if (turn > 10) { dir = 'slight_right'; turnText = '稍微右轉'; }
    else if (turn < -30) { dir = 'left'; turnText = '左轉'; }
    else if (turn < -10) { dir = 'slight_left'; turnText = '稍微左轉'; }
    steps.push({
      instruction: `${cur.label ? `經過${cur.label}` : ''}${turnText}，續走 ${d} 公尺`.trim(),
      distance: d,
      direction: dir,
    });
  }
  return steps;
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
  '英文系': 'pu-providence', '日文系': 'pu-providence', '西文系': 'pu-providence',
  '中文系': 'pu-boduo', '大傳': 'pu-boduo', '社工': 'pu-boduo', '台文': 'pu-boduo',
  '企管': 'pu-jingan', '國企': 'pu-jingan', '會計': 'pu-jingan', '觀光': 'pu-jingan', '財金': 'pu-jingan',
  '法律': 'pu-gelun', '財法': 'pu-gelun',
  '教育': 'pu-fangji', '師培': 'pu-fangji',
  '通識': 'pu-siyuan',
  '化粧品': 'pu-research1', '食營': 'pu-research1',
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
  CAMPUS_PATH_NODES,
  getPoiById,
  getAllPois,
  searchPois,
  planRouteBetweenPois,
  findShortestPath,
  findNearestPathNode,
  isPoiOpenNow,
  haversine,
};
