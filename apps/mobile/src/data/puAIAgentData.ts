import { getAssistantProfileTrainingSeeds } from './aiAssistantProfile';
import { getPuDiningMenuItems } from './puDiningCatalog';

/**
 * 靜宜大學 AI 代理式助理 — 完整架構 + 真實資料
 *
 * 創新定位：從「聊天問答機器人」→「校園全能代理 AI」
 * 市面上的校園 AI 只做「回答問題」
 * 我們做到：
 *  1. 代理執行 — AI 直接幫你完成操作（訂餐/掛號/報修/請假/發文）
 *  2. 多步驟任務鏈 — 「我生病了」→ 預約掛號 + 通知教授 + 調整待辦
 *  3. 確認式對話 — 執行不可逆操作前必定確認
 *  4. 跨模組編排 — 整合所有 APP 功能為統一 Agent Tool
 *  5. 記憶與偏好 — 記住你的飲食偏好/常去地點/課程/作息
 *  6. 主動智慧推播 — 偵測情境自動建議（快遲到/作業截止/包裹到）
 *  7. 角色感知 — 教授/學生/職員 看到不同能力
 *  8. 任務進度追蹤 — 長任務（維修/包裹）持續追蹤回報
 */

// ═══════════════════════════════════════════════════
// Agent Tool 定義 — 每個 APP 功能對應一個 Tool
// ═══════════════════════════════════════════════════

export type AgentToolCategory =
  | 'cafeteria' // 餐廳 — 訂餐/推薦/查菜單
  | 'health' // 健康 — 掛號/症狀評估/諮商
  | 'library' // 圖書館 — 借書/預約座位/查詢
  | 'dorm' // 宿舍 — 報修/洗衣/包裹/門禁
  | 'lost_found' // 失物招領 — 發文/查詢/認領
  | 'print' // 列印 — 上傳/列印/查餘額
  | 'course' // 課程 — 請假/查成績/選課
  | 'transport' // 交通 — 查公車/叫車/停車
  | 'calendar' // 行事曆 — 新增/提醒/查排程
  | 'social' // 社群 — 發訊息/建群組/公告
  | 'system'; // 系統 — 設定/個人檔案/回饋

export type ToolExecutionStatus =
  | 'pending'
  | 'confirming'
  | 'executing'
  | 'success'
  | 'failed'
  | 'cancelled';

export interface AgentTool {
  id: string;
  category: AgentToolCategory;
  name: string;
  description: string;
  icon: string;
  color: string;
  parameters: ToolParameter[];
  requiresConfirmation: boolean; // 執行前需要用戶確認
  isReversible: boolean; // 是否可撤銷
  estimatedDuration: string; // 預估執行時間
  relatedTools?: string[]; // 可搭配的工具
  roleAccess: AgentRole[]; // 哪些角色可用
}

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'time' | 'select' | 'multi_select';
  label: string;
  required: boolean;
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
  hint?: string;
}

export interface ToolExecution {
  id: string;
  toolId: string;
  status: ToolExecutionStatus;
  params: Record<string, any>;
  result?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
  confirmationMessage?: string;
}

// ═══════════════════════════════════════════════════
// 所有 Agent Tools 定義
// ═══════════════════════════════════════════════════

