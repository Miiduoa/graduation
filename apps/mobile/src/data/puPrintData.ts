/**
 * 靜宜大學列印/影印服務 — 完整真實資料 + 創新功能
 * 資料來源：https://www.lib.pu.edu.tw/service/copy.html
 *
 * 真實收費：影印卡 $110/張 (內含 120 點)
 * 影印機：B1-1F、3F-4F、7F-9F 影印區（插卡式自助）
 * 列印機：B1、1F 資訊檢索區（插卡式自助）
 * 收費：A4/B4 = 1點/張，A3 = 2點/張
 * 色彩：黑白
 * 輸出：可雙面影印/列印
 */

// ═══════════════════════════════════════════════════
// 基本收費資訊
// ═══════════════════════════════════════════════════

export const PRINT_SERVICE_INFO = {
  cardPrice: 110, // NTD
  cardPoints: 120, // 每張卡內含點數
  pointValue: 110 / 120, // 每點約 0.917 元
  purchaseLocation: '蓋夏圖書館 1F 參考諮詢檯',
  contactUnit: '知識服務組',
  contactPhone: '(04) 2632-8001 #11633',
  contactEmail: 'ref@lib.pu.edu.tw',
  serviceHours: '週一至週五 08:00–21:00 / 週六日 10:00–16:00',
};

export type PaperSize = 'A4' | 'B4' | 'A3';
export type PrintMode = 'single' | 'duplex';
export type ColorMode = 'bw' | 'color';

export interface PricingRule {
  paperSize: PaperSize;
  colorMode: ColorMode;
  pointsPerPage: number;
  description: string;
}

export const PRICING_RULES: PricingRule[] = [
  { paperSize: 'A4', colorMode: 'bw', pointsPerPage: 1, description: 'A4 黑白' },
  { paperSize: 'B4', colorMode: 'bw', pointsPerPage: 1, description: 'B4 黑白' },
  { paperSize: 'A3', colorMode: 'bw', pointsPerPage: 2, description: 'A3 黑白' },
  { paperSize: 'A4', colorMode: 'color', pointsPerPage: 5, description: 'A4 彩色' },
  { paperSize: 'A3', colorMode: 'color', pointsPerPage: 10, description: 'A3 彩色' },
];

export function calculateCost(
  pages: number,
  copies: number,
  paperSize: PaperSize,
  colorMode: ColorMode,
  duplex: boolean,
): { points: number; estimatedNTD: number } {
  const rule = PRICING_RULES.find((r) => r.paperSize === paperSize && r.colorMode === colorMode);
  const pointsPerPage = rule?.pointsPerPage ?? 1;
  const totalPages = duplex ? Math.ceil(pages / 2) : pages;
  const points = totalPages * copies * pointsPerPage;
  return { points, estimatedNTD: Math.ceil(points * PRINT_SERVICE_INFO.pointValue) };
}

// ═══════════════════════════════════════════════════
// 印表機 / 影印機真實位置
// ═══════════════════════════════════════════════════

export type MachineType = 'printer' | 'copier' | 'multifunction' | 'scanner';

export interface PrintStation {
  id: string;
  name: string;
  type: MachineType;
  building: string;
  floor: string;
  location: string;
  lat: number;
  lng: number;
  capabilities: MachineCapability[];
  paperSizes: PaperSize[];
  colorModes: ColorMode[];
  supportsCloud: boolean; // 支援雲端列印
  supportsScan: boolean; // 支援掃描
  status: MachineStatus;
  queueLength: number;
  estimatedWaitMinutes: number;
  model: string;
  tonerLevel: number; // 0-100%
  paperLevel: number; // 0-100%
}

export type MachineCapability =
  | 'duplex'
  | 'staple'
  | 'scan_to_email'
  | 'scan_to_usb'
  | 'cloud_print'
  | 'mobile_print'
  | 'copy'
  | 'a3';
export type MachineStatus =
  | 'online'
  | 'busy'
  | 'offline'
  | 'error'
  | 'outOfPaper'
  | 'outOfToner'
  | 'maintenance';

