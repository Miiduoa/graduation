import { ACADEMIC_LMS_SECTIONS, ACADEMIC_SECTIONS } from './academicSections';
import { isWebOnlineOrderingEnabled, ONLINE_ORDERING_OFF_TEXT } from './onlineOrdering';

export const SERVICE_CATEGORIES = [
  { id: 'study', label: '學習與課務', description: '查課表、整理學分，接續課堂上的事。' },
  { id: 'campus', label: '校園生活', description: '找教室、看公車，安排課堂以外的時間。' },
  { id: 'connect', label: '消息與交流', description: '看看校園近況，接收通知與朋友的訊息。' },
  { id: 'account', label: '帳號與協助', description: '管理個人資料，找到需要的協助。' },
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number]['id'];

export const SERVICE_ACCESS = {
  public: '可直接瀏覽',
  device: '可直接使用，資料保存在這台裝置',
  platform: 'Google 帳號',
  school: '學校帳號',
  account: '依帳號查看',
  operator: '需平台管理權限',
} as const;

const academicLabel = (path: (typeof ACADEMIC_SECTIONS)[number]['path']) =>
  ACADEMIC_SECTIONS.find((section) => section.path === path)!.label;

const lmsLabel = (path: (typeof ACADEMIC_LMS_SECTIONS)[number]['path']) =>
  ACADEMIC_LMS_SECTIONS.find((section) => section.path === path)!.label;

