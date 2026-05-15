/**
 * Demo Merchants — 校園店家完整 demo 資料
 *
 * 設計原則：
 *  - 8 個店家覆蓋常見類型（中餐部 / 咖啡 / 便利店 / 早餐 / 飲料 / 麵食 / 異國 / 自助餐）
 *  - 每家店有自己的：訂單列表、熱門品項、員工角色、營業狀態、評價
 *  - vendor demo 帳號可同時管理多個店家（owner / manager / staff）
 *  - 訂單分布合理：尖峰時段（早餐 7-9 / 午餐 11-13 / 晚餐 17-19）量大
 *  - 老闆 / 店長 / 工讀生 權限分明，UI 對應顯示不同功能
 *
 * 每個 vendor 員工會綁到 1+ 個店家。員工只看得到自己 assigned 的店家資料。
 */

export type MerchantCategory =
  | 'cafeteria'
  | 'coffee'
  | 'store'
  | 'breakfast'
  | 'drink'
  | 'noodle'
  | 'international'
  | 'buffet';

export interface MerchantRole {
  role: 'owner' | 'manager' | 'staff';
  /** 中文標籤 */
  label: string;
  /** 可做的動作 */
  canEditMenu: boolean;
  canManageStaff: boolean;
  canViewReports: boolean;
  canHandleOrders: boolean;
  /** 是否可發 loyalty 推播 */
  canSendLoyaltyPush: boolean;
  /** 是否可修改營業狀態 */
  canToggleOpenStatus: boolean;
}

export const MERCHANT_ROLES: Record<'owner' | 'manager' | 'staff', MerchantRole> = {
  owner: {
    role: 'owner',
    label: '老闆',
    canEditMenu: true,
    canManageStaff: true,
    canViewReports: true,
    canHandleOrders: true,
    canSendLoyaltyPush: true,
    canToggleOpenStatus: true,
  },
  manager: {
    role: 'manager',
    label: '店長',
    canEditMenu: true,
    canManageStaff: false,
    canViewReports: true,
    canHandleOrders: true,
    canSendLoyaltyPush: true,
    canToggleOpenStatus: true,
  },
  staff: {
    role: 'staff',
    label: '工讀生',
    canEditMenu: false,
    canManageStaff: false,
    canViewReports: false,
    canHandleOrders: true,
    canSendLoyaltyPush: false,
    canToggleOpenStatus: false,
  },
};

export interface DemoMerchant {
  id: string;
  name: string;
  category: MerchantCategory;
  emoji: string;
  location: string;
  /** 員工總人數 */
  staffCount: number;
  /** 是否正在營業 */
  isOpen: boolean;
  /** 營業時段 */
  hours: string;
  /** 平均評價 (1-5) */
  rating: number;
  /** 評價數量 */
  reviewCount: number;
  /** 今日累積出餐數 */
  todayServedCount: number;
  /** 今日累積收入 */
  todayRevenue: number;
  /** 顏色（UI 顯示） */
  color: string;
  /** 簡短描述 */
  description: string;
}