export const PRINT_STATIONS: PrintStation[] = [
  // ── 蓋夏圖書館 列印機（資訊檢索區）──
  {
    id: 'LIB-B1-P1',
    name: '圖書館 B1 列印機',
    type: 'printer',
    building: '蓋夏圖書館',
    floor: 'B1',
    location: 'B1 資訊檢索區',
    lat: 24.2275,
    lng: 120.5635,
    capabilities: ['duplex', 'cloud_print', 'mobile_print'],
    paperSizes: ['A4'],
    colorModes: ['bw'],
    supportsCloud: true,
    supportsScan: false,
    status: 'online',
    queueLength: 2,
    estimatedWaitMinutes: 3,
    model: 'RICOH IM C3500',
    tonerLevel: 72,
    paperLevel: 85,
  },
  {
    id: 'LIB-1F-P1',
    name: '圖書館 1F 列印機 A',
    type: 'printer',
    building: '蓋夏圖書館',
    floor: '1F',
    location: '1F 資訊檢索區（左側）',
    lat: 24.2275,
    lng: 120.5635,
    capabilities: ['duplex', 'cloud_print', 'mobile_print'],
    paperSizes: ['A4'],
    colorModes: ['bw'],
    supportsCloud: true,
    supportsScan: false,
    status: 'online',
    queueLength: 0,
    estimatedWaitMinutes: 0,
    model: 'RICOH IM C3500',
    tonerLevel: 45,
    paperLevel: 60,
  },
  {
    id: 'LIB-1F-P2',
    name: '圖書館 1F 列印機 B',
    type: 'printer',
    building: '蓋夏圖書館',
    floor: '1F',
    location: '1F 資訊檢索區（右側）',
    lat: 24.2275,
    lng: 120.5635,
    capabilities: ['duplex', 'cloud_print', 'mobile_print'],
    paperSizes: ['A4'],
    colorModes: ['bw'],
    supportsCloud: true,
    supportsScan: false,
    status: 'busy',
    queueLength: 5,
    estimatedWaitMinutes: 8,
    model: 'RICOH IM C3500',
    tonerLevel: 30,
    paperLevel: 40,
  },

  // ── 蓋夏圖書館 影印機 ──
  {
    id: 'LIB-B1-C1',
    name: '圖書館 B1 影印機',
    type: 'copier',
    building: '蓋夏圖書館',
    floor: 'B1',
    location: 'B1 列印/影印/掃描區',
    lat: 24.2275,
    lng: 120.5635,
    capabilities: ['duplex', 'copy', 'scan_to_usb', 'a3'],
    paperSizes: ['A4', 'B4', 'A3'],
    colorModes: ['bw'],
    supportsCloud: false,
    supportsScan: true,
    status: 'online',
    queueLength: 1,
    estimatedWaitMinutes: 2,
    model: 'RICOH MP 5055',
    tonerLevel: 88,
    paperLevel: 70,
  },
  {
    id: 'LIB-1F-C1',
    name: '圖書館 1F 影印機',
    type: 'copier',
    building: '蓋夏圖書館',
    floor: '1F',
    location: '1F 列印/影印區',
    lat: 24.2275,
    lng: 120.5635,
    capabilities: ['duplex', 'copy', 'scan_to_usb', 'a3'],
    paperSizes: ['A4', 'B4', 'A3'],
    colorModes: ['bw'],
    supportsCloud: false,
    supportsScan: true,
    status: 'online',
    queueLength: 0,
    estimatedWaitMinutes: 0,
    model: 'RICOH MP 5055',
    tonerLevel: 65,
    paperLevel: 90,
  },
  {
    id: 'LIB-3F-C1',
    name: '圖書館 3F 影印機',
    type: 'copier',
    building: '蓋夏圖書館',
    floor: '3F',
    location: '3F 影印區',
    lat: 24.2275,
    lng: 120.5635,
    capabilities: ['duplex', 'copy', 'a3'],
    paperSizes: ['A4', 'B4', 'A3'],
    colorModes: ['bw'],
    supportsCloud: false,
    supportsScan: false,
    status: 'online',
    queueLength: 0,
    estimatedWaitMinutes: 0,
    model: 'RICOH MP 4055',
    tonerLevel: 55,
    paperLevel: 80,
  },
  {
    id: 'LIB-4F-C1',
    name: '圖書館 4F 影印機',
    type: 'copier',
    building: '蓋夏圖書館',
    floor: '4F',
    location: '4F 影印區',
    lat: 24.2275,
    lng: 120.5635,
    capabilities: ['duplex', 'copy', 'a3'],
    paperSizes: ['A4', 'B4', 'A3'],
    colorModes: ['bw'],
    supportsCloud: false,
    supportsScan: false,
    status: 'offline',
    queueLength: 0,
    estimatedWaitMinutes: 0,
    model: 'RICOH MP 4055',
    tonerLevel: 20,
    paperLevel: 15,
  },
  {
    id: 'LIB-7F-C1',
    name: '圖書館 7F 影印機',
    type: 'copier',
    building: '蓋夏圖書館',
    floor: '7F',
    location: '7F 影印區',
    lat: 24.2275,
    lng: 120.5635,
    capabilities: ['duplex', 'copy'],
    paperSizes: ['A4', 'B4'],
    colorModes: ['bw'],
    supportsCloud: false,
    supportsScan: false,
    status: 'online',
    queueLength: 0,
    estimatedWaitMinutes: 0,
    model: 'RICOH MP 3055',
    tonerLevel: 80,
    paperLevel: 95,
  },
  {
    id: 'LIB-8F-C1',
    name: '圖書館 8F 影印機',
    type: 'copier',
    building: '蓋夏圖書館',
    floor: '8F',
    location: '8F 影印區',
    lat: 24.2275,
    lng: 120.5635,
    capabilities: ['duplex', 'copy'],
    paperSizes: ['A4', 'B4'],
    colorModes: ['bw'],
    supportsCloud: false,
    supportsScan: false,
    status: 'online',
    queueLength: 0,
    estimatedWaitMinutes: 0,
    model: 'RICOH MP 3055',
    tonerLevel: 90,
    paperLevel: 75,
  },
  {
    id: 'LIB-9F-C1',
    name: '圖書館 9F 影印機',
    type: 'copier',
    building: '蓋夏圖書館',
    floor: '9F',
    location: '9F 影印區',
    lat: 24.2275,
    lng: 120.5635,
    capabilities: ['duplex', 'copy'],
    paperSizes: ['A4', 'B4'],
    colorModes: ['bw'],
    supportsCloud: false,
    supportsScan: false,
    status: 'online',
    queueLength: 0,
    estimatedWaitMinutes: 0,
    model: 'RICOH MP 3055',
    tonerLevel: 70,
    paperLevel: 60,
  },

  // ── 校園其他列印據點 ──
  {
    id: 'CS-1F-MF1',
    name: '資工系辦 多功能事務機',
    type: 'multifunction',
    building: '伯鐸樓',
    floor: '5F',
    location: '資工系辦公室旁',
    lat: 24.2268,
    lng: 120.5642,
    capabilities: ['duplex', 'copy', 'scan_to_email', 'cloud_print', 'mobile_print', 'a3'],
    paperSizes: ['A4', 'A3'],
    colorModes: ['bw', 'color'],
    supportsCloud: true,
    supportsScan: true,
    status: 'online',
    queueLength: 1,
    estimatedWaitMinutes: 2,
    model: 'HP Color LaserJet MFP E87640',
    tonerLevel: 60,
    paperLevel: 50,
  },
  {
    id: 'ADMIN-2F-P1',
    name: '行政大樓 自助列印機',
    type: 'printer',
    building: '行政大樓',
    floor: '2F',
    location: '2F 學生服務中心旁',
    lat: 24.2281,
    lng: 120.5629,
    capabilities: ['duplex', 'cloud_print', 'mobile_print'],
    paperSizes: ['A4'],
    colorModes: ['bw'],
    supportsCloud: true,
    supportsScan: false,
    status: 'online',
    queueLength: 3,
    estimatedWaitMinutes: 5,
    model: 'RICOH IM C3500',
    tonerLevel: 55,
    paperLevel: 45,
  },
  {
    id: 'STORE-P1',
    name: '校內影印店（濟時樓旁）',
    type: 'multifunction',
    building: '濟時樓旁',
    floor: '1F',
    location: '校內影印店',
    lat: 24.2269,
    lng: 120.5638,
    capabilities: ['duplex', 'copy', 'scan_to_email', 'scan_to_usb', 'a3', 'staple'],
    paperSizes: ['A4', 'B4', 'A3'],
    colorModes: ['bw', 'color'],
    supportsCloud: false,
    supportsScan: true,
    status: 'online',
    queueLength: 4,
    estimatedWaitMinutes: 10,
    model: '商用多功能機',
    tonerLevel: 80,
    paperLevel: 90,
  },
];

// ═══════════════════════════════════════════════════
// 狀態相關工具函數
// ═══════════════════════════════════════════════════

export function getStationStatusLabel(status: MachineStatus): string {
  const map: Record<MachineStatus, string> = {
    online: '可使用',
    busy: '忙碌中',
    offline: '離線',
    error: '故障',
    outOfPaper: '缺紙',
    outOfToner: '碳粉不足',
    maintenance: '維護中',
  };
  return map[status] ?? status;
}

export function getStationStatusColor(status: MachineStatus): string {
  const map: Record<MachineStatus, string> = {
    online: '#34C759',
    busy: '#FF9500',
    offline: '#AEAEB2',
    error: '#FF3B30',
    outOfPaper: '#FF3B30',
    outOfToner: '#FF9500',
    maintenance: '#AF52DE',
  };
  return map[status] ?? '#AEAEB2';
}

export function getMachineTypeLabel(type: MachineType): string {
  const map: Record<MachineType, string> = {
    printer: '列印機',
    copier: '影印機',
    multifunction: '多功能事務機',
    scanner: '掃描器',
  };
  return map[type] ?? type;
}

export function getMachineTypeIcon(type: MachineType): string {
  const map: Record<MachineType, string> = {
    printer: 'print-outline',
    copier: 'copy-outline',
    multifunction: 'apps-outline',
    scanner: 'scan-outline',
  };
  return map[type] ?? 'print-outline';
}

// ═══════════════════════════════════════════════════
// 智慧推薦 — 根據需求找最佳機器
// ═══════════════════════════════════════════════════

export interface PrintRecommendation {
  station: PrintStation;
  score: number;
  reasons: string[];
}