export const CAMPUS_SERVICES = [
  {
    name: '數位學生證',
    text: '開啟學生證卡面、出示學號與查找校方證件',
    href: '/student-card',
    access: 'account',
    keywords: '學生證 數位證件 證件 學號 student id card',
    category: 'account',
  },
  {
    name: academicLabel('/calendar'),
    text: '新增、編輯與查看自己的活動、考試與行程',
    href: '/calendar',
    access: 'device',
    keywords: '行事曆 活動 考試 日期 calendar 個人行事曆',
    category: 'study',
  },
  {
    name: '匯入我的資料',
    text: '從截圖、文字或檔案整理課表、成績與行程',
    href: '/import',
    access: 'public',
    keywords: '截圖 匯入 課表 成績 學分 活動 考試 行事曆 import',
    category: 'study',
  },
  {
    name: academicLabel('/timetable'),
    text: '查看、編輯與匯入本學期課表',
    href: '/timetable',
    access: 'public',
    keywords: '上課 行事曆 schedule 空堂 課務',
    category: 'study',
  },
  {
    name: '請假',
    text: '從課表選課、填寫假單、追蹤每門課的站內核閱結果',
    href: '/leave',
    access: 'school',
    keywords: '請假 假單 病假 事假 心理假 生理假 核假 缺課 absence leave',
    category: 'study',
  },
  {
    name: '請假核閱',
    text: '授課教師依指派課程核閱請假，查看待辦與已處理紀錄',
    href: '/leave/review',
    access: 'school',
    keywords: '老師 教師 請假 核閱 審核 管理 approve',
    category: 'study',
  },
  {
    name: '課程申訴',
    text: '送出課程申訴，看老師處理到哪',
    href: '/appeals',
    access: 'school',
    keywords: '申訴 出缺席 成績 appeal',
    category: 'study',
  },
  {
    name: '課務申訴審核',
    text: '老師看自己課的學生申訴，核准或不核准；授課請到課程與作業',
    href: '/teacher',
    access: 'school',
    keywords: '老師 教師 申訴 核准 teacher 老師工作台 課務申訴審核',
    category: 'study',
  },
  {
    name: academicLabel('/grades'),
    text: '查詢學校提供的學期成績；課堂評分回饋見次級入口',
    href: '/grades?tab=semester',
    access: 'school',
    keywords: '分數 學期 grade',
    category: 'study',
  },
  {
    name: '成績回饋',
    text: '一頁看各門課已評分、等待公布與缺交，點進去看老師評語和自己交的內容',
    href: '/grades?tab=feedback',
    access: 'platform',
    keywords: '成績 回饋 分數 評分 缺交 作業 測驗 評語 grade feedback 課業成績與回饋',
    category: 'study',
    parentHref: '/grades?tab=semester',
  },
  {
    name: academicLabel('/classroom'),
    text: '閱讀教材、繳交作業、回答測驗，查看老師回饋；玩課雲與課程群組見次級入口',
    href: '/classroom',
    access: 'platform',
    keywords: 'nuni 課程 教材 作業 測驗 繳交 作答 老師 回饋 邀請 classroom 課程空間 課務',
    category: 'study',
  },
  {
    name: '教材收藏',
    text: '開啟這台裝置上以目前帳號收藏的課程教材',
    href: '/classroom/material-bookmarks',
    access: 'platform',
    keywords: '書籤 教材收藏 我的收藏 此裝置收藏 bookmark saved',
    category: 'study',
    parentHref: '/classroom',
  },
  {
    name: lmsLabel('/school-courses'),
    text: '開啟所選學校的學習平臺，查看課堂、教材與作業',
    href: '/school-courses',
    access: 'public',
    keywords: 'WOW Class TronClass LMS 玩課雲課程 NTU COOL eLearn eeclass Moodle iLearning E3 iLearn 課程 教材 作業 老師',
    category: 'study',
    parentHref: '/classroom',
  },
  {
    name: lmsLabel('/school-lms'),
    text: '前往校方平臺查看作業、公告與教材；已連線的玩課雲課堂可直接查看截止時間',
    href: '/school-lms',
    access: 'public',
    keywords: '玩課雲作業 作業 截止 教材 公告 WOW Class TronClass 作業與教材',
    category: 'study',
    parentHref: '/classroom',
  },
  {
    name: academicLabel('/credit-planner'),
    text: '依修課紀錄與自訂目標整理學分',
    href: '/credit-planner',
    access: 'school',
    keywords: '畢業 學分 credit',
    category: 'study',
  },
  {
    name: '課程與群組',
    text: '開啟學校帳號的課程與群組，或使用邀請碼加入',
    href: '/groups',
    access: 'school',
    keywords: '作業 教材 教師 點名 course 群組',
    category: 'study',
    parentHref: '/classroom',
  },
  {
    name: '公告',
    text: '查詢校園公開公告',
    href: '/announcements',
    access: 'public',
    keywords: '消息 news',
    category: 'connect',
  },
  {
    name: '校園活動',
    text: '瀏覽校園公開活動與講座資訊',
    href: '/events',
    access: 'public',
    keywords: '活動 報名 講座 event',
    category: 'campus',
  },
  {
    name: '社團活動',
    text: '查看已加入的社團',
    href: '/clubs',
    access: 'school',
    keywords: '社團 club',
    category: 'campus',
  },
  {
    name: '通知',
    text: '查看本人收到的服務通知',
    href: '/messages',
    access: 'school',
    keywords: '提醒 notification',
    category: 'connect',
  },
  {
    name: '訊息',
    text: '接續已建立的對話',
    href: '/dms',
    access: 'school',
    keywords: '聊天 message 私訊',
    category: 'connect',
  },
  {
    name: '跨校公開交流',
    text: '使用 Google 帳號閱讀公開貼文，參與開放看板',
    href: '/social',
    access: 'platform',
    keywords: 'Google 公開 跨校 貼文 社群 看板 social community',
    category: 'connect',
  },
  {
    name: '校園交流',
    text: '閱讀與分享校園話題',
    href: '/community',
    access: 'school',
    keywords: '貼文 社群 community',
    category: 'connect',
  },
  {
    name: '找人',
    text: '用找人代號加好友；對方開放分享後可查看課表',
    href: '/friends',
    access: 'school',
    keywords: '好友 朋友 空堂 friend',
    category: 'connect',
  },
  {
    name: '校園地圖',
    text: '查詢校內地點',
    href: '/map',
    access: 'public',
    keywords: '大樓 教室 位置 map',
    category: 'campus',
  },
  {
    name: '公車',
    text: '查詢路線與站牌',
    href: '/bus',
    access: 'public',
    keywords: '交通 bus',
    category: 'campus',
  },
  {
    name: '點餐與取餐',
    text: '選餐點、查訂單、出示取餐憑證；餐廳菜單見次級入口',
    href: '/food',
    access: 'platform',
    keywords: '點餐 訂單 取餐 外帶 food order pickup 餐廳 午餐 晚餐 餐點',
    category: 'campus',
  },
  {
    name: '餐廳',
    text: '查看餐廳與菜單資料',
    href: '/cafeteria',
    access: 'public',
    keywords: '午餐 晚餐 餐點 food 食堂',
    category: 'campus',
    parentHref: '/food',
  },
  {
    name: 'App 餐廳訂單',
    text: '查看在 App 餐廳下的訂單、取餐號碼與店家接單進度',
    href: '/orders',
    access: 'school',
    keywords: '我的訂單 餐廳訂單 訂單紀錄 取餐號碼 orders',
    category: 'campus',
    parentHref: '/food',
  },
  {
    name: '宿舍',
    text: '自主管理宿舍備忘、設備問題、入住退宿清單與洗衣計時',
    href: '/dormitory',
    access: 'device',
    keywords: '宿舍 住宿 寢室 房間 床位 報修 維修 入住 退宿 洗衣 dormitory laundry',
    category: 'campus',
  },
  {
    name: '失物招領',
    text: '用 Google 帳號查看、刊登與管理失物',
    href: '/lost-found',
    access: 'platform',
    keywords: '失物 招領 遺失 拾獲 Google lost found',
    category: 'campus',
  },
  {
    name: '店家合作',
    text: '申請進駐，查看審核進度與授權門市',
    href: '/merchant',
    access: 'platform',
    keywords: '店家 商家 進駐 申請 審核 merchant',
    category: 'account',
  },
  {
    name: '圖書館',
    text: '搜尋館藏，前往本人借閱帳號',
    href: '/library',
    access: 'public',
    keywords: '書籍 借書 續借 library',
    category: 'campus',
  },
  {
    name: '職涯',
    text: '查看職涯截止日、校方公告與附近職缺來源',
    href: '/career',
    access: 'public',
    keywords: '職涯 校內工讀 實習 學分 校園徵才 就業 工作 career internship',
    category: 'campus',
  },
  {
    name: '學校資訊',
    text: '查看官方聯絡電話、網站與名錄地址',
    href: '/school-info',
    access: 'public',
    keywords: '總機 官網 地址 名錄 聯絡 school info contact',
    category: 'campus',
  },
  {
    name: '校園助理',
    text: '查詢課務與校園服務；排課請用課表裡的幫我安排',
    href: '/ai-assistant',
    access: 'account',
    keywords: '問答 安排 課表 assistant',
    category: 'account',
  },
  {
    name: '支援',
    text: '目前提供的協助範圍與連絡信箱',
    href: '/support',
    access: 'public',
    keywords: '客服 幫助 support',
    category: 'account',
  },
  {
    name: '刪除帳號',
    text: '了解會刪掉與會留下的資料',
    href: '/account-deletion',
    access: 'account',
    keywords: '刪帳 隱私 deletion',
    category: 'account',
  },
  {
    name: '個人資料',
    text: '查看帳號資料與學校連線',
    href: '/profile',
    access: 'account',
    keywords: '姓名 學號 科系 profile 個人資料',
    category: 'account',
  },
  {
    name: '設定',
    text: '調整外觀、通知與個人資料',
    href: '/settings',
    access: 'public',
    keywords: '主題 帳號 個人資料 setting',
    category: 'account',
  },
  {
    name: '學校資格',
    text: '申請與查看各校資格，確認審核結果',
    href: '/classroom/account',
    access: 'platform',
    keywords: '多校 學籍 驗證 信箱 審核 學校 資格',
    category: 'account',
  },
  {
    name: '管理員入口',
    text: '平台管理員處理學校接入、公開看板與跨校檢舉',
    href: '/admin',
    access: 'operator',
    keywords: '管理員 後台 admin 審核 檢舉 看板',
    category: 'account',
  },
] satisfies readonly {
  name: string;
  text: string;
  href: string;
  keywords: string;
  category: ServiceCategory;
  access: keyof typeof SERVICE_ACCESS;
  parentHref?: string;
}[];

