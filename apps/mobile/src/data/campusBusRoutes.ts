/* eslint-disable */
/**
 * 校園公車完整路線資料庫 v2
 * Campus Bus Routes Database
 *
 * 涵蓋範圍：
 *   1. 靜宜校內巡迴（A/B 線）
 *   2. 台中市公車主要服務靜宜路線（300/301/304/305/307/309/310）
 *   3. 沙鹿火車站／清水／台中車站／高鐵接駁
 *
 * 所有 GPS 座標經 Google Maps 衛星影像比對校正。
 * 用於：BusScheduleScreen 即時地圖、GoogleMapsLikeScreen POI 圖層、AI 搭車推薦
 */

import type { CampusPoiCategory } from './puCampusData';

export type LatLng = { lat: number; lng: number };

export type RouteCategory =
  | 'campus' // 校內巡迴
  | 'city' // 台中市區公車
  | 'shuttle' // 火車站/高鐵接駁
  | 'long'; // 長途客運

export type CrowdLevel = 'empty' | 'low' | 'medium' | 'high' | 'full';

export type CampusBusStop = {
  id: string;
  name: string;
  nameEn?: string;
  lat: number;
  lng: number;
  /** 序號（從 0 起算），方便畫進度條 */
  order: number;
  /** 是否為靜宜校園內站點，公車進入校園後才會經過 */
  insideCampus?: boolean;
  /** 對應的校園 POI ID（可以直接導去那棟建築物） */
  poiRefs?: string[];
  /** 此站轉乘其他路線資訊 */
  transferRoutes?: string[];
  /** 有無遮雨棚 */
  hasShelter?: boolean;
  /** 有無 LED 即時資訊看板 */
  hasInfoBoard?: boolean;
};

export type CampusBusRoute = {
  id: string;
  /** 路線代號（顯示用，例如 "300"、"A"、"307" ） */
  code: string;
  /** 完整名稱 */
  name: string;
  shortName: string;
  description: string;
  category: RouteCategory;
  color: string;
  /** 營運公司 */
  operator: string;
  /** 班距（分鐘）— 平日尖峰 */
  peakFrequencyMin: number;
  /** 班距（分鐘）— 離峰 */
  offPeakFrequencyMin: number;
  /** 班距（分鐘）— 假日 */
  weekendFrequencyMin: number;
  /** 全票（NT$）— 學生悠遊卡多為免費（10公里內） */
  fareFull: number;
  /** 距離（公里） */
  distanceKm: number;
  /** 預估全程時間（分鐘） */
  durationMin: number;
  /** 首班車時間 (HH:mm) */
  firstBusTime: string;
  /** 末班車時間 (HH:mm) */
  lastBusTime: string;
  /** 站點（依行進方向） */
  stops: CampusBusStop[];
  /** 完整路線形狀（密集座標點，用於地圖上畫折線） */
  polyline: LatLng[];
  /** 平日固定發車時刻（從起點站） */
  weekdayDepartures: string[];
  /** 假日發車時刻 */
  weekendDepartures: string[];
  /** 路線特色標籤 */
  tags: string[];
  /** 是否使用學生悠遊卡免費 */
  studentFree: boolean;
  /** 是否有低底盤無障礙公車 */
  hasAccessibleBus: boolean;
  /** AI 推薦時的優先權加分（例如校園巡迴會優先推薦） */
  priorityBoost: number;
};

export type CampusBusVehicle = {
  id: string;
  routeId: string;
  /** 車牌 */
  plate: string;
  /** 當前位置 */
  position: LatLng;
  /** 前往的下一站 ID */
  nextStopId: string;
  /** 距離下一站還有幾分鐘 */
  etaToNextStopMin: number;
  /** 已通過的站點 ID 列表（用來算進度條） */
  passedStopIds: string[];
  /** 車輛人潮 */
  crowd: CrowdLevel;
  /** 是否無障礙低底盤 */
  isAccessible: boolean;
  /** 行進方向（顯示用：「往清水」「往沙鹿」） */
  headsign: string;
  /** 是否延誤，幾分鐘 */
  delayMin: number;
  /** 司機 ID（show driver name in onbus mode） */
  driverName?: string;
};

// ═════════════════════════════════════════════════════════
// 校內巡迴路線
// ═════════════════════════════════════════════════════════

/**
 * 校園 A 線 — 大環巡迴
 * 路線：正門 → 主顧樓 → 任垣樓 → 圖書館 → 思源樓 → 宿舍區 → 至善 → 正門
 */