export function recommendStation(options: {
  needColor?: boolean;
  needA3?: boolean;
  needScan?: boolean;
  needCloud?: boolean;
  preferQuiet?: boolean;
}): PrintRecommendation[] {
  const results: PrintRecommendation[] = [];

  for (const station of PRINT_STATIONS) {
    if (
      station.status === 'offline' ||
      station.status === 'error' ||
      station.status === 'maintenance'
    )
      continue;

    let score = 50;
    const reasons: string[] = [];

    // Basic availability
    if (station.status === 'online') {
      score += 20;
      reasons.push('可立即使用');
    }
    if (station.status === 'busy') {
      score -= 10;
    }

    // Color requirement
    if (options.needColor) {
      if (station.colorModes.includes('color')) {
        score += 30;
        reasons.push('支援彩色');
      } else continue; // skip if can't do color
    }

    // A3 requirement
    if (options.needA3) {
      if (station.paperSizes.includes('A3')) {
        score += 20;
        reasons.push('支援 A3');
      } else continue;
    }

    // Scan requirement
    if (options.needScan) {
      if (station.supportsScan) {
        score += 25;
        reasons.push('可掃描');
      } else continue;
    }

    // Cloud print
    if (options.needCloud) {
      if (station.supportsCloud) {
        score += 25;
        reasons.push('雲端列印');
      } else {
        score -= 20;
      }
    }

    // Queue penalty
    score -= station.queueLength * 5;
    if (station.queueLength === 0) reasons.push('無需等待');
    else if (station.queueLength <= 2) reasons.push(`排隊 ${station.queueLength} 份`);
    else reasons.push(`排隊較長 (${station.queueLength} 份)`);

    // Supply levels
    if (station.paperLevel < 20) {
      score -= 15;
      reasons.push('紙張不足');
    }
    if (station.tonerLevel < 20) {
      score -= 15;
      reasons.push('碳粉不足');
    }

    results.push({ station, score, reasons });
  }

  return results.sort((a, b) => b.score - a.score);
}

// ═══════════════════════════════════════════════════
// 環保積分系統
// ═══════════════════════════════════════════════════

export interface EcoAction {
  id: string;
  action: string;
  points: number;
  icon: string;
  description: string;
}

export const ECO_ACTIONS: EcoAction[] = [
  {
    id: 'duplex',
    action: '使用雙面列印',
    points: 2,
    icon: 'leaf-outline',
    description: '每次雙面列印省下一半紙張',
  },
  {
    id: 'preview',
    action: '列印前預覽',
    points: 1,
    icon: 'eye-outline',
    description: '預覽避免錯誤列印浪費',
  },
  {
    id: 'digital',
    action: '使用電子檔替代列印',
    points: 5,
    icon: 'phone-portrait-outline',
    description: '最環保的選擇',
  },
  {
    id: 'recycle',
    action: '回收單面紙',
    points: 3,
    icon: 'refresh-outline',
    description: '將用過的單面紙放入回收區',
  },
];

export interface EcoLevel {
  level: number;
  name: string;
  minPoints: number;
  icon: string;
  color: string;
  perk: string;
}

export const ECO_LEVELS: EcoLevel[] = [
  {
    level: 1,
    name: '環保新手',
    minPoints: 0,
    icon: 'leaf-outline',
    color: '#AEAEB2',
    perk: '基本功能',
  },
  {
    level: 2,
    name: '綠色使者',
    minPoints: 50,
    icon: 'leaf',
    color: '#34C759',
    perk: '列印提醒與建議',
  },
  {
    level: 3,
    name: '地球守護者',
    minPoints: 150,
    icon: 'earth',
    color: '#34C759',
    perk: '每月免費 10 點',
  },
  {
    level: 4,
    name: '環保大師',
    minPoints: 300,
    icon: 'trophy',
    color: '#047857',
    perk: '每月免費 20 點 + 優先排隊',
  },
];

export function getEcoLevel(points: number): EcoLevel {
  for (let i = ECO_LEVELS.length - 1; i >= 0; i--) {
    if (points >= ECO_LEVELS[i].minPoints) return ECO_LEVELS[i];
  }
  return ECO_LEVELS[0];
}

// ═══════════════════════════════════════════════════
// 列印額度追蹤
// ═══════════════════════════════════════════════════

export interface PrintQuota {
  role: string;
  semesterFreePages: number; // 每學期免費列印頁數
  description: string;
}

export const PRINT_QUOTAS: PrintQuota[] = [
  { role: 'undergraduate', semesterFreePages: 0, description: '大學部學生需購買影印卡' },
  { role: 'master_student', semesterFreePages: 200, description: '碩士生每學期 200 頁免費' },
  { role: 'doctoral_student', semesterFreePages: 500, description: '博士生每學期 500 頁免費' },
  { role: 'full_time_faculty', semesterFreePages: 1000, description: '專任教師每學期 1000 頁免費' },
  { role: 'adjunct_faculty', semesterFreePages: 200, description: '兼任教師每學期 200 頁免費' },
  { role: 'staff', semesterFreePages: 500, description: '職員每學期 500 頁免費' },
];

// ═══════════════════════════════════════════════════
// 常見列印場景（智慧快速啟動）
// ═══════════════════════════════════════════════════

export interface PrintScenario {
  id: string;
  icon: string;
  label: string;
  description: string;
  defaults: {
    paperSize: PaperSize;
    colorMode: ColorMode;
    duplex: boolean;
    needCloud: boolean;
  };
  savingTip?: string;
}

export const PRINT_SCENARIOS: PrintScenario[] = [
  {
    id: 'homework',
    icon: 'school-outline',
    label: '交作業',
    description: 'A4 黑白雙面，最省錢的方式',
    defaults: { paperSize: 'A4', colorMode: 'bw', duplex: true, needCloud: true },
    savingTip: '雙面列印只需一半點數！',
  },
  {
    id: 'report',
    icon: 'document-text-outline',
    label: '課程報告',
    description: 'A4 黑白單面，正式格式',
    defaults: { paperSize: 'A4', colorMode: 'bw', duplex: false, needCloud: true },
  },
  {
    id: 'poster',
    icon: 'image-outline',
    label: '海報/簡報',
    description: 'A3 彩色，適合展示用',
    defaults: { paperSize: 'A3', colorMode: 'color', duplex: false, needCloud: false },
    savingTip: '彩色 A3 = 10點/張，建議先到影印店比價',
  },
  {
    id: 'thesis',
    icon: 'library-outline',
    label: '畢業論文',
    description: 'A4 黑白雙面，大量列印',
    defaults: { paperSize: 'A4', colorMode: 'bw', duplex: true, needCloud: true },
    savingTip: '論文頁數多？雙面列印省一半！',
  },
  {
    id: 'exam',
    icon: 'clipboard-outline',
    label: '考古題',
    description: 'A4 黑白單面，快速列印',
    defaults: { paperSize: 'A4', colorMode: 'bw', duplex: false, needCloud: true },
  },
  {
    id: 'scan',
    icon: 'scan-outline',
    label: '掃描文件',
    description: '將紙本文件數位化',
    defaults: { paperSize: 'A4', colorMode: 'bw', duplex: false, needCloud: false },
  },
];

// ═══════════════════════════════════════════════════
// 模擬即時數據
// ═══════════════════════════════════════════════════

export function simulateStationStatus(): PrintStation[] {
  const hour = new Date().getHours();
  const isPeakHour = (hour >= 10 && hour <= 12) || (hour >= 14 && hour <= 17);

  return PRINT_STATIONS.map((station) => {
    if (station.status === 'offline' || station.status === 'maintenance') return station;

    const baseQueue = isPeakHour ? 3 : 1;
    const jitter = Math.floor(Math.random() * 4);
    const queue = Math.max(0, baseQueue + jitter - 2);

    return {
      ...station,
      queueLength: queue,
      estimatedWaitMinutes: queue * 2,
      status: queue > 6 ? ('busy' as MachineStatus) : ('online' as MachineStatus),
      paperLevel: Math.max(10, station.paperLevel + Math.floor((Math.random() - 0.5) * 20)),
      tonerLevel: Math.max(5, station.tonerLevel + Math.floor((Math.random() - 0.3) * 10)),
    };
  });
}

// ═══════════════════════════════════════════════════
// 常見問題
// ═══════════════════════════════════════════════════

export interface PrintFAQ {
  question: string;
  answer: string;
}

