/**
 * Demo Admin Mock — AdminDashboardScreen 在 demo 模式下的 fallback 資料
 *
 * AdminDashboardScreen 預設讀 6 個 Firestore collections，但 demo_admin_sys uid 過不了
 * Firestore security rules，每次切到管理員角色畫面會空白。這裡提供寫死的 mock，
 * 讓 demo 切過去就有合理數字可以介紹。
 *
 * 啟用條件：auth.user.uid?.startsWith('demo_')
 */

export type DemoAdminAnnouncement = {
  id: string;
  title: string;
  body: string;
  source?: string;
  publishedAt?: any;
  pinned?: boolean;
};

export type DemoAdminClubEvent = {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startsAt?: any;
  endsAt?: any;
  capacity?: number;
  registeredCount?: number;
};

export type DemoAdminMember = {
  id: string;
  role: 'admin' | 'editor' | 'member';
  displayName?: string;
  email?: string | null;
  department?: string | null;
  avatarUrl?: string | null;
  joinedAt?: any;
};

export type DemoAdminLog = {
  id: string;
  action: string;
  actorUid?: string;
  actorEmail?: string;
  details?: string;
  createdAt?: any;
};

export type DemoAdminCafeteria = {
  id: string;
  name: string;
  merchantId: string;
  brandKey: string | null;
  location: string | null;
  openingHours: string | null;
  pilotStatus: 'inactive' | 'pilot' | 'live';
  orderingEnabled: boolean;
  activeOperatorCount: number;
  updatedAt?: any;
};

function daysAgo(d: number): Date {
  const t = new Date();
  t.setDate(t.getDate() - d);
  return t;
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3600_000);
}

export function isDemoUid(uid: string | null | undefined): boolean {
  return typeof uid === 'string' && uid.startsWith('demo_');
}

export const DEMO_ADMIN_ANNOUNCEMENTS: DemoAdminAnnouncement[] = [
  {
    id: 'ann-demo-1',
    title: '5/26 校慶運動會交通管制',
    body: '5/26（週二）8:00–17:00 校門口至體育館路段交通管制，請改走西側便道。',
    source: '總務處',
    pinned: true,
    publishedAt: hoursAgo(8),
  },
  {
    id: 'ann-demo-2',
    title: '期末考補考時段公告',
    body: '本學期期末考補考訂於 6/24（週三）下午 13:00，地點：任垣樓 R301。',
    source: '教務處',
    pinned: false,
    publishedAt: daysAgo(1),
  },
  {
    id: 'ann-demo-3',
    title: '宿舍 6 月電費分攤通知',
    body: '6 月電費將於 6/5 統一從生活費扣抵，明細可至宿管系統查詢。',
    source: '宿舍管理組',
    publishedAt: daysAgo(2),
  },
  {
    id: 'ann-demo-4',
    title: '圖書館暑期開放時段調整',
    body: '7/1 起圖書館改為 09:00–18:00，週日休館。',
    source: '圖書資訊處',
    publishedAt: daysAgo(3),
  },
  {
    id: 'ann-demo-5',
    title: 'AI 助教 v1.2 上線通知',
    body: '本校 AI 助教升級至 v1.2，新增「期末複習導師模式」與「論文格式檢查」。',
    source: '校務系統',
    publishedAt: daysAgo(5),
  },
];

export const DEMO_ADMIN_EVENTS: DemoAdminClubEvent[] = [
  {
    id: 'evt-demo-1',
    title: '攝影社 X 校園秘境拍攝活動',
    description: '走訪校園 5 個秘境角度，攜手探索構圖與光影。',
    location: '校門集合 → 行政大樓 → 任垣樓',
    startsAt: daysAgo(-3),
    endsAt: daysAgo(-3),
    capacity: 30,
    registeredCount: 22,
  },
  {
    id: 'evt-demo-2',
    title: '程式設計社：期末 Hackathon',
    description: '48 小時校內黑客松，主題：AI 校園應用。',
    location: '工程館 302',
    startsAt: daysAgo(-7),
    endsAt: daysAgo(-9),
    capacity: 80,
    registeredCount: 64,
  },
  {
    id: 'evt-demo-3',
    title: '校友返校日 2026',
    description: '歡迎歷屆校友返校，午宴 + 學系座談。',
    location: '行政大樓 A301',
    startsAt: daysAgo(-14),
    endsAt: daysAgo(-14),
    capacity: 200,
    registeredCount: 148,
  },
  {
    id: 'evt-demo-4',
    title: '系所職涯講座：科技業 New Grad',
    description: '邀請 5 位學長姐分享業界第一年經驗。',
    location: '主顧樓 R201',
    startsAt: daysAgo(-2),
    endsAt: daysAgo(-2),
    capacity: 60,
    registeredCount: 47,
  },
];