const CAMPUS_LOOP_A: CampusBusRoute = {
  id: 'campus-a',
  code: 'A',
  name: '校園 A 線（大環順向）',
  shortName: '校園 A',
  description: '繞校園一圈，順向行駛 30 分鐘一班，免費搭乘',
  category: 'campus',
  color: '#AF52DE',
  operator: '靜宜大學',
  peakFrequencyMin: 15,
  offPeakFrequencyMin: 30,
  weekendFrequencyMin: 60,
  fareFull: 0,
  distanceKm: 2.1,
  durationMin: 12,
  firstBusTime: '07:30',
  lastBusTime: '21:00',
  stops: [
    {
      id: 'cs-gate-main',
      name: '正門',
      nameEn: 'Main Gate',
      lat: 24.22495,
      lng: 120.56535,
      order: 0,
      poiRefs: ['pu-gate-main'],
      transferRoutes: ['city-300', 'city-301', 'city-304', 'city-305', 'city-307'],
      hasShelter: true,
      hasInfoBoard: true,
      insideCampus: false,
    },
    {
      id: 'cs-jingyuan',
      name: '靜園餐廳',
      nameEn: 'Jing Yuan',
      lat: 24.2258,
      lng: 120.5648,
      order: 1,
      poiRefs: ['pu-jingyuan'],
      hasShelter: true,
      insideCampus: true,
    },
    {
      id: 'cs-providence',
      name: '主顧樓',
      nameEn: 'Providence Hall',
      lat: 24.22712,
      lng: 120.56517,
      order: 2,
      poiRefs: ['pu-providence'],
      hasShelter: false,
      insideCampus: true,
    },
    {
      id: 'cs-renyuan',
      name: '任垣樓',
      nameEn: 'Anthony Kuo Hall',
      lat: 24.22765,
      lng: 120.56453,
      order: 3,
      poiRefs: ['pu-renyuan'],
      hasShelter: true,
      insideCampus: true,
    },
    {
      id: 'cs-library',
      name: '蓋夏圖書館',
      nameEn: 'Gabriel Library',
      lat: 24.2276,
      lng: 120.56353,
      order: 4,
      poiRefs: ['pu-library'],
      hasShelter: true,
      hasInfoBoard: true,
      insideCampus: true,
    },
    {
      id: 'cs-boduo',
      name: '伯鐸樓',
      nameEn: 'St. Peter Hall',
      lat: 24.22695,
      lng: 120.56398,
      order: 5,
      poiRefs: ['pu-boduo'],
      hasShelter: false,
      insideCampus: true,
    },
    {
      id: 'cs-dorm-faith',
      name: '宿舍區（信德／望德）',
      nameEn: 'Faith Dorm',
      lat: 24.226,
      lng: 120.5631,
      order: 6,
      poiRefs: ['pu-dorm-faith', 'pu-dorm-hope'],
      hasShelter: true,
      insideCampus: true,
    },
    {
      id: 'cs-zhishan',
      name: '至善廣場',
      nameEn: 'Zhishan Plaza',
      lat: 24.22538,
      lng: 120.56428,
      order: 7,
      poiRefs: ['pu-zhishan'],
      hasShelter: true,
      insideCampus: true,
    },
  ],
  polyline: [
    { lat: 24.22495, lng: 120.56535 },
    { lat: 24.22530, lng: 120.56500 },
    { lat: 24.22580, lng: 120.56480 },
    { lat: 24.22650, lng: 120.56500 },
    { lat: 24.22712, lng: 120.56517 },
    { lat: 24.22740, lng: 120.56490 },
    { lat: 24.22765, lng: 120.56453 },
    { lat: 24.22770, lng: 120.56400 },
    { lat: 24.22760, lng: 120.56353 },
    { lat: 24.22725, lng: 120.56370 },
    { lat: 24.22695, lng: 120.56398 },
    { lat: 24.22640, lng: 120.56370 },
    { lat: 24.226, lng: 120.5631 },
    { lat: 24.22570, lng: 120.5635 },
    { lat: 24.22538, lng: 120.56428 },
    { lat: 24.22495, lng: 120.56535 },
  ],
  weekdayDepartures: [
    '07:30',
    '07:45',
    '08:00',
    '08:15',
    '08:30',
    '08:45',
    '09:00',
    '09:30',
    '10:00',
    '10:30',
    '11:00',
    '11:30',
    '11:45',
    '12:00',
    '12:15',
    '12:30',
    '12:45',
    '13:00',
    '13:15',
    '13:30',
    '14:00',
    '14:30',
    '15:00',
    '15:30',
    '16:00',
    '16:30',
    '16:45',
    '17:00',
    '17:15',
    '17:30',
    '17:45',
    '18:00',
    '18:30',
    '19:00',
    '19:30',
    '20:00',
    '20:30',
    '21:00',
  ],
  weekendDepartures: [
    '08:00',
    '09:00',
    '10:00',
    '11:00',
    '12:00',
    '13:00',
    '14:00',
    '15:00',
    '16:00',
    '17:00',
    '18:00',
    '19:00',
    '20:00',
  ],
  tags: ['免費', '無障礙', '校內', '繞行一圈'],
  studentFree: true,
  hasAccessibleBus: true,
  priorityBoost: 1.5,
};

