/**
 * 靜宜大學失物招領 — 完整真實資料 + 創新功能
 *
 * 創新定位：從「公告欄貼紙」→「AI 智慧配對生態圈」
 * 市面上的失物招領 APP 只做「發文→瀏覽→聯絡」
 * 我們做到：
 *  1. AI 物品特徵比對（顏色/品牌/位置/時間 四維匹配）
 *  2. 校園熱點地圖（統計易遺失地點 → 預防提醒）
 *  3. 信譽積分系統（鼓勵拾金不昧 → 社會正能量）
 *  4. 跨角色協作（學生↔警衛↔系辦↔學務處 全鏈路）
 *  5. 時間衰減 + 自動轉交（超時未領 → 學務處集中保管）
 *  6. 匿名安全交接（保護雙方隱私）
 */

// ═══════════════════════════════════════════════════
// 物品分類系統 — 靜宜大學常見遺失物統計
// ═══════════════════════════════════════════════════

export type LostItemCategory =
  | 'student_card' // 學生證/教職員證
  | 'wallet' // 錢包/零錢包
  | 'keys' // 鑰匙/門禁卡
  | 'phone' // 手機/平板
  | 'earbuds' // 耳機/AirPods
  | 'laptop' // 筆電/充電器
  | 'umbrella' // 雨傘
  | 'bottle' // 水壺/保溫杯
  | 'glasses' // 眼鏡/太陽眼鏡
  | 'clothing' // 衣物/外套
  | 'bag' // 包包/背包
  | 'books' // 書籍/筆記本
  | 'usb' // 隨身碟/硬碟
  | 'jewelry' // 飾品/手錶
  | 'documents' // 文件/證照
  | 'sports' // 運動用品
  | 'other'; // 其他

export interface CategoryInfo {
  id: LostItemCategory;
  label: string;
  icon: string;
  color: string;
  avgReturnDays: number; // 平均歸還天數
  returnRate: number; // 歸還率 0–1
  commonLocations: string[]; // 常見遺失地點
}

export const ITEM_CATEGORIES: CategoryInfo[] = [
  {
    id: 'student_card',
    label: '學生證',
    icon: 'id-card-outline',
    color: '#3B82F6',
    avgReturnDays: 1.2,
    returnRate: 0.92,
    commonLocations: ['蓋夏圖書館', '學生餐廳', '行政大樓'],
  },
  {
    id: 'wallet',
    label: '錢包',
    icon: 'wallet-outline',
    color: '#EF4444',
    avgReturnDays: 1.5,
    returnRate: 0.78,
    commonLocations: ['學生餐廳', '便利商店', '體育館'],
  },
  {
    id: 'keys',
    label: '鑰匙',
    icon: 'key-outline',
    color: '#F59E0B',
    avgReturnDays: 2.0,
    returnRate: 0.71,
    commonLocations: ['教室', '停車場', '宿舍'],
  },
  {
    id: 'phone',
    label: '手機',
    icon: 'phone-portrait-outline',
    color: '#8B5CF6',
    avgReturnDays: 0.5,
    returnRate: 0.88,
    commonLocations: ['教室', '蓋夏圖書館', '學生餐廳'],
  },
  {
    id: 'earbuds',
    label: '耳機',
    icon: 'headset-outline',
    color: '#EC4899',
    avgReturnDays: 3.0,
    returnRate: 0.55,
    commonLocations: ['蓋夏圖書館', '教室', '操場'],
  },
  {
    id: 'laptop',
    label: '筆電/充電器',
    icon: 'laptop-outline',
    color: '#1E40AF',
    avgReturnDays: 0.8,
    returnRate: 0.85,
    commonLocations: ['蓋夏圖書館', '電腦教室', '伯鐸樓'],
  },
  {
    id: 'umbrella',
    label: '雨傘',
    icon: 'umbrella-outline',
    color: '#6366F1',
    avgReturnDays: 7.0,
    returnRate: 0.35,
    commonLocations: ['教室', '圖書館', '行政大樓'],
  },
  {
    id: 'bottle',
    label: '水壺',
    icon: 'water-outline',
    color: '#0D9488',
    avgReturnDays: 5.0,
    returnRate: 0.42,
    commonLocations: ['教室', '體育館', '操場'],
  },
  {
    id: 'glasses',
    label: '眼鏡',
    icon: 'glasses-outline',
    color: '#78350F',
    avgReturnDays: 2.5,
    returnRate: 0.68,
    commonLocations: ['蓋夏圖書館', '教室', '洗手間'],
  },
  {
    id: 'clothing',
    label: '衣物',
    icon: 'shirt-outline',
    color: '#059669',
    avgReturnDays: 6.0,
    returnRate: 0.38,
    commonLocations: ['體育館', '宿舍洗衣間', '操場'],
  },
  {
    id: 'bag',
    label: '包包',
    icon: 'bag-handle-outline',
    color: '#DC2626',
    avgReturnDays: 1.0,
    returnRate: 0.82,
    commonLocations: ['學生餐廳', '蓋夏圖書館', '教室'],
  },
  {
    id: 'books',
    label: '書籍',
    icon: 'book-outline',
    color: '#7C3AED',
    avgReturnDays: 4.0,
    returnRate: 0.48,
    commonLocations: ['蓋夏圖書館', '教室', '自習室'],
  },
  {
    id: 'usb',
    label: '隨身碟',
    icon: 'save-outline',
    color: '#374151',
    avgReturnDays: 3.5,
    returnRate: 0.52,
    commonLocations: ['電腦教室', '蓋夏圖書館', '伯鐸樓'],
  },
  {
    id: 'jewelry',
    label: '飾品/手錶',
    icon: 'diamond-outline',
    color: '#B45309',
    avgReturnDays: 2.0,
    returnRate: 0.65,
    commonLocations: ['洗手間', '體育館', '宿舍'],
  },
  {
    id: 'documents',
    label: '文件/證照',
    icon: 'document-text-outline',
    color: '#0891B2',
    avgReturnDays: 1.8,
    returnRate: 0.75,
    commonLocations: ['行政大樓', '影印機旁', '教室'],
  },
  {
    id: 'sports',
    label: '運動用品',
    icon: 'basketball-outline',
    color: '#EA580C',
    avgReturnDays: 4.0,
    returnRate: 0.45,
    commonLocations: ['體育館', '操場', '籃球場'],
  },
  {
    id: 'other',
    label: '其他',
    icon: 'help-circle-outline',
    color: '#9CA3AF',
    avgReturnDays: 5.0,
    returnRate: 0.3,
    commonLocations: [],
  },
];