export type CampusService = (typeof CAMPUS_SERVICES)[number];

function isSecondary(service: CampusService) {
  return typeof service.parentHref === 'string' && service.parentHref.length > 0;
}

/** 含主入口與次級選項（供路由判斷、快捷意圖查找）。 */
export function flattenCampusServices(schoolLmsEnabled = false) {
  return CAMPUS_SERVICES.filter((service) =>
    (schoolLmsEnabled || service.href !== '/school-lms') &&
    (service.href !== '/orders' || isWebOnlineOrderingEnabled()),
  );
}

export function presentCampusService<T extends { href: string; text: string; name?: string }>(
  service: T,
): T & { note?: string } {
  if (service.href === '/food' && !isWebOnlineOrderingEnabled()) {
    // name 維持「點餐與取餐」；關閉狀態只進次要說明（text／note），不縫進標籤。
    return { ...service, text: ONLINE_ORDERING_OFF_TEXT, note: ONLINE_ORDERING_OFF_TEXT };
  }
  return service;
}

export function visibleCampusServices(schoolLmsEnabled = false) {
  return flattenCampusServices(schoolLmsEnabled);
}

/** 目錄預設只列主入口；有搜尋詞時才展開命中的次級選項。 */
export function directoryCampusServices(schoolLmsEnabled = false) {
  return flattenCampusServices(schoolLmsEnabled).filter((service) => !isSecondary(service));
}

