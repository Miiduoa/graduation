/* eslint-disable */
/**
 * 校園室內樓層平面圖資料庫
 *
 * 涵蓋：
 *   1. 蓋夏圖書館（B1 ~ 4F，完整 5 樓）
 *   2. 任垣樓 R1（簡化版 1 樓，含計算機中心）
 *   3. 主顧樓（簡化版 1 樓，含階梯教室）
 *
 * 座標系統：每張平面圖採用 1000×600 的內部座標
 *  - 0,0 為左上角
 *  - 1000,600 為右下角
 *  - SVG viewBox 直接使用此座標
 *
 * 所有資料用於：
 *   - IndoorFloorMapScreen 渲染互動 SVG
 *   - 全文搜尋（找電腦/找位置/找書區）
 *   - 多樓層導航（從 1 樓走到 3 樓 X 區）
 */

export type RoomKind =
  | 'study' // 自習座位
  | 'classroom' // 教室/階梯教室
  | 'office' // 辦公室
  | 'restroom' // 洗手間
  | 'kitchen' // 茶水間
  | 'service' // 服務台/櫃台
  | 'computer' // 電腦使用區
  | 'collection' // 書庫/館藏
  | 'meeting' // 討論室
  | 'lounge' // 休息區
  | 'lab' // 實驗室/電腦教室
  | 'storage' // 儲藏室
  | 'lobby' // 大廳
  | 'corridor' // 走廊
  | 'stairs' // 樓梯
  | 'elevator' // 電梯
  | 'entrance' // 出入口
  | 'special'; // 特殊（咖啡、書店）

export type CrowdLevel = 'empty' | 'low' | 'medium' | 'high' | 'full';

export type IndoorRoom = {
  id: string;
  /** 顯示用名稱 */
  name: string;
  /** 房間代號 */
  code: string;
  kind: RoomKind;
  /** SVG polygon 座標（順時針或逆時針）。最少 3 點。 */
  polygon: { x: number; y: number }[];
  /** 標籤錨點（顯示房名的位置） */
  labelAt: { x: number; y: number };
  /** 描述 */
  description: string;
  /** 容納人數（座位數） */
  capacity?: number;
  /** 設備清單 */
  facilities: string[];
  /** 開放時段（HH:MM-HH:MM） */
  openTime?: string;
  /** 是否要刷卡進入 */
  requiresCard?: boolean;
  /** 是否可預約 */
  bookable?: boolean;
  /** 即時人潮（demo 由 hash 模擬） */
  defaultCrowd?: CrowdLevel;
  /** 搜尋關鍵字（找書/找電腦/找位置） */
  keywords: string[];
};

export type IndoorFloor = {
  id: string; // 例如 'lib-1f' 或 'lib-b1'
  /** 短代號顯示在分頁上 */
  shortLabel: string; // '1F' / 'B1'
  /** 完整名稱 */
  name: string; // '一樓'
  /** 對應的實際樓層數（用於排序） */
  level: number; // -1 = B1，1 = 1F，2 = 2F...
  rooms: IndoorRoom[];
  /** 樓層中的連通點（電梯/樓梯垂直連通） */
  vertical: {
    id: string;
    kind: 'elevator' | 'stairs';
    label: string;
    at: { x: number; y: number };
  }[];
  /** 樓層特色（顯示在頂部） */
  highlight: string;
  /** 此樓層的搜尋關鍵字 */
  keywords: string[];
};

export type IndoorMap = {
  id: string;
  /** 對應 PoiId（例如 'pu-library'） */
  poiId: string;
  /** 建築物名稱 */
  name: string;
  nameEn: string;
  /** SVG viewBox 寬高 */
  viewBox: { width: number; height: number };
  /** 預設顯示樓層 */
  defaultFloorId: string;
  floors: IndoorFloor[];
  /** 建築物特色（顯示在頂部 hero） */
  description: string;
  /** 建築主色 */
  themeColor: string;
};

// ═════════════════════════════════════════════════════════
// 房間種類顯示設定
// ═════════════════════════════════════════════════════════

export const ROOM_KIND_LABEL: Record<RoomKind, string> = {
  study: '自習區',
  classroom: '教室',
  office: '辦公室',
  restroom: '洗手間',
  kitchen: '茶水間',
  service: '服務台',
  computer: '電腦區',
  collection: '館藏',
  meeting: '討論室',
  lounge: '休息區',
  lab: '電腦教室',
  storage: '儲藏室',
  lobby: '大廳',
  corridor: '走廊',
  stairs: '樓梯',
  elevator: '電梯',
  entrance: '出入口',
  special: '特殊',
};

