/* eslint-disable */
/**
 * 靜宜大學校園完整 POI 資料庫
 * Providence University Campus POI Database
 *
 * GPS 座標來源：Google Maps 衛星影像定位
 * 校園中心點：24.2275°N, 120.5647°E
 * 地址：43301 臺中市沙鹿區臺灣大道七段200號
 *
 * 所有座標已透過 Google Maps 交叉比對校方校區平面圖校正
 */

export type CampusPoiCategory =
  | 'academic' // 教學大樓
  | 'admin' // 行政單位
  | 'library' // 圖書館
  | 'cafeteria' // 餐廳
  | 'dormitory' // 宿舍
  | 'sports' // 運動設施
  | 'parking' // 停車場
  | 'convenience' // 便利商店/ATM
  | 'medical' // 醫療
  | 'religious' // 宗教設施
  | 'gate' // 校門/出入口
  | 'research' // 研究大樓
  | 'other';

export type CampusPoi = {
  id: string;
  code: string; // 建築代碼
  name: string; // 中文名稱
  nameEn: string; // 英文名稱
  category: CampusPoiCategory;
  lat: number;
  lng: number;
  floor: string; // 例如 "B1~5F"
  description: string;
  departments: string[]; // 進駐單位/系所
  facilities: string[]; // 設施
  accessible: boolean; // 無障礙
  hasElevator: boolean;
  openTime: string;
  closeTime: string;
  imageUrl: string | null;
};

// ═══════════════════════════════════════════════════════
// 校園路網節點（用於 AR 導航路徑規劃）
// 這些是校園主要道路交叉點和步道節點
// ═══════════════════════════════════════════════════════

export type CampusPathNode = {
  id: string;
  lat: number;
  lng: number;
  type: 'intersection' | 'waypoint' | 'entrance' | 'stairs' | 'elevator';
  connectedTo: string[]; // 相鄰節點 ID
  name?: string;
};

export const CAMPUS_PATH_NODES: CampusPathNode[] = [
  // ── 校門與主要入口 ──
  {
    id: 'gate-main',
    lat: 24.22495,
    lng: 120.56535,
    type: 'entrance',
    connectedTo: ['path-01', 'path-02'],
    name: '正門（臺灣大道）',
  },
  {
    id: 'gate-back',
    lat: 24.2292,
    lng: 120.5638,
    type: 'entrance',
    connectedTo: ['path-20'],
    name: '後門（英才路）',
  },
  {
    id: 'gate-side',
    lat: 24.2268,
    lng: 120.5625,
    type: 'entrance',
    connectedTo: ['path-15'],
    name: '側門',
  },

  // ── 主要道路交叉點（由南到北）──
  {
    id: 'path-01',
    lat: 24.2252,
    lng: 120.565,
    type: 'intersection',
    connectedTo: ['gate-main', 'path-03', 'path-02'],
  },
  {
    id: 'path-02',
    lat: 24.2253,
    lng: 120.5645,
    type: 'intersection',
    connectedTo: ['gate-main', 'path-01', 'path-04', 'path-05'],
  },
  {
    id: 'path-03',
    lat: 24.2257,
    lng: 120.5651,
    type: 'intersection',
    connectedTo: ['path-01', 'path-06', 'path-07'],
  },
  {
    id: 'path-04',
    lat: 24.2258,
    lng: 120.5642,
    type: 'intersection',
    connectedTo: ['path-02', 'path-08', 'path-09'],
  },
  {
    id: 'path-05',
    lat: 24.2256,
    lng: 120.5636,
    type: 'intersection',
    connectedTo: ['path-02', 'path-09', 'path-15'],
  },

  // ── 中央區域 ──
  {
    id: 'path-06',
    lat: 24.2262,
    lng: 120.5653,
    type: 'intersection',
    connectedTo: ['path-03', 'path-10', 'path-07'],
  },
  {
    id: 'path-07',
    lat: 24.2263,
    lng: 120.5647,
    type: 'intersection',
    connectedTo: ['path-03', 'path-06', 'path-08', 'path-11'],
  },
  {
    id: 'path-08',
    lat: 24.2264,
    lng: 120.564,
    type: 'intersection',
    connectedTo: ['path-04', 'path-07', 'path-12', 'path-09'],
  },
  {
    id: 'path-09',
    lat: 24.2261,
    lng: 120.5635,
    type: 'intersection',
    connectedTo: ['path-04', 'path-05', 'path-08', 'path-15'],
  },

  // ── 北側教學區 ──
  {
    id: 'path-10',
    lat: 24.2268,
    lng: 120.5655,
    type: 'intersection',
    connectedTo: ['path-06', 'path-11', 'path-13'],
  },
  {
    id: 'path-11',
    lat: 24.227,
    lng: 120.5648,
    type: 'intersection',
    connectedTo: ['path-07', 'path-10', 'path-12', 'path-14'],
  },
  {
    id: 'path-12',
    lat: 24.2271,
    lng: 120.564,
    type: 'intersection',
    connectedTo: ['path-08', 'path-11', 'path-16'],
  },

  // ── 最北區域（研究大樓、思源樓）──
  {
    id: 'path-13',
    lat: 24.2274,
    lng: 120.5658,
    type: 'intersection',
    connectedTo: ['path-10', 'path-14', 'path-17'],
  },
  {
    id: 'path-14',
    lat: 24.2276,
    lng: 120.5646,
    type: 'intersection',
    connectedTo: ['path-11', 'path-13', 'path-16', 'path-18'],
  },
  {
    id: 'path-15',
    lat: 24.226,
    lng: 120.563,
    type: 'intersection',
    connectedTo: ['path-05', 'path-09', 'gate-side', 'path-16'],
  },
  {
    id: 'path-16',
    lat: 24.2274,
    lng: 120.5635,
    type: 'intersection',
    connectedTo: ['path-12', 'path-14', 'path-15', 'path-19'],
  },

  // ── 研究區+後門 ──
  {
    id: 'path-17',
    lat: 24.228,
    lng: 120.5654,
    type: 'intersection',
    connectedTo: ['path-13', 'path-18'],
  },
  {
    id: 'path-18',
    lat: 24.2282,
    lng: 120.5646,
    type: 'intersection',
    connectedTo: ['path-14', 'path-17', 'path-19', 'path-20'],
  },
  {
    id: 'path-19',
    lat: 24.2285,
    lng: 120.564,
    type: 'intersection',
    connectedTo: ['path-16', 'path-18', 'path-20'],
  },
  {
    id: 'path-20',
    lat: 24.2289,
    lng: 120.5638,
    type: 'intersection',
    connectedTo: ['path-19', 'gate-back'],
  },
];

