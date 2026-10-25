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
};

export function getMobileQuickActions(phrase: string): MobileQuickAction[] {
  return getMobileActionsForDestinations(suggestCampusDestinations(phrase));
}

export function getMobileActionsForDestinations(
  choices: readonly CampusQuickDestination[],
): MobileQuickAction[] {
  return choices.map((destination) => ({ destination, ...destinations[destination] }));
}