export const DEMO_ADMIN_MEMBERS: DemoAdminMember[] = [
  {
    id: 'demo_admin_sys',
    role: 'admin',
    displayName: '系統管理員',
    email: 'demo.sysadmin@pu.edu.tw',
    department: '校務系統',
    joinedAt: daysAgo(120),
  },
  {
    id: 'demo_admin_huang',
    role: 'admin',
    displayName: '黃主任',
    email: 'demo.admin@pu.edu.tw',
    department: '資訊管理學系',
    joinedAt: daysAgo(90),
  },
  {
    id: 'demo_teacher_chang',
    role: 'editor',
    displayName: '張怡君（demo 老師）',
    email: 'demo.teacher@pu.edu.tw',
    department: '資訊管理學系',
    joinedAt: daysAgo(85),
  },
  {
    id: 'demo_ta_lin',
    role: 'editor',
    displayName: '林助教（demo TA）',
    email: 'demo.ta@pu.edu.tw',
    department: '資訊管理學系',
    joinedAt: daysAgo(60),
  },
  {
    id: 'demo_club_wei',
    role: 'editor',
    displayName: '魏社長',
    email: 'demo.club@pu.edu.tw',
    department: '學生社團',
    joinedAt: daysAgo(45),
  },
  {
    id: 'demo_cafeteria',
    role: 'editor',
    displayName: '阿櫻（demo 餐廳）',
    email: 'demo.vendor@pu.edu.tw',
    department: '校園服務',
    joinedAt: daysAgo(40),
  },
  {
    id: 'demo_student_kuchih',
    role: 'member',
    displayName: '顧晉瑋',
    email: 'demo.student@pu.edu.tw',
    department: '資訊管理學系',
    joinedAt: daysAgo(30),
  },
  {
    id: 'demo_student_peer_lin',
    role: 'member',
    displayName: '林宏志',
    email: 'demo.peer@pu.edu.tw',
    department: '資訊管理學系',
    joinedAt: daysAgo(28),
  },
  {
    id: 'demo_alumni_chang',
    role: 'member',
    displayName: '張學長（校友）',
    email: 'demo.alumni@pu.edu.tw',
    department: '資訊管理學系（已畢業）',
    joinedAt: daysAgo(800),
  },
];

export const DEMO_ADMIN_LOGS: DemoAdminLog[] = [
  {
    id: 'log-1',
    action: 'announcement.publish',
    actorUid: 'demo_admin_huang',
    actorEmail: 'demo.admin@pu.edu.tw',
    details: '核准公告「期末考補考時段公告」並發布',
    createdAt: daysAgo(0),
  },
  {
    id: 'log-2',
    action: 'order.update',
    actorUid: 'demo_cafeteria',
    actorEmail: 'demo.vendor@pu.edu.tw',
    details: 'merchant_cafe_a 訂單 o_cafe_3 → ready',
    createdAt: hoursAgo(1),
  },
  {
    id: 'log-3',
    action: 'leave.approve',
    actorUid: 'demo_teacher_chang',
    actorEmail: 'demo.teacher@pu.edu.tw',
    details: '核准學生 顧晉瑋 的請假申請',
    createdAt: hoursAgo(2),
  },
  {
    id: 'log-4',
    action: 'club.member.approve',
    actorUid: 'demo_club_wei',
    actorEmail: 'demo.club@pu.edu.tw',
    details: '核准 顧晉瑋 加入 攝影社',
    createdAt: hoursAgo(3),
  },
  {
    id: 'log-5',
    action: 'dorm.repair.dispatch',
    actorUid: 'demo_admin_sys',
    actorEmail: 'demo.sysadmin@pu.edu.tw',
    details: '派工：靜園男舍 305 浴室水龍頭',
    createdAt: hoursAgo(5),
  },
  {
    id: 'log-6',
    action: 'member.role.update',
    actorUid: 'demo_admin_sys',
    actorEmail: 'demo.sysadmin@pu.edu.tw',
    details: '將 demo_ta_lin 設為 editor',
    createdAt: daysAgo(1),
  },
  {
    id: 'log-7',
    action: 'export.batch',
    actorUid: 'demo_admin_huang',
    actorEmail: 'demo.admin@pu.edu.tw',
    details: '匯出 2026 春季學期公告（CSV, 28 筆）',
    createdAt: daysAgo(2),
  },
];

export const DEMO_ADMIN_CAFETERIAS: DemoAdminCafeteria[] = [
  {
    id: 'merchant_cafe_a',
    name: '靜宜中餐部',
    merchantId: 'merchant_cafe_a',
    brandKey: 'zhongcan',
    location: '主顧樓 B1',
    openingHours: '07:30–19:30',
    pilotStatus: 'live',
    orderingEnabled: true,
    activeOperatorCount: 4,
    updatedAt: daysAgo(0),
  },
  {
    id: 'merchant_coffee_b',
    name: '校園咖啡屋',
    merchantId: 'merchant_coffee_b',
    brandKey: 'coffee',
    location: '行政大樓 1F',
    openingHours: '08:00–18:00',
    pilotStatus: 'live',
    orderingEnabled: true,
    activeOperatorCount: 3,
    updatedAt: daysAgo(1),
  },
  {
    id: 'merchant_noodle_f',
    name: '校門麵食館',
    merchantId: 'merchant_noodle_f',
    brandKey: 'noodle',
    location: '校門口 西側',
    openingHours: '11:00–20:00',
    pilotStatus: 'pilot',
    orderingEnabled: true,
    activeOperatorCount: 2,
    updatedAt: daysAgo(2),
  },
  {
    id: 'merchant_drink_e',
    name: '校園飲料吧',
    merchantId: 'merchant_drink_e',
    brandKey: 'drink',
    location: '任垣樓 1F',
    openingHours: '10:00–21:00',
    pilotStatus: 'pilot',
    orderingEnabled: true,
    activeOperatorCount: 1,
    updatedAt: daysAgo(3),
  },
];