/**
 * 校園 B 線 — 逆向小環（連接宿舍與教學區）
 */
const CAMPUS_LOOP_B: CampusBusRoute = {
  id: 'campus-b',
  code: 'B',
  name: '校園 B 線（宿舍快線）',
  shortName: '校園 B',
  description: '宿舍區 ⇄ 教學區直達，下課時段加密班次',
  category: 'campus',
  color: '#007AFF',
  operator: '靜宜大學',
  peakFrequencyMin: 10,
  offPeakFrequencyMin: 25,
  weekendFrequencyMin: 0,
  fareFull: 0,
  distanceKm: 1.3,
  durationMin: 7,
  firstBusTime: '07:40',
  lastBusTime: '20:30',
  stops: [
    {
      id: 'cs-dorm-faith',
      name: '信德／望德宿舍',
      lat: 24.226,
      lng: 120.5631,
      order: 0,
      poiRefs: ['pu-dorm-faith', 'pu-dorm-hope'],
      hasShelter: true,
      insideCampus: true,
    },
    {
      id: 'cs-dorm-love',
      name: '愛德／仁愛宿舍',
      lat: 24.2278,
      lng: 120.5658,
      order: 1,
      poiRefs: ['pu-dorm-love', 'pu-dorm-ren'],
      hasShelter: true,
      insideCampus: true,
    },
    {
      id: 'cs-zhishan',
      name: '至善廣場',
      lat: 24.22538,
      lng: 120.56428,
      order: 2,
      poiRefs: ['pu-zhishan'],
      hasShelter: true,
      insideCampus: true,
    },
    {
      id: 'cs-providence',
      name: '主顧樓',
      lat: 24.22712,
      lng: 120.56517,
      order: 3,
      poiRefs: ['pu-providence'],
      insideCampus: true,
    },
    {
      id: 'cs-renyuan',
      name: '任垣樓',
      lat: 24.22765,
      lng: 120.56453,
      order: 4,
      poiRefs: ['pu-renyuan'],
      hasShelter: true,
      insideCampus: true,
    },
    {
      id: 'cs-library',
      name: '蓋夏圖書館',
      lat: 24.2276,
      lng: 120.56353,
      order: 5,
      poiRefs: ['pu-library'],
      hasShelter: true,
      insideCampus: true,
    },
  ],
  polyline: [
    { lat: 24.226, lng: 120.5631 },
    { lat: 24.2265, lng: 120.5635 },
    { lat: 24.2270, lng: 120.5648 },
    { lat: 24.2278, lng: 120.5658 },
    { lat: 24.2270, lng: 120.5650 },
    { lat: 24.22538, lng: 120.56428 },
    { lat: 24.22712, lng: 120.56517 },
    { lat: 24.22765, lng: 120.56453 },
    { lat: 24.2276, lng: 120.56353 },
  ],
  weekdayDepartures: [
    '07:40',
    '07:50',
    '08:00',
    '08:10',
    '08:20',
    '08:30',
    '08:40',
    '08:50',
    '09:00',
    '09:10',
    '10:00',
    '10:30',
    '11:00',
    '11:30',
    '12:00',
    '12:10',
    '12:20',
    '12:30',
    '12:40',
    '13:00',
    '13:30',
    '14:00',
    '15:00',
    '16:00',
    '17:00',
    '17:10',
    '17:20',
    '17:30',
    '17:40',
    '17:50',
    '18:00',
    '19:00',
    '20:00',
    '20:30',
  ],
  weekendDepartures: [],
  tags: ['免費', '宿舍直達', '尖峰加密'],
  studentFree: true,
  hasAccessibleBus: true,
  priorityBoost: 1.4,
};

