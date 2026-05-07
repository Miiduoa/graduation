/**
 * 靜宜大學學生宿舍 — 完整真實資料 + 創新功能
 * 資料來源：https://osadorm.pu.edu.tw/
 *
 * 三大學苑：
 * - 希嘉學苑（Schultz Hall）— 女宿為主
 * - 思高學苑（Bosco Hall）— 男宿
 * - 善牧學苑（Good Shepherd Hall）— 男女皆有
 */

// ═══════════════════════════════════════════════════
// 宿舍基本資訊
// ═══════════════════════════════════════════════════

export const DORM_OFFICE_INFO = {
  name: '學生住宿服務組',
  phone: '(04) 2632-8001',
  extensions: [
    '11241',
    '11242',
    '11243',
    '11244',
    '11245',
    '11246',
    '11247',
    '11248',
    '11250',
    '11251',
    '11252',
    '11253',
    '11254',
    '11255',
  ],
  emergencyPhone: '0921-382470',
  email: 'pu10280@pu.edu.tw',
  address: '433301 臺中市沙鹿區臺灣大道七段200號',
  serviceHours: '08:00–22:00',
  website: 'https://osadorm.pu.edu.tw/',
};

export type DormBuildingId = 'schultz' | 'bosco' | 'shepherd';
export type Gender = 'female' | 'male' | 'mixed';

export interface DormBuilding {
  id: DormBuildingId;
  name: string;
  englishName: string;
  nameOrigin: string;
  gender: Gender;
  floors: number;
  totalBeds: number;
  directPhone: string;
  dialPrefix: string; // 內線前綴
  dialExample: string; // 撥號範例
  lat: number;
  lng: number;
  facilities: string[];
  features: string[];
}

export const DORM_BUILDINGS: DormBuilding[] = [
  {
    id: 'schultz',
    name: '希嘉學苑',
    englishName: 'Schultz Hall',
    nameOrigin: '紀念創辦人希嘉修女 (Sister Schultz, 1892–1982)',
    gender: 'female',
    floors: 12,
    totalBeds: 1960,
    directPhone: '04-2632-2900',
    dialPrefix: '7',
    dialExample: '房號 2115 → 撥 72115',
    lat: 24.2272,
    lng: 120.5631,
    facilities: [
      '自習室',
      '交誼廳',
      '飲水機',
      '洗衣間',
      '烘衣間',
      '脫水機',
      '曬衣場',
      '信箱區',
      '自動販賣機',
      '電梯',
      '公用冰箱',
    ],
    features: ['全新整修', '智慧門禁系統', 'CCTV 監控', '消防偵煙警報', '緊急照明', '備用發電機'],
  },
  {
    id: 'bosco',
    name: '思高學苑',
    englishName: 'Bosco Hall',
    nameOrigin: '紀念聖乃方濟 (Saint John Bosco, 1815–1888)',
    gender: 'male',
    floors: 10,
    totalBeds: 800,
    directPhone: '04-2632-2900',
    dialPrefix: '8',
    dialExample: '房號 5C1 → 撥 85031',
    lat: 24.2268,
    lng: 120.5628,
    facilities: [
      '自習室',
      '交誼廳',
      '飲水機',
      '洗衣間',
      '烘衣間',
      '脫水機',
      '曬衣場',
      '信箱區',
      '自動販賣機',
      '電梯',
      '健身房',
      '公用冰箱',
    ],
    features: ['單元式設計（1客廳+3房）', '獨立衛浴', '7F 學習樓層', '智慧門禁系統'],
  },
  {
    id: 'shepherd',
    name: '善牧學苑',
    englishName: 'Good Shepherd Hall',
    gender: 'mixed',
    nameOrigin: '善牧精神',
    floors: 8,
    totalBeds: 640,
    directPhone: '04-2632-2900',
    dialPrefix: '9',
    dialExample: '房號 301 → 撥 9301',
    lat: 24.2265,
    lng: 120.5635,
    facilities: [
      '自習室',
      '交誼廳',
      '飲水機',
      '洗衣間',
      '烘衣間',
      '曬衣場',
      '信箱區',
      '自動販賣機',
      '電梯',
      '公用冰箱',
    ],
    features: ['較新設施', 'e 付卡冷氣付費', '智慧門禁系統'],
  },
];

// ═══════════════════════════════════════════════════
// 房型與費用（每學期 18 週）
// ═══════════════════════════════════════════════════

export interface RoomType {
  id: string;
  building: DormBuildingId;
  gender: Gender;
  occupancy: number; // 幾人房
  semesterFee: number; // 學期住宿費（NTD）
  deposit: number; // 保證金
  totalCost: number; // 總繳費
  hasAC: boolean;
  acPaymentMethod: string; // IC 卡 / e 付卡
  note: string;
  available: boolean;
}

