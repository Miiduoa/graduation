/**
 * Demo User Stories — 每位 demo 用戶的完整校園生活檔案
 *
 * 目的：把 5 個 demo 角色從「只有作業 / 成績」擴成「住宿、圖書、停車、社團、健康
 * …全部串起來」的真實人。每個校園子系統都對應到他們的真實資料。
 *
 * 設計：以 uid 為 key，把該人在 APP 內所有 dimension 的資料集中起來，方便：
 *   - TodayCockpit 顯示「校園生活速覽」
 *   - 個人 ProfileScreen 看完整故事
 *   - AI 助理用 context 回答（「我的圖書館書下週到期」這類）
 *   - 老師/助教/主任也有自己的辦公空間、車牌、合約資訊
 *
 * 對應的舊資料源 (puDormData / puLibraryData / puPrintData / puCampusData…) 仍存在；
 * 此檔提供「demo 帳號」專屬的可預測 mock，覆蓋舊資料。
 */

export type DemoUid =
  | 'demo_student_kuchih'
  | 'demo_teacher_chang'
  | 'demo_ta_lin'
  | 'demo_admin_huang'
  | 'demo_cafeteria';

export interface DormitoryStory {
  building: string;
  room: string;
  floor: number;
  roomType: 'single' | 'double' | 'quad';
  roommates: Array<{ name: string; studentId: string; major: string }>;
  inDate: string;
  outDate: string;
  /** 近期維修紀錄 */
  recentRepairs: Array<{ id: string; title: string; status: 'pending' | 'in_progress' | 'completed'; submittedAt: string }>;
  /** 門禁紀錄（最近 5 筆） */
  recentEntry: Array<{ at: string; method: 'card' | 'face' | 'guest' }>;
  /** 水電費 */
  utilities: { electricity: number; water: number; month: string };
}

export interface LibraryStory {
  borrowed: Array<{ title: string; author: string; dueAt: string; renewable: boolean }>;
  totalBorrowed: number;
  overdueCount: number;
  bookFavorites: number;
  studyRoomsBooked: Array<{ room: string; date: string; time: string }>;
}

export interface PrintingStory {
  balance: number;
  monthUsed: number;
  recentJobs: Array<{ name: string; pages: number; cost: number; at: string }>;
  defaultPrinter: string;
}

export interface ParkingStory {
  vehicle: 'car' | 'motorcycle' | 'bicycle' | 'none';
  permitNumber?: string;
  zone?: string;
  monthlyFee?: number;
  /** 最近進出 */
  recentEntries: Array<{ direction: 'in' | 'out'; at: string }>;
}

export interface ClubStory {
  active: Array<{ name: string; role: 'member' | 'officer' | 'president'; yearJoined: number }>;
  events: Array<{ name: string; date: string; rsvp: 'going' | 'maybe' | 'no' }>;
}

export interface HealthStory {
  insurance: { provider: string; policyNumber: string; expiresAt: string };
  allergies: string[];
  emergencyContact: { name: string; phone: string; relation: string };
  recentVisits: Array<{ at: string; reason: string; clinic: string }>;
}

export interface BusStory {
  subscribedRoutes: Array<{ id: string; name: string; nextDeparture: string }>;
  recentTrips: Array<{ route: string; at: string }>;
}

export interface FitnessStory {
  thisMonthVisits: number;
  favoriteFacility: string;
  recentCheckIns: Array<{ facility: string; at: string }>;
}

export interface FinanceStory {
  semesterFee: { total: number; paid: boolean; dueAt: string };
  scholarship?: { name: string; amount: number; awardedAt: string };
  printingBalance: number;
  diningBalance: number;
}

export interface OfficeStory {
  building: string;
  room: string;
  floor: number;
  officeHours: Array<{ day: string; from: string; to: string }>;
  phone: string;
  vehicle?: { plate: string; type: 'car' | 'motorcycle' };
}

export interface MerchantContractStory {
  merchantName: string;
  contractStart: string;
  contractEnd: string;
  monthlyRent: number;
  staffSchedule: Array<{ name: string; weekdays: string[]; shift: 'morning' | 'afternoon' | 'evening' }>;
}

export interface DemoUserStory {
  uid: DemoUid;
  fullName: string;
  role: 'student' | 'teacher' | 'ta' | 'admin' | 'vendor';
  schoolId: string;
  department: string;
  /** 入學/到職年（民國） */
  joinedYear: number;
  /** 角色專屬資料 */
  dorm?: DormitoryStory;
  library?: LibraryStory;
  printing?: PrintingStory;
  parking?: ParkingStory;
  clubs?: ClubStory;
  health?: HealthStory;
  bus?: BusStory;
  fitness?: FitnessStory;
  finance?: FinanceStory;
  office?: OfficeStory;
  merchant?: MerchantContractStory;
}

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(now - d * 24 * 3600_000).toISOString();
const daysAhead = (d: number) => new Date(now + d * 24 * 3600_000).toISOString();