export const PRINT_FAQS: PrintFAQ[] = [
  { question: '影印卡在哪裡買？', answer: '蓋夏圖書館 1F 參考諮詢檯，$110/張（含 120 點）' },
  { question: '影印卡可以退費嗎？', answer: '未使用之影印卡可持卡及收據至 1F 櫃檯辦理退費' },
  { question: '支援哪些紙張大小？', answer: '列印機：A4；影印機：A4、B4、A3' },
  {
    question: '可以彩色列印嗎？',
    answer: '圖書館僅提供黑白列印/影印；彩色列印請至校內影印店或資工系辦',
  },
  {
    question: '夾紙會扣點數嗎？',
    answer: '影印機夾紙不扣點數；列印機最後 1 點若使用可能卡紙並扣點',
  },
  {
    question: '可以用手機列印嗎？',
    answer: '部分列印機支援雲端列印，上傳檔案後到機器旁掃 QR Code 即可取件',
  },
  { question: '哪裡可以掃描？', answer: 'B1 與 1F 影印機支援掃描至 USB，部分機器可掃描至 Email' },
  { question: '可以雙面列印嗎？', answer: '可以，所有列印機與影印機皆支援雙面輸出' },
];

// ═══════════════════════════════════════════════════
// 角色功能矩陣
// ═══════════════════════════════════════════════════

export interface RolePrintAccess {
  role: string;
  label: string;
  canPrint: boolean;
  canCloudPrint: boolean;
  canViewAllJobs: boolean; // staff/admin
  canManagePrinters: boolean; // staff/admin
  canViewStats: boolean; // staff/admin
  hasFreeQuota: boolean;
}

export const ROLE_PRINT_ACCESS: RolePrintAccess[] = [
  {
    role: 'student',
    label: '學生',
    canPrint: true,
    canCloudPrint: true,
    canViewAllJobs: false,
    canManagePrinters: false,
    canViewStats: false,
    hasFreeQuota: false,
  },
  {
    role: 'teacher',
    label: '教師',
    canPrint: true,
    canCloudPrint: true,
    canViewAllJobs: false,
    canManagePrinters: false,
    canViewStats: false,
    hasFreeQuota: true,
  },
  {
    role: 'staff',
    label: '職員',
    canPrint: true,
    canCloudPrint: true,
    canViewAllJobs: true,
    canManagePrinters: true,
    canViewStats: true,
    hasFreeQuota: true,
  },
  {
    role: 'admin',
    label: '管理員',
    canPrint: true,
    canCloudPrint: true,
    canViewAllJobs: true,
    canManagePrinters: true,
    canViewStats: true,
    hasFreeQuota: true,
  },
  {
    role: 'visitor',
    label: '訪客',
    canPrint: false,
    canCloudPrint: false,
    canViewAllJobs: false,
    canManagePrinters: false,
    canViewStats: false,
    hasFreeQuota: false,
  },
];

// ═══════════════════════════════════════════════════
// 細化角色定義 — 所有列印生態圈參與者
// ═══════════════════════════════════════════════════

export type PrintRole =
  | 'undergraduate' // 大學部學生
  | 'master_student' // 碩士生
  | 'doctoral_student' // 博士生
  | 'full_time_faculty' // 專任教師
  | 'adjunct_faculty' // 兼任教師
  | 'staff' // 職員
  | 'library_counter' // 圖書館櫃檯人員
  | 'maintenance_tech' // 設備維護技師
  | 'copy_shop' // 校內影印店
  | 'system_admin'; // 系統管理員

export type PrintFeature =
  | 'self_print' // 自助列印
  | 'self_copy' // 自助影印
  | 'self_scan' // 自助掃描
  | 'cloud_print' // 雲端列印
  | 'mobile_print' // 手機列印
  | 'buy_card' // 購買影印卡
  | 'refund_card' // 退費影印卡
  | 'check_balance' // 餘額查詢
  | 'report_fault' // 故障回報
  | 'view_queue' // 查看排隊
  | 'view_map' // 全校機器地圖
  | 'eco_score' // 環保積分
  | 'co_print' // 合印拼單
  | 'print_history' // 列印紀錄
  | 'batch_print' // 批量列印
  | 'set_format_rule' // 設定列印規範（教師）
  | 'sell_card' // 售卡
  | 'process_refund' // 處理退費
  | 'card_replace' // 故障換卡
  | 'usage_guide' // 操作教學
  | 'fix_machine' // 維修設備
  | 'replace_toner' // 更換碳粉
  | 'replace_paper' // 補充紙張
  | 'color_print' // 彩色列印（影印店）
  | 'binding' // 裝訂服務
  | 'large_format' // 大圖輸出
  | 'manage_quota' // 額度管理
  | 'manage_printers' // 印表機管理
  | 'view_statistics' // 統計儀表板
  | 'send_announcement'; // 發布公告

export interface PrintRoleFeatures {
  role: PrintRole;
  label: string;
  icon: string;
  color: string;
  features: PrintFeature[];
}

export const PRINT_ROLE_FEATURES: PrintRoleFeatures[] = [
  {
    role: 'undergraduate',
    label: '大學部學生',
    icon: 'school-outline',
    color: '#007AFF',
    features: [
      'self_print',
      'self_copy',
      'self_scan',
      'cloud_print',
      'mobile_print',
      'buy_card',
      'refund_card',
      'check_balance',
      'report_fault',
      'view_queue',
      'view_map',
      'eco_score',
      'co_print',
      'print_history',
    ],
  },
  {
    role: 'master_student',
    label: '碩士生',
    icon: 'school-outline',
    color: '#5856D6',
    features: [
      'self_print',
      'self_copy',
      'self_scan',
      'cloud_print',
      'mobile_print',
      'check_balance',
      'report_fault',
      'view_queue',
      'view_map',
      'eco_score',
      'co_print',
      'print_history',
      'batch_print',
    ],
  },
  {
    role: 'doctoral_student',
    label: '博士生',
    icon: 'school-outline',
    color: '#AF52DE',
    features: [
      'self_print',
      'self_copy',
      'self_scan',
      'cloud_print',
      'mobile_print',
      'check_balance',
      'report_fault',
      'view_queue',
      'view_map',
      'eco_score',
      'co_print',
      'print_history',
      'batch_print',
    ],
  },
  {
    role: 'full_time_faculty',
    label: '專任教師',
    icon: 'person-outline',
    color: '#D70015',
    features: [
      'self_print',
      'self_copy',
      'self_scan',
      'cloud_print',
      'mobile_print',
      'check_balance',
      'report_fault',
      'view_queue',
      'view_map',
      'batch_print',
      'set_format_rule',
      'print_history',
    ],
  },
  {
    role: 'adjunct_faculty',
    label: '兼任教師',
    icon: 'person-outline',
    color: '#FF3B30',
    features: [
      'self_print',
      'self_copy',
      'self_scan',
      'cloud_print',
      'check_balance',
      'report_fault',
      'view_queue',
      'view_map',
      'print_history',
    ],
  },
  {
    role: 'staff',
    label: '職員',
    icon: 'briefcase-outline',
    color: '#FF9500',
    features: [
      'self_print',
      'self_copy',
      'self_scan',
      'cloud_print',
      'check_balance',
      'report_fault',
      'view_queue',
      'view_map',
      'batch_print',
      'print_history',
    ],
  },
  {
    role: 'library_counter',
    label: '圖書館櫃檯人員',
    icon: 'desktop-outline',
    color: '#34C759',
    features: [
      'sell_card',
      'process_refund',
      'card_replace',
      'usage_guide',
      'check_balance',
      'report_fault',
      'view_queue',
      'view_map',
      'send_announcement',
    ],
  },
  {
    role: 'maintenance_tech',
    label: '設備維護技師',
    icon: 'construct-outline',
    color: '#AF52DE',
    features: ['fix_machine', 'replace_toner', 'replace_paper', 'view_map', 'view_statistics'],
  },
  {
    role: 'copy_shop',
    label: '校內影印店',
    icon: 'storefront-outline',
    color: '#FF2D55',
    features: ['color_print', 'binding', 'large_format', 'self_copy', 'self_scan'],
  },
  {
    role: 'system_admin',
    label: '系統管理員',
    icon: 'settings-outline',
    color: '#3C3C43',
    features: [
      'manage_quota',
      'manage_printers',
      'view_statistics',
      'send_announcement',
      'view_map',
    ],
  },
];