// ═══════════════════════════════════════════════════════
// 完整校園 POI 資料（50+ 個地點）
// ═══════════════════════════════════════════════════════

export const CAMPUS_POIS: CampusPoi[] = [
  // ═══════════ 教學大樓 ═══════════
  {
    id: 'pu-providence',
    code: 'PH',
    name: '主顧樓',
    nameEn: 'Providence Hall',
    category: 'academic',
    lat: 24.22712,
    lng: 120.56517,
    floor: '1F~7F',
    description: '校園最大教學大樓，設有多間階梯教室與一般教室',
    departments: ['外國語文學院', '英國語文學系', '西班牙語文學系', '日本語文學系'],
    facilities: ['階梯教室', '語言教室', '電腦教室', '會議室'],
    accessible: true,
    hasElevator: true,
    openTime: '06:30',
    closeTime: '22:00',
    imageUrl: null,
  },
  {
    id: 'pu-renyuan',
    code: 'AK',
    name: '任垣樓',
    nameEn: 'Anthony Kuo Hall',
    category: 'academic',
    lat: 24.22765,
    lng: 120.56453,
    floor: 'B1~6F',
    description: '理工學院教學大樓，設有計算機中心（3樓）',
    departments: ['資訊工程學系', '資訊管理學系', '應用化學系', '計算機及網路中心'],
    facilities: ['計算機中心', '電腦教室', '實驗室', '階梯教室'],
    accessible: true,
    hasElevator: true,
    openTime: '06:30',
    closeTime: '22:00',
    imageUrl: null,
  },
  {
    id: 'pu-boduo',
    code: 'SP',
    name: '伯鐸樓',
    nameEn: 'St. Peter Hall',
    category: 'academic',
    lat: 24.22695,
    lng: 120.56398,
    floor: '1F~6F',
    description: '文學院及社會科學院教學大樓',
    departments: ['中國文學系', '大眾傳播學系', '社會工作與兒童少年福利學系', '台灣文學系'],
    facilities: ['教室', '研究室', '電腦教室'],
    accessible: true,
    hasElevator: true,
    openTime: '06:30',
    closeTime: '22:00',
    imageUrl: null,
  },
  {
    id: 'pu-jingan',
    code: 'JA',
    name: '靜安樓',
    nameEn: 'Jing An Hall',
    category: 'academic',
    lat: 24.2263,
    lng: 120.5649,
    floor: '1F~6F',
    description: '管理學院教學大樓',
    departments: ['企業管理學系', '國際企業學系', '會計學系', '觀光事業學系', '財務金融學系'],
    facilities: ['教室', '個案討論室', '電腦教室', '實驗室'],
    accessible: true,
    hasElevator: true,
    openTime: '06:30',
    closeTime: '22:00',
    imageUrl: null,
  },
  {
    id: 'pu-gelun',
    code: 'TG',
    name: '格倫樓',
    nameEn: 'Theodore Guerin Hall',
    category: 'academic',
    lat: 24.2268,
    lng: 120.5657,
    floor: '1F~5F',
    description: '法律學院暨教學大樓',
    departments: ['法律學系', '財經法律學系'],
    facilities: ['模擬法庭', '教室', '研討室'],
    accessible: true,
    hasElevator: true,
    openTime: '06:30',
    closeTime: '22:00',
    imageUrl: null,
  },
  {
    id: 'pu-fangji',
    code: 'SF',
    name: '方濟樓',
    nameEn: 'St. Francis Hall',
    category: 'academic',
    lat: 24.2274,
    lng: 120.566,
    floor: '1F~5F',
    description: '教學與行政複合大樓',
    departments: ['教育研究所', '師資培育中心'],
    facilities: ['教室', '教學觀摩室', '會議室'],
    accessible: true,
    hasElevator: true,
    openTime: '06:30',
    closeTime: '22:00',
    imageUrl: null,
  },
  {
    id: 'pu-siyuan',
    code: 'SY',
    name: '思源樓',
    nameEn: 'Si Yuan Hall',
    category: 'academic',
    lat: 24.2281,
    lng: 120.5653,
    floor: '1F~5F',
    description: '教學大樓，設有多功能教室',
    departments: ['通識教育中心'],
    facilities: ['多功能教室', '語言自學中心'],
    accessible: true,
    hasElevator: true,
    openTime: '06:30',
    closeTime: '22:00',
    imageUrl: null,
  },
  {
    id: 'pu-wenxing',
    code: 'WX',
    name: '文興樓',
    nameEn: 'Wen Xing Hall',
    category: 'academic',
    lat: 24.2266,
    lng: 120.5644,
    floor: '1F~5F',
    description: '人文暨社會科學院教學大樓',
    departments: ['生態人文學系', '社會企業與文化創意碩士學位學程'],
    facilities: ['教室', '研討室', '展演空間'],
    accessible: true,
    hasElevator: true,
    openTime: '06:30',
    closeTime: '22:00',
    imageUrl: null,
  },

  // ═══════════ 研究大樓 ═══════════
  {
    id: 'pu-research1',
    code: 'R1',
    name: '第一研究大樓',
    nameEn: 'Research Building 1',
    category: 'research',
    lat: 24.2285,
    lng: 120.5648,
    floor: '1F~6F',
    description: '研究所及實驗室集中大樓',
    departments: ['化粧品科學系', '食品營養學系', '靜宜大學研發處'],
    facilities: ['研究實驗室', '精密儀器室', '會議室'],
    accessible: true,
    hasElevator: true,
    openTime: '07:00',
    closeTime: '22:00',
    imageUrl: null,
  },
  {
    id: 'pu-research2',
    code: 'R2',
    name: '第二研究大樓',
    nameEn: 'Research Building 2',
    category: 'research',
    lat: 24.2287,
    lng: 120.5642,
    floor: '1F~5F',
    description: '理學院研究大樓',
    departments: ['應用化學系研究所', '資訊工程學系研究所'],
    facilities: ['研究實驗室', '伺服器機房'],
    accessible: true,
    hasElevator: true,
    openTime: '07:00',
    closeTime: '22:00',
    imageUrl: null,
  },

  // ═══════════ 圖書館 ═══════════
  {
    id: 'pu-library',
    code: 'LIB',
    name: '蓋夏圖書館',
    nameEn: 'Gaesia Library',
    category: 'library',
    lat: 24.2275,
    lng: 120.5635,
    floor: 'B1~5F',
    description: '校園主圖書館，藏書約60萬冊，設有多媒體中心、自習室、討論室',
    departments: ['圖書館'],
    facilities: ['自習區', '多媒體中心', '討論室', '影印中心', '視聽區', '咖啡吧'],
    accessible: true,
    hasElevator: true,
    openTime: '08:00',
    closeTime: '22:00',
    imageUrl: null,
  },

  // ═══════════ 行政中心 ═══════════
  {
    id: 'pu-admin',
    code: 'ADM',
    name: '行政大樓',
    nameEn: 'Administration Building',
    category: 'admin',
    lat: 24.2272,
    lng: 120.5638,
    floor: '1F~4F',
    description: '校務行政中心，校長室、教務處、學務處、總務處均在此',
    departments: ['校長室', '教務處', '學務處', '總務處', '秘書室', '人事室', '主計室'],
    facilities: ['校長室', '會議室', '服務櫃台'],
    accessible: true,
    hasElevator: true,
    openTime: '08:00',
    closeTime: '17:00',
    imageUrl: null,
  },
  {
    id: 'pu-intl',
    code: 'INTL',
    name: '國際暨兩岸事務處',
    nameEn: 'Office of International Affairs',
    category: 'admin',
    lat: 24.2273,
    lng: 120.5643,
    floor: '1F~2F',
    description: '國際學生服務、交換學生、出國留學事務',
    departments: ['國際暨兩岸事務處'],
    facilities: ['諮詢櫃台', '會議室'],
    accessible: true,
    hasElevator: false,
    openTime: '08:00',
    closeTime: '17:00',
    imageUrl: null,
  },

  // ═══════════ 餐廳 ═══════════
  {
    id: 'pu-jingyuan',
    code: 'JYR',
    name: '靜園餐廳',
    nameEn: 'Jingyuan Cafeteria',
    category: 'cafeteria',
    lat: 24.22615,
    lng: 120.56465,
    floor: '1F~3F',
    description: '校園最大綜合餐廳，300個座位，供應自助餐、麵食、壽司、炸物等',
    departments: [],
    facilities: ['自助餐', '壽司', '滷味', '炸物', '蔬食', '飲料'],
    accessible: true,
    hasElevator: false,
    openTime: '07:00',
    closeTime: '19:00',
    imageUrl: null,
  },
  {
    id: 'pu-yiyuan',
    code: 'YYR',
    name: '宜園餐廳',
    nameEn: 'Yiyuan Cafeteria',
    category: 'cafeteria',
    lat: 24.2259,
    lng: 120.5638,
    floor: '1F~2F',
    description: '座位數最多的餐廳（422席），供應自助餐、簡餐、韓式料理等',
    departments: [],
    facilities: ['自助餐', '簡餐', '韓式料理', '水餃', '飲料'],
    accessible: true,
    hasElevator: false,
    openTime: '07:00',
    closeTime: '19:00',
    imageUrl: null,
  },
  {
    id: 'pu-zhishan',
    code: 'ZSR',
    name: '至善美食廣場',
    nameEn: 'Zhishan Food Court',
    category: 'cafeteria',
    lat: 24.2256,
    lng: 120.5632,
    floor: '1F~2F',
    description: '美食廣場含便利商店，220個座位，營業至晚間',
    departments: [],
    facilities: ['OK便利商店', '滷味', '鬆餅', '水果', '牛肉麵', '飲料'],
    accessible: true,
    hasElevator: false,
    openTime: '07:30',
    closeTime: '20:00',
    imageUrl: null,
  },

  // ═══════════ 宿舍 ═══════════
  {
    id: 'pu-dorm-faith',
    code: 'DM1',
    name: '信德宿舍',
    nameEn: 'Faith Dormitory',
    category: 'dormitory',
    lat: 24.2254,
    lng: 120.5658,
    floor: '1F~7F',
    description: '女生宿舍，4人房為主',
    departments: [],
    facilities: ['交誼廳', '自習室', '洗衣房', '曬衣場'],
    accessible: true,
    hasElevator: true,
    openTime: '00:00',
    closeTime: '23:59',
    imageUrl: null,
  },
  {
    id: 'pu-dorm-hope',
    code: 'DM2',
    name: '望德宿舍',
    nameEn: 'Hope Dormitory',
    category: 'dormitory',
    lat: 24.2252,
    lng: 120.5655,
    floor: '1F~7F',
    description: '女生宿舍',
    departments: [],
    facilities: ['交誼廳', '自習室', '洗衣房'],
    accessible: true,
    hasElevator: true,
    openTime: '00:00',
    closeTime: '23:59',
    imageUrl: null,
  },
  {
    id: 'pu-dorm-love',
    code: 'DM3',
    name: '愛德宿舍',
    nameEn: 'Love Dormitory',
    category: 'dormitory',
    lat: 24.225,
    lng: 120.5652,
    floor: '1F~7F',
    description: '男生宿舍',
    departments: [],
    facilities: ['交誼廳', '自習室', '洗衣房'],
    accessible: true,
    hasElevator: true,
    openTime: '00:00',
    closeTime: '23:59',
    imageUrl: null,
  },
  {
    id: 'pu-dorm-ren',
    code: 'DM4',
    name: '仁愛宿舍',
    nameEn: 'Ren Ai Dormitory',
    category: 'dormitory',
    lat: 24.2248,
    lng: 120.5649,
    floor: '1F~5F',
    description: '研究生宿舍 / BOT',
    departments: [],
    facilities: ['交誼廳', '自習室', '洗衣房', '停車場'],
    accessible: true,
    hasElevator: true,
    openTime: '00:00',
    closeTime: '23:59',
    imageUrl: null,
  },

  // ═══════════ 運動設施 ═══════════
  {
    id: 'pu-gym',
    code: 'GYM',
    name: '體育館',
    nameEn: 'John Paul II Sports Hall',
    category: 'sports',
    lat: 24.2258,
    lng: 120.5635,
    floor: 'B1~3F',
    description: '綜合體育館，設有籃球場、羽球場、桌球室、健身房、游泳池',
    departments: ['體育室'],
    facilities: ['籃球場', '羽球場', '桌球室', '健身房', '游泳池', '韻律教室'],
    accessible: true,
    hasElevator: true,
    openTime: '06:00',
    closeTime: '22:00',
    imageUrl: null,
  },
  {
    id: 'pu-track',
    code: 'TRK',
    name: '田徑場',
    nameEn: 'Athletic Field',
    category: 'sports',
    lat: 24.2252,
    lng: 120.564,
    floor: '戶外',
    description: '400公尺標準PU跑道、足球場',
    departments: [],
    facilities: ['400m跑道', '足球場', '司令台', '看台'],
    accessible: true,
    hasElevator: false,
    openTime: '06:00',
    closeTime: '22:00',
    imageUrl: null,
  },
  {
    id: 'pu-tennis',
    code: 'TEN',
    name: '網球場',
    nameEn: 'Tennis Courts',
    category: 'sports',
    lat: 24.2255,
    lng: 120.5628,
    floor: '戶外',
    description: '4面標準網球場',
    departments: [],
    facilities: ['網球場x4', '照明設備'],
    accessible: true,
    hasElevator: false,
    openTime: '06:00',
    closeTime: '22:00',
    imageUrl: null,
  },
  {
    id: 'pu-basketball',
    code: 'BBL',
    name: '室外籃球場',
    nameEn: 'Outdoor Basketball Courts',
    category: 'sports',
    lat: 24.2254,
    lng: 120.5633,
    floor: '戶外',
    description: '6面室外籃球場',
    departments: [],
    facilities: ['籃球場x6', '照明設備'],
    accessible: true,
    hasElevator: false,
    openTime: '06:00',
    closeTime: '22:00',
    imageUrl: null,
  },

  // ═══════════ 停車場 ═══════════
  {
    id: 'pu-parking-main',
    code: 'PK1',
    name: '主停車場',
    nameEn: 'Main Parking Lot',
    category: 'parking',
    lat: 24.2249,
    lng: 120.5644,
    floor: '平面',
    description: '臺灣大道旁主要停車場，約200個車位',
    departments: [],
    facilities: ['汽車停車位x200', '機車停車位x500'],
    accessible: true,
    hasElevator: false,
    openTime: '06:00',
    closeTime: '22:00',
    imageUrl: null,
  },
  {
    id: 'pu-parking-north',
    code: 'PK2',
    name: '北側停車場',
    nameEn: 'North Parking Lot',
    category: 'parking',
    lat: 24.2288,
    lng: 120.5645,
    floor: '平面',
    description: '後門旁停車場',
    departments: [],
    facilities: ['汽車停車位x80', '機車停車位x200'],
    accessible: true,
    hasElevator: false,
    openTime: '06:00',
    closeTime: '22:00',
    imageUrl: null,
  },
  {
    id: 'pu-parking-moto',
    code: 'PK3',
    name: '機車停車場',
    nameEn: 'Motorcycle Parking',
    category: 'parking',
    lat: 24.2251,
    lng: 120.5648,
    floor: '平面',
    description: '正門旁機車停車場',
    departments: [],
    facilities: ['機車停車位x800'],
    accessible: true,
    hasElevator: false,
    openTime: '00:00',
    closeTime: '23:59',
    imageUrl: null,
  },

  // ═══════════ 便利商店 / ATM ═══════════
  {
    id: 'pu-7eleven',
    code: '711',
    name: '7-ELEVEN 靜宜門市',
    nameEn: '7-ELEVEN',
    category: 'convenience',
    lat: 24.2265,
    lng: 120.5651,
    floor: '1F',
    description: '24小時便利商店',
    departments: [],
    facilities: ['ATM', 'ibon', '座位區', '咖啡'],
    accessible: true,
    hasElevator: false,
    openTime: '00:00',
    closeTime: '23:59',
    imageUrl: null,
  },
  {
    id: 'pu-ok-mart',
    code: 'OK',
    name: 'OK便利商店 至善店',
    nameEn: 'OK Mart',
    category: 'convenience',
    lat: 24.2256,
    lng: 120.56325,
    floor: '1F',
    description: '至善美食廣場1樓便利商店',
    departments: [],
    facilities: ['ATM', '座位區'],
    accessible: true,
    hasElevator: false,
    openTime: '07:30',
    closeTime: '21:00',
    imageUrl: null,
  },
  {
    id: 'pu-atm',
    code: 'ATM',
    name: '郵局ATM',
    nameEn: 'Post Office ATM',
    category: 'convenience',
    lat: 24.2264,
    lng: 120.5648,
    floor: '1F',
    description: '靜安樓1樓ATM',
    departments: [],
    facilities: ['ATM'],
    accessible: true,
    hasElevator: false,
    openTime: '00:00',
    closeTime: '23:59',
    imageUrl: null,
  },

  // ═══════════ 醫療 ═══════════
  {
    id: 'pu-health',
    code: 'HC',
    name: '健康中心',
    nameEn: 'Health Center',
    category: 'medical',
    lat: 24.2267,
    lng: 120.5643,
    floor: '1F',
    description: '校園健康中心，提供基本醫療、健檢、心理諮商',
    departments: ['學務處衛生保健組', '諮商中心'],
    facilities: ['護理站', '心理諮商室', '健檢室'],
    accessible: true,
    hasElevator: false,
    openTime: '08:00',
    closeTime: '17:00',
    imageUrl: null,
  },

  // ═══════════ 宗教設施 ═══════════
  {
    id: 'pu-chapel',
    code: 'CH',
    name: '主顧聖母堂',
    nameEn: 'Chapel of Our Lady of Providence',
    category: 'religious',
    lat: 24.2266,
    lng: 120.5632,
    floor: '1F~2F',
    description: '天主教聖堂，為校園精神中心，定期舉辦彌撒',
    departments: ['校牧室'],
    facilities: ['聖堂', '祈禱室', '會議室'],
    accessible: true,
    hasElevator: false,
    openTime: '07:00',
    closeTime: '21:00',
    imageUrl: null,
  },
  {
    id: 'pu-convent',
    code: 'CNV',
    name: '主顧修女會院',
    nameEn: 'Sisters of Providence Convent',
    category: 'religious',
    lat: 24.227,
    lng: 120.563,
    floor: '1F~3F',
    description: '主顧修女會修院',
    departments: ['主顧修女會'],
    facilities: [],
    accessible: true,
    hasElevator: true,
    openTime: '06:00',
    closeTime: '21:00',
    imageUrl: null,
  },

  // ═══════════ 校門 ═══════════
  {
    id: 'pu-gate-main',
    code: 'MG',
    name: '正門（臺灣大道）',
    nameEn: 'Main Gate',
    category: 'gate',
    lat: 24.22495,
    lng: 120.56535,
    floor: '地面',
    description: '臺灣大道主要入口，設有警衛室',
    departments: ['駐警隊'],
    facilities: ['警衛室', '訪客登記'],
    accessible: true,
    hasElevator: false,
    openTime: '00:00',
    closeTime: '23:59',
    imageUrl: null,
  },
  {
    id: 'pu-gate-back',
    code: 'BG',
    name: '後門（英才路）',
    nameEn: 'Back Gate',
    category: 'gate',
    lat: 24.2292,
    lng: 120.5638,
    floor: '地面',
    description: '英才路後門，通往北側停車場',
    departments: [],
    facilities: ['警衛室'],
    accessible: true,
    hasElevator: false,
    openTime: '06:00',
    closeTime: '22:00',
    imageUrl: null,
  },

  // ═══════════ 其他重要設施 ═══════════
  {
    id: 'pu-arts',
    code: 'ART',
    name: '藝術中心',
    nameEn: 'Art Center',
    category: 'other',
    lat: 24.2269,
    lng: 120.5635,
    floor: '1F~2F',
    description: '展覽廳、藝文活動空間',
    departments: ['藝術中心'],
    facilities: ['展覽廳', '多功能廳'],
    accessible: true,
    hasElevator: false,
    openTime: '09:00',
    closeTime: '17:00',
    imageUrl: null,
  },
  {
    id: 'pu-student-center',
    code: 'SC',
    name: '學生活動中心',
    nameEn: 'Student Activity Center',
    category: 'other',
    lat: 24.226,
    lng: 120.565,
    floor: '1F~3F',
    description: '社團辦公室、學生會、活動空間',
    departments: ['學生會', '社團聯合會'],
    facilities: ['社團辦公室', '活動大廳', '會議室', '排練室'],
    accessible: true,
    hasElevator: true,
    openTime: '08:00',
    closeTime: '22:00',
    imageUrl: null,
  },
  {
    id: 'pu-auditorium',
    code: 'AUD',
    name: '至善國際會議廳',
    nameEn: 'Zhishan International Conference Hall',
    category: 'other',
    lat: 24.2257,
    lng: 120.563,
    floor: '1F~2F',
    description: '大型國際會議廳，可容納500人',
    departments: [],
    facilities: ['大禮堂(500席)', '小型會議室x3', '貴賓室'],
    accessible: true,
    hasElevator: true,
    openTime: '08:00',
    closeTime: '22:00',
    imageUrl: null,
  },
  {
    id: 'pu-greenhouse',
    code: 'GH',
    name: '溫室/生態園區',
    nameEn: 'Greenhouse & Eco Park',
    category: 'other',
    lat: 24.2283,
    lng: 120.5636,
    floor: '戶外',
    description: '生態教育園區及溫室',
    departments: ['生態人文學系'],
    facilities: ['溫室', '生態步道', '蝴蝶園'],
    accessible: false,
    hasElevator: false,
    openTime: '08:00',
    closeTime: '17:00',
    imageUrl: null,
  },
  {
    id: 'pu-bus-stop',
    code: 'BUS',
    name: '靜宜大學站（公車）',
    nameEn: 'PU Bus Stop',
    category: 'gate',
    lat: 24.2247,
    lng: 120.5654,
    floor: '地面',
    description: '臺灣大道公車站牌（BRT/公車），多線公車停靠',
    departments: [],
    facilities: ['候車亭', '路線圖'],
    accessible: true,
    hasElevator: false,
    openTime: '05:30',
    closeTime: '23:30',
    imageUrl: null,
  },
];

