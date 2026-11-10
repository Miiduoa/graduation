/**
 * Destinations shared by the assistant entry points. These describe where a
 * student can continue a task; they do not grant access or perform the task.
 * The destination keeps its own account, school and role checks.
 */
export type AssistantServiceCategory = 'study' | 'campus' | 'life' | 'community' | 'account';
export type AssistantServiceAccess = 'public' | 'personal' | 'school' | 'merchant' | 'admin';
export type AssistantServiceAudience = 'school' | 'platform';

type ServiceDefinition = {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly href: string;
  readonly category: AssistantServiceCategory;
  /** Descriptive metadata, not an authorization decision. */
  readonly access: AssistantServiceAccess;
  /** A school navigator screen only; the public navigator has a separate map. */
  readonly mobileRoute?: string;
};

const services = [
  {
    id: 'today', label: '今天', href: '/today', category: 'study', access: 'personal',
    summary: '查看今天的課程、待辦與日程。', mobileRoute: 'TodayHome',
  },
  {
    id: 'timetable', label: '我的課表', href: '/timetable', category: 'study', access: 'personal',
    summary: '查看或核對自己的課表與教室。', mobileRoute: 'PersonalTimetable',
  },
  {
    id: 'classroom', label: '課程與作業', href: '/classroom', category: 'study', access: 'personal',
    summary: '從已加入的課班查看教材、作業、測驗與繳交紀錄。', mobileRoute: 'CoursesHome',
  },
  {
    id: 'material-bookmarks', label: '教材收藏', href: '/classroom/material-bookmarks', category: 'study', access: 'personal',
    summary: '使用平台帳號查看此瀏覽器保存的教材收藏，開啟時重新核對課程與教材權限。',
  },
  {
    id: 'calendar', label: '個人行事曆', href: '/calendar', category: 'study', access: 'personal',
    summary: '查看個人活動，核對時間後再新增或調整行程。', mobileRoute: 'PersonalCalendar',
  },
  {
    id: 'grades', label: '成績', href: '/grades?tab=semester', category: 'study', access: 'school',
    summary: '查看已開通校方來源的學期成績，保留學校回傳的原始結果。', mobileRoute: 'Grades',
  },
  {
    id: 'grade-feedback', label: '成績回饋', href: '/grades?tab=feedback', category: 'study', access: 'personal',
    summary: '查看本人課程已公布的作業、測驗評分與老師評語，以及等待公布或缺交狀態。',
  },
  {
    id: 'credits', label: '學分規劃', href: '/credit-planner', category: 'study', access: 'personal',
    summary: '整理個人修課與學分規劃，正式採計仍需校方確認。', mobileRoute: 'CreditAuditStack',
  },
  {
    id: 'import', label: '匯入我的資料', href: '/import', category: 'study', access: 'personal',
    summary: '匯入並核對課表、成績或活動，再確認保存。', mobileRoute: 'PersonalImport',
  },
  {
    id: 'school-courses', label: '校方課程', href: '/school-courses', category: 'study', access: 'school',
    summary: '連線已開通的玩課雲（WOW Class）校方來源，查看本人課程、教材與作業入口。',
  },
  {
    id: 'school-lms', label: '玩課雲作業', href: '/school-lms', category: 'study', access: 'school',
    summary: '從已啟用的校方連線跨課程查看截止、已交狀態、公告與教材；未啟用時可先用課程與作業。',
  },
  {
    id: 'attendance', label: '點名與出席', href: '/classroom', category: 'study', access: 'personal',
    summary: '先選擇課程，再進入該課的點名與出席紀錄。',
  },
  {
    id: 'announcements', label: '校園公告', href: '/announcements', category: 'campus', access: 'public',
    summary: '查看所選校園的公告與原文來源。', mobileRoute: '公告總覽',
  },
  {
    id: 'events', label: '校園活動', href: '/events', category: 'campus', access: 'public',
    summary: '查看公開活動；報名資格與送出內容另行確認。', mobileRoute: '活動總覽',
  },
  {
    id: 'library', label: '圖書館', href: '/library', category: 'campus', access: 'public',
    summary: '查看館藏查詢與校方圖書館服務入口。', mobileRoute: 'Library',
  },
  {
    id: 'map', label: '校園地圖', href: '/map', category: 'campus', access: 'public',
    summary: '查看所選校園的地點與路線入口。', mobileRoute: 'MapV2',
  },
  {
    id: 'bus', label: '公車', href: '/bus', category: 'campus', access: 'public',
    summary: '查看站點與到站資訊，以當次來源回覆為準。', mobileRoute: 'BusV2',
  },
  {
    id: 'school-info', label: '學校資訊', href: '/school-info', category: 'campus', access: 'public',
    summary: '查看所選學校的地址、聯絡方式與官方網站。', mobileRoute: 'SchoolInfo',
  },
  {
    id: 'cafeteria', label: '校園餐廳', href: '/cafeteria', category: 'life', access: 'public',
    summary: '查看餐廳與菜單，點餐依店家開放情形使用。', mobileRoute: '餐廳總覽',
  },
  {
    id: 'food', label: '點餐與取餐', href: '/food', category: 'life', access: 'personal',
    summary: '使用平台帳號查看開放的餐點、訂單與取餐憑證；下單前仍需核對並確認。',
  },
  {
    id: 'orders', label: '我的訂單', href: '/orders', category: 'life', access: 'personal',
    summary: '查看自己的訂單、明細與平台回覆的處理狀態。', mobileRoute: 'StudentOrders',
  },
  {
    id: 'app-orders', label: 'App 餐廳訂單', href: '/orders', category: 'life', access: 'school',
    summary: '使用學校帳號查看在 App 餐廳建立的訂單、取餐號碼與店家處理進度。', mobileRoute: 'StudentOrders',
  },
  {
    id: 'dormitory', label: '宿舍服務', href: '/dormitory', category: 'life', access: 'public',
    summary: '查看校方住宿管道，整理個人報修備忘。', mobileRoute: 'Dormitory',
  },
  {
    id: 'leave', label: '請假', href: '/leave', category: 'life', access: 'school',
    summary: '從課表選課、填寫假單並追蹤站內核閱結果；送出需自行確認，正式核准依校方規定。',
  },
  {
    id: 'leave-review', label: '請假核閱', href: '/leave/review', category: 'study', access: 'school',
    summary: '需授課教師資格，查看本人獲指派課程的請假與核閱紀錄；核閱在頁面確認。',
  },
  {
    id: 'appeals', label: '課程申訴', href: '/appeals', category: 'study', access: 'school',
    summary: '使用學校帳號查看自己的課程申訴與處理進度，提出或撤回前需核對內容。',
  },
  {
    id: 'teacher', label: '課務申訴審核', href: '/teacher', category: 'study', access: 'school',
    summary: '需該校教師資格，依已指派課程查看學生申訴；審核結果需於頁面確認。',
  },
  {
    id: 'lost-found', label: '失物招領', href: '/lost-found', category: 'life', access: 'personal',
    summary: '查看失物招領，發布與聯絡依登入資格使用。', mobileRoute: 'LostFound',
  },
  {
    id: 'public-social', label: '跨校公開交流', href: '/social', category: 'community', access: 'personal',
    summary: '使用 Google 帳號閱讀公開貼文，參與開放看板。',
  },
  {
    id: 'community', label: '校園社群', href: '/community', category: 'community', access: 'personal',
    summary: '查看校園動態與看板，發布內容需自行確認。', mobileRoute: 'CampusSocialScreen',
  },
  {
    id: 'messages', label: '私人訊息', href: '/dms', category: 'community', access: 'personal',
    summary: '查看自己的私人對話；訊息送出前仍須確認收件人與內容。', mobileRoute: 'Dms',
  },
  {
    id: 'notifications', label: '通知', href: '/messages', category: 'community', access: 'personal',
    summary: '查看自己的通知與原事件入口。', mobileRoute: 'Notifications',
  },
  {
    id: 'groups', label: '群組', href: '/groups', category: 'community', access: 'personal',
    summary: '查看課程與興趣群組，依成員資格進入。', mobileRoute: 'Groups',
  },
  {
    id: 'friends', label: '好友', href: '/friends', category: 'community', access: 'personal',
    summary: '尋找同學，查看好友與邀請。', mobileRoute: 'FriendsManage',
  },
  {
    id: 'clubs', label: '社團', href: '/clubs', category: 'community', access: 'personal',
    summary: '查看社團目錄與已加入的社團。',
  },
  {
    id: 'account', label: '我的帳號', href: '/profile', category: 'account', access: 'personal',
    summary: '查看登入帳號、個人資料與學校資格。', mobileRoute: 'MeHome',
  },
  {
    id: 'school-account', label: '學校資格', href: '/classroom/account', category: 'account', access: 'personal',
    summary: '使用平台帳號申請與查看各校資格及審核結果；資格由學校或平台依流程確認。',
  },
  {
    id: 'account-deletion', label: '刪除帳號說明', href: '/account-deletion', category: 'account', access: 'public',
    summary: '了解 nuni 帳號的刪除流程、資料保留範圍與進度查詢；實際刪除需另外提出及確認。',
  },
  {
    id: 'settings', label: '設定', href: '/settings', category: 'account', access: 'personal',
    summary: '調整個人偏好與帳號設定。', mobileRoute: 'Settings',
  },
  {
    id: 'assistant-permissions', label: '助理權限', href: '/settings?section=assistant', category: 'account', access: 'personal',
    summary: '查看可授權給助理的操作，變更設定由你確認。', mobileRoute: 'AssistantPermissions',
  },
  {
    id: 'assistant', label: '校園助理', href: '/ai-assistant', category: 'account', access: 'personal',
    summary: '查詢可用的課務資料與校園服務，排課可從課表的「幫我安排」進行。',
  },
  {
    id: 'merchant', label: '店家工作區', href: '/merchant', category: 'account', access: 'merchant',
    summary: '使用平台帳號查看進駐申請與審核進度；門市管理需取得該店授權。',
  },
  {
    id: 'admin', label: '平台管理', href: '/admin', category: 'account', access: 'admin',
    summary: '進入平台管理工作區，頁面會重新確認管理員資格。',
  },
  {
    id: 'support', label: '使用說明與支援', href: '/support', category: 'account', access: 'public',
    summary: '查看服務範圍、帳號與隱私問題的聯絡方式。', mobileRoute: 'Help',
  },
] as const satisfies readonly ServiceDefinition[];