export const AGENT_TOOLS: AgentTool[] = [
  // ── 餐廳模組 ──
  {
    id: 'order_meal',
    category: 'cafeteria',
    name: '訂餐',
    icon: 'restaurant-outline',
    color: '#F59E0B',
    description: '從校園餐廳整理餐點，確認後以 vendorId／itemId／quantity 呼叫後端建立訂單',
    parameters: [
      {
        name: 'vendorId',
        type: 'string',
        label: '店家 ID',
        required: true,
        hint: '對應餐廳 cafeteriaId 或 merchantId（系統會從你選的餐點帶入）',
      },
      {
        name: 'itemId',
        type: 'string',
        label: '餐點 ID',
        required: true,
        hint: '菜單品項 id（與後端 menuItemId 一致）',
      },
      {
        name: 'quantity',
        type: 'number',
        label: '數量',
        required: true,
        hint: '至少 1',
      },
      {
        name: 'pickup_time',
        type: 'time',
        label: '取餐時間',
        required: false,
        hint: '不填則為盡快',
      },
      {
        name: 'note',
        type: 'string',
        label: '備註',
        required: false,
        hint: '例如：不要香菜、少辣',
      },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '即時',
    relatedTools: ['recommend_meal', 'check_wait_time'],
    roleAccess: ['student', 'faculty', 'staff'],
  },
  {
    id: 'recommend_meal',
    category: 'cafeteria',
    name: '推薦餐點',
    icon: 'sparkles-outline',
    color: '#10B981',
    description: '根據偏好、預算、營養需求推薦今日餐點',
    parameters: [
      { name: 'budget', type: 'number', label: '預算（元）', required: false, hint: '不填則不限' },
      {
        name: 'preference',
        type: 'multi_select',
        label: '偏好',
        required: false,
        options: [
          { value: 'meat', label: '有肉' },
          { value: 'vegan', label: '素食' },
          { value: 'spicy', label: '辣' },
          { value: 'healthy', label: '健康' },
          { value: 'fast', label: '快速' },
          { value: 'cheap', label: '便宜' },
        ],
      },
    ],
    requiresConfirmation: false,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student', 'faculty', 'staff'],
  },
  {
    id: 'check_wait_time',
    category: 'cafeteria',
    name: '查詢等候時間',
    icon: 'time-outline',
    color: '#3B82F6',
    description: '查看各餐廳目前的排隊/等候時間',
    parameters: [],
    requiresConfirmation: false,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student', 'faculty', 'staff'],
  },

  // ── 健康模組 ──
  {
    id: 'book_health',
    category: 'health',
    name: '預約掛號',
    icon: 'calendar-outline',
    color: '#10B981',
    description: '預約衛保組門診或心理諮商',
    parameters: [
      {
        name: 'department',
        type: 'select',
        label: '科別',
        required: true,
        options: [
          { value: 'general', label: '一般門診' },
          { value: 'mental', label: '心理諮商' },
          { value: 'sports_injury', label: '運動傷害' },
          { value: 'dental', label: '牙科' },
          { value: 'eye', label: '視力保健' },
          { value: 'nutrition', label: '營養諮詢' },
        ],
      },
      {
        name: 'date',
        type: 'date',
        label: '日期',
        required: false,
        hint: '不填則為最近可預約時段',
      },
      { name: 'symptom', type: 'string', label: '症狀描述', required: false },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '即時',
    relatedTools: ['symptom_check', 'cancel_appointment'],
    roleAccess: ['student', 'faculty', 'staff'],
  },
  {
    id: 'symptom_check',
    category: 'health',
    name: '症狀自評',
    icon: 'medical-outline',
    color: '#EF4444',
    description: 'AI 評估症狀嚴重度，建議是否就醫',
    parameters: [
      { name: 'symptoms', type: 'string', label: '症狀描述', required: true, hint: '描述你的不適' },
      { name: 'duration', type: 'string', label: '持續時間', required: false },
    ],
    requiresConfirmation: false,
    isReversible: true,
    estimatedDuration: '即時',
    relatedTools: ['book_health'],
    roleAccess: ['student', 'faculty', 'staff'],
  },
  {
    id: 'record_mood',
    category: 'health',
    name: '記錄心情',
    icon: 'happy-outline',
    color: '#7C3AED',
    description: '記錄今天的情緒狀態',
    parameters: [
      {
        name: 'level',
        type: 'select',
        label: '心情',
        required: true,
        options: [
          { value: '1', label: '😞 很差' },
          { value: '2', label: '😟 不太好' },
          { value: '3', label: '😐 普通' },
          { value: '4', label: '🙂 不錯' },
          { value: '5', label: '😄 很好' },
        ],
      },
      {
        name: 'factors',
        type: 'multi_select',
        label: '影響因素',
        required: false,
        options: [
          { value: 'academic', label: '課業' },
          { value: 'social', label: '人際' },
          { value: 'sleep', label: '睡眠' },
          { value: 'health', label: '身體' },
        ],
      },
      { name: 'note', type: 'string', label: '一句話紀錄', required: false },
    ],
    requiresConfirmation: false,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student', 'faculty', 'staff'],
  },

  // ── 圖書館模組 ──
  {
    id: 'reserve_seat',
    category: 'library',
    name: '預約座位',
    icon: 'desktop-outline',
    color: '#8B5CF6',
    description: '預約圖書館自習座位或討論室',
    parameters: [
      {
        name: 'type',
        type: 'select',
        label: '類型',
        required: true,
        options: [
          { value: 'individual', label: '個人自習座位' },
          { value: 'group_room', label: '團體討論室' },
          { value: 'quiet_zone', label: '安靜閱覽區' },
        ],
      },
      { name: 'date', type: 'date', label: '日期', required: true },
      {
        name: 'time_slot',
        type: 'select',
        label: '時段',
        required: true,
        options: [
          { value: 'morning', label: '上午 (08:00-12:00)' },
          { value: 'afternoon', label: '下午 (12:00-17:00)' },
          { value: 'evening', label: '晚上 (17:00-21:30)' },
        ],
      },
      {
        name: 'floor',
        type: 'select',
        label: '樓層',
        required: false,
        options: [
          { value: '1F', label: '1F 大廳' },
          { value: '2F', label: '2F 書庫' },
          { value: '3F', label: '3F 閱讀沙龍' },
          { value: 'B1', label: 'B1 期刊區' },
        ],
      },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student', 'faculty'],
  },
  {
    id: 'search_book',
    category: 'library',
    name: '查詢/借書',
    icon: 'book-outline',
    color: '#0D9488',
    description: '搜尋圖書館藏書、查看可借狀態、預約借閱',
    parameters: [
      { name: 'query', type: 'string', label: '書名/作者/ISBN', required: true },
      {
        name: 'action',
        type: 'select',
        label: '操作',
        required: false,
        options: [
          { value: 'search', label: '只查詢' },
          { value: 'reserve', label: '預約借閱' },
        ],
      },
    ],
    requiresConfirmation: false,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student', 'faculty', 'staff'],
  },

  // ── 宿舍模組 ──
  {
    id: 'report_repair',
    category: 'dorm',
    name: '報修',
    icon: 'construct-outline',
    color: '#F59E0B',
    description: '提交宿舍設施維修申請',
    parameters: [
      {
        name: 'category',
        type: 'select',
        label: '類別',
        required: true,
        options: [
          { value: 'plumbing', label: '水管/馬桶' },
          { value: 'electrical', label: '電力/燈具' },
          { value: 'furniture', label: '家具/門鎖' },
          { value: 'ac', label: '冷氣/暖氣' },
          { value: 'network', label: '網路' },
          { value: 'other', label: '其他' },
        ],
      },
      {
        name: 'description',
        type: 'string',
        label: '問題描述',
        required: true,
        hint: '越詳細越快處理',
      },
      { name: 'room', type: 'string', label: '房號', required: true },
      {
        name: 'urgency',
        type: 'select',
        label: '急迫度',
        required: false,
        options: [
          { value: 'low', label: '不急' },
          { value: 'medium', label: '一般' },
          { value: 'high', label: '緊急' },
        ],
      },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '即時提交，1-3 天處理',
    roleAccess: ['student'],
  },
  {
    id: 'check_laundry',
    category: 'dorm',
    name: '查洗衣機',
    icon: 'water-outline',
    color: '#3B82F6',
    description: '查看洗衣機/烘衣機使用狀態和預估完成時間',
    parameters: [
      {
        name: 'building',
        type: 'select',
        label: '宿舍',
        required: false,
        options: [
          { value: 'schultz', label: '希嘉學苑' },
          { value: 'bosco', label: '思高學苑' },
        ],
      },
    ],
    requiresConfirmation: false,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student'],
  },
  {
    id: 'check_package',
    category: 'dorm',
    name: '查包裹',
    icon: 'cube-outline',
    color: '#EC4899',
    description: '查詢是否有待領包裹',
    parameters: [],
    requiresConfirmation: false,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student'],
  },

  // ── 失物招領模組 ──
  {
    id: 'post_lost',
    category: 'lost_found',
    name: '報失',
    icon: 'alert-circle-outline',
    color: '#EF4444',
    description: '發布遺失物品公告，AI 自動比對拾獲物',
    parameters: [
      { name: 'item', type: 'string', label: '物品名稱', required: true },
      {
        name: 'category',
        type: 'select',
        label: '分類',
        required: true,
        options: [
          { value: 'phone', label: '手機' },
          { value: 'wallet', label: '錢包' },
          { value: 'keys', label: '鑰匙' },
          { value: 'earbuds', label: '耳機' },
          { value: 'student_card', label: '學生證' },
          { value: 'umbrella', label: '雨傘' },
          { value: 'other', label: '其他' },
        ],
      },
      { name: 'location', type: 'string', label: '遺失地點', required: true },
      {
        name: 'features',
        type: 'string',
        label: '特徵描述',
        required: true,
        hint: '顏色/品牌/貼紙/刻字等',
      },
      { name: 'time', type: 'string', label: '大約時間', required: false },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '即時發布',
    relatedTools: ['search_found'],
    roleAccess: ['student', 'faculty', 'staff'],
  },
  {
    id: 'search_found',
    category: 'lost_found',
    name: '搜尋拾獲物',
    icon: 'search-outline',
    color: '#10B981',
    description: '搜尋目前所有拾獲物品',
    parameters: [{ name: 'keyword', type: 'string', label: '關鍵字', required: true }],
    requiresConfirmation: false,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student', 'faculty', 'staff'],
  },

  // ── 列印模組 ──
  {
    id: 'print_file',
    category: 'print',
    name: '列印',
    icon: 'print-outline',
    color: '#6366F1',
    description: '上傳檔案到雲端列印佇列',
    parameters: [
      { name: 'file_name', type: 'string', label: '檔案名稱', required: true },
      { name: 'copies', type: 'number', label: '份數', required: false, default: 1 },
      {
        name: 'color',
        type: 'select',
        label: '色彩',
        required: false,
        options: [
          { value: 'bw', label: '黑白' },
          { value: 'color', label: '彩色' },
        ],
      },
      {
        name: 'sides',
        type: 'select',
        label: '單雙面',
        required: false,
        options: [
          { value: 'single', label: '單面' },
          { value: 'double', label: '雙面' },
        ],
      },
      {
        name: 'printer',
        type: 'select',
        label: '印表機',
        required: false,
        options: [
          { value: 'lib_1f', label: '圖書館 1F' },
          { value: 'lib_b1', label: '圖書館 B1' },
          { value: 'bodo_3f', label: '伯鐸樓 3F' },
          { value: 'admin_1f', label: '行政大樓 1F' },
        ],
      },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '上傳 ~10 秒',
    roleAccess: ['student', 'faculty', 'staff'],
  },
  {
    id: 'check_print_balance',
    category: 'print',
    name: '查列印餘額',
    icon: 'card-outline',
    color: '#374151',
    description: '查詢影印卡餘額',
    parameters: [],
    requiresConfirmation: false,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student', 'faculty', 'staff'],
  },

  // ── 課程模組 ──
  {
    id: 'request_leave',
    category: 'course',
    name: '請假',
    icon: 'document-text-outline',
    color: '#DC2626',
    description: '向授課教師提交請假申請',
    parameters: [
      { name: 'course', type: 'string', label: '課程名稱', required: true },
      { name: 'date', type: 'date', label: '日期', required: true },
      {
        name: 'reason',
        type: 'select',
        label: '假別',
        required: true,
        options: [
          { value: 'sick', label: '病假' },
          { value: 'personal', label: '事假' },
          { value: 'official', label: '公假' },
          { value: 'funeral', label: '喪假' },
        ],
      },
      { name: 'detail', type: 'string', label: '事由說明', required: true },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '即時提交，待教師審核',
    roleAccess: ['student'],
  },
  {
    id: 'check_grades',
    category: 'course',
    name: '查成績',
    icon: 'school-outline',
    color: '#3B82F6',
    description: '查詢最新成績或學期平均',
    parameters: [
      {
        name: 'scope',
        type: 'select',
        label: '範圍',
        required: false,
        options: [
          { value: 'latest', label: '最新成績' },
          { value: 'semester', label: '本學期' },
          { value: 'all', label: '歷年' },
        ],
      },
    ],
    requiresConfirmation: false,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student'],
  },
  {
    id: 'check_assignments',
    category: 'course',
    name: '查作業截止',
    icon: 'clipboard-outline',
    color: '#F59E0B',
    description: '查詢所有未繳作業及截止日期',
    parameters: [],
    requiresConfirmation: false,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student'],
  },

  // ── 交通模組 ──
  {
    id: 'check_bus',
    category: 'transport',
    name: '查公車',
    icon: 'bus-outline',
    color: '#059669',
    description: '查詢校門口公車到站時間',
    parameters: [
      {
        name: 'destination',
        type: 'string',
        label: '目的地',
        required: false,
        hint: '例如：台中火車站',
      },
    ],
    requiresConfirmation: false,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student', 'faculty', 'staff'],
  },

  // ── 行事曆模組 ──
  {
    id: 'set_reminder',
    category: 'calendar',
    name: '設定提醒',
    icon: 'alarm-outline',
    color: '#8B5CF6',
    description: '設定時間到時推播提醒',
    parameters: [
      { name: 'title', type: 'string', label: '提醒內容', required: true },
      {
        name: 'datetime',
        type: 'string',
        label: '時間',
        required: true,
        hint: '例如：明天下午 2 點、3 小時後',
      },
      {
        name: 'repeat',
        type: 'select',
        label: '重複',
        required: false,
        options: [
          { value: 'once', label: '一次' },
          { value: 'daily', label: '每天' },
          { value: 'weekly', label: '每週' },
        ],
      },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student', 'faculty', 'staff'],
  },

  // ── 社群模組 ──
  {
    id: 'send_message',
    category: 'social',
    name: '發訊息',
    icon: 'chatbubble-outline',
    color: '#EC4899',
    description: '發送訊息給同學或群組',
    parameters: [
      { name: 'recipient', type: 'string', label: '收件人/群組', required: true },
      { name: 'content', type: 'string', label: '訊息內容', required: true },
    ],
    requiresConfirmation: true,
    isReversible: false,
    estimatedDuration: '即時',
    roleAccess: ['student', 'faculty', 'staff'],
  },

  // ── 同儕互動工具（學生 ↔ 學生）──
  {
    id: 'peer_review',
    category: 'social',
    name: '同儕互評',
    icon: 'people-outline',
    color: '#8B5CF6',
    description: 'AI 分配作業互評，引導評分標準並彙整回饋',
    parameters: [
      { name: 'assignment', type: 'string', label: '作業名稱', required: true },
      { name: 'criteria', type: 'string', label: '評分重點', required: false },
    ],
    requiresConfirmation: true,
    isReversible: false,
    estimatedDuration: '1-2 分鐘',
    roleAccess: ['student', 'faculty'],
    relatedTools: ['check_assignments'],
  },
  {
    id: 'study_group_match',
    category: 'social',
    name: '組隊配對',
    icon: 'git-merge-outline',
    color: '#06B6D4',
    description: 'AI 根據課表、興趣、能力自動配對組員或讀書夥伴',
    parameters: [
      {
        name: 'purpose',
        type: 'select',
        label: '目的',
        required: true,
        options: [
          { value: 'study', label: '讀書會' },
          { value: 'project', label: '專題組員' },
          { value: 'exam_prep', label: '考前衝刺' },
          { value: 'tutor', label: '課業輔導' },
        ],
      },
      { name: 'course', type: 'string', label: '相關課程', required: false },
      { name: 'group_size', type: 'string', label: '人數', required: false },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student'],
  },
  {
    id: 'share_notes',
    category: 'social',
    name: '共享筆記',
    icon: 'document-attach-outline',
    color: '#10B981',
    description: 'AI 整理筆記重點，分享至群組並標記精華',
    parameters: [
      { name: 'course', type: 'string', label: '課程', required: true },
      { name: 'topic', type: 'string', label: '主題/章節', required: false },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student'],
    relatedTools: ['send_message'],
  },
  {
    id: 'group_order',
    category: 'cafeteria',
    name: '揪團訂餐',
    icon: 'fast-food-outline',
    color: '#F97316',
    description: 'AI 統整多人點餐偏好，建立合併訂餐草稿並計算分攤費用',
    parameters: [
      { name: 'group', type: 'string', label: '群組/好友', required: true },
      {
        name: 'cafeteria',
        type: 'select',
        label: '餐廳',
        required: false,
        options: [
          { value: 'jingyuan', label: '靜園餐廳' },
          { value: 'yiyuan', label: '宜園餐廳' },
          { value: 'zhishan-1f', label: '至善美食廣場一樓' },
          { value: 'zhishan-2f', label: '至善美食廣場二樓' },
        ],
      },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '2-3 分鐘',
    roleAccess: ['student'],
    relatedTools: ['order_meal', 'recommend_meal'],
  },
  {
    id: 'tutoring_request',
    category: 'course',
    name: '課業求助',
    icon: 'school-outline',
    color: '#7C3AED',
    description: 'AI 媒合學長姐或高手同學進行課業輔導',
    parameters: [
      { name: 'subject', type: 'string', label: '科目/問題', required: true },
      {
        name: 'urgency',
        type: 'select',
        label: '急迫度',
        required: false,
        options: [
          { value: 'low', label: '不急' },
          { value: 'medium', label: '這週內' },
          { value: 'high', label: '明天要交' },
        ],
      },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student'],
    relatedTools: ['study_group_match', 'question_forward'],
  },
  {
    id: 'event_invite',
    category: 'social',
    name: '活動邀約',
    icon: 'calendar-outline',
    color: '#EC4899',
    description: 'AI 根據共同興趣推薦活動，自動發送邀約給好友',
    parameters: [
      { name: 'event', type: 'string', label: '活動名稱', required: true },
      { name: 'friends', type: 'string', label: '邀請對象', required: false },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student'],
    relatedTools: ['send_message'],
  },
  {
    id: 'carpool_match',
    category: 'transport',
    name: '共乘配對',
    icon: 'car-outline',
    color: '#059669',
    description: 'AI 根據住址和時間配對共乘同學',
    parameters: [
      {
        name: 'direction',
        type: 'select',
        label: '方向',
        required: true,
        options: [
          { value: 'to_school', label: '到學校' },
          { value: 'from_school', label: '回家' },
        ],
      },
      { name: 'time', type: 'string', label: '出發時間', required: false },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student'],
    relatedTools: ['check_bus'],
  },
  {
    id: 'secondhand_trade',
    category: 'social',
    name: '二手交易',
    icon: 'swap-horizontal-outline',
    color: '#D97706',
    description: 'AI 比對二手書/用品需求，自動配對買賣雙方',
    parameters: [
      {
        name: 'action',
        type: 'select',
        label: '我要',
        required: true,
        options: [
          { value: 'sell', label: '賣' },
          { value: 'buy', label: '買' },
        ],
      },
      { name: 'item', type: 'string', label: '物品名稱', required: true },
      { name: 'price', type: 'string', label: '期望價格', required: false },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['student'],
    relatedTools: ['send_message'],
  },

  // ── 教師互動工具 ──
  {
    id: 'assignment_publish',
    category: 'course',
    name: '發布作業',
    icon: 'create-outline',
    color: '#2563EB',
    description: 'AI 格式化作業要求、設定截止日、通知全班',
    parameters: [
      { name: 'course', type: 'string', label: '課程', required: true },
      { name: 'title', type: 'string', label: '作業標題', required: true },
      { name: 'deadline', type: 'string', label: '截止日', required: true },
      { name: 'description', type: 'string', label: '作業說明', required: false },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['faculty'],
    relatedTools: ['batch_notify', 'peer_review_assign'],
  },
  {
    id: 'peer_review_assign',
    category: 'course',
    name: '分配互評',
    icon: 'git-network-outline',
    color: '#7C3AED',
    description: 'AI 公平分配互評配對，確保每人評和被評次數均等',
    parameters: [
      { name: 'assignment', type: 'string', label: '作業', required: true },
      { name: 'reviews_per_student', type: 'string', label: '每人評幾份', required: false },
    ],
    requiresConfirmation: true,
    isReversible: true,
    estimatedDuration: '即時',
    roleAccess: ['faculty'],
    relatedTools: ['assignment_publish'],
  },
  {
    id: 'attendance_alert',
    category: 'course',
    name: '出席警示',
    icon: 'alert-outline',
    color: '#DC2626',
    description: 'AI 偵測缺曠達標學生，自動發送提醒並通知導師',
    parameters: [
      { name: 'course', type: 'string', label: '課程', required: true },
      { name: 'threshold', type: 'string', label: '缺曠門檻（次）', required: false },
    ],
    requiresConfirmation: true,
    isReversible: false,
    estimatedDuration: '即時',
    roleAccess: ['faculty'],
    relatedTools: ['batch_notify'],
  },
  {
    id: 'learning_insight',
    category: 'course',
    name: '學習分析',
    icon: 'analytics-outline',
    color: '#0891B2',
    description: 'AI 分析全班學習數據，產生個別化回饋與建議',
    parameters: [{ name: 'course', type: 'string', label: '課程', required: true }],
    requiresConfirmation: false,
    isReversible: false,
    estimatedDuration: '10-30 秒',
    roleAccess: ['faculty'],
  },
];

export function getToolsByCategory(category: AgentToolCategory): AgentTool[] {
  return AGENT_TOOLS.filter((t) => t.category === category);
}

export function getToolById(id: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.id === id);
}

// ═══════════════════════════════════════════════════
// 多步驟任務鏈 (Task Chain)
// ═══════════════════════════════════════════════════

export interface TaskChain {
  id: string;
  trigger: string; // 觸發句型 pattern
  name: string;
  description: string;
  icon: string;
  color: string;
  steps: TaskStep[];
}

export interface TaskStep {
  order: number;
  toolId: string;
  label: string;
  autoParams?: Record<string, any>; // 自動帶入的參數
  dependsOn?: number; // 依賴前一步結果
  optional?: boolean;
}

export const TASK_CHAINS: TaskChain[] = [
  {
    id: 'sick_day',
    trigger: '我生病|我不舒服|想請病假|頭痛|發燒|感冒|喉嚨痛|身體不適',
    name: '生病處理',
    description: '症狀評估 → 掛號 → 請假 → 通知組員',
    icon: 'medical-outline',
    color: '#EF4444',
    steps: [
      { order: 1, toolId: 'symptom_check', label: 'AI 症狀評估' },
      { order: 2, toolId: 'book_health', label: '預約掛號', dependsOn: 1 },
      { order: 3, toolId: 'request_leave', label: '提交請假', autoParams: { reason: 'sick' } },
      { order: 4, toolId: 'send_message', label: '通知課程群組', optional: true },
    ],
  },
  {
    id: 'lost_item_flow',
    trigger: '我遺失|我掉了|找不到我的',
    name: '遺失物處理',
    description: '發布遺失文 → AI 比對 → 通知結果',
    icon: 'alert-circle-outline',
    color: '#F59E0B',
    steps: [
      { order: 1, toolId: 'post_lost', label: '發布遺失公告' },
      { order: 2, toolId: 'search_found', label: 'AI 自動比對拾獲物', dependsOn: 1 },
      {
        order: 3,
        toolId: 'set_reminder',
        label: '設定追蹤提醒',
        autoParams: { title: '檢查遺失物配對結果' },
        optional: true,
      },
    ],
  },
  {
    id: 'study_session',
    trigger: '我要去圖書館|我要讀書|準備考試|我要自習|想讀書|想自習|考試要到了',
    name: '備考模式',
    description: '預約座位 → 設定讀書計時 → 關閉社群通知',
    icon: 'book-outline',
    color: '#8B5CF6',
    steps: [
      { order: 1, toolId: 'reserve_seat', label: '預約圖書館座位' },
      { order: 2, toolId: 'set_reminder', label: '設定讀書結束提醒' },
      { order: 3, toolId: 'check_assignments', label: '列出待交作業', optional: true },
    ],
  },
  {
    id: 'lunch_order',
    trigger: '幫我訂午餐|幫我訂餐|我要訂餐|訂午餐|我要點餐',
    name: '午餐助手',
    description: '推薦餐點 → 查等候資料 → 建立訂餐單 → 提醒取餐',
    icon: 'restaurant-outline',
    color: '#10B981',
    steps: [
      { order: 1, toolId: 'recommend_meal', label: '推薦餐點' },
      { order: 2, toolId: 'check_wait_time', label: '查詢等候時間' },
      { order: 3, toolId: 'order_meal', label: '確認訂餐單', dependsOn: 1 },
      {
        order: 4,
        toolId: 'set_reminder',
        label: '設定取餐提醒',
        autoParams: { title: '去取餐啦！' },
        optional: true,
      },
    ],
  },
  {
    id: 'dorm_issue',
    trigger: '宿舍壞了|馬桶|水管|冷氣壞|冷氣壞了|宿舍冷氣|幫我報修|我要報修',
    name: '宿舍報修',
    description: '回報問題 → 提交報修 → 追蹤進度',
    icon: 'construct-outline',
    color: '#DC2626',
    steps: [
      { order: 1, toolId: 'report_repair', label: '提交維修單' },
      {
        order: 2,
        toolId: 'set_reminder',
        label: '追蹤維修進度',
        autoParams: { title: '確認報修處理狀態', datetime: '2天後' },
      },
    ],
  },
  // ── 同儕互動任務鏈 ──
  {
    id: 'group_study',
    trigger: '找人一起讀|讀書會|組讀書|找隊友|組隊',
    name: '組隊讀書',
    description: '配對夥伴 → 建群組 → 預約座位 → 設提醒',
    icon: 'people-outline',
    color: '#06B6D4',
    steps: [
      { order: 1, toolId: 'study_group_match', label: 'AI 配對讀書夥伴' },
      { order: 2, toolId: 'send_message', label: '���送邀約訊息', dependsOn: 1 },
      {
        order: 3,
        toolId: 'reserve_seat',
        label: '預約討論室',
        autoParams: { type: 'group_room' },
        optional: true,
      },
      { order: 4, toolId: 'set_reminder', label: '設定讀書提醒', optional: true },
    ],
  },
  {
    id: 'group_lunch',
    trigger: '揪團|一起吃|揪人訂|大家一起點',
    name: '揪團訂餐',
    description: '建團 → 收集偏好 → 合併訂餐草稿 → 分攤',
    icon: 'fast-food-outline',
    color: '#F97316',
    steps: [
      { order: 1, toolId: 'group_order', label: '建立揪團' },
      { order: 2, toolId: 'recommend_meal', label: 'AI 推薦大家都喜歡的', dependsOn: 1 },
      { order: 3, toolId: 'order_meal', label: '建立合併訂餐單', dependsOn: 2 },
      { order: 4, toolId: 'send_message', label: '通知取餐', dependsOn: 3, optional: true },
    ],
  },
  {
    id: 'help_request',
    trigger: '不會寫作業|看不懂課本|誰能教我|找人教我|課業求助',
    name: '課業求助',
    description: '描述問題 → 配對高手 → 發送求助',
    icon: 'school-outline',
    color: '#7C3AED',
    steps: [
      { order: 1, toolId: 'tutoring_request', label: 'AI 媒合課業輔導' },
      { order: 2, toolId: 'send_message', label: '發送求助訊息', dependsOn: 1 },
      { order: 3, toolId: 'set_reminder', label: '追蹤回覆', optional: true },
    ],
  },
  {
    id: 'sell_stuff',
    trigger: '想賣|要賣|二手|出清|賣書',
    name: '��手交易',
    description: '刊登物品 → AI 配對買家 → 通知',
    icon: 'swap-horizontal-outline',
    color: '#D97706',
    steps: [
      {
        order: 1,
        toolId: 'secondhand_trade',
        label: '刊登二手物品',
        autoParams: { action: 'sell' },
      },
      { order: 2, toolId: 'send_message', label: '通知有興趣的同學', dependsOn: 1, optional: true },
    ],
  },
];

export function matchTaskChain(userMessage: string): TaskChain | null {
  const msg = userMessage.toLowerCase();
  for (const chain of TASK_CHAINS) {
    const patterns = chain.trigger.split('|');
    if (patterns.some((p) => msg.includes(p))) return chain;
  }
  return null;
}

// ═══════════════════════════════════════════════════
// Agent 記憶 / 偏好系統（Per-User 隔離）
// ═══════════════════════════════════════════════════

/**
 * 個人記憶系統 — 每位用戶獨立隔離
 *
 * 設計原則：
 *  1. userId 為主鍵 — 所有記憶嚴格綁定 userId，不同用戶永遠不會交叉
 *  2. 分層記憶：
 *     - shortTerm：本次對話內的臨時記憶（關閉 APP 即清除）
 *     - longTerm：跨對話持久記憶（儲存至 AsyncStorage，key = `agent_memory_${userId}`）
 *     - learnedFacts：AI 從對話中學習到的事實（如「他是資工系」「他吃素」）
 *  3. 記憶衰減：recentActions 最多保留 50 筆，learnedFacts 最多 100 筆
 *  4. 隱私安全：不同用戶 memory 物件完全隔離，storageKey 含 userId
 */

export interface AgentMemory {
  userId: string;
  version: number; // 記憶格式版本（for migration）
  createdAt: string;
  lastActiveAt: string;
  preferences: UserPreferences;
  recentActions: RecentAction[];
  conversationPatterns: string[]; // 常用句型
  knownSchedule: ScheduleSlot[]; // 已知作息
  learnedFacts: LearnedFact[]; // AI 學習到的個人事實
  conversationSummaries: ConversationSummary[]; // 歷史對話摘要
}

export interface UserPreferences {
  foodPreferences: string[]; // 飲食偏好 ["不吃香菜", "喜歡辣"]
  allergens: string[]; // 過敏原
  frequentLocations: string[]; // 常去地點
  communicationStyle: 'formal' | 'casual' | 'emoji';
  reminderLeadTime: number; // 提前幾分鐘提醒
  quietHours: { start: string; end: string };
  preferredCafeteria?: string; // 常去的餐廳
  dormRoom?: string; // 宿舍房號
  department?: string; // 科系
  yearOfStudy?: number; // 年級
}

export interface LearnedFact {
  id: string;
  fact: string; // e.g. "使用者對海鮮過敏"
  source: 'explicit' | 'inferred'; // 用戶明確說的 or AI 推斷的
  confidence: number; // 0-1
  learnedAt: string;
  category: 'personal' | 'academic' | 'dietary' | 'health' | 'schedule' | 'social';
}

export interface ConversationSummary {
  id: string;
  date: string;
  summary: string; // 對話重點摘要
  keyTopics: string[]; // 主要話題
  actionsPerformed: string[]; // 執行過的操作
}

export interface RecentAction {
  toolId: string;
  params: Record<string, any>;
  timestamp: string;
  wasSuccessful: boolean;
}

export interface ScheduleSlot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  activity: string;
  location?: string;
}

// ── 思考鏈 (Thinking Chain) ──

export interface ThinkingStep {
  step: string;
  detail: string;
  status: 'done' | 'checking' | 'warning' | 'info';
}

export interface ThinkingChain {
  steps: ThinkingStep[];
  conclusion: string;
  dataAvailability: Record<string, boolean>;
}

/**
 * 建立思考鏈 — AI 先推理再回答
 *
 * @param userMessage 用戶訊息
 * @param context 可用的資料
 * @param memory 用戶記憶
 * @returns 推理步驟 + 資料可用性
 */
export function buildThinkingChain(
  userMessage: string,
  availableData: {
    hasCourses: boolean;
    hasAssignments: boolean;
    hasGrades: boolean;
    hasAnnouncements: boolean;
    hasEvents: boolean;
    hasMenus: boolean;
    hasPois: boolean;
    hasMemory: boolean;
  },
  memory?: AgentMemory | null,
): ThinkingChain {
  const msg = userMessage.toLowerCase();
  const steps: ThinkingStep[] = [];
  const dataAvailability: Record<string, boolean> = { ...availableData };

  // Step 1: 分析用戶意圖
  let intentDesc = '一般問答';
  if (/吃|餐|飯|麵|菜|食|訂|點餐|推薦|便宜|蔬菜|素食|肉/.test(msg)) intentDesc = '餐飲相關';
  else if (/畢業|學分|成績|GPA|選課|修課|課表|課程|幾門課/.test(msg)) intentDesc = '學業/課程';
  else if (/不舒服|痛|病|掛號|看醫|發燒|感冒|症狀/.test(msg)) intentDesc = '健康/就醫';
  else if (/公告|消息|通知/.test(msg)) intentDesc = '查詢公告';
  else if (/活動|報名|社團/.test(msg)) intentDesc = '查詢活動';
  else if (/在哪|怎麼走|地點|導航|地圖/.test(msg)) intentDesc = '地點查詢';
  else if (/請假|病假|事假/.test(msg)) intentDesc = '請假申請';
  else if (/公車|交通|搭車|怎麼去/.test(msg)) intentDesc = '交通查詢';
  else if (/宿舍|報修|洗衣|包裹|壞了/.test(msg)) intentDesc = '宿舍服務';
  else if (/圖書館|借書|座位|自習/.test(msg)) intentDesc = '圖書館服務';
  else if (/天氣|下雨|帶傘/.test(msg)) intentDesc = '天氣查詢';
  else if (/心情|壓力|焦慮|難過|煩/.test(msg)) intentDesc = '情緒支持';
  else if (/遺失|掉了|不見|撿到/.test(msg)) intentDesc = '失物招領';
  else if (/作業|截止|deadline|繳交/.test(msg)) intentDesc = '查詢作業';
  else if (/提醒|鬧鐘/.test(msg)) intentDesc = '設定提醒';
  else if (/列印|影印/.test(msg)) intentDesc = '列印服務';

  steps.push({ step: '分析意圖', detail: intentDesc, status: 'done' });

  // Step 2: 檢查可用資料
  const dataChecks: { key: string; label: string; available: boolean }[] = [
    { key: 'hasCourses', label: '課程資料', available: availableData.hasCourses },
    { key: 'hasAssignments', label: '作業資料', available: availableData.hasAssignments },
    { key: 'hasGrades', label: '成績資料', available: availableData.hasGrades },
    { key: 'hasAnnouncements', label: '公告資料', available: availableData.hasAnnouncements },
    { key: 'hasEvents', label: '活動資料', available: availableData.hasEvents },
    { key: 'hasMenus', label: '菜單資料', available: availableData.hasMenus },
    { key: 'hasPois', label: '地點資料', available: availableData.hasPois },
  ];

  // Only check relevant data for the intent
  const relevantData = dataChecks.filter((d) => {
    if (intentDesc.includes('餐飲')) return d.key === 'hasMenus';
    if (intentDesc.includes('學業') || intentDesc.includes('課程'))
      return ['hasCourses', 'hasAssignments', 'hasGrades'].includes(d.key);
    if (intentDesc.includes('公告')) return d.key === 'hasAnnouncements';
    if (intentDesc.includes('活動')) return d.key === 'hasEvents';
    if (intentDesc.includes('地點')) return d.key === 'hasPois';
    if (intentDesc.includes('作業')) return ['hasAssignments', 'hasCourses'].includes(d.key);
    return false;
  });

  if (relevantData.length > 0) {
    for (const d of relevantData) {
      steps.push({
        step: `查詢${d.label}`,
        detail: d.available ? '有資料可用' : '目前無資料',
        status: d.available ? 'done' : 'warning',
      });
    }
  }

  // Step 3: 檢查個人記憶
  if (memory && memory.learnedFacts.length > 0) {
    const relevantFacts = memory.learnedFacts.filter((f) => {
      if (intentDesc.includes('餐飲') && f.category === 'dietary') return true;
      if (intentDesc.includes('健康') && f.category === 'health') return true;
      if (intentDesc.includes('學業') && f.category === 'academic') return true;
      return false;
    });
    if (relevantFacts.length > 0) {
      steps.push({
        step: '調取個人記憶',
        detail: relevantFacts.map((f) => f.fact).join('；'),
        status: 'info',
      });
    }
  } else {
    steps.push({
      step: '個人記憶',
      detail: availableData.hasMemory ? '尚無學習到的偏好' : '首次對話',
      status: 'info',
    });
  }

  // Step 4: 決定回答策略
  const hasEnoughData = relevantData.length === 0 || relevantData.some((d) => d.available);
  const noRealtimeData = ['天氣', '交通', '列印'].some((k) => intentDesc.includes(k));

  if (noRealtimeData) {
    steps.push({
      step: '回答策略',
      detail: '此類資訊需要即時資料，將提供已知靜態資訊並標注',
      status: 'warning',
    });
  } else if (hasEnoughData) {
    steps.push({
      step: '回答策略',
      detail: '根據真實資料組織回答',
      status: 'done',
    });
  } else {
    steps.push({
      step: '回答策略',
      detail: '相關資料不足，如實告知並建議替代方案',
      status: 'warning',
    });
  }

  const conclusion = hasEnoughData
    ? `基於${
        relevantData
          .filter((d) => d.available)
          .map((d) => d.label)
          .join('、') || '已知資訊'
      }回答`
    : noRealtimeData
      ? '提供參考資訊（非即時）'
      : '資料不足，建議查詢';

  return { steps, conclusion, dataAvailability };
}

/**
 * 從用戶訊息中學習新事實
 */
export function extractLearnableFacts(userMessage: string, prevMessages: string[]): LearnedFact[] {
  const msg = userMessage;
  const facts: LearnedFact[] = [];
  const now = new Date().toISOString();

  // 飲食偏好
  const dietaryPatterns: [RegExp, string][] = [
    [/我吃素|我是素食/, '使用者是素食者'],
    [/我不吃([一-鿿]+)/, '使用者不吃$1'],
    [/我對([一-鿿]+)過敏/, '使用者對$1過敏'],
    [/我喜歡吃([一-鿿]+)/, '使用者喜歡吃$1'],
    [/不要(香菜|辣|蔥|蒜|薑)/, '使用者不要$1'],
  ];

  for (const [pattern, template] of dietaryPatterns) {
    const match = msg.match(pattern);
    if (match) {
      const fact = template.replace('$1', match[1] ?? '');
      facts.push({
        id: `fact-${Date.now()}-${facts.length}`,
        fact,
        source: 'explicit',
        confidence: 0.95,
        learnedAt: now,
        category: 'dietary',
      });
    }
  }

  // 個人資訊
  const personalPatterns: [RegExp, string, string][] = [
    [/我是([一-鿿]+)系/, '使用者是$1系', 'academic'],
    [/我(大[一二三四]|研[一二])/, '使用者目前$1', 'academic'],
    [/我住([一-鿿0-9]+)/, '使用者住在$1', 'personal'],
    [/我的房號[是為]?\s*([\w\d-]+)/, '使用者房號 $1', 'personal'],
  ];

  for (const [pattern, template, cat] of personalPatterns) {
    const match = msg.match(pattern);
    if (match) {
      const fact = template.replace('$1', match[1] ?? '');
      facts.push({
        id: `fact-${Date.now()}-${facts.length}`,
        fact,
        source: 'explicit',
        confidence: 0.9,
        learnedAt: now,
        category: cat as LearnedFact['category'],
      });
    }
  }

  return facts;
}

/**
 * 取得記憶的 AsyncStorage key（含 userId 隔離）
 */
export function getMemoryStorageKey(userId: string): string {
  return `@agent_memory_v2_${userId}`;
}

export function getDefaultMemory(userId: string): AgentMemory {
  const now = new Date().toISOString();
  return {
    userId,
    version: 2,
    createdAt: now,
    lastActiveAt: now,
    preferences: {
      foodPreferences: [],
      allergens: [],
      frequentLocations: [],
      communicationStyle: 'casual',
      reminderLeadTime: 15,
      quietHours: { start: '23:00', end: '07:00' },
    },
    recentActions: [],
    conversationPatterns: [],
    knownSchedule: [],
    learnedFacts: [],
    conversationSummaries: [],
  };
}

/**
 * 合併新學到的事實到記憶（去重 + 上限 100）
 */
export function mergeLearnedFacts(memory: AgentMemory, newFacts: LearnedFact[]): AgentMemory {
  const existingTexts = new Set(memory.learnedFacts.map((f) => f.fact));
  const unique = newFacts.filter((f) => !existingTexts.has(f.fact));
  const merged = [...memory.learnedFacts, ...unique].slice(-100);
  return { ...memory, learnedFacts: merged, lastActiveAt: new Date().toISOString() };
}

/**
 * 加入最近操作（上限 50）
 */
export function addRecentAction(memory: AgentMemory, action: RecentAction): AgentMemory {
  return {
    ...memory,
    recentActions: [...memory.recentActions, action].slice(-50),
    lastActiveAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════
// 主動智慧觸發 (Proactive Triggers)
// ═══════════════════════════════════════════════════

export type TriggerType =
  | 'time_based' // 時間觸發（快遲到/作業截止）
  | 'location_based' // 位置觸發（進入餐廳/圖書館）
  | 'event_based' // 事件觸發（包裹到/成績出）
  | 'pattern_based'; // 模式觸發（每天這時都叫外送）

export interface ProactiveTrigger {
  id: string;
  type: TriggerType;
  name: string;
  condition: string;
  icon: string;
  color: string;
  message: string;
  suggestedTool?: string;
  priority: 'low' | 'medium' | 'high';
}

export const PROACTIVE_TRIGGERS: ProactiveTrigger[] = [
  {
    id: 'class_soon',
    type: 'time_based',
    name: '上課提醒',
    condition: '上課前 15 分鐘',
    icon: 'school-outline',
    color: '#3B82F6',
    message: '你的「{course}」{time} 在 {location} 上課，要出發了嗎？',
    priority: 'high',
  },
  {
    id: 'assignment_due',
    type: 'time_based',
    name: '作業截止提醒',
    condition: '截止前 24 小時',
    icon: 'alert-circle-outline',
    color: '#EF4444',
    message: '「{assignment}」明天截止！目前進度如何？需要我幫你安排時間嗎？',
    suggestedTool: 'set_reminder',
    priority: 'high',
  },
  {
    id: 'package_arrived',
    type: 'event_based',
    name: '包裹到件',
    condition: '新包裹到貨',
    icon: 'cube-outline',
    color: '#EC4899',
    message: '你有一個新包裹到了！{carrier} 送達，放在 {location}。要我設定取件提醒嗎？',
    suggestedTool: 'set_reminder',
    priority: 'medium',
  },
  {
    id: 'lunch_time',
    type: 'time_based',
    name: '午餐時間',
    condition: '11:30-12:30 且未訂餐',
    icon: 'restaurant-outline',
    color: '#F59E0B',
    message: '到了午餐時間！今天想吃什麼？餐廳有開通接單時我可以幫你送出點餐。',
    suggestedTool: 'recommend_meal',
    priority: 'low',
  },
  {
    id: 'laundry_done',
    type: 'event_based',
    name: '洗衣完成',
    condition: '洗衣機完成',
    icon: 'water-outline',
    color: '#10B981',
    message: '你的洗衣已完成！記得去取衣服，避免被其他人移出。',
    priority: 'medium',
  },
  {
    id: 'mood_check',
    type: 'time_based',
    name: '每日心情',
    condition: '每天 21:00',
    icon: 'happy-outline',
    color: '#7C3AED',
    message: '今天過得如何？花 10 秒記錄一下心情吧。',
    suggestedTool: 'record_mood',
    priority: 'low',
  },
  {
    id: 'library_closing',
    type: 'time_based',
    name: '圖書館閉館',
    condition: '閉館前 30 分鐘 + 你在圖書館',
    icon: 'library-outline',
    color: '#8B5CF6',
    message: '圖書館 30 分鐘後閉館，記得收拾東西。需要我預約明天的座位嗎？',
    suggestedTool: 'reserve_seat',
    priority: 'medium',
  },
  {
    id: 'rain_alert',
    type: 'event_based',
    name: '下雨預報',
    condition: '未來 1 小時降雨機率 > 70%',
    icon: 'rainy-outline',
    color: '#6366F1',
    message: '接下來可能會下雨，記得帶傘出門！',
    priority: 'low',
  },
];

// ═══════════════════════════════════════════════════
// 角色定義
// ═══════════════════════════════════════════════════

export type AgentRole =
  | 'student' // 學生
  | 'faculty' // 教師
  | 'staff' // 職員
  | 'admin' // 管理員
  | 'vendor'; // 餐廳商家

export interface AgentRoleConfig {
  role: AgentRole;
  label: string;
  icon: string;
  color: string;
  toolCategories: AgentToolCategory[];
  proactiveCapabilities: string[];
  description: string;
}

export const AGENT_ROLE_CONFIG: AgentRoleConfig[] = [
  {
    role: 'student',
    label: '學生',
    icon: 'school-outline',
    color: '#3B82F6',
    toolCategories: [
      'cafeteria',
      'health',
      'library',
      'dorm',
      'lost_found',
      'print',
      'course',
      'transport',
      'calendar',
      'social',
    ],
    proactiveCapabilities: [
      'class_soon',
      'assignment_due',
      'package_arrived',
      'lunch_time',
      'laundry_done',
      'mood_check',
      'library_closing',
      'rain_alert',
    ],
    description: '完整校園生活代理：餐廳點餐/掛號資料/借書查詢/報修/請假/找東西都能協助',
  },
  {
    role: 'faculty',
    label: '教師',
    icon: 'person-outline',
    color: '#DC2626',
    toolCategories: ['cafeteria', 'health', 'library', 'lost_found', 'print', 'calendar', 'social'],
    proactiveCapabilities: ['lunch_time', 'rain_alert'],
    description: '教學輔助代理：排課提醒/學生請假審核/研究資源搜尋',
  },
  {
    role: 'staff',
    label: '職員',
    icon: 'briefcase-outline',
    color: '#059669',
    toolCategories: ['cafeteria', 'health', 'library', 'lost_found', 'print', 'calendar', 'social'],
    proactiveCapabilities: ['lunch_time', 'rain_alert'],
    description: '行政輔助代理：排程管理/訊息轉發/資源預約',
  },
  {
    role: 'vendor',
    label: '商家',
    icon: 'storefront-outline',
    color: '#F59E0B',
    toolCategories: ['cafeteria', 'calendar', 'social'],
    proactiveCapabilities: [],
    description: '營運輔助代理：訂單管理/庫存提醒/營業報表',
  },
  {
    role: 'admin',
    label: '管理員',
    icon: 'settings-outline',
    color: '#374151',
    toolCategories: [
      'cafeteria',
      'health',
      'library',
      'dorm',
      'lost_found',
      'print',
      'course',
      'transport',
      'calendar',
      'social',
      'system',
    ],
    proactiveCapabilities: ['assignment_due'],
    description: '系統管理代理：全功能存取/統計報表/政策設定',
  },
];

// ═══════════════════════════════════════════════════
// 角色互動
// ═══════════════════════════════════════════════════

export interface AgentRoleInteraction {
  from: AgentRole;
  to: AgentRole;
  actions: { id: string; label: string; icon: string; description: string }[];
}

export const AGENT_ROLE_INTERACTIONS: AgentRoleInteraction[] = [
  // ── 學生 ↔ 學生（同儕互動）──
  {
    from: 'student',
    to: 'student',
    actions: [
      {
        id: 'peer_review',
        label: '同儕互評',
        icon: 'people-outline',
        description: 'AI 分配作業互評、引導評分標準、彙整回饋',
      },
      {
        id: 'study_group_match',
        label: '組隊配對',
        icon: 'git-merge-outline',
        description: 'AI 根據課表/興趣/能力自動配對讀書夥伴或專題組員',
      },
      {
        id: 'share_notes',
        label: '共享筆記',
        icon: 'document-attach-outline',
        description: 'AI 整理筆記重點、分享至群組、標記精華',
      },
      {
        id: 'group_order',
        label: '揪團訂餐',
        icon: 'fast-food-outline',
        description: 'AI 統整多人點餐偏好、建立合併訂餐草稿、分攤費用',
      },
      {
        id: 'lost_found_notify',
        label: '失物互助通知',
        icon: 'search-outline',
        description: 'AI 自動比對失物/拾獲，通知相關同學',
      },
      {
        id: 'tutoring_request',
        label: '課業求助',
        icon: 'school-outline',
        description: 'AI 媒合學長姐/高手同學進行課業輔導',
      },
      {
        id: 'event_invite',
        label: '活動邀約',
        icon: 'calendar-outline',
        description: 'AI 根據共同興趣推薦活動、發送邀約',
      },
      {
        id: 'carpool_match',
        label: '共乘配對',
        icon: 'car-outline',
        description: 'AI 根據住址/時間配對共乘同學',
      },
      {
        id: 'secondhand_trade',
        label: '二手交易媒合',
        icon: 'swap-horizontal-outline',
        description: 'AI 比對二手書/用品需求，自動配對買賣',
      },
      {
        id: 'mood_support',
        label: '同儕關懷',
        icon: 'heart-outline',
        description: 'AI 偵測到同學情緒低落時，匿名提示關懷行動',
      },
    ],
  },
  // ── 學生 → 教師 ──
  {
    from: 'student',
    to: 'faculty',
    actions: [
      {
        id: 'auto_leave',
        label: 'AI 代理請假',
        icon: 'document-text-outline',
        description: 'AI 自動填寫假單、附上證明、發送給教師',
      },
      {
        id: 'question_forward',
        label: '課業問題轉發',
        icon: 'chatbubble-outline',
        description: 'AI 整理問題後以學生名義發送至教師',
      },
      {
        id: 'office_hour_book',
        label: '預約 Office Hour',
        icon: 'time-outline',
        description: 'AI 查詢教師空閒時段、代為預約、發送提醒',
      },
      {
        id: 'assignment_clarify',
        label: '作業疑問',
        icon: 'help-circle-outline',
        description: 'AI 整理學生的作業問題，結構化後發送給教師',
      },
    ],
  },
  // ── 學生 → 行政 ──
  {
    from: 'student',
    to: 'staff',
    actions: [
      {
        id: 'auto_repair',
        label: 'AI 代理報修',
        icon: 'construct-outline',
        description: 'AI 收集問題描述/照片後自動提交維修單',
      },
      {
        id: 'auto_booking',
        label: 'AI 代理預約',
        icon: 'calendar-outline',
        description: 'AI 預約座位/設備/場地',
      },
      {
        id: 'document_request',
        label: '文件申請',
        icon: 'document-outline',
        description: 'AI 代為申請在學證明/成績單/各類文件',
      },
      {
        id: 'scholarship_apply',
        label: '獎學金申請',
        icon: 'trophy-outline',
        description: 'AI 比對資格、準備文件、代為送件',
      },
    ],
  },
  // ── 學生 → 商家 ──
  {
    from: 'student',
    to: 'vendor',
    actions: [
      {
        id: 'auto_order',
        label: 'AI 代理訂餐',
        icon: 'restaurant-outline',
        description: 'AI 根據偏好選餐、確認後送到餐廳點餐功能、通知取餐',
      },
      {
        id: 'feedback_submit',
        label: '餐點回饋',
        icon: 'star-outline',
        description: 'AI 代為提交用餐評價',
      },
    ],
  },
  // ── 教師 → 學生 ──
  {
    from: 'faculty',
    to: 'student',
    actions: [
      {
        id: 'batch_notify',
        label: '批次通知學生',
        icon: 'megaphone-outline',
        description: 'AI 代為發送課程公告至全班',
      },
      {
        id: 'grade_release',
        label: '成績發布通知',
        icon: 'school-outline',
        description: 'AI 整理成績後分別通知每位學生',
      },
      {
        id: 'assignment_publish',
        label: '發布作業',
        icon: 'create-outline',
        description: 'AI 格式化作業要求、設定截止日、通知全班',
      },
      {
        id: 'attendance_alert',
        label: '出席警示',
        icon: 'alert-outline',
        description: 'AI 偵測缺曠達標時自動提醒學生和導師',
      },
      {
        id: 'peer_review_assign',
        label: '分配互評',
        icon: 'git-network-outline',
        description: 'AI 公平分配互評配對，確保每人評/被評次數均等',
      },
      {
        id: 'learning_insight',
        label: '學習分析回饋',
        icon: 'analytics-outline',
        description: 'AI 分析全班學習數據，個別化回饋建議',
      },
    ],
  },
  // ── 教師 ↔ 教師 ──
  {
    from: 'faculty',
    to: 'faculty',
    actions: [
      {
        id: 'co_teach_sync',
        label: '協同教學同步',
        icon: 'sync-outline',
        description: 'AI 同步共授課程進度、分配教學範圍',
      },
      {
        id: 'resource_share',
        label: '教材共享',
        icon: 'folder-open-outline',
        description: 'AI 推薦相關教材、協助跨系課程合作',
      },
    ],
  },
  // ── 商家 → 學生 ──
  {
    from: 'vendor',
    to: 'student',
    actions: [
      {
        id: 'order_ready',
        label: '餐點備妥通知',
        icon: 'checkmark-circle-outline',
        description: 'AI 推播取餐通知至學生',
      },
      {
        id: 'promo_push',
        label: '優惠推送',
        icon: 'pricetag-outline',
        description: 'AI 依據學生偏好精準推送優惠',
      },
      {
        id: 'menu_update',
        label: '菜單更新通知',
        icon: 'newspaper-outline',
        description: 'AI 推播新菜色給偏好匹配的學生',
      },
    ],
  },
  // ── 行政 → 學生 ──
  {
    from: 'staff',
    to: 'student',
    actions: [
      {
        id: 'repair_done',
        label: '維修完成通知',
        icon: 'checkmark-done-outline',
        description: 'AI 通知報修學生維修已完成',
      },
      {
        id: 'document_ready',
        label: '文件備妥通知',
        icon: 'document-outline',
        description: 'AI 通知學生申請文件已可領取',
      },
    ],
  },
  // ── 管理員 → 所有人 ──
  {
    from: 'admin',
    to: 'student',
    actions: [
      {
        id: 'system_alert',
        label: '系統公告',
        icon: 'notifications-outline',
        description: 'AI 推播全校/特定群體通知',
      },
      {
        id: 'survey_collect',
        label: '問卷收集',
        icon: 'clipboard-outline',
        description: 'AI 對話式收集問卷回答',
      },
      {
        id: 'emergency_broadcast',
        label: '緊急廣播',
        icon: 'warning-outline',
        description: '颱風停課/緊急事件即時推播所有使用者',
      },
    ],
  },
  {
    from: 'admin',
    to: 'faculty',
    actions: [
      {
        id: 'policy_update',
        label: '政策通知',
        icon: 'briefcase-outline',
        description: 'AI 推播教務/行政政策更新給教師',
      },
      {
        id: 'schedule_change',
        label: '排課異動',
        icon: 'swap-vertical-outline',
        description: 'AI 通知教師課程調動並協調替代方案',
      },
    ],
  },
];

// ═══════════════════════════════════════════════════
// 對話狀態機
// ═══════════════════════════════════════════════════

export type ConversationState =
  | 'idle' // 等待輸入
  | 'understanding' // 理解意圖
  | 'collecting_params' // 收集參數
  | 'confirming' // 確認執行
  | 'executing' // 執行中
  | 'waiting_chain_confirm' // 任務鏈步驟等待用戶確認
  | 'reporting' // 回報結果
  | 'follow_up'; // 後續追蹤

export interface ConversationContext {
  state: ConversationState;
  currentTool?: string;
  currentChain?: string;
  currentChainStep?: number;
  collectedParams: Record<string, any>;
  pendingConfirmation?: string;
  history: { role: 'user' | 'agent'; content: string }[];
}

export function getInitialContext(): ConversationContext {
  return {
    state: 'idle',
    collectedParams: {},
    history: [],
  };
}

// ═══════════════════════════════════════════════════
// 模擬資料
// ═══════════════════════════════════════════════════

export function simulateAgentGreeting(userName: string, role: AgentRole): string {
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? '早安' : hour < 18 ? '午安' : '晚安';
  const roleConfig = AGENT_ROLE_CONFIG.find((r) => r.role === role);

  const greetings = [
    `${timeGreeting} ${userName}！我是你的校園全能 AI 助理。`,
    `我可以幫你**直接執行**操作，不只是回答問題。`,
    `例如：「幫我訂午餐」「我想請假」「幫我報修冷氣」`,
    `\n試試直接告訴我你需要什麼吧！`,
  ];
  return greetings.join('\n');
}

export function simulateRecentExecutions(): ToolExecution[] {
  return [
    {
      id: 'exec-1',
      toolId: 'order_meal',
      status: 'success',
      params: { cafeteria: 'jingyuan', items: 'Morning House｜蛋餅' },
      result: '餐廳點餐系統已收到：Morning House｜蛋餅，靜園餐廳，狀態待店家確認',
      startedAt: '2026-04-27T11:50:00',
      completedAt: '2026-04-27T11:50:05',
    },
    {
      id: 'exec-2',
      toolId: 'reserve_seat',
      status: 'success',
      params: { type: 'individual', floor: '3F', time_slot: 'afternoon' },
      result: '已預約圖書館 3F 座位 A-23，下午時段',
      startedAt: '2026-04-27T09:30:00',
      completedAt: '2026-04-27T09:30:03',
    },
    {
      id: 'exec-3',
      toolId: 'set_reminder',
      status: 'success',
      params: { title: '程式設計作業截止', datetime: '明天 23:59' },
      result: '已設定提醒：明天 23:59 前提醒你程式設計作業截止',
      startedAt: '2026-04-26T20:00:00',
      completedAt: '2026-04-26T20:00:02',
    },
  ];
}

export function simulateProactiveMessages(): { trigger: ProactiveTrigger; message: string }[] {
  const hour = new Date().getHours();
  const messages: { trigger: ProactiveTrigger; message: string }[] = [];

  if (hour >= 11 && hour <= 13) {
    const trigger = PROACTIVE_TRIGGERS.find((t) => t.id === 'lunch_time')!;
    messages.push({
      trigger,
      message: '到了午餐時間！今天想吃什麼？餐廳有開通接單時我可以幫你送出點餐。',
    });
  }
  if (hour >= 20 && hour <= 22) {
    const trigger = PROACTIVE_TRIGGERS.find((t) => t.id === 'mood_check')!;
    messages.push({ trigger, message: '今天過得如何？花 10 秒記錄一下心情吧 😊' });
  }

  // 固定顯示作業提醒
  const assignTrigger = PROACTIVE_TRIGGERS.find((t) => t.id === 'assignment_due')!;
  messages.push({
    trigger: assignTrigger,
    message: '「程式設計 HW5」明天 23:59 截止！需要我幫你安排時間完成嗎？',
  });

  return messages.slice(0, 2);
}

export function getAgentCapabilitySummary(role: AgentRole): string[] {
  const config = AGENT_ROLE_CONFIG.find((r) => r.role === role);
  if (!config) return [];

  const tools = AGENT_TOOLS.filter((t) => t.roleAccess.includes(role));
  const categories = Array.from(new Set(tools.map((t) => t.category)));

  const categoryLabels: Record<AgentToolCategory, string> = {
    cafeteria: '🍽️ 訂餐/推薦餐點/查等候',
    health: '🏥 掛號/症狀評估/記錄心情',
    library: '📚 預約座位/借書/查詢',
    dorm: '🏠 報修/查洗衣機/查包裹',
    lost_found: '🔍 報失/搜尋拾獲物',
    print: '🖨️ 雲端列印/查餘額',
    course: '📖 請假/查成績/查作業',
    transport: '🚌 查公車/交通資訊',
    calendar: '⏰ 設提醒/排行程',
    social: '💬 發訊息/通知群組',
    system: '⚙️ 系統設定',
  };

  return categories.map((c) => categoryLabels[c]);
}

// ═══════════════════════════════════════════════════
// 主動學習引擎 (Active Learning Engine)
// ═══════════════════════════════════════════════════
// AI 會從每次對話中學習，建立個人知識圖譜，
// 並利用 APP 內所有資料來持續改善回答品質。

export interface KnowledgeNode {
  id: string;
  type: 'course' | 'assignment' | 'event' | 'poi' | 'menu' | 'preference' | 'pattern';
  label: string;
  data: Record<string, any>;
  connections: string[]; // IDs of related nodes
  lastUpdated: string;
  accessCount: number;
}

export interface LearningInsight {
  id: string;
  insight: string;
  source: 'conversation' | 'data_analysis' | 'pattern_detection';
  confidence: number;
  createdAt: string;
  usedCount: number;
}

export interface ActiveLearningState {
  knowledgeGraph: KnowledgeNode[];
  insights: LearningInsight[];
  interactionPatterns: InteractionPattern[];
  correctionLog: CorrectionEntry[];
  dataFreshness: Record<string, string>; // dataType -> last indexed timestamp
}

export interface InteractionPattern {
  id: string;
  pattern: string; // e.g., "user asks about meals at lunch time"
  frequency: number;
  lastSeen: string;
  suggestedResponse?: string;
}

export interface CorrectionEntry {
  id: string;
  originalQuery: string;
  wrongResponse: string;
  correctedBehavior: string;
  timestamp: string;
}

export function getDefaultLearningState(): ActiveLearningState {
  return {
    knowledgeGraph: [],
    insights: [],
    interactionPatterns: [],
    correctionLog: [],
    dataFreshness: {},
  };
}

/**
 * 從 APP 內所有資料建立知識圖譜
 * 每次有新資料進來時重新索引，讓 AI 能夠跨資料源推理
 */
export function buildKnowledgeGraph(data: {
  courses: Array<{
    id: string;
    name: string;
    teacher: string;
    dayOfWeek: number;
    credits: number;
    startPeriod?: number;
  }>;
  assignments: Array<{
    id: string;
    title: string;
    groupName: string;
    dueAt?: string;
    isLate: boolean;
  }>;
  announcements: Array<{ id: string; title: string; source?: string }>;
  events: Array<{ id: string; title: string; location?: string; startsAt?: any }>;
  menus: Array<{ id: string; name: string; price?: number; cafeteria?: string }>;
  pois: Array<{ id: string; name: string; category: string }>;
  memory: AgentMemory;
}): KnowledgeNode[] {
  const nodes: KnowledgeNode[] = [];
  const now = new Date().toISOString();

  // Index courses
  data.courses.forEach((c) => {
    nodes.push({
      id: `course_${c.id}`,
      type: 'course',
      label: c.name,
      data: {
        teacher: c.teacher,
        dayOfWeek: c.dayOfWeek,
        credits: c.credits,
        startPeriod: c.startPeriod,
      },
      connections: data.assignments
        .filter((a) => a.groupName.includes(c.name))
        .map((a) => `assignment_${a.id}`),
      lastUpdated: now,
      accessCount: 0,
    });
  });

  // Index assignments → link to courses
  data.assignments.forEach((a) => {
    const relatedCourse = data.courses.find((c) => a.groupName.includes(c.name));
    nodes.push({
      id: `assignment_${a.id}`,
      type: 'assignment',
      label: a.title,
      data: { groupName: a.groupName, dueAt: a.dueAt, isLate: a.isLate },
      connections: relatedCourse ? [`course_${relatedCourse.id}`] : [],
      lastUpdated: now,
      accessCount: 0,
    });
  });

  // Index menus
  data.menus.forEach((m) => {
    nodes.push({
      id: `menu_${m.id}`,
      type: 'menu',
      label: m.name,
      data: { price: m.price, cafeteria: m.cafeteria },
      connections: [],
      lastUpdated: now,
      accessCount: 0,
    });
  });

  // Index learned preferences from memory → link to menus/courses
  data.memory.learnedFacts.forEach((f) => {
    const prefNode: KnowledgeNode = {
      id: `pref_${f.id}`,
      type: 'preference',
      label: f.fact,
      data: { category: f.category, confidence: f.confidence, source: f.source },
      connections: [],
      lastUpdated: f.learnedAt,
      accessCount: 0,
    };
    // Link dietary prefs to relevant menus
    if (f.category === 'dietary') {
      const relatedMenus = data.menus.filter((m) => {
        const factLower = f.fact.toLowerCase();
        const menuName = (m.name ?? '').toLowerCase();
        return factLower
          .split(/[\s,，、]/)
          .some((word) => word.length >= 2 && menuName.includes(word));
      });
      prefNode.connections = relatedMenus.map((m) => `menu_${m.id}`);
    }
    // Link academic prefs to courses
    if (f.category === 'academic') {
      const relatedCourses = data.courses.filter((c) => f.fact.includes(c.name));
      prefNode.connections = relatedCourses.map((c) => `course_${c.id}`);
    }
    nodes.push(prefNode);
  });

  return nodes;
}

/**
 * 從用戶互動模式中產生洞察
 * 例如：用戶每天中午都問午餐 → 自動在11:30推薦
 */
export function detectInteractionPatterns(memory: AgentMemory): InteractionPattern[] {
  const patterns: InteractionPattern[] = [];
  const actions = memory.recentActions;
  if (actions.length < 3) return patterns;

  // Count tool usage frequency
  const toolFreq: Record<string, number> = {};
  actions.forEach((a) => {
    toolFreq[a.toolId] = (toolFreq[a.toolId] || 0) + 1;
  });

  // Detect frequent tool usage
  for (const [toolId, count] of Object.entries(toolFreq)) {
    if (count >= 3) {
      patterns.push({
        id: `pattern_${toolId}`,
        pattern: `用戶經常使用 ${toolId}`,
        frequency: count,
        lastSeen: actions[actions.length - 1].timestamp,
      });
    }
  }

  // Detect time-based patterns
  const messagesByHour: Record<number, number> = {};
  actions.forEach((a) => {
    const hour = new Date(a.timestamp).getHours();
    messagesByHour[hour] = (messagesByHour[hour] || 0) + 1;
  });

  for (const [hour, count] of Object.entries(messagesByHour)) {
    if (count >= 3) {
      patterns.push({
        id: `time_${hour}`,
        pattern: `用戶經常在 ${hour} 點使用 APP`,
        frequency: count,
        lastSeen: new Date().toISOString(),
      });
    }
  }

  return patterns;
}

/**
 * 記錄 AI 的錯誤回答，供後續改進
 * 當用戶表達不滿或糾正時調用
 */
export function recordCorrection(
  state: ActiveLearningState,
  query: string,
  wrongResponse: string,
  correction: string,
): ActiveLearningState {
  return {
    ...state,
    correctionLog: [
      ...state.correctionLog,
      {
        id: `corr_${Date.now()}`,
        originalQuery: query,
        wrongResponse: wrongResponse,
        correctedBehavior: correction,
        timestamp: new Date().toISOString(),
      },
    ].slice(-100), // keep last 100 corrections
  };
}

/**
 * 利用知識圖譜進行跨資料源推理
 * 例如：「我今天下午有空嗎？」→ 查課表 + 作業截止 + 活動 = 綜合判斷
 */
export function queryKnowledgeGraph(
  graph: KnowledgeNode[],
  query: string,
): { relevantNodes: KnowledgeNode[]; reasoning: string } {
  const q = query.toLowerCase();
  const scored: Array<{ node: KnowledgeNode; score: number }> = [];

  for (const node of graph) {
    let score = 0;
    // Label match
    if (q.includes(node.label.toLowerCase())) score += 3;
    // Data field match
    for (const val of Object.values(node.data)) {
      if (typeof val === 'string' && q.includes(val.toLowerCase())) score += 1;
    }
    // Type relevance
    if (node.type === 'course' && /課|學|修|教|老師/.test(q)) score += 2;
    if (node.type === 'assignment' && /作業|繳交|截止|deadline/.test(q)) score += 2;
    if (node.type === 'menu' && /吃|餐|飯|菜|食/.test(q)) score += 2;
    if (node.type === 'preference') score += 1; // preferences always somewhat relevant

    if (score > 0) scored.push({ node, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 10);

  // Build reasoning
  const typeCount: Record<string, number> = {};
  top.forEach(({ node }) => {
    typeCount[node.type] = (typeCount[node.type] || 0) + 1;
  });
  const reasoning = Object.entries(typeCount)
    .map(
      ([type, count]) =>
        `找到 ${count} 個相關${type === 'course' ? '課程' : type === 'assignment' ? '作業' : type === 'menu' ? '餐點' : type === 'preference' ? '偏好' : '項目'}`,
    )
    .join('，');

  return {
    relevantNodes: top.map((t) => t.node),
    reasoning: reasoning || '未找到直接相關的資料',
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 本地深度學習 AI 引擎 (Local Deep-Learning AI Engine)
// ═══════════════════════════════════════════════════════════════════════
// 一套完全在裝置端運行的智慧系統，不依賴外部 API。
// 核心能力：
//   1. TF-IDF 向量化語意引擎 — 中文字元 n-gram 向量比對
//   2. 回答模板學習器 — 從 Gemini 好回答中萃取回答結構模板
//   3. 本地答案組合器 — 知識圖譜 + 模板 + 即時資料 → 生成回答
//   4. 信心分數機制 — 本地信心高就不呼叫 API
//   5. 漸進式學習 — 每次對話都在訓練，API 依賴隨時間降低

// ──────────────── 資料結構 ────────────────

export interface QAPair {
  id: string;
  question: string;
  answer: string;
  timestamp: string;
  quality: number; // 1~5
  followedUp: boolean;
  tags: string[];
  source: 'gemini' | 'local';
  /** 從回答中萃取的模板結構 */
  templateId?: string;
}

/** 回答模板：從好回答中學到的「回答骨架」，可用即時資料填充 */
export interface ResponseTemplate {
  id: string;
  /** 適用的意圖標籤 */
  tags: string[];
  /** 模板骨架 — 用 {{slot}} 標記資料插槽 */
  skeleton: string;
  /** 插槽名稱 → 資料類型映射 */
  slots: Record<
    string,
    'courses' | 'assignments' | 'menus' | 'events' | 'announcements' | 'pois' | 'memory' | 'text'
  >;
  /** 被成功使用次數 */
  useCount: number;
  /** 平均品質 */
  avgQuality: number;
  learnedFrom: string; // 來源 QA pair id
  createdAt: string;
}

/** TF-IDF 詞頻向量（稀疏表示） */
export interface TfIdfVector {
  terms: Record<string, number>;
  norm: number;
}

/** 使用者／對話累積的程序性「技能」（如何做），與 learnedFacts 的事實記憶分流 */
export interface LearnedSkill {
  id: string;
  title: string;
  procedure: string;
  /** 用來與使用者問題做匹配的關鍵片段（自動衍生 + 可手動補） */
  triggers: string[];
  source: 'user_explicit' | 'distilled' | 'reflection';
  learnedAt: string;
  lastUsedAt?: string;
  useCount: number;
}

const MAX_LEARNED_SKILLS = 40;

/** 本地 AI 大腦 — 完整的訓練資料庫 */
export interface LocalTrainingDB {
  pairs: QAPair[];
  templates: ResponseTemplate[];
  /** 全域 IDF 表（從所有問題計算） */
  idfTable: Record<string, number>;
  /** 已知錯誤模式 */
  antiPatterns: Array<{ pattern: string; correction: string }>;
  /** 高品質範例（注入 system prompt 的精華） */
  goodExamples: Array<{ q: string; a: string; tags: string[] }>;
  /** 自主學習的技能備忘（程序步驟），依使用者當前問題挑相關項注入 */
  learnedSkills: LearnedSkill[];
  stats: {
    totalInteractions: number;
    localAnswers: number; // 本地引擎成功回答次數
    apiCalls: number; // API 呼叫次數
    avgQuality: number;
    lastTrainedAt: string;
  };
}

export function getDefaultTrainingDB(): LocalTrainingDB {
  const profileSeeds = getAssistantProfileTrainingSeeds();
  return {
    pairs: profileSeeds.pairs,
    templates: [],
    idfTable: {},
    antiPatterns: profileSeeds.antiPatterns,
    goodExamples: profileSeeds.goodExamples,
    learnedSkills: [],
    stats: {
      totalInteractions: 0,
      localAnswers: 0,
      apiCalls: 0,
      avgQuality: 5,
      lastTrainedAt: new Date().toISOString(),
    },
  };
}

export function normalizeLocalTrainingDB(input?: Partial<LocalTrainingDB> | null): LocalTrainingDB {
  const fallback = getDefaultTrainingDB();
  const stats = input?.stats ?? fallback.stats;

  return {
    pairs: Array.isArray(input?.pairs) ? input!.pairs : fallback.pairs,
    templates: Array.isArray(input?.templates) ? input!.templates : fallback.templates,
    idfTable:
      input?.idfTable && typeof input.idfTable === 'object' ? input.idfTable : fallback.idfTable,
    antiPatterns: Array.isArray(input?.antiPatterns) ? input!.antiPatterns : fallback.antiPatterns,
    goodExamples: Array.isArray(input?.goodExamples) ? input!.goodExamples : fallback.goodExamples,
    learnedSkills: Array.isArray(input?.learnedSkills)
      ? (input!.learnedSkills as LearnedSkill[])
          .filter((s) => s && typeof (s as LearnedSkill).title === 'string')
          .slice(0, MAX_LEARNED_SKILLS)
      : fallback.learnedSkills,
    stats: {
      totalInteractions:
        typeof stats.totalInteractions === 'number'
          ? stats.totalInteractions
          : fallback.stats.totalInteractions,
      localAnswers:
        typeof stats.localAnswers === 'number' ? stats.localAnswers : fallback.stats.localAnswers,
      apiCalls: typeof stats.apiCalls === 'number' ? stats.apiCalls : fallback.stats.apiCalls,
      avgQuality:
        typeof stats.avgQuality === 'number' ? stats.avgQuality : fallback.stats.avgQuality,
      lastTrainedAt:
        typeof stats.lastTrainedAt === 'string'
          ? stats.lastTrainedAt
          : fallback.stats.lastTrainedAt,
    },
  };
}

function normalizeSkillMatchText(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\s\d，。！？、；：「」『』《》【】\n\r\t]/g, '');
}

function deriveTriggersFromTitleProcedure(title: string, procedure: string): string[] {
  const raw = `${title} ${procedure.slice(0, 400)}`;
  const chunks = raw
    .split(/[,，。.!?？；;\n]/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2 && x.length <= 40);
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const c of [title, ...chunks]) {
    const k = c.slice(0, 24);
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(k);
    }
    if (uniq.length >= 12) break;
  }
  return uniq;
}

function scoreSkillRelevance(query: string, skill: LearnedSkill): number {
  const q = normalizeSkillMatchText(query);
  if (q.length < 2) return 0;
  const hay = normalizeSkillMatchText(
    [skill.title, ...skill.triggers, skill.procedure.slice(0, 320)].join(''),
  );
  let score = 0;
  for (let i = 0; i < q.length - 1; i++) {
    const bi = q.slice(i, i + 2);
    if (hay.includes(bi)) score += 2;
  }
  for (const tr of skill.triggers) {
    const nt = normalizeSkillMatchText(tr);
    if (nt.length >= 2 && q.includes(nt)) score += 12;
  }
  const ntit = normalizeSkillMatchText(skill.title);
  if (ntit.length >= 2 && q.includes(ntit)) score += 15;
  return score;
}

/** 依使用者當句挑選最相關的自訂技能（供注入 prompt） */
export function selectRelevantLearnedSkills(
  query: string,
  skills: LearnedSkill[],
  max = 5,
): LearnedSkill[] {
  const ranked = [...skills]
    .map((s) => ({ s, sc: scoreSkillRelevance(query, s) }))
    .filter((x) => x.sc > 0)
    .sort((a, b) => b.sc - a.sc);
  return ranked.slice(0, max).map((x) => x.s);
}

export function formatLearnedSkillsBlock(skills: LearnedSkill[]): string {
  const lines: string[] = ['【使用者與助理累積的自訂技能（遇到類似問題請優先沿用作法）】'];
  skills.forEach((sk, i) => {
    const src =
      sk.source === 'distilled'
        ? '成功任務蒸餾'
        : sk.source === 'reflection'
          ? '反思補強'
          : '使用者明示';
    lines.push(`${i + 1}. ${sk.title}（來源：${src}）`);
    if (sk.triggers?.length) {
      lines.push(`   關鍵詞：${sk.triggers.slice(0, 6).join('、')}`);
    }
    const proc = sk.procedure.trim().split('\n').slice(0, 12).join('\n');
    lines.push(`   作法：${proc}`);
  });
  lines.push(
    '（以上來自使用者明示教學或對話蒸餾；若與 App 即時資料衝突，以資料與工具結果為準。）',
  );
  return lines.join('\n');
}

export function mergeLearnedSkill(db: LocalTrainingDB, skill: LearnedSkill): LocalTrainingDB {
  db = normalizeLocalTrainingDB(db);
  const key = skill.title.trim().toLowerCase();
  const idx = db.learnedSkills.findIndex((s) => s.title.trim().toLowerCase() === key);
  let nextSkills: LearnedSkill[];
  if (idx >= 0) {
    const prev = db.learnedSkills[idx];
    const merged: LearnedSkill = {
      ...prev,
      procedure: `${prev.procedure}\n---\n${skill.procedure}`.trim().slice(0, 4000),
      triggers: Array.from(new Set([...prev.triggers, ...skill.triggers])).slice(0, 16),
      useCount: prev.useCount + 1,
      lastUsedAt: new Date().toISOString(),
    };
    nextSkills = [...db.learnedSkills];
    nextSkills[idx] = merged;
  } else {
    nextSkills = [...db.learnedSkills, { ...skill, useCount: skill.useCount || 1 }].slice(
      -MAX_LEARNED_SKILLS,
    );
  }
  return { ...db, learnedSkills: nextSkills };
}

/** 從使用者一句話抽出「程序技能」（請記住／以後若…） */
export function extractLearnedSkillFromUserMessage(text: string): LearnedSkill | null {
  const t = text.trim();
  if (t.length < 6 || t.length > 5000) return null;

  const head = /^(請記住|記住|技能[:：]|助理請記|備忘[:：]|我教妳|我教你)\s*/;
  if (head.test(t)) {
    const body = t.replace(head, '').replace(/^[:：]\s*/, '').trim();
    const lines = body.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const title = (lines[0] ?? '自訂作法').slice(0, 120);
    const procedure = lines.length > 1 ? lines.slice(1).join('\n') : body;
    if (!procedure || procedure.length < 4) return null;
    const triggers = deriveTriggersFromTitleProcedure(title, procedure);
    return {
      id: `ls-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      title,
      procedure: procedure.slice(0, 4000),
      triggers,
      source: 'user_explicit',
      learnedAt: new Date().toISOString(),
      useCount: 0,
    };
  }

  const fut = /^以後(?:若|如果|當)(.+?)[，,。.]\s*(.+)$/s.exec(t);
  if (fut?.[1] && fut?.[2]) {
    const title = `當${fut[1].trim().slice(0, 80)}`;
    const procedure = fut[2].trim();
    const triggers = deriveTriggersFromTitleProcedure(title, procedure);
    return {
      id: `ls-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      title,
      procedure: procedure.slice(0, 4000),
      triggers,
      source: 'user_explicit',
      learnedAt: new Date().toISOString(),
      useCount: 0,
    };
  }

  return null;
}

/** 避免把「工具選擇器」內部 prompt 當成使用者原句蒸餾進技能庫 */
export function isInternalToolSelectionPrompt(text: string): boolean {
  const t = String(text ?? '');
  return (
    t.includes('工具選擇器') ||
    t.includes('## 可用工具') ||
    (t.includes('你是校園 AI 助理') && t.includes('[TOOL:'))
  );
}

const TOOL_SUCCESS_SKILL_LABELS: Record<string, string> = {
  create_order: '校園訂餐／代下單',
  cancel_order: '取消訂單',
  send_message: '發送站內訊息',
  create_calendar_event: '建立行事曆事件',
  register_event: '活動報名',
  unregister_event: '取消活動報名',
  reserve_library_seat: '預約圖書館座位',
  cancel_seat_reservation: '取消座位預約',
  borrow_book: '圖書借閱',
  renew_book: '圖書續借',
  return_book: '圖書歸還',
  mark_notifications_read: '標示通知已讀',
  create_repair_request: '宿舍／設施報修',
  start_attendance: '課堂點名（教師）',
  create_assignment: '建立作業（教師）',
  grade_submission: '批改作業（教師）',
  submit_assignment: '繳交作業',
  enroll_course: '選課',
  drop_course: '退選',
  request_leave: '請假申請',
  check_in_attendance: '課堂簽到',
  create_health_appointment: '預約健檢／掛號',
  create_print_job: '提交列印',
  rate_menu_item: '餐點評分',
  reserve_washing_machine: '預約洗衣',
  confirm_package_pickup: '確認取件',
  delete_calendar_event: '刪除行事曆事件',
  update_calendar_event: '更新行事曆事件',
};

function sanitizeArgsForSkillLearning(args: Record<string, string>): string {
  const skipKey = /password|token|secret|credential|apikey|ssid|auth|jwt/i;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (skipKey.test(k)) continue;
    const sv = redactSensitiveUserTextForAI(String(v ?? '').trim()).slice(0, 160);
    if (sv) parts.push(`${k}=${sv}`);
  }
  return parts.slice(0, 10).join('；');
}

export function redactSensitiveUserTextForAI(text: string): string {
  return String(text ?? '')
    .replace(/\b[A-Z][12]\d{8}\b/g, '[身分證已遮蔽]')
    .replace(/\b09\d{2}[-\s]?\d{3}[-\s]?\d{3}\b/g, '[電話已遮蔽]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[卡號已遮蔽]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[Email 已遮蔽]')
    .replace(/((?:密碼|password|passcode|驗證碼|otp)\s*[：:=]?\s*)[^\s，。；;]{2,}/gi, '$1[已遮蔽]');
}

/**
 * 寫入工具成功後蒸餾成可重用技能（供之後類似問題注入 prompt；非新增程式能力，是記住「上次怎麼做成」）。
 */
export function distillLearnedSkillFromToolSuccess(
  userMessage: string,
  toolName: string,
  args: Record<string, string>,
  summary: string,
): LearnedSkill | null {
  const raw = userMessage.trim();
  if (raw.length < 2 || raw.length > 4000) return null;
  if (isInternalToolSelectionPrompt(raw)) return null;

  const label =
    TOOL_SUCCESS_SKILL_LABELS[toolName] ?? `完成任務（工具：${toolName}）`;
  const argLine = sanitizeArgsForSkillLearning(args);
  const safeRaw = redactSensitiveUserTextForAI(raw);
  const userSnippet = safeRaw.length > 200 ? `${safeRaw.slice(0, 200)}…` : safeRaw;
  const procedure = [
    `使用者意圖（原句摘要）：「${userSnippet}」`,
    `成功路徑：呼叫工具 ${toolName}。`,
    argLine ? `參數要點：${argLine}` : '',
    `結果摘要：${String(summary).trim().slice(0, 500)}`,
    '下次遇到類似說法，優先嘗試同一工具並補齊必要參數；若 App 資料不足再向使用者澄清。',
  ]
    .filter(Boolean)
    .join('\n');

  const triggers = deriveTriggersFromTitleProcedure(label, `${raw} ${toolName} ${argLine}`);
  return {
    id: `ls-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    title: label,
    procedure: procedure.slice(0, 4000),
    triggers,
    source: 'distilled',
    learnedAt: new Date().toISOString(),
    useCount: 0,
  };
}

/** 從一輪工具結果收集蒸餾技能（同一標題只保留一筆） */
export function collectLearnedSkillsFromToolRound(
  entries: Array<{ result: { learnedSkill?: LearnedSkill } }>,
): LearnedSkill[] {
  const out: LearnedSkill[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const s = e.result.learnedSkill;
    if (!s) continue;
    const k = s.title.trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

// ──────────────── 中文 NLP 工具 ────────────────

const STOP_WORDS = new Set([
  '的',
  '了',
  '在',
  '是',
  '我',
  '有',
  '和',
  '就',
  '不',
  '人',
  '都',
  '一',
  '一個',
  '上',
  '也',
  '很',
  '到',
  '說',
  '要',
  '去',
  '你',
  '會',
  '著',
  '沒有',
  '看',
  '好',
  '自己',
  '這',
  '他',
  '她',
  '嗎',
  '呢',
  '吧',
  '啊',
  '喔',
  '欸',
  '那',
  '什麼',
  '怎麼',
  '可以',
  '請問',
  '請',
  '幫',
  '幫我',
  '想',
  '想要',
  '能',
  '能不能',
]);

/** 中文斷詞 — 基於字典 + bigram + 規則 */
function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[？?！!。，、：；\s""''「」（）\(\)\[\]]/g, ' ')
    .trim();
  const tokens: string[] = [];

  // 先提取已知領域詞彙（長詞優先）
  const domainTerms = [
    '被當',
    '當掉',
    '不及格',
    '二一',
    '退學',
    '學分',
    '必修',
    '選修',
    '通識',
    '作業',
    '報告',
    '期中考',
    '期末考',
    '小考',
    '點名',
    '圖書館',
    '借書',
    '還書',
    '座位',
    '自習室',
    '宿舍',
    '寢室',
    '報修',
    '洗衣',
    '包裹',
    '門禁',
    '餐廳',
    '食堂',
    '午餐',
    '晚餐',
    '早餐',
    '素食',
    '便當',
    '公車',
    '校車',
    '停車場',
    '腳踏車',
    '列印',
    '影印',
    '印表機',
    '獎學金',
    '社團',
    '畢業',
    '實習',
    '成績',
    '排名',
    '公告',
    '活動',
    '講座',
    '報名',
    '比賽',
    '天氣',
    '下雨',
    '颱風',
    '地震',
    '健康',
    '頭痛',
    '感冒',
    '診所',
    '保健室',
    '導航',
    '地圖',
    '位置',
    '怎麼走',
    '課表',
    '選課',
    '加簽',
    '退選',
    '請假',
    '缺曠',
    '翹課',
  ];
  let remaining = normalized;
  for (const term of domainTerms) {
    if (remaining.includes(term)) {
      tokens.push(term);
      remaining = remaining.replace(new RegExp(term, 'g'), ' ');
    }
  }

  // 再做 bigram / unigram 分詞
  const chars = remaining.replace(/\s+/g, '').split('');
  for (let i = 0; i < chars.length; i++) {
    if (i < chars.length - 1) {
      const bigram = chars[i] + chars[i + 1];
      if (!STOP_WORDS.has(bigram) && bigram.trim().length === 2) {
        tokens.push(bigram);
      }
    }
    if (!STOP_WORDS.has(chars[i]) && chars[i].trim().length > 0) {
      tokens.push(chars[i]);
    }
  }

  return tokens.filter((t) => t.length > 0);
}

/** 計算 TF 向量 */
function computeTF(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {};
  const len = tokens.length || 1;
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  // Normalize by document length
  for (const t of Object.keys(tf)) {
    tf[t] = tf[t] / len;
  }
  return tf;
}

/** 從所有 QA pairs 重建 IDF 表 */
function rebuildIDF(pairs: QAPair[]): Record<string, number> {
  const docCount = pairs.length || 1;
  const df: Record<string, number> = {};

  for (const pair of pairs) {
    const seen = new Set<string>();
    const tokens = tokenize(pair.question);
    for (const t of tokens) {
      if (!seen.has(t)) {
        df[t] = (df[t] || 0) + 1;
        seen.add(t);
      }
    }
  }

  const idf: Record<string, number> = {};
  for (const [term, count] of Object.entries(df)) {
    idf[term] = Math.log((docCount + 1) / (count + 1)) + 1; // smoothed IDF
  }
  return idf;
}

/** 計算 TF-IDF 向量 */
function toTfIdfVector(tokens: string[], idf: Record<string, number>): TfIdfVector {
  const tf = computeTF(tokens);
  const terms: Record<string, number> = {};
  let normSq = 0;
  for (const [t, tfVal] of Object.entries(tf)) {
    const idfVal = idf[t] ?? 1;
    const w = tfVal * idfVal;
    terms[t] = w;
    normSq += w * w;
  }
  return { terms, norm: Math.sqrt(normSq) || 1 };
}

/** 餘弦相似度 */
function cosineSimilarity(a: TfIdfVector, b: TfIdfVector): number {
  let dot = 0;
  for (const [term, wa] of Object.entries(a.terms)) {
    if (term in b.terms) dot += wa * b.terms[term];
  }
  return dot / (a.norm * b.norm);
}

// ──────────────── 意圖分類 (強化版) ────────────────

const TAG_RULES: Array<[RegExp, string]> = [
  [/課|修|學分|老師|教授|上課|選課|退選|加簽|課表/, 'academic'],
  [/作業|繳交|deadline|截止|報告|考試|期中|期末/, 'assignment'],
  [/成績|分數|及格|被當|當掉|gpa|排名|二一/, 'grades'],
  [/吃|餐|飯|食堂|美食|午餐|晚餐|早餐|素食|便當/, 'dining'],
  [/地點|在哪|怎麼走|路線|導航|位置|地圖/, 'navigation'],
  [/公告|通知|消息|新聞/, 'announcement'],
  [/活動|報名|講座|比賽|競賽|社團/, 'event'],
  [/圖書|借書|還書|圖書館|座位|自習/, 'library'],
  [/宿舍|住宿|寢室|報修|門禁|包裹|洗衣/, 'dormitory'],
  [/列印|影印|印表/, 'printing'],
  [/心情|壓力|焦慮|開心|難過|累|煩|沮喪/, 'emotion'],
  [/畢業|學位|必修|選修|通識|學程/, 'graduation'],
  [/天氣|下雨|溫度|氣象|颱風/, 'weather'],
  [
    /公車|校車|交通|停車|腳踏車|怎麼去|怎樣去|怎麼到|搭車|坐車|車站|火車站|高鐵|客運|台中車站|臺中車站/,
    'transport',
  ],
  [/健康|頭痛|感冒|不舒服|診所|保健/, 'health'],
  [/獎學金|助學|減免|補助/, 'scholarship'],
  [/請假|缺曠|翹課|出席/, 'attendance'],
  [/你好|哈囉|嗨|早安|午安|晚安/, 'greeting'],
];

export function autoTagQuestion(question: string): string[] {
  const tags: string[] = [];
  const q = question.toLowerCase();
  for (const [regex, tag] of TAG_RULES) {
    if (regex.test(q)) tags.push(tag);
  }
  if (tags.length === 0) tags.push('general');
  return tags;
}

// ──────────────── 模板學習器 ────────────────

/** 從一段好回答中萃取模板骨架 + 插槽 */
function extractTemplate(
  question: string,
  answer: string,
  tags: string[],
  knownData: {
    courseNames?: string[];
    assignmentTitles?: string[];
    menuNames?: string[];
    eventTitles?: string[];
    poiNames?: string[];
  },
): { skeleton: string; slots: Record<string, ResponseTemplate['slots'][string]> } {
  let skeleton = answer;
  const slots: Record<string, ResponseTemplate['slots'][string]> = {};
  let slotIdx = 0;

  // 把回答中出現的真實資料替換成插槽佔位符
  const replacements: Array<[string[], ResponseTemplate['slots'][string], string]> = [
    [knownData.courseNames ?? [], 'courses', 'COURSE'],
    [knownData.assignmentTitles ?? [], 'assignments', 'ASSIGNMENT'],
    [knownData.menuNames ?? [], 'menus', 'MENU'],
    [knownData.eventTitles ?? [], 'events', 'EVENT'],
    [knownData.poiNames ?? [], 'pois', 'POI'],
  ];

  for (const [names, slotType, prefix] of replacements) {
    for (const name of names) {
      if (name.length >= 2 && skeleton.includes(name)) {
        const slotName = `${prefix}_${slotIdx++}`;
        skeleton = skeleton.split(name).join(`{{${slotName}}}`);
        slots[slotName] = slotType;
      }
    }
  }

  // 替換日期相關
  const datePatterns = /\d{4}[\/\-年]\d{1,2}[\/\-月]\d{1,2}[日號]?|\d{1,2}[\/\-月]\d{1,2}[日號]?/g;
  skeleton = skeleton.replace(datePatterns, (match) => {
    const slotName = `DATE_${slotIdx++}`;
    slots[slotName] = 'text';
    return `{{${slotName}}}`;
  });

  // 替換數字（成績、價格等）
  const numberPatterns = /\d+\s*(?:分|元|塊|學分|節|筆|份|個|次)/g;
  skeleton = skeleton.replace(numberPatterns, (match) => {
    const slotName = `NUM_${slotIdx++}`;
    slots[slotName] = 'text';
    return `{{${slotName}}}`;
  });

  return { skeleton, slots };
}

// ──────────────── 本地答案組合器 ────────────────

const DAY_NAMES_LOCAL = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

/** 多輪回答風格變化器 — 避免每次開頭都一樣 */
const RESPONSE_VARIATIONS: Record<string, string[]> = {
  academic_intro: ['你的課程安排如下：', '讓我看看課表，', '課程資訊整理好了：', '根據你的課表：'],
  assignment_intro: [
    '作業狀況如下：',
    '來看看待繳作業，',
    '目前作業進度：',
    '幫你整理了作業資訊：',
  ],
  dining_intro: ['今天的美食選擇：', '幫你看了菜單，', '推薦以下餐點：', '今天有這些選擇：'],
  event_intro: ['近期活動整理：', '有這些活動可以參考：', '校園活動資訊：'],
  positive_close: [
    '希望有幫到你！',
    '還有什麼想問的嗎？',
    '需要更多資訊可以再問我。',
    '有其他問題隨時說。',
  ],
  empathy_prefix: ['辛苦了，', '我理解，', '聽起來不容易，', '能體會你的感受，'],
};

function pickVariation(key: string, seed?: number): string {
  const arr = RESPONSE_VARIATIONS[key];
  if (!arr || arr.length === 0) return '';
  const idx = seed != null ? seed % arr.length : Math.floor(Math.random() * arr.length);
  return arr[idx];
}

/** 追問處理器 — 根據上下文智慧回答追問 */
function handleFollowUp(
  q: string,
  ctx: LocalAnswerContext,
  data: {
    courses: Array<{
      id: string;
      name: string;
      teacher?: string;
      dayOfWeek: number;
      startPeriod?: number;
      credits?: number;
    }>;
    assignments: Array<{
      id: string;
      title: string;
      groupName: string;
      dueAt?: string;
      isLate?: boolean;
    }>;
    menus: Array<{ id: string; name: string; price?: number; cafeteria?: string }>;
    events: Array<{ id: string; title: string; location?: string; startsAt?: any }>;
    announcements: Array<{ id: string; title: string; source?: string }>;
    pois: Array<{ id: string; name: string; category?: string }>;
    memory: AgentMemory;
  },
  lastAsstMsg: string,
): string | null {
  const topic = ctx.currentTopic;

  // ── 「還有嗎」「其他的呢」→ 補充更多同類資訊 ──
  if (/還有嗎|還有呢|其他的|其他呢|別的呢|更多/.test(q)) {
    if (topic === 'dining') {
      const mentioned =
        ctx.shortTermMemory?.find((m) => m.key === 'last_recommended_meals')?.value ?? '';
      const mentionedNames = mentioned
        .split(', ')
        .map((s) => s.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean);
      const remaining = data.menus.filter(
        (m) => !mentionedNames.some((name) => m.name.includes(name)),
      );
      if (remaining.length > 0) {
        const list = remaining
          .slice(0, 5)
          .map(
            (m, i) =>
              `${i + 1}. ${m.name}${m.price != null ? ` — $${m.price}` : ''}${m.cafeteria ? `（${m.cafeteria}）` : ''}`,
          )
          .join('\n');
        return `還有這些選擇：\n${list}`;
      }
      return '已經列出所有今日餐點了，沒有更多的了。要不要換個方式篩選？';
    }
    if (topic === 'academic') {
      const mentionedCourses =
        ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_courses')?.value ?? '';
      const mentionedNames = mentionedCourses
        .split(', ')
        .map((s) => s.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean);
      const remaining = data.courses.filter(
        (c) => !mentionedNames.some((name) => c.name.includes(name)),
      );
      if (remaining.length > 0) {
        return `還有這些課程：\n${remaining
          .slice(0, 5)
          .map(
            (c, i) =>
              `${i + 1}. ${c.name}${c.teacher ? ` — ${c.teacher}` : ''}（${DAY_NAMES_LOCAL[c.dayOfWeek]}）`,
          )
          .join('\n')}`;
      }
      return '目前就這些課程了。';
    }
    if (topic === 'assignment') {
      const mentionedAssign =
        ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_assignments')?.value ?? '';
      const mentionedNames = mentionedAssign
        .split(', ')
        .map((s) => s.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean);
      const remaining = data.assignments.filter(
        (a) => !mentionedNames.some((name) => a.title.includes(name)),
      );
      if (remaining.length > 0) {
        return `還有這些作業：\n${remaining
          .slice(0, 5)
          .map(
            (a, i) =>
              `${i + 1}. ${a.title}（${a.groupName}）${a.dueAt ? ` — 截止：${a.dueAt}` : ''}${a.isLate ? ' ⚠️逾期' : ''}`,
          )
          .join('\n')}`;
      }
      return '目前就這些作業了。';
    }
    if (topic === 'event') {
      const mentionedEvents =
        ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_events')?.value ?? '';
      const remaining = data.events.filter((e) => !mentionedEvents.includes(e.title));
      if (remaining.length > 0) {
        return `還有這些活動：\n${remaining
          .slice(0, 5)
          .map((e, i) => `${i + 1}. ${e.title}${e.location ? `（${e.location}）` : ''}`)
          .join('\n')}`;
      }
      return '目前就這些活動了。';
    }
    if (topic === 'announcement') {
      const mentionedAnn =
        ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_announcements')?.value ?? '';
      const remaining = data.announcements.filter((a) => !mentionedAnn.includes(a.title));
      if (remaining.length > 0) {
        return `還有這些公告：\n${remaining
          .slice(0, 5)
          .map((a, i) => `${i + 1}. ${a.title}${a.source ? `（${a.source}）` : ''}`)
          .join('\n')}`;
      }
      return '目前的公告就是這些了。有特定想看的類別嗎？';
    }
    if (topic === 'navigation') {
      const remaining = data.pois.slice(0, 8);
      return `校園內還有這些地點：\n${remaining.map((p, i) => `${i + 1}. ${p.name}${p.category ? `（${p.category}）` : ''}`).join('\n')}`;
    }
  }

  // ── 「多少錢」「價格」→ 查詢前文提到的項目價格 ──
  if (/多少錢|價[格錢]|幾塊|多少元/.test(q)) {
    if (topic === 'dining') {
      const mentioned =
        ctx.shortTermMemory?.find((m) => m.key === 'last_recommended_meals')?.value ?? '';
      const mentionedNames = mentioned
        .split(', ')
        .map((s) => s.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean);
      const found = data.menus.filter(
        (m) => mentionedNames.some((name) => m.name.includes(name)) && m.price != null,
      );
      if (found.length > 0) {
        return found.map((m) => `${m.name}：$${m.price}`).join('\n');
      }
    }
  }

  // ── 「在哪」「怎麼去」→ 查詢前文提到的地點 ──
  if (/在哪|怎麼去|位置|怎麼走/.test(q)) {
    // 從多個記憶源搜尋地點
    const cafeteriaMem =
      ctx.shortTermMemory?.find((m) => m.key === 'mentioned_cafeterias')?.value ?? '';
    const locationSources = [cafeteriaMem];

    // 從課程記憶找上課地點
    if (topic === 'academic') {
      const courseMem =
        ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_courses')?.value ?? '';
      const firstName = courseMem
        .split(', ')[0]
        ?.replace(/^\d+\.\s*/, '')
        .trim();
      if (firstName) {
        const course = data.courses.find((c) => c.name.includes(firstName));
        if (course) {
          return `「${course.name}」上課地點可以在課表中查看，通常在校園主要教學樓。`;
        }
      }
    }

    // 從活動記憶找地點
    if (topic === 'event') {
      const eventMem =
        ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_events')?.value ?? '';
      const firstName = eventMem
        .split(', ')[0]
        ?.replace(/^\d+\.\s*/, '')
        .trim();
      if (firstName) {
        const event = data.events.find((e) => e.title.includes(firstName));
        if (event?.location) {
          return `「${event.title}」的地點在：${event.location}。需要導航嗎？`;
        }
      }
    }

    for (const src of locationSources) {
      if (src) {
        const matchedPois = data.pois.filter(
          (p) => src.includes(p.name) || p.name.includes(src.split(', ')[0]),
        );
        if (matchedPois.length > 0) {
          return `${matchedPois[0].name}的位置：${matchedPois[0].category ?? '校園內'}。你可以用 APP 的導航功能前往。`;
        }
      }
    }

    const placeEntity = ctx.slots?.find((s) => s.name === 'destination')?.value;
    if (placeEntity) {
      const poi = data.pois.find((p) => p.name.includes(placeEntity));
      if (poi) return `${poi.name}在${poi.category ?? '校園內'}，可以用 APP 導航前往。`;
    }
  }

  // ── 「什麼時候」「幾點」→ 時間相關追問 ──
  if (/什麼時候|幾點|幾號|何時|到幾點|截止/.test(q)) {
    if (topic === 'assignment') {
      const assignMem =
        ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_assignments')?.value ?? '';
      const firstName = assignMem
        .split(', ')[0]
        ?.replace(/^\d+\.\s*/, '')
        .trim();
      if (firstName) {
        const assign = data.assignments.find((a) => a.title.includes(firstName));
        if (assign?.dueAt)
          return `「${assign.title}」的截止時間是：${assign.dueAt}${assign.isLate ? '（⚠️ 已經逾期了！）' : ''}`;
      }
    }
    if (topic === 'event') {
      const eventMem =
        ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_events')?.value ?? '';
      const firstName = eventMem
        .split(', ')[0]
        ?.replace(/^\d+\.\s*/, '')
        .trim();
      if (firstName) {
        const event = data.events.find((e) => e.title.includes(firstName));
        if (event?.startsAt) return `「${event.title}」的時間：${event.startsAt}`;
      }
    }
    if (topic === 'academic') {
      const courseMem =
        ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_courses')?.value ?? '';
      const firstName = courseMem
        .split(', ')[0]
        ?.replace(/^\d+\.\s*/, '')
        .trim();
      if (firstName) {
        const course = data.courses.find((c) => c.name.includes(firstName));
        if (course)
          return `「${course.name}」的上課時間：${DAY_NAMES_LOCAL[course.dayOfWeek]}第${course.startPeriod ?? '?'}節`;
      }
    }
  }

  // ── 「誰教的」「老師是誰」→ 教師追問 ──
  if (/誰教|老師是|教授是|哪位老師|哪個老師/.test(q)) {
    const courseMem =
      ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_courses')?.value ?? '';
    const firstName = courseMem
      .split(', ')[0]
      ?.replace(/^\d+\.\s*/, '')
      .trim();
    if (firstName) {
      const course = data.courses.find((c) => c.name.includes(firstName));
      if (course?.teacher) return `「${course.name}」的授課教師是 ${course.teacher}。`;
    }
  }

  // ── 「幾學分」「學分數」→ 學分追問 ──
  if (/幾學分|學分數|幾個學分/.test(q)) {
    const courseMem =
      ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_courses')?.value ?? '';
    const firstName = courseMem
      .split(', ')[0]
      ?.replace(/^\d+\.\s*/, '')
      .trim();
    if (firstName) {
      const course = data.courses.find((c) => c.name.includes(firstName));
      if (course?.credits != null) return `「${course.name}」是 ${course.credits} 學分。`;
    }
  }

  // ── 「要報名嗎」「怎麼報名」→ 活動報名追問 ──
  if (/報名|怎麼參加|如何參加|要怎麼去/.test(q) && topic === 'event') {
    const eventMem =
      ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_events')?.value ?? '';
    const firstName = eventMem
      .split(', ')[0]
      ?.replace(/^\d+\.\s*/, '')
      .trim();
    if (firstName) {
      return `要參加「${firstName}」的話，可以在 APP 的活動頁面報名，或到活動現場直接參加。需要幫你設定提醒嗎？`;
    }
  }

  // ── 「嚴重嗎」「需要看醫生嗎」→ 健康追問 ──
  if (/嚴重嗎|需要看醫生|要去醫院|自己會好|要吃藥|怎麼辦/.test(q) && topic === 'health') {
    const gist = ctx.shortTermMemory?.find((m) => m.key === 'last_answer_gist')?.value ?? '';
    if (/發燒|頭痛|不舒服|感冒/.test(gist) || /發燒|頭痛|不舒服|感冒/.test(q)) {
      return '如果症狀持續超過兩天或嚴重惡化，建議去保健室或校外診所就醫。保健室開放時間是週一到週五 8:30-16:30。需要幫你查附近的診所嗎？';
    }
    return '建議先到學校保健室評估一下，如果需要進一步治療，保健室的護理師可以給你建議。';
  }

  // ── 「還來得及嗎」「可以補交嗎」→ 作業截止追問 ──
  if (/來得及|可以補交|可以遲交|扣分嗎|怎麼補/.test(q) && topic === 'assignment') {
    const assignMem =
      ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_assignments')?.value ?? '';
    const firstName = assignMem
      .split(', ')[0]
      ?.replace(/^\d+\.\s*/, '')
      .trim();
    if (firstName) {
      const assign = data.assignments.find((a) => a.title.includes(firstName));
      if (assign?.isLate) {
        return `「${assign.title}」已經逾期了。建議盡快聯繫 ${assign.groupName} 的老師，詢問是否接受補交以及扣分標準。`;
      }
      return `「${assign.title}」還沒截止，趕快完成吧！`;
    }
  }

  // ── 「好吃嗎」「推薦嗎」→ 基於偏好的評價 ──
  if (/好吃嗎|推薦嗎|值得嗎|CP值/.test(q)) {
    const mentioned =
      ctx.shortTermMemory?.find((m) => m.key === 'last_recommended_meals')?.value ?? '';
    if (mentioned) {
      const firstItem = mentioned
        .split(', ')[0]
        ?.replace(/^\d+\.\s*/, '')
        .trim();
      if (firstItem) {
        const prefs = data.memory.learnedFacts.filter((f) => f.category === 'dietary');
        if (prefs.length > 0) {
          return `根據你的飲食偏好（${prefs.map((p) => p.fact).join('、')}），${firstItem}滿適合你的！`;
        }
        return `${firstItem}是不少同學推薦的選擇！要不要試試看？`;
      }
    }
  }

  // ── 「第N個」→ 選擇前文列表中的項目 ──
  const ordinalMatch = q.match(/第([一二三四五六七八1-8])個/);
  if (ordinalMatch) {
    const ordinalMap: Record<string, number> = {
      一: 0,
      二: 1,
      三: 2,
      四: 3,
      五: 4,
      六: 5,
      七: 6,
      八: 7,
      '1': 0,
      '2': 1,
      '3': 2,
      '4': 3,
      '5': 4,
      '6': 5,
      '7': 6,
      '8': 7,
    };
    const idx = ordinalMap[ordinalMatch[1]] ?? 0;
    for (const mem of ctx.shortTermMemory ?? []) {
      if (mem.key.startsWith('last_')) {
        const items = mem.value.split(', ');
        if (items[idx]) {
          const item = items[idx].replace(/^\d+\.\s*/, '').trim();
          if (topic === 'dining') {
            const menu = data.menus.find((m) => m.name.includes(item));
            if (menu) {
              return `你選的是「${menu.name}」${menu.price != null ? `，$${menu.price}` : '，價格未提供'}${menu.cafeteria ? `，在${menu.cafeteria}` : ''}。需要看更多細節或換其他選擇嗎？`;
            }
          }
          if (topic === 'academic') {
            const course = data.courses.find((c) => c.name.includes(item));
            if (course) {
              return `你選的是「${course.name}」：${course.teacher ?? ''}老師，${DAY_NAMES_LOCAL[course.dayOfWeek]}第${course.startPeriod ?? '?'}節，${course.credits ?? '?'}學分。需要查看更多資訊嗎？`;
            }
          }
          if (topic === 'assignment') {
            const assign = data.assignments.find((a) => a.title.includes(item));
            if (assign) {
              return `你選的是「${assign.title}」（${assign.groupName}），截止：${assign.dueAt ?? '未設定'}${assign.isLate ? ' ⚠️已逾期' : ''}。`;
            }
          }
          if (topic === 'event') {
            const event = data.events.find((e) => e.title.includes(item));
            if (event) {
              return `你選的是「${event.title}」${event.location ? `，地點：${event.location}` : ''}${event.startsAt ? `，時間：${event.startsAt}` : ''}。要報名嗎？`;
            }
          }
          return `你選的是「${item}」。需要更多關於它的資訊嗎？`;
        }
      }
    }
  }

  // ── 否定型追問：「不想要」「換一個」「太貴了」 ──
  if (/不想要|換一個|換別的|太[貴遠辣鹹甜難簡單無聊]|不喜歡|其他選擇|不好|不適合/.test(q)) {
    if (topic === 'dining') {
      const mentioned =
        ctx.shortTermMemory?.find((m) => m.key === 'last_recommended_meals')?.value ?? '';
      const mentionedNames = mentioned.split(', ').map((s) => s.replace(/^\d+\.\s*/, '').trim());
      let filtered = data.menus.filter(
        (m) => !mentionedNames.some((name) => m.name.includes(name)),
      );

      if (/太貴|便宜/.test(q)) {
        const pricedCheap = filtered.filter((m) => m.price != null && m.price <= 80);
        if (pricedCheap.length > 0) {
          filtered = pricedCheap;
        } else {
          return '目前官方菜單沒有單品價格，所以不能準確排序最便宜。\n\n省錢優先可先看便利商店鮮食、早餐/點心類，或到靜園/宜園現場確認自助餐與主食品項價格。';
        }
      }
      if (/不辣|不要辣/.test(q)) filtered = filtered.filter((m) => !/辣/.test(m.name));

      if (filtered.length > 0) {
        const list = filtered
          .slice(0, 5)
          .map(
            (m, i) =>
              `${i + 1}. ${m.name}${m.price != null ? ` — $${m.price}` : ''}${m.cafeteria ? `（${m.cafeteria}）` : ''}`,
          )
          .join('\n');
        return `好的，換一些不同的：\n${list}`;
      }
      return '目前的選擇就這些了，你有什麼特別想吃的嗎？我可以幫你找找。';
    }
    if (topic === 'event') {
      const mentionedEvents =
        ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_events')?.value ?? '';
      const remaining = data.events.filter((e) => !mentionedEvents.includes(e.title));
      if (remaining.length > 0) {
        return `好，換一些其他活動：\n${remaining
          .slice(0, 5)
          .map((e, i) => `${i + 1}. ${e.title}${e.location ? `（${e.location}）` : ''}`)
          .join('\n')}`;
      }
      return '目前只有這些活動，你想找什麼類型的？';
    }
    if (topic === 'academic' || topic === 'assignment') {
      return '好的，你想找什麼方面的資訊？可以告訴我具體需求，我幫你重新搜尋。';
    }
  }

  // ── 「詳細」「更多資訊」→ 對前文的展開 ──
  if (/詳細|詳情|更多資訊|告訴我更多|說明|具體/.test(q)) {
    if (topic === 'academic') {
      const coursesMem =
        ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_courses')?.value ?? '';
      const firstName = coursesMem
        .split(', ')[0]
        ?.replace(/^\d+\.\s*/, '')
        .trim();
      if (firstName) {
        const course = data.courses.find((c) => c.name.includes(firstName));
        if (course) {
          return `「${course.name}」的詳細資訊：\n• 授課教師：${course.teacher ?? '未知'}\n• 學分數：${course.credits ?? '?'}學分\n• 上課時間：${DAY_NAMES_LOCAL[course.dayOfWeek]}第${course.startPeriod ?? '?'}節`;
        }
      }
    }
    if (topic === 'assignment') {
      const assignMem =
        ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_assignments')?.value ?? '';
      const firstName = assignMem
        .split(', ')[0]
        ?.replace(/^\d+\.\s*/, '')
        .trim();
      if (firstName) {
        const assign = data.assignments.find((a) => a.title.includes(firstName));
        if (assign) {
          return `「${assign.title}」的詳細資訊：\n• 課程：${assign.groupName}\n• 截止日期：${assign.dueAt ?? '未設定'}${assign.isLate ? '\n• ⚠️ 已逾期！建議盡快補交' : ''}`;
        }
      }
    }
    if (topic === 'dining') {
      const mealMem =
        ctx.shortTermMemory?.find((m) => m.key === 'last_recommended_meals')?.value ?? '';
      const firstName = mealMem
        .split(', ')[0]
        ?.replace(/^\d+\.\s*/, '')
        .trim();
      if (firstName) {
        const menu = data.menus.find((m) => m.name.includes(firstName));
        if (menu) {
          return `「${menu.name}」的詳細資訊：\n• 價格：${menu.price != null ? `$${menu.price}` : '未提供'}\n• 供應地點：${menu.cafeteria ?? '未知'}\n需要看其他餐點嗎？`;
        }
      }
    }
    if (topic === 'event') {
      const eventMem =
        ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_events')?.value ?? '';
      const firstName = eventMem
        .split(', ')[0]
        ?.replace(/^\d+\.\s*/, '')
        .trim();
      if (firstName) {
        const event = data.events.find((e) => e.title.includes(firstName));
        if (event) {
          return `「${event.title}」的詳細資訊：\n• 地點：${event.location ?? '未定'}\n• 時間：${event.startsAt ?? '未定'}\n需要幫你報名或設定提醒嗎？`;
        }
      }
    }
    if (topic === 'health') {
      const gist = ctx.shortTermMemory?.find((m) => m.key === 'last_answer_gist')?.value ?? '';
      return `關於健康問題的進一步建議：\n• 學校保健室：週一至週五 8:30-16:30\n• 諮商中心：需預約，可打校內分機\n• 校外診所：沙鹿、龍井地區有多家診所\n如果症狀嚴重，建議直接就醫。`;
    }
  }

  // ── 比較型追問 ──
  if (/比較|哪個好|哪個便宜|哪個近|差別|差異|vs|VS/.test(q)) {
    if (topic === 'dining') {
      const mentioned =
        ctx.shortTermMemory?.find((m) => m.key === 'last_recommended_meals')?.value ?? '';
      const names = mentioned
        .split(', ')
        .map((s) => s.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean);
      const found = names.map((n) => data.menus.find((m) => m.name.includes(n))).filter(Boolean);
      if (found.length >= 2) {
        const comparison = found
          .slice(0, 3)
          .map((m) =>
            m
              ? `• ${m.name}：${m.price != null ? `$${m.price}` : '價格不詳'}${m.cafeteria ? ` @${m.cafeteria}` : ''}`
              : '',
          )
          .join('\n');
        return `幫你比較一下：\n${comparison}`;
      }
    }
    if (topic === 'academic') {
      const coursesMem =
        ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_courses')?.value ?? '';
      const names = coursesMem
        .split(', ')
        .map((s) => s.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean);
      const found = names.map((n) => data.courses.find((c) => c.name.includes(n))).filter(Boolean);
      if (found.length >= 2) {
        const comparison = found
          .slice(0, 3)
          .map((c) =>
            c
              ? `• ${c.name}：${c.teacher ?? '?'}老師，${c.credits ?? '?'}學分，${DAY_NAMES_LOCAL[c.dayOfWeek]}`
              : '',
          )
          .join('\n');
        return `幫你比較一下這幾門課：\n${comparison}`;
      }
    }
    if (topic === 'event') {
      const eventsMem =
        ctx.shortTermMemory?.find((m) => m.key === 'last_mentioned_events')?.value ?? '';
      const names = eventsMem
        .split(', ')
        .map((s) => s.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean);
      const found = names.map((n) => data.events.find((e) => e.title.includes(n))).filter(Boolean);
      if (found.length >= 2) {
        const comparison = found
          .slice(0, 3)
          .map((e) =>
            e
              ? `• ${e.title}${e.location ? ` — ${e.location}` : ''}${e.startsAt ? ` — ${e.startsAt}` : ''}`
              : '',
          )
          .join('\n');
        return `幫你比較一下：\n${comparison}`;
      }
    }
  }

  // ── 感謝/正面回饋後的銜接 ──
  if (/謝謝|感謝|太好了|不錯|厲害/.test(q)) {
    if (topic) {
      const topicHints: Record<string, string> = {
        dining: '還需要查其他餐點或餐廳嗎？',
        academic: '還有其他課程相關的問題嗎？',
        assignment: '還有其他作業需要查詢嗎？',
        event: '還有其他活動想了解嗎？',
        health: '還有其他健康問題嗎？記得多休息。',
        navigation: '還有其他地方想查怎麼去嗎？',
        library: '還有其他圖書館服務需要幫忙嗎？',
      };
      const hint = topicHints[topic];
      if (hint) return `不客氣！${hint}`;
    }
    return '不客氣！有什麼需要幫忙的隨時問我。';
  }

  return null; // 沒有匹配的追問模式
}

/** 上下文資訊（從 AI Brain 傳入） */
export interface LocalAnswerContext {
  /** 當前對話主題 */
  currentTopic?: string | null;
  /** 主題持續輪數 */
  topicContinuity?: number;
  /** 是否追問 */
  isFollowUp?: boolean;
  /** 對話槽位 */
  slots?: Array<{ name: string; value: string }>;
  /** 短期記憶 */
  shortTermMemory?: Array<{ key: string; value: string }>;
  /** 用戶情緒 -1~1 */
  userMood?: number;
  /** 用戶偏好風格 */
  userStyle?: { prefersShort?: boolean; prefersDetail?: boolean; formality?: number };
  /** 上下文摘要字串 */
  contextSummary?: string;
  /** 前幾輪對話（供上下文推理） */
  recentTurns?: Array<{ role: string; content: string }>;
}

/** 根據標籤 + 知識圖譜 + 即時資料 + 上下文，在本地生成回答 */
export function generateLocalAnswer(
  question: string,
  tags: string[],
  data: {
    courses: Array<{
      id: string;
      name: string;
      teacher?: string;
      dayOfWeek: number;
      startPeriod?: number;
      credits?: number;
    }>;
    assignments: Array<{
      id: string;
      title: string;
      groupName: string;
      dueAt?: string;
      isLate?: boolean;
    }>;
    menus: Array<{ id: string; name: string; price?: number; cafeteria?: string }>;
    events: Array<{ id: string; title: string; location?: string; startsAt?: any }>;
    announcements: Array<{ id: string; title: string; source?: string }>;
    pois: Array<{ id: string; name: string; category?: string }>;
    memory: AgentMemory;
  },
  templates: ResponseTemplate[],
  learningState: ActiveLearningState,
  ctx?: LocalAnswerContext,
): { answer: string; confidence: number; source: 'local' } | null {
  templates = Array.isArray(templates) ? templates : [];
  const q = question.toLowerCase();
  const today = new Date();
  const todayDay = today.getDay();
  let answer = '';
  let confidence = 0;

  // 上下文輔助函數
  const slotVal = (name: string) => ctx?.slots?.find((s) => s.name === name)?.value ?? null;
  const memVal = (key: string) => ctx?.shortTermMemory?.find((m) => m.key === key)?.value ?? null;
  const isFollowUp = ctx?.isFollowUp ?? false;
  const recentTurns = ctx?.recentTurns ?? [];
  const lastAsstMsg = [...recentTurns].reverse().find((t) => t.role === 'assistant')?.content ?? '';

  // ── 追問處理（最高優先：如果是追問，根據上下文回答）──
  if (isFollowUp && ctx?.currentTopic) {
    const followUpAnswer = handleFollowUp(q, ctx, data, lastAsstMsg);
    if (followUpAnswer) {
      return { answer: followUpAnswer, confidence: 0.85, source: 'local' };
    }
  }

  // ── 打招呼（上下文感知）──
  if (tags.includes('greeting')) {
    const hour = today.getHours();
    const timeGreeting = hour < 12 ? '早安' : hour < 18 ? '午安' : '晚安';
    const name = data.memory.learnedFacts.find((f) => f.category === 'personal')?.fact ?? '';
    const nameStr = name ? `${name}，` : '';

    // 根據時段和資料主動建議
    const parts: string[] = [`${nameStr}${timeGreeting}！`];

    if (hour >= 11 && hour <= 13 && data.menus.length > 0) {
      parts.push('中午了，要不要看看今天有什麼好吃的？');
    } else if (data.assignments.filter((a) => a.isLate).length > 0) {
      parts.push(
        `提醒一下，你有 ${data.assignments.filter((a) => a.isLate).length} 份作業已逾期哦。`,
      );
    } else if (data.assignments.length > 0) {
      parts.push(`今天有 ${data.assignments.length} 份待繳作業，要看看嗎？`);
    } else {
      parts.push('有什麼我可以幫你的嗎？');
    }

    answer = parts.join('');
    confidence = 0.95;
  }

  // ── 課表查詢 ──
  else if (tags.includes('academic') && /今天|明天|後天|星期|週|課表|有什麼課|有沒有課/.test(q)) {
    let targetDay = todayDay;
    if (/明天/.test(q)) targetDay = (todayDay + 1) % 7;
    else if (/後天/.test(q)) targetDay = (todayDay + 2) % 7;
    else {
      const dayMatch = q.match(/(?:星期|週)(一|二|三|四|五|六|日|天)/);
      if (dayMatch) {
        const dayMap: Record<string, number> = {
          日: 0,
          天: 0,
          一: 1,
          二: 2,
          三: 3,
          四: 4,
          五: 5,
          六: 6,
        };
        targetDay = dayMap[dayMatch[1]] ?? todayDay;
      }
    }
    const dayCourses = data.courses.filter((c) => c.dayOfWeek === targetDay);
    const dayName = DAY_NAMES_LOCAL[targetDay];
    if (dayCourses.length > 0) {
      const sorted = [...dayCourses].sort((a, b) => (a.startPeriod ?? 0) - (b.startPeriod ?? 0));
      const list = sorted
        .map(
          (c, i) =>
            `${i + 1}. ${c.name}（第${c.startPeriod ?? '?'}節${c.teacher ? `，${c.teacher}` : ''}${c.credits ? `，${c.credits}學分` : ''}）`,
        )
        .join('\n');
      answer = `${dayName}的課程如下：\n${list}`;
    } else {
      answer = `${dayName}沒有課哦！可以好好休息或自習。`;
    }
    confidence = 0.92;
  }

  // ── 作業查詢 ──
  else if (tags.includes('assignment')) {
    if (data.assignments.length > 0) {
      const lateOnes = data.assignments.filter((a) => a.isLate);
      const upcoming = data.assignments.filter((a) => !a.isLate);
      const parts: string[] = [];
      if (lateOnes.length > 0) {
        parts.push(`⚠️ 有 ${lateOnes.length} 份已逾期的作業：`);
        lateOnes.forEach((a, i) =>
          parts.push(
            `  ${i + 1}. ${a.title}（${a.groupName}${a.dueAt ? `，截止：${a.dueAt}` : ''}）`,
          ),
        );
      }
      if (upcoming.length > 0) {
        parts.push(lateOnes.length > 0 ? '\n即將到期的作業：' : '待繳作業：');
        upcoming
          .slice(0, 8)
          .forEach((a, i) =>
            parts.push(
              `${i + 1}. ${a.title}（${a.groupName}${a.dueAt ? `，截止：${a.dueAt}` : ''}）`,
            ),
          );
      }
      answer = parts.join('\n');
    } else {
      answer = '目前沒有待繳的作業，保持得不錯！';
    }
    confidence = 0.9;
  }

  // ── 成績 / 被當風險 ──
  else if (tags.includes('grades')) {
    const riskKeywords = /被當|當掉|不及格|二一|危險|風險|會不會/;
    if (riskKeywords.test(q)) {
      const lateAssignments = data.assignments.filter((a) => a.isLate);
      if (lateAssignments.length > 0) {
        const affected = lateAssignments
          .map((a) => a.groupName)
          .filter((v, i, arr) => arr.indexOf(v) === i);
        answer = `根據你目前的作業繳交狀況，有 ${lateAssignments.length} 份作業已逾期，涉及的課程有：${affected.join('、')}。\n\n建議盡快補交這些作業，逾期作業通常會影響平時成績。如果有困難，可以主動聯繫老師說明情況。`;
      } else {
        answer = '目前你所有作業都有準時繳交，表現不錯！繼續保持就不用擔心被當的問題。';
      }
      confidence = 0.85;
    } else {
      answer = '目前 APP 還沒有取得你的詳細成績資料。你可以到學校成績查詢系統查看最新成績。';
      confidence = 0.7;
    }
  }

  // ── 餐飲查詢（上下文 + 槽位感知）──
  else if (tags.includes('dining')) {
    if (data.menus.length > 0) {
      let filtered = [...data.menus];

      // 1. 從對話槽位過濾（用戶在多輪中提到的偏好）
      const budgetSlot = slotVal('budget');
      const prefSlot = slotVal('food_preference');
      const cafeteriaSlot = slotVal('cafeteria');

      if (budgetSlot) {
        const maxPrice = parseInt(budgetSlot.match(/\d+/)?.[0] ?? '999', 10);
        if (maxPrice < 999) {
          filtered = filtered.filter((m) => m.price == null || m.price <= maxPrice);
        }
      }

      if (/便宜|平價|划算|省|cp/i.test(q) && !data.menus.some((m) => m.price != null)) {
        answer =
          '目前官方菜單沒有單品價格，所以我不能準確排序最便宜。\n\n省錢優先可先看便利商店鮮食、早餐/點心類，或到靜園/宜園現場確認自助餐與主食品項價格。';
        confidence = 0.85;
        return { answer, confidence, source: 'local' };
      }

      if (prefSlot) {
        const pref = prefSlot.toLowerCase();
        if (/素食/.test(pref)) filtered = filtered.filter((m) => /素|蔬/.test(m.name));
        if (/不吃肉/.test(pref))
          filtered = filtered.filter((m) => !/排骨|雞|豬|牛|肉/.test(m.name));
        if (/辣/.test(pref) && !/不辣/.test(pref))
          filtered = filtered.filter((m) => /辣/.test(m.name));
        if (/不辣/.test(pref)) filtered = filtered.filter((m) => !/辣/.test(m.name));
      }

      if (cafeteriaSlot) {
        const cfFiltered = filtered.filter(
          (m) => m.cafeteria && m.cafeteria.includes(cafeteriaSlot),
        );
        if (cfFiltered.length > 0) filtered = cfFiltered;
      }

      // 2. 從長期記憶過濾
      const dietaryPrefs = data.memory.learnedFacts.filter((f) => f.category === 'dietary');
      if (dietaryPrefs.length > 0 && !prefSlot && /推薦|建議|吃什麼/.test(q)) {
        const prefText = dietaryPrefs.map((f) => f.fact.toLowerCase()).join(' ');
        const prefFiltered = filtered.filter((m) => {
          const name = (m.name ?? '').toLowerCase();
          return prefText.split(/\s+/).some((w) => w.length >= 2 && name.includes(w));
        });
        if (prefFiltered.length > 0) filtered = prefFiltered;
      }

      // 3. 排除已推薦過的（如果是追問上下文）
      const prevRecommended = memVal('last_recommended_meals');
      if (prevRecommended && /換|其他|別的|不要/.test(q)) {
        const prevNames = prevRecommended.split(', ').map((s) => s.replace(/^\d+\.\s*/, '').trim());
        filtered = filtered.filter((m) => !prevNames.some((name) => m.name.includes(name)));
      }

      if (filtered.length === 0) filtered = data.menus; // fallback

      const list = filtered
        .slice(0, 8)
        .map(
          (m, i) =>
            `${i + 1}. ${m.name}${m.price != null ? ` — $${m.price}` : ' — 價格未提供'}${m.cafeteria ? `（${m.cafeteria}）` : ''}`,
        )
        .join('\n');

      // 4. 自然的介紹語（上下文感知 + 風格多變）
      let intro: string;
      const filterDesc: string[] = [];
      if (budgetSlot) filterDesc.push(`$${budgetSlot.match(/\d+/)?.[0] ?? ''}以內`);
      if (prefSlot) filterDesc.push(prefSlot);
      if (cafeteriaSlot) filterDesc.push(cafeteriaSlot);

      if (filterDesc.length > 0) {
        intro = `根據你的要求（${filterDesc.join('、')}），推薦：`;
      } else if (/推薦|建議/.test(q)) {
        intro = pickVariation('dining_intro', today.getMinutes());
      } else if (/菜單|有什麼/.test(q)) {
        intro = '今日菜單：';
      } else {
        intro = pickVariation('dining_intro', today.getHours());
      }

      answer = `${intro}\n${list}`;

      // 5. 加入互動引導
      if (ctx?.userStyle?.prefersDetail) {
        answer += '\n\n可以問我「第幾個多少錢」「哪個比較推薦」等問題。';
      }
    } else {
      const hour = today.getHours();
      const mealLabel = hour < 10 ? '早餐' : hour < 14 ? '午餐' : hour < 17 ? '下午茶' : '晚餐';
      const wantsVeg = /素|蔬菜|沙拉|健康|清淡/.test(q);
      const wantsCheap = /便宜|划算|省|CP/.test(q);

      const fallbackMenus = getPuDiningMenuItems('pu');
      let picks = [...fallbackMenus];
      if (wantsVeg)
        picks = picks.filter(
          (m) => m.vegetarian || /素|蔬|水果|沙拉|豆漿|麻醬麵|蛋炒飯/.test(m.name),
        );
      if (wantsCheap && !fallbackMenus.some((m) => m.price != null)) {
        answer = `目前官方菜單沒有單品價格，所以我不能準確推薦「最便宜」。\n\n${mealLabel}可先看：\n1. OK 便利商店或至善美食廣場的一般鮮食\n2. 靜園餐廳 Morning House 的早餐/點心類\n3. 宜園餐廳或靜園餐廳的自助餐/主食櫃位\n\n實際價格仍以現場或店家菜單為準。`;
        confidence = 0.88;
        return { answer, confidence, source: 'local' };
      }
      if (wantsCheap) picks = picks.filter((m) => m.price == null || m.price <= 80);
      const shuffled = picks.slice(0, 5);

      const list = shuffled
        .map(
          (m, i) =>
            `${i + 1}. ${m.name} — ${m.price != null ? `$${m.price}` : '價格未提供'}（${m.cafeteria}）`,
        )
        .join('\n');

      answer = `${mealLabel}推薦：\n${list}`;
      if (wantsVeg) answer += '\n\n以上都有素食選項！';
      else if (wantsCheap) answer += '\n\n都是平價好選擇！';
      else answer += '\n\n想知道更多可以跟我說～';
    }
    confidence = 0.9;
  }

  // ── 活動查詢 ──
  else if (tags.includes('event')) {
    if (data.events.length > 0) {
      const list = data.events
        .slice(0, 6)
        .map(
          (e, i) =>
            `${i + 1}. ${e.title}${e.location ? `（${e.location}）` : ''}${e.startsAt ? ` — ${e.startsAt}` : ''}`,
        )
        .join('\n');
      answer = `近期活動：\n${list}`;
    } else {
      answer = '目前沒有近期活動資訊。';
    }
    confidence = 0.85;
  }

  // ── 公告查詢 ──
  else if (tags.includes('announcement')) {
    if (data.announcements.length > 0) {
      const list = data.announcements
        .slice(0, 6)
        .map((a, i) => `${i + 1}. ${a.title}${a.source ? `（${a.source}）` : ''}`)
        .join('\n');
      answer = `最新公告：\n${list}`;
    } else {
      answer = '目前沒有新的公告。';
    }
    confidence = 0.85;
  }

  // ── 地點導航 ──
  else if (tags.includes('navigation')) {
    const matchedPois = data.pois.filter((p) => {
      const pName = p.name.toLowerCase();
      const pCat = (p.category ?? '').toLowerCase();
      return (
        q.includes(pName) ||
        q.includes(pCat) ||
        pName.split('').some((c, i, arr) => i < arr.length - 1 && q.includes(arr[i] + arr[i + 1]))
      );
    });
    if (matchedPois.length > 0) {
      const list = matchedPois
        .slice(0, 5)
        .map((p, i) => `${i + 1}. ${p.name}${p.category ? `（${p.category}）` : ''}`)
        .join('\n');
      answer = `找到以下地點：\n${list}\n\n你可以使用 APP 的導航功能前往。`;
    } else if (data.pois.length > 0) {
      answer =
        '我沒有找到確切的地點，以下是校園內的一些常用地點：\n' +
        data.pois
          .slice(0, 8)
          .map((p, i) => `${i + 1}. ${p.name}（${p.category ?? ''}）`)
          .join('\n');
    } else {
      answer = '目前沒有校園地點資料。';
    }
    confidence = 0.8;
  }

  // ── 圖書館 ──
  else if (tags.includes('library')) {
    if (/座位|自習|討論室|預約/.test(q)) {
      answer =
        '蓋夏圖書館座位預約資訊：\n\n1. 個人自習區 — 1F-4F 均有座位\n2. 安靜閱覽區 — 3F（禁止交談）\n3. 團體討論室 — 2F（需提前預約，4-8人）\n\n開放時間：週一～五 08:00-21:30，週六日 09:00-17:00\n\n要幫你預約座位嗎？';
    } else if (/借書|還書|找書|館藏/.test(q)) {
      answer =
        '蓋夏圖書館借閱服務：\n\n• 藏書量：超過 60 萬冊\n• 每人可借 30 冊，借期 30 天\n• 可線上續借 2 次\n• 逾期每冊每日罰 $2\n\n告訴我書名，我幫你查查館藏！';
    } else {
      answer =
        '蓋夏圖書館資訊：\n\n位置：校園中央\n開放時間：週一～五 08:00-21:30，週六日 09:00-17:00\n藏書量：60萬冊+\n設施：自習區、討論室、數位學習區、咖啡角\n\n需要預約座位或找書嗎？';
    }
    confidence = 0.88;
  }

  // ── 宿舍 ──
  else if (tags.includes('dormitory')) {
    if (/報修|壞了|故障|漏水|冷氣/.test(q)) {
      answer =
        '宿舍報修流程：\n\n1. 在 APP 提交維修單（或到管理室填表）\n2. 選擇類別：水電/冷氣/家具/網路\n3. 填寫房號和問題描述\n4. 預計 1-3 個工作天處理\n\n要幫你提交報修單嗎？';
    } else if (/洗衣|烘衣/.test(q)) {
      answer =
        '宿舍洗衣資訊：\n\n洗衣房位置：\n• 希嘉學苑 1F\n• 思高學苑 1F\n\n費用：洗衣 $20/次，烘衣 $10/次\n營業：24小時，但建議避開尖峰（晚上8-10點）\n\n要我幫你查詢目前機台狀態嗎？';
    } else if (/包裹|快遞|取件/.test(q)) {
      answer =
        '包裹領取資訊：\n\n領取地點：宿舍管理室\n領取時間：08:00-21:00\n需要攜帶：學生證\n\n到件通知會透過 APP 推送，也可以在 APP 查詢待領包裹。';
    } else {
      answer =
        '宿舍服務一覽：\n\n• 設施報修 — 水電/冷氣/網路問題\n• 洗衣烘衣 — 24小時自助\n• 包裹領取 — 管理室 08:00-21:00\n• 門禁時間 — 23:00-06:00\n• 宿舍：希嘉學苑、思高學苑\n\n需要哪項服務？';
    }
    confidence = 0.85;
  }

  // ── 健康 ──
  else if (tags.includes('health')) {
    const symptoms = q.match(
      /頭痛|肚子痛|發燒|感冒|咳嗽|不舒服|過敏|拉肚子|噁心|想吐|頭暈|喉嚨痛|流鼻水|受傷|扭到/,
    );
    if (/掛號|預約|看醫|看診/.test(q)) {
      answer =
        '衛保組掛號資訊：\n\n地點：至善樓 1F 衛保組\n看診時間：週一～五 09:00-12:00、13:30-16:30\n費用：免費（持學生證）\n\n需要我幫你預約掛號嗎？';
    } else if (/諮商|心理/.test(q)) {
      answer =
        '心理諮商服務（完全免費且保密）：\n\n地點：至善樓 2F 諮商輔導中心\n預約電話：(04)2632-8001 分機 11501\n初次諮商需先填寫初談表\n\n你的感受很重要，不用獨自承擔。要幫你預約嗎？';
    } else if (symptoms) {
      answer = `你提到有${symptoms[0]}的症狀，先別擔心。建議：\n\n1. 輕微症狀：多休息、多喝水\n2. 持續不適：到衛保組看診（至善樓 1F，免費）\n3. 嚴重情況：撥打校園緊急專線 (04)2632-8001\n\n衛保組看診時間：週一～五 09:00-16:30\n\n需要我幫你預約嗎？`;
    } else {
      answer =
        '校園健康服務：\n\n• 衛保組（至善樓 1F）— 免費看診，週一～五 09:00-16:30\n• 諮商中心（至善樓 2F）— 免費心理諮商\n• 校園 AED 位置：圖書館 1F、體育館 1F、各大樓 1F\n• 緊急專線：(04)2632-8001';
    }
    confidence = 0.88;
  }

  // ── 情緒支援 ──
  else if (tags.includes('emotion')) {
    const negative = /壓力|焦慮|難過|累|煩|沮喪|崩潰|撐不住|不想|心情不好|低落/.test(q);
    if (negative) {
      answer =
        '聽起來你最近不太好受，這很正常 — 大學生活確實有不少壓力。\n\n先深呼吸，你不是一個人在面對這些。\n\n幾個建議：\n1. 到校園走走散心（靜園的花園很舒服）\n2. 跟朋友聊聊天\n3. 學校有免費心理諮商（至善樓 2F，(04)2632-8001 #11501）\n\n你不需要一個人扛著，找人聊聊真的會有幫助的 ❤️';
    } else {
      answer = '很高興聽到！希望你每天都過得開心 😊\n有什麼需要幫忙的隨時說！';
    }
    confidence = 0.9;
  }

  // ── 出席/請假 ──
  else if (tags.includes('attendance')) {
    answer =
      '請假流程：\n\n1. 病假 — 需附就醫證明，3 天內上網補假\n2. 事假 — 需提前申請，由授課教師核准\n3. 公假 — 學校活動/比賽，需附公文\n\n注意：各科缺曠超過 1/3 可能被扣考！\n\n要我幫你線上請假嗎？';
    confidence = 0.85;
  }

  // ── 交通 ──
  else if (tags.includes('transport')) {
    if (/沙鹿.*(火車站|車站)|沙鹿火車站/.test(q)) {
      answer =
        '從靜宜大學到沙鹿火車站：\n\n1. 最快：計程車或共乘，約 10 分鐘。\n2. 省錢：到校門口周邊搭往沙鹿市區方向的公車，班次請用台中公車 App 確認。\n3. 要去台中車站的話，可從沙鹿火車站搭台鐵區間車。';
    } else if (/台中|臺中|火車站|車站/.test(q)) {
      answer =
        '從靜宜大學到台中車站：\n\n1. 直達公車：到校門口台灣大道上的站牌，搭 300、307 或 308 往台中車站方向，約 40-50 分鐘；尖峰可能更久。\n2. 台鐵轉乘：先到沙鹿火車站，再搭台鐵區間車到台中車站，約 20-30 分鐘車程，但要多一次轉乘。\n\n離線模式不能查即時班次，出門前請用台中公車 App 或台鐵 App 確認下一班。';
    } else if (/高鐵/.test(q)) {
      answer =
        '到高鐵台中站的方式：\n\n1. 統聯客運 — 約 30 分鐘\n2. 35 路公車 — 約 40 分鐘\n3. 計程車 — 約 20 分鐘，$300 左右\n\n都可以在校門口搭乘。';
    } else {
      answer =
        '靜宜大學交通資訊：\n\n主要公車路線（校門口搭）：\n• 300/307/308 → 台中火車站（40-50min）\n• 304 → 清水\n• 統聯/35路 → 高鐵台中站（30min）\n\nYouBike 站點：校門口\n\n即時到站資訊請查看「台中公車」APP。';
    }
    confidence = 0.88;
  }

  // ── 離線助理自我說明 / 使用者抱怨 / 草稿需求 ──
  else if (
    /你是誰|你是什麼|什麼模型|模型|離線|本地|chatgpt|gpt|codex|智商|多聰明|參數|parameter|權重|訓練|跟.*一樣/.test(
      q,
    )
  ) {
    answer =
      '我不能把 App 端模型參數量變成和 ChatGPT/Codex 一樣，也不會假裝自己有相同權重。\n\n我能變強的方式是：\n1. 使用更完整的助理能力設定與本地訓練範例\n2. 讀取 App 內的課表、作業、餐飲、圖書館、宿舍與校園資料\n3. 對可執行工具產生確認卡，確認後交給 DataSource 執行\n4. 沒有正式 API 或缺資料時建立草稿/導頁，不偽造完成\n5. 透過使用者回饋累積本地記憶與回答品質';
    confidence = 0.9;
  } else if (/笨|很爛|不好用|答錯|錯了|不聰明|沒用|亂回|答非所問/.test(q)) {
    answer =
      '你說得對，離線版目前不是雲端大模型，所以開放式問題會比較弱。\n\n我會把回答收斂在能可靠處理的範圍：校園資訊、課表作業、餐飲交通、健康宿舍、請假/報修/失物草稿。你可以把剛剛那題再問一次，盡量加上具體情境，我會用本地資料重新回答。';
    confidence = 0.88;
  } else if (/草稿|幫我寫|寫一封|寫信|訊息|公告|email|mail|改寫|潤飾/.test(q)) {
    const cleaned = question.replace(/幫我寫|寫一封|草稿|改寫|潤飾/g, '').trim();
    answer = `我先幫你整理一版草稿：\n\n「您好，我想說明：${cleaned || '請在這裡補上具體內容'}。若需要補充資料或調整語氣，我可以再修改。謝謝。」\n\n如果你要更精準，請補上對象、目的、日期和希望語氣。`;
    confidence = 0.82;
  }

  // ── 嘗試用模板匹配 ──
  if (!answer && templates.length > 0) {
    const matched = templates
      .filter((t) => t.tags.some((tag) => tags.includes(tag)) && t.avgQuality >= 3.5)
      .sort((a, b) => b.avgQuality - a.avgQuality || b.useCount - a.useCount);

    if (matched.length > 0) {
      const template = matched[0];
      let filled = template.skeleton;
      // 嘗試填充插槽
      for (const [slotName, slotType] of Object.entries(template.slots)) {
        let replacement = '';
        if (slotType === 'courses' && data.courses.length > 0) {
          replacement = data.courses[0].name;
        } else if (slotType === 'assignments' && data.assignments.length > 0) {
          replacement = data.assignments[0].title;
        } else if (slotType === 'menus' && data.menus.length > 0) {
          replacement = data.menus[0].name;
        } else if (slotType === 'events' && data.events.length > 0) {
          replacement = data.events[0].title;
        } else if (slotType === 'pois' && data.pois.length > 0) {
          replacement = data.pois[0].name;
        }
        filled = filled.replace(`{{${slotName}}}`, replacement || '（無資料）');
      }
      // 只在沒太多未填充插槽時使用
      const unfilled = (filled.match(/\{\{[^}]+\}\}/g) ?? []).length;
      if (unfilled <= 1) {
        answer = filled;
        confidence = Math.min(template.avgQuality / 5, 0.85);
      }
    }
  }

  // ── 知識圖譜推理 fallback ──
  if (!answer) {
    const kgResult = queryKnowledgeGraph(
      buildKnowledgeGraph({
        courses: data.courses.map((c) => ({
          ...c,
          teacher: c.teacher ?? '',
          credits: c.credits ?? 0,
        })),
        assignments: data.assignments.map((a) => ({ ...a, isLate: a.isLate ?? false })),
        announcements: data.announcements,
        events: data.events,
        menus: data.menus,
        pois: data.pois.map((p) => ({ ...p, category: p.category ?? '' })),
        memory: data.memory,
      }),
      q,
    );
    if (kgResult.relevantNodes.length > 0) {
      const grouped: Record<string, string[]> = {};
      kgResult.relevantNodes.forEach((n) => {
        const typeName =
          n.type === 'course'
            ? '課程'
            : n.type === 'assignment'
              ? '作業'
              : n.type === 'menu'
                ? '餐點'
                : n.type === 'event'
                  ? '活動'
                  : n.type === 'preference'
                    ? '偏好'
                    : '項目';
        if (!grouped[typeName]) grouped[typeName] = [];
        grouped[typeName].push(n.label);
      });
      const parts = Object.entries(grouped).map(
        ([type, items]) => `相關${type}：${items.join('、')}`,
      );
      answer = `根據你的資料，我找到以下相關內容：\n${parts.join('\n')}\n\n需要更詳細的資訊嗎？`;
      confidence = 0.6;
    }
  }

  if (!answer || confidence < 0.5) return null;
  return { answer, confidence, source: 'local' };
}

// ──────────────── 訓練 & 學習 ────────────────

/** 新增訓練對 + 自動萃取模板 */
export function addTrainingPair(
  db: LocalTrainingDB,
  question: string,
  answer: string,
  source: QAPair['source'],
  knownData?: {
    courseNames?: string[];
    assignmentTitles?: string[];
    menuNames?: string[];
    eventTitles?: string[];
    poiNames?: string[];
  },
): LocalTrainingDB {
  db = normalizeLocalTrainingDB(db);
  const tags = autoTagQuestion(question);
  const pairId = `qa_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;

  const newPair: QAPair = {
    id: pairId,
    question,
    answer,
    timestamp: new Date().toISOString(),
    quality: 3,
    followedUp: false,
    tags,
    source,
  };

  const updatedPairs = [...db.pairs, newPair].slice(-500);

  // 自動從高品質 Gemini 回答萃取模板
  let updatedTemplates = db.templates;
  if (source === 'gemini' && knownData) {
    const { skeleton, slots } = extractTemplate(question, answer, tags, knownData);
    // 只有當模板有實質插槽時才保存（表示回答有動態資料）
    if (Object.keys(slots).length > 0) {
      const newTemplate: ResponseTemplate = {
        id: `tpl_${Date.now()}`,
        tags,
        skeleton,
        slots,
        useCount: 0,
        avgQuality: 3,
        learnedFrom: pairId,
        createdAt: new Date().toISOString(),
      };
      updatedTemplates = [...db.templates, newTemplate].slice(-100);
    }
  }

  // 定期重建 IDF（每 10 筆）
  const shouldRebuildIdf = updatedPairs.length % 10 === 0;
  const idfTable = shouldRebuildIdf ? rebuildIDF(updatedPairs) : db.idfTable;

  return {
    ...db,
    pairs: updatedPairs,
    templates: updatedTemplates,
    idfTable,
    stats: {
      ...db.stats,
      totalInteractions: db.stats.totalInteractions + 1,
      apiCalls: source === 'gemini' ? db.stats.apiCalls + 1 : db.stats.apiCalls,
      localAnswers: source === 'local' ? db.stats.localAnswers + 1 : db.stats.localAnswers,
      lastTrainedAt: new Date().toISOString(),
    },
  };
}

/** 更新品質分數 + 連帶更新模板品質 */
export function updatePairQuality(
  db: LocalTrainingDB,
  pairId: string,
  delta: number,
  followedUp?: boolean,
): LocalTrainingDB {
  db = normalizeLocalTrainingDB(db);
  const updatedPairs = db.pairs.map((p) => {
    if (p.id !== pairId) return p;
    return {
      ...p,
      quality: Math.max(1, Math.min(5, p.quality + delta)),
      followedUp: followedUp ?? p.followedUp,
    };
  });

  const targetPair = updatedPairs.find((p) => p.id === pairId);

  // 更新關聯模板的品質
  let updatedTemplates = db.templates;
  if (targetPair?.templateId) {
    updatedTemplates = db.templates.map((t) => {
      if (t.id !== targetPair.templateId) return t;
      // 重新計算平均品質
      const relatedPairs = updatedPairs.filter((p) => p.templateId === t.id);
      const avg = relatedPairs.reduce((s, p) => s + p.quality, 0) / (relatedPairs.length || 1);
      return { ...t, avgQuality: avg };
    });
  }

  const avgQuality =
    updatedPairs.length > 0
      ? updatedPairs.reduce((s, p) => s + p.quality, 0) / updatedPairs.length
      : 3;

  // 重新萃取好範例和反面教材
  const goodExamples = updatedPairs
    .filter((p) => p.quality >= 4)
    .sort((a, b) => b.quality - a.quality)
    .slice(0, 20)
    .map((p) => ({ q: p.question, a: p.answer.slice(0, 200), tags: p.tags }));

  const antiPatterns = updatedPairs
    .filter((p) => p.quality <= 2)
    .slice(-10)
    .map((p) => ({
      pattern: p.question,
      correction: `此問題之前回答品質不佳（${p.answer.slice(0, 50)}...），請改進`,
    }));

  return {
    ...db,
    pairs: updatedPairs,
    templates: updatedTemplates,
    goodExamples,
    antiPatterns,
    stats: { ...db.stats, avgQuality },
  };
}

/** 用 TF-IDF 找到最相似的歷史問題（用於分析，不用於直接回答） */
export function findSimilarByTfIdf(
  db: LocalTrainingDB,
  question: string,
  topK = 5,
): Array<{ pair: QAPair; similarity: number }> {
  db = normalizeLocalTrainingDB(db);
  if (db.pairs.length === 0) return [];
  const idf = Object.keys(db.idfTable).length > 0 ? db.idfTable : rebuildIDF(db.pairs);
  const queryTokens = tokenize(question);
  const queryVec = toTfIdfVector(queryTokens, idf);

  const results: Array<{ pair: QAPair; similarity: number }> = [];
  for (const pair of db.pairs) {
    const pairTokens = tokenize(pair.question);
    const pairVec = toTfIdfVector(pairTokens, idf);
    const sim = cosineSimilarity(queryVec, pairVec);
    if (sim > 0.1) results.push({ pair, similarity: sim });
  }

  return results.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
}

/** 計算本地引擎對某問題的信心分數 */
export function getLocalConfidence(question: string, tags: string[], db: LocalTrainingDB): number {
  db = normalizeLocalTrainingDB(db);
  let confidence = 0;

  // 1. 標籤覆蓋度（是否為已知領域）
  const nonGeneralTags = tags.filter((t) => t !== 'general' && t !== 'question');
  if (nonGeneralTags.length > 0) confidence += 0.3;

  // 2. 歷史相似度（是否回答過類似問題且品質好）
  const similar = findSimilarByTfIdf(db, question, 3);
  const goodSimilar = similar.filter((s) => s.pair.quality >= 4 && s.similarity > 0.3);
  if (goodSimilar.length > 0) confidence += 0.2 * Math.min(goodSimilar.length, 3);

  // 3. 模板覆蓋度
  const matchedTemplates = db.templates.filter(
    (t) => t.tags.some((tag) => nonGeneralTags.includes(tag)) && t.avgQuality >= 3.5,
  );
  if (matchedTemplates.length > 0) confidence += 0.15;

  // 4. 互動量（越多次成功回答同領域問題，信心越高）
  const sameDomainPairs = db.pairs.filter(
    (p) => p.tags.some((t) => nonGeneralTags.includes(t)) && p.quality >= 3,
  );
  if (sameDomainPairs.length >= 5) confidence += 0.1;
  if (sameDomainPairs.length >= 15) confidence += 0.1;

  return Math.min(confidence, 1);
}

/** 匯出訓練洞察 — 注入 system prompt（可傳入當句使用者問題以挑選相關自訂技能） */
export function exportTrainingInsights(db: LocalTrainingDB, userQuery?: string | null): string {
  db = normalizeLocalTrainingDB(db);
  const lines: string[] = [];

  if (db.goodExamples.length > 0) {
    lines.push('【過去回答得很好的範例（請參考風格和深度）】');
    db.goodExamples.slice(0, 8).forEach((ex, i) => {
      lines.push(`${i + 1}. Q:「${ex.q}」→ A:「${ex.a}」`);
    });
  }

  if (db.antiPatterns.length > 0) {
    lines.push('');
    lines.push('【過去回答不好的模式（請避免）】');
    db.antiPatterns.slice(0, 5).forEach((ap, i) => {
      lines.push(`${i + 1}. 問題：「${ap.pattern}」— ${ap.correction}`);
    });
  }

  if (db.pairs.length >= 10) {
    const tagFreq: Record<string, number> = {};
    db.pairs.slice(-50).forEach((p) =>
      p.tags.forEach((t) => {
        tagFreq[t] = (tagFreq[t] || 0) + 1;
      }),
    );
    const topTags = Object.entries(tagFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    if (topTags.length > 0) {
      lines.push('');
      lines.push(`【用戶最常問的主題】${topTags.map(([t, c]) => `${t}(${c}次)`).join('、')}`);
    }
  }

  // 本地 vs API 統計
  if (db.stats.totalInteractions > 0) {
    const localRate = Math.round((db.stats.localAnswers / db.stats.totalInteractions) * 100);
    lines.push('');
    lines.push(`【學習進度】共 ${db.stats.totalInteractions} 次對話，本地回答率 ${localRate}%`);
  }

  const q = typeof userQuery === 'string' ? userQuery.trim() : '';
  if (q && db.learnedSkills.length > 0) {
    const picked = selectRelevantLearnedSkills(q, db.learnedSkills, 5);
    if (picked.length > 0) {
      lines.push('');
      lines.push(formatLearnedSkillsBlock(picked));
    }
  }

  return lines.join('\n');
}

/** 訓練資料的 AsyncStorage key */
export function getTrainingDBStorageKey(userId: string): string {
  return `ai-training-db::${userId}`;
}