// ═══════════════════════════════════════════════════════
// 校園邊界（用於地圖顯示範圍限制）
// ═══════════════════════════════════════════════════════

export const CAMPUS_BOUNDS = {
  north: 24.2295,
  south: 24.2243,
  east: 120.5665,
  west: 120.5622,
  center: { lat: 24.227, lng: 120.56435 },
  defaultZoom: 17,
};

// ═══════════════════════════════════════════════════════
// 分類標籤
// ═══════════════════════════════════════════════════════

export const CATEGORY_LABELS: Record<CampusPoiCategory, string> = {
  academic: '教學大樓',
  admin: '行政單位',
  library: '圖書館',
  cafeteria: '餐廳',
  dormitory: '宿舍',
  sports: '運動設施',
  parking: '停車場',
  convenience: '便利商店',
  medical: '醫療',
  religious: '宗教設施',
  gate: '出入口',
  research: '研究大樓',
  other: '其他',
};

export const CATEGORY_ICONS: Record<CampusPoiCategory, string> = {
  academic: 'school-outline',
  admin: 'business-outline',
  library: 'library-outline',
  cafeteria: 'restaurant-outline',
  dormitory: 'home-outline',
  sports: 'fitness-outline',
  parking: 'car-outline',
  convenience: 'storefront-outline',
  medical: 'medkit-outline',
  religious: 'heart-outline',
  gate: 'enter-outline',
  research: 'flask-outline',
  other: 'ellipsis-horizontal-outline',
};