// ─────────────────────────────────────────────────────────
// 學生 顧晉瑋（411211325，資管系大三，住宿生）
// ─────────────────────────────────────────────────────────
export const STUDENT_KUCHIH: DemoUserStory = {
  uid: 'demo_student_kuchih',
  fullName: '顧晉瑋',
  role: 'student',
  schoolId: 'pu',
  department: '資訊管理學系',
  joinedYear: 110,
  dorm: {
    building: '宜真樓',
    room: 'A215',
    floor: 3,
    roomType: 'quad',
    roommates: [
      { name: '陳俊豪', studentId: '411211201', major: '資管系' },
      { name: '林宏志', studentId: '411211218', major: '資工系' },
      { name: '吳威廷', studentId: '411211302', major: '財金系' },
    ],
    inDate: '2024-09-01',
    outDate: '2025-06-30',
    recentRepairs: [
      { id: 'r1', title: '冷氣不冷', status: 'in_progress', submittedAt: daysAgo(2) },
      { id: 'r2', title: '床頭燈閃爍', status: 'completed', submittedAt: daysAgo(8) },
    ],
    recentEntry: [
      { at: hoursAgo(2), method: 'face' },
      { at: hoursAgo(8), method: 'face' },
      { at: daysAgo(1), method: 'card' },
      { at: daysAgo(1), method: 'face' },
      { at: daysAgo(2), method: 'face' },
    ],
    utilities: { electricity: 287, water: 45, month: '2026-04' },
  },
  library: {
    borrowed: [
      { title: '深入淺出資料庫設計', author: 'Lynn Beighley', dueAt: daysAhead(5), renewable: true },
      { title: 'Clean Architecture', author: 'Robert C. Martin', dueAt: daysAhead(12), renewable: true },
      { title: '統計學概論', author: '王志中', dueAt: daysAhead(2), renewable: false },
    ],
    totalBorrowed: 3,
    overdueCount: 0,
    bookFavorites: 14,
    studyRoomsBooked: [
      { room: '研討室 G-3', date: daysAhead(1).slice(0, 10), time: '14:00-16:00' },
    ],
  },
  printing: {
    balance: 135,
    monthUsed: 42,
    recentJobs: [
      { name: 'HW3_Normalization.pdf', pages: 8, cost: 8, at: hoursAgo(20) },
      { name: '專題簡報_v2.pdf', pages: 24, cost: 24, at: daysAgo(2) },
      { name: '統計學作業.pdf', pages: 10, cost: 10, at: daysAgo(5) },
    ],
    defaultPrinter: '主顧樓 1F 圖書館旁',
  },
  parking: {
    vehicle: 'motorcycle',
    permitNumber: 'PU-M-2025-887',
    zone: '宿舍區 機車停車場',
    monthlyFee: 200,
    recentEntries: [
      { direction: 'in', at: hoursAgo(2) },
      { direction: 'out', at: hoursAgo(8) },
      { direction: 'in', at: daysAgo(1) },
    ],
  },
  clubs: {
    active: [
      { name: '資管學會', role: 'officer', yearJoined: 110 },
      { name: '攝影社', role: 'member', yearJoined: 111 },
    ],
    events: [
      { name: '資管之夜 2026', date: daysAhead(14).slice(0, 10), rsvp: 'going' },
      { name: '攝影社外拍 — 鹿港', date: daysAhead(20).slice(0, 10), rsvp: 'maybe' },
    ],
  },
  health: {
    insurance: { provider: '中央健保署', policyNumber: 'A123456789', expiresAt: '2026-12-31' },
    allergies: ['花生', '海鮮'],
    emergencyContact: { name: '顧媽媽', phone: '0912-xxx-xxx', relation: '母親' },
    recentVisits: [
      { at: daysAgo(45), reason: '感冒', clinic: '校園健康中心' },
    ],
  },
  bus: {
    subscribedRoutes: [
      { id: '5300', name: '台中車站—靜宜大學', nextDeparture: '18:20' },
      { id: '95', name: '沙鹿—靜宜大學', nextDeparture: '17:50' },
    ],
    recentTrips: [
      { route: '5300', at: daysAgo(1) },
      { route: '5300', at: daysAgo(4) },
    ],
  },
  fitness: {
    thisMonthVisits: 8,
    favoriteFacility: '羽球場',
    recentCheckIns: [
      { facility: '羽球場 #2', at: daysAgo(2) },
      { facility: '健身房', at: daysAgo(5) },
      { facility: '羽球場 #1', at: daysAgo(8) },
    ],
  },
  finance: {
    semesterFee: { total: 56400, paid: true, dueAt: '2026-02-15' },
    scholarship: { name: '資管系優秀學業獎學金', amount: 5000, awardedAt: '2025-11-01' },
    printingBalance: 135,
    diningBalance: 320,
  },
};