export const ROOM_TYPES: RoomType[] = [
  // ── 希嘉學苑（女） ──
  {
    id: 'schultz-4p',
    building: 'schultz',
    gender: 'female',
    occupancy: 4,
    semesterFee: 10500,
    deposit: 550,
    totalCost: 11050,
    hasAC: true,
    acPaymentMethod: 'IC 卡儲值',
    note: '標準四人房',
    available: true,
  },
  {
    id: 'schultz-3p-1f',
    building: 'schultz',
    gender: 'female',
    occupancy: 3,
    semesterFee: 10000,
    deposit: 550,
    totalCost: 10550,
    hasAC: true,
    acPaymentMethod: 'IC 卡儲值',
    note: '1樓三人房',
    available: true,
  },
  {
    id: 'schultz-2p',
    building: 'schultz',
    gender: 'female',
    occupancy: 2,
    semesterFee: 14500,
    deposit: 550,
    totalCost: 15050,
    hasAC: true,
    acPaymentMethod: 'IC 卡儲值',
    note: '雙人房（優先身心障礙生）',
    available: true,
  },
  {
    id: 'schultz-3p-beam',
    building: 'schultz',
    gender: 'female',
    occupancy: 3,
    semesterFee: 11000,
    deposit: 550,
    totalCost: 11550,
    hasAC: true,
    acPaymentMethod: 'IC 卡儲值',
    note: '樑柱三人房（二年級以上）',
    available: true,
  },

  // ── 思高學苑（男） ──
  {
    id: 'bosco-2p',
    building: 'bosco',
    gender: 'male',
    occupancy: 2,
    semesterFee: 13500,
    deposit: 550,
    totalCost: 14050,
    hasAC: true,
    acPaymentMethod: 'IC 卡儲值',
    note: '雙人房（優先身心障礙生）',
    available: true,
  },
  {
    id: 'bosco-3p',
    building: 'bosco',
    gender: 'male',
    occupancy: 3,
    semesterFee: 10500,
    deposit: 550,
    totalCost: 11050,
    hasAC: true,
    acPaymentMethod: 'IC 卡儲值',
    note: '標準三人房（單元式）',
    available: true,
  },

  // ── 善牧學苑 ──
  {
    id: 'shepherd-4p-f',
    building: 'shepherd',
    gender: 'female',
    occupancy: 4,
    semesterFee: 15500,
    deposit: 1000,
    totalCost: 16500,
    hasAC: true,
    acPaymentMethod: 'e 付卡',
    note: '善牧四人房（女）',
    available: true,
  },
  {
    id: 'shepherd-4p-m',
    building: 'shepherd',
    gender: 'male',
    occupancy: 4,
    semesterFee: 15500,
    deposit: 1000,
    totalCost: 16500,
    hasAC: true,
    acPaymentMethod: 'e 付卡',
    note: '善牧四人房（男）',
    available: true,
  },
  {
    id: 'schultz-4p-m',
    building: 'schultz',
    gender: 'male',
    occupancy: 4,
    semesterFee: 10500,
    deposit: 550,
    totalCost: 11050,
    hasAC: true,
    acPaymentMethod: 'IC 卡儲值',
    note: '希嘉四人房（男生分配）',
    available: true,
  },
];

// ═══════════════════════════════════════════════════
// 房間設備
// ═══════════════════════════════════════════════════

export const ROOM_EQUIPMENT = [
  { icon: 'bed-outline', label: '床鋪' },
  { icon: 'file-tray-full-outline', label: '衣櫃' },
  { icon: 'desktop-outline', label: '書桌+書架' },
  { icon: 'school-outline', label: '椅子' },
  { icon: 'bulb-outline', label: '檯燈' },
  { icon: 'call-outline', label: '電話接口' },
  { icon: 'wifi-outline', label: '網路接口' },
  { icon: 'snow-outline', label: '冷氣（IC卡/e付卡）' },
];

// ═══════════════════════════════════════════════════
// 門禁規則
// ═══════════════════════════════════════════════════

export interface AccessRule {
  period: string;
  rule: string;
  note: string;
}

export const ACCESS_RULES: AccessRule[] = [
  { period: '06:00 – 24:00', rule: '自由進出', note: '刷學生證感應門禁' },
  { period: '00:00 – 06:00', rule: '刷卡記錄', note: '可進出但系統記錄，列入晚歸統計' },
];

export const ACCESS_POLICY = {
  cardRequired: true,
  cardType: '學生證（悠遊卡感應）',
  lateReturnStart: '00:00',
  lateReturnEnd: '06:00',
  visitorHours: '10:00–21:00',
  visitorMaxHours: 3,
  visitorIdRequired: true,
};

// ═══════════════════════════════════════════════════
// 洗衣設備（真實配置）
// ═══════════════════════════════════════════════════

export type LaundryType = 'washer' | 'dryer' | 'dehydrator';
export type LaundryStatus = 'available' | 'inUse' | 'finished' | 'maintenance' | 'reserved';

export interface LaundryMachine {
  id: string;
  building: DormBuildingId;
  floor: string;
  number: number;
  type: LaundryType;
  status: LaundryStatus;
  price: number; // NTD per use, 0 = free
  remainingMinutes: number;
  capacity: string; // e.g. "12kg"
  brand: string;
}