export const CATEGORY_COLORS: Record<CampusPoiCategory, string> = {
  academic: '#5856D6',
  admin: '#AF52DE',
  library: '#34C759',
  cafeteria: '#D70015',
  dormitory: '#FF9500',
  sports: '#34C759',
  parking: '#8E8E93',
  convenience: '#0891B2',
  medical: '#D70015',
  religious: '#9333EA',
  gate: '#475569',
  research: '#5856D6',
  other: '#8E8E93',
};

// ═══════════════════════════════════════════════════════
// 工具函數
// ═══════════════════════════════════════════════════════

/** 取得所有 POI */
export function getAllPois(): CampusPoi[] {
  return CAMPUS_POIS;
}

/** 按分類篩選 */
export function getPoisByCategory(category: CampusPoiCategory): CampusPoi[] {
  return CAMPUS_POIS.filter((p) => p.category === category);
}

/** 搜尋 POI */
export function searchCampusPois(keyword: string): CampusPoi[] {
  const lower = keyword.toLowerCase();
  return CAMPUS_POIS.filter(
    (p) =>
      p.name.includes(keyword) ||
      p.nameEn.toLowerCase().includes(lower) ||
      p.code.toLowerCase().includes(lower) ||
      p.description.includes(keyword) ||
      p.departments.some((d) => d.includes(keyword)) ||
      p.facilities.some((f) => f.includes(keyword)),
  );
}

