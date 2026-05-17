/* eslint-disable */
/**
 * Persona Context — 單一存取點：讓所有畫面拿到「當前 demo 角色」的完整資料
 *
 * 這支檔解決一個 demo 嚴重問題：每個畫面各自寫死 mock 資料，不管登入誰看都一樣。
 *
 * 提供：
 *   - usePersonaContext(): 回傳當前 persona 完整 DemoUserStory 與便利方法
 *   - getNextClassLocation(): 依時間找下一節課地點（從 timetable 推算）
 *   - getFrequentDestinations(): 個人常去地點（依角色與儲存）
 *   - getSubscribedBusRoutes(): 訂閱的公車路線
 *   - getTodayTimeline(): 今天的事件序列（給 DemoStory 用）
 *
 * 注意：若不是 demo 帳號，回傳通用 fallback（不會 crash）
 */

import { useMemo } from 'react';
import { useAuth } from '../state/auth';
import {
  STUDENT_KUCHIH,
  TEACHER_CHANG,
  TA_LIN,
  ADMIN_HUANG,
  VENDOR_AYING,
  type DemoUid,
  type DemoUserStory,
} from '../data/demoUserStories';
import { CAMPUS_POIS, getCampusPoi, type CampusPoi } from '../data/puCampusData';
import { CAMPUS_BUS_ROUTES, type CampusBusRoute } from '../data/campusBusRoutes';

// ═════════════════════════════════════════════════════════
// Persona lookup
// ═════════════════════════════════════════════════════════

const STORIES: Record<DemoUid, DemoUserStory> = {
  demo_student_kuchih: STUDENT_KUCHIH,
  demo_teacher_chang: TEACHER_CHANG,
  demo_ta_lin: TA_LIN,
  demo_admin_huang: ADMIN_HUANG,
  demo_cafeteria: VENDOR_AYING,
};

export function getDemoStory(uid: string | null | undefined): DemoUserStory | null {
  if (!uid) return null;
  return STORIES[uid as DemoUid] ?? null;
}

// ═════════════════════════════════════════════════════════
// Persona-specific saved places (取代之前一刀切的預設)
// ═════════════════════════════════════════════════════════

export type PersonaPlace = {
  id: string;
  label: string;
  name: string;
  lat: number;
  lng: number;
  emoji: string;
  /** 對應的校園 POI（若有） */
  poiId?: string;
  /** 對應的建築樓層房間（若有） */
  roomCode?: string;
};

const STUDENT_FREQUENT_POI_IDS: string[] = [
  'pu-renyuan', // 任垣樓 — 資管系上課地點
  'pu-library', // 圖書館
  'pu-jingyuan', // 學生餐廳
  'pu-7eleven', // 7-11
  'pu-gym', // 運動 — 也許不存在會用 fallback
];
const TEACHER_FREQUENT_POI_IDS: string[] = [
  'pu-providence', // 主顧樓辦公室
  'pu-renyuan', // 任垣樓 教室
  'pu-library',
  'pu-admin', // 行政大樓
];
const TA_FREQUENT_POI_IDS: string[] = [
  'pu-renyuan', // 資料庫實驗室
  'pu-library',
  'pu-jingyuan',
];
const ADMIN_FREQUENT_POI_IDS: string[] = [
  'pu-admin',
  'pu-providence',
  'pu-intl',
  'pu-library',
];
const VENDOR_FREQUENT_POI_IDS: string[] = [
  'pu-jingyuan',
  'pu-zhishan',
  'pu-yiyuan',
];

const FREQUENT_BY_ROLE: Record<DemoUid, string[]> = {
  demo_student_kuchih: STUDENT_FREQUENT_POI_IDS,
  demo_teacher_chang: TEACHER_FREQUENT_POI_IDS,
  demo_ta_lin: TA_FREQUENT_POI_IDS,
  demo_admin_huang: ADMIN_FREQUENT_POI_IDS,
  demo_cafeteria: VENDOR_FREQUENT_POI_IDS,
};