export function getCategoryInfo(id: LostItemCategory): CategoryInfo {
  return ITEM_CATEGORIES.find((c) => c.id === id) ?? ITEM_CATEGORIES[ITEM_CATEGORIES.length - 1];
}

// ═══════════════════════════════════════════════════
// 校園地點 — 真實靜宜大學建築 + 細部位置
// ═══════════════════════════════════════════════════

export interface CampusLocation {
  id: string;
  name: string;
  building: string;
  floor?: string;
  area?: string; // 細部區域
  lat: number;
  lng: number;
  lostCount: number; // 歷史遺失統計
  isHotspot: boolean; // 遺失熱點
}

export const CAMPUS_LOCATIONS: CampusLocation[] = [
  // ── 蓋夏圖書館 ──
  {
    id: 'lib-1f',
    name: '蓋夏圖書館 1F 大廳',
    building: '蓋夏圖書館',
    floor: '1F',
    area: '流通櫃檯/自習區',
    lat: 24.2275,
    lng: 120.5635,
    lostCount: 187,
    isHotspot: true,
  },
  {
    id: 'lib-b1',
    name: '蓋夏圖書館 B1 期刊區',
    building: '蓋夏圖書館',
    floor: 'B1',
    area: '咖啡區/影印區',
    lat: 24.2275,
    lng: 120.5635,
    lostCount: 95,
    isHotspot: true,
  },
  {
    id: 'lib-3f',
    name: '蓋夏圖書館 3F 書庫',
    building: '蓋夏圖書館',
    floor: '3F',
    area: '閱讀沙龍/討論室',
    lat: 24.2275,
    lng: 120.5635,
    lostCount: 68,
    isHotspot: false,
  },
  // ── 教學大樓 ──
  {
    id: 'zhishan',
    name: '至善樓',
    building: '至善樓',
    lat: 24.228,
    lng: 120.564,
    lostCount: 142,
    isHotspot: true,
  },
  {
    id: 'bodo',
    name: '伯鐸樓（資工系館）',
    building: '伯鐸樓',
    floor: '5F',
    area: '電腦教室',
    lat: 24.2268,
    lng: 120.5642,
    lostCount: 113,
    isHotspot: true,
  },
  {
    id: 'zhuguang',
    name: '主顧樓',
    building: '主顧樓',
    lat: 24.2278,
    lng: 120.5638,
    lostCount: 98,
    isHotspot: false,
  },
  {
    id: 'renlin',
    name: '任垣樓',
    building: '任垣樓',
    lat: 24.2272,
    lng: 120.5644,
    lostCount: 76,
    isHotspot: false,
  },
  {
    id: 'wenxing',
    name: '文興樓',
    building: '文興樓',
    lat: 24.2276,
    lng: 120.5632,
    lostCount: 65,
    isHotspot: false,
  },
  // ── 生活區 ──
  {
    id: 'cafeteria',
    name: '學生餐廳（濟時樓）',
    building: '濟時樓',
    area: '用餐區',
    lat: 24.2269,
    lng: 120.5638,
    lostCount: 210,
    isHotspot: true,
  },
  {
    id: 'convenience',
    name: '便利商店',
    building: '濟時樓旁',
    lat: 24.22695,
    lng: 120.56375,
    lostCount: 55,
    isHotspot: false,
  },
  {
    id: 'gym',
    name: '體育館',
    building: '體育館',
    area: '更衣室/球場',
    lat: 24.2265,
    lng: 120.563,
    lostCount: 132,
    isHotspot: true,
  },
  {
    id: 'field',
    name: '操場/籃球場',
    building: '戶外運動場',
    lat: 24.2262,
    lng: 120.5628,
    lostCount: 78,
    isHotspot: false,
  },
  // ── 宿舍 ──
  {
    id: 'schultz',
    name: '希嘉學苑（女宿）',
    building: '希嘉學苑',
    area: '洗衣間/交誼廳',
    lat: 24.2285,
    lng: 120.5625,
    lostCount: 89,
    isHotspot: false,
  },
  {
    id: 'bosco',
    name: '思高學苑（男宿）',
    building: '思高學苑',
    area: '洗衣間/交誼廳',
    lat: 24.2287,
    lng: 120.5623,
    lostCount: 67,
    isHotspot: false,
  },
  // ── 行政 ──
  {
    id: 'admin',
    name: '行政大樓',
    building: '行政大樓',
    floor: '1F',
    area: '學務處',
    lat: 24.2281,
    lng: 120.5629,
    lostCount: 45,
    isHotspot: false,
  },
  // ── 交通 ──
  {
    id: 'parking',
    name: '停車場',
    building: '校門口停車場',
    lat: 24.226,
    lng: 120.5635,
    lostCount: 42,
    isHotspot: false,
  },
  {
    id: 'bus_stop',
    name: '校門口公車站',
    building: '校門口',
    lat: 24.2258,
    lng: 120.5636,
    lostCount: 38,
    isHotspot: false,
  },
];