export function hasPrintFeature(role: PrintRole, feature: PrintFeature): boolean {
  return PRINT_ROLE_FEATURES.find((r) => r.role === role)?.features.includes(feature) ?? false;
}

// ═══════════════════════════════════════════════════
// 角色間動作關聯
// ═══════════════════════════════════════════════════

export interface PrintRoleInteraction {
  from: PrintRole;
  to: PrintRole;
  actions: { id: string; label: string; icon: string; description: string; trigger?: string }[];
}

export const PRINT_ROLE_INTERACTIONS: PrintRoleInteraction[] = [
  // ── 學生 → 櫃檯 ──
  {
    from: 'undergraduate',
    to: 'library_counter',
    actions: [
      {
        id: 'buy_card',
        label: '購買影印卡',
        icon: 'card-outline',
        description: '$110/張（含 120 點）',
        trigger: '臨櫃',
      },
      {
        id: 'refund',
        label: '退費申請',
        icon: 'return-down-back-outline',
        description: '未用完的影印卡退費',
        trigger: '臨櫃',
      },
      {
        id: 'card_issue',
        label: '卡片故障',
        icon: 'alert-circle-outline',
        description: '卡片無法讀取/扣點異常',
        trigger: '臨櫃',
      },
      {
        id: 'usage_help',
        label: '操作諮詢',
        icon: 'help-circle-outline',
        description: '不會使用機器/雲端列印',
        trigger: '臨櫃',
      },
    ],
  },
  // ── 櫃檯 → 學生 ──
  {
    from: 'library_counter',
    to: 'undergraduate',
    actions: [
      {
        id: 'balance_info',
        label: '餘額查詢結果',
        icon: 'information-circle-outline',
        description: '告知卡片剩餘點數',
      },
      {
        id: 'teach_usage',
        label: '操作教學',
        icon: 'school-outline',
        description: '手把手教操作流程',
      },
      {
        id: 'fault_notice',
        label: '故障通知',
        icon: 'warning-outline',
        description: '機器故障/替代方案通知',
      },
      { id: 'new_card', label: '補發新卡', icon: 'card-outline', description: '故障卡轉點至新卡' },
    ],
  },
  // ── 學生 → 維護技師（透過系統） ──
  {
    from: 'undergraduate',
    to: 'maintenance_tech',
    actions: [
      {
        id: 'report_jam',
        label: '回報夾紙',
        icon: 'alert-outline',
        description: 'APP 一鍵回報，含機器編號',
        trigger: 'APP',
      },
      {
        id: 'report_no_paper',
        label: '回報缺紙',
        icon: 'document-outline',
        description: '紙匣空了',
        trigger: 'APP',
      },
      {
        id: 'report_no_toner',
        label: '回報碳粉不足',
        icon: 'color-fill-outline',
        description: '列印品質變淡',
        trigger: 'APP',
      },
      {
        id: 'report_error',
        label: '回報故障',
        icon: 'bug-outline',
        description: '機器顯示錯誤碼',
        trigger: 'APP',
      },
    ],
  },
  // ── 維護技師 → 學生（透過系統推播） ──
  {
    from: 'maintenance_tech',
    to: 'undergraduate',
    actions: [
      {
        id: 'fix_done',
        label: '修復完成通知',
        icon: 'checkmark-circle-outline',
        description: '機器已修好可使用',
      },
      {
        id: 'alt_suggest',
        label: '替代機器推薦',
        icon: 'swap-horizontal-outline',
        description: '故障期間推薦附近機器',
      },
      {
        id: 'schedule_maint',
        label: '排定維護通知',
        icon: 'calendar-outline',
        description: '預告維護時段',
      },
    ],
  },
  // ── 教師 → 學生 ──
  {
    from: 'full_time_faculty',
    to: 'undergraduate',
    actions: [
      {
        id: 'format_rule',
        label: '列印格式規範',
        icon: 'document-text-outline',
        description: '論文/報告列印格式要求',
      },
      {
        id: 'eco_encourage',
        label: '環保倡導',
        icon: 'leaf-outline',
        description: '鼓勵電子繳交或雙面列印',
      },
      {
        id: 'material_share',
        label: '教材分享',
        icon: 'share-outline',
        description: '提供電子檔減少列印',
      },
    ],
  },
  // ── 教師 → 影印店 ──
  {
    from: 'full_time_faculty',
    to: 'copy_shop',
    actions: [
      {
        id: 'exam_print',
        label: '考卷印製',
        icon: 'clipboard-outline',
        description: '大量考卷印製+裝訂',
      },
      {
        id: 'material_bulk',
        label: '教材批量影印',
        icon: 'copy-outline',
        description: '課程講義批量印製',
      },
    ],
  },
  // ── 學生 → 影印店 ──
  {
    from: 'undergraduate',
    to: 'copy_shop',
    actions: [
      {
        id: 'color_job',
        label: '彩色列印',
        icon: 'color-palette-outline',
        description: '圖書館沒有的彩色服務',
      },
      {
        id: 'poster_print',
        label: '海報/大圖輸出',
        icon: 'image-outline',
        description: 'A1/A0 大圖輸出',
      },
      {
        id: 'thesis_bind',
        label: '論文裝訂',
        icon: 'book-outline',
        description: '畢業論文精裝/膠裝',
      },
      {
        id: 'rush_job',
        label: '急件處理',
        icon: 'flash-outline',
        description: '排隊太長時的替代方案',
      },
    ],
  },
  // ── 影印店 → 學生 ──
  {
    from: 'copy_shop',
    to: 'undergraduate',
    actions: [
      {
        id: 'price_compare',
        label: '比價資訊',
        icon: 'pricetag-outline',
        description: 'APP 內顯示影印店價格比較',
      },
      {
        id: 'order_ready',
        label: '取件通知',
        icon: 'notifications-outline',
        description: '批量訂單完成通知',
      },
    ],
  },
  // ── 學生 ↔ 學生 ──
  {
    from: 'undergraduate',
    to: 'undergraduate',
    actions: [
      {
        id: 'co_print_invite',
        label: '合印拼單邀請',
        icon: 'people-outline',
        description: '邀請同學合印分攤費用',
      },
      {
        id: 'share_file',
        label: '共享列印檔案',
        icon: 'share-social-outline',
        description: '同課堂共用講義檔案',
      },
      {
        id: 'eco_challenge',
        label: '環保積分 PK',
        icon: 'trophy-outline',
        description: '班級/系所省紙 PK 賽',
      },
      {
        id: 'tip_share',
        label: '省錢秘訣分享',
        icon: 'bulb-outline',
        description: '分享哪台機器最快/最便宜',
      },
      {
        id: 'card_lend',
        label: '影印卡互借',
        icon: 'hand-left-outline',
        description: '臨時借用同學影印卡',
      },
    ],
  },
  // ── 系統管理 → 全角色 ──
  {
    from: 'system_admin',
    to: 'undergraduate',
    actions: [
      {
        id: 'quota_assign',
        label: '額度分配',
        icon: 'calculator-outline',
        description: '每學期免費額度發放',
      },
      {
        id: 'sys_announce',
        label: '系統公告',
        icon: 'megaphone-outline',
        description: '列印系統維護/更新通知',
      },
      {
        id: 'price_update',
        label: '費率調整通知',
        icon: 'cash-outline',
        description: '影印卡價格/點數變動',
      },
    ],
  },
  {
    from: 'system_admin',
    to: 'maintenance_tech',
    actions: [
      {
        id: 'auto_dispatch',
        label: '自動派工',
        icon: 'git-branch-outline',
        description: 'IoT 偵測異常自動通知維護',
      },
      {
        id: 'toner_alert',
        label: '碳粉低量預警',
        icon: 'color-fill-outline',
        description: '低於 20% 自動通知補充',
      },
      {
        id: 'paper_alert',
        label: '紙張低量預警',
        icon: 'document-outline',
        description: '低於 20% 自動通知補紙',
      },
    ],
  },
  {
    from: 'system_admin',
    to: 'library_counter',
    actions: [
      {
        id: 'daily_report',
        label: '每日使用報告',
        icon: 'bar-chart-outline',
        description: '昨日全校列印統計',
      },
      {
        id: 'card_stock_alert',
        label: '影印卡庫存預警',
        icon: 'layers-outline',
        description: '庫存低於安全量',
      },
    ],
  },
];