function poiToPlace(poi: CampusPoi, emoji: string, label?: string): PersonaPlace {
  return {
    id: `poi-${poi.id}`,
    label: label ?? poi.name,
    name: poi.name,
    lat: poi.lat,
    lng: poi.lng,
    emoji,
    poiId: poi.id,
  };
}

function homePlace(story: DemoUserStory): PersonaPlace | null {
  // 學生 → 宿舍房間（用學校宿舍 POI）
  if (story.dorm) {
    const dormName = story.dorm.building;
    const poi = CAMPUS_POIS.find((p) => p.name.includes('宜真') || p.name.includes(dormName));
    if (poi) {
      return {
        id: 'home-dorm',
        label: '家（宿舍）',
        name: `${dormName} ${story.dorm.room}`,
        lat: poi.lat,
        lng: poi.lng,
        emoji: '🏠',
        poiId: poi.id,
        roomCode: story.dorm.room,
      };
    }
    // fallback：用宿舍區共用 POI
    const dormGeneric = CAMPUS_POIS.find((p) => p.category === 'dormitory');
    if (dormGeneric) {
      return {
        id: 'home-dorm-generic',
        label: '家（宿舍）',
        name: `${dormName} ${story.dorm.room}`,
        lat: dormGeneric.lat,
        lng: dormGeneric.lng,
        emoji: '🏠',
        poiId: dormGeneric.id,
        roomCode: story.dorm.room,
      };
    }
  }
  // 教師/行政 → 辦公室
  if (story.office) {
    const poi = CAMPUS_POIS.find((p) => p.name === story.office!.building) ??
      CAMPUS_POIS.find((p) => p.category === 'academic');
    if (poi) {
      return {
        id: 'home-office',
        label: '辦公室',
        name: `${story.office.building} ${story.office.room}`,
        lat: poi.lat,
        lng: poi.lng,
        emoji: '💼',
        poiId: poi.id,
        roomCode: story.office.room,
      };
    }
  }
  // 餐廳員工 → 店面
  if (story.merchant) {
    const poi = CAMPUS_POIS.find((p) => p.name.includes(story.merchant!.merchantName)) ??
      CAMPUS_POIS.find((p) => p.category === 'cafeteria');
    if (poi) {
      return {
        id: 'home-shop',
        label: '店面',
        name: story.merchant.merchantName,
        lat: poi.lat,
        lng: poi.lng,
        emoji: '🏪',
        poiId: poi.id,
      };
    }
  }
  return null;
}

function schoolPlace(): PersonaPlace | null {
  const gate = CAMPUS_POIS.find((p) => p.category === 'gate' && p.name.includes('正門'));
  if (!gate) return null;
  return {
    id: 'school-main',
    label: '學校（正門）',
    name: gate.name,
    lat: gate.lat,
    lng: gate.lng,
    emoji: '🎓',
    poiId: gate.id,
  };
}

/**
 * 取得 persona 的儲存地點清單（家、學校、常去）
 */
export function getPersonaPlaces(story: DemoUserStory | null): PersonaPlace[] {
  const out: PersonaPlace[] = [];
  if (!story) {
    // 未登入或非 demo → 通用 fallback
    return CAMPUS_POIS.slice(0, 4).map((p) =>
      poiToPlace(p, p.category === 'library' ? '📚' : p.category === 'cafeteria' ? '🍱' : '📍'),
    );
  }

  const home = homePlace(story);
  if (home) out.push(home);

  const school = schoolPlace();
  if (school) out.push(school);

  // 常去
  const ids = FREQUENT_BY_ROLE[story.uid] ?? [];
  for (const pid of ids) {
    const poi = getCampusPoi(pid);
    if (!poi) continue;
    const emoji =
      poi.category === 'cafeteria' ? '🍱' :
      poi.category === 'library' ? '📚' :
      poi.category === 'academic' ? '🏫' :
      poi.category === 'convenience' ? '🏪' :
      poi.category === 'admin' ? '🏛️' :
      '⭐';
    out.push(poiToPlace(poi, emoji));
  }

  return out;
}