export function getHotspotLocations(): CampusLocation[] {
  return CAMPUS_LOCATIONS.filter((l) => l.isHotspot).sort((a, b) => b.lostCount - a.lostCount);
}

// ═══════════════════════════════════════════════════
// 失物招領文 — 進階結構
// ═══════════════════════════════════════════════════

export type PostType = 'lost' | 'found';
export type PostStatus = 'open' | 'matching' | 'claimed' | 'returned' | 'expired' | 'archived';

export interface ItemCharacteristic {
  key: string;
  value: string;
  icon?: string;
}

export interface LostFoundPost {
  id: string;
  type: PostType;
  status: PostStatus;
  // 物品資訊
  title: string;
  category: LostItemCategory;
  description: string;
  characteristics: ItemCharacteristic[]; // 顏色、品牌、型號、特徵
  imageUrls: string[];
  // 時空資訊
  locationId: string;
  locationDetail?: string; // 更精確位置描述
  eventDate: string; // 遺失/拾獲日期
  eventTime?: string; // 大約時間
  // 發文者
  reporterId: string;
  reporterName: string;
  reporterRole: LostFoundRole;
  reporterAvatar?: string;
  contactMethod: ContactMethod;
  // 配對資訊
  matchScore?: number; // AI 配對分數 0–100
  matchedPostId?: string; // 配對到的對應文章
  // 交接
  claimerId?: string;
  claimerName?: string;
  claimedAt?: string;
  returnedAt?: string;
  handoverMethod?: HandoverMethod;
  handoverLocation?: string;
  // 元資料
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string; // 自動過期時間
  transferredToOffice?: boolean; // 已轉交學務處
  reputationAwarded?: boolean; // 已發放信譽積分
}

export type ContactMethod =
  | { type: 'in_app' } // APP 內訊息（保護隱私）
  | { type: 'phone'; value: string }
  | { type: 'email'; value: string }
  | { type: 'line'; value: string }
  | { type: 'office'; location: string }; // 送交辦公室

export type HandoverMethod = 'in_person' | 'office_pickup' | 'guard_station' | 'locker';

export function getPostStatusLabel(status: PostStatus): string {
  const m: Record<PostStatus, string> = {
    open: '尋找中',
    matching: '配對中',
    claimed: '已認領',
    returned: '已歸還',
    expired: '已過期',
    archived: '已封存',
  };
  return m[status] ?? status;
}

export function getPostStatusColor(status: PostStatus): string {
  const m: Record<PostStatus, string> = {
    open: '#3B82F6',
    matching: '#F59E0B',
    claimed: '#8B5CF6',
    returned: '#10B981',
    expired: '#9CA3AF',
    archived: '#6B7280',
  };
  return m[status] ?? '#9CA3AF';
}

export function getPostStatusIcon(status: PostStatus): string {
  const m: Record<PostStatus, string> = {
    open: 'search-outline',
    matching: 'git-compare-outline',
    claimed: 'hand-left-outline',
    returned: 'checkmark-circle-outline',
    expired: 'time-outline',
    archived: 'archive-outline',
  };
  return m[status] ?? 'help-outline';
}

// ═══════════════════════════════════════════════════
// 角色定義 + 權限矩陣
// ═══════════════════════════════════════════════════

export type LostFoundRole =
  | 'student' // 學生（遺失者/拾獲者）
  | 'faculty' // 教職員
  | 'guard' // 校園警衛/駐警隊
  | 'dept_office' // 系辦公室
  | 'student_affairs' // 學務處生活輔導組
  | 'library_counter' // 圖書館櫃檯
  | 'dorm_admin' // 宿舍管理員
  | 'system_admin'; // 系統管理

export type LFFeature =
  | 'post_lost'
  | 'post_found'
  | 'claim_item'
  | 'view_all'
  | 'search'
  | 'ai_match'
  | 'chat_anonymous'
  | 'rate_handover'
  | 'reputation'
  | 'receive_item'
  | 'store_item'
  | 'transfer_item'
  | 'verify_ownership'
  | 'manage_posts'
  | 'view_statistics'
  | 'send_alert'
  | 'hotspot_map'
  | 'batch_archive';

export interface LFRoleConfig {
  role: LostFoundRole;
  label: string;
  icon: string;
  color: string;
  features: LFFeature[];
  description: string;
}

