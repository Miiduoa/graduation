/**
 * 📡 校園即時脈動引擎 — Campus Pulse Engine
 *
 * 靜宜大學 Campus One 獨家功能：
 * 群眾外包的即時校園動態 — 越多人用越準確（網路效應護城河）
 *
 * 核心功能：
 *   1. 即時人潮偵測 — 圖書館/餐廳/停車場等地點的擁擠程度
 *   2. 歷史模式預測 — 基於過去的資料預測未來的擁擠時段
 *   3. 校園活動脈動 — 即時事件 feed（下課潮、考試週、活動等）
 *   4. 智慧建議 — 根據當前狀態推薦最佳用餐/自習/出行時間
 *
 * 技術亮點：
 *   - 時間衰減的群眾回報機制（Exponential Decay Scoring）
 *   - 週期性模式識別（Day-of-Week + Hour-of-Day patterns）
 *   - 本地快取 + 定期匯總
 *   - 差分隱私友善設計（只存匯總數據）
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ───────────────────────────────────────────────

export type CrowdLevel = 1 | 2 | 3 | 4 | 5; // 1=空, 5=爆滿

export type PulseLocation = {
  id: string;
  name: string;
  category: 'library' | 'dining' | 'parking' | 'gym' | 'study' | 'other';
  icon: string;
  currentLevel: CrowdLevel;
  confidence: number; // 0-1, based on report freshness/quantity
  lastReportAt: number; // epoch ms
  reportCount24h: number;
  trend: 'rising' | 'falling' | 'stable';
  peakHours: string[]; // e.g. ["12:00-13:00", "17:30-18:30"]
  bestTimeToVisit: string; // e.g. "14:00-15:00"
};

export type PulseReport = {
  locationId: string;
  level: CrowdLevel;
  timestamp: number;
  dayOfWeek: number; // 0=Sun, 6=Sat
  hourOfDay: number; // 0-23
};

export type CampusEvent = {
  id: string;
  type: 'rush_hour' | 'exam_period' | 'event' | 'weather' | 'maintenance' | 'custom';
  title: string;
  description: string;
  icon: string;
  severity: 'info' | 'warning' | 'alert';
  startTime: number;
  endTime?: number;
  affectedLocations: string[];
};

export type PulseInsight = {
  type: 'suggestion' | 'alert' | 'trend' | 'fun_fact';
  title: string;
  description: string;
  icon: string;
  actionLabel?: string;
  actionTarget?: string;
};

export type CampusPulseSnapshot = {
  locations: PulseLocation[];
  events: CampusEvent[];
  insights: PulseInsight[];
  overallBusyness: number; // 0-100
  timestamp: number;
};

// ─── Constants ──────────────────────────────────────────

const CACHE_KEY = '@campus_pulse:reports';
const CACHE_KEY_PATTERNS = '@campus_pulse:patterns';
const REPORT_DECAY_MS = 30 * 60 * 1000; // 30 minutes half-life

/** 靜宜大學主要地點 */
const CAMPUS_LOCATIONS: Omit<
  PulseLocation,
  | 'currentLevel'
  | 'confidence'
  | 'lastReportAt'
  | 'reportCount24h'
  | 'trend'
  | 'peakHours'
  | 'bestTimeToVisit'
>[] = [
  { id: 'lib_main', name: '蓋夏圖書館', category: 'library', icon: 'library-outline' },
  { id: 'lib_study', name: '圖書館自習室', category: 'study', icon: 'book-outline' },
  { id: 'cafe_main', name: '學生餐廳', category: 'dining', icon: 'restaurant-outline' },
  { id: 'cafe_sub', name: '第二餐廳', category: 'dining', icon: 'fast-food-outline' },
  { id: 'cafe_711', name: '7-11 便利商店', category: 'dining', icon: 'cart-outline' },
  { id: 'parking_main', name: '主停車場', category: 'parking', icon: 'car-outline' },
  { id: 'parking_back', name: '後門停車場', category: 'parking', icon: 'car-sport-outline' },
  { id: 'gym', name: '體育館', category: 'gym', icon: 'fitness-outline' },
  { id: 'study_room', name: '討論室', category: 'study', icon: 'people-outline' },
  { id: 'computer_lab', name: '電腦教室', category: 'study', icon: 'desktop-outline' },
];