export const ROOM_KIND_COLOR: Record<RoomKind, string> = {
  study: '#34C759',
  classroom: '#007AFF',
  office: '#64748B',
  restroom: '#94A3B8',
  kitchen: '#A78BFA',
  service: '#FF9500',
  computer: '#06B6D4',
  collection: '#AF52DE',
  meeting: '#FF2D55',
  lounge: '#FF9500',
  lab: '#0EA5E9',
  storage: '#71717A',
  lobby: '#FCD34D',
  corridor: '#1F2937',
  stairs: '#475569',
  elevator: '#3C3C43',
  entrance: '#D70015',
  special: '#A855F7',
};

export const ROOM_KIND_EMOJI: Record<RoomKind, string> = {
  study: '📖',
  classroom: '🏫',
  office: '🗄️',
  restroom: '🚻',
  kitchen: '☕',
  service: '💁',
  computer: '🖥️',
  collection: '📚',
  meeting: '👥',
  lounge: '🛋️',
  lab: '💻',
  storage: '📦',
  lobby: '🏛️',
  corridor: '➖',
  stairs: '🪜',
  elevator: '🛗',
  entrance: '🚪',
  special: '✨',
};

// ═════════════════════════════════════════════════════════
// 蓋夏圖書館 — 5 樓完整資料
// 規格參考：靜宜大學蓋夏圖書館實際樓層配置
// ═════════════════════════════════════════════════════════

const LIB_VIEWBOX = { width: 1000, height: 600 };

// 共用：圖書館每樓的電梯與樓梯位置（垂直連通）
const LIB_VERTICAL: IndoorFloor['vertical'] = [
  { id: 'lib-elev-a', kind: 'elevator', label: '主電梯', at: { x: 500, y: 300 } },
  { id: 'lib-elev-b', kind: 'elevator', label: '貨梯', at: { x: 880, y: 300 } },
  { id: 'lib-stairs-a', kind: 'stairs', label: '主樓梯', at: { x: 430, y: 300 } },
  { id: 'lib-stairs-b', kind: 'stairs', label: '後樓梯', at: { x: 90, y: 300 } },
];