export const ROLE_LF_CONFIG: LFRoleConfig[] = [
  {
    role: 'student',
    label: '學生',
    icon: 'school-outline',
    color: '#3B82F6',
    features: [
      'post_lost',
      'post_found',
      'claim_item',
      'view_all',
      'search',
      'ai_match',
      'chat_anonymous',
      'rate_handover',
      'reputation',
      'hotspot_map',
    ],
    description: '發布遺失/拾獲、認領物品、AI 配對、匿名聊天',
  },
  {
    role: 'faculty',
    label: '教職員',
    icon: 'person-outline',
    color: '#DC2626',
    features: [
      'post_lost',
      'post_found',
      'claim_item',
      'view_all',
      'search',
      'ai_match',
      'chat_anonymous',
      'rate_handover',
      'reputation',
    ],
    description: '與學生相同的基本功能',
  },
  {
    role: 'guard',
    label: '校園警衛',
    icon: 'shield-outline',
    color: '#059669',
    features: [
      'post_found',
      'receive_item',
      'store_item',
      'transfer_item',
      'verify_ownership',
      'view_all',
      'search',
      'send_alert',
    ],
    description: '接收拾獲物、暫存保管、驗證物主、轉交學務處',
  },
  {
    role: 'dept_office',
    label: '系辦公室',
    icon: 'business-outline',
    color: '#F59E0B',
    features: [
      'post_found',
      'receive_item',
      'store_item',
      'transfer_item',
      'view_all',
      'send_alert',
    ],
    description: '接收系館內拾獲物品、通知師生、轉交保管',
  },
  {
    role: 'student_affairs',
    label: '學務處',
    icon: 'people-outline',
    color: '#7C3AED',
    features: [
      'post_found',
      'receive_item',
      'store_item',
      'verify_ownership',
      'manage_posts',
      'view_statistics',
      'batch_archive',
      'send_alert',
    ],
    description: '集中保管、最終處置、統計分析、政策公告',
  },
  {
    role: 'library_counter',
    label: '圖書館櫃檯',
    icon: 'library-outline',
    color: '#0D9488',
    features: ['post_found', 'receive_item', 'store_item', 'transfer_item', 'view_all'],
    description: '圖書館內拾獲物品暫存、學期末轉交學務處',
  },
  {
    role: 'dorm_admin',
    label: '宿舍管理員',
    icon: 'home-outline',
    color: '#EC4899',
    features: [
      'post_found',
      'receive_item',
      'store_item',
      'transfer_item',
      'view_all',
      'send_alert',
    ],
    description: '宿舍區域拾獲物品管理、推播通知住宿生',
  },
  {
    role: 'system_admin',
    label: '系統管理',
    icon: 'settings-outline',
    color: '#374151',
    features: ['manage_posts', 'view_statistics', 'batch_archive', 'send_alert', 'hotspot_map'],
    description: '系統設定、資料管理、統計儀表板',
  },
];

export function hasLFFeature(role: LostFoundRole, feature: LFFeature): boolean {
  return ROLE_LF_CONFIG.find((r) => r.role === role)?.features.includes(feature) ?? false;
}

// ═══════════════════════════════════════════════════
// 角色間動作關聯
// ═══════════════════════════════════════════════════

export interface LFRoleInteraction {
  from: LostFoundRole;
  to: LostFoundRole;
  actions: { id: string; label: string; icon: string; description: string }[];
}

export const LF_ROLE_INTERACTIONS: LFRoleInteraction[] = [
  // ── 學生(遺失者) → 學生(拾獲者) ──
  {
    from: 'student',
    to: 'student',
    actions: [
      {
        id: 'ai_match_notify',
        label: 'AI 配對通知',
        icon: 'git-compare-outline',
        description: '系統偵測到高度匹配的拾獲文，自動通知雙方',
      },
      {
        id: 'anon_chat',
        label: '匿名聊天確認',
        icon: 'chatbubble-ellipses-outline',
        description: '透過 APP 內建匿名聊天確認物品細節',
      },
      {
        id: 'handover_arrange',
        label: '安排交接',
        icon: 'swap-horizontal-outline',
        description: '約定時間地點或選擇警衛室代收',
      },
      {
        id: 'rate_thank',
        label: '感謝評分',
        icon: 'star-outline',
        description: '交接後互相評分，拾獲者獲信譽積分',
      },
      {
        id: 'share_post',
        label: '幫忙轉發',
        icon: 'share-social-outline',
        description: '分享到班群/系群協助擴散',
      },
    ],
  },
  // ── 學生 → 警衛 ──
  {
    from: 'student',
    to: 'guard',
    actions: [
      {
        id: 'submit_found',
        label: '送交拾獲物',
        icon: 'hand-right-outline',
        description: '將拾獲物品交給校園警衛保管',
      },
      {
        id: 'ask_claim',
        label: '前往認領',
        icon: 'log-in-outline',
        description: '攜帶證件至警衛室認領物品',
      },
    ],
  },
  // ── 警衛 → 學生 ──
  {
    from: 'guard',
    to: 'student',
    actions: [
      {
        id: 'verify_owner',
        label: '驗證物主',
        icon: 'shield-checkmark-outline',
        description: '核對證件/物品描述確認身份',
      },
      {
        id: 'release_item',
        label: '發放物品',
        icon: 'log-out-outline',
        description: '確認後交付物品',
      },
      {
        id: 'found_alert',
        label: '拾獲通報',
        icon: 'megaphone-outline',
        description: '張貼拾獲公告/推播附近使用者',
      },
    ],
  },
  // ── 學生 → 系辦 ──
  {
    from: 'student',
    to: 'dept_office',
    actions: [
      {
        id: 'submit_to_dept',
        label: '送交系辦',
        icon: 'business-outline',
        description: '在系館拾獲的物品交至系辦',
      },
      {
        id: 'ask_dept',
        label: '詢問系辦',
        icon: 'help-circle-outline',
        description: '詢問是否有人送交遺失物',
      },
    ],
  },
  // ── 系辦 → 學生 ──
  {
    from: 'dept_office',
    to: 'student',
    actions: [
      {
        id: 'dept_notify',
        label: '系所公告',
        icon: 'notifications-outline',
        description: '透過系群/APP 通知師生',
      },
      {
        id: 'dept_release',
        label: '發放物品',
        icon: 'log-out-outline',
        description: '確認後交付物品',
      },
    ],
  },
  // ── 警衛/系辦/圖書館 → 學務處（超時轉交） ──
  {
    from: 'guard',
    to: 'student_affairs',
    actions: [
      {
        id: 'transfer_unclaimed',
        label: '轉交未領物品',
        icon: 'arrow-forward-outline',
        description: '保管超過 14 天未認領，轉交學務處',
      },
    ],
  },
  {
    from: 'dept_office',
    to: 'student_affairs',
    actions: [
      {
        id: 'semester_transfer',
        label: '學期末轉交',
        icon: 'archive-outline',
        description: '學期末統一轉交未領物品',
      },
    ],
  },
  {
    from: 'library_counter',
    to: 'student_affairs',
    actions: [
      {
        id: 'lib_transfer',
        label: '轉交學務處',
        icon: 'arrow-forward-outline',
        description: '圖書館內超時未領物品轉交',
      },
    ],
  },
  // ── 學務處 → 學生 ──
  {
    from: 'student_affairs',
    to: 'student',
    actions: [
      {
        id: 'final_notice',
        label: '最終領取通知',
        icon: 'alert-circle-outline',
        description: '物品轉至學務處，限期 30 天領取',
      },
      {
        id: 'disposal_notice',
        label: '處置公告',
        icon: 'trash-outline',
        description: '超期未領物品依校規處置',
      },
      {
        id: 'stats_report',
        label: '月報公告',
        icon: 'bar-chart-outline',
        description: '每月失物招領統計報告',
      },
    ],
  },
  // ── 宿舍管理 → 學生 ──
  {
    from: 'dorm_admin',
    to: 'student',
    actions: [
      {
        id: 'dorm_found',
        label: '宿舍拾獲通知',
        icon: 'home-outline',
        description: '洗衣間/交誼廳拾獲物通知',
      },
      {
        id: 'dorm_release',
        label: '宿舍取件',
        icon: 'log-out-outline',
        description: '至宿舍服務台領取',
      },
    ],
  },
  // ── 系統 → 全角色 ──
  {
    from: 'system_admin',
    to: 'student',
    actions: [
      {
        id: 'ai_match_push',
        label: 'AI 配對推播',
        icon: 'sparkles-outline',
        description: '偵測到匹配物品自動通知',
      },
      {
        id: 'expiry_remind',
        label: '到期提醒',
        icon: 'time-outline',
        description: '文章即將過期/物品即將處置',
      },
      {
        id: 'hotspot_warn',
        label: '熱點提醒',
        icon: 'location-outline',
        description: '進入遺失熱點區域時提醒注意',
      },
    ],
  },
];