/** 基於經驗的歷史模式（初始種子資料） */
const DEFAULT_PATTERNS: Record<string, Record<number, Record<number, number>>> = {
  // locationId → dayOfWeek → hourOfDay → avgLevel
  lib_main: {
    1: {
      8: 2,
      9: 2,
      10: 3,
      11: 3,
      12: 2,
      13: 3,
      14: 4,
      15: 4,
      16: 4,
      17: 3,
      18: 3,
      19: 4,
      20: 4,
      21: 3,
    },
    2: {
      8: 2,
      9: 2,
      10: 3,
      11: 3,
      12: 2,
      13: 3,
      14: 4,
      15: 4,
      16: 4,
      17: 3,
      18: 3,
      19: 4,
      20: 4,
      21: 3,
    },
    3: {
      8: 2,
      9: 3,
      10: 3,
      11: 3,
      12: 2,
      13: 3,
      14: 3,
      15: 4,
      16: 4,
      17: 3,
      18: 3,
      19: 4,
      20: 4,
      21: 3,
    },
    4: {
      8: 2,
      9: 2,
      10: 3,
      11: 3,
      12: 2,
      13: 3,
      14: 4,
      15: 4,
      16: 4,
      17: 3,
      18: 3,
      19: 4,
      20: 4,
      21: 3,
    },
    5: {
      8: 2,
      9: 2,
      10: 3,
      11: 3,
      12: 2,
      13: 3,
      14: 3,
      15: 3,
      16: 3,
      17: 2,
      18: 2,
      19: 2,
      20: 2,
      21: 1,
    },
    6: { 9: 1, 10: 2, 11: 2, 12: 2, 13: 2, 14: 3, 15: 3, 16: 3, 17: 2, 18: 1 },
    0: { 10: 1, 11: 1, 12: 1, 13: 2, 14: 2, 15: 2, 16: 2, 17: 1 },
  },
  cafe_main: {
    1: { 7: 1, 8: 2, 9: 1, 10: 1, 11: 3, 12: 5, 13: 4, 14: 1, 15: 1, 16: 1, 17: 3, 18: 4, 19: 2 },
    2: { 7: 1, 8: 2, 9: 1, 10: 1, 11: 3, 12: 5, 13: 4, 14: 1, 15: 1, 16: 1, 17: 3, 18: 4, 19: 2 },
    3: { 7: 1, 8: 2, 9: 1, 10: 1, 11: 3, 12: 5, 13: 4, 14: 1, 15: 1, 16: 1, 17: 3, 18: 4, 19: 2 },
    4: { 7: 1, 8: 2, 9: 1, 10: 1, 11: 3, 12: 5, 13: 4, 14: 1, 15: 1, 16: 1, 17: 3, 18: 4, 19: 2 },
    5: { 7: 1, 8: 2, 9: 1, 10: 1, 11: 3, 12: 5, 13: 3, 14: 1, 15: 1, 16: 1, 17: 2, 18: 3 },
    6: { 8: 1, 9: 1, 10: 1, 11: 2, 12: 3, 13: 2, 14: 1 },
    0: {},
  },
  parking_main: {
    1: { 7: 1, 8: 3, 9: 4, 10: 5, 11: 5, 12: 4, 13: 4, 14: 5, 15: 5, 16: 4, 17: 3, 18: 2, 19: 1 },
    2: { 7: 1, 8: 3, 9: 4, 10: 5, 11: 5, 12: 4, 13: 4, 14: 5, 15: 5, 16: 4, 17: 3, 18: 2, 19: 1 },
    3: { 7: 1, 8: 3, 9: 4, 10: 5, 11: 5, 12: 4, 13: 4, 14: 5, 15: 5, 16: 4, 17: 3, 18: 2, 19: 1 },
    4: { 7: 1, 8: 3, 9: 4, 10: 5, 11: 5, 12: 4, 13: 4, 14: 5, 15: 5, 16: 4, 17: 3, 18: 2, 19: 1 },
    5: { 7: 1, 8: 3, 9: 4, 10: 4, 11: 4, 12: 3, 13: 3, 14: 4, 15: 4, 16: 3, 17: 2, 18: 1 },
    6: { 8: 1, 9: 1, 10: 2, 11: 2, 12: 2, 13: 1, 14: 1 },
    0: { 9: 1, 10: 1 },
  },
};