function generateLaundryMachines(): LaundryMachine[] {
  const machines: LaundryMachine[] = [];
  let id = 1;

  // 希嘉學苑 — 每 2 層一間洗衣間，每間 4 洗 2 烘 2 脫
  const schultzFloors = ['2F', '4F', '6F', '8F', '10F', '12F'];
  for (const floor of schultzFloors) {
    for (let n = 1; n <= 4; n++) {
      machines.push({
        id: `SCH-W-${id}`,
        building: 'schultz',
        floor: `希嘉 ${floor}`,
        number: id,
        type: 'washer',
        status: 'available',
        price: 20,
        remainingMinutes: 0,
        capacity: '12kg',
        brand: 'LG',
      });
      id++;
    }
    for (let n = 1; n <= 2; n++) {
      machines.push({
        id: `SCH-D-${id}`,
        building: 'schultz',
        floor: `希嘉 ${floor}`,
        number: id,
        type: 'dryer',
        status: 'available',
        price: 10,
        remainingMinutes: 0,
        capacity: '10kg',
        brand: 'LG',
      });
      id++;
    }
    for (let n = 1; n <= 2; n++) {
      machines.push({
        id: `SCH-DH-${id}`,
        building: 'schultz',
        floor: `希嘉 ${floor}`,
        number: id,
        type: 'dehydrator',
        status: 'available',
        price: 0,
        remainingMinutes: 0,
        capacity: '6kg',
        brand: '國產',
      });
      id++;
    }
  }

  // 思高學苑 — 每 2 層一間，每間 3 洗 2 烘 2 脫
  const boscoFloors = ['2F', '4F', '6F', '8F', '10F'];
  for (const floor of boscoFloors) {
    for (let n = 1; n <= 3; n++) {
      machines.push({
        id: `BOS-W-${id}`,
        building: 'bosco',
        floor: `思高 ${floor}`,
        number: id,
        type: 'washer',
        status: 'available',
        price: 20,
        remainingMinutes: 0,
        capacity: '12kg',
        brand: 'LG',
      });
      id++;
    }
    for (let n = 1; n <= 2; n++) {
      machines.push({
        id: `BOS-D-${id}`,
        building: 'bosco',
        floor: `思高 ${floor}`,
        number: id,
        type: 'dryer',
        status: 'available',
        price: 10,
        remainingMinutes: 0,
        capacity: '10kg',
        brand: 'LG',
      });
      id++;
    }
    for (let n = 1; n <= 2; n++) {
      machines.push({
        id: `BOS-DH-${id}`,
        building: 'bosco',
        floor: `思高 ${floor}`,
        number: id,
        type: 'dehydrator',
        status: 'available',
        price: 0,
        remainingMinutes: 0,
        capacity: '6kg',
        brand: '國產',
      });
      id++;
    }
  }

  // 善牧學苑 — 每 2 層一間，每間 3 洗 1 烘
  const shepherdFloors = ['2F', '4F', '6F', '8F'];
  for (const floor of shepherdFloors) {
    for (let n = 1; n <= 3; n++) {
      machines.push({
        id: `SHP-W-${id}`,
        building: 'shepherd',
        floor: `善牧 ${floor}`,
        number: id,
        type: 'washer',
        status: 'available',
        price: 20,
        remainingMinutes: 0,
        capacity: '12kg',
        brand: 'Whirlpool',
      });
      id++;
    }
    machines.push({
      id: `SHP-D-${id}`,
      building: 'shepherd',
      floor: `善牧 ${floor}`,
      number: id,
      type: 'dryer',
      status: 'available',
      price: 10,
      remainingMinutes: 0,
      capacity: '10kg',
      brand: 'Whirlpool',
    });
    id++;
  }

  return machines;
}

export const ALL_LAUNDRY_MACHINES = generateLaundryMachines();

export function simulateLaundryStatus(building?: DormBuildingId): LaundryMachine[] {
  const hour = new Date().getHours();
  const isPeak = (hour >= 18 && hour <= 22) || (hour >= 7 && hour <= 9);

  return ALL_LAUNDRY_MACHINES.filter((m) => !building || m.building === building).map((m) => {
    if (m.type === 'dehydrator') return m; // 脫水機通常都可用
    const rand = Math.random();
    const busyThreshold = isPeak ? 0.35 : 0.65;

    if (rand < busyThreshold) {
      const remaining = Math.floor(Math.random() * (m.type === 'washer' ? 40 : 50)) + 5;
      return { ...m, status: 'inUse' as LaundryStatus, remainingMinutes: remaining };
    }
    if (rand < busyThreshold + 0.1) {
      return { ...m, status: 'finished' as LaundryStatus, remainingMinutes: 0 };
    }
    if (rand > 0.97) {
      return { ...m, status: 'maintenance' as LaundryStatus, remainingMinutes: 0 };
    }
    return m;
  });
}

export function getLaundryStats(machines: LaundryMachine[], building?: DormBuildingId) {
  const filtered = building ? machines.filter((m) => m.building === building) : machines;
  const washers = filtered.filter((m) => m.type === 'washer');
  const dryers = filtered.filter((m) => m.type === 'dryer');

  return {
    washersAvailable: washers.filter((m) => m.status === 'available').length,
    washersTotal: washers.length,
    dryersAvailable: dryers.filter((m) => m.status === 'available').length,
    dryersTotal: dryers.length,
    avgWaitMinutes: Math.round(
      washers.filter((m) => m.status === 'inUse').reduce((sum, m) => sum + m.remainingMinutes, 0) /
        Math.max(1, washers.filter((m) => m.status === 'inUse').length),
    ),
  };
}

// ═══════════════════════════════════════════════════
// 報修系統
// ═══════════════════════════════════════════════════

export type RepairCategory =
  | 'electrical'
  | 'plumbing'
  | 'furniture'
  | 'ac'
  | 'internet'
  | 'door_lock'
  | 'bathroom'
  | 'pest'
  | 'other';

export interface RepairCategoryInfo {
  id: RepairCategory;
  label: string;
  icon: string;
  color: string;
  avgResponseHours: number;
  description: string;
}