export const DEMO_MERCHANTS: DemoMerchant[] = [
  {
    id: 'merchant_cafe_a',
    name: '靜宜中餐部',
    category: 'cafeteria',
    emoji: '🍱',
    location: '主顧樓 B1',
    staffCount: 8,
    isOpen: true,
    hours: '10:30 - 19:30',
    rating: 4.2,
    reviewCount: 312,
    todayServedCount: 142,
    todayRevenue: 11380,
    color: '#F59E0B',
    description: '校園主餐廳，便當套餐多元',
  },
  {
    id: 'merchant_coffee_b',
    name: '校園咖啡屋',
    category: 'coffee',
    emoji: '☕',
    location: '圖書館 1F',
    staffCount: 4,
    isOpen: true,
    hours: '08:00 - 21:00',
    rating: 4.6,
    reviewCount: 528,
    todayServedCount: 89,
    todayRevenue: 6230,
    color: '#A16207',
    description: '手沖咖啡與輕食，圖書館旁',
  },
  {
    id: 'merchant_store_c',
    name: '24h 便利商店',
    category: 'store',
    emoji: '🛒',
    location: '宿舍區 1F',
    staffCount: 12,
    isOpen: true,
    hours: '24 小時',
    rating: 4.0,
    reviewCount: 1024,
    todayServedCount: 268,
    todayRevenue: 8420,
    color: '#0EA5E9',
    description: '便當、飲料、生活用品全包',
  },
  {
    id: 'merchant_breakfast_d',
    name: '元氣早餐坊',
    category: 'breakfast',
    emoji: '🥪',
    location: '主顧樓 1F 大廳',
    staffCount: 5,
    isOpen: true,
    hours: '06:30 - 11:00',
    rating: 4.4,
    reviewCount: 412,
    todayServedCount: 185,
    todayRevenue: 7950,
    color: '#EF4444',
    description: '中西式早餐，趕課首選',
  },
  {
    id: 'merchant_drink_e',
    name: '靜宜茶飲',
    category: 'drink',
    emoji: '🧋',
    location: '行政大樓旁',
    staffCount: 3,
    isOpen: true,
    hours: '10:00 - 22:00',
    rating: 4.5,
    reviewCount: 689,
    todayServedCount: 124,
    todayRevenue: 4880,
    color: '#7C3AED',
    description: '手搖飲、咖啡因救星',
  },
  {
    id: 'merchant_noodle_f',
    name: '阿婆麵食館',
    category: 'noodle',
    emoji: '🍜',
    location: '學生餐廳 2F',
    staffCount: 6,
    isOpen: true,
    hours: '11:00 - 20:00',
    rating: 4.7,
    reviewCount: 234,
    todayServedCount: 76,
    todayRevenue: 6080,
    color: '#DC2626',
    description: '手工麵條、湯頭濃郁',
  },
  {
    id: 'merchant_intl_g',
    name: 'Pho 越南河粉',
    category: 'international',
    emoji: '🍲',
    location: '研究大樓 1F',
    staffCount: 4,
    isOpen: true,
    hours: '11:30 - 21:00',
    rating: 4.3,
    reviewCount: 156,
    todayServedCount: 42,
    todayRevenue: 4620,
    color: '#16A34A',
    description: '越南河粉、東南亞風味',
  },
  {
    id: 'merchant_buffet_h',
    name: '健康自助餐',
    category: 'buffet',
    emoji: '🥗',
    location: '體育館 1F',
    staffCount: 7,
    isOpen: false,
    hours: '11:00 - 14:00 / 17:00 - 20:00',
    rating: 4.1,
    reviewCount: 198,
    todayServedCount: 94,
    todayRevenue: 7520,
    color: '#10B981',
    description: '夾菜計價、健康均衡',
  },
];

export function getDemoMerchantById(id: string): DemoMerchant | undefined {
  return DEMO_MERCHANTS.find((m) => m.id === id);
}

export function getOpenMerchants(): DemoMerchant[] {
  return DEMO_MERCHANTS.filter((m) => m.isOpen);
}

// ─────────────────────────────────────────────────────────
// 訂單 mock：每個 merchant 各自的訂單（pending / processing / ready / completed）
// ─────────────────────────────────────────────────────────