// ═════════════════════════════════════════════════════════
// 下一節課地點
// ═════════════════════════════════════════════════════════

type ClassSlot = {
  weekday: number; // 0=Sun..6=Sat
  startHHmm: string;
  endHHmm: string;
  courseName: string;
  poiId: string;
  roomCode: string;
};

const STUDENT_TIMETABLE: ClassSlot[] = [
  // 週一
  { weekday: 1, startHHmm: '09:10', endHHmm: '12:00', courseName: '資料庫管理系統', poiId: 'pu-renyuan', roomCode: 'R301' },
  { weekday: 1, startHHmm: '13:10', endHHmm: '15:00', courseName: '統計學', poiId: 'pu-providence', roomCode: 'PH-101' },
  // 週二
  { weekday: 2, startHHmm: '10:10', endHHmm: '12:00', courseName: '系統分析與設計', poiId: 'pu-renyuan', roomCode: 'R302' },
  { weekday: 2, startHHmm: '15:10', endHHmm: '17:00', courseName: '通識：電影藝術', poiId: 'pu-providence', roomCode: 'PH-103' },
  // 週三
  { weekday: 3, startHHmm: '09:10', endHHmm: '12:00', courseName: '網頁程式設計', poiId: 'pu-renyuan', roomCode: 'R301' },
  // 週四
  { weekday: 4, startHHmm: '14:10', endHHmm: '16:00', courseName: '資料庫管理系統 上機', poiId: 'pu-renyuan', roomCode: 'R302' },
  // 週五
  { weekday: 5, startHHmm: '10:10', endHHmm: '12:00', courseName: '管理學', poiId: 'pu-boduo', roomCode: 'B-201' },
];

const TEACHER_TIMETABLE: ClassSlot[] = [
  { weekday: 1, startHHmm: '09:10', endHHmm: '12:00', courseName: '資料庫管理系統', poiId: 'pu-renyuan', roomCode: 'R301' },
  { weekday: 2, startHHmm: '10:10', endHHmm: '12:00', courseName: '系統分析與設計', poiId: 'pu-renyuan', roomCode: 'R302' },
  { weekday: 3, startHHmm: '09:10', endHHmm: '12:00', courseName: '網頁程式設計', poiId: 'pu-renyuan', roomCode: 'R301' },
  { weekday: 4, startHHmm: '14:10', endHHmm: '16:00', courseName: '資料庫上機', poiId: 'pu-renyuan', roomCode: 'R302' },
];

const TIMETABLES: Record<DemoUid, ClassSlot[]> = {
  demo_student_kuchih: STUDENT_TIMETABLE,
  demo_teacher_chang: TEACHER_TIMETABLE,
  demo_ta_lin: [
    { weekday: 1, startHHmm: '15:00', endHHmm: '17:00', courseName: '辦公時間', poiId: 'pu-providence', roomCode: 'RB-201' },
    { weekday: 3, startHHmm: '13:00', endHHmm: '15:00', courseName: '辦公時間', poiId: 'pu-providence', roomCode: 'RB-201' },
  ],
  demo_admin_huang: [
    { weekday: 1, startHHmm: '10:00', endHHmm: '11:30', courseName: '系務會議', poiId: 'pu-admin', roomCode: 'A301' },
    { weekday: 3, startHHmm: '14:00', endHHmm: '16:00', courseName: '校務發展', poiId: 'pu-admin', roomCode: 'A301' },
  ],
  demo_cafeteria: [],
};