export const REPAIR_CATEGORIES: RepairCategoryInfo[] = [
  {
    id: 'ac',
    label: '冷氣',
    icon: 'snow-outline',
    color: '#3B82F6',
    avgResponseHours: 4,
    description: '冷氣不冷、異響、漏水',
  },
  {
    id: 'plumbing',
    label: '水管',
    icon: 'water-outline',
    color: '#06B6D4',
    avgResponseHours: 2,
    description: '漏水、堵塞、水壓異常',
  },
  {
    id: 'electrical',
    label: '電力',
    icon: 'flash-outline',
    color: '#F59E0B',
    avgResponseHours: 1,
    description: '插座故障、跳電、燈具',
  },
  {
    id: 'internet',
    label: '網路',
    icon: 'wifi-outline',
    color: '#8B5CF6',
    avgResponseHours: 6,
    description: '斷線、速度慢、無法連線',
  },
  {
    id: 'furniture',
    label: '家具',
    icon: 'bed-outline',
    color: '#D97706',
    avgResponseHours: 24,
    description: '床鋪、書桌、衣櫃損壞',
  },
  {
    id: 'door_lock',
    label: '門鎖',
    icon: 'lock-closed-outline',
    color: '#EF4444',
    avgResponseHours: 1,
    description: '門鎖故障、鑰匙遺失',
  },
  {
    id: 'bathroom',
    label: '衛浴',
    icon: 'water-outline',
    color: '#14B8A6',
    avgResponseHours: 3,
    description: '馬桶、蓮蓬頭、排水',
  },
  {
    id: 'pest',
    label: '蟲害',
    icon: 'bug-outline',
    color: '#78716C',
    avgResponseHours: 12,
    description: '蟑螂、螞蟻、蚊蟲',
  },
  {
    id: 'other',
    label: '其他',
    icon: 'construct-outline',
    color: '#9CA3AF',
    avgResponseHours: 24,
    description: '其他設施問題',
  },
];

// ═══════════════════════════════════════════════════
// 包裹系統
// ═══════════════════════════════════════════════════

export interface PackageLocation {
  id: string;
  building: DormBuildingId;
  name: string;
  description: string;
  pickupHours: string;
}

export const PACKAGE_LOCATIONS: PackageLocation[] = [
  {
    id: 'schultz-1f',
    building: 'schultz',
    name: '希嘉 1F 收發室',
    description: '希嘉學苑一樓服務檯旁',
    pickupHours: '08:00–21:00',
  },
  {
    id: 'bosco-1f',
    building: 'bosco',
    name: '思高 1F 收發室',
    description: '思高學苑一樓大廳',
    pickupHours: '08:00–21:00',
  },
  {
    id: 'shepherd-1f',
    building: 'shepherd',
    name: '善牧 1F 收發室',
    description: '善牧學苑一樓',
    pickupHours: '08:00–21:00',
  },
];

export const CARRIERS = [
  { id: 'seven', name: '7-11 交貨便', icon: 'storefront-outline', color: '#00843D' },
  { id: 'family', name: '全家店到店', icon: 'storefront-outline', color: '#00A0E9' },
  { id: 'hct', name: '新竹物流', icon: 'car-outline', color: '#E73A30' },
  { id: 'tcat', name: '黑貓宅急便', icon: 'car-outline', color: '#000000' },
  { id: 'post', name: '中華郵政', icon: 'mail-outline', color: '#D4181C' },
  { id: 'sf', name: '順豐速運', icon: 'airplane-outline', color: '#000000' },
  { id: 'other', name: '其他', icon: 'cube-outline', color: '#9CA3AF' },
];

// ═══════════════════════════════════════════════════
// 電費追蹤
// ═══════════════════════════════════════════════════

export interface ElectricityInfo {
  paymentMethod: string;
  freeQuota: number; // kWh per semester (0 if none)
  ratePerKwh: number; // NTD
  topUpLocations: string[];
  note: string;
}

export const ELECTRICITY_INFO: Record<DormBuildingId, ElectricityInfo> = {
  schultz: {
    paymentMethod: 'IC 卡儲值',
    freeQuota: 0,
    ratePerKwh: 4.5,
    topUpLocations: ['希嘉 1F 服務檯', '學生事務處'],
    note: '冷氣用電以 IC 卡扣款，插卡即開',
  },
  bosco: {
    paymentMethod: 'IC 卡儲值',
    freeQuota: 0,
    ratePerKwh: 4.5,
    topUpLocations: ['思高 1F 服務檯', '學生事務處'],
    note: '冷氣用電以 IC 卡扣款，插卡即開',
  },
  shepherd: {
    paymentMethod: 'e 付卡',
    freeQuota: 0,
    ratePerKwh: 4.5,
    topUpLocations: ['善牧 1F 服務檯', '線上儲值'],
    note: '善牧採 e 付卡系統，支援線上加值',
  },
};

// ═══════════════════════════════════════════════════
// 智慧提醒 — 時段感知建議
// ═══════════════════════════════════════════════════

export interface DormSuggestion {
  icon: string;
  text: string;
  action?: string;
  color: string;
}