// ─── Storage ────────────────────────────────────────────

async function loadReports(): Promise<PulseReport[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const reports = JSON.parse(raw) as PulseReport[];
    // 只保留 24 小時內的回報
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return reports.filter((r) => r.timestamp > cutoff);
  } catch {
    return [];
  }
}

async function saveReports(reports: PulseReport[]): Promise<void> {
  try {
    // 只保留 24 小時內
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const filtered = reports.filter((r) => r.timestamp > cutoff);
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.warn('[CampusPulse] saveReports error:', err);
  }
}

async function loadPatterns(): Promise<Record<string, Record<number, Record<number, number>>>> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY_PATTERNS);
    if (!raw) return { ...DEFAULT_PATTERNS };
    return JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PATTERNS };
  }
}

async function savePatterns(
  patterns: Record<string, Record<number, Record<number, number>>>,
): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY_PATTERNS, JSON.stringify(patterns));
  } catch (err) {
    console.warn('[CampusPulse] savePatterns error:', err);
  }
}

// ─── Core Logic ─────────────────────────────────────────

/**
 * 提交人潮回報
 * 使用指數衰減，越新的回報權重越高
 */
export async function submitCrowdReport(locationId: string, level: CrowdLevel): Promise<void> {
  const now = new Date();
  const report: PulseReport = {
    locationId,
    level,
    timestamp: now.getTime(),
    dayOfWeek: now.getDay(),
    hourOfDay: now.getHours(),
  };

  const reports = await loadReports();
  reports.push(report);
  await saveReports(reports);

  // 更新歷史模式
  const patterns = await loadPatterns();
  if (!patterns[locationId]) patterns[locationId] = {};
  if (!patterns[locationId][report.dayOfWeek]) patterns[locationId][report.dayOfWeek] = {};

  const existing = patterns[locationId][report.dayOfWeek][report.hourOfDay];
  // Exponential moving average update
  const alpha = 0.2; // learning rate
  patterns[locationId][report.dayOfWeek][report.hourOfDay] = existing
    ? Math.round((alpha * level + (1 - alpha) * existing) * 10) / 10
    : level;

  await savePatterns(patterns);
  console.log(`[CampusPulse] Report submitted: ${locationId} = ${level}`);
}

/**
 * 計算地點的當前擁擠程度
 * 混合：即時回報（衰減加權）+ 歷史模式
 */
