/* eslint-disable */
/**
 * 靜宜大學校園餐廳真實資料 + 餐廳系統核心資料模型
 *
 * 三間餐廳：靜園餐廳、宜園餐廳、至善美食廣場
 * 三種角色：學生、店家老闆、學校管理員（總務處事務組）
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDb, getFunctionsInstance, getAuthInstance } from '../firebase';
import {
  collection,
  doc,
  query as fsQuery,
  where,
  orderBy as fsOrderBy,
  limit as fsLimit,
  getDocs,
  getDoc,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { CrowdLevel, PoiCrowdReport } from '../data/types';

// ═══════════════════════════════════════════════════════
// 型別定義
// ═══════════════════════════════════════════════════════

export type CafeteriaId = 'jingyuan' | 'yiyuan' | 'zhishan';

/** 餐廳 */
export type Cafeteria = {
  id: CafeteriaId;
  name: string;
  description: string;
  floors: string;
  seats: number;
  location: string;
  openTime: string;
  closeTime: string;
  imageUrl: string | null;
  features: string[];
};

/** 店家 */
export type Vendor = {
  id: string;
  cafeteriaId: CafeteriaId;
  name: string;
  category: VendorCategory;
  description: string;
  floor: string;
  stallNumber: string;
  openTime: string;
  closeTime: string;
  phone: string | null;
  isOpen: boolean;
  rating: number; // 0~5
  ratingCount: number;
  avgPrice: number; // 平均消費
  tags: string[];
  imageUrl: string | null;
  ownerUid: string | null; // 關聯到 auth uid
  menuItems: MenuItem[];
};

export type VendorCategory =
  | 'buffet' // 自助餐
  | 'noodles' // 麵食
  | 'rice' // 飯類/快餐
  | 'brunch' // 早午餐
  | 'vegetarian' // 蔬食
  | 'drinks' // 飲料
  | 'snacks' // 小吃/炸物
  | 'sushi' // 壽司
  | 'braised' // 滷味
  | 'dessert' // 甜點/鬆餅
  | 'convenience' // 便利商店
  | 'fruit' // 水果
  | 'other';

export const CATEGORY_LABELS: Record<VendorCategory, string> = {
  buffet: '自助餐',
  noodles: '麵食',
  rice: '飯類',
  brunch: '早午餐',
  vegetarian: '蔬食',
  drinks: '飲料',
  snacks: '炸物小吃',
  sushi: '壽司',
  braised: '滷味',
  dessert: '甜點',
  convenience: '便利商店',
  fruit: '水果',
  other: '其他',
};

export const CATEGORY_ICONS: Record<VendorCategory, string> = {
  buffet: 'restaurant-outline',
  noodles: 'cafe-outline',
  rice: 'fast-food-outline',
  brunch: 'sunny-outline',
  vegetarian: 'leaf-outline',
  drinks: 'water-outline',
  snacks: 'flame-outline',
  sushi: 'fish-outline',
  braised: 'bonfire-outline',
  dessert: 'ice-cream-outline',
  convenience: 'storefront-outline',
  fruit: 'nutrition-outline',
  other: 'ellipsis-horizontal-outline',
};

/** 菜單品項 */
export type MenuItem = {
  id: string;
  vendorId: string;
  name: string;
  description: string;
  price: number;
  category: string; // 店家自訂分類（主食、配菜、飲料等）
  imageUrl: string | null;
  isAvailable: boolean;
  isPopular: boolean;
  allergens: string[]; // 過敏原
  calories: number | null;
  options: MenuOption[]; // 客製化選項
};

export type MenuOption = {
  name: string; // 例如「加料」「辣度」
  choices: Array<{
    label: string;
    priceAdd: number; // 加價
  }>;
  required: boolean;
};

/** 訂單 */
export type Order = {
  id: string;
  studentUid: string;
  vendorId: string;
  cafeteriaId: CafeteriaId;
  items: OrderItem[];
  totalPrice: number;
  status: OrderStatus;
  note: string;
  createdAt: string; // ISO
  estimatedPickup: string | null;
  /** 可取餐時間（Firestore：readyAt；本地更新 ready 狀態時寫入） */
  readyAt?: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  queueNumber: number | null;
};

export type OrderItem = {
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  selectedOptions: Array<{ optionName: string; choice: string; priceAdd: number }>;
  subtotal: number;
};

export type OrderStatus =
  | 'pending' // 等待店家確認
  | 'confirmed' // 店家已接單
  | 'preparing' // 製作中
  | 'ready' // 可取餐
  | 'completed' // 已完成
  | 'cancelled'; // 已取消

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: '等待確認',
  confirmed: '已接單',
  preparing: '製作中',
  ready: '可取餐',
  completed: '已完成',
  cancelled: '已取消',
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  pending: '#F59E0B',
  confirmed: '#2563EB',
  preparing: '#7C3AED',
  ready: '#16A34A',
  completed: '#6B7280',
  cancelled: '#DC2626',
};

/** 評價 */
export type Review = {
  id: string;
  vendorId: string;
  studentUid: string;
  studentName: string;
  rating: number; // 1~5
  comment: string;
  tags: string[]; // 好吃、份量大、CP值高 等
  createdAt: string;
  orderId: string | null;
};

/** 衛生稽查紀錄（管理員） */
export type InspectionRecord = {
  id: string;
  vendorId: string;
  cafeteriaId: CafeteriaId;
  inspectorName: string;
  date: string;
  score: number; // 0~100
  items: Array<{
    category: string;
    score: number;
    maxScore: number;
    note: string;
  }>;
  overallComment: string;
  passed: boolean;
};

/** 餐廳公告（管理員） */
export type CafeteriaAnnouncement = {
  id: string;
  cafeteriaId: CafeteriaId | 'all';
  title: string;
  content: string;
  priority: 'normal' | 'important' | 'urgent';
  createdAt: string;
  expiresAt: string | null;
  authorName: string;
};

// ═══════════════════════════════════════════════════════
// 靜宜大學三間餐廳真實資料
// ═══════════════════════════════════════════════════════

export const CAFETERIAS: Cafeteria[] = [
  {
    id: 'jingyuan',
    name: '靜園餐廳',
    description:
      '一樓至三樓共有300個座位，供應自助餐、早午餐、快餐、麵食、滷味、蔬食、飲料、壽司、炸物等，是校園內最大的綜合餐廳。',
    floors: '1F~3F',
    seats: 300,
    location: '靜園樓',
    openTime: '07:00',
    closeTime: '19:00',
    imageUrl: 'https://osachc.pu.edu.tw/var/file/67/1067/img/1.jpg.png',
    features: ['自助餐', '壽司', '滷味', '炸物', '蔬食'],
  },
  {
    id: 'yiyuan',
    name: '宜園餐廳',
    description:
      '一樓至二樓共有422個座位，供應自助餐、早午餐、簡餐、麵食、蔬食、飲料等，是座位數最多的餐廳。',
    floors: '1F~2F',
    seats: 422,
    location: '宜園樓',
    openTime: '07:00',
    closeTime: '19:00',
    imageUrl: 'https://osachc.pu.edu.tw/var/file/67/1067/img/2.jpg',
    features: ['自助餐', '簡餐', '麵食', '蔬食'],
  },
  {
    id: 'zhishan',
    name: '至善美食廣場',
    description:
      '一樓至二樓共有220個座位，提供便利商店服務，並供應早午餐、簡餐、麵食、滷味、飲料、水果、鬆餅等。',
    floors: '1F~2F',
    seats: 220,
    location: '至善樓',
    openTime: '07:30',
    closeTime: '20:00',
    imageUrl: 'https://osachc.pu.edu.tw/var/file/67/1067/img/3.jpg',
    features: ['便利商店', '滷味', '水果', '鬆餅'],
  },
];

/** 餐廳人潮演算對應之校園 POI（與 puCampusData / Firestore `pois` id 一致） */
export const CAFETERIA_CROWD_POI_IDS: Record<CafeteriaId, string> = {
  jingyuan: 'pu-jingyuan',
  yiyuan: 'pu-yiyuan',
  zhishan: 'pu-zhishan',
};

export function cafeteriaIdFromCrowdPoiId(poiId: string): CafeteriaId | null {
  const hit = (Object.entries(CAFETERIA_CROWD_POI_IDS) as [CafeteriaId, string][]).find(
    ([, v]) => v === poiId,
  );
  return hit ? hit[0] : null;
}