export function getSmartDormSuggestions(building?: DormBuildingId): DormSuggestion[] {
  const hour = new Date().getHours();
  const suggestions: DormSuggestion[] = [];

  if (hour >= 6 && hour < 9) {
    suggestions.push(
      {
        icon: 'sunny-outline',
        text: '早安！現在洗衣機較空，適合洗衣',
        action: 'laundry',
        color: '#F59E0B',
      },
      { icon: 'water-outline', text: '記得帶水瓶補充飲水', color: '#3B82F6' },
    );
  } else if (hour >= 11 && hour < 13) {
    suggestions.push({
      icon: 'restaurant-outline',
      text: '午餐時間！宿舍附近餐廳營業中',
      color: '#10B981',
    });
  } else if (hour >= 17 && hour < 19) {
    suggestions.push(
      {
        icon: 'alert-circle-outline',
        text: '洗衣尖峰時段即將到來 (18-22時)',
        action: 'laundry',
        color: '#F59E0B',
      },
      {
        icon: 'cube-outline',
        text: '收發室即將關閉 (21:00)，記得取包裹',
        action: 'package',
        color: '#8B5CF6',
      },
    );
  } else if (hour >= 22 && hour < 24) {
    suggestions.push(
      { icon: 'moon-outline', text: '夜間時段，請降低音量保持安靜', color: '#6366F1' },
      { icon: 'lock-closed-outline', text: '00:00 後進出將記錄為晚歸', color: '#EF4444' },
    );
  } else if (hour >= 0 && hour < 6) {
    suggestions.push(
      { icon: 'warning-outline', text: '深夜時段，進出會列入晚歸記錄', color: '#EF4444' },
      {
        icon: 'call-outline',
        text: `緊急聯絡：${DORM_OFFICE_INFO.emergencyPhone}`,
        color: '#EF4444',
      },
    );
  } else {
    suggestions.push({
      icon: 'checkmark-circle-outline',
      text: '一切正常！有什麼需要就用快捷功能吧',
      color: '#10B981',
    });
  }

  return suggestions;
}

// ═══════════════════════════════════════════════════
// 社區功能
// ═══════════════════════════════════════════════════

export type CommunityPostType = 'share' | 'lend' | 'lost' | 'event' | 'trade' | 'complaint';

export interface CommunityPostCategory {
  id: CommunityPostType;
  label: string;
  icon: string;
  color: string;
  description: string;
}

export const COMMUNITY_CATEGORIES: CommunityPostCategory[] = [
  {
    id: 'share',
    label: '分享',
    icon: 'chatbubble-ellipses-outline',
    color: '#3B82F6',
    description: '生活分享、心得交流',
  },
  {
    id: 'lend',
    label: '借物',
    icon: 'hand-left-outline',
    color: '#10B981',
    description: '借/還工具、電器、日用品',
  },
  {
    id: 'lost',
    label: '失物',
    icon: 'search-outline',
    color: '#F59E0B',
    description: '遺失或拾獲物品',
  },
  {
    id: 'event',
    label: '揪團',
    icon: 'people-outline',
    color: '#8B5CF6',
    description: '揪人運動、出遊、共餐',
  },
  {
    id: 'trade',
    label: '交易',
    icon: 'swap-horizontal-outline',
    color: '#D97706',
    description: '二手物品買賣交換',
  },
  {
    id: 'complaint',
    label: '反映',
    icon: 'megaphone-outline',
    color: '#EF4444',
    description: '公共設施問題回報',
  },
];

// ═══════════════════════════════════════════════════
// 常見問題
// ═══════════════════════════════════════════════════

export interface DormFAQ {
  question: string;
  answer: string;
  category: string;
}

export const DORM_FAQS: DormFAQ[] = [
  {
    category: '入住',
    question: '新生什麼時候可以申請宿舍？',
    answer: '每年約 6-7 月開放新生宿舍申請，請至 https://freshman.pu.edu.tw 線上申請',
  },
  {
    category: '入住',
    question: '舊生如何抽籤？',
    answer: '每學期末透過 E 校園系統線上抽籤，依年級和學業成績排序',
  },
  {
    category: '費用',
    question: '住宿費何時繳？',
    answer: '隨學雜費一併繳納，開學前完成。冷氣電費另計',
  },
  {
    category: '費用',
    question: '保證金什麼時候退？',
    answer: '退宿時經檢查無損壞，於學期結束後約 1 個月內退還',
  },
  {
    category: '門禁',
    question: '門禁時間是幾點？',
    answer: '24 小時皆可刷卡進出，但 00:00-06:00 系統會記錄為晚歸',
  },
  {
    category: '門禁',
    question: '學生證遺失怎麼辦？',
    answer: '請至學務處申請補發，臨時可到服務檯借用暫時門禁卡',
  },
  {
    category: '設備',
    question: '冷氣 IC 卡怎麼儲值？',
    answer: '至各學苑 1F 服務檯現金儲值，善牧可線上加值',
  },
  {
    category: '設備',
    question: '洗衣機投幣還是刷卡？',
    answer: '目前為投幣式（洗衣 $20、烘衣 $10），脫水機免費',
  },
  {
    category: '包裹',
    question: '包裹放多久會退回？',
    answer: '包裹到達後 7 天未領取將通知退回，請盡快領取',
  },
  {
    category: '報修',
    question: '報修後多久會來修？',
    answer: '緊急案件（漏水/門鎖）1-2 小時內，一般案件 1-3 個工作天',
  },
  { category: '生活', question: '可以養寵物嗎？', answer: '宿舍禁止飼養任何寵物，包含魚類' },
  {
    category: '生活',
    question: '可以使用電鍋嗎？',
    answer: '房間內禁止使用明火及高功率電器（電鍋、電磁爐），請使用公共廚房',
  },
];