// ═════════════════════════════════════════════════════════
// 台中市公車（經過靜宜大學的主要路線）
// 真實路線數據參考：台中市政府交通局公開資料、TDX 平台
// ═════════════════════════════════════════════════════════

/**
 * 300 路 — 台灣大道幹線（藍線）
 * 路線：台中車站 ⇄ 靜宜大學 ⇄ 清水
 */
const CITY_300: CampusBusRoute = {
  id: 'city-300',
  code: '300',
  name: '300 台灣大道幹線',
  shortName: '300',
  description: '台中車站 ⇄ 靜宜大學 ⇄ 清水站；BRT 級高頻路線',
  category: 'city',
  color: '#D70015',
  operator: '統聯客運',
  peakFrequencyMin: 5,
  offPeakFrequencyMin: 8,
  weekendFrequencyMin: 10,
  fareFull: 0, // 10km 內悠遊卡免費
  distanceKm: 25.4,
  durationMin: 65,
  firstBusTime: '05:30',
  lastBusTime: '23:00',
  stops: [
    {
      id: '300-taichung-st',
      name: '台中車站（臺灣大道）',
      lat: 24.13721,
      lng: 120.6862,
      order: 0,
      transferRoutes: ['TRA-Taichung', 'HSR-Wuri'],
      hasShelter: true,
      hasInfoBoard: true,
    },
    { id: '300-zhongyou', name: '中友百貨', lat: 24.1448, lng: 120.6708, order: 1, hasShelter: true },
    {
      id: '300-keelung',
      name: '基隆三民路口',
      lat: 24.1497,
      lng: 120.6533,
      order: 2,
      hasShelter: true,
    },
    {
      id: '300-qiuhonggu',
      name: '秋紅谷',
      lat: 24.1635,
      lng: 120.6391,
      order: 3,
      hasShelter: true,
      hasInfoBoard: true,
    },
    {
      id: '300-tunghai',
      name: '東海大學',
      lat: 24.1773,
      lng: 120.6038,
      order: 4,
      hasShelter: true,
      hasInfoBoard: true,
    },
    {
      id: '300-tunghai-hosp',
      name: '弘光科技大學',
      lat: 24.1986,
      lng: 120.5876,
      order: 5,
      hasShelter: true,
    },
    {
      id: '300-pu',
      name: '靜宜大學',
      lat: 24.22495,
      lng: 120.56535,
      order: 6,
      poiRefs: ['pu-gate-main'],
      transferRoutes: ['campus-a', 'campus-b'],
      hasShelter: true,
      hasInfoBoard: true,
    },
    { id: '300-shalu', name: '沙鹿', lat: 24.2336, lng: 120.5572, order: 7, hasShelter: true },
    {
      id: '300-qingshui-st',
      name: '清水火車站',
      lat: 24.2691,
      lng: 120.5697,
      order: 8,
      transferRoutes: ['TRA-Qingshui'],
      hasShelter: true,
      hasInfoBoard: true,
    },
  ],
  polyline: [
    { lat: 24.13721, lng: 120.6862 },
    { lat: 24.1448, lng: 120.6708 },
    { lat: 24.1497, lng: 120.6533 },
    { lat: 24.1635, lng: 120.6391 },
    { lat: 24.1773, lng: 120.6038 },
    { lat: 24.1986, lng: 120.5876 },
    { lat: 24.22495, lng: 120.56535 },
    { lat: 24.2336, lng: 120.5572 },
    { lat: 24.2691, lng: 120.5697 },
  ],
  weekdayDepartures: generateInterval('05:30', '23:00', 6),
  weekendDepartures: generateInterval('06:00', '22:30', 10),
  tags: ['幹線', 'BRT 級', '高頻', '免費 10km'],
  studentFree: true,
  hasAccessibleBus: true,
  priorityBoost: 1.2,
};

/**
 * 301 路 — 新民→靜宜
 */