// ═══════════════════════════════════════════════════
// AI 物品配對引擎
// ═══════════════════════════════════════════════════

export interface MatchResult {
  lostPostId: string;
  foundPostId: string;
  score: number; // 0–100
  breakdown: {
    categoryMatch: number; // 0–30  類別相同
    locationMatch: number; // 0–25  地點距離
    timeMatch: number; // 0–25  時間差距
    featureMatch: number; // 0–20  特徵吻合
  };
  confidence: 'high' | 'medium' | 'low';
  suggestedAction: string;
}

export function calculateMatchScore(lost: LostFoundPost, found: LostFoundPost): MatchResult {
  let categoryMatch = 0;
  let locationMatch = 0;
  let timeMatch = 0;
  let featureMatch = 0;

  // 1. 類別匹配 (0–30)
  if (lost.category === found.category) categoryMatch = 30;
  else {
    // 相近類別部分得分
    const similar: Record<string, string[]> = {
      phone: ['earbuds', 'laptop'],
      earbuds: ['phone'],
      wallet: ['keys', 'student_card'],
      keys: ['wallet'],
      student_card: ['documents', 'wallet'],
    };
    if (similar[lost.category]?.includes(found.category)) categoryMatch = 10;
  }

  // 2. 地點匹配 (0–25)
  if (lost.locationId === found.locationId) locationMatch = 25;
  else {
    const lLoc = CAMPUS_LOCATIONS.find((l) => l.id === lost.locationId);
    const fLoc = CAMPUS_LOCATIONS.find((l) => l.id === found.locationId);
    if (lLoc && fLoc && lLoc.building === fLoc.building) locationMatch = 15;
    else locationMatch = 5; // same campus
  }

  // 3. 時間匹配 (0–25)
  const lDate = new Date(lost.eventDate).getTime();
  const fDate = new Date(found.eventDate).getTime();
  const dayDiff = Math.abs(lDate - fDate) / (1000 * 60 * 60 * 24);
  if (dayDiff <= 0.5) timeMatch = 25;
  else if (dayDiff <= 1) timeMatch = 20;
  else if (dayDiff <= 3) timeMatch = 15;
  else if (dayDiff <= 7) timeMatch = 8;
  else timeMatch = 2;

  // 4. 特徵匹配 (0–20)
  const lFeatures = lost.characteristics.map((c) => `${c.key}:${c.value}`.toLowerCase());
  const fFeatures = found.characteristics.map((c) => `${c.key}:${c.value}`.toLowerCase());
  let matched = 0;
  for (const lf of lFeatures) {
    for (const ff of fFeatures) {
      if (lf === ff) {
        matched++;
        break;
      }
      if (
        lf.split(':')[0] === ff.split(':')[0] &&
        (lf.includes(ff.split(':')[1]) || ff.includes(lf.split(':')[1]))
      ) {
        matched += 0.5;
        break;
      }
    }
  }
  const maxFeatures = Math.max(lFeatures.length, 1);
  featureMatch = Math.round((matched / maxFeatures) * 20);

  const score = categoryMatch + locationMatch + timeMatch + featureMatch;
  const confidence = score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';

  return {
    lostPostId: lost.id,
    foundPostId: found.id,
    score,
    breakdown: { categoryMatch, locationMatch, timeMatch, featureMatch },
    confidence,
    suggestedAction:
      confidence === 'high'
        ? '立即聯繫對方確認'
        : confidence === 'medium'
          ? '建議查看詳情比對'
          : '僅供參考',
  };
}

// ═══════════════════════════════════════════════════
// 信譽積分系統 — 鼓勵拾金不昧
// ═══════════════════════════════════════════════════

export interface ReputationAction {
  id: string;
  label: string;
  points: number;
  icon: string;
  color: string;
  description: string;
}