// ═══════════════════════════════════════════════════
// 角色功能矩陣
// ═══════════════════════════════════════════════════

export interface RoleDormAccess {
  role: string;
  label: string;
  canViewRoom: boolean;
  canRepair: boolean;
  canPickPackage: boolean;
  canUseLaundry: boolean;
  canCommunity: boolean;
  canLateReturn: boolean;
  canVisitorReg: boolean;
  canAccessApp: boolean;
  canManageAll: boolean; // 管理員
  canViewStats: boolean; // 管理員/職員
  canAssignRepair: boolean; // 管理員/職員
}

export const ROLE_DORM_ACCESS: RoleDormAccess[] = [
  {
    role: 'resident',
    label: '住宿生',
    canViewRoom: true,
    canRepair: true,
    canPickPackage: true,
    canUseLaundry: true,
    canCommunity: true,
    canLateReturn: true,
    canVisitorReg: true,
    canAccessApp: true,
    canManageAll: false,
    canViewStats: false,
    canAssignRepair: false,
  },
  {
    role: 'non_resident',
    label: '非住宿生',
    canViewRoom: false,
    canRepair: false,
    canPickPackage: false,
    canUseLaundry: false,
    canCommunity: false,
    canLateReturn: false,
    canVisitorReg: false,
    canAccessApp: false,
    canManageAll: false,
    canViewStats: false,
    canAssignRepair: false,
  },
  {
    role: 'dorm_staff',
    label: '宿舍幹部',
    canViewRoom: true,
    canRepair: true,
    canPickPackage: true,
    canUseLaundry: true,
    canCommunity: true,
    canLateReturn: true,
    canVisitorReg: true,
    canAccessApp: true,
    canManageAll: false,
    canViewStats: true,
    canAssignRepair: true,
  },
  {
    role: 'admin',
    label: '住服組職員',
    canViewRoom: true,
    canRepair: true,
    canPickPackage: true,
    canUseLaundry: true,
    canCommunity: true,
    canLateReturn: true,
    canVisitorReg: true,
    canAccessApp: true,
    canManageAll: true,
    canViewStats: true,
    canAssignRepair: true,
  },
];

// ═══════════════════════════════════════════════════
// 宿舍生活品質評分
// ═══════════════════════════════════════════════════

export interface DormRating {
  category: string;
  icon: string;
  score: number; // 1-5
  description: string;
}

export function getDormRatings(building: DormBuildingId): DormRating[] {
  const ratings: Record<DormBuildingId, DormRating[]> = {
    schultz: [
      { category: '整潔', icon: 'sparkles-outline', score: 4.2, description: '定期清潔公共區域' },
      { category: '安靜', icon: 'volume-mute-outline', score: 3.8, description: '夜間偶有噪音' },
      { category: '設備', icon: 'construct-outline', score: 4.0, description: '設施已全面更新' },
      {
        category: '安全',
        icon: 'shield-checkmark-outline',
        score: 4.5,
        description: 'CCTV + 門禁完善',
      },
      { category: '交通', icon: 'bus-outline', score: 3.5, description: '步行至校門約 8 分鐘' },
    ],
    bosco: [
      { category: '整潔', icon: 'sparkles-outline', score: 3.9, description: '單元式較好維護' },
      { category: '安靜', icon: 'volume-mute-outline', score: 4.0, description: '隔音較好' },
      { category: '設備', icon: 'construct-outline', score: 3.7, description: '設備堪用' },
      { category: '安全', icon: 'shield-checkmark-outline', score: 4.3, description: '門禁嚴格' },
      { category: '交通', icon: 'bus-outline', score: 3.8, description: '步行至校門約 6 分鐘' },
    ],
    shepherd: [
      { category: '整潔', icon: 'sparkles-outline', score: 4.5, description: '較新設施好維護' },
      { category: '安靜', icon: 'volume-mute-outline', score: 4.2, description: '隔音優良' },
      { category: '設備', icon: 'construct-outline', score: 4.4, description: '最新設備' },
      {
        category: '安全',
        icon: 'shield-checkmark-outline',
        score: 4.5,
        description: '最新門禁系統',
      },
      { category: '交通', icon: 'bus-outline', score: 3.3, description: '位置較偏' },
    ],
  };
  return ratings[building] ?? ratings.schultz;
}

// ═══════════════════════════════════════════════════
// 緊急聯絡
// ═══════════════════════════════════════════════════

export interface EmergencyContact {
  label: string;
  phone: string;
  icon: string;
  color: string;
  note: string;
}

export const EMERGENCY_CONTACTS: EmergencyContact[] = [
  {
    label: '宿舍 24hr 緊急電話',
    phone: DORM_OFFICE_INFO.emergencyPhone,
    icon: 'call',
    color: '#EF4444',
    note: '全天候緊急事件',
  },
  {
    label: '希嘉學苑服務檯',
    phone: `${DORM_OFFICE_INFO.phone} #11245`,
    icon: 'home',
    color: '#3B82F6',
    note: '08:00-22:00',
  },
  {
    label: '思高學苑服務檯',
    phone: `${DORM_OFFICE_INFO.phone} #11254`,
    icon: 'home',
    color: '#10B981',
    note: '08:00-22:00',
  },
  {
    label: '校安中心',
    phone: '(04) 2632-8001 #11995',
    icon: 'shield',
    color: '#F59E0B',
    note: '24 小時',
  },
  { label: '報警', phone: '110', icon: 'alert-circle', color: '#EF4444', note: '警察局' },
  { label: '消防 / 救護車', phone: '119', icon: 'medkit', color: '#EF4444', note: '消防局' },
];