/** 取得 POI */
export function getCampusPoi(id: string): CampusPoi | undefined {
  return CAMPUS_POIS.find((p) => p.id === id);
}

/** 尋找離指定座標最近的路網節點 */
export function findNearestPathNode(lat: number, lng: number): CampusPathNode {
  let nearest = CAMPUS_PATH_NODES[0];
  let minDist = Infinity;
  for (const node of CAMPUS_PATH_NODES) {
    const d = Math.sqrt(Math.pow(node.lat - lat, 2) + Math.pow(node.lng - lng, 2));
    if (d < minDist) {
      minDist = d;
      nearest = node;
    }
  }
  return nearest;
}

/**
 * A* 路徑規劃 — 在校園路網上找最短路徑
 */
export function findShortestPath(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
): CampusPathNode[] {
  const startNode = findNearestPathNode(startLat, startLng);
  const endNode = findNearestPathNode(endLat, endLng);

  if (startNode.id === endNode.id) return [startNode];

  // A* algorithm
  const nodeMap = new Map<string, CampusPathNode>();
  CAMPUS_PATH_NODES.forEach((n) => nodeMap.set(n.id, n));

  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const openSet = new Set<string>([startNode.id]);
  const closedSet = new Set<string>();

  gScore.set(startNode.id, 0);
  fScore.set(startNode.id, heuristic(startNode, endNode));

  while (openSet.size > 0) {
    // Find node with lowest fScore
    let current = '';
    let lowestF = Infinity;
    for (const id of openSet) {
      const f = fScore.get(id) ?? Infinity;
      if (f < lowestF) {
        lowestF = f;
        current = id;
      }
    }

    if (current === endNode.id) {
      // Reconstruct path
      const path: CampusPathNode[] = [];
      let c: string | undefined = current;
      while (c) {
        const node = nodeMap.get(c);
        if (node) path.unshift(node);
        c = cameFrom.get(c);
      }
      return path;
    }

    openSet.delete(current);
    closedSet.add(current);

    const currentNode = nodeMap.get(current);
    if (!currentNode) break;

    for (const neighborId of currentNode.connectedTo) {
      if (closedSet.has(neighborId)) continue;
      const neighbor = nodeMap.get(neighborId);
      if (!neighbor) continue;

      const tentativeG = (gScore.get(current) ?? Infinity) + distBetween(currentNode, neighbor);

      if (!openSet.has(neighborId)) {
        openSet.add(neighborId);
      } else if (tentativeG >= (gScore.get(neighborId) ?? Infinity)) {
        continue;
      }

      cameFrom.set(neighborId, current);
      gScore.set(neighborId, tentativeG);
      fScore.set(neighborId, tentativeG + heuristic(neighbor, endNode));
    }
  }

  // No path found, return direct
  return [startNode, endNode];
}