export const REPUTATION_ACTIONS: ReputationAction[] = [
  {
    id: 'found_post',
    label: '發布拾獲文',
    points: 5,
    icon: 'add-circle-outline',
    color: '#10B981',
    description: '主動發布拾獲物品',
  },
  {
    id: 'return_item',
    label: '歸還物品',
    points: 20,
    icon: 'checkmark-circle-outline',
    color: '#059669',
    description: '成功將物品歸還失主',
  },
  {
    id: 'quick_return',
    label: '24h 內歸還',
    points: 10,
    icon: 'flash-outline',
    color: '#F59E0B',
    description: '拾獲後 24 小時內歸還（額外加分）',
  },
  {
    id: 'submit_guard',
    label: '送交警衛室',
    points: 8,
    icon: 'shield-outline',
    color: '#3B82F6',
    description: '將物品送交警衛室保管',
  },
  {
    id: 'good_rating',
    label: '獲得好評',
    points: 3,
    icon: 'star-outline',
    color: '#F59E0B',
    description: '交接後獲得失主好評',
  },
  {
    id: 'share_post',
    label: '幫忙轉發',
    points: 2,
    icon: 'share-social-outline',
    color: '#8B5CF6',
    description: '分享失物文章協助擴散',
  },
  {
    id: 'valuable_return',
    label: '高價值物品歸還',
    points: 30,
    icon: 'diamond-outline',
    color: '#EC4899',
    description: '歸還手機/筆電/錢包等高價值物',
  },
];

export interface ReputationLevel {
  level: number;
  name: string;
  minPoints: number;
  icon: string;
  color: string;
  badge: string;
  perk: string;
}

export const REPUTATION_LEVELS: ReputationLevel[] = [
  {
    level: 1,
    name: '熱心新手',
    minPoints: 0,
    icon: 'heart-outline',
    color: '#9CA3AF',
    badge: '🤍',
    perk: '基本功能',
  },
  {
    level: 2,
    name: '善良夥伴',
    minPoints: 20,
    icon: 'heart-half-outline',
    color: '#3B82F6',
    badge: '💙',
    perk: '發文置頂 1 天',
  },
  {
    level: 3,
    name: '校園天使',
    minPoints: 60,
    icon: 'heart',
    color: '#8B5CF6',
    badge: '💜',
    perk: '專屬標誌 + 優先配對',
  },
  {
    level: 4,
    name: '拾金不昧大使',
    minPoints: 120,
    icon: 'trophy',
    color: '#F59E0B',
    badge: '🏆',
    perk: '學期末表揚 + 優先配對',
  },
  {
    level: 5,
    name: '傳奇守護者',
    minPoints: 250,
    icon: 'star',
    color: '#EF4444',
    badge: '⭐',
    perk: '校長嘉獎推薦 + 永久標誌',
  },
];

export function getReputationLevel(points: number): ReputationLevel {
  for (let i = REPUTATION_LEVELS.length - 1; i >= 0; i--) {
    if (points >= REPUTATION_LEVELS[i].minPoints) return REPUTATION_LEVELS[i];
  }
  return REPUTATION_LEVELS[0];
}

// ═══════════════════════════════════════════════════
// 物品保管 / 轉交流程
// ═══════════════════════════════════════════════════

export type CustodyStatus = 'held' | 'transferred' | 'claimed' | 'disposed';

export interface CustodyRecord {
  id: string;
  postId: string;
  itemDescription: string;
  heldBy: LostFoundRole;
  heldByName: string;
  heldLocation: string;
  receivedAt: string;
  transferredTo?: LostFoundRole;
  transferredAt?: string;
  claimedBy?: string;
  claimedAt?: string;
  disposedAt?: string;
  status: CustodyStatus;
  expiresAt: string; // 保管期限
  notes?: string;
}

export const CUSTODY_POLICY = {
  guardHoldDays: 14, // 警衛室保管 14 天
  deptHoldDays: 14, // 系辦保管 14 天
  libraryHoldDays: 14, // 圖書館保管 14 天
  dormHoldDays: 7, // 宿舍保管 7 天
  affairsHoldDays: 30, // 學務處最終保管 30 天
  totalMaxDays: 60, // 合計最長 60 天
  disposalMethod: '依據靜宜大學遺失物處理辦法，屆期未領者得依法處理',
  claimRequirements: ['本人學生證/教職員證', '物品描述相符', '可提供購買證明（高價值物品）'],
};

// ═══════════════════════════════════════════════════
// 推播通知
// ═══════════════════════════════════════════════════

export type LFNotificationType =
  | 'ai_match_found' // AI 找到匹配物品
  | 'item_claimed' // 你的物品被認領
  | 'claim_approved' // 認領申請通過
  | 'new_message' // 匿名聊天新訊息
  | 'post_expiring' // 文章即將過期
  | 'item_transferred' // 物品已轉交
  | 'hotspot_alert' // 進入遺失熱點
  | 'reputation_earned' // 獲得信譽積分
  | 'nearby_found' // 附近有新拾獲物
  | 'monthly_report'; // 月度統計

export interface LFNotificationConfig {
  type: LFNotificationType;
  label: string;
  icon: string;
  color: string;
  defaultEnabled: boolean;
}