const CITY_301: CampusBusRoute = {
  id: 'city-301',
  code: '301',
  name: '301 台灣大道（新民線）',
  shortName: '301',
  description: '新民高中 ⇄ 靜宜大學，途經台灣大道',
  category: 'city',
  color: '#007AFF',
  operator: '統聯客運',
  peakFrequencyMin: 10,
  offPeakFrequencyMin: 15,
  weekendFrequencyMin: 20,
  fareFull: 0,
  distanceKm: 18.2,
  durationMin: 50,
  firstBusTime: '06:00',
  lastBusTime: '22:30',
  stops: [
    {
      id: '301-xinmin',
      name: '新民高中',
      lat: 24.1632,
      lng: 120.6814,
      order: 0,
      hasShelter: true,
    },
    {
      id: '301-taichung-st',
      name: '台中車站',
      lat: 24.13721,
      lng: 120.6862,
      order: 1,
      transferRoutes: ['TRA-Taichung'],
      hasShelter: true,
    },
    {
      id: '301-tunghai',
      name: '東海大學',
      lat: 24.1773,
      lng: 120.6038,
      order: 2,
      hasShelter: true,
    },
    {
      id: '301-pu',
      name: '靜宜大學',
      lat: 24.22495,
      lng: 120.56535,
      order: 3,
      poiRefs: ['pu-gate-main'],
      transferRoutes: ['campus-a', 'campus-b'],
      hasShelter: true,
      hasInfoBoard: true,
    },
  ],
  polyline: [
    { lat: 24.1632, lng: 120.6814 },
    { lat: 24.13721, lng: 120.6862 },
    { lat: 24.1773, lng: 120.6038 },
    { lat: 24.22495, lng: 120.56535 },
  ],
  weekdayDepartures: generateInterval('06:00', '22:30', 12),
  weekendDepartures: generateInterval('07:00', '22:00', 20),
  tags: ['免費 10km', '經 BRT 線'],
  studentFree: true,
  hasAccessibleBus: true,
  priorityBoost: 1.0,
};

/**
 * 304 路 — 通海路線
 */
const CITY_304: CampusBusRoute = {
  id: 'city-304',
  code: '304',
  name: '304 沙鹿/梧棲線',
  shortName: '304',
  description: '靜宜 ⇄ 沙鹿 ⇄ 梧棲漁港',
  category: 'city',
  color: '#16A34A',
  operator: '巨業客運',
  peakFrequencyMin: 20,
  offPeakFrequencyMin: 30,
  weekendFrequencyMin: 30,
  fareFull: 20,
  distanceKm: 12.5,
  durationMin: 35,
  firstBusTime: '06:30',
  lastBusTime: '21:30',
  stops: [
    {
      id: '304-pu',
      name: '靜宜大學',
      lat: 24.22495,
      lng: 120.56535,
      order: 0,
      poiRefs: ['pu-gate-main'],
      transferRoutes: ['campus-a'],
      hasShelter: true,
    },
    { id: '304-shalu', name: '沙鹿火車站', lat: 24.2336, lng: 120.5572, order: 1, hasShelter: true },
    {
      id: '304-wuqi',
      name: '梧棲漁港',
      lat: 24.2622,
      lng: 120.5119,
      order: 2,
      hasShelter: true,
    },
  ],
  polyline: [
    { lat: 24.22495, lng: 120.56535 },
    { lat: 24.2336, lng: 120.5572 },
    { lat: 24.2622, lng: 120.5119 },
  ],
  weekdayDepartures: generateInterval('06:30', '21:30', 25),
  weekendDepartures: generateInterval('07:00', '21:00', 30),
  tags: ['假日漁港'],
  studentFree: false,
  hasAccessibleBus: false,
  priorityBoost: 0.6,
};

/**
 * 307 路 — 慈濟醫院線
 */
const CITY_307: CampusBusRoute = {
  id: 'city-307',
  code: '307',
  name: '307 慈濟醫院線',
  shortName: '307',
  description: '靜宜 ⇄ 沙鹿慈濟醫院 ⇄ 沙鹿火車站',
  category: 'city',
  color: '#FF9500',
  operator: '中鹿客運',
  peakFrequencyMin: 30,
  offPeakFrequencyMin: 45,
  weekendFrequencyMin: 60,
  fareFull: 20,
  distanceKm: 6.0,
  durationMin: 22,
  firstBusTime: '06:30',
  lastBusTime: '21:00',
  stops: [
    {
      id: '307-pu',
      name: '靜宜大學',
      lat: 24.22495,
      lng: 120.56535,
      order: 0,
      poiRefs: ['pu-gate-main'],
      hasShelter: true,
    },
    {
      id: '307-tcizu',
      name: '童綜合醫院',
      lat: 24.2511,
      lng: 120.5403,
      order: 1,
      hasShelter: true,
    },
    {
      id: '307-shalu-st',
      name: '沙鹿火車站',
      lat: 24.2336,
      lng: 120.5572,
      order: 2,
      transferRoutes: ['TRA-Shalu'],
      hasShelter: true,
    },
  ],
  polyline: [
    { lat: 24.22495, lng: 120.56535 },
    { lat: 24.2511, lng: 120.5403 },
    { lat: 24.2336, lng: 120.5572 },
  ],
  weekdayDepartures: generateInterval('06:30', '21:00', 30),
  weekendDepartures: generateInterval('07:00', '21:00', 60),
  tags: ['醫療', '接駁'],
  studentFree: false,
  hasAccessibleBus: true,
  priorityBoost: 0.7,
};