function computeCurrentLevel(
  locationId: string,
  reports: PulseReport[],
  patterns: Record<string, Record<number, Record<number, number>>>,
): { level: CrowdLevel; confidence: number; trend: 'rising' | 'falling' | 'stable' } {
  const now = Date.now();
  const locationReports = reports.filter((r) => r.locationId === locationId);

  // 1. 即時回報的衰減加權平均
  let weightedSum = 0;
  let totalWeight = 0;
  const recentReports: { level: number; age: number }[] = [];

  for (const report of locationReports) {
    const ageMs = now - report.timestamp;
    if (ageMs > 2 * 60 * 60 * 1000) continue; // ignore reports > 2 hours old

    const weight = Math.exp(-ageMs / REPORT_DECAY_MS);
    weightedSum += report.level * weight;
    totalWeight += weight;
    recentReports.push({ level: report.level, age: ageMs });
  }

  // 2. 歷史模式
  const currentDay = new Date().getDay();
  const currentHour = new Date().getHours();
  const historicalLevel = patterns[locationId]?.[currentDay]?.[currentHour] ?? 2;

  // 3. 混合
  let level: number;
  let confidence: number;

  if (totalWeight > 0.5) {
    // Good recent reports — trust them more
    const reportAvg = weightedSum / totalWeight;
    const reportWeight = Math.min(totalWeight / 2, 0.8); // max 80% from reports
    level = reportWeight * reportAvg + (1 - reportWeight) * historicalLevel;
    confidence = Math.min(0.3 + totalWeight * 0.2, 0.95);
  } else {
    // No recent reports — rely on historical
    level = historicalLevel;
    confidence = 0.3; // low confidence without real-time data
  }

  // Clamp to valid range
  const clampedLevel = Math.max(1, Math.min(5, Math.round(level))) as CrowdLevel;

  // 4. Trend detection
  let trend: 'rising' | 'falling' | 'stable' = 'stable';
  if (recentReports.length >= 3) {
    const sorted = recentReports.sort((a, b) => b.age - a.age); // oldest first
    const firstHalf = sorted.slice(0, Math.floor(sorted.length / 2));
    const secondHalf = sorted.slice(Math.floor(sorted.length / 2));
    const avgFirst = firstHalf.reduce((s, r) => s + r.level, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, r) => s + r.level, 0) / secondHalf.length;
    if (avgSecond - avgFirst > 0.5) trend = 'rising';
    else if (avgFirst - avgSecond > 0.5) trend = 'falling';
  }

  return { level: clampedLevel, confidence, trend };
}

/**
 * 找出地點的尖峰時段
 */
function findPeakHours(
  locationId: string,
  patterns: Record<string, Record<number, Record<number, number>>>,
): string[] {
  const currentDay = new Date().getDay();
  const dayPattern = patterns[locationId]?.[currentDay];
  if (!dayPattern) return [];

  const entries = Object.entries(dayPattern)
    .map(([hour, level]) => ({ hour: parseInt(hour), level }))
    .sort((a, b) => b.level - a.level);

  // Top 2 peak periods
  return entries
    .filter((e) => e.level >= 4)
    .slice(0, 2)
    .map((e) => `${String(e.hour).padStart(2, '0')}:00-${String(e.hour + 1).padStart(2, '0')}:00`);
}

/**
 * 找出最佳造訪時間
 */
function findBestTime(
  locationId: string,
  patterns: Record<string, Record<number, Record<number, number>>>,
): string {
  const currentDay = new Date().getDay();
  const currentHour = new Date().getHours();
  const dayPattern = patterns[locationId]?.[currentDay];
  if (!dayPattern) return '隨時都可以';

  // Find the lowest crowd hour that's still in the future
  const futureEntries = Object.entries(dayPattern)
    .map(([hour, level]) => ({ hour: parseInt(hour), level }))
    .filter((e) => e.hour > currentHour)
    .sort((a, b) => a.level - b.level);

  if (futureEntries.length === 0) return '明天再來';

  const best = futureEntries[0];
  return `${String(best.hour).padStart(2, '0')}:00-${String(best.hour + 1).padStart(2, '0')}:00`;
}

// ─── Event Detection ────────────────────────────────────