// ═══════════════════════════════════════════════════
// 宿舍生活小工具
// ═══════════════════════════════════════════════════

export interface QuickAction {
  id: string;
  icon: string;
  label: string;
  description: string;
  color: string;
  tabTarget?: string; // 導向哪個 tab
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'repair',
    icon: 'construct-outline',
    label: '報修',
    description: '設備故障回報',
    color: '#F59E0B',
    tabTarget: 'repair',
  },
  {
    id: 'package',
    icon: 'cube-outline',
    label: '包裹',
    description: '查看/領取包裹',
    color: '#8B5CF6',
    tabTarget: 'package',
  },
  {
    id: 'laundry',
    icon: 'water-outline',
    label: '洗衣',
    description: '即時機台狀態',
    color: '#3B82F6',
    tabTarget: 'laundry',
  },
  {
    id: 'visitor',
    icon: 'person-add-outline',
    label: '訪客登記',
    description: '來訪者登記',
    color: '#10B981',
  },
  {
    id: 'late',
    icon: 'moon-outline',
    label: '夜歸登記',
    description: '00:00 後登記',
    color: '#6366F1',
  },
  {
    id: 'access',
    icon: 'key-outline',
    label: '門禁申請',
    description: '延長/臨時申請',
    color: '#D97706',
  },
  {
    id: 'community',
    icon: 'people-outline',
    label: '社區',
    description: '公告/借物/揪團',
    color: '#EC4899',
    tabTarget: 'community',
  },
  {
    id: 'emergency',
    icon: 'warning-outline',
    label: '緊急求助',
    description: 'SOS 緊急聯絡',
    color: '#EF4444',
  },
];

// ═══════════════════════════════════════════════════
// 宿舍抽籤系統
// ═══════════════════════════════════════════════════

/**
 * 抽籤流程：
 * 1. 申請者填寫志願 → 選擇學苑 + 房型 + 希望室友
 * 2. 系統依優先積分排序 → 隨機抽籤（同分隨機）
 * 3. 住服組審核結果 → 調整特殊需求
 * 4. 公布結果 → 申請者確認 → 繳費 → 入住
 *
 * 角色動作鏈：
 * - 申請者：填志願 → 查進度 → 看結果 → 確認/放棄
 * - 住服組：設定期程 → 審核名單 → 手動調整 → 公布 → 處理申訴
 * - 宿舍幹部：查看本樓層分配 → 迎新準備
 * - 住宿生（換房）：申請換房 → 配對方確認 → 住服組審核
 */

export type LotteryPhase = 'closed' | 'applying' | 'processing' | 'announced' | 'confirming';

export interface LotteryTimeline {
  phase: LotteryPhase;
  label: string;
  icon: string;
  dateRange: string; // 顯示用
  description: string;
}

export const LOTTERY_TIMELINE: LotteryTimeline[] = [
  {
    phase: 'applying',
    label: '申請期',
    icon: 'create-outline',
    dateRange: '6/1 – 6/20',
    description: '填寫住宿志願、選擇室友',
  },
  {
    phase: 'processing',
    label: '抽籤中',
    icon: 'shuffle-outline',
    dateRange: '6/21 – 6/25',
    description: '系統依積分排序後隨機抽選',
  },
  {
    phase: 'announced',
    label: '公布結果',
    icon: 'megaphone-outline',
    dateRange: '6/26',
    description: '可查詢抽籤結果與房號',
  },
  {
    phase: 'confirming',
    label: '確認期',
    icon: 'checkmark-circle-outline',
    dateRange: '6/27 – 7/5',
    description: '確認入住並完成繳費',
  },
  {
    phase: 'closed',
    label: '已截止',
    icon: 'lock-closed-outline',
    dateRange: '—',
    description: '本期抽籤已結束',
  },
];

export function getCurrentLotteryPhase(): LotteryPhase {
  // 模擬：依月份判斷（實際會從後端取）
  const month = new Date().getMonth() + 1;
  if (month === 6) return 'applying';
  if (month === 7) return 'confirming';
  if (month >= 1 && month <= 5) return 'closed';
  return 'closed';
}

// ── 優先積分規則 ──

export interface PriorityRule {
  id: string;
  label: string;
  points: number;
  description: string;
  icon: string;
}