export type AssistantServiceId = (typeof services)[number]['id'];
export type AssistantService = Omit<ServiceDefinition, 'id'> & { readonly id: AssistantServiceId };

export const ASSISTANT_SERVICES: readonly AssistantService[] = Object.freeze(
  services.map((service) => Object.freeze(service)),
);

export const ASSISTANT_SERVICE_CATEGORY_LABELS: Readonly<Record<AssistantServiceCategory, string>> = {
  study: '課程與日程', campus: '校園資訊', life: '生活服務', community: '交流與訊息', account: '帳號與工作區',
};

const servicesById = new Map<string, AssistantService>(
  ASSISTANT_SERVICES.map((service) => [service.id, service]),
);

export function getAssistantService(id: unknown): AssistantService | null {
  return typeof id === 'string' ? servicesById.get(id) ?? null : null;
}

/**
 * Re-resolve the ID so a caller or a model cannot supply its own destination.
 * The audience selects an existing workspace, never an authorization grant.
 */
export function assistantServiceHref(
  serviceOrId: unknown,
  schoolId?: unknown,
  audience?: AssistantServiceAudience,
): string | null {
  const id = typeof serviceOrId === 'string' ? serviceOrId
    : serviceOrId && typeof serviceOrId === 'object' && !Array.isArray(serviceOrId)
      ? (serviceOrId as { id?: unknown }).id : null;
  const service = getAssistantService(id);
  if (!service) return null;
  if (audience !== undefined && audience !== 'school' && audience !== 'platform') return null;
  // Only unqualified orders follow the current account workspace. Explicit
  // app-orders always keeps /orders and its separate school-account boundary.
  const href = audience === 'platform' && service.id === 'orders' ? '/food' : service.href;
  if (schoolId === undefined || schoolId === null || schoolId === '') return href;
  if (typeof schoolId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(schoolId)) return null;
  const hashAt = href.indexOf('#');
  const destination = hashAt < 0 ? href : href.slice(0, hashAt);
  const fragment = hashAt < 0 ? '' : href.slice(hashAt);
  const queryAt = destination.indexOf('?');
  const path = queryAt < 0 ? destination : destination.slice(0, queryAt);
  const query = new URLSearchParams(queryAt < 0 ? '' : destination.slice(queryAt + 1));
  query.set('schoolId', schoolId);
  return `${path}?${query.toString()}${fragment}`;
}