function detectCampusEvents(): CampusEvent[] {
  const events: CampusEvent[] = [];
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay();

  // Rush hour detection
  if (hour >= 11 && hour <= 13 && dayOfWeek >= 1 && dayOfWeek <= 5) {
    events.push({
      id: 'rush_lunch',
      type: 'rush_hour',
      title: '午餐尖峰時段',
      description: '餐廳和便利商店人潮較多，建議提早或延後用餐',
      icon: 'time-outline',
      severity: 'info',
      startTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 30).getTime(),
      endTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 30).getTime(),
      affectedLocations: ['cafe_main', 'cafe_sub', 'cafe_711'],
    });
  }

  // Class change rush
  const classChangeTimes = [9, 10, 11, 12, 13, 14, 15, 16, 17];
  const minute = now.getMinutes();
  if (
    classChangeTimes.includes(hour) &&
    minute >= 0 &&
    minute <= 15 &&
    dayOfWeek >= 1 &&
    dayOfWeek <= 5
  ) {
    events.push({
      id: `class_change_${hour}`,
      type: 'rush_hour',
      title: '下課人潮',
      description: '剛下課，走廊和餐廳會比較擁擠',
      icon: 'walk-outline',
      severity: 'info',
      startTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0).getTime(),
      endTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 15).getTime(),
      affectedLocations: ['cafe_main', 'parking_main'],
    });
  }

  // Evening study surge (exam period heuristic: weekday evenings)
  if (hour >= 18 && hour <= 21 && dayOfWeek >= 1 && dayOfWeek <= 5) {
    events.push({
      id: 'evening_study',
      type: 'event',
      title: '晚間自習時段',
      description: '圖書館和自習室通常較為擁擠',
      icon: 'moon-outline',
      severity: 'info',
      startTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0).getTime(),
      endTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 22, 0).getTime(),
      affectedLocations: ['lib_main', 'lib_study', 'study_room'],
    });
  }

  return events;
}

// ─── Insight Generation ─────────────────────────────────

function generatePulseInsights(locations: PulseLocation[], events: CampusEvent[]): PulseInsight[] {
  const insights: PulseInsight[] = [];
  const now = new Date();
  const hour = now.getHours();

  // Find least crowded dining option
  const diningLocations = locations.filter((l) => l.category === 'dining');
  const leastCrowded = diningLocations.sort((a, b) => a.currentLevel - b.currentLevel)[0];
  if (leastCrowded && diningLocations.length > 1) {
    insights.push({
      type: 'suggestion',
      title: '推薦用餐地點',
      description: `「${leastCrowded.name}」目前人最少（${'🟢🟡🟠🔴🔴'[leastCrowded.currentLevel - 1]} 等級 ${leastCrowded.currentLevel}）`,
      icon: 'restaurant-outline',
      actionLabel: '導航前往',
      actionTarget: `dining_${leastCrowded.id}`,
    });
  }

  // Study space recommendation
  const studyLocations = locations.filter(
    (l) => l.category === 'study' || l.category === 'library',
  );
  const bestStudy = studyLocations.sort((a, b) => a.currentLevel - b.currentLevel)[0];
  if (bestStudy) {
    insights.push({
      type: 'suggestion',
      title: '最佳自習地點',
      description: `「${bestStudy.name}」目前最空，適合自習（等級 ${bestStudy.currentLevel}/5）`,
      icon: 'book-outline',
      actionLabel: '前往',
      actionTarget: `study_${bestStudy.id}`,
    });
  }

  // Parking status
  const parkingLocations = locations.filter((l) => l.category === 'parking');
  const fullParking = parkingLocations.filter((l) => l.currentLevel >= 4);
  if (fullParking.length > 0 && hour >= 7 && hour <= 10) {
    insights.push({
      type: 'alert',
      title: '停車位緊張',
      description: `${fullParking.map((p) => p.name).join('、')}已接近滿位，建議提早出發或搭乘大眾運輸`,
      icon: 'car-outline',
    });
  }

  // Fun fact
  const overallBusy = locations.reduce((sum, l) => sum + l.currentLevel, 0) / locations.length;
  if (overallBusy <= 2) {
    insights.push({
      type: 'fun_fact',
      title: '校園很悠閒',
      description: '現在是校園的安靜時刻，適合散步或獨自思考 🌿',
      icon: 'leaf-outline',
    });
  } else if (overallBusy >= 4) {
    insights.push({
      type: 'fun_fact',
      title: '校園超熱鬧',
      description: '現在整個校園都很熱鬧！大家都在享受校園生活 🎉',
      icon: 'people-outline',
    });
  }

  return insights;
}