function hhmmToMin(s: string): number {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export type NextClassInfo = {
  courseName: string;
  startHHmm: string;
  endHHmm: string;
  startsInMin: number;
  poi: CampusPoi;
  roomCode: string;
};

export function getNextClass(
  story: DemoUserStory | null,
  now: Date = new Date(),
): NextClassInfo | null {
  if (!story) return null;
  const slots = TIMETABLES[story.uid] ?? [];
  if (slots.length === 0) return null;

  const dow = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // 找今天還沒上的
  const today = slots
    .filter((s) => s.weekday === dow && hhmmToMin(s.startHHmm) >= nowMin - 15) // 包含正在上的
    .sort((a, b) => hhmmToMin(a.startHHmm) - hhmmToMin(b.startHHmm));
  let target = today[0];

  // 沒有就找下個工作日
  if (!target) {
    for (let i = 1; i <= 7; i++) {
      const d = (dow + i) % 7;
      const f = slots.filter((s) => s.weekday === d);
      if (f.length > 0) {
        target = f.sort((a, b) => hhmmToMin(a.startHHmm) - hhmmToMin(b.startHHmm))[0];
        break;
      }
    }
  }

  if (!target) return null;
  const poi = getCampusPoi(target.poiId);
  if (!poi) return null;

  return {
    courseName: target.courseName,
    startHHmm: target.startHHmm,
    endHHmm: target.endHHmm,
    startsInMin: Math.max(0, hhmmToMin(target.startHHmm) - nowMin),
    poi,
    roomCode: target.roomCode,
  };
}

// ═════════════════════════════════════════════════════════
// 訂閱公車路線（從 demoUserStories.bus.subscribedRoutes 對應到我們的 CAMPUS_BUS_ROUTES）
// ═════════════════════════════════════════════════════════

const ROUTE_NAME_TO_ID: Record<string, string> = {
  '台中車站—靜宜大學': 'city-300',
  '沙鹿—靜宜大學': 'city-304',
  '靜宜—高鐵': 'city-309',
};

export function getSubscribedBusRoutes(
  story: DemoUserStory | null,
): CampusBusRoute[] {
  if (!story?.bus?.subscribedRoutes) {
    // 角色預設：學生訂校園 A、教師訂校內 B、其他空
    if (story?.role === 'student') {
      return ['campus-a', 'city-300'].map((id) => CAMPUS_BUS_ROUTES.find((r) => r.id === id)!).filter(Boolean);
    }
    if (story?.role === 'teacher' || story?.role === 'admin') {
      return [CAMPUS_BUS_ROUTES.find((r) => r.id === 'campus-a')!];
    }
    return [];
  }
  const out: CampusBusRoute[] = [];
  for (const sub of story.bus.subscribedRoutes) {
    const id = ROUTE_NAME_TO_ID[sub.name];
    const r = id ? CAMPUS_BUS_ROUTES.find((x) => x.id === id) : null;
    if (r) out.push(r);
  }
  // 學生一定額外加校園 A
  if (story.role === 'student') {
    const a = CAMPUS_BUS_ROUTES.find((r) => r.id === 'campus-a');
    if (a && !out.find((x) => x.id === a.id)) out.unshift(a);
  }
  return out;
}

// ═════════════════════════════════════════════════════════
// Today timeline — 給 DemoStoryScreen 顯示「一天的故事」
// ═════════════════════════════════════════════════════════

export type TimelineEvent = {
  id: string;
  hhmm: string; // 'HH:MM'
  category: 'wake' | 'bus' | 'class' | 'food' | 'study' | 'office' | 'work' | 'home' | 'social' | 'health';
  icon: string; // ionicon name
  title: string;
  detail?: string;
  /** 點擊跳到哪個畫面 + 參數 */
  link?: { screen: string; params?: Record<string, any> };
  /** 已完成（時間在現在之前） */
  done?: boolean;
};

export function getTodayTimeline(
  story: DemoUserStory | null,
  now: Date = new Date(),
): TimelineEvent[] {
  if (!story) return [];

  const items: TimelineEvent[] = [];
  const nowHHmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const before = (t: string) => t <= nowHHmm;

  if (story.role === 'student') {
    items.push(
      { id: 'wake', hhmm: '07:00', category: 'wake', icon: 'sunny-outline', title: '起床', detail: `${story.dorm?.building ?? '宿舍'} ${story.dorm?.room ?? ''}` },
      { id: 'breakfast', hhmm: '07:45', category: 'food', icon: 'cafe-outline', title: '早餐：靜園餐廳', detail: '預訂的鮪魚三明治 + 大冰拿', link: { screen: 'OrderHistory' } },
      { id: 'busA', hhmm: '08:40', category: 'bus', icon: 'bus-outline', title: '搭校園 A 線', detail: '宿舍 → 任垣樓 · 約 5 分鐘', link: { screen: 'BusV2' } },
      { id: 'class1', hhmm: '09:10', category: 'class', icon: 'school-outline', title: '資料庫管理系統', detail: '任垣樓 R301 · 張怡君老師', link: { screen: 'CourseDetail', params: { courseId: 101 } } },
      { id: 'lunch', hhmm: '12:10', category: 'food', icon: 'restaurant-outline', title: '午餐 ready', detail: '靜宜中餐部 · 日式炸雞便當', link: { screen: 'OrderDetail', params: { orderId: 'o_cafe_5' } } },
      { id: 'lib', hhmm: '13:00', category: 'study', icon: 'library-outline', title: '圖書館自習', detail: `蓋夏圖書館 4F · 24 小時自習室 · 借的「統計學概論」${'2'} 天後到期`, link: { screen: 'IndoorFloorMap', params: { buildingId: 'lib' } } },
      { id: 'class2', hhmm: '13:10', category: 'class', icon: 'school-outline', title: '統計學', detail: '主顧樓 PH-101', link: { screen: 'CourseDetail', params: { courseId: 102 } } },
      { id: 'gym', hhmm: '17:00', category: 'health', icon: 'fitness-outline', title: '羽球場練球', detail: '羽球場 #2 · 與資管學會社員', link: { screen: 'Fitness' } },
      { id: 'dinner', hhmm: '18:30', category: 'food', icon: 'restaurant-outline', title: '晚餐：至善廣場', detail: '韓式拌飯', link: { screen: '餐廳總覽' } },
      { id: 'home', hhmm: '21:30', category: 'home', icon: 'home-outline', title: '回宿舍', detail: '宜真樓 A215 · 室友夜聊' },
    );
  } else if (story.role === 'teacher') {
    items.push(
      { id: 'drive', hhmm: '08:30', category: 'bus', icon: 'car-outline', title: '開車到校', detail: `主顧樓教職員停車場 · ${story.office?.vehicle?.plate}` },
      { id: 'office', hhmm: '08:50', category: 'office', icon: 'briefcase-outline', title: '辦公室準備', detail: `${story.office?.building} ${story.office?.room} · 課前準備`, link: { screen: 'TeacherCockpit' } },
      { id: 'class1', hhmm: '09:10', category: 'class', icon: 'school-outline', title: '資料庫管理系統', detail: '任垣樓 R301 · 32 位學生簽到完成', link: { screen: 'TeacherCockpit' } },
      { id: 'grade', hhmm: '12:30', category: 'work', icon: 'create-outline', title: '批改 HW3', detail: '6 份新繳交 · AI 已起草評語', link: { screen: 'TeacherGrading' } },
      { id: 'office2', hhmm: '14:00', category: 'office', icon: 'people-outline', title: 'Office Hours', detail: `${story.office?.officeHours[0].day} ${story.office?.officeHours[0].from} 已有 2 位學生預約` },
      { id: 'admin', hhmm: '15:30', category: 'work', icon: 'document-text-outline', title: '系務會議', detail: '行政大樓 A301 · 黃主任' },
      { id: 'home', hhmm: '18:00', category: 'home', icon: 'home-outline', title: '下班', detail: '開車離校' },
    );
  } else if (story.role === 'ta') {
    items.push(
      { id: 'arrive', hhmm: '13:00', category: 'office', icon: 'briefcase-outline', title: '到實驗室', detail: '主顧樓 RB-201 資料庫實驗室' },
      { id: 'office', hhmm: '13:00', category: 'office', icon: 'people-outline', title: 'TA 辦公時間', detail: '已有 4 位學生報名' },
      { id: 'grade', hhmm: '15:00', category: 'work', icon: 'create-outline', title: '協助批改 HW3', detail: '張怡君老師指派 · 12 份' },
      { id: 'class', hhmm: '17:00', category: 'class', icon: 'school-outline', title: '碩士論文研討', detail: '思源樓 R401' },
    );
  } else if (story.role === 'admin') {
    items.push(
      { id: 'arrive', hhmm: '08:00', category: 'office', icon: 'briefcase-outline', title: '到系辦', detail: '主顧樓 RB-401', link: { screen: 'DepartmentDashboard' } },
      { id: 'review', hhmm: '09:00', category: 'work', icon: 'analytics-outline', title: '檢視系所儀表板', detail: '3 位學生 risk 標記為紅', link: { screen: 'DepartmentDashboard' } },
      { id: 'meeting', hhmm: '10:00', category: 'work', icon: 'people-circle-outline', title: '系務會議', detail: '行政大樓 A301', link: { screen: 'DepartmentDashboard' } },
      { id: 'lunch', hhmm: '12:00', category: 'food', icon: 'restaurant-outline', title: '午餐：教職員餐廳', detail: '至善廣場 1F · 教職員套餐' },
      { id: 'student-talk', hhmm: '14:00', category: 'work', icon: 'chatbubbles-outline', title: 'risk 學生輔導', detail: '與 1 位學生面談' },
      { id: 'class', hhmm: '15:30', category: 'class', icon: 'school-outline', title: '校務發展課', detail: '行政大樓 A301' },
    );
  } else if (story.role === 'vendor') {
    items.push(
      { id: 'open', hhmm: '08:00', category: 'work', icon: 'storefront-outline', title: '開店準備', detail: '靜宜中餐部 · 進貨上架', link: { screen: 'VendorDashboard' } },
      { id: 'lunch-rush', hhmm: '11:30', category: 'work', icon: 'flame-outline', title: '午餐尖峰', detail: '預估 80 單 · 已準備 3 位人手', link: { screen: 'VendorDashboard' } },
      { id: 'menu', hhmm: '14:00', category: 'work', icon: 'create-outline', title: '更新明日菜單', detail: '推播給 142 位訂閱者', link: { screen: 'MenuSubscription' } },
      { id: 'finance', hhmm: '17:00', category: 'work', icon: 'cash-outline', title: '日結對帳', detail: '今日營收 $4,820 · 學生悠遊卡占 78%' },
      { id: 'close', hhmm: '19:30', category: 'work', icon: 'lock-closed-outline', title: '收店', detail: '盤點 + 清潔' },
    );
  }

  return items.map((it) => ({ ...it, done: before(it.hhmm) }));
}

// ═════════════════════════════════════════════════════════
// React Hook
// ═════════════════════════════════════════════════════════

export type PersonaContextValue = {
  uid: string | null;
  story: DemoUserStory | null;
  isDemoPersona: boolean;
  displayName: string;
  role: 'student' | 'teacher' | 'ta' | 'admin' | 'vendor' | 'unknown';
  /** 個人化儲存地點 */
  places: PersonaPlace[];
  /** 下一節課 / 下個行程 */
  nextClass: NextClassInfo | null;
  /** 訂閱公車路線 */
  subscribedRoutes: CampusBusRoute[];
  /** 今天時程 */
  todayTimeline: TimelineEvent[];
};

export function usePersonaContext(now: Date = new Date()): PersonaContextValue {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? null;
  const story = useMemo(() => getDemoStory(uid), [uid]);

  return useMemo<PersonaContextValue>(() => {
    return {
      uid,
      story,
      isDemoPersona: !!story,
      displayName: story?.fullName ?? profile?.displayName ?? '訪客',
      role: (story?.role ?? 'unknown') as PersonaContextValue['role'],
      places: getPersonaPlaces(story),
      nextClass: getNextClass(story, now),
      subscribedRoutes: getSubscribedBusRoutes(story),
      todayTimeline: getTodayTimeline(story, now),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, story, profile?.displayName, now.getTime()]);
}