// ─────────────────────────────────────────────────────────
// 老師 張怡君（資管系教授）
// ─────────────────────────────────────────────────────────
export const TEACHER_CHANG: DemoUserStory = {
  uid: 'demo_teacher_chang',
  fullName: '張怡君',
  role: 'teacher',
  schoolId: 'pu',
  department: '資訊管理學系',
  joinedYear: 102,
  office: {
    building: '主顧樓',
    room: 'RB-301',
    floor: 3,
    officeHours: [
      { day: '週二', from: '14:00', to: '16:00' },
      { day: '週四', from: '10:00', to: '12:00' },
    ],
    phone: '04-26328001 ext. 13901',
    vehicle: { plate: 'AAB-1234', type: 'car' },
  },
  parking: {
    vehicle: 'car',
    permitNumber: 'PU-F-2025-201',
    zone: '主顧樓 教職員停車場',
    monthlyFee: 0,
    recentEntries: [
      { direction: 'in', at: hoursAgo(3) },
    ],
  },
  printing: {
    balance: 999,
    monthUsed: 280,
    recentJobs: [
      { name: '期末考卷.pdf', pages: 4, cost: 0, at: hoursAgo(20) },
    ],
    defaultPrinter: '主顧樓 3F 教師專用',
  },
};

// ─────────────────────────────────────────────────────────
// 助教 林助教（資管系碩士生 + TA）
// ─────────────────────────────────────────────────────────
export const TA_LIN: DemoUserStory = {
  uid: 'demo_ta_lin',
  fullName: '林助教',
  role: 'ta',
  schoolId: 'pu',
  department: '資訊管理學系',
  joinedYear: 113,
  office: {
    building: '主顧樓',
    room: 'RB-201（資料庫實驗室）',
    floor: 2,
    officeHours: [
      { day: '週一', from: '15:00', to: '17:00' },
      { day: '週三', from: '13:00', to: '15:00' },
    ],
    phone: '04-26328001 ext. 13205',
  },
  library: {
    borrowed: [
      { title: 'Deep Learning Book', author: 'Goodfellow et al.', dueAt: daysAhead(10), renewable: true },
    ],
    totalBorrowed: 1,
    overdueCount: 0,
    bookFavorites: 8,
    studyRoomsBooked: [],
  },
  parking: {
    vehicle: 'motorcycle',
    permitNumber: 'PU-G-2025-118',
    zone: '主顧樓 機車區',
    monthlyFee: 100,
    recentEntries: [
      { direction: 'in', at: hoursAgo(1) },
    ],
  },
};

// ─────────────────────────────────────────────────────────
// 系所主任 黃主任（資管系系主任）
// ─────────────────────────────────────────────────────────
export const ADMIN_HUANG: DemoUserStory = {
  uid: 'demo_admin_huang',
  fullName: '黃主任',
  role: 'admin',
  schoolId: 'pu',
  department: '資訊管理學系',
  joinedYear: 98,
  office: {
    building: '主顧樓',
    room: 'RB-401（系辦公室）',
    floor: 4,
    officeHours: [
      { day: '週一至週五', from: '08:30', to: '17:30' },
    ],
    phone: '04-26328001 ext. 13901',
    vehicle: { plate: 'AAA-1234', type: 'car' },
  },
  parking: {
    vehicle: 'car',
    permitNumber: 'PU-F-2025-001',
    zone: '主顧樓 主任預留位 #1',
    monthlyFee: 0,
    recentEntries: [
      { direction: 'in', at: hoursAgo(5) },
    ],
  },
};

// ─────────────────────────────────────────────────────────
// 餐廳員工 阿英（中餐部店長 + 咖啡屋兼差）
// ─────────────────────────────────────────────────────────
export const VENDOR_AYING: DemoUserStory = {
  uid: 'demo_cafeteria',
  fullName: '阿英',
  role: 'vendor',
  schoolId: 'pu',
  department: '校園商家',
  joinedYear: 113,
  merchant: {
    merchantName: '靜宜中餐部',
    contractStart: '2023-09-01',
    contractEnd: '2027-08-31',
    monthlyRent: 12000,
    staffSchedule: [
      { name: '阿英', weekdays: ['週一', '週二', '週三', '週四', '週五'], shift: 'morning' },
      { name: '小琪', weekdays: ['週一', '週三', '週五'], shift: 'afternoon' },
      { name: '阿宏', weekdays: ['週二', '週四'], shift: 'afternoon' },
    ],
  },
  parking: {
    vehicle: 'motorcycle',
    permitNumber: 'PU-V-2025-064',
    zone: '主顧樓 B1 員工區',
    monthlyFee: 0,
    recentEntries: [
      { direction: 'in', at: hoursAgo(7) },
    ],
  },
};