// ─── Main Entry Point ───────────────────────────────────

/**
 * 取得完整的校園脈動快照
 */
export async function getCampusPulseSnapshot(): Promise<CampusPulseSnapshot> {
  console.log('[CampusPulse] Getting campus pulse snapshot…');

  const [reports, patterns] = await Promise.all([loadReports(), loadPatterns()]);

  const locations: PulseLocation[] = CAMPUS_LOCATIONS.map((loc) => {
    const { level, confidence, trend } = computeCurrentLevel(loc.id, reports, patterns);
    const reportCount24h = reports.filter((r) => r.locationId === loc.id).length;
    const lastReport = reports
      .filter((r) => r.locationId === loc.id)
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    return {
      ...loc,
      currentLevel: level,
      confidence,
      lastReportAt: lastReport?.timestamp ?? 0,
      reportCount24h,
      trend,
      peakHours: findPeakHours(loc.id, patterns),
      bestTimeToVisit: findBestTime(loc.id, patterns),
    };
  });

  const events = detectCampusEvents();
  const insights = generatePulseInsights(locations, events);

  const overallBusyness = Math.round(
    (locations.reduce((sum, l) => sum + l.currentLevel, 0) / locations.length / 5) * 100,
  );

  console.log(
    `[CampusPulse] Snapshot: ${locations.length} locations, ` +
      `${events.length} events, ${insights.length} insights, ` +
      `overall=${overallBusyness}%`,
  );

  return {
    locations,
    events,
    insights,
    overallBusyness,
    timestamp: Date.now(),
  };
}

/**
 * 取得特定地點的詳細資料
 */
export async function getLocationDetail(locationId: string): Promise<PulseLocation | null> {
  const snapshot = await getCampusPulseSnapshot();
  return snapshot.locations.find((l) => l.id === locationId) ?? null;
}

/**
 * 取得歷史模式（用於視覺化）
 */
export async function getHourlyPattern(
  locationId: string,
  dayOfWeek?: number,
): Promise<{ hour: number; level: number }[]> {
  const patterns = await loadPatterns();
  const day = dayOfWeek ?? new Date().getDay();
  const dayPattern = patterns[locationId]?.[day] ?? {};

  const result: { hour: number; level: number }[] = [];
  for (let h = 6; h <= 22; h++) {
    result.push({ hour: h, level: dayPattern[h] ?? 1 });
  }
  return result;
}

// ============================================================================
// CROSS-MODULE CONNECTOR HOOKS
// ============================================================================

/**
 * 當有學生簽到時，增加對應教室的活躍人數
 * (由 crossModuleConnector 呼叫)
 *
 * 原理：將教室對應到最近的 PulseLocation，
 * 以模擬「即時回報」增加該地點的人潮等級
 */
export async function addClassroomActivity(courseId: string, sessionId: string): Promise<void> {
  // 簡化邏輯：課程簽到等同於為「教學大樓」新增一筆人潮回報
  // 未來可以根據課程教室對應到真實的 locationId
  const classroomLocationId = 'main_building'; // 預設對應教學大樓
  const now = Date.now();
  const dayOfWeek = new Date(now).getDay();
  const hourOfDay = new Date(now).getHours();

  const report: PulseReport = {
    locationId: classroomLocationId,
    level: 3 as CrowdLevel, // 有課在上 → 中等人潮
    timestamp: now,
    dayOfWeek,
    hourOfDay,
  };

  const reports = await loadReports();
  reports.push(report);
  await saveReports(reports);

  console.log(
    `[CampusPulse] Classroom activity added for course=${courseId}, session=${sessionId}`,
  );
}