export const LF_NOTIFICATION_TYPES: LFNotificationConfig[] = [
  {
    type: 'ai_match_found',
    label: 'AI 配對通知',
    icon: 'sparkles-outline',
    color: '#F59E0B',
    defaultEnabled: true,
  },
  {
    type: 'item_claimed',
    label: '物品被認領',
    icon: 'hand-left-outline',
    color: '#10B981',
    defaultEnabled: true,
  },
  {
    type: 'claim_approved',
    label: '認領通過',
    icon: 'checkmark-circle-outline',
    color: '#059669',
    defaultEnabled: true,
  },
  {
    type: 'new_message',
    label: '新訊息',
    icon: 'chatbubble-outline',
    color: '#3B82F6',
    defaultEnabled: true,
  },
  {
    type: 'post_expiring',
    label: '到期提醒',
    icon: 'time-outline',
    color: '#EF4444',
    defaultEnabled: true,
  },
  {
    type: 'item_transferred',
    label: '轉交通知',
    icon: 'arrow-forward-outline',
    color: '#8B5CF6',
    defaultEnabled: true,
  },
  {
    type: 'hotspot_alert',
    label: '熱點提醒',
    icon: 'location-outline',
    color: '#F97316',
    defaultEnabled: false,
  },
  {
    type: 'reputation_earned',
    label: '積分獲得',
    icon: 'ribbon-outline',
    color: '#EC4899',
    defaultEnabled: true,
  },
  {
    type: 'nearby_found',
    label: '附近拾獲',
    icon: 'navigate-outline',
    color: '#0D9488',
    defaultEnabled: false,
  },
  {
    type: 'monthly_report',
    label: '月報推送',
    icon: 'bar-chart-outline',
    color: '#374151',
    defaultEnabled: false,
  },
];

// ═══════════════════════════════════════════════════
// 智慧推薦 — 時段感知
// ═══════════════════════════════════════════════════

export interface LFSuggestion {
  icon: string;
  text: string;
  color: string;
  action?: string;
}

export function getSmartLFSuggestions(): LFSuggestion[] {
  const hour = new Date().getHours();
  const suggestions: LFSuggestion[] = [];

  if (hour >= 8 && hour < 10) {
    suggestions.push({
      icon: 'sunny-outline',
      text: '早安！離開宿舍前記得檢查鑰匙和學生證',
      color: '#F59E0B',
    });
  }
  if (hour >= 11 && hour < 14) {
    suggestions.push({
      icon: 'restaurant-outline',
      text: '用餐後別忘了檢查手機和錢包',
      color: '#EF4444',
      action: 'hotspot',
    });
  }
  if (hour >= 14 && hour < 18) {
    suggestions.push({
      icon: 'school-outline',
      text: '下課換教室時記得帶走充電器和水壺',
      color: '#3B82F6',
    });
  }
  if (hour >= 18 && hour < 21) {
    suggestions.push({
      icon: 'library-outline',
      text: '離開圖書館前檢查桌上是否遺漏物品',
      color: '#8B5CF6',
      action: 'hotspot',
    });
  }
  if (hour >= 21 || hour < 6) {
    suggestions.push({ icon: 'moon-outline', text: '晚歸注意隨身物品安全', color: '#6366F1' });
  }

  // 固定建議
  suggestions.push({
    icon: 'sparkles-outline',
    text: '開啟 AI 配對，系統會自動幫你比對拾獲物',
    color: '#F59E0B',
    action: 'ai_match',
  });

  return suggestions.slice(0, 3);
}

// ═══════════════════════════════════════════════════
// 模擬資料
// ═══════════════════════════════════════════════════

export function simulateLFStats() {
  return {
    totalLostThisMonth: 47,
    totalFoundThisMonth: 38,
    returnedThisMonth: 29,
    returnRate: 0.76,
    avgReturnDays: 2.3,
    topCategories: [
      { category: 'student_card' as LostItemCategory, count: 12 },
      { category: 'umbrella' as LostItemCategory, count: 8 },
      { category: 'earbuds' as LostItemCategory, count: 7 },
      { category: 'keys' as LostItemCategory, count: 6 },
      { category: 'bottle' as LostItemCategory, count: 5 },
    ],
    topLocations: [
      { locationId: 'cafeteria', count: 11 },
      { locationId: 'lib-1f', count: 9 },
      { locationId: 'zhishan', count: 7 },
      { locationId: 'gym', count: 6 },
      { locationId: 'bodo', count: 5 },
    ],
    pendingAtGuard: 8,
    pendingAtAffairs: 15,
  };
}