// ─────────────────────────────────────────────────────────
// 索引 + accessors
// ─────────────────────────────────────────────────────────

const STORIES: Record<DemoUid, DemoUserStory> = {
  demo_student_kuchih: STUDENT_KUCHIH,
  demo_teacher_chang: TEACHER_CHANG,
  demo_ta_lin: TA_LIN,
  demo_admin_huang: ADMIN_HUANG,
  demo_cafeteria: VENDOR_AYING,
};

export function getDemoUserStory(uid: string): DemoUserStory | null {
  return STORIES[uid as DemoUid] ?? null;
}

/** 給 AI 助理當 context — 把這個人完整資料寫成可讀文字 */
export function storyToPromptBlock(uid: string): string {
  const s = getDemoUserStory(uid);
  if (!s) return '';
  const parts: string[] = [];
  parts.push(`姓名：${s.fullName}（角色：${s.role}，${s.department}）`);
  if (s.dorm) {
    parts.push(`宿舍：${s.dorm.building} ${s.dorm.room}（${s.dorm.roomType}，室友 ${s.dorm.roommates.length} 位）`);
    if (s.dorm.recentRepairs.some((r) => r.status !== 'completed')) {
      parts.push(`有 ${s.dorm.recentRepairs.filter((r) => r.status !== 'completed').length} 件報修中`);
    }
  }
  if (s.library) {
    parts.push(`圖書館：借閱 ${s.library.totalBorrowed} 本，逾期 ${s.library.overdueCount}`);
  }
  if (s.printing) {
    parts.push(`印表機餘額 $${s.printing.balance}，本月用了 ${s.printing.monthUsed} 頁`);
  }
  if (s.parking) {
    parts.push(`停車：${s.parking.vehicle} ${s.parking.permitNumber ?? ''}`);
  }
  if (s.finance) {
    parts.push(`學雜費${s.finance.semesterFee.paid ? '已繳清' : '尚未繳清'}`);
  }
  if (s.office) {
    parts.push(`辦公室：${s.office.building} ${s.office.room}，Office Hour ${s.office.officeHours.map((h) => `${h.day} ${h.from}-${h.to}`).join('、')}`);
  }
  if (s.merchant) {
    parts.push(`店家：${s.merchant.merchantName}（合約至 ${s.merchant.contractEnd}）`);
  }
  return parts.join('\n');
}

/** 學生快覽 — 用於 TodayCockpit 速覽區 */
export function getStudentLifeQuickFacts(uid: string): Array<{ icon: string; label: string; value: string; tone?: 'warn' | 'success' | 'danger' }> {
  const s = getDemoUserStory(uid);
  if (!s || s.role !== 'student') return [];
  const facts: Array<{ icon: string; label: string; value: string; tone?: 'warn' | 'success' | 'danger' }> = [];

  if (s.dorm) {
    facts.push({ icon: '🏠', label: '宿舍', value: `${s.dorm.building} ${s.dorm.room}` });
    const pending = s.dorm.recentRepairs.filter((r) => r.status !== 'completed').length;
    if (pending > 0) {
      facts.push({ icon: '🔧', label: '報修中', value: `${pending} 件`, tone: 'warn' });
    }
  }
  if (s.library) {
    const dueSoon = s.library.borrowed.filter((b) => new Date(b.dueAt).getTime() - now < 3 * 24 * 3600_000).length;
    facts.push({
      icon: '📚',
      label: '借閱',
      value: `${s.library.totalBorrowed} 本${dueSoon > 0 ? ` (${dueSoon} 即將到期)` : ''}`,
      tone: dueSoon > 0 ? 'warn' : undefined,
    });
  }
  if (s.printing) {
    facts.push({
      icon: '🖨',
      label: '印表機',
      value: `$${s.printing.balance}`,
      tone: s.printing.balance < 50 ? 'warn' : undefined,
    });
  }
  if (s.finance) {
    facts.push({
      icon: '💰',
      label: '餐廳餘額',
      value: `$${s.finance.diningBalance}`,
      tone: s.finance.diningBalance < 100 ? 'warn' : undefined,
    });
  }
  if (s.fitness) {
    facts.push({ icon: '🏃', label: '本月運動', value: `${s.fitness.thisMonthVisits} 次` });
  }
  if (s.clubs) {
    const upcomingRsvp = s.clubs.events.filter((e) => e.rsvp === 'going' && new Date(e.date).getTime() > now).length;
    if (upcomingRsvp > 0) {
      facts.push({ icon: '🎉', label: '社團活動', value: `${upcomingRsvp} 場` });
    }
  }
  return facts;
}