const aliases: Readonly<Record<AssistantServiceId, readonly string[]>> = {
  today: ['今天', '今日', '今天首頁', '今日首頁', '首頁', 'today', 'home'],
  timetable: ['課表', '我的課表', '個人課表', 'timetable', 'my timetable', 'schedule'],
  classroom: ['課程', '我的課程', '課程與作業', '課程作業', '作業', '教材', '測驗', 'classroom', 'courses', 'assignments', 'quizzes', 'materials'],
  'material-bookmarks': ['教材收藏', '我的教材收藏', '課程教材收藏', '教材書籤', '收藏教材', 'material bookmarks', 'saved materials'],
  calendar: ['行事曆', '日曆', '我的行事曆', '個人行事曆', 'calendar', 'my calendar'],
  grades: ['成績', '我的成績', '成績紀錄', '成績單', '學期成績', '校方成績', 'grades', 'my grades', 'transcript', 'semester grades'],
  'grade-feedback': ['成績回饋', '課程成績回饋', '作業回饋', '測驗回饋', '老師評語', 'grade feedback', 'assignment feedback'],
  credits: ['學分', '我的學分', '學分規劃', '我的學分規劃', '修課規劃', '畢業學分', 'credits', 'credit planner'],
  import: ['匯入', '資料匯入', '個人資料匯入', '匯入我的資料', '匯入中心', 'import', 'data import'],
  'school-courses': ['校方課程', '校務課程', '學校課程', '玩課雲課程', 'TronClass', 'WOW Class', 'school courses'],
  'school-lms': ['玩課雲作業', '玩課雲作業與教材', '校方作業與教材', 'WOW Class 作業', 'TronClass 作業', 'school lms'],
  attendance: ['點名', '出席', '點名與出席', '出席紀錄', '點名紀錄', 'attendance'],
  announcements: ['公告', '校園公告', '學校公告', '公告總覽', 'announcements'],
  events: ['活動', '校園活動', '活動總覽', 'events', 'campus events'],
  library: ['圖書館', '圖書館服務', '館藏', '館藏查詢', 'library', 'library services'],
  map: ['地圖', '校園地圖', 'map', 'campus map'],
  bus: ['公車', '校車', '公車資訊', '公車動態', '交通資訊', 'bus', 'transit'],
  'school-info': ['學校資訊', '校園資訊', '學校聯絡資訊', 'school info'],
  cafeteria: ['餐廳', '校園餐廳', '學餐', '餐廳總覽', '菜單', 'cafeteria', 'dining', 'restaurants'],
  food: ['點餐與取餐', '點餐', '取餐', '取餐憑證', '餐點訂購', 'food', 'food orders', 'food pickup'],
  orders: ['訂單', '我的訂單', '訂餐紀錄', '餐廳訂單', 'orders', 'my orders'],
  'app-orders': ['App 餐廳訂單', 'App 訂單', '我的 App 訂單', '我的 App 餐廳訂單', 'App 訂餐紀錄', '學校帳號餐廳訂單', 'app orders', 'my app orders', 'app restaurant orders'],
  dormitory: ['宿舍', '宿舍服務', '住宿服務', '報修備忘', '宿舍報修', 'dormitory', 'dorm'],
  leave: ['請假', '請假申請', '請假紀錄', 'leave', 'leave requests'],
  'leave-review': ['請假核閱', '請假審核', '教師請假核閱', 'leave review'],
  appeals: ['課程申訴', '我的申訴', '課務申訴', 'appeals', 'course appeals'],
  teacher: ['課務申訴審核', '申訴審核', '教師申訴審核', '老師工作台', 'teacher review'],
  'lost-found': ['失物招領', '遺失物', 'lost and found', 'lost-found'],
  'public-social': ['跨校公開交流', '公開交流', '跨校交流', '公開看板', 'public social', 'public exchange'],
  community: ['社群', '校園社群', '校園交流', '校園動態', '動態牆', '看板', 'community', 'feed'],
  messages: ['私訊', '私人訊息', '私人對話', '訊息', 'messages', 'direct messages', 'private messages', 'dms'],
  notifications: ['通知', '我的通知', '通知中心', 'notifications'],
  groups: ['群組', '我的群組', '課程群組', '課程與群組', 'groups'],
  friends: ['好友', '我的好友', '好友邀請', '找人', 'friends'],
  clubs: ['社團', '我的社團', '社團目錄', '社團活動', 'clubs'],
  account: ['帳號', '我的帳號', '個人資料', '個人檔案', 'account', 'profile'],
  'school-account': ['學校資格', '我的學校資格', '學校資格申請', '學籍驗證', 'school qualification', 'school account'],
  'account-deletion': ['刪除帳號', '刪帳', '帳號刪除', '刪除帳號說明', '刪帳說明', '帳號刪除說明', 'account deletion', 'account deletion guide'],
  settings: ['設定', '個人設定', '帳號設定', 'settings'],
  'assistant-permissions': ['助理權限', 'AI 助理權限', '助理權限設定', 'assistant permissions'],
  assistant: ['校園助理', 'AI 助理', '人工智慧助理', 'assistant', 'AI assistant'],
  merchant: ['店家工作區', '店家後台', '門市工作區', '商家工作區', '店家合作', 'merchant'],
  admin: ['平台管理', '平台管理後台', '平台管理員工作區', '管理員入口', 'admin'],
  support: ['使用說明', '支援', '服務支援', '使用說明與支援', 'support'],
};

function aliasKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

const servicesByAlias = new Map<string, AssistantService>();
for (const service of ASSISTANT_SERVICES) {
  for (const alias of [service.label, ...aliases[service.id]]) {
    const key = aliasKey(alias);
    const existing = servicesByAlias.get(key);
    if (existing && existing.id !== service.id)
      throw new Error(`Conflicting assistant service alias: ${alias}`);
    servicesByAlias.set(key, service);
  }
}

export type AssistantServiceIntent =
  | { readonly kind: 'catalog' }
  | { readonly kind: 'open'; readonly service: AssistantService };

const DISCOVERY = /^(?:(?:請|麻煩)(?:你)?\s*)?(?:(?:你(?:能|會|可以)(?:幫我)?(?:做什麼|做哪些事))|(?:你(?:有|提供)(?:哪些|什麼)功能)|(?:(?:這裡|目前)?(?:有|提供)(?:哪些|什麼)(?:功能|服務))|(?:(?:列出|顯示|打開|開啟)(?:全部|所有|可用|目前可用)?(?:功能|服務)(?:清單|目錄)?))$/u;
const ENGLISH_DISCOVERY = /^(?:help|what can you do|(?:please )?(?:list|show|open) (?:all |available )?(?:services|features)(?: list)?)$/i;
const OPEN_COMMAND = /^(?:(?:請問|請|麻煩)(?:你)?\s*)?(?:(?:可以|能不能|可不可以)\s*)?(?:(?:幫我|替我|我要|我想)\s*)?(打開|開啟|進入|前往|帶我去|帶我到|切換到|跳到)\s*(.+)$/u;
const ENGLISH_OPEN_COMMAND = /^(?:please )?(?:(?:can|could|would) you )?(open|go to|take me to) (.+)$/i;
const PHYSICAL_DESTINATIONS = new Set<AssistantServiceId>(['library', 'cafeteria', 'dormitory']);

