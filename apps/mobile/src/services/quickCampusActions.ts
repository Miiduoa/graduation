import {
  suggestCampusDestinations,
  type CampusQuickDestination,
} from '@campus/shared/src/campusIntent';

export type MobileQuickAction = {
  destination: CampusQuickDestination;
  route: string;
  label: string;
  description: string;
};

const destinations: Record<CampusQuickDestination, Omit<MobileQuickAction, 'destination'>> = {
  '/map': { route: 'MapV2', label: '校園地圖', description: '找地點並開啟導航' },
  '/bus': { route: 'BusV2', label: '公車', description: '路線與站牌資訊' },
  '/classroom': { route: 'CoursesHome', label: '課程與作業', description: '前往本人課程，尋找作業及教材' },
  '/school-courses': { route: 'CoursesHome', label: 'WOW Class 課程', description: '前往學校課堂，依目前校園與帳號查看課程' },
  '/timetable': { route: 'PersonalTimetable', label: '我的課表', description: '查看今天及本週課程' },
  '/library': { route: 'Library', label: '圖書館', description: '館藏與借閱入口' },
  '/grades': { route: 'Grades', label: '成績', description: '查看本人可用的成績資料' },
  '/credit-planner': { route: 'CreditAuditStack', label: '學分規劃', description: '查看學分及畢業條件' },
  '/cafeteria': { route: '餐廳總覽', label: '校園餐廳', description: '查餐廳與菜單' },
  '/dormitory': { route: 'Dormitory', label: '宿舍', description: '住宿備忘與設備問題' },
  '/calendar': { route: 'PersonalCalendar', label: '個人行事曆', description: '查看安排與提醒' },
  '/events': { route: '活動總覽', label: '校園活動', description: '近期活動與講座' },
  '/announcements': { route: '公告總覽', label: '校園公告', description: '查看最新校園消息' },
  '/messages': { route: 'Inbox', label: '通知與訊息', description: '查看本人訊息' },
  '/lost-found': { route: 'LostFound', label: '失物招領', description: '遺失與拾獲物品' },
  '/friends': { route: 'FriendsManage', label: '好友', description: '尋找及管理好友' },
  '/import': { route: 'PersonalImport', label: '匯入資料', description: '選擇課表、成績與行程檔案，預覽後再匯入' },
  '/appeals': { route: 'CourseAppeals', label: '課程申訴', description: '到實際課程申訴頁確認授權與申訴紀錄' },
  '/teacher': { route: 'TeachingHub', label: '教師工作台', description: '需授課身分，查看授課與批改功能' },
  '/groups': { route: 'Groups', label: '課程與群組', description: '查已加入課程及群組，邀請碼加入仍需確認' },
  '/grades?tab=feedback': { route: 'Grades', label: '成績與回饋', description: '在成績頁查詢可用評語，尚未保證學校同步' },
  '/clubs': { route: '活動總覽', label: '社團活動', description: 'App 尚無獨立社團管理入口，先查看已公布的活動' },
  '/dms': { route: 'Dms', label: '私訊', description: '登入後查看本人的對話' },
  '/community': { route: 'CampusSocialScreen', label: '校園交流', description: '校園社群與討論看板' },
  '/food': { route: '餐廳總覽', label: '點餐與取餐', description: '先查看餐廳菜單；正式線上點餐不一定開放' },
  '/merchant': { route: 'MerchantHub', label: '商家合作', description: '商家工作區，需具備適當帳號權限' },
  '/school-info': { route: 'SchoolInfo', label: '學校資訊', description: '學校官網、地址及正式聯絡方式' },
  '/ai-assistant': { route: 'AIChat', label: '校園助理', description: '詢問現有資料與服務使用方式' },
  '/support': { route: 'Help', label: '使用協助', description: '查看正式支援資訊' },
  '/account-deletion': { route: 'AccountDeletion', label: '刪除帳號', description: '僅開啟說明頁，不會直接刪除資料' },
  '/profile': { route: 'ProfileEdit', label: '個人資料', description: '查看並編輯自己的帳號資訊' },
  '/settings': { route: 'Settings', label: '設定', description: '外觀、通知與應用設定' },
  '/classroom/account': { route: 'NuniWorkspace', label: '學校資格', description: '前往帳號工作區；學籍驗證依實際接入學校提供' },
  '/admin': { route: 'AdminDashboard', label: '平台管理', description: '管理員授權頁，無權限不可操作' },
};

export function getMobileQuickActions(phrase: string): MobileQuickAction[] {
  return getMobileActionsForDestinations(suggestCampusDestinations(phrase));
}

export function getMobileActionsForDestinations(
  choices: readonly CampusQuickDestination[],
): MobileQuickAction[] {
  return choices.map((destination) => ({ destination, ...destinations[destination] }));
}