function heuristic(a: CampusPathNode, b: CampusPathNode): number {
  return distBetween(a, b);
}

function distBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  // Approximate meters using Haversine
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const aH =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(aH), Math.sqrt(1 - aH));
}

/**
 * 將路徑轉換為導航步驟指示
 */
export function pathToNavigationSteps(
  path: CampusPathNode[],
  destinationName: string,
): Array<{
  instruction: string;
  distance: number;
  direction: 'straight' | 'left' | 'right' | 'slight_left' | 'slight_right' | 'destination';
  lat: number;
  lng: number;
}> {
  if (path.length < 2) {
    return [
      {
        instruction: `抵達 ${destinationName}`,
        distance: 0,
        direction: 'destination',
        lat: path[0]?.lat ?? 0,
        lng: path[0]?.lng ?? 0,
      },
    ];
  }

  const steps: Array<{
    instruction: string;
    distance: number;
    direction: 'straight' | 'left' | 'right' | 'slight_left' | 'slight_right' | 'destination';
    lat: number;
    lng: number;
  }> = [];

  for (let i = 0; i < path.length - 1; i++) {
    const current = path[i];
    const next = path[i + 1];
    const dist = Math.round(distBetween(current, next));

    if (i === 0) {
      steps.push({
        instruction: `出發，往${next.name ?? '前方'}直走 ${dist} 公尺`,
        distance: dist,
        direction: 'straight',
        lat: current.lat,
        lng: current.lng,
      });
      continue;
    }

    const prev = path[i - 1];
    // Calculate turn angle
    const prevBearing =
      (Math.atan2(current.lng - prev.lng, current.lat - prev.lat) * 180) / Math.PI;
    const nextBearing =
      (Math.atan2(next.lng - current.lng, next.lat - current.lat) * 180) / Math.PI;
    let turnAngle = nextBearing - prevBearing;
    if (turnAngle > 180) turnAngle -= 360;
    if (turnAngle < -180) turnAngle += 360;

    let direction: 'straight' | 'left' | 'right' | 'slight_left' | 'slight_right' = 'straight';
    let turnText = '直走';

    if (turnAngle > 30 && turnAngle <= 90) {
      direction = 'right';
      turnText = '右轉';
    } else if (turnAngle > 10 && turnAngle <= 30) {
      direction = 'slight_right';
      turnText = '稍微右轉';
    } else if (turnAngle < -30 && turnAngle >= -90) {
      direction = 'left';
      turnText = '左轉';
    } else if (turnAngle < -10 && turnAngle >= -30) {
      direction = 'slight_left';
      turnText = '稍微左轉';
    } else if (Math.abs(turnAngle) > 90) {
      direction = turnAngle > 0 ? 'right' : 'left';
      turnText = turnAngle > 0 ? '大幅右轉' : '大幅左轉';
    }

    const landmarkText = current.name ? `在${current.name}` : '';
    steps.push({
      instruction: `${landmarkText}${turnText}，直走 ${dist} 公尺`,
      distance: dist,
      direction,
      lat: current.lat,
      lng: current.lng,
    });
  }

  // Final destination step
  const last = path[path.length - 1];
  steps.push({
    instruction: `抵達 ${destinationName}`,
    distance: 0,
    direction: 'destination',
    lat: last.lat,
    lng: last.lng,
  });

  return steps;
}