/**
 * This only recognizes whole, direct requests for a screen or the service
 * list. Data questions, mutations, quoted instructions and multiple targets
 * stay with the existing task handlers instead of becoming a page shortcut.
 */
export function resolveAssistantServiceIntent(question: unknown): AssistantServiceIntent | null {
  if (typeof question !== 'string' || question.length > 160 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(question)) return null;
  const text = question.normalize('NFKC').trim().replace(/[?!.。]+$/u, '').trim();
  if (!text) return null;
  if (DISCOVERY.test(text) || ENGLISH_DISCOVERY.test(text)) return { kind: 'catalog' };
  const commandText = text.replace(/(?:,\s*)?(?:好嗎|可以嗎|嗎|吧|謝謝)$/u, '').trim();
  const command = OPEN_COMMAND.exec(commandText) || ENGLISH_OPEN_COMMAND.exec(commandText);
  if (!command) return null;
  const verb = command[1].toLowerCase();
  const target = command[2].trim();
  const explicitScreen = /(?:頁面|畫面|入口|頁)$|\s(?:page|screen)$/iu.test(target);
  const name = target.replace(/(?:頁面|畫面|入口|頁)$|\s(?:page|screen)$/iu, '').trim();
  // Resolve the complete qualified target before any other task handler:
  // "App 餐廳訂單" and "教材收藏" cannot collapse into orders or classroom.
  const service = servicesByAlias.get(aliasKey(target)) ?? servicesByAlias.get(aliasKey(name));
  if (!service) return null;
  // A deletion request remains with its existing flow. Only opening its
  // information page is navigation; it never authorizes account deletion.
  if (service.id === 'account-deletion' && !explicitScreen && !/(?:說明|guide)$/i.test(name)) return null;
  // "帶我去圖書館" is a route request, not a request for the library screen.
  if (PHYSICAL_DESTINATIONS.has(service.id) &&
      /^(?:前往|帶我去|帶我到|go to|take me to)$/.test(verb) &&
      !explicitScreen && !/(?:服務|services)$/i.test(name)) return null;
  // "開啟通知" can mean turning notifications on. Keep that with settings.
  if (verb === '開啟' && aliasKey(name) === '通知' && !explicitScreen) return null;
  return { kind: 'open', service };
}
