export const SERVICE_CATEGORIES = [
  { id: 'study', label: '學習與課務', description: '查課表、整理學分，接續課堂上的事。' },
  { id: 'campus', label: '校園生活', description: '找教室、看公車，安排課堂以外的時間。' },
  { id: 'connect', label: '消息與交流', description: '看看校園近況，接收通知與朋友的訊息。' },
  { id: 'account', label: '帳號與協助', description: '管理個人資料，找到需要的協助。' },
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number]['id'];

export const SERVICE_ACCESS = {
  public: '可直接瀏覽',
  platform: 'Google 帳號',
  school: '學校帳號',
  account: '依帳號查看',
  operator: '需平台管理權限',
} as const;

export const CAMPUS_SERVICES = [
  {
    name: '跨校交流',
    text: '在公開看板分享近況，認識其他校園的人',
    href: '/social',
    access: 'platform',
    keywords: '社交 跨校 公開 看板 social',
    category: 'connect',
  },
  {
    name: '課表',
    text: '查看、編輯與匯入本學期課表',
    href: '/timetable',
    access: 'school',
    keywords: '上課 行事曆 schedule 空堂',
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
    name: '老師工作台',
    text: '老師看自己課的學生申訴，核准或不核准',
    href: '/teacher',
    access: 'school',
    keywords: '老師 教師 申訴 核准 teacher',
    category: 'study',
  },
  {
    name: '成績',
    text: '查詢學校提供的學期成績',
    href: '/grades',
    access: 'school',
    keywords: '分數 學期 grade',
    category: 'study',
  },
  {
    name: '學分規劃',
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
    keywords: '作業 教材 教師 點名 course',
    category: 'study',
  },
  {
    name: '課程空間',
    text: '閱讀教材、繳交作業、回答測驗，查看老師回饋',
    href: '/classroom',
    access: 'platform',
    keywords: 'nuni 課程 教材 作業 測驗 繳交 作答 老師 回饋 邀請 classroom',
    category: 'study',
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
    name: '私訊',
    text: '接續已建立的對話',
    href: '/dms',
    access: 'school',
    keywords: '聊天 message',
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
    text: '用找人代號加好友，加好友後才看課表',
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
    name: '餐廳',
    text: '查看餐廳與菜單資料',
    href: '/cafeteria',
    access: 'public',
    keywords: '午餐 晚餐 餐點 food',
    category: 'campus',
  },
  {
    name: '失物招領',
    text: '查看本校遺失與拾獲刊登',
    href: '/lost-found',
    access: 'platform',
    keywords: '失物 招領 遺失 拾獲 lost found',
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
    text: '職涯資料還沒接到校方，先看支援說明',
    href: '/career',
    access: 'public',
    keywords: '實習 徵才 履歷 就業 career',
    category: 'campus',
  },
  {
    name: '校園助理',
    text: '查詢課務與校園服務；排課請用課表裡的幫我安排',
    href: '/ai-assistant',
    access: 'school',
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
}[];

export function searchCampusServices(query: string, category: ServiceCategory | 'all' = 'all') {
  const terms = query
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-TW')
    .split(/\s+/)
    .filter(Boolean);
  return CAMPUS_SERVICES.filter((service) => {
    const content = `${service.name} ${service.text} ${service.keywords}`
      .normalize('NFKC')
      .toLocaleLowerCase('zh-TW');
    return (
      (category === 'all' || service.category === category) &&
      terms.every((term) => content.includes(term))
    );
  });
}

export function serviceContextSearch(params: URLSearchParams) {
  const context = new URLSearchParams();
  for (const key of ['school', 'schoolId', 'campus']) {
    const value = params.get(key);
    if (value) context.set(key, value);
  }
  return context.size ? `?${context}` : '';
}