// 共用 rect builder
function rect(
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number }[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

// ── B1 密集書庫 ──
const LIB_B1: IndoorFloor = {
  id: 'lib-b1',
  shortLabel: 'B1',
  name: '地下一樓 · 密集書庫',
  level: -1,
  highlight: '密集書庫 · 過期期刊 · 機械停車',
  keywords: ['書庫', '密集書庫', '期刊', '檔案', '機械停車'],
  vertical: LIB_VERTICAL,
  rooms: [
    {
      id: 'b1-stack-a',
      name: '密集書庫 A 區',
      code: 'B1-A',
      kind: 'collection',
      polygon: rect(80, 80, 360, 160),
      labelAt: { x: 260, y: 160 },
      description: '中文圖書 800-900 類密集書庫，需請館員協助取書',
      capacity: 0,
      facilities: ['密集書架', '操作把手'],
      openTime: '09:00-21:00',
      requiresCard: true,
      keywords: ['書庫', '密集', '中文書', '哲學', '宗教'],
      defaultCrowd: 'empty',
    },
    {
      id: 'b1-stack-b',
      name: '密集書庫 B 區',
      code: 'B1-B',
      kind: 'collection',
      polygon: rect(80, 260, 360, 160),
      labelAt: { x: 260, y: 340 },
      description: '中文圖書 700 類（藝術）密集書庫',
      capacity: 0,
      facilities: ['密集書架'],
      openTime: '09:00-21:00',
      requiresCard: true,
      keywords: ['藝術', '建築', '密集書庫'],
      defaultCrowd: 'empty',
    },
    {
      id: 'b1-journals',
      name: '過期期刊區',
      code: 'B1-J',
      kind: 'collection',
      polygon: rect(560, 80, 360, 200),
      labelAt: { x: 740, y: 180 },
      description: '存放 5 年以上之過期期刊',
      facilities: ['期刊架', '影印機'],
      openTime: '09:00-21:00',
      keywords: ['期刊', '雜誌', '過期'],
      defaultCrowd: 'empty',
    },
    {
      id: 'b1-parking',
      name: '機械停車區',
      code: 'B1-P',
      kind: 'special',
      polygon: rect(560, 320, 360, 200),
      labelAt: { x: 740, y: 420 },
      description: '館員專用機械停車',
      facilities: ['機械停車塔'],
      keywords: ['停車', '機車'],
      defaultCrowd: 'low',
    },
    {
      id: 'b1-restroom-w',
      name: '洗手間（西）',
      code: 'B1-R',
      kind: 'restroom',
      polygon: rect(450, 440, 100, 80),
      labelAt: { x: 500, y: 480 },
      description: '男女洗手間 + 無障礙',
      facilities: ['無障礙廁所'],
      keywords: ['洗手間', '廁所', 'toilet'],
    },
  ],
};

// ── 1F 流通櫃台/服務區 ──
const LIB_1F: IndoorFloor = {
  id: 'lib-1f',
  shortLabel: '1F',
  name: '一樓 · 流通與新書',
  level: 1,
  highlight: '流通櫃台 · 新書展示 · 期刊閱覽 · 自助借還',
  keywords: ['借書', '還書', '新書', '報紙', '服務台', '咖啡'],
  vertical: LIB_VERTICAL,
  rooms: [
    {
      id: '1f-entrance',
      name: '主入口',
      code: 'GATE',
      kind: 'entrance',
      polygon: rect(440, 540, 120, 50),
      labelAt: { x: 500, y: 565 },
      description: '館內主要出入口，刷學生證感應進入',
      facilities: ['防盜門', '刷卡感應'],
      keywords: ['入口', '出入口', '感應門'],
    },
    {
      id: '1f-lobby',
      name: '挑高大廳',
      code: 'LOBBY',
      kind: 'lobby',
      polygon: rect(380, 360, 240, 180),
      labelAt: { x: 500, y: 450 },
      description: '挑空大廳，展示靜宜歷史與校園出版品',
      facilities: ['公告板', '展示櫃'],
      keywords: ['大廳', '挑高', '展覽'],
      defaultCrowd: 'medium',
    },
    {
      id: '1f-service',
      name: '流通櫃台',
      code: 'SRV',
      kind: 'service',
      polygon: rect(140, 380, 200, 80),
      labelAt: { x: 240, y: 420 },
      description: '借還書、辦證、館際合作、罰款繳費',
      facilities: ['人工服務', '繳費機'],
      openTime: '08:30-21:00',
      keywords: ['借書', '還書', '罰款', '辦證', '櫃台'],
      defaultCrowd: 'high',
    },
    {
      id: '1f-self-checkout',
      name: '自助借書機',
      code: 'AUTO',
      kind: 'service',
      polygon: rect(140, 480, 200, 60),
      labelAt: { x: 240, y: 510 },
      description: '24 小時可用的自助借書還書機',
      facilities: ['自助機 ×3'],
      keywords: ['自助', '借書機', '24 小時'],
      defaultCrowd: 'low',
    },
    {
      id: '1f-new-books',
      name: '新書展示區',
      code: 'NEW',
      kind: 'collection',
      polygon: rect(80, 80, 360, 280),
      labelAt: { x: 260, y: 220 },
      description: '近三個月入館新書，依分類展示',
      facilities: ['新書架', '推薦展板'],
      openTime: '08:30-21:00',
      keywords: ['新書', '推薦', '展示'],
      defaultCrowd: 'medium',
    },
    {
      id: '1f-newspaper',
      name: '報紙期刊閱覽',
      code: 'NEWS',
      kind: 'study',
      polygon: rect(560, 80, 360, 200),
      labelAt: { x: 740, y: 180 },
      description: '當期報紙、雜誌閱覽座位',
      capacity: 32,
      facilities: ['沙發座位', '當期期刊架', '報紙夾'],
      openTime: '08:30-21:00',
      keywords: ['報紙', '雜誌', '期刊', '閱覽'],
      defaultCrowd: 'low',
    },
    {
      id: '1f-cafe',
      name: '蓋夏咖啡',
      code: 'CAFE',
      kind: 'special',
      polygon: rect(620, 320, 200, 140),
      labelAt: { x: 720, y: 390 },
      description: '館內咖啡角落，可以邊讀邊喝',
      facilities: ['咖啡機', '輕食', '無線網路'],
      openTime: '09:00-20:00',
      keywords: ['咖啡', '輕食', '餐飲'],
      defaultCrowd: 'medium',
    },
    {
      id: '1f-restroom',
      name: '一樓洗手間',
      code: '1F-R',
      kind: 'restroom',
      polygon: rect(840, 440, 80, 80),
      labelAt: { x: 880, y: 480 },
      description: '男女洗手間 + 哺乳室',
      facilities: ['哺乳室', '無障礙'],
      keywords: ['洗手間', '廁所', '哺乳'],
    },
  ],
};

// ── 2F 中文藏書區 ──
const LIB_2F: IndoorFloor = {
  id: 'lib-2f',
  shortLabel: '2F',
  name: '二樓 · 中文藏書',
  level: 2,
  highlight: '0-499 類 + 800-899 類 中文書 · 中文閱覽座位',
  keywords: ['中文書', '社會科學', '文學', '閱覽座位'],
  vertical: LIB_VERTICAL,
  rooms: [
    {
      id: '2f-stack-000',
      name: '0 類 總類',
      code: '2F-A',
      kind: 'collection',
      polygon: rect(80, 80, 200, 200),
      labelAt: { x: 180, y: 180 },
      description: '總類 / 圖書館學 / 資訊科學',
      facilities: ['書架 ×24', '檢索機'],
      openTime: '08:30-21:00',
      keywords: ['總類', '圖書館學', '資訊'],
      defaultCrowd: 'low',
    },
    {
      id: '2f-stack-100',
      name: '1 類 哲學',
      code: '2F-B',
      kind: 'collection',
      polygon: rect(300, 80, 200, 200),
      labelAt: { x: 400, y: 180 },
      description: '哲學 / 心理學 / 邏輯',
      facilities: ['書架 ×30'],
      openTime: '08:30-21:00',
      keywords: ['哲學', '心理', '邏輯'],
      defaultCrowd: 'low',
    },
    {
      id: '2f-stack-300',
      name: '3 類 社會科學',
      code: '2F-C',
      kind: 'collection',
      polygon: rect(520, 80, 200, 200),
      labelAt: { x: 620, y: 180 },
      description: '社會 / 政治 / 經濟 / 教育',
      facilities: ['書架 ×42'],
      openTime: '08:30-21:00',
      keywords: ['社會學', '政治', '經濟', '教育'],
      defaultCrowd: 'medium',
    },
    {
      id: '2f-stack-800',
      name: '8 類 語文文學',
      code: '2F-D',
      kind: 'collection',
      polygon: rect(740, 80, 180, 200),
      labelAt: { x: 830, y: 180 },
      description: '中國文學 / 詩 / 小說',
      facilities: ['書架 ×36'],
      openTime: '08:30-21:00',
      keywords: ['文學', '小說', '詩', '散文'],
      defaultCrowd: 'medium',
    },
    {
      id: '2f-reading-zone',
      name: '中文閱覽座位',
      code: '2F-RD',
      kind: 'study',
      polygon: rect(80, 320, 700, 200),
      labelAt: { x: 430, y: 420 },
      description: '中文藏書區閱覽桌椅，靠近書架方便取書',
      capacity: 64,
      facilities: ['獨立桌椅', '台燈', '插座'],
      openTime: '08:30-21:00',
      keywords: ['閱覽', '座位', '自習'],
      defaultCrowd: 'high',
    },
    {
      id: '2f-discussion',
      name: '討論室 201/202',
      code: '2F-MR',
      kind: 'meeting',
      polygon: rect(800, 320, 120, 200),
      labelAt: { x: 860, y: 420 },
      description: '4-6 人小組討論室，可線上預約 2 小時',
      capacity: 12,
      facilities: ['白板', '螢幕', '插座'],
      openTime: '08:30-21:00',
      bookable: true,
      keywords: ['討論', '小組', '會議', '預約'],
      defaultCrowd: 'medium',
    },
    {
      id: '2f-restroom',
      name: '二樓洗手間',
      code: '2F-R',
      kind: 'restroom',
      polygon: rect(840, 540, 80, 40),
      labelAt: { x: 880, y: 560 },
      description: '男女洗手間',
      facilities: ['無障礙'],
      keywords: ['洗手間', '廁所'],
    },
  ],
};

// ── 3F 西文藏書 + 電子資源 ──
const LIB_3F: IndoorFloor = {
  id: 'lib-3f',
  shortLabel: '3F',
  name: '三樓 · 西文藏書 · 電子資源',
  level: 3,
  highlight: '西文藏書 · 電子資源中心 · 資料庫檢索',
  keywords: ['英文書', '原文書', '電子資源', '資料庫', '電腦'],
  vertical: LIB_VERTICAL,
  rooms: [
    {
      id: '3f-stack-west',
      name: '西文圖書區',
      code: '3F-W',
      kind: 'collection',
      polygon: rect(80, 80, 480, 280),
      labelAt: { x: 320, y: 220 },
      description: '英文 / 西班牙文 / 日文原文書',
      facilities: ['書架 ×60', 'OPAC 檢索機'],
      openTime: '08:30-21:00',
      keywords: ['英文', '原文書', '西文', '日文', '原文'],
      defaultCrowd: 'medium',
    },
    {
      id: '3f-edb',
      name: '電子資源中心',
      code: '3F-E',
      kind: 'computer',
      polygon: rect(580, 80, 340, 200),
      labelAt: { x: 750, y: 180 },
      description: '32 台公用電腦，可用館內外電子資料庫',
      capacity: 32,
      facilities: ['電腦 ×32', '彩色印表機', '掃描機'],
      openTime: '08:30-21:00',
      requiresCard: false,
      keywords: ['電腦', '電子資源', '資料庫', '網路', 'edb', '檢索'],
      defaultCrowd: 'high',
    },
    {
      id: '3f-quiet-study',
      name: '靜謐自習區',
      code: '3F-QS',
      kind: 'study',
      polygon: rect(80, 380, 480, 160),
      labelAt: { x: 320, y: 460 },
      description: '絕對安靜的個人自習座位，禁止交談',
      capacity: 48,
      facilities: ['個人卡座', '台燈', '插座', '隔板'],
      openTime: '08:30-21:00',
      keywords: ['自習', '安靜', '靜謐', '單人座'],
      defaultCrowd: 'full',
    },
    {
      id: '3f-discussion',
      name: '討論室 301-304',
      code: '3F-MR',
      kind: 'meeting',
      polygon: rect(580, 320, 340, 220),
      labelAt: { x: 750, y: 430 },
      description: '4 間中型討論室，含投影機，可線上預約',
      capacity: 32,
      facilities: ['投影機 ×4', '白板', '螢幕'],
      bookable: true,
      openTime: '08:30-21:00',
      keywords: ['討論', '簡報', '投影', '會議', '預約'],
      defaultCrowd: 'medium',
    },
    {
      id: '3f-restroom',
      name: '三樓洗手間',
      code: '3F-R',
      kind: 'restroom',
      polygon: rect(840, 550, 80, 40),
      labelAt: { x: 880, y: 570 },
      description: '男女洗手間',
      facilities: ['無障礙'],
      keywords: ['洗手間', '廁所'],
    },
  ],
};

// ── 4F 自習室 + 多媒體 ──
const LIB_4F: IndoorFloor = {
  id: 'lib-4f',
  shortLabel: '4F',
  name: '四樓 · 自習室 · 多媒體',
  level: 4,
  highlight: '24 小時自習室 · 多媒體視聽室 · 研究小間',
  keywords: ['自習', '24小時', '多媒體', '視聽', '研究小間'],
  vertical: LIB_VERTICAL,
  rooms: [
    {
      id: '4f-24h',
      name: '24 小時自習室',
      code: '4F-24',
      kind: 'study',
      polygon: rect(80, 80, 480, 320),
      labelAt: { x: 320, y: 240 },
      description: '考試期間 24 小時開放，平時 08:30-23:00；需學生證進入',
      capacity: 120,
      facilities: ['獨立桌椅 ×120', '台燈', '插座', '飲水機', 'AC'],
      requiresCard: true,
      openTime: '08:30-23:00',
      keywords: ['24小時', '自習', '考試', '通宵', '夜貓'],
      defaultCrowd: 'full',
    },
    {
      id: '4f-multimedia',
      name: '多媒體視聽室',
      code: '4F-AV',
      kind: 'special',
      polygon: rect(580, 80, 340, 200),
      labelAt: { x: 750, y: 180 },
      description: '電影、紀錄片、語言學習軟體；藍光播放',
      capacity: 24,
      facilities: ['藍光播放 ×8', '耳機', '隔音艙', 'AV 軟體'],
      bookable: true,
      openTime: '08:30-21:00',
      keywords: ['多媒體', '電影', '視聽', '影音', '英語', '語言學習'],
      defaultCrowd: 'low',
    },
    {
      id: '4f-research',
      name: '研究小間 401-408',
      code: '4F-RES',
      kind: 'meeting',
      polygon: rect(580, 320, 340, 200),
      labelAt: { x: 750, y: 420 },
      description: '研究生 / 教師專用研究小間，可長期申請',
      capacity: 16,
      facilities: ['獨立空間', '書架', '插座'],
      requiresCard: true,
      bookable: true,
      openTime: '08:30-21:00',
      keywords: ['研究', '小間', '研究生', '碩士', '博士'],
      defaultCrowd: 'medium',
    },
    {
      id: '4f-rest',
      name: '休息交誼區',
      code: '4F-LG',
      kind: 'lounge',
      polygon: rect(80, 420, 480, 100),
      labelAt: { x: 320, y: 470 },
      description: '舒適沙發、飲水機，可短暫休息',
      facilities: ['沙發', '飲水機', '販賣機'],
      openTime: '08:30-23:00',
      keywords: ['休息', '沙發', '飲水機', '販賣機'],
      defaultCrowd: 'medium',
    },
    {
      id: '4f-restroom',
      name: '四樓洗手間',
      code: '4F-R',
      kind: 'restroom',
      polygon: rect(840, 540, 80, 40),
      labelAt: { x: 880, y: 560 },
      description: '男女洗手間 + 母嬰室',
      facilities: ['母嬰室', '無障礙'],
      keywords: ['洗手間', '廁所', '母嬰'],
    },
  ],
};

export const LIB_INDOOR_MAP: IndoorMap = {
  id: 'lib',
  poiId: 'pu-library',
  name: '蓋夏圖書館',
  nameEn: 'Gabriel Library',
  viewBox: LIB_VIEWBOX,
  defaultFloorId: 'lib-1f',
  themeColor: '#34C759',
  description: '靜宜大學主圖書館，藏書近 80 萬冊，5 個樓層含 24 小時自習室與電子資源',
  floors: [LIB_4F, LIB_3F, LIB_2F, LIB_1F, LIB_B1], // 由高樓層到低樓層
};

// ═════════════════════════════════════════════════════════
// 任垣樓 R1（簡化版 — 計算機中心 1F）
// ═════════════════════════════════════════════════════════

const RENYUAN_1F: IndoorFloor = {
  id: 'rn-1f',
  shortLabel: '1F',
  name: '任垣樓 一樓',
  level: 1,
  highlight: '入口大廳 · 接待櫃台',
  keywords: ['一樓', '大廳'],
  vertical: [
    { id: 'rn-elev', kind: 'elevator', label: '電梯', at: { x: 500, y: 300 } },
    { id: 'rn-stairs', kind: 'stairs', label: '樓梯', at: { x: 400, y: 300 } },
  ],
  rooms: [
    {
      id: 'rn1-lobby',
      name: '一樓大廳',
      code: 'LOBBY',
      kind: 'lobby',
      polygon: rect(120, 200, 760, 200),
      labelAt: { x: 500, y: 300 },
      description: '任垣樓主大廳，靠近主顧樓側門',
      facilities: ['公告板'],
      keywords: ['大廳'],
      defaultCrowd: 'medium',
    },
    {
      id: 'rn1-entrance',
      name: '主入口',
      code: 'GATE',
      kind: 'entrance',
      polygon: rect(440, 530, 120, 50),
      labelAt: { x: 500, y: 555 },
      description: '任垣樓主出入口',
      facilities: [],
      keywords: ['入口'],
    },
  ],
};

// ── R1 3F 計算機中心 ──
const RENYUAN_3F: IndoorFloor = {
  id: 'rn-3f',
  shortLabel: '3F',
  name: '任垣樓 三樓 · 計算機中心',
  level: 3,
  highlight: '計算機中心 · 電腦教室 · 網路管理',
  keywords: ['計算機', '電腦教室', '網路', '機房', 'NCC'],
  vertical: [
    { id: 'rn-elev', kind: 'elevator', label: '電梯', at: { x: 500, y: 300 } },
    { id: 'rn-stairs', kind: 'stairs', label: '樓梯', at: { x: 400, y: 300 } },
  ],
  rooms: [
    {
      id: 'rn3-ncc-srv',
      name: '計網中心服務台',
      code: 'NCC',
      kind: 'service',
      polygon: rect(80, 80, 240, 160),
      labelAt: { x: 200, y: 160 },
      description: '辦理 Wi-Fi 帳號、報修、軟體授權',
      facilities: ['服務櫃台 ×2'],
      openTime: '08:30-17:30',
      keywords: ['計網', '網路', 'Wi-Fi', 'NCC', '報修'],
      defaultCrowd: 'medium',
    },
    {
      id: 'rn3-lab-a',
      name: '電腦教室 A (R301)',
      code: 'R301',
      kind: 'lab',
      polygon: rect(350, 80, 240, 160),
      labelAt: { x: 470, y: 160 },
      description: '54 台 PC，作業系統 Windows 11',
      capacity: 54,
      facilities: ['PC ×54', '投影機', '中央控制系統'],
      bookable: true,
      keywords: ['電腦教室', 'lab', 'R301', 'Windows'],
      defaultCrowd: 'high',
    },
    {
      id: 'rn3-lab-b',
      name: '電腦教室 B (R302)',
      code: 'R302',
      kind: 'lab',
      polygon: rect(620, 80, 240, 160),
      labelAt: { x: 740, y: 160 },
      description: '48 台 Mac，授權 Adobe Creative Cloud',
      capacity: 48,
      facilities: ['iMac ×48', '投影機', 'Wacom 數位板'],
      bookable: true,
      keywords: ['Mac', '蘋果', 'Adobe', '設計', '電腦教室'],
      defaultCrowd: 'medium',
    },
    {
      id: 'rn3-server',
      name: '機房（管制區）',
      code: 'SVR',
      kind: 'storage',
      polygon: rect(80, 280, 480, 200),
      labelAt: { x: 320, y: 380 },
      description: '校園網路機房，僅限管理員進入',
      facilities: ['伺服器機櫃 ×40', '空調'],
      requiresCard: true,
      keywords: ['機房', '伺服器', '管制'],
      defaultCrowd: 'empty',
    },
    {
      id: 'rn3-restroom',
      name: '三樓洗手間',
      code: 'R',
      kind: 'restroom',
      polygon: rect(820, 280, 100, 100),
      labelAt: { x: 870, y: 330 },
      description: '男女洗手間',
      facilities: [],
      keywords: ['洗手間'],
    },
  ],
};

export const RENYUAN_INDOOR_MAP: IndoorMap = {
  id: 'renyuan',
  poiId: 'pu-renyuan',
  name: '任垣樓',
  nameEn: 'Anthony Kuo Hall',
  viewBox: { width: 1000, height: 600 },
  defaultFloorId: 'rn-3f',
  themeColor: '#007AFF',
  description: '理工學院教學大樓，3 樓為計算機與網路中心',
  floors: [RENYUAN_3F, RENYUAN_1F],
};

// ═════════════════════════════════════════════════════════
// 主顧樓（簡化版 1F 大廳）
// ═════════════════════════════════════════════════════════

const PROV_1F: IndoorFloor = {
  id: 'ph-1f',
  shortLabel: '1F',
  name: '主顧樓 一樓',
  level: 1,
  highlight: '大型階梯教室 · 國際處',
  keywords: ['階梯教室', '主顧', '國際', '英語'],
  vertical: [
    { id: 'ph-elev', kind: 'elevator', label: '電梯', at: { x: 500, y: 300 } },
    { id: 'ph-stairs', kind: 'stairs', label: '樓梯', at: { x: 380, y: 300 } },
  ],
  rooms: [
    {
      id: 'ph1-cr-a',
      name: '階梯教室 101',
      code: 'PH-101',
      kind: 'classroom',
      polygon: rect(80, 80, 380, 200),
      labelAt: { x: 270, y: 180 },
      description: '270 人大型階梯教室，常作為大班通識',
      capacity: 270,
      facilities: ['投影 ×2', '雙螢幕', 'AV 控制台', 'AC'],
      keywords: ['階梯', '通識', '大班', '101'],
      defaultCrowd: 'high',
    },
    {
      id: 'ph1-cr-b',
      name: '階梯教室 102',
      code: 'PH-102',
      kind: 'classroom',
      polygon: rect(500, 80, 240, 200),
      labelAt: { x: 620, y: 180 },
      description: '120 人中型階梯教室',
      capacity: 120,
      facilities: ['投影', 'AV', 'AC'],
      keywords: ['階梯', '102'],
      defaultCrowd: 'medium',
    },
    {
      id: 'ph1-intl',
      name: '國際暨兩岸事務處',
      code: 'INTL',
      kind: 'office',
      polygon: rect(770, 80, 150, 200),
      labelAt: { x: 845, y: 180 },
      description: '出國交換、雙聯學位、僑外生服務',
      facilities: ['辦公室', '櫃台'],
      openTime: '08:30-17:30',
      keywords: ['國際', '交換', '出國', '僑外'],
      defaultCrowd: 'low',
    },
    {
      id: 'ph1-cr-c',
      name: '一般教室 103',
      code: 'PH-103',
      kind: 'classroom',
      polygon: rect(80, 320, 240, 160),
      labelAt: { x: 200, y: 400 },
      description: '60 人一般教室',
      capacity: 60,
      facilities: ['投影', 'AC'],
      keywords: ['教室', '103'],
      defaultCrowd: 'medium',
    },
    {
      id: 'ph1-cr-d',
      name: '一般教室 104',
      code: 'PH-104',
      kind: 'classroom',
      polygon: rect(360, 320, 240, 160),
      labelAt: { x: 480, y: 400 },
      description: '60 人一般教室',
      capacity: 60,
      facilities: ['投影', 'AC'],
      keywords: ['教室', '104'],
      defaultCrowd: 'medium',
    },
    {
      id: 'ph1-lobby',
      name: '中央大廳',
      code: 'LOBBY',
      kind: 'lobby',
      polygon: rect(640, 320, 280, 160),
      labelAt: { x: 780, y: 400 },
      description: '主顧樓中央大廳，常設展覽',
      facilities: ['公告板', '展示櫃'],
      keywords: ['大廳', '展覽'],
      defaultCrowd: 'medium',
    },
    {
      id: 'ph1-entrance',
      name: '主入口',
      code: 'GATE',
      kind: 'entrance',
      polygon: rect(440, 530, 120, 50),
      labelAt: { x: 500, y: 555 },
      description: '主顧樓正門',
      facilities: [],
      keywords: ['入口'],
    },
  ],
};

export const PROV_INDOOR_MAP: IndoorMap = {
  id: 'providence',
  poiId: 'pu-providence',
  name: '主顧樓',
  nameEn: 'Providence Hall',
  viewBox: { width: 1000, height: 600 },
  defaultFloorId: 'ph-1f',
  themeColor: '#9333EA',
  description: '靜宜最大教學大樓，多間階梯教室與國際處',
  floors: [PROV_1F],
};

// ═════════════════════════════════════════════════════════
// 對外 API
// ═════════════════════════════════════════════════════════

export const ALL_INDOOR_MAPS: IndoorMap[] = [
  LIB_INDOOR_MAP,
  RENYUAN_INDOOR_MAP,
  PROV_INDOOR_MAP,
];

export function getIndoorMapByPoi(poiId: string): IndoorMap | null {
  return ALL_INDOOR_MAPS.find((m) => m.poiId === poiId) ?? null;
}

export function getIndoorMapById(id: string): IndoorMap | null {
  return ALL_INDOOR_MAPS.find((m) => m.id === id) ?? null;
}

export function hasIndoorMap(poiId: string): boolean {
  return ALL_INDOOR_MAPS.some((m) => m.poiId === poiId);
}

/**
 * 跨樓層搜尋房間
 */
export function searchRoomsInBuilding(
  buildingId: string,
  query: string,
): { floor: IndoorFloor; room: IndoorRoom }[] {
  const m = getIndoorMapById(buildingId);
  if (!m) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: { floor: IndoorFloor; room: IndoorRoom }[] = [];
  for (const f of m.floors) {
    for (const r of f.rooms) {
      const haystack =
        `${r.name} ${r.code} ${r.description} ${r.keywords.join(' ')}`.toLowerCase();
      if (haystack.includes(q)) {
        out.push({ floor: f, room: r });
      }
    }
  }
  return out;
}

/**
 * 即時人潮（demo：依當前小時 hash + room.defaultCrowd）
 */
export function getRoomCrowd(roomId: string, defaultCrowd?: CrowdLevel): CrowdLevel {
  if (!defaultCrowd) return 'low';
  const hour = new Date().getHours();
  // 圖書館高峰：14-18 點 + 19-22 點
  const isPeak = (hour >= 14 && hour <= 18) || (hour >= 19 && hour <= 22);
  if (defaultCrowd === 'full') return isPeak ? 'full' : 'high';
  if (defaultCrowd === 'high') return isPeak ? 'high' : 'medium';
  if (defaultCrowd === 'medium') return isPeak ? 'medium' : 'low';
  return defaultCrowd;
}

export function crowdLabel(c: CrowdLevel): { text: string; color: string } {
  switch (c) {
    case 'empty':
      return { text: '空', color: '#06B6D4' };
    case 'low':
      return { text: '人少', color: '#34D399' };
    case 'medium':
      return { text: '適中', color: '#FF9500' };
    case 'high':
      return { text: '擁擠', color: '#F87171' };
    case 'full':
      return { text: '客滿', color: '#A855F7' };
  }
}