// ═══════════════════════════════════════════════════
// 雲端列印工作流 — 列印任務生命週期
// ═══════════════════════════════════════════════════

export type PrintJobStatus =
  | 'draft' // 草稿（未上傳）
  | 'uploading' // 上傳中
  | 'queued' // 已排隊
  | 'printing' // 列印中
  | 'done' // 列印完成
  | 'picked' // 已取件
  | 'expired' // 未取件過期
  | 'failed' // 列印失敗
  | 'cancelled'; // 已取消

export interface CloudPrintJob {
  id: string;
  userId: string;
  fileName: string;
  fileSize: number; // bytes
  pageCount: number;
  copies: number;
  paperSize: PaperSize;
  colorMode: ColorMode;
  duplex: boolean;
  targetStationId: string;
  status: PrintJobStatus;
  pointsCost: number;
  createdAt: string;
  queuePosition?: number;
  estimatedPrintTime?: number; // seconds
  printedAt?: string;
  pickedAt?: string;
  expiresAt?: string; // 取件期限（列印後 30 分鐘）
  qrCode?: string;
  errorMessage?: string;
}

export function getPrintJobStatusLabel(status: PrintJobStatus): string {
  const m: Record<PrintJobStatus, string> = {
    draft: '草稿',
    uploading: '上傳中',
    queued: '排隊中',
    printing: '列印中',
    done: '已完成',
    picked: '已取件',
    expired: '已過期',
    failed: '列印失敗',
    cancelled: '已取消',
  };
  return m[status] ?? status;
}

export function getPrintJobStatusColor(status: PrintJobStatus): string {
  const m: Record<PrintJobStatus, string> = {
    draft: '#AEAEB2',
    uploading: '#007AFF',
    queued: '#FF9500',
    printing: '#5856D6',
    done: '#34C759',
    picked: '#34C759',
    expired: '#FF3B30',
    failed: '#D70015',
    cancelled: '#AEAEB2',
  };
  return m[status] ?? '#AEAEB2';
}

export function getPrintJobStatusIcon(status: PrintJobStatus): string {
  const m: Record<PrintJobStatus, string> = {
    draft: 'document-outline',
    uploading: 'cloud-upload-outline',
    queued: 'time-outline',
    printing: 'print-outline',
    done: 'checkmark-circle-outline',
    picked: 'hand-left-outline',
    expired: 'alert-circle-outline',
    failed: 'close-circle-outline',
    cancelled: 'ban-outline',
  };
  return m[status] ?? 'help-circle-outline';
}

// 模擬列印紀錄
export function simulatePrintHistory(): CloudPrintJob[] {
  return [
    {
      id: 'pj-001',
      userId: 'current-user',
      fileName: '期中報告_final.pdf',
      fileSize: 2458000,
      pageCount: 12,
      copies: 1,
      paperSize: 'A4',
      colorMode: 'bw',
      duplex: true,
      targetStationId: 'LIB-1F-P1',
      status: 'picked',
      pointsCost: 6,
      createdAt: '2026-04-20T14:30:00',
      printedAt: '2026-04-20T14:32:00',
      pickedAt: '2026-04-20T14:35:00',
    },
    {
      id: 'pj-002',
      userId: 'current-user',
      fileName: '演算法作業3.pdf',
      fileSize: 580000,
      pageCount: 4,
      copies: 1,
      paperSize: 'A4',
      colorMode: 'bw',
      duplex: false,
      targetStationId: 'LIB-B1-P1',
      status: 'picked',
      pointsCost: 4,
      createdAt: '2026-04-18T10:15:00',
      printedAt: '2026-04-18T10:16:00',
      pickedAt: '2026-04-18T10:20:00',
    },
    {
      id: 'pj-003',
      userId: 'current-user',
      fileName: '資料結構筆記.pdf',
      fileSize: 1200000,
      pageCount: 8,
      copies: 2,
      paperSize: 'A4',
      colorMode: 'bw',
      duplex: true,
      targetStationId: 'LIB-1F-P2',
      status: 'done',
      pointsCost: 8,
      createdAt: '2026-04-24T09:00:00',
      printedAt: '2026-04-24T09:05:00',
      expiresAt: '2026-04-24T09:35:00',
    },
    {
      id: 'pj-004',
      userId: 'current-user',
      fileName: '畢業論文草稿.pdf',
      fileSize: 8500000,
      pageCount: 68,
      copies: 1,
      paperSize: 'A4',
      colorMode: 'bw',
      duplex: true,
      targetStationId: 'LIB-1F-P1',
      status: 'queued',
      pointsCost: 34,
      createdAt: '2026-04-24T11:30:00',
      queuePosition: 3,
      estimatedPrintTime: 180,
    },
  ];
}

// ═══════════════════════════════════════════════════
// 故障回報系統
// ═══════════════════════════════════════════════════

export type FaultType =
  | 'paper_jam'
  | 'no_paper'
  | 'no_toner'
  | 'error_code'
  | 'quality_issue'
  | 'card_reader'
  | 'network'
  | 'other';

export interface FaultReport {
  id: string;
  stationId: string;
  reporterId: string;
  faultType: FaultType;
  description: string;
  errorCode?: string;
  photoUrl?: string;
  status: 'reported' | 'assigned' | 'in_progress' | 'resolved' | 'cannot_fix';
  reportedAt: string;
  assignedTo?: string;
  resolvedAt?: string;
  resolution?: string;
}

export function getFaultTypeLabel(type: FaultType): string {
  const m: Record<FaultType, string> = {
    paper_jam: '夾紙',
    no_paper: '缺紙',
    no_toner: '碳粉不足',
    error_code: '錯誤碼',
    quality_issue: '列印品質差',
    card_reader: '讀卡機故障',
    network: '網路問題',
    other: '其他',
  };
  return m[type] ?? type;
}

export function getFaultTypeIcon(type: FaultType): string {
  const m: Record<FaultType, string> = {
    paper_jam: 'alert-circle-outline',
    no_paper: 'document-outline',
    no_toner: 'color-fill-outline',
    error_code: 'bug-outline',
    quality_issue: 'eye-off-outline',
    card_reader: 'card-outline',
    network: 'wifi-outline',
    other: 'help-circle-outline',
  };
  return m[type] ?? 'help-circle-outline';
}

export function getFaultStatusColor(status: FaultReport['status']): string {
  const m: Record<string, string> = {
    reported: '#FF3B30',
    assigned: '#FF9500',
    in_progress: '#007AFF',
    resolved: '#34C759',
    cannot_fix: '#AEAEB2',
  };
  return m[status] ?? '#AEAEB2';
}