/** 各餐廳店家（真實資料 + 合理推估；每店家含內嵌 menuItems） */
export const VENDORS: Vendor[] = [
  // ── 靜園餐廳 ──
  {
    id: 'jy-01',
    cafeteriaId: 'jingyuan',
    name: '靜園自助餐',
    category: 'buffet',
    description: '多樣菜色自助選取，飯菜自由搭配，營養均衡',
    floor: '1F',
    stallNumber: 'A1',
    openTime: '11:00',
    closeTime: '13:30',
    phone: null,
    isOpen: true,
    rating: 4.1,
    ratingCount: 328,
    avgPrice: 65,
    tags: ['自助餐', '便宜', '份量大'],
    imageUrl: null,
    ownerUid: 'test-vendor', // 測試店家帳號 UID
    menuItems: [
      // 靜園自助餐
      {
      id: 'm-jy01-01',
      vendorId: 'jy-01',
      name: '三菜一飯',
      description: '白飯＋自選三道菜',
      price: 55,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: null,
      options: [],
      },
      {
      id: 'm-jy01-02',
      vendorId: 'jy-01',
      name: '四菜一飯',
      description: '白飯＋自選四道菜',
      price: 65,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: null,
      options: [],
      },
      {
      id: 'm-jy01-03',
      vendorId: 'jy-01',
      name: '五菜一飯',
      description: '白飯＋自選五道菜',
      price: 75,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: null,
      options: [],
      },
      {
      id: 'm-jy01-04',
      vendorId: 'jy-01',
      name: '加湯',
      description: '今日例湯（紫菜蛋花/味噌/玉米濃湯輪替）',
      price: 10,
      category: '湯品',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: null,
      options: [],
      },
      {
      id: 'm-jy01-05',
      vendorId: 'jy-01',
      name: '滷蛋',
      description: '入味滷蛋一顆',
      price: 10,
      category: '配菜',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['蛋'],
      calories: 80,
      options: [],
      },
    ]
  },
  {
    id: 'jy-02',
    cafeteriaId: 'jingyuan',
    name: '麵食坊',
    category: 'noodles',
    description: '各式湯麵、乾麵、炒麵，湯頭鮮美',
    floor: '1F',
    stallNumber: 'A2',
    openTime: '10:30',
    closeTime: '14:00',
    phone: null,
    isOpen: true,
    rating: 4.0,
    ratingCount: 215,
    avgPrice: 55,
    tags: ['麵食', '湯麵', '實惠'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 麵食坊
      {
      id: 'm-jy02-01',
      vendorId: 'jy-02',
      name: '陽春麵',
      description: '清湯陽春麵附青菜',
      price: 35,
      category: '湯麵',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['麩質'],
      calories: 380,
      options: [
      {
      name: '加料',
      choices: [
      { label: '不加', priceAdd: 0 },
      { label: '加蛋', priceAdd: 10 },
      { label: '加肉片', priceAdd: 15 },
      ],
      required: false,
      },
      ],
      },
      {
      id: 'm-jy02-02',
      vendorId: 'jy-02',
      name: '榨菜肉絲麵',
      description: '榨菜肉絲湯麵，鹹香開胃',
      price: 50,
      category: '湯麵',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 450,
      options: [],
      },
      {
      id: 'm-jy02-03',
      vendorId: 'jy-02',
      name: '麻醬乾麵',
      description: '花生芝麻醬拌麵，附小菜',
      price: 45,
      category: '乾麵',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質', '花生', '芝麻'],
      calories: 520,
      options: [],
      },
      {
      id: 'm-jy02-04',
      vendorId: 'jy-02',
      name: '餛飩麵',
      description: '鮮肉餛飩湯麵',
      price: 55,
      category: '湯麵',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['麩質'],
      calories: 480,
      options: [],
      },
      {
      id: 'm-jy02-05',
      vendorId: 'jy-02',
      name: '炒麵',
      description: '什錦炒麵（豬肉、高麗菜、紅蘿蔔）',
      price: 50,
      category: '乾麵',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['麩質'],
      calories: 550,
      options: [],
      },
      {
      id: 'm-jy02-06',
      vendorId: 'jy-02',
      name: '酸辣湯',
      description: '酸辣湯一碗',
      price: 30,
      category: '湯品',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['蛋'],
      calories: 120,
      options: [],
      },
    ]
  },
  {
    id: 'jy-03',
    cafeteriaId: 'jingyuan',
    name: '壽司屋',
    category: 'sushi',
    description: '平價手捲壽司、握壽司、花壽司',
    floor: '1F',
    stallNumber: 'A3',
    openTime: '10:00',
    closeTime: '14:00',
    phone: null,
    isOpen: true,
    rating: 4.3,
    ratingCount: 187,
    avgPrice: 45,
    tags: ['壽司', '日式', '平價'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 壽司屋
      {
      id: 'm-jy03-01',
      vendorId: 'jy-03',
      name: '鮭魚握壽司（2入）',
      description: '新鮮鮭魚握壽司',
      price: 50,
      category: '握壽司',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['魚'],
      calories: 180,
      options: [],
      },
      {
      id: 'm-jy03-02',
      vendorId: 'jy-03',
      name: '鮪魚握壽司（2入）',
      description: '鮪魚握壽司',
      price: 45,
      category: '握壽司',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['魚'],
      calories: 160,
      options: [],
      },
      {
      id: 'm-jy03-03',
      vendorId: 'jy-03',
      name: '蝦卵手捲',
      description: '海苔手捲加蝦卵',
      price: 35,
      category: '手捲',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['蝦'],
      calories: 140,
      options: [],
      },
      {
      id: 'm-jy03-04',
      vendorId: 'jy-03',
      name: '花壽司（8入）',
      description: '小黃瓜、肉鬆、蛋花壽司捲',
      price: 40,
      category: '花壽司',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['蛋', '麩質'],
      calories: 320,
      options: [],
      },
      {
      id: 'm-jy03-05',
      vendorId: 'jy-03',
      name: '綜合壽司盒',
      description: '握壽司3種+花壽司4入',
      price: 80,
      category: '組合',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['魚', '蛋'],
      calories: 480,
      options: [],
      },
      {
      id: 'm-jy03-06',
      vendorId: 'jy-03',
      name: '味噌湯',
      description: '日式味噌湯附豆腐海帶',
      price: 20,
      category: '湯品',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['大豆'],
      calories: 60,
      options: [],
      },
    ]
  },
  {
    id: 'jy-04',
    cafeteriaId: 'jingyuan',
    name: '滷味攤',
    category: 'braised',
    description: '自選滷味、關東煮，現滷現吃',
    floor: '1F',
    stallNumber: 'A4',
    openTime: '10:30',
    closeTime: '19:00',
    phone: null,
    isOpen: true,
    rating: 4.2,
    ratingCount: 276,
    avgPrice: 50,
    tags: ['滷味', '關東煮', '宵夜'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 滷味攤
      {
      id: 'm-jy04-01',
      vendorId: 'jy-04',
      name: '滷味拼盤（小）',
      description: '自選 5 樣滷味',
      price: 40,
      category: '滷味',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: null,
      options: [
      {
      name: '辣度',
      choices: [
      { label: '不辣', priceAdd: 0 },
      { label: '小辣', priceAdd: 0 },
      { label: '大辣', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-jy04-02',
      vendorId: 'jy-04',
      name: '滷味拼盤（大）',
      description: '自選 8 樣滷味',
      price: 60,
      category: '滷味',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: null,
      options: [
      {
      name: '辣度',
      choices: [
      { label: '不辣', priceAdd: 0 },
      { label: '小辣', priceAdd: 0 },
      { label: '大辣', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-jy04-03',
      vendorId: 'jy-04',
      name: '關東煮（3串）',
      description: '白蘿蔔、黑輪、貢丸等',
      price: 30,
      category: '關東煮',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['魚'],
      calories: 200,
      options: [],
      },
      {
      id: 'm-jy04-04',
      vendorId: 'jy-04',
      name: '關東煮（5串）',
      description: '任選五串關東煮',
      price: 50,
      category: '關東煮',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['魚'],
      calories: 330,
      options: [],
      },
      {
      id: 'm-jy04-05',
      vendorId: 'jy-04',
      name: '滷大腸',
      description: '軟嫩滷大腸一份',
      price: 35,
      category: '單點',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: 280,
      options: [],
      },
      {
      id: 'm-jy04-06',
      vendorId: 'jy-04',
      name: '王子麵（加滷味）',
      description: '王子麵搭配滷味湯底',
      price: 25,
      category: '加購',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['麩質'],
      calories: 350,
      options: [],
      },
    ]
  },
  {
    id: 'jy-05',
    cafeteriaId: 'jingyuan',
    name: '炸雞大師',
    category: 'snacks',
    description: '酥脆炸雞、雞排、薯條、炸物拼盤',
    floor: '2F',
    stallNumber: 'B1',
    openTime: '10:00',
    closeTime: '18:00',
    phone: null,
    isOpen: true,
    rating: 4.4,
    ratingCount: 412,
    avgPrice: 55,
    tags: ['炸雞', '雞排', '學生最愛'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 炸雞大師
      {
      id: 'm-jy05-01',
      vendorId: 'jy-05',
      name: '香酥雞排',
      description: '整塊雞胸肉裹粉酥炸，外酥內嫩',
      price: 55,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 520,
      options: [
      {
      name: '辣度',
      choices: [
      { label: '不辣', priceAdd: 0 },
      { label: '小辣', priceAdd: 0 },
      { label: '中辣', priceAdd: 0 },
      { label: '大辣', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-jy05-02',
      vendorId: 'jy-05',
      name: '酥脆雞塊（6入）',
      description: '一口大小酥脆雞塊',
      price: 40,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 380,
      options: [],
      },
      {
      id: 'm-jy05-03',
      vendorId: 'jy-05',
      name: '薯條',
      description: '金黃酥脆薯條',
      price: 30,
      category: '配餐',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: 280,
      options: [
      {
      name: '份量',
      choices: [
      { label: '小', priceAdd: 0 },
      { label: '大', priceAdd: 15 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-jy05-04',
      vendorId: 'jy-05',
      name: '炸物拼盤',
      description: '雞塊+薯條+洋蔥圈+雞米花',
      price: 80,
      category: '組合',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 750,
      options: [],
      },
      {
      id: 'm-jy05-05',
      vendorId: 'jy-05',
      name: '雞米花',
      description: '一口酥炸雞米花',
      price: 35,
      category: '配餐',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['麩質'],
      calories: 320,
      options: [],
      },
      {
      id: 'm-jy05-06',
      vendorId: 'jy-05',
      name: '可樂',
      description: '冰涼可樂 350ml',
      price: 20,
      category: '飲料',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: 140,
      options: [],
      },
    ]
  },
  {
    id: 'jy-06',
    cafeteriaId: 'jingyuan',
    name: '蔬食小棧',
    category: 'vegetarian',
    description: '健康蔬食料理，素食便當、沙拉',
    floor: '2F',
    stallNumber: 'B2',
    openTime: '11:00',
    closeTime: '14:00',
    phone: null,
    isOpen: true,
    rating: 3.9,
    ratingCount: 98,
    avgPrice: 60,
    tags: ['素食', '健康', '蔬食'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 蔬食小棧
      {
      id: 'm-jy06-01',
      vendorId: 'jy-06',
      name: '素食便當',
      description: '五穀飯＋三道素菜＋素湯',
      price: 60,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['大豆'],
      calories: 450,
      options: [],
      },
      {
      id: 'm-jy06-02',
      vendorId: 'jy-06',
      name: '蔬菜沙拉',
      description: '新鮮生菜沙拉附和風醬',
      price: 45,
      category: '輕食',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: 180,
      options: [
      {
      name: '醬料',
      choices: [
      { label: '和風醬', priceAdd: 0 },
      { label: '凱薩醬', priceAdd: 0 },
      { label: '油醋醬', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-jy06-03',
      vendorId: 'jy-06',
      name: '素水餃（10入）',
      description: '高麗菜豆腐素水餃',
      price: 50,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質', '大豆'],
      calories: 380,
      options: [],
      },
      {
      id: 'm-jy06-04',
      vendorId: 'jy-06',
      name: '養生湯',
      description: '當日養生燉湯（蓮藕/山藥/四神）',
      price: 35,
      category: '湯品',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: 90,
      options: [],
      },
      {
      id: 'm-jy06-05',
      vendorId: 'jy-06',
      name: '豆漿',
      description: '無糖/微糖豆漿',
      price: 20,
      category: '飲料',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['大豆'],
      calories: 120,
      options: [
      {
      name: '甜度',
      choices: [
      { label: '無糖', priceAdd: 0 },
      { label: '微糖', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
    ]
  },
  {
    id: 'jy-07',
    cafeteriaId: 'jingyuan',
    name: '快餐便當',
    category: 'rice',
    description: '現做便當、燒肉飯、雞腿飯、排骨飯',
    floor: '2F',
    stallNumber: 'B3',
    openTime: '10:30',
    closeTime: '14:00',
    phone: null,
    isOpen: true,
    rating: 4.0,
    ratingCount: 305,
    avgPrice: 70,
    tags: ['便當', '快餐', '飯類'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 快餐便當
      {
      id: 'm-jy07-01',
      vendorId: 'jy-07',
      name: '雞腿飯',
      description: '滷雞腿＋三配菜＋白飯＋湯',
      price: 75,
      category: '便當',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: 680,
      options: [],
      },
      {
      id: 'm-jy07-02',
      vendorId: 'jy-07',
      name: '排骨飯',
      description: '炸排骨＋三配菜＋白飯＋湯',
      price: 70,
      category: '便當',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 720,
      options: [],
      },
      {
      id: 'm-jy07-03',
      vendorId: 'jy-07',
      name: '燒肉飯',
      description: '蒜味燒肉＋滷蛋＋配菜＋白飯',
      price: 65,
      category: '便當',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['蛋'],
      calories: 650,
      options: [],
      },
      {
      id: 'm-jy07-04',
      vendorId: 'jy-07',
      name: '魚排飯',
      description: '酥炸鱈魚排＋三配菜＋白飯＋湯',
      price: 70,
      category: '便當',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['魚', '麩質'],
      calories: 600,
      options: [],
      },
      {
      id: 'm-jy07-05',
      vendorId: 'jy-07',
      name: '加飯',
      description: '白飯加大一份',
      price: 5,
      category: '加購',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: 200,
      options: [],
      },
      {
      id: 'm-jy07-06',
      vendorId: 'jy-07',
      name: '加滷蛋',
      description: '滷蛋一顆',
      price: 10,
      category: '加購',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['蛋'],
      calories: 80,
      options: [],
      },
    ]
  },
  {
    id: 'jy-08',
    cafeteriaId: 'jingyuan',
    name: '早安晨光',
    category: 'brunch',
    description: '早餐三明治、蛋餅、漢堡、吐司',
    floor: '1F',
    stallNumber: 'A5',
    openTime: '07:00',
    closeTime: '11:00',
    phone: null,
    isOpen: true,
    rating: 4.1,
    ratingCount: 189,
    avgPrice: 40,
    tags: ['早餐', '蛋餅', '三明治'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 早安晨光
      {
      id: 'm-jy08-01',
      vendorId: 'jy-08',
      name: '原味蛋餅',
      description: '手工蛋餅皮，煎蛋夾起司',
      price: 30,
      category: '蛋餅',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['蛋', '奶', '麩質'],
      calories: 280,
      options: [],
      },
      {
      id: 'm-jy08-02',
      vendorId: 'jy-08',
      name: '玉米蛋餅',
      description: '甜玉米粒蛋餅',
      price: 35,
      category: '蛋餅',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['蛋', '麩質'],
      calories: 310,
      options: [],
      },
      {
      id: 'm-jy08-03',
      vendorId: 'jy-08',
      name: '培根蛋餅',
      description: '燻培根蛋餅',
      price: 40,
      category: '蛋餅',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['蛋', '麩質'],
      calories: 380,
      options: [],
      },
      {
      id: 'm-jy08-04',
      vendorId: 'jy-08',
      name: '火腿三明治',
      description: '火腿起司三明治附生菜',
      price: 35,
      category: '三明治',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質', '奶'],
      calories: 350,
      options: [],
      },
      {
      id: 'm-jy08-05',
      vendorId: 'jy-08',
      name: '鮪魚三明治',
      description: '鮪魚沙拉三明治',
      price: 40,
      category: '三明治',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['魚', '蛋', '麩質'],
      calories: 380,
      options: [],
      },
      {
      id: 'm-jy08-06',
      vendorId: 'jy-08',
      name: '牛肉漢堡',
      description: '牛肉排漢堡附薯餅',
      price: 50,
      category: '漢堡',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質', '蛋'],
      calories: 520,
      options: [],
      },
      {
      id: 'm-jy08-07',
      vendorId: 'jy-08',
      name: '大冰奶',
      description: '古早味紅茶奶茶',
      price: 25,
      category: '飲料',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['奶'],
      calories: 180,
      options: [
      {
      name: '甜度',
      choices: [
      { label: '全糖', priceAdd: 0 },
      { label: '半糖', priceAdd: 0 },
      { label: '微糖', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-jy08-08',
      vendorId: 'jy-08',
      name: '豆漿',
      description: '現磨豆漿（冰/熱）',
      price: 20,
      category: '飲料',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['大豆'],
      calories: 120,
      options: [
      {
      name: '溫度',
      choices: [
      { label: '冰', priceAdd: 0 },
      { label: '熱', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
    ]
  },
  {
    id: 'jy-09',
    cafeteriaId: 'jingyuan',
    name: '茶飲小站',
    category: 'drinks',
    description: '手搖飲料、珍珠奶茶、果汁、咖啡',
    floor: '1F',
    stallNumber: 'A6',
    openTime: '08:00',
    closeTime: '18:00',
    phone: null,
    isOpen: true,
    rating: 4.0,
    ratingCount: 356,
    avgPrice: 35,
    tags: ['飲料', '珍奶', '咖啡'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 茶飲小站
      {
      id: 'm-jy09-01',
      vendorId: 'jy-09',
      name: '珍珠奶茶',
      description: '黑糖珍珠鮮奶茶',
      price: 40,
      category: '奶茶',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['奶'],
      calories: 350,
      options: [
      {
      name: '甜度',
      choices: [
      { label: '全糖', priceAdd: 0 },
      { label: '七分', priceAdd: 0 },
      { label: '半糖', priceAdd: 0 },
      { label: '三分', priceAdd: 0 },
      { label: '無糖', priceAdd: 0 },
      ],
      required: true,
      },
      {
      name: '冰量',
      choices: [
      { label: '正常冰', priceAdd: 0 },
      { label: '少冰', priceAdd: 0 },
      { label: '去冰', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-jy09-02',
      vendorId: 'jy-09',
      name: '四季春茶',
      description: '清香四季春綠茶',
      price: 25,
      category: '純茶',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: 80,
      options: [
      {
      name: '甜度',
      choices: [
      { label: '全糖', priceAdd: 0 },
      { label: '半糖', priceAdd: 0 },
      { label: '無糖', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-jy09-03',
      vendorId: 'jy-09',
      name: '冬瓜鮮奶',
      description: '冬瓜糖漿配鮮奶',
      price: 35,
      category: '鮮奶',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['奶'],
      calories: 280,
      options: [],
      },
      {
      id: 'm-jy09-04',
      vendorId: 'jy-09',
      name: '檸檬綠茶',
      description: '新鮮檸檬搭配綠茶',
      price: 35,
      category: '果茶',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: 120,
      options: [],
      },
      {
      id: 'm-jy09-05',
      vendorId: 'jy-09',
      name: '美式咖啡',
      description: '現磨阿拉比卡咖啡',
      price: 35,
      category: '咖啡',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: 10,
      options: [
      {
      name: '溫度',
      choices: [
      { label: '冰', priceAdd: 0 },
      { label: '熱', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-jy09-06',
      vendorId: 'jy-09',
      name: '拿鐵咖啡',
      description: '義式濃縮加鮮奶',
      price: 45,
      category: '咖啡',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['奶'],
      calories: 180,
      options: [
      {
      name: '溫度',
      choices: [
      { label: '冰', priceAdd: 0 },
      { label: '熱', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
    ]
  },

  // ── 宜園餐廳 ──
  {
    id: 'yy-01',
    cafeteriaId: 'yiyuan',
    name: '宜園自助餐',
    category: 'buffet',
    description: '三菜一湯自助選配，提供白飯吃到飽',
    floor: '1F',
    stallNumber: 'C1',
    openTime: '11:00',
    closeTime: '13:30',
    phone: null,
    isOpen: true,
    rating: 4.0,
    ratingCount: 289,
    avgPrice: 60,
    tags: ['自助餐', '白飯吃到飽', '經濟'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 宜園自助餐
      {
      id: 'm-yy01-01',
      vendorId: 'yy-01',
      name: '三菜一飯',
      description: '白飯吃到飽＋自選三道菜',
      price: 50,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: null,
      options: [],
      },
      {
      id: 'm-yy01-02',
      vendorId: 'yy-01',
      name: '四菜一飯',
      description: '白飯吃到飽＋自選四道菜',
      price: 60,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: null,
      options: [],
      },
      {
      id: 'm-yy01-03',
      vendorId: 'yy-01',
      name: '五菜一飯',
      description: '白飯吃到飽＋自選五道菜',
      price: 70,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: null,
      options: [],
      },
      {
      id: 'm-yy01-04',
      vendorId: 'yy-01',
      name: '例湯',
      description: '當日例湯免費續碗',
      price: 0,
      category: '附餐',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: null,
      options: [],
      },
    ]
  },
  {
    id: 'yy-02',
    cafeteriaId: 'yiyuan',
    name: '鍋燒意麵',
    category: 'noodles',
    description: '鍋燒意麵、烏龍麵、拉麵，附小菜',
    floor: '1F',
    stallNumber: 'C2',
    openTime: '10:30',
    closeTime: '14:00',
    phone: null,
    isOpen: true,
    rating: 4.2,
    ratingCount: 231,
    avgPrice: 55,
    tags: ['鍋燒', '意麵', '冬天首選'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 鍋燒意麵
      {
      id: 'm-yy02-01',
      vendorId: 'yy-02',
      name: '鍋燒意麵',
      description: '大骨湯底鍋燒意麵，附蛋和蔬菜',
      price: 55,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['蛋', '麩質'],
      calories: 520,
      options: [
      {
      name: '辣度',
      choices: [
      { label: '不辣', priceAdd: 0 },
      { label: '小辣', priceAdd: 0 },
      { label: '大辣', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-yy02-02',
      vendorId: 'yy-02',
      name: '鍋燒烏龍麵',
      description: 'Q彈烏龍麵鍋燒',
      price: 55,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['蛋', '麩質'],
      calories: 500,
      options: [],
      },
      {
      id: 'm-yy02-03',
      vendorId: 'yy-02',
      name: '日式拉麵',
      description: '豚骨湯底拉麵附溏心蛋',
      price: 65,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['蛋', '麩質'],
      calories: 620,
      options: [],
      },
      {
      id: 'm-yy02-04',
      vendorId: 'yy-02',
      name: '海鮮鍋燒',
      description: '蝦仁、蛤蜊、花枝鍋燒麵',
      price: 70,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['蝦', '貝類', '麩質'],
      calories: 550,
      options: [],
      },
      {
      id: 'm-yy02-05',
      vendorId: 'yy-02',
      name: '泡菜鍋',
      description: '韓式泡菜鍋附飯',
      price: 65,
      category: '鍋物',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: 580,
      options: [],
      },
    ]
  },
  {
    id: 'yy-03',
    cafeteriaId: 'yiyuan',
    name: '家常簡餐',
    category: 'rice',
    description: '雞腿飯、豬排飯、魚排飯，附湯和小菜',
    floor: '1F',
    stallNumber: 'C3',
    openTime: '11:00',
    closeTime: '14:00',
    phone: null,
    isOpen: true,
    rating: 4.1,
    ratingCount: 198,
    avgPrice: 70,
    tags: ['簡餐', '家常', '附湯'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 家常簡餐
      {
      id: 'm-yy03-01',
      vendorId: 'yy-03',
      name: '雞腿飯',
      description: '滷雞腿附三菜一湯一飯',
      price: 75,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: 700,
      options: [],
      },
      {
      id: 'm-yy03-02',
      vendorId: 'yy-03',
      name: '豬排飯',
      description: '日式炸豬排附三菜一湯一飯',
      price: 70,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質', '蛋'],
      calories: 750,
      options: [],
      },
      {
      id: 'm-yy03-03',
      vendorId: 'yy-03',
      name: '魚排飯',
      description: '酥炸魚排附三菜一湯一飯',
      price: 70,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['魚', '麩質'],
      calories: 650,
      options: [],
      },
      {
      id: 'm-yy03-04',
      vendorId: 'yy-03',
      name: '控肉飯',
      description: '紅燒控肉附筍絲、滷蛋、配菜',
      price: 65,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['蛋'],
      calories: 680,
      options: [],
      },
      {
      id: 'm-yy03-05',
      vendorId: 'yy-03',
      name: '味噌湯',
      description: '附餐味噌湯',
      price: 10,
      category: '湯品',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['大豆'],
      calories: 45,
      options: [],
      },
    ]
  },
  {
    id: 'yy-04',
    cafeteriaId: 'yiyuan',
    name: '蔬食園地',
    category: 'vegetarian',
    description: '素食簡餐、蔬菜咖哩、養生湯品',
    floor: '1F',
    stallNumber: 'C4',
    openTime: '11:00',
    closeTime: '14:00',
    phone: null,
    isOpen: true,
    rating: 3.8,
    ratingCount: 76,
    avgPrice: 60,
    tags: ['素食', '咖哩', '養生'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 蔬食園地
      {
      id: 'm-yy04-01',
      vendorId: 'yy-04',
      name: '素食簡餐',
      description: '五穀飯＋四道素菜＋素湯',
      price: 60,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['大豆'],
      calories: 420,
      options: [],
      },
      {
      id: 'm-yy04-02',
      vendorId: 'yy-04',
      name: '蔬菜咖哩飯',
      description: '椰香蔬菜咖哩配白飯',
      price: 65,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['大豆'],
      calories: 480,
      options: [
      {
      name: '辣度',
      choices: [
      { label: '不辣', priceAdd: 0 },
      { label: '微辣', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-yy04-03',
      vendorId: 'yy-04',
      name: '養生粥',
      description: '紅豆薏仁粥或南瓜粥',
      price: 40,
      category: '輕食',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: 250,
      options: [],
      },
      {
      id: 'm-yy04-04',
      vendorId: 'yy-04',
      name: '蔬菜捲餅',
      description: '全麥餅皮包生菜、酪梨、豆腐',
      price: 55,
      category: '輕食',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['麩質', '大豆'],
      calories: 350,
      options: [],
      },
      {
      id: 'm-yy04-05',
      vendorId: 'yy-04',
      name: '青草茶',
      description: '古早味青草茶',
      price: 20,
      category: '飲料',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: 60,
      options: [],
      },
    ]
  },
  {
    id: 'yy-05',
    cafeteriaId: 'yiyuan',
    name: '陽光早餐',
    category: 'brunch',
    description: '傳統早餐、蘿蔔糕、豆漿、煎餃',
    floor: '1F',
    stallNumber: 'C5',
    openTime: '07:00',
    closeTime: '10:30',
    phone: null,
    isOpen: true,
    rating: 4.0,
    ratingCount: 167,
    avgPrice: 35,
    tags: ['早餐', '傳統', '豆漿'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 陽光早餐
      {
      id: 'm-yy05-01',
      vendorId: 'yy-05',
      name: '蘿蔔糕',
      description: '煎蘿蔔糕附醬油膏',
      price: 25,
      category: '傳統',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 220,
      options: [],
      },
      {
      id: 'm-yy05-02',
      vendorId: 'yy-05',
      name: '煎餃（8入）',
      description: '現煎鮮肉煎餃',
      price: 35,
      category: '傳統',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 380,
      options: [],
      },
      {
      id: 'm-yy05-03',
      vendorId: 'yy-05',
      name: '燒餅油條',
      description: '酥脆燒餅夾油條',
      price: 30,
      category: '傳統',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 450,
      options: [
      {
      name: '加料',
      choices: [
      { label: '不加', priceAdd: 0 },
      { label: '加蛋', priceAdd: 10 },
      ],
      required: false,
      },
      ],
      },
      {
      id: 'm-yy05-04',
      vendorId: 'yy-05',
      name: '飯糰',
      description: '糯米飯糰（油條、肉鬆、酸菜）',
      price: 35,
      category: '傳統',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 420,
      options: [],
      },
      {
      id: 'm-yy05-05',
      vendorId: 'yy-05',
      name: '豆漿',
      description: '現磨無糖/甜豆漿',
      price: 15,
      category: '飲料',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['大豆'],
      calories: 120,
      options: [
      {
      name: '甜度',
      choices: [
      { label: '無糖', priceAdd: 0 },
      { label: '甜', priceAdd: 0 },
      ],
      required: true,
      },
      {
      name: '溫度',
      choices: [
      { label: '冰', priceAdd: 0 },
      { label: '熱', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-yy05-06',
      vendorId: 'yy-05',
      name: '米漿',
      description: '花生米漿',
      price: 20,
      category: '飲料',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['花生'],
      calories: 180,
      options: [],
      },
    ]
  },
  {
    id: 'yy-06',
    cafeteriaId: 'yiyuan',
    name: '韓式料理',
    category: 'rice',
    description: '韓式拌飯、部隊鍋、韓式炸雞',
    floor: '2F',
    stallNumber: 'D1',
    openTime: '11:00',
    closeTime: '14:00',
    phone: null,
    isOpen: true,
    rating: 4.3,
    ratingCount: 243,
    avgPrice: 75,
    tags: ['韓式', '拌飯', '部隊鍋'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 韓式料理
      {
      id: 'm-yy06-01',
      vendorId: 'yy-06',
      name: '韓式拌飯',
      description: '石鍋拌飯附泡菜小菜',
      price: 75,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['蛋', '芝麻'],
      calories: 580,
      options: [
      {
      name: '加蛋',
      choices: [
      { label: '荷包蛋', priceAdd: 10 },
      { label: '不加', priceAdd: 0 },
      ],
      required: false,
      },
      ],
      },
      {
      id: 'm-yy06-02',
      vendorId: 'yy-06',
      name: '部隊鍋',
      description: '韓式部隊火鍋附飯',
      price: 90,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: 720,
      options: [
      {
      name: '辣度',
      choices: [
      { label: '小辣', priceAdd: 0 },
      { label: '中辣', priceAdd: 0 },
      { label: '大辣', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-yy06-03',
      vendorId: 'yy-06',
      name: '韓式炸雞',
      description: '甜辣醬韓式炸雞',
      price: 70,
      category: '副食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 480,
      options: [],
      },
      {
      id: 'm-yy06-04',
      vendorId: 'yy-06',
      name: '辣炒年糕',
      description: 'Q彈年糕配甜辣醬',
      price: 50,
      category: '副食',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['麩質'],
      calories: 350,
      options: [],
      },
      {
      id: 'm-yy06-05',
      vendorId: 'yy-06',
      name: '海苔飯捲',
      description: '韓式紫菜飯捲（4入）',
      price: 45,
      category: '副食',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['芝麻'],
      calories: 280,
      options: [],
      },
    ]
  },
  {
    id: 'yy-07',
    cafeteriaId: 'yiyuan',
    name: '茶之道',
    category: 'drinks',
    description: '各式茶飲、冬瓜茶、青茶、奶蓋系列',
    floor: '2F',
    stallNumber: 'D2',
    openTime: '08:00',
    closeTime: '18:00',
    phone: null,
    isOpen: true,
    rating: 3.9,
    ratingCount: 201,
    avgPrice: 30,
    tags: ['飲料', '茶飲', '便宜'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 茶之道
      {
      id: 'm-yy07-01',
      vendorId: 'yy-07',
      name: '冬瓜茶',
      description: '古法熬煮冬瓜茶',
      price: 20,
      category: '純茶',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: 120,
      options: [
      {
      name: '冰量',
      choices: [
      { label: '正常冰', priceAdd: 0 },
      { label: '少冰', priceAdd: 0 },
      { label: '去冰', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-yy07-02',
      vendorId: 'yy-07',
      name: '青茶',
      description: '清香烏龍青茶',
      price: 25,
      category: '純茶',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: 30,
      options: [
      {
      name: '甜度',
      choices: [
      { label: '全糖', priceAdd: 0 },
      { label: '半糖', priceAdd: 0 },
      { label: '無糖', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-yy07-03',
      vendorId: 'yy-07',
      name: '奶蓋綠茶',
      description: '鹹香奶蓋搭配清爽綠茶',
      price: 35,
      category: '奶蓋',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['奶'],
      calories: 250,
      options: [],
      },
      {
      id: 'm-yy07-04',
      vendorId: 'yy-07',
      name: '珍珠鮮奶茶',
      description: '黑糖珍珠配鮮奶茶',
      price: 35,
      category: '奶茶',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['奶'],
      calories: 320,
      options: [],
      },
      {
      id: 'm-yy07-05',
      vendorId: 'yy-07',
      name: '百香果綠茶',
      description: '新鮮百香果搭配綠茶',
      price: 30,
      category: '果茶',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: 100,
      options: [],
      },
    ]
  },
  {
    id: 'yy-08',
    cafeteriaId: 'yiyuan',
    name: '水餃大王',
    category: 'noodles',
    description: '手工水餃、酸辣湯、餛飩湯',
    floor: '2F',
    stallNumber: 'D3',
    openTime: '11:00',
    closeTime: '14:00',
    phone: null,
    isOpen: true,
    rating: 4.1,
    ratingCount: 156,
    avgPrice: 50,
    tags: ['水餃', '手工', '湯品'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 水餃大王
      {
      id: 'm-yy08-01',
      vendorId: 'yy-08',
      name: '水餃（10入）',
      description: '手工鮮肉水餃',
      price: 45,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 420,
      options: [
      {
      name: '醬料',
      choices: [
      { label: '醬油', priceAdd: 0 },
      { label: '辣油', priceAdd: 0 },
      { label: '醬油+辣油', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-yy08-02',
      vendorId: 'yy-08',
      name: '水餃（15入）',
      description: '手工鮮肉水餃加量',
      price: 60,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 630,
      options: [],
      },
      {
      id: 'm-yy08-03',
      vendorId: 'yy-08',
      name: '酸辣湯',
      description: '酸辣湯附豆腐蛋花',
      price: 30,
      category: '湯品',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['蛋', '大豆'],
      calories: 120,
      options: [],
      },
      {
      id: 'm-yy08-04',
      vendorId: 'yy-08',
      name: '餛飩湯',
      description: '鮮肉餛飩清湯',
      price: 40,
      category: '湯品',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['麩質'],
      calories: 200,
      options: [],
      },
      {
      id: 'm-yy08-05',
      vendorId: 'yy-08',
      name: '乾拌麵',
      description: '蔥油乾拌麵附小黃瓜',
      price: 35,
      category: '麵類',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['麩質', '芝麻'],
      calories: 380,
      options: [],
      },
      {
      id: 'm-yy08-06',
      vendorId: 'yy-08',
      name: '小菜拼盤',
      description: '小黃瓜、豆干、海帶三拼',
      price: 30,
      category: '小菜',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['大豆'],
      calories: 100,
      options: [],
      },
    ]
  },

  // ── 至善美食廣場 ──
  {
    id: 'zs-01',
    cafeteriaId: 'zhishan',
    name: 'OK便利商店',
    category: 'convenience',
    description: 'OK mart 靜宜至善店，提供各式便利商品',
    floor: '1F',
    stallNumber: 'E1',
    openTime: '07:30',
    closeTime: '21:00',
    phone: null,
    isOpen: true,
    rating: 3.7,
    ratingCount: 89,
    avgPrice: 45,
    tags: ['便利商店', '飲料', '零食'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // OK便利商店
      {
      id: 'm-zs01-01',
      vendorId: 'zs-01',
      name: '御飯糰',
      description: '鮪魚/鮭魚/昆布口味',
      price: 28,
      category: '輕食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['魚'],
      calories: 200,
      options: [
      {
      name: '口味',
      choices: [
      { label: '鮪魚', priceAdd: 0 },
      { label: '鮭魚', priceAdd: 0 },
      { label: '昆布', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-zs01-02',
      vendorId: 'zs-01',
      name: '國民便當',
      description: '微波加熱即食便當',
      price: 65,
      category: '便當',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: 550,
      options: [],
      },
      {
      id: 'm-zs01-03',
      vendorId: 'zs-01',
      name: '關東煮',
      description: '自選關東煮（白蘿蔔/黑輪/貢丸）',
      price: 15,
      category: '熱食',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['魚'],
      calories: 60,
      options: [],
      },
      {
      id: 'm-zs01-04',
      vendorId: 'zs-01',
      name: '美式咖啡',
      description: '現磨美式咖啡',
      price: 35,
      category: '飲料',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: 10,
      options: [
      {
      name: '大小',
      choices: [
      { label: '中杯', priceAdd: 0 },
      { label: '大杯', priceAdd: 10 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-zs01-05',
      vendorId: 'zs-01',
      name: '拿鐵',
      description: '現磨拿鐵咖啡',
      price: 45,
      category: '飲料',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['奶'],
      calories: 180,
      options: [],
      },
    ]
  },
  {
    id: 'zs-02',
    cafeteriaId: 'zhishan',
    name: '元氣早午餐',
    category: 'brunch',
    description: '漢堡、三明治、歐姆蛋、鐵板麵',
    floor: '1F',
    stallNumber: 'E2',
    openTime: '07:30',
    closeTime: '14:00',
    phone: null,
    isOpen: true,
    rating: 4.2,
    ratingCount: 178,
    avgPrice: 45,
    tags: ['早午餐', '漢堡', '鐵板麵'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 元氣早午餐
      {
      id: 'm-zs02-01',
      vendorId: 'zs-02',
      name: '經典漢堡',
      description: '牛肉漢堡附薯條和飲料',
      price: 60,
      category: '漢堡',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質', '蛋'],
      calories: 650,
      options: [],
      },
      {
      id: 'm-zs02-02',
      vendorId: 'zs-02',
      name: '雞腿堡',
      description: '酥炸雞腿排漢堡附薯條',
      price: 55,
      category: '漢堡',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 600,
      options: [],
      },
      {
      id: 'm-zs02-03',
      vendorId: 'zs-02',
      name: '歐姆蛋',
      description: '起司歐姆蛋附吐司和沙拉',
      price: 50,
      category: '早午餐',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['蛋', '奶', '麩質'],
      calories: 480,
      options: [],
      },
      {
      id: 'm-zs02-04',
      vendorId: 'zs-02',
      name: '鐵板麵',
      description: '黑胡椒鐵板麵附蛋',
      price: 45,
      category: '早午餐',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['蛋', '麩質'],
      calories: 520,
      options: [
      {
      name: '口味',
      choices: [
      { label: '黑胡椒', priceAdd: 0 },
      { label: '蘑菇', priceAdd: 0 },
      { label: '茄汁', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-zs02-05',
      vendorId: 'zs-02',
      name: '總匯三明治',
      description: '火腿、蛋、起司、生菜總匯',
      price: 50,
      category: '三明治',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['蛋', '奶', '麩質'],
      calories: 420,
      options: [],
      },
      {
      id: 'm-zs02-06',
      vendorId: 'zs-02',
      name: '紅茶',
      description: '古早味紅茶',
      price: 15,
      category: '飲料',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: 80,
      options: [],
      },
    ]
  },
  {
    id: 'zs-03',
    cafeteriaId: 'zhishan',
    name: '麻辣滷味',
    category: 'braised',
    description: '麻辣、清淡兩種湯底自選，配料豐富',
    floor: '1F',
    stallNumber: 'E3',
    openTime: '11:00',
    closeTime: '20:00',
    phone: null,
    isOpen: true,
    rating: 4.3,
    ratingCount: 267,
    avgPrice: 55,
    tags: ['滷味', '麻辣', '晚餐'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 麻辣滷味
      {
      id: 'm-zs03-01',
      vendorId: 'zs-03',
      name: '麻辣拼盤（小）',
      description: '自選 5 樣配料，麻辣湯底',
      price: 50,
      category: '麻辣',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: null,
      options: [
      {
      name: '辣度',
      choices: [
      { label: '小辣', priceAdd: 0 },
      { label: '中辣', priceAdd: 0 },
      { label: '大辣', priceAdd: 0 },
      { label: '地獄辣', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-zs03-02',
      vendorId: 'zs-03',
      name: '麻辣拼盤（大）',
      description: '自選 8 樣配料，麻辣湯底',
      price: 70,
      category: '麻辣',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: null,
      options: [
      {
      name: '辣度',
      choices: [
      { label: '小辣', priceAdd: 0 },
      { label: '中辣', priceAdd: 0 },
      { label: '大辣', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-zs03-03',
      vendorId: 'zs-03',
      name: '清淡滷味（小）',
      description: '自選 5 樣配料，清湯湯底',
      price: 45,
      category: '清淡',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: null,
      options: [],
      },
      {
      id: 'm-zs03-04',
      vendorId: 'zs-03',
      name: '清淡滷味（大）',
      description: '自選 8 樣配料，清湯湯底',
      price: 65,
      category: '清淡',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: null,
      options: [],
      },
      {
      id: 'm-zs03-05',
      vendorId: 'zs-03',
      name: '加王子麵',
      description: '加一包王子麵',
      price: 10,
      category: '加購',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 280,
      options: [],
      },
      {
      id: 'm-zs03-06',
      vendorId: 'zs-03',
      name: '加冬粉',
      description: '加一份冬粉',
      price: 10,
      category: '加購',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: 150,
      options: [],
      },
    ]
  },
  {
    id: 'zs-04',
    cafeteriaId: 'zhishan',
    name: '簡餐小舖',
    category: 'rice',
    description: '咖哩飯、燴飯、義大利麵',
    floor: '2F',
    stallNumber: 'F1',
    openTime: '11:00',
    closeTime: '14:00',
    phone: null,
    isOpen: true,
    rating: 3.9,
    ratingCount: 134,
    avgPrice: 65,
    tags: ['簡餐', '咖哩', '義大利麵'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 簡餐小舖
      {
      id: 'm-zs04-01',
      vendorId: 'zs-04',
      name: '日式咖哩飯',
      description: '日式咖哩配白飯，附福神漬',
      price: 65,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 580,
      options: [
      {
      name: '加料',
      choices: [
      { label: '不加', priceAdd: 0 },
      { label: '加蛋', priceAdd: 10 },
      { label: '加豬排', priceAdd: 25 },
      ],
      required: false,
      },
      ],
      },
      {
      id: 'm-zs04-02',
      vendorId: 'zs-04',
      name: '海鮮燴飯',
      description: '蝦仁、花枝、蛤蜊奶油燴飯',
      price: 75,
      category: '主食',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['蝦', '奶', '貝類'],
      calories: 620,
      options: [],
      },
      {
      id: 'm-zs04-03',
      vendorId: 'zs-04',
      name: '番茄義大利麵',
      description: '經典番茄肉醬義大利麵',
      price: 65,
      category: '義大利麵',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 550,
      options: [],
      },
      {
      id: 'm-zs04-04',
      vendorId: 'zs-04',
      name: '奶油培根義大利麵',
      description: '白醬培根義大利麵',
      price: 70,
      category: '義大利麵',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['奶', '麩質'],
      calories: 680,
      options: [],
      },
      {
      id: 'm-zs04-05',
      vendorId: 'zs-04',
      name: '濃湯',
      description: '玉米濃湯/南瓜濃湯',
      price: 25,
      category: '湯品',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['奶'],
      calories: 150,
      options: [],
      },
    ]
  },
  {
    id: 'zs-05',
    cafeteriaId: 'zhishan',
    name: '鮮果坊',
    category: 'fruit',
    description: '現切水果盒、果汁、水果沙拉',
    floor: '2F',
    stallNumber: 'F2',
    openTime: '09:00',
    closeTime: '17:00',
    phone: null,
    isOpen: true,
    rating: 4.0,
    ratingCount: 112,
    avgPrice: 40,
    tags: ['水果', '健康', '果汁'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 鮮果坊
      {
      id: 'm-zs05-01',
      vendorId: 'zs-05',
      name: '綜合水果盒',
      description: '當季水果現切（西瓜、鳳梨、芭樂等）',
      price: 40,
      category: '水果',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: 120,
      options: [],
      },
      {
      id: 'm-zs05-02',
      vendorId: 'zs-05',
      name: '西瓜汁',
      description: '新鮮西瓜現打',
      price: 35,
      category: '果汁',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: 100,
      options: [],
      },
      {
      id: 'm-zs05-03',
      vendorId: 'zs-05',
      name: '木瓜牛奶',
      description: '木瓜鮮奶現打',
      price: 45,
      category: '果汁',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['奶'],
      calories: 220,
      options: [],
      },
      {
      id: 'm-zs05-04',
      vendorId: 'zs-05',
      name: '水果沙拉',
      description: '新鮮水果搭配優格醬',
      price: 50,
      category: '沙拉',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['奶'],
      calories: 180,
      options: [],
      },
      {
      id: 'm-zs05-05',
      vendorId: 'zs-05',
      name: '柳橙汁',
      description: '新鮮柳橙現榨',
      price: 40,
      category: '果汁',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: 110,
      options: [],
      },
    ]
  },
  {
    id: 'zs-06',
    cafeteriaId: 'zhishan',
    name: '鬆餅時光',
    category: 'dessert',
    description: '比利時鬆餅、可麗餅、甜點',
    floor: '2F',
    stallNumber: 'F3',
    openTime: '10:00',
    closeTime: '18:00',
    phone: null,
    isOpen: true,
    rating: 4.4,
    ratingCount: 223,
    avgPrice: 50,
    tags: ['鬆餅', '甜點', '下午茶'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 鬆餅時光
      {
      id: 'm-zs06-01',
      vendorId: 'zs-06',
      name: '經典鬆餅',
      description: '比利時鬆餅附楓糖奶油',
      price: 45,
      category: '鬆餅',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['蛋', '奶', '麩質'],
      calories: 380,
      options: [
      {
      name: '醬料',
      choices: [
      { label: '楓糖', priceAdd: 0 },
      { label: '巧克力', priceAdd: 0 },
      { label: '草莓', priceAdd: 5 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-zs06-02',
      vendorId: 'zs-06',
      name: '水果鬆餅',
      description: '鬆餅搭配當季新鮮水果',
      price: 60,
      category: '鬆餅',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['蛋', '奶', '麩質'],
      calories: 420,
      options: [],
      },
      {
      id: 'm-zs06-03',
      vendorId: 'zs-06',
      name: '可麗餅',
      description: '法式可麗餅，甜/鹹口味',
      price: 50,
      category: '可麗餅',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['蛋', '奶', '麩質'],
      calories: 350,
      options: [
      {
      name: '口味',
      choices: [
      { label: '鮪魚沙拉（鹹）', priceAdd: 0 },
      { label: '巧克力香蕉（甜）', priceAdd: 0 },
      { label: '草莓奶油（甜）', priceAdd: 5 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-zs06-04',
      vendorId: 'zs-06',
      name: '冰淇淋鬆餅',
      description: '鬆餅搭配兩球冰淇淋',
      price: 70,
      category: '鬆餅',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['蛋', '奶', '麩質'],
      calories: 520,
      options: [
      {
      name: '冰淇淋口味',
      choices: [
      { label: '香草', priceAdd: 0 },
      { label: '巧克力', priceAdd: 0 },
      { label: '草莓', priceAdd: 0 },
      { label: '抹茶', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-zs06-05',
      vendorId: 'zs-06',
      name: '熱可可',
      description: '濃郁熱可可',
      price: 35,
      category: '飲料',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['奶'],
      calories: 220,
      options: [],
      },
      {
      id: 'm-zs06-06',
      vendorId: 'zs-06',
      name: '抹茶拿鐵',
      description: '日式抹茶配鮮奶',
      price: 45,
      category: '飲料',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['奶'],
      calories: 200,
      options: [],
      },
    ]
  },
  {
    id: 'zs-07',
    cafeteriaId: 'zhishan',
    name: '麵食天地',
    category: 'noodles',
    description: '牛肉麵、陽春麵、乾拌麵、餛飩麵',
    floor: '1F',
    stallNumber: 'E4',
    openTime: '10:30',
    closeTime: '14:00',
    phone: null,
    isOpen: true,
    rating: 4.1,
    ratingCount: 189,
    avgPrice: 60,
    tags: ['牛肉麵', '乾拌麵', '熱門'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 麵食天地
      {
      id: 'm-zs07-01',
      vendorId: 'zs-07',
      name: '紅燒牛肉麵',
      description: '慢燉紅燒牛肉湯麵，肉塊軟嫩',
      price: 75,
      category: '牛肉麵',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 650,
      options: [
      {
      name: '份量',
      choices: [
      { label: '普通', priceAdd: 0 },
      { label: '大碗', priceAdd: 15 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-zs07-02',
      vendorId: 'zs-07',
      name: '清燉牛肉麵',
      description: '清燉牛肉湯麵，湯頭清甜',
      price: 75,
      category: '牛肉麵',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質'],
      calories: 600,
      options: [],
      },
      {
      id: 'm-zs07-03',
      vendorId: 'zs-07',
      name: '陽春麵',
      description: '清湯陽春麵附青菜',
      price: 35,
      category: '湯麵',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['麩質'],
      calories: 350,
      options: [],
      },
      {
      id: 'm-zs07-04',
      vendorId: 'zs-07',
      name: '乾拌麵',
      description: '蔥油乾拌麵附小菜',
      price: 40,
      category: '乾麵',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['麩質', '芝麻'],
      calories: 420,
      options: [],
      },
      {
      id: 'm-zs07-05',
      vendorId: 'zs-07',
      name: '餛飩麵',
      description: '鮮肉大餛飩湯麵',
      price: 55,
      category: '湯麵',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['麩質'],
      calories: 480,
      options: [],
      },
      {
      id: 'm-zs07-06',
      vendorId: 'zs-07',
      name: '小菜',
      description: '滷豆干/海帶/小黃瓜（任選一）',
      price: 15,
      category: '小菜',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['大豆'],
      calories: 50,
      options: [
      {
      name: '品項',
      choices: [
      { label: '滷豆干', priceAdd: 0 },
      { label: '海帶', priceAdd: 0 },
      { label: '小黃瓜', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
    ]
  },
  {
    id: 'zs-08',
    cafeteriaId: 'zhishan',
    name: '冰飲世界',
    category: 'drinks',
    description: '珍珠奶茶、冰沙、鮮榨果汁、冬季熱飲',
    floor: '2F',
    stallNumber: 'F4',
    openTime: '08:30',
    closeTime: '19:00',
    phone: null,
    isOpen: true,
    rating: 4.0,
    ratingCount: 298,
    avgPrice: 35,
    tags: ['飲料', '冰沙', '珍奶'],
    imageUrl: null,
    ownerUid: null,
    menuItems: [
      // 冰飲世界
      {
      id: 'm-zs08-01',
      vendorId: 'zs-08',
      name: '珍珠奶茶',
      description: '招牌黑糖珍珠鮮奶茶',
      price: 40,
      category: '奶茶',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['奶'],
      calories: 380,
      options: [
      {
      name: '甜度',
      choices: [
      { label: '全糖', priceAdd: 0 },
      { label: '七分', priceAdd: 0 },
      { label: '半糖', priceAdd: 0 },
      { label: '微糖', priceAdd: 0 },
      ],
      required: true,
      },
      {
      name: '冰量',
      choices: [
      { label: '正常', priceAdd: 0 },
      { label: '少冰', priceAdd: 0 },
      { label: '去冰', priceAdd: 0 },
      ],
      required: true,
      },
      ],
      },
      {
      id: 'm-zs08-02',
      vendorId: 'zs-08',
      name: '芒果冰沙',
      description: '新鮮芒果打冰沙（季節限定）',
      price: 50,
      category: '冰沙',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: [],
      calories: 250,
      options: [],
      },
      {
      id: 'm-zs08-03',
      vendorId: 'zs-08',
      name: '百香果多多',
      description: '百香果搭配養樂多',
      price: 35,
      category: '特調',
      imageUrl: null,
      isAvailable: true,
      isPopular: true,
      allergens: ['奶'],
      calories: 180,
      options: [],
      },
      {
      id: 'm-zs08-04',
      vendorId: 'zs-08',
      name: '鮮榨柳橙汁',
      description: '新鮮柳橙現榨原汁',
      price: 45,
      category: '果汁',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: [],
      calories: 110,
      options: [],
      },
      {
      id: 'm-zs08-05',
      vendorId: 'zs-08',
      name: '冬季熱可可',
      description: '濃郁巧克力熱可可（冬季限定）',
      price: 40,
      category: '熱飲',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['奶'],
      calories: 250,
      options: [],
      },
      {
      id: 'm-zs08-06',
      vendorId: 'zs-08',
      name: '綠豆沙',
      description: '冰涼綠豆沙牛奶',
      price: 35,
      category: '冰沙',
      imageUrl: null,
      isAvailable: true,
      isPopular: false,
      allergens: ['奶'],
      calories: 200,
      options: [],
      },
    ]
  },
];


// ═══════════════════════════════════════════════════════
// 範例評價
// ═══════════════════════════════════════════════════════

export const SAMPLE_REVIEWS: Review[] = [
  {
    id: 'r-01',
    vendorId: 'jy-05',
    studentUid: 'demo-1',
    studentName: '王同學',
    rating: 5,
    comment: '雞排超大塊，又酥又脆，必吃！',
    tags: ['好吃', '份量大'],
    createdAt: '2025-12-01T12:30:00Z',
    orderId: null,
  },
  {
    id: 'r-02',
    vendorId: 'jy-05',
    studentUid: 'demo-2',
    studentName: '李同學',
    rating: 4,
    comment: '炸物拼盤CP值很高，唯一缺點是排隊要等比較久',
    tags: ['CP值高', '排隊長'],
    createdAt: '2025-11-28T13:15:00Z',
    orderId: null,
  },
  {
    id: 'r-03',
    vendorId: 'yy-06',
    studentUid: 'demo-3',
    studentName: '張同學',
    rating: 5,
    comment: '石鍋拌飯超好吃，小菜給很多，而且老闆人很好',
    tags: ['好吃', '服務好'],
    createdAt: '2025-12-02T12:00:00Z',
    orderId: null,
  },
  {
    id: 'r-04',
    vendorId: 'zs-06',
    studentUid: 'demo-4',
    studentName: '陳同學',
    rating: 4,
    comment: '鬆餅外酥內軟，搭配水果很清爽，下午茶首選',
    tags: ['好吃', '下午茶'],
    createdAt: '2025-12-03T15:30:00Z',
    orderId: null,
  },
  {
    id: 'r-05',
    vendorId: 'jy-01',
    studentUid: 'demo-5',
    studentName: '林同學',
    rating: 3,
    comment: '菜色普通，但便宜大碗，趕時間的好選擇',
    tags: ['便宜', '方便'],
    createdAt: '2025-11-25T12:45:00Z',
    orderId: null,
  },
  {
    id: 'r-06',
    vendorId: 'zs-03',
    studentUid: 'demo-6',
    studentName: '黃同學',
    rating: 5,
    comment: '麻辣湯底很正宗，配料新鮮，晚餐常來',
    tags: ['好吃', '正宗', '推薦'],
    createdAt: '2025-12-04T18:20:00Z',
    orderId: null,
  },
];

// ═══════════════════════════════════════════════════════
// 資料存取工具
// ═══════════════════════════════════════════════════════

const STORAGE_KEYS = {
  orders: '@cafeteria_orders',
  reviews: '@cafeteria_reviews',
  favorites: '@cafeteria_favorites',
  announcements: '@cafeteria_announcements',
  inspections: '@cafeteria_inspections',
  vendorOverrides: '@cafeteria_vendor_overrides', // 店家修改的營業狀態等
};

// 讀寫本地儲存
async function readStorage<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function writeStorage<T>(key: string, data: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(data));
}

// ── 餐廳查詢 ──

export function getCafeterias(): Cafeteria[] {
  return CAFETERIAS;
}

export function getCafeteria(id: CafeteriaId): Cafeteria | undefined {
  return CAFETERIAS.find((c) => c.id === id);
}

// ── 店家查詢 ──

export function getVendors(cafeteriaId?: CafeteriaId): Vendor[] {
  if (!cafeteriaId) return VENDORS;
  return VENDORS.filter((v) => v.cafeteriaId === cafeteriaId);
}

export function getVendor(vendorId: string): Vendor | undefined {
  return VENDORS.find((v) => v.id === vendorId);
}

export function getVendorsByCategory(category: VendorCategory): Vendor[] {
  return VENDORS.filter((v) => v.category === category);
}

export function searchVendors(keyword: string): Vendor[] {
  const lower = keyword.toLowerCase();
  return VENDORS.filter(
    (v) =>
      v.name.includes(keyword) ||
      v.description.includes(keyword) ||
      v.tags.some((t) => t.includes(keyword)) ||
      CATEGORY_LABELS[v.category].includes(keyword),
  );
}

// ── 菜單查詢與管理（CRUD） ──

const MENU_OVERRIDES_KEY = '@cafeteria_menu_overrides';

/**
 * 取得某店家的菜單（合併預設資料 + 店家自訂覆蓋）
 * 優先使用 AsyncStorage 中店家自行維護的版本
 */
export async function getMenuItemsAsync(vendorId: string): Promise<MenuItem[]> {
  const overrides = await readStorage<Record<string, MenuItem[]>>(MENU_OVERRIDES_KEY, {});
  if (overrides[vendorId]) return overrides[vendorId];
  return getVendor(vendorId)?.menuItems ?? [];
}

/** 同步版本（只回傳預設資料，供不支援 async 的元件使用） */
export function getMenuItems(vendorId: string): MenuItem[] {
  return getVendor(vendorId)?.menuItems ?? [];
}

/** 新增菜單品項 */
export async function addMenuItem(
  vendorId: string,
  item: Omit<MenuItem, 'id' | 'vendorId'>,
): Promise<MenuItem> {
  const overrides = await readStorage<Record<string, MenuItem[]>>(MENU_OVERRIDES_KEY, {});
  if (!overrides[vendorId]) {
    // 首次編輯時，複製預設資料作為基底
    overrides[vendorId] = [...(getVendor(vendorId)?.menuItems ?? [])];
  }
  const newItem: MenuItem = {
    ...item,
    id: `m-${vendorId}-${Date.now()}`,
    vendorId,
  };
  overrides[vendorId].push(newItem);
  await writeStorage(MENU_OVERRIDES_KEY, overrides);
  return newItem;
}

/** 更新菜單品項 */
export async function updateMenuItem(
  vendorId: string,
  itemId: string,
  updates: Partial<Omit<MenuItem, 'id' | 'vendorId'>>,
): Promise<MenuItem | null> {
  const overrides = await readStorage<Record<string, MenuItem[]>>(MENU_OVERRIDES_KEY, {});
  if (!overrides[vendorId]) {
    overrides[vendorId] = [...(getVendor(vendorId)?.menuItems ?? [])];
  }
  const idx = overrides[vendorId].findIndex((m) => m.id === itemId);
  if (idx < 0) return null;
  overrides[vendorId][idx] = { ...overrides[vendorId][idx], ...updates };
  await writeStorage(MENU_OVERRIDES_KEY, overrides);
  return overrides[vendorId][idx];
}

/** 刪除菜單品項 */
export async function deleteMenuItem(vendorId: string, itemId: string): Promise<boolean> {
  const overrides = await readStorage<Record<string, MenuItem[]>>(MENU_OVERRIDES_KEY, {});
  if (!overrides[vendorId]) {
    overrides[vendorId] = [...(getVendor(vendorId)?.menuItems ?? [])];
  }
  const idx = overrides[vendorId].findIndex((m) => m.id === itemId);
  if (idx < 0) return false;
  overrides[vendorId].splice(idx, 1);
  await writeStorage(MENU_OVERRIDES_KEY, overrides);
  return true;
}

/** 重置菜單為預設資料 */
export async function resetMenuToDefault(vendorId: string): Promise<void> {
  const overrides = await readStorage<Record<string, MenuItem[]>>(MENU_OVERRIDES_KEY, {});
  delete overrides[vendorId];
  await writeStorage(MENU_OVERRIDES_KEY, overrides);
}

// ── 月餐費追蹤（創新功能）──

const BUDGET_KEY = '@cafeteria_budget';

export type MonthlyBudget = {
  month: string; // "2026-04" 格式
  budgetLimit: number; // 每月預算上限
  spent: number; // 已花費
  orders: number; // 訂餐次數
};

export async function getMonthlyBudget(uid: string): Promise<MonthlyBudget> {
  const key = `${BUDGET_KEY}_${uid}`;
  const month = new Date().toISOString().slice(0, 7);
  const stored = await readStorage<Record<string, MonthlyBudget>>(key, {});
  return stored[month] ?? { month, budgetLimit: 6000, spent: 0, orders: 0 };
}

export async function setMonthlyBudgetLimit(uid: string, limit: number): Promise<void> {
  const key = `${BUDGET_KEY}_${uid}`;
  const month = new Date().toISOString().slice(0, 7);
  const stored = await readStorage<Record<string, MonthlyBudget>>(key, {});
  if (!stored[month]) stored[month] = { month, budgetLimit: limit, spent: 0, orders: 0 };
  else stored[month].budgetLimit = limit;
  await writeStorage(key, stored);
}

export async function trackSpending(uid: string, amount: number): Promise<MonthlyBudget> {
  const key = `${BUDGET_KEY}_${uid}`;
  const month = new Date().toISOString().slice(0, 7);
  const stored = await readStorage<Record<string, MonthlyBudget>>(key, {});
  if (!stored[month]) stored[month] = { month, budgetLimit: 6000, spent: 0, orders: 0 };
  stored[month].spent += amount;
  stored[month].orders += 1;
  await writeStorage(key, stored);
  return stored[month];
}

// ── 惜食快閃折扣（創新功能）──

const FLASH_DEALS_KEY = '@cafeteria_flash_deals';

export type FlashDeal = {
  id: string;
  vendorId: string;
  menuItemId: string;
  menuItemName: string;
  originalPrice: number;
  discountPrice: number;
  remainingQty: number;
  reason: string; // "即將打烊"、"剩餘食材"、"限時優惠"
  expiresAt: string; // ISO
  createdAt: string;
};

export async function getFlashDeals(cafeteriaId?: CafeteriaId): Promise<FlashDeal[]> {
  const stored = await readStorage<FlashDeal[]>(FLASH_DEALS_KEY, []);
  const now = new Date().toISOString();
  const active = stored.filter((d) => d.expiresAt > now && d.remainingQty > 0);
  if (!cafeteriaId) return active;
  return active.filter((d) => {
    const vendor = VENDORS.find((v) => v.id === d.vendorId);
    return vendor?.cafeteriaId === cafeteriaId;
  });
}

export async function createFlashDeal(
  deal: Omit<FlashDeal, 'id' | 'createdAt'>,
): Promise<FlashDeal> {
  const stored = await readStorage<FlashDeal[]>(FLASH_DEALS_KEY, []);
  const newDeal: FlashDeal = {
    ...deal,
    id: `flash-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  stored.push(newDeal);
  await writeStorage(FLASH_DEALS_KEY, stored);
  return newDeal;
}

export async function claimFlashDeal(dealId: string): Promise<FlashDeal | null> {
  const stored = await readStorage<FlashDeal[]>(FLASH_DEALS_KEY, []);
  const idx = stored.findIndex((d) => d.id === dealId);
  if (idx < 0 || stored[idx].remainingQty <= 0) return null;
  stored[idx].remainingQty -= 1;
  await writeStorage(FLASH_DEALS_KEY, stored);
  return stored[idx];
}

// ── 揪團訂餐（創新功能）──

const GROUP_ORDERS_KEY = '@cafeteria_group_orders';

export type GroupOrder = {
  id: string;
  creatorUid: string;
  creatorName: string;
  vendorId: string;
  vendorName: string;
  title: string; // "一起訂炸雞大師！"
  maxMembers: number;
  members: Array<{
    uid: string;
    name: string;
    items: OrderItem[];
    subtotal: number;
  }>;
  status: 'open' | 'closed' | 'ordered' | 'completed';
  deadline: string; // ISO — 截止時間
  createdAt: string;
  note: string;
};

export async function getGroupOrders(vendorId?: string): Promise<GroupOrder[]> {
  const stored = await readStorage<GroupOrder[]>(GROUP_ORDERS_KEY, []);
  const active = stored.filter(
    (g) => g.status === 'open' || g.status === 'closed' || g.status === 'ordered',
  );
  if (!vendorId) return active;
  return active.filter((g) => g.vendorId === vendorId);
}

export async function createGroupOrder(
  group: Omit<GroupOrder, 'id' | 'createdAt' | 'status' | 'members'>,
): Promise<GroupOrder> {
  const stored = await readStorage<GroupOrder[]>(GROUP_ORDERS_KEY, []);
  const newGroup: GroupOrder = {
    ...group,
    id: `grp-${Date.now()}`,
    status: 'open',
    members: [],
    createdAt: new Date().toISOString(),
  };
  stored.push(newGroup);
  await writeStorage(GROUP_ORDERS_KEY, stored);
  return newGroup;
}

export async function joinGroupOrder(
  groupId: string,
  member: GroupOrder['members'][0],
): Promise<GroupOrder | null> {
  const stored = await readStorage<GroupOrder[]>(GROUP_ORDERS_KEY, []);
  const idx = stored.findIndex((g) => g.id === groupId);
  if (idx < 0 || stored[idx].status !== 'open') return null;
  if (stored[idx].members.length >= stored[idx].maxMembers) return null;
  if (stored[idx].members.some((m) => m.uid === member.uid)) {
    // 更新已存在的成員
    const mIdx = stored[idx].members.findIndex((m) => m.uid === member.uid);
    stored[idx].members[mIdx] = member;
  } else {
    stored[idx].members.push(member);
  }
  await writeStorage(GROUP_ORDERS_KEY, stored);
  return stored[idx];
}

// ── 營養追蹤（創新功能）──

const NUTRITION_LOG_KEY = '@cafeteria_nutrition_log';

export type NutritionEntry = {
  date: string; // "2026-04-24"
  totalCalories: number;
  meals: Array<{
    vendorName: string;
    itemName: string;
    calories: number | null;
    time: string;
  }>;
};

export async function getNutritionLog(uid: string, days: number = 7): Promise<NutritionEntry[]> {
  const key = `${NUTRITION_LOG_KEY}_${uid}`;
  const stored = await readStorage<NutritionEntry[]>(key, []);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return stored.filter((e) => e.date >= cutoffStr).sort((a, b) => b.date.localeCompare(a.date));
}

export async function logNutrition(
  uid: string,
  entry: { vendorName: string; itemName: string; calories: number | null },
): Promise<void> {
  const key = `${NUTRITION_LOG_KEY}_${uid}`;
  const stored = await readStorage<NutritionEntry[]>(key, []);
  const today = new Date().toISOString().slice(0, 10);
  let todayEntry = stored.find((e) => e.date === today);
  if (!todayEntry) {
    todayEntry = { date: today, totalCalories: 0, meals: [] };
    stored.push(todayEntry);
  }
  todayEntry.meals.push({
    ...entry,
    time: new Date().toISOString(),
  });
  todayEntry.totalCalories = todayEntry.meals.reduce((sum, m) => sum + (m.calories ?? 0), 0);
  await writeStorage(key, stored);
}

// ── 智慧人潮預測（創新功能：結合課表）──

/**
 * 根據星期幾和時段估算人潮，模擬課表整合
 * 實際上線可接入學校課表 API
 */
export function predictCrowdBySchedule(cafeteriaId: CafeteriaId): {
  level: 'low' | 'medium' | 'high';
  prediction: string;
  nextQuietTime: string;
} {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sun

  // 週末人少
  if (day === 0 || day === 6) {
    return { level: 'low', prediction: '週末人潮較少', nextQuietTime: '現在就是好時機' };
  }

  // 午餐尖峰 11:30-13:00
  if (hour >= 11 && hour <= 12) {
    return {
      level: 'high',
      prediction: '午間下課尖峰，預估排隊 10-15 分鐘',
      nextQuietTime: '建議 13:30 後再來',
    };
  }
  if (hour === 13) {
    return {
      level: 'medium',
      prediction: '午餐人潮正在減少',
      nextQuietTime: '約 13:30 後人潮散去',
    };
  }

  // 晚餐尖峰 17:00-18:30
  if (hour >= 17 && hour <= 18) {
    return {
      level: 'high',
      prediction: '晚間下課尖峰，預估排隊 8-12 分鐘',
      nextQuietTime: '建議 18:30 後再來',
    };
  }

  // 早餐 7:30-9:00
  if (hour >= 7 && hour <= 8) {
    return {
      level: 'medium',
      prediction: '早晨上課前，人潮適中',
      nextQuietTime: '9:00 後較空',
    };
  }

  return {
    level: 'low',
    prediction: '目前人潮較少，可以輕鬆用餐',
    nextQuietTime: '現在就是好時機',
  };
}

// ── 評價 ──

export async function getReviews(vendorId: string): Promise<Review[]> {
  const stored = await readStorage<Review[]>(STORAGE_KEYS.reviews, []);
  const allReviews = [...SAMPLE_REVIEWS, ...stored];
  return allReviews
    .filter((r) => r.vendorId === vendorId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function addReview(review: Omit<Review, 'id' | 'createdAt'>): Promise<Review> {
  const newReview: Review = {
    ...review,
    id: `r-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  const stored = await readStorage<Review[]>(STORAGE_KEYS.reviews, []);
  stored.push(newReview);
  await writeStorage(STORAGE_KEYS.reviews, stored);
  return newReview;
}

// ── 訂單（統一資料源：Firestore 優先，AsyncStorage 離線降級）──

/** 解析學校 ID — 從當前登入使用者 */
let _cachedSchoolId: string | null = null;
export function setOrderSchoolId(schoolId: string): void {
  _cachedSchoolId = schoolId;
}
function _getSchoolId(): string | null {
  return _cachedSchoolId;
}

/** 嘗試取得 Firebase 連線（靜默失敗） */
function _tryFirebase(): boolean {
  try {
    getDb();
    getAuthInstance();
    return true;
  } catch {
    return false;
  }
}

/** 從 Firestore doc data 映射到本地 Order 型別 */
function _mapFirestoreToLocalOrder(id: string, data: Record<string, any>): Order {
  const toIso = (v: any): string | null => {
    if (typeof v === 'string' && v) return v;
    if (v && typeof v.toDate === 'function') return v.toDate().toISOString();
    if (v && typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString();
    return null;
  };
  return {
    id,
    studentUid: data.userId ?? data.studentUid ?? '',
    vendorId: data.merchantId ?? data.vendorId ?? data.cafeteriaId ?? '',
    cafeteriaId: (data.cafeteriaId ?? 'jingyuan') as CafeteriaId,
    items: Array.isArray(data.items)
      ? data.items.map((it: any) => ({
          menuItemId: it.menuItemId ?? it.id ?? '',
          menuItemName: it.name ?? it.menuItemName ?? '',
          quantity: it.quantity ?? 1,
          unitPrice: it.price ?? it.unitPrice ?? 0,
          selectedOptions: it.selectedOptions ?? it.options ?? [],
          subtotal: it.subtotal ?? (it.price ?? 0) * (it.quantity ?? 1),
        }))
      : [],
    totalPrice: data.totalAmount ?? data.total ?? data.totalPrice ?? 0,
    status: (data.status ?? 'pending') as OrderStatus,
    note: data.note ?? '',
    createdAt: toIso(data.createdAt) ?? new Date().toISOString(),
    estimatedPickup: toIso(data.pickupTime) ?? data.estimatedPickup ?? null,
    readyAt: toIso(data.readyAt) ?? null,
    completedAt: toIso(data.completedAt) ?? null,
    cancelledAt: toIso(data.cancelledAt) ?? null,
    cancelReason: data.cancelReason ?? null,
    queueNumber: typeof data.queueNumber === 'number' ? data.queueNumber : (typeof data.queueNumber === 'string' ? parseInt(data.queueNumber, 10) || null : null),
  };
}

/**
 * 取得訂單 — Firestore 優先
 * studentUid: 學生看自己的訂單
 * vendorId: 店家看本店訂單（對應 Firestore 的 merchantId 或 cafeteriaId）
 */
export async function getOrders(studentUid?: string, vendorId?: string): Promise<Order[]> {
  const schoolId = _getSchoolId();

  // ── 嘗試 Firestore ──
  if (schoolId && _tryFirebase()) {
    try {
      const db = getDb();
      const ordersRef = collection(db, 'schools', schoolId, 'orders');
      let q;
      if (studentUid) {
        q = fsQuery(ordersRef, where('userId', '==', studentUid), fsLimit(50));
      } else if (vendorId) {
        // 店家查詢：可能存成 merchantId 或 cafeteriaId
        q = fsQuery(ordersRef, where('cafeteriaId', '==', vendorId), fsLimit(50));
      } else {
        q = fsQuery(ordersRef, fsLimit(50));
      }
      const snap = await getDocs(q);
      const firestoreOrders = snap.docs.map(d => _mapFirestoreToLocalOrder(d.id, d.data()));

      // 也嘗試用 merchantId 查（某些訂單可能用 merchantId 存）
      if (vendorId && firestoreOrders.length === 0) {
        const q2 = fsQuery(ordersRef, where('merchantId', '==', vendorId), fsLimit(50));
        const snap2 = await getDocs(q2);
        const extra = snap2.docs.map(d => _mapFirestoreToLocalOrder(d.id, d.data()));
        firestoreOrders.push(...extra);
      }

      if (firestoreOrders.length > 0) {
        // 同步到本地快取
        const existing = await readStorage<Order[]>(STORAGE_KEYS.orders, []);
        const existingIds = new Set(existing.map(o => o.id));
        for (const fo of firestoreOrders) {
          if (!existingIds.has(fo.id)) existing.push(fo);
          else {
            const idx = existing.findIndex(e => e.id === fo.id);
            if (idx >= 0) existing[idx] = fo; // 用雲端版本覆蓋
          }
        }
        await writeStorage(STORAGE_KEYS.orders, existing);
        return firestoreOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
    } catch (err) {
      console.warn('[cafeteriaData] Firestore getOrders failed, falling back to local:', err);
    }
  }

  // ── 降級：AsyncStorage ──
  const orders = await readStorage<Order[]>(STORAGE_KEYS.orders, []);
  return orders
    .filter((o) => {
      if (studentUid && o.studentUid !== studentUid) return false;
      if (vendorId && o.vendorId !== vendorId) return false;
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * 建立訂單 — Firestore Cloud Function 優先
 */
export async function createOrder(
  order: Omit<
    Order,
    | 'id'
    | 'createdAt'
    | 'status'
    | 'readyAt'
    | 'completedAt'
    | 'cancelledAt'
    | 'cancelReason'
    | 'queueNumber'
  >,
): Promise<Order> {
  const schoolId = _getSchoolId();

  // ── 嘗試 Firestore Cloud Function ──
  if (schoolId && _tryFirebase() && getAuthInstance().currentUser) {
    try {
      const createOrderFn = httpsCallable<
        Record<string, unknown>,
        { orderId?: string; total?: number }
      >(getFunctionsInstance(), 'createOrder');

      const result = await createOrderFn({
        schoolId,
        cafeteriaId: order.cafeteriaId || order.vendorId,
        merchantId: order.vendorId,
        items: order.items.map(it => ({
          menuItemId: it.menuItemId,
          name: it.menuItemName,
          price: it.unitPrice,
          quantity: it.quantity,
          note: '',
        })),
        totalAmount: order.totalPrice,
        note: order.note || '',
      });

      const orderId = result.data?.orderId;
      if (orderId) {
        // 從 Firestore 讀回完整訂單
        const db = getDb();
        const docRef = doc(db, 'schools', schoolId, 'orders', orderId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const newOrder = _mapFirestoreToLocalOrder(snap.id, snap.data());
          // 同步到本地
          const local = await readStorage<Order[]>(STORAGE_KEYS.orders, []);
          local.push(newOrder);
          await writeStorage(STORAGE_KEYS.orders, local);
          return newOrder;
        }
        // docRef 可能還沒同步，用已知資訊建構
        const fallback: Order = {
          ...order,
          id: orderId,
          status: 'pending',
          createdAt: new Date().toISOString(),
          readyAt: null,
          completedAt: null,
          cancelledAt: null,
          cancelReason: null,
          queueNumber: null,
        };
        const local = await readStorage<Order[]>(STORAGE_KEYS.orders, []);
        local.push(fallback);
        await writeStorage(STORAGE_KEYS.orders, local);
        return fallback;
      }
    } catch (err) {
      console.warn('[cafeteriaData] Firestore createOrder failed, falling back to local:', err);
    }
  }

  // ── 降級：本地建立 ──
  const orders = await readStorage<Order[]>(STORAGE_KEYS.orders, []);
  const queueNumber =
    orders.filter(
      (o) => o.vendorId === order.vendorId && o.status !== 'completed' && o.status !== 'cancelled',
    ).length + 1;

  const newOrder: Order = {
    ...order,
    id: `ord-${Date.now()}`,
    status: 'pending',
    createdAt: new Date().toISOString(),
    readyAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    queueNumber,
  };
  orders.push(newOrder);
  await writeStorage(STORAGE_KEYS.orders, orders);
  return newOrder;
}

/**
 * 更新訂單狀態 — Cloud Function 優先（店家接單/製作/完成/取消）
 */
export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  extra?: Partial<Order>,
): Promise<Order | null> {
  const schoolId = _getSchoolId();

  // ── 嘗試 Firestore Cloud Function ──
  if (schoolId && _tryFirebase()) {
    try {
      const updateFn = httpsCallable<
        { schoolId: string; orderId: string; status: string },
        { success?: boolean }
      >(getFunctionsInstance(), 'updateOrderStatus');
      await updateFn({ schoolId, orderId, status });

      // 讀回更新後的訂單
      const db = getDb();
      const docRef = doc(db, 'schools', schoolId, 'orders', orderId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const updated = _mapFirestoreToLocalOrder(snap.id, snap.data());
        // 同步本地
        const local = await readStorage<Order[]>(STORAGE_KEYS.orders, []);
        const idx = local.findIndex(o => o.id === orderId);
        if (idx >= 0) local[idx] = updated;
        else local.push(updated);
        await writeStorage(STORAGE_KEYS.orders, local);
        return updated;
      }
    } catch (err) {
      console.warn('[cafeteriaData] Firestore updateOrderStatus failed, falling back:', err);
    }
  }

  // ── 降級：本地更新 ──
  const orders = await readStorage<Order[]>(STORAGE_KEYS.orders, []);
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx < 0) return null;

  orders[idx] = {
    ...orders[idx],
    status,
    ...(status === 'ready' ? { readyAt: new Date().toISOString() } : {}),
    ...(status === 'completed' ? { completedAt: new Date().toISOString() } : {}),
    ...(status === 'cancelled' ? { cancelledAt: new Date().toISOString() } : {}),
    ...extra,
  };
  await writeStorage(STORAGE_KEYS.orders, orders);
  return orders[idx];
}

/**
 * 即時訂單監聽（Firestore onSnapshot）
 * 店家端用：即時收到新訂單 / 狀態變更
 * 學生端用：即時看到自己訂單被接單/製作完成
 *
 * @param filter - { studentUid } 或 { vendorId } 擇一
 * @param onUpdate - 訂單列表更新回呼
 * @returns 取消監聽函數（null 表示無法建立監聽）
 */
export function subscribeOrders(
  filter: { studentUid?: string; vendorId?: string; schoolId?: string },
  onUpdate: (orders: Order[]) => void,
): Unsubscribe | null {
  const schoolId = filter.schoolId ?? _getSchoolId();
  if (!schoolId || !_tryFirebase()) return null;

  try {
    const db = getDb();
    const ordersRef = collection(db, 'schools', schoolId, 'orders');
    let q;
    if (filter.studentUid) {
      q = fsQuery(ordersRef, where('userId', '==', filter.studentUid), fsOrderBy('createdAt', 'desc'), fsLimit(30));
    } else if (filter.vendorId) {
      q = fsQuery(ordersRef, where('cafeteriaId', '==', filter.vendorId), fsOrderBy('createdAt', 'desc'), fsLimit(50));
    } else {
      q = fsQuery(ordersRef, fsOrderBy('createdAt', 'desc'), fsLimit(50));
    }

    return onSnapshot(q, (snap) => {
      const orders = snap.docs.map(d => _mapFirestoreToLocalOrder(d.id, d.data()));
      onUpdate(orders);
    }, (err) => {
      console.warn('[cafeteriaData] onSnapshot error:', err);
    });
  } catch (err) {
    console.warn('[cafeteriaData] subscribeOrders failed:', err);
    return null;
  }
}

// ── 收藏 ──

export async function getFavoriteVendors(): Promise<string[]> {
  return readStorage<string[]>(STORAGE_KEYS.favorites, []);
}

export async function toggleFavoriteVendor(vendorId: string): Promise<boolean> {
  const favorites = await readStorage<string[]>(STORAGE_KEYS.favorites, []);
  const idx = favorites.indexOf(vendorId);
  if (idx >= 0) {
    favorites.splice(idx, 1);
    await writeStorage(STORAGE_KEYS.favorites, favorites);
    return false;
  } else {
    favorites.push(vendorId);
    await writeStorage(STORAGE_KEYS.favorites, favorites);
    return true;
  }
}

// ── 公告 ──

export async function getAnnouncements(
  cafeteriaId?: CafeteriaId,
): Promise<CafeteriaAnnouncement[]> {
  const stored = await readStorage<CafeteriaAnnouncement[]>(STORAGE_KEYS.announcements, []);
  return stored
    .filter((a) => !cafeteriaId || a.cafeteriaId === cafeteriaId || a.cafeteriaId === 'all')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function addAnnouncement(
  ann: Omit<CafeteriaAnnouncement, 'id' | 'createdAt'>,
): Promise<CafeteriaAnnouncement> {
  const stored = await readStorage<CafeteriaAnnouncement[]>(STORAGE_KEYS.announcements, []);
  const newAnn: CafeteriaAnnouncement = {
    ...ann,
    id: `ann-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  stored.push(newAnn);
  await writeStorage(STORAGE_KEYS.announcements, stored);
  return newAnn;
}

export async function deleteAnnouncement(announcementId: string): Promise<boolean> {
  const stored = await readStorage<CafeteriaAnnouncement[]>(STORAGE_KEYS.announcements, []);
  const idx = stored.findIndex((a) => a.id === announcementId);
  if (idx < 0) return false;
  stored.splice(idx, 1);
  await writeStorage(STORAGE_KEYS.announcements, stored);
  return true;
}

// ── 衛生稽查（管理員）──

export async function getInspections(vendorId?: string): Promise<InspectionRecord[]> {
  const stored = await readStorage<InspectionRecord[]>(STORAGE_KEYS.inspections, []);
  if (!vendorId) return stored;
  return stored.filter((i) => i.vendorId === vendorId);
}

export async function addInspection(
  record: Omit<InspectionRecord, 'id'>,
): Promise<InspectionRecord> {
  const stored = await readStorage<InspectionRecord[]>(STORAGE_KEYS.inspections, []);
  const newRecord: InspectionRecord = { ...record, id: `insp-${Date.now()}` };
  stored.push(newRecord);
  await writeStorage(STORAGE_KEYS.inspections, stored);
  return newRecord;
}

function parseCrowdReportDate(createdAt?: string): Date | null {
  if (!createdAt || typeof createdAt !== 'string') return null;
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

const REPORT_LEVEL_SCORE: Record<CrowdLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  very_high: 4,
};

/**
 * 依使用者於 POI 的回報計算人潮（與點位詳情頁相同：優先 2 小時內，否則最多取 12 筆）。
 * 僅使用真實回報，無資料時回傳 null。
 */
export function aggregateCrowdReportsToSimpleLevel(
  reports: PoiCrowdReport[],
): {
  level: 'low' | 'medium' | 'high';
  sampleSize: number;
  lastUpdated: Date | null;
} | null {
  const withDate = reports
    .map((r) => ({ raw: r, createdDate: parseCrowdReportDate(r.createdAt) }))
    .filter((x): x is { raw: PoiCrowdReport; createdDate: Date } => x.createdDate !== null)
    .sort((a, b) => b.createdDate.getTime() - a.createdDate.getTime());

  if (withDate.length === 0) return null;

  const now = Date.now();
  const recentWindow = withDate.filter(
    (x) => now - x.createdDate.getTime() <= 2 * 60 * 60 * 1000,
  );
  const effective = recentWindow.length > 0 ? recentWindow : withDate.slice(0, 12);

  const averageScore =
    effective.reduce((sum, x) => sum + REPORT_LEVEL_SCORE[x.raw.level], 0) / effective.length;

  let coarse: CrowdLevel;
  if (averageScore < 1.5) coarse = 'low';
  else if (averageScore < 2.5) coarse = 'medium';
  else if (averageScore < 3.5) coarse = 'high';
  else coarse = 'very_high';

  const level: 'low' | 'medium' | 'high' =
    coarse === 'very_high' || coarse === 'high'
      ? 'high'
      : coarse === 'medium'
        ? 'medium'
        : 'low';

  return {
    level,
    sampleSize: effective.length,
    lastUpdated: withDate[0].createdDate,
  };
}

/** 單一餐廳：訂單加權 sum 約 0～此值對應由低到高的壓力 proxy（不代表實際人數） */
const ORDER_PRESSURE_SCALE = 12;
/** 全校三館加總：加權疊加後量級較大，分母單獨調整避免過早壓滿「人多」 */
const ORDER_PRESSURE_SCALE_CAMPUS = 28;
const CROWD_MERGE_W_REPORTS = 0.55;
const CROWD_MERGE_W_ORDERS = 0.45;

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

function orderEligibleForPressure(order: Order, now: Date): boolean {
  if (order.status === 'cancelled' || order.status === 'completed') return false;
  const created = new Date(order.createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return isSameLocalDay(created, now);
}

/** 無 estimatedPickup 時依狀態推估預期取餐（相對於下单時間的分鐘數） */
function inferredPickupMinutesAfterCreated(status: OrderStatus): number {
  switch (status) {
    case 'ready':
      return 8;
    case 'preparing':
      return 14;
    case 'confirmed':
      return 22;
    case 'pending':
    default:
      return 28;
  }
}

function inferPickupAt(order: Order): Date {
  if (order.estimatedPickup) {
    const t = new Date(order.estimatedPickup);
    if (!Number.isNaN(t.getTime())) return t;
  }
  const created = new Date(order.createdAt);
  return new Date(created.getTime() + inferredPickupMinutesAfterCreated(order.status) * 60 * 1000);
}

function statusWeightMultiplier(status: OrderStatus): number {
  switch (status) {
    case 'ready':
      return 1.25;
    case 'preparing':
      return 1.08;
    case 'confirmed':
      return 0.92;
    case 'pending':
      return 0.78;
    default:
      return 0.5;
  }
}

export function computeOrderPickupPressure(order: Order, nowMs: number): number {
  const now = new Date(nowMs);
  if (!orderEligibleForPressure(order, now)) return 0;

  const pickupAt = inferPickupAt(order);
  const deltaMin = (pickupAt.getTime() - nowMs) / 60000;
  const sm = statusWeightMultiplier(order.status);

  let windowW = 0;
  if (deltaMin < -90) windowW = 0.06;
  else if (deltaMin < -25) windowW = 0.35;
  else if (deltaMin <= 45) windowW = 1;
  else if (deltaMin <= 120) windowW = 0.45;
  else windowW = 0.12;

  return windowW * sm;
}

export function aggregateOrderPickupPressure(
  orders: Order[],
  cafeteriaId: CafeteriaId,
  nowMs: number,
): { sumWeight: number; ordersConsidered: number } {
  let sumWeight = 0;
  let ordersConsidered = 0;
  for (const o of orders) {
    if (o.cafeteriaId !== cafeteriaId) continue;
    const w = computeOrderPickupPressure(o, nowMs);
    if (w <= 0) continue;
    sumWeight += w;
    ordersConsidered += 1;
  }
  return { sumWeight, ordersConsidered };
}

function numericPressureFromOrders(sumWeight: number, scale: number = ORDER_PRESSURE_SCALE): number {
  return 1 + 3 * Math.min(1, sumWeight / scale);
}

function simpleCrowdLevelToNumeric(level: 'low' | 'medium' | 'high'): number {
  if (level === 'low') return 1.55;
  if (level === 'medium') return 2.45;
  return 3.45;
}

function numericToSimpleCrowdLevel(n: number): 'low' | 'medium' | 'high' {
  if (n < 2.15) return 'low';
  if (n < 2.85) return 'medium';
  return 'high';
}

export type CafeteriaCrowdSummaryOk = {
  ok: true;
  level: 'low' | 'medium' | 'high';
  source: 'merged' | 'reports_only' | 'orders_only';
  reportSampleSize: number;
  orderWeightedSum: number;
  ordersInPressureModel: number;
  lastReportAt: Date | null;
};

export type CafeteriaCrowdSummaryResult = CafeteriaCrowdSummaryOk | { ok: false; reason: 'no_signal' };

function mergeReportAndOrderSignals(
  reportAgg: ReturnType<typeof aggregateCrowdReportsToSimpleLevel>,
  sumWeight: number,
  ordersConsidered: number,
  options?: { minOrderSignal?: number; orderPressureScale?: number },
): CafeteriaCrowdSummaryResult {
  const scale = options?.orderPressureScale ?? ORDER_PRESSURE_SCALE;
  const orderNumeric = numericPressureFromOrders(sumWeight, scale);
  const hasReports = !!reportAgg;
  const minSig = options?.minOrderSignal ?? 0.2;
  const hasOrders = sumWeight >= minSig;

  if (!hasReports && !hasOrders) {
    return { ok: false, reason: 'no_signal' };
  }

  const pack = (
    source: CafeteriaCrowdSummaryOk['source'],
    level: 'low' | 'medium' | 'high',
  ): CafeteriaCrowdSummaryOk => ({
    ok: true,
    source,
    level,
    reportSampleSize: reportAgg?.sampleSize ?? 0,
    orderWeightedSum: Math.round(sumWeight * 100) / 100,
    ordersInPressureModel: ordersConsidered,
    lastReportAt: reportAgg?.lastUpdated ?? null,
  });

  if (hasReports && hasOrders) {
    const merged =
      CROWD_MERGE_W_REPORTS * simpleCrowdLevelToNumeric(reportAgg!.level) +
      CROWD_MERGE_W_ORDERS * orderNumeric;
    return pack('merged', numericToSimpleCrowdLevel(merged));
  }

  if (hasReports) return pack('reports_only', reportAgg!.level);

  return pack('orders_only', numericToSimpleCrowdLevel(orderNumeric));
}

/** 單一餐廳：人潮回報（Firestore POI）＋ 今日訂單取餐時段加權 */
export async function fetchCafeteriaCrowdSummary(
  cafeteriaId: CafeteriaId,
  listPoiCrowdReports: (poiId: string, schoolId?: string) => Promise<PoiCrowdReport[]>,
  schoolId?: string,
  /** 若已由呼叫端載入（例如與製作時間估算共用），可避免重複查詢 */
  recentOrders?: Order[],
): Promise<CafeteriaCrowdSummaryResult> {
  const poiId = CAFETERIA_CROWD_POI_IDS[cafeteriaId];
  const nowMs = Date.now();
  const [reports, orders] = await Promise.all([
    listPoiCrowdReports(poiId, schoolId),
    recentOrders !== undefined ? Promise.resolve(recentOrders) : getOrders(),
  ]);
  const reportAgg = aggregateCrowdReportsToSimpleLevel(reports);
  const { sumWeight, ordersConsidered } = aggregateOrderPickupPressure(orders, cafeteriaId, nowMs);
  return mergeReportAndOrderSignals(reportAgg, sumWeight, ordersConsidered);
}

/** 全校用餐區：三間餐廳 POI 回報合併 + 三間訂單加總加權 */
export async function fetchCampusDiningCrowdSummary(
  listPoiCrowdReports: (poiId: string, schoolId?: string) => Promise<PoiCrowdReport[]>,
  schoolId?: string,
  recentOrders?: Order[],
): Promise<CafeteriaCrowdSummaryResult> {
  const nowMs = Date.now();
  const ids = Object.values(CAFETERIA_CROWD_POI_IDS);
  const [batches, orders] = await Promise.all([
    Promise.all(ids.map((id) => listPoiCrowdReports(id, schoolId))),
    recentOrders !== undefined ? Promise.resolve(recentOrders) : getOrders(),
  ]);
  const mergedReports = batches.flat();
  const reportAgg = aggregateCrowdReportsToSimpleLevel(mergedReports);

  const cafeteriaIds: CafeteriaId[] = ['jingyuan', 'yiyuan', 'zhishan'];
  let sumAll = 0;
  let ordersConsidered = 0;
  for (const cid of cafeteriaIds) {
    const r = aggregateOrderPickupPressure(orders, cid, nowMs);
    sumAll += r.sumWeight;
    ordersConsidered += r.ordersConsidered;
  }

  return mergeReportAndOrderSignals(reportAgg, sumAll, ordersConsidered, {
    minOrderSignal: 0.45,
    orderPressureScale: ORDER_PRESSURE_SCALE_CAMPUS,
  });
}

// ── 即時資訊估算 ──

/** 最近 N 筆訂單取樣上限（Firestore getOrders 無篩選時亦約 50） */
const PREP_ESTIMATE_MAX_SAMPLES = 45;

/** 原始製作分鐘數合理區間（過濾離群／錯誤時間戳） */
const PREP_RAW_MIN_MINUTES = 0.75;
const PREP_RAW_MAX_MINUTES = 120;

/** 顯示用上下限（分鐘） */
const PREP_DISPLAY_MIN = 3;
const PREP_DISPLAY_MAX = 45;

/** 樣本數低於此時改顯示區間（最小～最大） */
const PREP_RANGE_LABEL_THRESHOLD = 8;

function medianSorted(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** 去掉約上下各 10% 後取中位數，樣本過少時退回一般中位數 */
function trimmedMedianMinutes(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length <= 4) return medianSorted(sorted);
  const trim = Math.max(1, Math.floor(sorted.length * 0.1));
  const trimmed = sorted.slice(trim, sorted.length - trim);
  return trimmed.length > 0 ? medianSorted(trimmed) : medianSorted(sorted);
}

function clampPrepDisplayMinutes(m: number): number {
  return Math.round(Math.min(PREP_DISPLAY_MAX, Math.max(PREP_DISPLAY_MIN, m)));
}

/**
 * 單筆訂單：建立時間 → 可取餐／完成時間的分鐘數。
 * 結束時間優先使用 Firestore `readyAt`，否則 `completedAt`。
 */
export function orderPrepElapsedMinutes(order: Order): number | null {
  if (order.status === 'cancelled') return null;
  const startMs = new Date(order.createdAt).getTime();
  if (Number.isNaN(startMs)) return null;
  const endIso = order.readyAt ?? order.completedAt;
  if (!endIso) return null;
  const endMs = new Date(endIso).getTime();
  if (Number.isNaN(endMs) || endMs <= startMs) return null;
  const mins = (endMs - startMs) / 60000;
  if (mins < PREP_RAW_MIN_MINUTES || mins > PREP_RAW_MAX_MINUTES) return null;
  return mins;
}

export type VendorPrepWaitEstimate = {
  sampleSize: number;
  /** 截尾後中位數（未截顯示上下限） */
  medianMinutesRaw: number | null;
  labelZh: string | null;
};

function buildPrepLabelZh(sampleSize: number, sliceMins: number[]): string | null {
  if (sampleSize === 0 || sliceMins.length === 0) return null;

  if (sampleSize < PREP_RANGE_LABEL_THRESHOLD) {
    const low = clampPrepDisplayMinutes(Math.min(...sliceMins));
    const high = clampPrepDisplayMinutes(Math.max(...sliceMins));
    return low === high ? `預估製作約 ${low} 分鐘` : `預估製作約 ${low}～${high} 分鐘`;
  }

  const robust = trimmedMedianMinutes(sliceMins);
  if (robust == null || Number.isNaN(robust)) return null;
  const mid = clampPrepDisplayMinutes(robust);
  return `預估製作約 ${mid} 分鐘`;
}

function prepDurationsForOrders(
  orders: Order[],
  pred: (o: Order) => boolean,
): Array<{ mins: number; createdMs: number }> {
  const out: Array<{ mins: number; createdMs: number }> = [];
  for (const o of orders) {
    if (!pred(o)) continue;
    const mins = orderPrepElapsedMinutes(o);
    if (mins == null) continue;
    const createdMs = new Date(o.createdAt).getTime();
    if (Number.isNaN(createdMs)) continue;
    out.push({ mins, createdMs });
  }
  out.sort((a, b) => b.createdMs - a.createdMs);
  return out.slice(0, PREP_ESTIMATE_MAX_SAMPLES);
}

/** 依近期已完成／可取餐訂單推算單一店家製作耗時（顯示文案為繁中） */
export function estimateVendorPrepWaitFromOrders(
  vendorId: string,
  orders: Order[],
): VendorPrepWaitEstimate {
  const rows = prepDurationsForOrders(orders, (o) => o.vendorId === vendorId);
  const sliceMins = rows.map((r) => r.mins);
  const sampleSize = sliceMins.length;
  const medianMinutesRaw = trimmedMedianMinutes(sliceMins);
  return {
    sampleSize,
    medianMinutesRaw,
    labelZh: buildPrepLabelZh(sampleSize, sliceMins),
  };
}

/** 同一餐廳館別內全部店家訂單合併推算（POI 餐廳頁用） */
export function estimateCafeteriaPrepWaitFromOrders(
  cafeteriaId: CafeteriaId,
  orders: Order[],
): VendorPrepWaitEstimate {
  const rows = prepDurationsForOrders(orders, (o) => o.cafeteriaId === cafeteriaId);
  const sliceMins = rows.map((r) => r.mins);
  const sampleSize = sliceMins.length;
  const medianMinutesRaw = trimmedMedianMinutes(sliceMins);
  return {
    sampleSize,
    medianMinutesRaw,
    labelZh: buildPrepLabelZh(sampleSize, sliceMins),
  };
}

/** 估算目前等待時間（根據排隊訂單數量） */
export async function estimateWaitTime(vendorId: string): Promise<number> {
  const orders = await readStorage<Order[]>(STORAGE_KEYS.orders, []);
  const activeOrders = orders.filter(
    (o) =>
      o.vendorId === vendorId &&
      (o.status === 'pending' || o.status === 'confirmed' || o.status === 'preparing'),
  );
  // 每單估計 5 分鐘
  return activeOrders.length * 5;
}

export const CROWD_LABELS = {
  low: '人少',
  medium: '適中',
  high: '人多',
};

export const CROWD_COLORS = {
  low: '#16A34A',
  medium: '#F59E0B',
  high: '#DC2626',
};

/** 判斷店家目前是否在營業時間 */
export function isVendorCurrentlyOpen(vendor: Vendor): boolean {
  if (!vendor.isOpen) return false;
  const now = new Date();
  const hours = now.getHours();
  const mins = now.getMinutes();
  const currentMins = hours * 60 + mins;

  const [openH, openM] = vendor.openTime.split(':').map(Number);
  const [closeH, closeM] = vendor.closeTime.split(':').map(Number);
  const openMins = openH * 60 + openM;
  const closeMins = closeH * 60 + closeM;

  return currentMins >= openMins && currentMins <= closeMins;
}