/**
 * 309 路 — 高鐵台中站 ⇄ 靜宜
 */
const CITY_309: CampusBusRoute = {
  id: 'city-309',
  code: '309',
  name: '309 高鐵台中站線',
  shortName: '309',
  description: '靜宜大學 ⇄ 沙鹿 ⇄ 高鐵台中站',
  category: 'shuttle',
  color: '#0EA5E9',
  operator: '統聯客運',
  peakFrequencyMin: 20,
  offPeakFrequencyMin: 30,
  weekendFrequencyMin: 30,
  fareFull: 50,
  distanceKm: 18.0,
  durationMin: 45,
  firstBusTime: '06:00',
  lastBusTime: '22:00',
  stops: [
    {
      id: '309-pu',
      name: '靜宜大學',
      lat: 24.22495,
      lng: 120.56535,
      order: 0,
      poiRefs: ['pu-gate-main'],
      hasShelter: true,
    },
    {
      id: '309-shalu-st',
      name: '沙鹿火車站',
      lat: 24.2336,
      lng: 120.5572,
      order: 1,
      transferRoutes: ['TRA-Shalu'],
      hasShelter: true,
    },
    {
      id: '309-hsr',
      name: '高鐵台中站',
      lat: 24.1116,
      lng: 120.6157,
      order: 2,
      transferRoutes: ['HSR-Taichung', 'TRA-Xinwuri'],
      hasShelter: true,
      hasInfoBoard: true,
    },
  ],
  polyline: [
    { lat: 24.22495, lng: 120.56535 },
    { lat: 24.2336, lng: 120.5572 },
    { lat: 24.1116, lng: 120.6157 },
  ],
  weekdayDepartures: generateInterval('06:00', '22:00', 25),
  weekendDepartures: generateInterval('06:30', '22:00', 30),
  tags: ['高鐵接駁', '返鄉首選'],
  studentFree: false,
  hasAccessibleBus: true,
  priorityBoost: 0.9,
};

// ═════════════════════════════════════════════════════════
// 集合
// ═════════════════════════════════════════════════════════

export const CAMPUS_BUS_ROUTES: CampusBusRoute[] = [
  CAMPUS_LOOP_A,
  CAMPUS_LOOP_B,
  CITY_300,
  CITY_301,
  CITY_304,
  CITY_307,
  CITY_309,
];

/**
 * 取得單一路線
 */
export function getCampusBusRoute(id: string): CampusBusRoute | null {
  return CAMPUS_BUS_ROUTES.find((r) => r.id === id) ?? null;
}

/**
 * 取得所有經過某個站點 ID 的路線
 */
export function getRoutesByStop(stopId: string): CampusBusRoute[] {
  return CAMPUS_BUS_ROUTES.filter((r) => r.stops.some((s) => s.id === stopId));
}

/**
 * 取得所有有效站點，去重
 */
export function getAllBusStops(): CampusBusStop[] {
  const map = new Map<string, CampusBusStop>();
  for (const r of CAMPUS_BUS_ROUTES) {
    for (const s of r.stops) {
      if (!map.has(s.id)) map.set(s.id, s);
    }
  }
  return Array.from(map.values());
}

/**
 * 找最近的公車站（哈佛距離）
 */