// ═══════════════════════════════════════════════════
// 影印卡交易追蹤
// ═══════════════════════════════════════════════════

export type CardTransactionType =
  | 'purchase'
  | 'print'
  | 'copy'
  | 'scan'
  | 'refund'
  | 'transfer'
  | 'bonus'
  | 'expired';

export interface CopyCardTransaction {
  id: string;
  cardId: string;
  userId: string;
  type: CardTransactionType;
  points: number; // 正 = 加值，負 = 消費
  balanceAfter: number;
  stationId?: string;
  description: string;
  createdAt: string;
}

export function getTransactionTypeLabel(type: CardTransactionType): string {
  const m: Record<CardTransactionType, string> = {
    purchase: '購卡',
    print: '列印',
    copy: '影印',
    scan: '掃描',
    refund: '退費',
    transfer: '轉點',
    bonus: '環保獎勵',
    expired: '過期',
  };
  return m[type] ?? type;
}

export function getTransactionTypeColor(type: CardTransactionType): string {
  const m: Record<CardTransactionType, string> = {
    purchase: '#34C759',
    print: '#007AFF',
    copy: '#5856D6',
    scan: '#AF52DE',
    refund: '#FF9500',
    transfer: '#FF2D55',
    bonus: '#34C759',
    expired: '#AEAEB2',
  };
  return m[type] ?? '#AEAEB2';
}

// 模擬交易紀錄
export function simulateCardTransactions(): CopyCardTransaction[] {
  return [
    {
      id: 'tx-001',
      cardId: 'card-001',
      userId: 'current-user',
      type: 'purchase',
      points: 120,
      balanceAfter: 120,
      description: '購買影印卡 #001',
      createdAt: '2026-03-01T10:00:00',
    },
    {
      id: 'tx-002',
      cardId: 'card-001',
      userId: 'current-user',
      type: 'print',
      points: -4,
      balanceAfter: 116,
      stationId: 'LIB-1F-P1',
      description: 'A4 黑白 4 頁',
      createdAt: '2026-03-05T14:20:00',
    },
    {
      id: 'tx-003',
      cardId: 'card-001',
      userId: 'current-user',
      type: 'copy',
      points: -6,
      balanceAfter: 110,
      stationId: 'LIB-B1-C1',
      description: 'A4 黑白雙面 6 面',
      createdAt: '2026-03-10T09:30:00',
    },
    {
      id: 'tx-004',
      cardId: 'card-001',
      userId: 'current-user',
      type: 'bonus',
      points: 5,
      balanceAfter: 115,
      description: '環保積分獎勵：連續 5 次雙面列印',
      createdAt: '2026-03-15T12:00:00',
    },
    {
      id: 'tx-005',
      cardId: 'card-001',
      userId: 'current-user',
      type: 'print',
      points: -34,
      balanceAfter: 81,
      stationId: 'LIB-1F-P1',
      description: 'A4 黑白雙面 68 頁（畢業論文草稿）',
      createdAt: '2026-04-20T14:30:00',
    },
    {
      id: 'tx-006',
      cardId: 'card-001',
      userId: 'current-user',
      type: 'print',
      points: -6,
      balanceAfter: 75,
      stationId: 'LIB-B1-P1',
      description: 'A4 黑白雙面 12 頁（期中報告）',
      createdAt: '2026-04-22T10:15:00',
    },
  ];
}

// ═══════════════════════════════════════════════════
// 合印拼單系統 — 學生間協作列印
// ═══════════════════════════════════════════════════

export type CoPrintStatus = 'recruiting' | 'ready' | 'printing' | 'done' | 'cancelled';

export interface CoPrintOrder {
  id: string;
  creatorId: string;
  creatorName: string;
  title: string;
  courseName?: string; // 同課堂自動配對
  files: { userId: string; fileName: string; pages: number }[];
  totalPages: number;
  totalCopies: number;
  paperSize: PaperSize;
  colorMode: ColorMode;
  duplex: boolean;
  totalPoints: number;
  perPersonPoints: number;
  targetStationId?: string;
  status: CoPrintStatus;
  maxMembers: number;
  members: { userId: string; name: string; confirmed: boolean }[];
  createdAt: string;
  printedAt?: string;
}

export function getCoPrintStatusLabel(status: CoPrintStatus): string {
  const m: Record<CoPrintStatus, string> = {
    recruiting: '招募中',
    ready: '待列印',
    printing: '列印中',
    done: '已完成',
    cancelled: '已取消',
  };
  return m[status] ?? status;
}

// 模擬合印訂單
export function simulateCoPrintOrders(): CoPrintOrder[] {
  return [
    {
      id: 'co-001',
      creatorId: 'u-101',
      creatorName: '資工系同學A',
      title: '演算法第三章講義合印',
      courseName: '演算法',
      files: [{ userId: 'u-101', fileName: 'ch3_notes.pdf', pages: 24 }],
      totalPages: 24,
      totalCopies: 4,
      paperSize: 'A4',
      colorMode: 'bw',
      duplex: true,
      totalPoints: 48,
      perPersonPoints: 12,
      targetStationId: 'LIB-1F-P1',
      status: 'recruiting',
      maxMembers: 4,
      members: [
        { userId: 'u-101', name: '同學A', confirmed: true },
        { userId: 'u-102', name: '同學B', confirmed: true },
        { userId: 'u-103', name: '同學C', confirmed: false },
      ],
      createdAt: '2026-04-24T08:00:00',
    },
    {
      id: 'co-002',
      creatorId: 'u-104',
      creatorName: '外文系同學D',
      title: '英美文學期末報告合印',
      courseName: '英美文學導讀',
      files: [{ userId: 'u-104', fileName: 'final_report.pdf', pages: 16 }],
      totalPages: 16,
      totalCopies: 6,
      paperSize: 'A4',
      colorMode: 'bw',
      duplex: true,
      totalPoints: 48,
      perPersonPoints: 8,
      status: 'done',
      maxMembers: 6,
      members: [
        { userId: 'u-104', name: '同學D', confirmed: true },
        { userId: 'u-105', name: '同學E', confirmed: true },
        { userId: 'u-106', name: '同學F', confirmed: true },
        { userId: 'u-107', name: '同學G', confirmed: true },
        { userId: 'u-108', name: '同學H', confirmed: true },
        { userId: 'u-109', name: '同學I', confirmed: true },
      ],
      createdAt: '2026-04-20T10:00:00',
      printedAt: '2026-04-20T14:00:00',
    },
  ];
}

// ═══════════════════════════════════════════════════
// 推播通知類型
// ═══════════════════════════════════════════════════

export type PrintNotificationType =
  | 'job_queued' // 任務已排隊
  | 'job_printing' // 開始列印
  | 'job_done' // 列印完成，請取件
  | 'job_expiring' // 即將過期未取件
  | 'job_failed' // 列印失敗
  | 'machine_fault' // 使用中機器故障
  | 'machine_fixed' // 故障已修復
  | 'machine_alt' // 替代機器推薦
  | 'low_balance' // 餘額偏低（< 20 點）
  | 'eco_badge' // 環保徽章獲得
  | 'eco_reward' // 環保免費點數
  | 'co_print_invite' // 合印邀請
  | 'co_print_ready' // 合印訂單就緒
  | 'quota_refresh' // 學期額度刷新
  | 'price_change' // 費率變動
  | 'system_maintenance'; // 系統維護

export interface PrintNotificationConfig {
  type: PrintNotificationType;
  label: string;
  icon: string;
  color: string;
  defaultEnabled: boolean;
  description: string;
}