export const PRIORITY_RULES: PriorityRule[] = [
  {
    id: 'distance',
    label: '遠距加分',
    points: 20,
    icon: 'location-outline',
    description: '戶籍地距學校 >100km',
  },
  {
    id: 'distance_mid',
    label: '中距加分',
    points: 10,
    icon: 'location-outline',
    description: '戶籍地距學校 50-100km',
  },
  {
    id: 'gpa_high',
    label: '成績優異',
    points: 15,
    icon: 'school-outline',
    description: '前學期 GPA ≥ 3.7',
  },
  {
    id: 'gpa_mid',
    label: '成績良好',
    points: 8,
    icon: 'school-outline',
    description: '前學期 GPA ≥ 3.0',
  },
  {
    id: 'disability',
    label: '身心障礙',
    points: 30,
    icon: 'accessibility-outline',
    description: '持有身心障礙證明（優先保障）',
  },
  {
    id: 'low_income',
    label: '經濟弱勢',
    points: 20,
    icon: 'heart-outline',
    description: '中低收入戶證明',
  },
  { id: 'foreign', label: '境外生', points: 25, icon: 'globe-outline', description: '外籍或僑生' },
  {
    id: 'freshman',
    label: '新生保障',
    points: 50,
    icon: 'star-outline',
    description: '大一新生優先保障住宿',
  },
  {
    id: 'good_record',
    label: '優良住宿紀錄',
    points: 5,
    icon: 'thumbs-up-outline',
    description: '無違規紀錄且準時退宿',
  },
  {
    id: 'dorm_staff_bonus',
    label: '幹部加分',
    points: 10,
    icon: 'ribbon-outline',
    description: '擔任宿舍幹部/樓長',
  },
];

// ── 志願表 ──

export interface LotteryWish {
  priority: number; // 1 = 第一志願
  buildingId: DormBuildingId;
  roomTypeId: string; // 對應 ROOM_TYPES.id
}

export interface LotteryApplication {
  id: string;
  userId: string;
  userName: string;
  status: LotteryAppStatus;
  wishes: LotteryWish[]; // 最多 3 個志願
  preferredRoommates: string[]; // 希望室友的 userId（最多 occupancy-1 人）
  priorityPoints: number; // 系統計算
  priorityBreakdown: { ruleId: string; points: number }[];
  appliedAt: string;
  resultBuildingId?: DormBuildingId;
  resultRoom?: string;
  resultRoommates?: string[];
  confirmedAt?: string;
}

export type LotteryAppStatus =
  | 'draft' // 草稿
  | 'submitted' // 已提交
  | 'in_lottery' // 抽籤中
  | 'won' // 中籤
  | 'waitlisted' // 候補
  | 'lost' // 未中
  | 'confirmed' // 已確認入住
  | 'forfeited' // 放棄資格
  | 'cancelled'; // 取消申請

export function getLotteryStatusLabel(status: LotteryAppStatus): string {
  const m: Record<LotteryAppStatus, string> = {
    draft: '草稿',
    submitted: '已提交',
    in_lottery: '抽籤中',
    won: '恭喜中籤！',
    waitlisted: '候補中',
    lost: '未中籤',
    confirmed: '已確認入住',
    forfeited: '已放棄',
    cancelled: '已取消',
  };
  return m[status] ?? status;
}

export function getLotteryStatusColor(status: LotteryAppStatus): string {
  const m: Record<LotteryAppStatus, string> = {
    draft: '#9CA3AF',
    submitted: '#3B82F6',
    in_lottery: '#F59E0B',
    won: '#10B981',
    waitlisted: '#F59E0B',
    lost: '#EF4444',
    confirmed: '#10B981',
    forfeited: '#9CA3AF',
    cancelled: '#9CA3AF',
  };
  return m[status] ?? '#9CA3AF';
}

// ── 換房申請（住宿生↔住宿生→住服組） ──

export interface RoomSwapRequest {
  id: string;
  requesterId: string;
  requesterRoom: string;
  targetId: string;
  targetRoom: string;
  status: 'pending_target' | 'pending_admin' | 'approved' | 'rejected' | 'cancelled';
  reason: string;
  createdAt: string;
}

export function getSwapStatusLabel(status: RoomSwapRequest['status']): string {
  const m: Record<string, string> = {
    pending_target: '等待對方確認',
    pending_admin: '等待住服組審核',
    approved: '已核准',
    rejected: '已駁回',
    cancelled: '已取消',
  };
  return m[status] ?? status;
}

// ── 模擬抽籤資料 ──

export function simulateLotteryStats() {
  return {
    totalApplicants: 1847,
    totalBeds: 3400,
    acceptanceRate: 0.82,
    currentPhase: getCurrentLotteryPhase(),
    phaseEndDate: '2026-06-20T23:59:59',
    buildingStats: [
      { building: 'schultz' as DormBuildingId, applicants: 920, beds: 1960, rate: 0.94 },
      { building: 'bosco' as DormBuildingId, applicants: 580, beds: 800, rate: 0.73 },
      { building: 'shepherd' as DormBuildingId, applicants: 347, beds: 640, rate: 0.92 },
    ],
  };
}

export function simulateMyApplication(): LotteryApplication | null {
  // 模擬一筆申請資料（實際從後端取）
  return {
    id: 'app-001',
    userId: 'current-user',
    userName: '同學',
    status: 'submitted',
    wishes: [
      { priority: 1, buildingId: 'schultz', roomTypeId: 'schultz-4p' },
      { priority: 2, buildingId: 'shepherd', roomTypeId: 'shepherd-4p-f' },
      { priority: 3, buildingId: 'bosco', roomTypeId: 'bosco-3p' },
    ],
    preferredRoommates: [],
    priorityPoints: 38,
    priorityBreakdown: [
      { ruleId: 'distance', points: 20 },
      { ruleId: 'gpa_mid', points: 8 },
      { ruleId: 'good_record', points: 5 },
      { ruleId: 'dorm_staff_bonus', points: 5 },
    ],
    appliedAt: new Date().toISOString(),
  };
}