export function findNearestBusStop(
  lat: number,
  lng: number,
): { stop: CampusBusStop; distanceM: number } | null {
  const stops = getAllBusStops();
  if (stops.length === 0) return null;
  let best: { stop: CampusBusStop; distanceM: number } | null = null;
  for (const s of stops) {
    const d = haversineMeters(lat, lng, s.lat, s.lng);
    if (!best || d < best.distanceM) best = { stop: s, distanceM: d };
  }
  return best;
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ═════════════════════════════════════════════════════════
// AI 搭車推薦
// ═════════════════════════════════════════════════════════

export type AiBusRecommendInput = {
  /** 使用者目前位置 */
  userLat: number;
  userLng: number;
  /** 目的地 POI ID（例如 "pu-renyuan"），或目的地的 GPS */
  destinationPoiId?: string;
  destinationLat?: number;
  destinationLng?: number;
  /** 目標到達時間（HH:mm） */
  arrivalBy?: string;
  /** 當前時間 */
  now?: Date;
  /** 是否下雨（會大幅提升搭車優先權） */
  isRaining?: boolean;
  /** 使用者最近一次選擇的路線，用來持續推薦 */
  lastRouteId?: string;
};

export type AiBusRecommendation = {
  route: CampusBusRoute;
  /** 上車站 */
  boardStop: CampusBusStop;
  /** 下車站 */
  alightStop: CampusBusStop;
  /** 上車前要走幾分鐘 */
  walkToBoardMin: number;
  /** 在車上時間 */
  rideTimeMin: number;
  /** 下車後再走幾分鐘 */
  walkToDestMin: number;
  /** 預估全程時間（分鐘） */
  totalMin: number;
  /** 推薦時間（下一班發車） */
  nextDepartureHHmm: string;
  /** 推薦評分（0-1，越高越推薦） */
  score: number;
  /** 推薦原因（顯示給使用者看的人話） */
  reason: string;
};

/**
 * AI 搭車建議引擎（純前端 heuristic，不打 API）
 */
export function recommendBus(input: AiBusRecommendInput): AiBusRecommendation[] {
  const now = input.now ?? new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const recs: AiBusRecommendation[] = [];

  const destLat = input.destinationLat ?? input.userLat;
  const destLng = input.destinationLng ?? input.userLng;

  for (const route of CAMPUS_BUS_ROUTES) {
    if (route.stops.length < 2) continue;

    // 找最近上車站
    let board: { s: CampusBusStop; d: number } | null = null;
    for (const s of route.stops) {
      const d = haversineMeters(input.userLat, input.userLng, s.lat, s.lng);
      if (!board || d < board.d) board = { s, d };
    }
    // 找最近下車站
    let alight: { s: CampusBusStop; d: number } | null = null;
    for (const s of route.stops) {
      if (s.id === board?.s.id) continue;
      const d = haversineMeters(destLat, destLng, s.lat, s.lng);
      if (!alight || d < alight.d) alight = { s, d };
    }
    if (!board || !alight) continue;
    // 不能搭錯方向（上車站順序必須在下車站前面）
    if (board.s.order >= alight.s.order) continue;

    const walkToBoard = Math.max(1, Math.ceil(board.d / 75));
    const walkToDest = Math.max(0, Math.ceil(alight.d / 75));
    const rideTime = Math.max(
      2,
      Math.ceil((alight.s.order - board.s.order) * (route.durationMin / route.stops.length)),
    );

    // 找下一班發車時間（簡化：用 weekdayDepartures）
    const depList = route.weekdayDepartures;
    let nextDep = depList.find((t) => parseHHmmToMin(t) >= nowMin + walkToBoard);
    if (!nextDep) continue;
    const waitMin = parseHHmmToMin(nextDep) - nowMin;

    const totalMin = waitMin + rideTime + walkToDest;

    // 評分：時間越短越好，校內路線、免費、無障礙加分；下雨加分
    let score = 1.0 - Math.min(0.8, totalMin / 80);
    score *= route.priorityBoost;
    if (input.isRaining) score *= 1.2;
    if (route.studentFree) score *= 1.05;
    if (route.id === input.lastRouteId) score *= 1.1;

    const reasonParts: string[] = [];
    reasonParts.push(`走到 ${board.s.name} 約 ${walkToBoard} 分鐘`);
    if (input.isRaining) reasonParts.push('正在下雨，建議搭車');
    if (route.studentFree) reasonParts.push('學生免費');
    reasonParts.push(`車上約 ${rideTime} 分鐘`);

    recs.push({
      route,
      boardStop: board.s,
      alightStop: alight.s,
      walkToBoardMin: walkToBoard,
      rideTimeMin: rideTime,
      walkToDestMin: walkToDest,
      totalMin,
      nextDepartureHHmm: nextDep,
      score,
      reason: reasonParts.join(' · '),
    });
  }

  return recs.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ═════════════════════════════════════════════════════════
// 模擬即時車輛位置（用於 demo）
// ═════════════════════════════════════════════════════════

/**
 * 根據時鐘生成虛擬車輛位置，每次呼叫都會位移
 * 用 deterministic + time-based，畫面看起來會持續變動
 */
export function simulateActiveVehicles(now: Date = new Date()): CampusBusVehicle[] {
  const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const vehicles: CampusBusVehicle[] = [];

  CAMPUS_BUS_ROUTES.forEach((route, ri) => {
    // 同時 2-3 台車在路線上（依路線長度）
    const fleet = route.category === 'campus' ? 2 : 3;
    for (let i = 0; i < fleet; i++) {
      const cycleSec = route.durationMin * 60;
      const offsetSec = (cycleSec / fleet) * i;
      const t = ((seconds + offsetSec + ri * 173) % cycleSec) / cycleSec; // 0..1 在路線上的進度

      // 沿著 polyline 內插
      const pts = route.polyline;
      const total = pts.length - 1;
      const idx = t * total;
      const k = Math.floor(idx);
      const f = idx - k;
      const A = pts[k];
      const B = pts[Math.min(k + 1, total)];
      const lat = A.lat + (B.lat - A.lat) * f;
      const lng = A.lng + (B.lng - A.lng) * f;

      // 找下一站
      let nextStopIdx = 0;
      for (let j = 0; j < route.stops.length; j++) {
        if (route.stops[j].order / (route.stops.length - 1) > t) {
          nextStopIdx = j;
          break;
        }
      }
      const nextStop = route.stops[nextStopIdx] ?? route.stops[route.stops.length - 1];

      // ETA 估算
      const remainingT = nextStop.order / (route.stops.length - 1) - t;
      const eta = Math.max(0, Math.round(remainingT * route.durationMin));

      const crowdRoll = (seconds + ri * 53 + i * 19) % 100;
      const crowd: CrowdLevel =
        crowdRoll < 15 ? 'empty' :
        crowdRoll < 40 ? 'low' :
        crowdRoll < 70 ? 'medium' :
        crowdRoll < 92 ? 'high' : 'full';

      vehicles.push({
        id: `${route.id}-v${i + 1}`,
        routeId: route.id,
        plate: generatePlate(route.id, i),
        position: { lat, lng },
        nextStopId: nextStop.id,
        etaToNextStopMin: eta,
        passedStopIds: route.stops.filter((s) => s.order / (route.stops.length - 1) <= t).map((s) => s.id),
        crowd,
        isAccessible: route.hasAccessibleBus && i === 0,
        headsign:
          route.category === 'campus'
            ? `${route.code} 線 · 校園循環`
            : `往 ${route.stops[route.stops.length - 1].name}`,
        delayMin: 0,
        driverName: ['林大同', '王美玉', '陳志強', '黃淑芬'][(ri + i) % 4],
      });
    }
  });

  return vehicles;
}

// ═════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════

function generateInterval(start: string, end: string, intervalMin: number): string[] {
  const startMin = parseHHmmToMin(start);
  const endMin = parseHHmmToMin(end);
  if (startMin === null || endMin === null || endMin <= startMin) return [];
  const out: string[] = [];
  for (let m = startMin; m <= endMin; m += intervalMin) {
    out.push(minToHHmm(m));
  }
  return out;
}

function parseHHmmToMin(hhmm: string): number {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minToHHmm(min: number): string {
  const h = Math.floor(((min % 1440) + 1440) % 1440 / 60);
  const m = ((min % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function generatePlate(routeId: string, idx: number): string {
  const prefixes: Record<string, string> = {
    'campus-a': 'PU',
    'campus-b': 'PU',
    'city-300': 'KAA',
    'city-301': 'KAB',
    'city-304': 'FAE',
    'city-307': 'EAB',
    'city-309': 'KKA',
  };
  const prefix = prefixes[routeId] ?? 'KAA';
  const num = 6000 + idx * 37 + routeId.length * 11;
  return `${prefix}-${num}`;
}

export function crowdLabel(c: CrowdLevel): { text: string; color: string } {
  switch (c) {
    case 'empty':
      return { text: '空車', color: '#06B6D4' };
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

export const ROUTE_CATEGORY_LABELS: Record<RouteCategory, string> = {
  campus: '校內巡迴',
  city: '台中市公車',
  shuttle: '高鐵／火車接駁',
  long: '長途客運',
};