export const PRINT_NOTIFICATION_TYPES: PrintNotificationConfig[] = [
  {
    type: 'job_queued',
    label: '任務排隊',
    icon: 'time-outline',
    color: '#FF9500',
    defaultEnabled: true,
    description: '列印任務已加入排隊',
  },
  {
    type: 'job_printing',
    label: '開始列印',
    icon: 'print-outline',
    color: '#5856D6',
    defaultEnabled: true,
    description: '你的文件正在列印',
  },
  {
    type: 'job_done',
    label: '列印完成',
    icon: 'checkmark-circle-outline',
    color: '#34C759',
    defaultEnabled: true,
    description: '文件已列印完成，請前往取件',
  },
  {
    type: 'job_expiring',
    label: '取件提醒',
    icon: 'alarm-outline',
    color: '#FF3B30',
    defaultEnabled: true,
    description: '列印文件即將過期，請盡快取件',
  },
  {
    type: 'job_failed',
    label: '列印失敗',
    icon: 'close-circle-outline',
    color: '#D70015',
    defaultEnabled: true,
    description: '列印失敗，點數已退還',
  },
  {
    type: 'machine_fault',
    label: '機器故障',
    icon: 'warning-outline',
    color: '#FF3B30',
    defaultEnabled: true,
    description: '你正在使用的機器發生故障',
  },
  {
    type: 'machine_fixed',
    label: '故障修復',
    icon: 'construct-outline',
    color: '#34C759',
    defaultEnabled: true,
    description: '之前故障的機器已修復',
  },
  {
    type: 'machine_alt',
    label: '替代機器',
    icon: 'swap-horizontal-outline',
    color: '#007AFF',
    defaultEnabled: true,
    description: '附近有更快的替代機器',
  },
  {
    type: 'low_balance',
    label: '餘額不足',
    icon: 'card-outline',
    color: '#FF9500',
    defaultEnabled: true,
    description: '影印卡餘額低於 20 點',
  },
  {
    type: 'eco_badge',
    label: '環保徽章',
    icon: 'ribbon-outline',
    color: '#34C759',
    defaultEnabled: true,
    description: '獲得新的環保成就徽章',
  },
  {
    type: 'eco_reward',
    label: '環保獎勵',
    icon: 'gift-outline',
    color: '#34C759',
    defaultEnabled: false,
    description: '環保積分兌換免費點數',
  },
  {
    type: 'co_print_invite',
    label: '合印邀請',
    icon: 'people-outline',
    color: '#AF52DE',
    defaultEnabled: true,
    description: '收到合印拼單邀請',
  },
  {
    type: 'co_print_ready',
    label: '合印就緒',
    icon: 'checkmark-done-outline',
    color: '#34C759',
    defaultEnabled: true,
    description: '合印訂單人數已滿可列印',
  },
  {
    type: 'quota_refresh',
    label: '額度刷新',
    icon: 'refresh-outline',
    color: '#007AFF',
    defaultEnabled: true,
    description: '新學期免費額度已發放',
  },
  {
    type: 'price_change',
    label: '費率變動',
    icon: 'cash-outline',
    color: '#FF9500',
    defaultEnabled: true,
    description: '影印卡價格或點數比率變動',
  },
  {
    type: 'system_maintenance',
    label: '系統維護',
    icon: 'settings-outline',
    color: '#3C3C43',
    defaultEnabled: true,
    description: '列印系統維護時段通知',
  },
];

// ═══════════════════════════════════════════════════
// 教師列印格式規範系統
// ═══════════════════════════════════════════════════

export interface PrintFormatRule {
  id: string;
  courseId: string;
  courseName: string;
  instructor: string;
  rules: {
    paperSize: PaperSize;
    colorMode: ColorMode;
    duplex: boolean;
    margins?: string; // e.g. "上下左右 2.54cm"
    font?: string; // e.g. "Times New Roman 12pt"
    lineSpacing?: string; // e.g. "1.5 倍行距"
    staple?: boolean;
    coverPage?: boolean;
  };
  ecoTip?: string;
  createdAt: string;
}

export const PRINT_FORMAT_RULES: PrintFormatRule[] = [
  {
    id: 'pfr-001',
    courseId: 'CS201',
    courseName: '資料結構',
    instructor: '王教授',
    rules: {
      paperSize: 'A4',
      colorMode: 'bw',
      duplex: true,
      margins: '上下左右 2.54cm',
      font: '新細明體 12pt',
      lineSpacing: '1.5 倍行距',
      staple: true,
      coverPage: true,
    },
    ecoTip: '教授鼓勵雙面列印，單面扣分',
    createdAt: '2026-02-20',
  },
  {
    id: 'pfr-002',
    courseId: 'CS401',
    courseName: '機器學習',
    instructor: '林教授',
    rules: {
      paperSize: 'A4',
      colorMode: 'bw',
      duplex: true,
      font: 'Times New Roman 12pt',
      lineSpacing: '雙倍行距',
      coverPage: true,
    },
    ecoTip: '本課程接受電子繳交，可獲額外加分',
    createdAt: '2026-02-18',
  },
  {
    id: 'pfr-003',
    courseId: 'CS102',
    courseName: '程式設計(一)',
    instructor: '張教授',
    rules: {
      paperSize: 'A4',
      colorMode: 'bw',
      duplex: false,
      font: 'Courier New 10pt（程式碼）',
      lineSpacing: '單倍行距',
      coverPage: false,
    },
    ecoTip: '程式碼作業請用等寬字體，方便閱讀',
    createdAt: '2026-02-15',
  },
];

export function getFormatRuleByCourse(courseName: string): PrintFormatRule | undefined {
  return PRINT_FORMAT_RULES.find((r) => r.courseName.includes(courseName));
}

// ═══════════════════════════════════════════════════
// 影印店比價系統
// ═══════════════════════════════════════════════════

export interface CopyShopPrice {
  shopId: string;
  shopName: string;
  location: string;
  items: {
    service: string;
    price: string;
    note?: string;
  }[];
  serviceHours: string;
  phone?: string;
  features: string[];
}

export const COPY_SHOP_PRICES: CopyShopPrice[] = [
  {
    shopId: 'lib',
    shopName: '蓋夏圖書館（自助）',
    location: '蓋夏圖書館 B1~9F',
    items: [
      { service: 'A4 黑白', price: '$0.92/張', note: '1 點 ≈ $0.92' },
      { service: 'A3 黑白', price: '$1.83/張', note: '2 點' },
      { service: '掃描', price: '免費', note: 'B1/1F 支援' },
    ],
    serviceHours: '週一~五 08:00–21:00 / 週六日 10:00–16:00',
    features: ['自助操作', '雲端列印', '掃描至 USB'],
  },
  {
    shopId: 'campus_shop',
    shopName: '校內影印店',
    location: '濟時樓旁',
    items: [
      { service: 'A4 黑白', price: '$1/張' },
      { service: 'A4 彩色', price: '$5/張' },
      { service: 'A3 黑白', price: '$2/張' },
      { service: 'A3 彩色', price: '$10/張' },
      { service: '膠裝', price: '$30/本' },
      { service: '精裝', price: '$80/本' },
      { service: '護貝 A4', price: '$15/張' },
      { service: '海報 A1', price: '$120/張' },
    ],
    serviceHours: '週一~五 08:30–18:00',
    phone: '0912-345-678',
    features: ['彩色列印', '裝訂', '護貝', '大圖輸出', '急件'],
  },
  {
    shopId: 'cs_dept',
    shopName: '資工系辦多功能機',
    location: '伯鐸樓 5F',
    items: [
      { service: 'A4 黑白', price: '免費', note: '系所額度內' },
      { service: 'A4 彩色', price: '$3/張', note: '系所額度外' },
      { service: '掃描', price: '免費' },
    ],
    serviceHours: '週一~五 09:00–17:00',
    features: ['彩色', '掃描至 Email', '限系上師生'],
  },
];