export interface DemoMerchantOrder {
  id: string;
  merchantId: string;
  studentName: string;
  /** 學生 uid（用於 emit 推播） */
  studentUid?: string;
  items: string;
  total: number;
  status: 'pending' | 'processing' | 'ready' | 'completed';
  orderedAt: string;
  /** 取餐方式：來店取 / 外送（外送 staff 需指派） */
  pickupMethod?: 'walk_in' | 'delivery';
  /** 備註（過敏、不要香菜等） */
  note?: string;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export const DEMO_MERCHANT_ORDERS: DemoMerchantOrder[] = [
  // ── 中餐部 (餐點多元、訂單最多) ──────────────────────────
  { id: 'o_cafe_1', merchantId: 'merchant_cafe_a', studentName: '阿明', studentUid: 'student_aming', items: '日式炸雞便當 ×1', total: 80, status: 'pending', orderedAt: minutesAgo(5), pickupMethod: 'walk_in' },
  { id: 'o_cafe_2', merchantId: 'merchant_cafe_a', studentName: '小華', studentUid: 'student_xiaohua', items: '素食套餐', total: 75, status: 'processing', orderedAt: minutesAgo(12), note: '不要香菜' },
  { id: 'o_cafe_3', merchantId: 'merchant_cafe_a', studentName: '小美', studentUid: 'student_xiaomei', items: '咖哩飯 ×2', total: 160, status: 'ready', orderedAt: minutesAgo(25) },
  { id: 'o_cafe_4', merchantId: 'merchant_cafe_a', studentName: '阿傑', studentUid: 'student_ajie', items: '滷肉飯', total: 60, status: 'pending', orderedAt: minutesAgo(2) },
  { id: 'o_cafe_5', merchantId: 'merchant_cafe_a', studentName: '顧晉瑋', studentUid: 'demo_student_kuchih', items: '排骨便當 + 飲料', total: 105, status: 'processing', orderedAt: minutesAgo(8) },
  { id: 'o_cafe_6', merchantId: 'merchant_cafe_a', studentName: '怡君', studentUid: 'student_yijun', items: '雞腿便當 ×3', total: 270, status: 'pending', orderedAt: minutesAgo(1), note: '3 份要分裝' },

  // ── 咖啡屋 ──────────────────────────────────────────────
  { id: 'o_coffee_1', merchantId: 'merchant_coffee_b', studentName: '佳玲', studentUid: 'student_jialing', items: '美式咖啡 + 司康', total: 110, status: 'pending', orderedAt: minutesAgo(3) },
  { id: 'o_coffee_2', merchantId: 'merchant_coffee_b', studentName: '冠宇', studentUid: 'student_guanyu', items: '拿鐵 ×2', total: 140, status: 'ready', orderedAt: minutesAgo(8) },
  { id: 'o_coffee_3', merchantId: 'merchant_coffee_b', studentName: '雅雯', studentUid: 'student_yawen', items: '卡布奇諾 + 起司蛋糕', total: 165, status: 'processing', orderedAt: minutesAgo(6), note: '不加糖' },
  { id: 'o_coffee_4', merchantId: 'merchant_coffee_b', studentName: '張怡君', studentUid: 'demo_teacher_chang', items: '冰美式 大杯', total: 75, status: 'pending', orderedAt: minutesAgo(2) },

  // ── 便利店 ──────────────────────────────────────────────
  { id: 'o_store_1', merchantId: 'merchant_store_c', studentName: '宜珊', studentUid: 'student_yishan', items: '泡麵 + 飲料', total: 45, status: 'pending', orderedAt: minutesAgo(1) },
  { id: 'o_store_2', merchantId: 'merchant_store_c', studentName: '俊豪', studentUid: 'student_junhao', items: '微波便當 + 茶葉蛋', total: 95, status: 'ready', orderedAt: minutesAgo(4) },
  { id: 'o_store_3', merchantId: 'merchant_store_c', studentName: '美玲', studentUid: 'student_meiling', items: '吐司 ×2 + 鮮奶', total: 88, status: 'pending', orderedAt: minutesAgo(7) },

  // ── 早餐店 (尖峰早晨) ───────────────────────────────────
  { id: 'o_break_1', merchantId: 'merchant_breakfast_d', studentName: '威廷', studentUid: 'student_weiting', items: '蛋餅 + 豆漿', total: 50, status: 'completed', orderedAt: minutesAgo(60) },
  { id: 'o_break_2', merchantId: 'merchant_breakfast_d', studentName: '柏勳', studentUid: 'student_boxun', items: '鐵板麵 + 紅茶', total: 70, status: 'completed', orderedAt: minutesAgo(45) },
  { id: 'o_break_3', merchantId: 'merchant_breakfast_d', studentName: '雅婷', studentUid: 'student_yating', items: '蘿蔔糕 + 米漿', total: 65, status: 'pending', orderedAt: minutesAgo(8) },
  { id: 'o_break_4', merchantId: 'merchant_breakfast_d', studentName: '建宏', studentUid: 'student_jianhong', items: '漢堡 + 薯餅 + 奶茶', total: 90, status: 'processing', orderedAt: minutesAgo(15) },

  // ── 茶飲 ────────────────────────────────────────────────
  { id: 'o_drink_1', merchantId: 'merchant_drink_e', studentName: '思妤', studentUid: 'student_siyu', items: '珍珠奶茶 大', total: 55, status: 'processing', orderedAt: minutesAgo(5) },
  { id: 'o_drink_2', merchantId: 'merchant_drink_e', studentName: '宗翰', studentUid: 'student_zonghan', items: '檸檬青茶 ×2', total: 80, status: 'ready', orderedAt: minutesAgo(10) },
  { id: 'o_drink_3', merchantId: 'merchant_drink_e', studentName: '芷涵', studentUid: 'student_zhihan', items: '抹茶拿鐵 微糖', total: 65, status: 'pending', orderedAt: minutesAgo(2) },
  { id: 'o_drink_4', merchantId: 'merchant_drink_e', studentName: '靖傑', studentUid: 'student_jingjie', items: '芋頭奶茶 半糖少冰', total: 60, status: 'pending', orderedAt: minutesAgo(4) },

  // ── 麵食館 ──────────────────────────────────────────────
  { id: 'o_noodle_1', merchantId: 'merchant_noodle_f', studentName: '俊樺', studentUid: 'student_junhua', items: '牛肉麵 + 滷蛋', total: 130, status: 'pending', orderedAt: minutesAgo(3) },
  { id: 'o_noodle_2', merchantId: 'merchant_noodle_f', studentName: '亭瑄', studentUid: 'student_tingxuan', items: '榨菜肉絲麵', total: 75, status: 'processing', orderedAt: minutesAgo(11) },
  { id: 'o_noodle_3', merchantId: 'merchant_noodle_f', studentName: '榮華', studentUid: 'student_ronghua', items: '酸辣湯麵 + 餛飩', total: 110, status: 'ready', orderedAt: minutesAgo(18) },

  // ── 越南河粉 ────────────────────────────────────────────
  { id: 'o_intl_1', merchantId: 'merchant_intl_g', studentName: '思婷', studentUid: 'student_siting', items: '牛肉河粉 大', total: 120, status: 'processing', orderedAt: minutesAgo(7) },
  { id: 'o_intl_2', merchantId: 'merchant_intl_g', studentName: '冠廷', studentUid: 'student_guanting', items: '春捲 + 越南咖啡', total: 105, status: 'pending', orderedAt: minutesAgo(3) },

  // ── 自助餐 (午餐尖峰已收) ──────────────────────────────
  { id: 'o_buffet_1', merchantId: 'merchant_buffet_h', studentName: '雅芳', studentUid: 'student_yafang', items: '夾菜 8 樣 + 飯', total: 95, status: 'completed', orderedAt: minutesAgo(120) },
  { id: 'o_buffet_2', merchantId: 'merchant_buffet_h', studentName: '志強', studentUid: 'student_zhiqiang', items: '夾菜 5 樣 + 湯', total: 75, status: 'completed', orderedAt: minutesAgo(95) },
];

export function getDemoOrdersByMerchant(merchantId: string): DemoMerchantOrder[] {
  return DEMO_MERCHANT_ORDERS.filter((o) => o.merchantId === merchantId);
}

// ─────────────────────────────────────────────────────────
// 熱門品項 — 每家店各自統計
// ─────────────────────────────────────────────────────────

export interface DemoMerchantPopular {
  merchantId: string;
  name: string;
  count: number;
  revenue: number;
  /** 趨勢：↑ / → / ↓ */
  trend: 'up' | 'flat' | 'down';
}

export const DEMO_MERCHANT_POPULAR: DemoMerchantPopular[] = [
  // 中餐部
  { merchantId: 'merchant_cafe_a', name: '日式炸雞便當', count: 38, revenue: 3040, trend: 'up' },
  { merchantId: 'merchant_cafe_a', name: '滷肉飯', count: 24, revenue: 1440, trend: 'flat' },
  { merchantId: 'merchant_cafe_a', name: '排骨便當', count: 21, revenue: 1890, trend: 'up' },
  { merchantId: 'merchant_cafe_a', name: '素食套餐', count: 13, revenue: 975, trend: 'down' },
  // 咖啡屋
  { merchantId: 'merchant_coffee_b', name: '拿鐵', count: 42, revenue: 2940, trend: 'up' },
  { merchantId: 'merchant_coffee_b', name: '美式咖啡', count: 28, revenue: 1680, trend: 'flat' },
  { merchantId: 'merchant_coffee_b', name: '司康', count: 19, revenue: 760, trend: 'up' },
  // 便利店
  { merchantId: 'merchant_store_c', name: '微波便當', count: 58, revenue: 3480, trend: 'up' },
  { merchantId: 'merchant_store_c', name: '泡麵', count: 47, revenue: 1175, trend: 'flat' },
  { merchantId: 'merchant_store_c', name: '飲料', count: 89, revenue: 2225, trend: 'up' },
  // 早餐店
  { merchantId: 'merchant_breakfast_d', name: '蛋餅', count: 64, revenue: 1920, trend: 'up' },
  { merchantId: 'merchant_breakfast_d', name: '鐵板麵', count: 38, revenue: 2280, trend: 'flat' },
  { merchantId: 'merchant_breakfast_d', name: '蘿蔔糕', count: 22, revenue: 1100, trend: 'up' },
  // 茶飲
  { merchantId: 'merchant_drink_e', name: '珍珠奶茶', count: 51, revenue: 2805, trend: 'up' },
  { merchantId: 'merchant_drink_e', name: '檸檬青茶', count: 32, revenue: 1280, trend: 'flat' },
  { merchantId: 'merchant_drink_e', name: '抹茶拿鐵', count: 18, revenue: 1170, trend: 'up' },
  // 麵食館
  { merchantId: 'merchant_noodle_f', name: '牛肉麵', count: 26, revenue: 3380, trend: 'up' },
  { merchantId: 'merchant_noodle_f', name: '榨菜肉絲麵', count: 21, revenue: 1575, trend: 'flat' },
  // 越南河粉
  { merchantId: 'merchant_intl_g', name: '牛肉河粉', count: 18, revenue: 2160, trend: 'up' },
  { merchantId: 'merchant_intl_g', name: '春捲', count: 14, revenue: 980, trend: 'flat' },
  // 自助餐
  { merchantId: 'merchant_buffet_h', name: '便當（夾菜）', count: 94, revenue: 7520, trend: 'flat' },
];

export function getDemoPopularByMerchant(merchantId: string): DemoMerchantPopular[] {
  return DEMO_MERCHANT_POPULAR.filter((p) => p.merchantId === merchantId);
}

// ─────────────────────────────────────────────────────────
// 員工名單 — 每家店各自的員工（demo 顯示用）
// ─────────────────────────────────────────────────────────

export interface DemoMerchantStaff {
  id: string;
  merchantId: string;
  name: string;
  role: 'owner' | 'manager' | 'staff';
  /** 今天有沒有上班 */
  onShiftToday: boolean;
  /** 累計服務月數 */
  monthsServed: number;
}

export const DEMO_MERCHANT_STAFF: DemoMerchantStaff[] = [
  // 中餐部
  { id: 's_cafe_1', merchantId: 'merchant_cafe_a', name: '陳老闆', role: 'owner', onShiftToday: true, monthsServed: 84 },
  { id: 's_cafe_2', merchantId: 'merchant_cafe_a', name: '阿英', role: 'manager', onShiftToday: true, monthsServed: 36 },
  { id: 's_cafe_3', merchantId: 'merchant_cafe_a', name: '小琪', role: 'staff', onShiftToday: true, monthsServed: 8 },
  { id: 's_cafe_4', merchantId: 'merchant_cafe_a', name: '阿宏', role: 'staff', onShiftToday: false, monthsServed: 14 },
  // 咖啡屋
  { id: 's_coffee_1', merchantId: 'merchant_coffee_b', name: 'Lisa', role: 'manager', onShiftToday: true, monthsServed: 24 },
  { id: 's_coffee_2', merchantId: 'merchant_coffee_b', name: '阿英', role: 'staff', onShiftToday: true, monthsServed: 4 },
  { id: 's_coffee_3', merchantId: 'merchant_coffee_b', name: '志祥', role: 'staff', onShiftToday: false, monthsServed: 11 },
  // 早餐店
  { id: 's_break_1', merchantId: 'merchant_breakfast_d', name: '阿桃', role: 'owner', onShiftToday: true, monthsServed: 120 },
  { id: 's_break_2', merchantId: 'merchant_breakfast_d', name: '小傑', role: 'staff', onShiftToday: true, monthsServed: 6 },
  // 茶飲
  { id: 's_drink_1', merchantId: 'merchant_drink_e', name: '阿凱', role: 'manager', onShiftToday: true, monthsServed: 18 },
  { id: 's_drink_2', merchantId: 'merchant_drink_e', name: '阿芸', role: 'staff', onShiftToday: true, monthsServed: 3 },
  // 麵食館
  { id: 's_noodle_1', merchantId: 'merchant_noodle_f', name: '阿婆', role: 'owner', onShiftToday: true, monthsServed: 240 },
  { id: 's_noodle_2', merchantId: 'merchant_noodle_f', name: '阿英', role: 'manager', onShiftToday: true, monthsServed: 60 },
  // 越南河粉
  { id: 's_intl_1', merchantId: 'merchant_intl_g', name: 'Linh', role: 'owner', onShiftToday: true, monthsServed: 48 },
];

export function getDemoStaffByMerchant(merchantId: string): DemoMerchantStaff[] {
  return DEMO_MERCHANT_STAFF.filter((s) => s.merchantId === merchantId);
}

// ─────────────────────────────────────────────────────────
// 菜單 — 每家店各自的菜色（demo 顯示 + AI 推薦用）
// ─────────────────────────────────────────────────────────

export interface DemoMenuItem {
  id: string;
  merchantId: string;
  name: string;
  price: number;
  category: string;
  /** 是否售完 */
  soldOut: boolean;
  /** 是否素食 */
  vegetarian: boolean;
  /** AI 推薦標籤 */
  tags: string[];
}

export const DEMO_MENU: DemoMenuItem[] = [
  // 中餐部
  { id: 'm_cafe_1', merchantId: 'merchant_cafe_a', name: '日式炸雞便當', price: 80, category: '便當', soldOut: false, vegetarian: false, tags: ['熱賣', '高蛋白'] },
  { id: 'm_cafe_2', merchantId: 'merchant_cafe_a', name: '排骨便當', price: 85, category: '便當', soldOut: false, vegetarian: false, tags: ['熱賣'] },
  { id: 'm_cafe_3', merchantId: 'merchant_cafe_a', name: '素食套餐', price: 75, category: '便當', soldOut: false, vegetarian: true, tags: ['素食', '健康'] },
  { id: 'm_cafe_4', merchantId: 'merchant_cafe_a', name: '滷肉飯', price: 60, category: '飯類', soldOut: false, vegetarian: false, tags: ['經濟'] },
  { id: 'm_cafe_5', merchantId: 'merchant_cafe_a', name: '咖哩飯', price: 80, category: '飯類', soldOut: true, vegetarian: false, tags: ['售完'] },
  { id: 'm_cafe_6', merchantId: 'merchant_cafe_a', name: '雞腿便當', price: 90, category: '便當', soldOut: false, vegetarian: false, tags: ['熱賣', '高蛋白'] },
  // 咖啡屋
  { id: 'm_coffee_1', merchantId: 'merchant_coffee_b', name: '美式咖啡', price: 60, category: '咖啡', soldOut: false, vegetarian: true, tags: ['提神'] },
  { id: 'm_coffee_2', merchantId: 'merchant_coffee_b', name: '拿鐵', price: 70, category: '咖啡', soldOut: false, vegetarian: true, tags: ['熱賣'] },
  { id: 'm_coffee_3', merchantId: 'merchant_coffee_b', name: '卡布奇諾', price: 75, category: '咖啡', soldOut: false, vegetarian: true, tags: [] },
  { id: 'm_coffee_4', merchantId: 'merchant_coffee_b', name: '司康', price: 40, category: '輕食', soldOut: false, vegetarian: true, tags: ['配咖啡'] },
  { id: 'm_coffee_5', merchantId: 'merchant_coffee_b', name: '起司蛋糕', price: 90, category: '甜點', soldOut: false, vegetarian: true, tags: ['熱賣'] },
  // 早餐店
  { id: 'm_break_1', merchantId: 'merchant_breakfast_d', name: '蛋餅', price: 30, category: '中式', soldOut: false, vegetarian: false, tags: ['熱賣', '經濟'] },
  { id: 'm_break_2', merchantId: 'merchant_breakfast_d', name: '鐵板麵', price: 50, category: '西式', soldOut: false, vegetarian: false, tags: ['熱賣'] },
  { id: 'm_break_3', merchantId: 'merchant_breakfast_d', name: '蘿蔔糕', price: 45, category: '中式', soldOut: false, vegetarian: true, tags: [] },
  { id: 'm_break_4', merchantId: 'merchant_breakfast_d', name: '漢堡', price: 55, category: '西式', soldOut: false, vegetarian: false, tags: [] },
  { id: 'm_break_5', merchantId: 'merchant_breakfast_d', name: '豆漿', price: 20, category: '飲品', soldOut: false, vegetarian: true, tags: ['經濟'] },
  // 茶飲
  { id: 'm_drink_1', merchantId: 'merchant_drink_e', name: '珍珠奶茶', price: 55, category: '奶茶', soldOut: false, vegetarian: true, tags: ['熱賣'] },
  { id: 'm_drink_2', merchantId: 'merchant_drink_e', name: '檸檬青茶', price: 40, category: '茶', soldOut: false, vegetarian: true, tags: ['清爽'] },
  { id: 'm_drink_3', merchantId: 'merchant_drink_e', name: '抹茶拿鐵', price: 65, category: '咖啡', soldOut: false, vegetarian: true, tags: ['熱賣'] },
  { id: 'm_drink_4', merchantId: 'merchant_drink_e', name: '芋頭奶茶', price: 60, category: '奶茶', soldOut: false, vegetarian: true, tags: [] },
  // 麵食館
  { id: 'm_noodle_1', merchantId: 'merchant_noodle_f', name: '牛肉麵', price: 120, category: '麵類', soldOut: false, vegetarian: false, tags: ['熱賣', '招牌'] },
  { id: 'm_noodle_2', merchantId: 'merchant_noodle_f', name: '榨菜肉絲麵', price: 75, category: '麵類', soldOut: false, vegetarian: false, tags: ['經濟'] },
  { id: 'm_noodle_3', merchantId: 'merchant_noodle_f', name: '酸辣湯麵', price: 80, category: '麵類', soldOut: false, vegetarian: false, tags: [] },
  // 越南河粉
  { id: 'm_intl_1', merchantId: 'merchant_intl_g', name: '牛肉河粉', price: 120, category: '河粉', soldOut: false, vegetarian: false, tags: ['招牌', '熱賣'] },
  { id: 'm_intl_2', merchantId: 'merchant_intl_g', name: '春捲', price: 60, category: '前菜', soldOut: false, vegetarian: true, tags: ['素食'] },
  { id: 'm_intl_3', merchantId: 'merchant_intl_g', name: '越南咖啡', price: 45, category: '飲品', soldOut: false, vegetarian: true, tags: [] },
];

export function getDemoMenuByMerchant(merchantId: string): DemoMenuItem[] {
  return DEMO_MENU.filter((m) => m.merchantId === merchantId);
}

// ─────────────────────────────────────────────────────────
// 學生 → 餐廳：訂餐 demo 動作（用於 AI 建議「現在去哪訂餐」）
// ─────────────────────────────────────────────────────────

export interface MerchantRecommendation {
  merchantId: string;
  merchantName: string;
  emoji: string;
  reason: string;
  /** 預估等候時間（分鐘） */
  estimatedWaitMinutes: number;
  /** AI 建議分數 0-100 */
  score: number;
}

/**
 * 給學生：依時段 + 等候時間推薦
 */
export function recommendMerchantsForStudent(opts: {
  hour: number;
  preferVegetarian?: boolean;
  budget?: number;
}): MerchantRecommendation[] {
  const open = getOpenMerchants();
  const recs: MerchantRecommendation[] = [];

  for (const m of open) {
    const pending = DEMO_MERCHANT_ORDERS.filter(
      (o) => o.merchantId === m.id && o.status === 'pending',
    ).length;
    const processing = DEMO_MERCHANT_ORDERS.filter(
      (o) => o.merchantId === m.id && o.status === 'processing',
    ).length;
    // 簡單預估等候 = pending × 3 + processing × 2 分鐘
    const wait = Math.max(2, pending * 3 + processing * 2);

    let score = 60;
    let reason = '';

    // 時段匹配
    if (opts.hour >= 6 && opts.hour < 10 && m.category === 'breakfast') {
      score += 30;
      reason = '早餐尖峰時段，最佳選擇';
    } else if (opts.hour >= 11 && opts.hour < 14 && (m.category === 'cafeteria' || m.category === 'noodle' || m.category === 'buffet')) {
      score += 25;
      reason = '午餐時段熱門';
    } else if (opts.hour >= 14 && opts.hour < 17 && (m.category === 'drink' || m.category === 'coffee')) {
      score += 25;
      reason = '下午茶時段';
    } else if (opts.hour >= 17 && opts.hour < 20 && (m.category === 'cafeteria' || m.category === 'noodle' || m.category === 'international')) {
      score += 20;
      reason = '晚餐時段';
    } else {
      reason = '營業中';
    }

    // 等候時間扣分
    if (wait > 15) score -= 15;
    else if (wait > 8) score -= 5;

    // 評分加分
    if (m.rating >= 4.5) score += 10;
    else if (m.rating >= 4.3) score += 5;

    // 預算過濾
    if (opts.budget) {
      const menu = getDemoMenuByMerchant(m.id);
      const affordable = menu.filter((mi) => !mi.soldOut && mi.price <= opts.budget!);
      if (affordable.length === 0) continue;
    }

    // 素食偏好
    if (opts.preferVegetarian) {
      const menu = getDemoMenuByMerchant(m.id);
      const hasVeg = menu.some((mi) => mi.vegetarian && !mi.soldOut);
      if (!hasVeg) continue;
      if (hasVeg) score += 5;
    }

    recs.push({
      merchantId: m.id,
      merchantName: m.name,
      emoji: m.emoji,
      reason,
      estimatedWaitMinutes: wait,
      score: Math.max(0, Math.min(100, score)),
    });
  }

  return recs.sort((a, b) => b.score - a.score);
}