export function simulateRecentPosts(): LostFoundPost[] {
  return [
    {
      id: 'lf-001',
      type: 'lost',
      status: 'open',
      title: '遺失 AirPods Pro（白色充電盒）',
      category: 'earbuds',
      description: '4/23 下午在圖書館 3F 閱讀沙龍使用後忘記帶走，白色充電盒上有貼一個小熊貼紙',
      characteristics: [
        { key: '品牌', value: 'Apple AirPods Pro 2', icon: 'logo-apple' },
        { key: '顏色', value: '白色', icon: 'color-palette-outline' },
        { key: '特徵', value: '充電盒有小熊貼紙', icon: 'paw-outline' },
      ],
      imageUrls: [],
      locationId: 'lib-3f',
      locationDetail: '3F 閱讀沙龍靠窗座位',
      eventDate: '2026-04-23',
      eventTime: '15:30',
      reporterId: 'u-201',
      reporterName: '資工系同學',
      reporterRole: 'student',
      contactMethod: { type: 'in_app' },
      viewCount: 45,
      createdAt: '2026-04-23T16:00:00',
      updatedAt: '2026-04-23T16:00:00',
      expiresAt: '2026-05-07T16:00:00',
    },
    {
      id: 'lf-002',
      type: 'found',
      status: 'open',
      title: '拾獲學生證一張',
      category: 'student_card',
      description: '在濟時樓學生餐廳二樓座位上拾獲，已送交餐廳櫃檯',
      characteristics: [
        { key: '類型', value: '靜宜大學學生證', icon: 'id-card-outline' },
        { key: '備註', value: '已交餐廳櫃檯', icon: 'location-outline' },
      ],
      imageUrls: [],
      locationId: 'cafeteria',
      locationDetail: '二樓靠窗座位',
      eventDate: '2026-04-24',
      eventTime: '12:15',
      reporterId: 'u-202',
      reporterName: '熱心同學',
      reporterRole: 'student',
      contactMethod: { type: 'office', location: '濟時樓餐廳櫃檯' },
      viewCount: 32,
      createdAt: '2026-04-24T12:30:00',
      updatedAt: '2026-04-24T12:30:00',
      expiresAt: '2026-05-08T12:30:00',
      reputationAwarded: true,
    },
    {
      id: 'lf-003',
      type: 'found',
      status: 'matching',
      title: '拾獲黑色長柄雨傘',
      category: 'umbrella',
      description: '至善樓 B1 教室走廊拾獲黑色自動傘，傘柄有木質握把',
      characteristics: [
        { key: '顏色', value: '黑色', icon: 'color-palette-outline' },
        { key: '類型', value: '自動傘/長柄', icon: 'umbrella-outline' },
        { key: '特徵', value: '木質握把', icon: 'leaf-outline' },
      ],
      imageUrls: [],
      locationId: 'zhishan',
      locationDetail: 'B1 走廊傘架旁',
      eventDate: '2026-04-24',
      eventTime: '09:00',
      reporterId: 'u-guard-01',
      reporterName: '至善樓警衛',
      reporterRole: 'guard',
      contactMethod: { type: 'office', location: '至善樓 1F 警衛室' },
      matchScore: 62,
      matchedPostId: 'lf-007',
      viewCount: 18,
      createdAt: '2026-04-24T09:15:00',
      updatedAt: '2026-04-24T10:00:00',
      expiresAt: '2026-05-08T09:15:00',
    },
    {
      id: 'lf-004',
      type: 'lost',
      status: 'returned',
      title: 'iPhone 15 Pro（太空黑）',
      category: 'phone',
      description: '在伯鐸樓 5F 電腦教室遺失，已由同班同學找到並歸還',
      characteristics: [
        { key: '品牌', value: 'Apple iPhone 15 Pro', icon: 'logo-apple' },
        { key: '顏色', value: '太空黑', icon: 'color-palette-outline' },
        { key: '手機殼', value: '透明防摔殼', icon: 'phone-portrait-outline' },
      ],
      imageUrls: [],
      locationId: 'bodo',
      eventDate: '2026-04-22',
      eventTime: '14:00',
      reporterId: 'u-203',
      reporterName: '資工系同學',
      reporterRole: 'student',
      contactMethod: { type: 'in_app' },
      claimerId: 'u-204',
      claimerName: '同班同學',
      claimedAt: '2026-04-22T15:30:00',
      returnedAt: '2026-04-22T16:00:00',
      handoverMethod: 'in_person',
      viewCount: 89,
      createdAt: '2026-04-22T14:30:00',
      updatedAt: '2026-04-22T16:00:00',
      expiresAt: '2026-05-06T14:30:00',
      reputationAwarded: true,
    },
    {
      id: 'lf-005',
      type: 'found',
      status: 'open',
      title: '拾獲鑰匙串（3 把鑰匙 + 悠遊卡）',
      category: 'keys',
      description: '在體育館男更衣室地上拾獲，已送交體育館管理室',
      characteristics: [
        { key: '數量', value: '3 把鑰匙', icon: 'key-outline' },
        { key: '附件', value: '悠遊卡 + 小吊飾', icon: 'card-outline' },
        { key: '吊飾', value: '藍色小恐龍', icon: 'paw-outline' },
      ],
      imageUrls: [],
      locationId: 'gym',
      locationDetail: '男更衣室',
      eventDate: '2026-04-24',
      eventTime: '17:30',
      reporterId: 'u-guard-02',
      reporterName: '體育館管理員',
      reporterRole: 'guard',
      contactMethod: { type: 'office', location: '體育館 1F 管理室' },
      viewCount: 25,
      createdAt: '2026-04-24T17:45:00',
      updatedAt: '2026-04-24T17:45:00',
      expiresAt: '2026-05-08T17:45:00',
    },
    {
      id: 'lf-006',
      type: 'lost',
      status: 'open',
      title: '遺失透明水壺（有貼紙）',
      category: 'bottle',
      description: '在至善樓 3 樓教室上完課後忘記帶走，透明塑膠水壺約 700ml，瓶身貼有角落生物貼紙',
      characteristics: [
        { key: '材質', value: '透明塑膠', icon: 'water-outline' },
        { key: '容量', value: '約 700ml', icon: 'resize-outline' },
        { key: '貼紙', value: '角落生物', icon: 'happy-outline' },
      ],
      imageUrls: [],
      locationId: 'zhishan',
      locationDetail: '3F 階梯教室',
      eventDate: '2026-04-24',
      eventTime: '11:00',
      reporterId: 'u-205',
      reporterName: '同學',
      reporterRole: 'student',
      contactMethod: { type: 'in_app' },
      viewCount: 12,
      createdAt: '2026-04-24T11:30:00',
      updatedAt: '2026-04-24T11:30:00',
      expiresAt: '2026-05-08T11:30:00',
    },
  ];
}

export function simulateMyReputation() {
  return {
    userId: 'current-user',
    totalPoints: 35,
    level: getReputationLevel(35),
    history: [
      { actionId: 'found_post', points: 5, date: '2026-03-15', note: '發布拾獲學生證' },
      { actionId: 'return_item', points: 20, date: '2026-03-15', note: '歸還學生證' },
      { actionId: 'quick_return', points: 10, date: '2026-03-15', note: '2 小時內歸還' },
    ],
    returnedCount: 2,
    foundPostCount: 3,
    thankReceived: 2,
  };
}