/** 主入口底下的次級服務（瀏覽目錄時展開用）。 */
export function secondaryCampusServices(parentHref: string, schoolLmsEnabled = false) {
  return flattenCampusServices(schoolLmsEnabled)
    .filter((service) => isSecondary(service) && service.parentHref === parentHref)
    .map(presentCampusService);
}

export function readCampusServiceFilters(params: URLSearchParams) {
  const category = params.get('category');
  return {
    query: (params.get('q') ?? '').slice(0, 100),
    category: SERVICE_CATEGORIES.some((item) => item.id === category)
      ? (category as ServiceCategory)
      : ('all' as const),
  };
}

export function writeCampusServiceFilters(
  params: URLSearchParams,
  query: string,
  category: ServiceCategory | 'all',
) {
  if (query) params.set('q', query);
  else params.delete('q');
  if (category === 'all') params.delete('category');
  else params.set('category', category);
}

export function countCampusSearchResults(
  matches: readonly CampusService[],
  browsing: boolean,
  schoolLmsEnabled: boolean,
) {
  if (!browsing) return matches.length;
  return matches.reduce(
    (count, service) => count + 1 + secondaryCampusServices(service.href, schoolLmsEnabled).length,
    0,
  );
}

export function searchCampusServices(
  query: string,
  category: ServiceCategory | 'all' = 'all',
  schoolLmsEnabled = false,
) {
  const terms = query
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-TW')
    .split(/\s+/)
    .filter(Boolean);
  const all = flattenCampusServices(schoolLmsEnabled);
  const pool = terms.length ? all : directoryCampusServices(schoolLmsEnabled);
  return pool.map(presentCampusService).filter((service) => {
    const childText = terms.length
      ? ''
      : all
          .filter((item) => 'parentHref' in item && item.parentHref === service.href)
          .map((item) => `${item.name} ${item.text} ${item.keywords}`)
          .join(' ');
    const content = `${service.name} ${service.text} ${service.keywords} ${childText} ${'note' in service && service.note ? service.note : ''}`
      .normalize('NFKC')
      .toLocaleLowerCase('zh-TW');
    return (
      (category === 'all' || service.category === category) &&
      terms.every((term) => content.includes(term))
    );
  });
}

export function serviceAccessLabel(
  access: keyof typeof SERVICE_ACCESS,
  options: { loading: boolean; error?: boolean; studentId: boolean },
) {
  if (access !== 'school') return SERVICE_ACCESS[access];
  if (options.loading) return '學校帳號 · 正在確認登入方式';
  if (options.error) return '學校帳號 · 暫時無法確認登入方式';
  return options.studentId ? '學校帳號' : '學校帳號 · 尚未開放登入';
}

export function serviceContextSearch(params: URLSearchParams) {
  const context = new URLSearchParams();
  for (const key of ['school', 'schoolId', 'campus']) {
    const value = params.get(key);
    if (value) context.set(key, value);
  }
  return context.size ? `?${context}` : '';
}
