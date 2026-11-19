import type { ResolvedDashboardRole } from './dashboardRole';

export type RoleWorkspaceAction = {
  label: string;
  description: string;
  route: string;
};

type RoleWorkspaceFlow = {
  title: string;
  description: string;
  primary: RoleWorkspaceAction;
  next: RoleWorkspaceAction[];
};

const announcements: RoleWorkspaceAction = {
  label: '查看校方公告',
  description: '掌握目前校園的重要通知。',
  route: '公告總覽',
};
const events: RoleWorkspaceAction = {
  label: '查看校園活動',
  description: '查看活動時間、地點與報名方式。',
  route: '活動總覽',
};
const teaching: RoleWorkspaceAction = {
  label: '查看教學待辦',
  description: '先選擇已加入的授課課程，再處理待批改與課堂事項。',
  route: 'TeachingHub',
};

/** Navigation recommendations only. Each destination retains its own authorization. */
export function roleWorkspaceFlow(role: ResolvedDashboardRole): RoleWorkspaceFlow {
  switch (role) {
    case 'ta':
      return {
        title: '助教工作',
        description: '教學協作與自己的日常分開整理，先處理課程裡需要你的事項。',
        primary: teaching,
        next: [
          { label: '我的課表', description: '確認自己的上課時間與接下來的安排。', route: 'PersonalTimetable' },
          { label: '課程群組', description: '回覆已加入群組的課程討論。', route: 'Groups' },
        ],
      };
    case 'club_officer':
      return {
        title: '社團與課務',
        description: '先處理社團協作，再回到自己的課程與作業。',
        primary: { label: '開啟我的群組', description: '選擇社團或課程群組，查看討論與成員事務。', route: 'Groups' },
        next: [
          { label: '處理我的課務', description: '查看自己的課程、作業與學習待辦。', route: 'LearnHome' },
          events,
        ],
      };
    case 'department':
      return {
        title: '系所工作',
        description: '教學協作從已授權課程進入，校園通知與聯絡窗口集中在這裡。',
        primary: teaching,
        next: [announcements, { label: '校方聯絡窗口', description: '查找目前校園的單位與聯絡資訊。', route: 'SchoolInfo' }],
      };
    case 'admin':
      return {
        title: '校園管理',
        description: '先處理本校公告與活動，再查看授課工作及公開資訊。',
        primary: { label: '管理公告與活動', description: '進入目前帳號獲授權的校方管理範圍。', route: 'AdminDashboard' },
        next: [teaching, announcements],
      };
    case 'staff':
      return {
        title: '校務服務',
        description: '已指派的宿舍工作會顯示在下方；其他校園服務從同一個入口接續。',
        primary: { label: '開啟校園服務', description: '依交通、吃飯與住宿需求，找到目前校園的服務。', route: 'CampusHome' },
        next: [announcements, { label: '校方聯絡窗口', description: '找到承辦單位與聯絡方式。', route: 'SchoolInfo' }],
      };
    case 'alumni':
      return {
        title: '校友生活',
        description: '從校園活動與公開消息持續參與校園生活。',
        primary: events,
        next: [announcements, { label: '校園交流', description: '閱讀校園動態，查看已開放的交流內容。', route: 'CampusSocialScreen' }],
      };
    default:
      return {
        title: '探索校園',
        description: '先看公開資訊，從公告、活動與學校介紹認識目前校園。',
        primary: announcements,
        next: [events, { label: '認識這所學校', description: '查看學校資訊與公開聯絡方式。', route: 'SchoolInfo' }],
      };
  }
}

export const ROLE_DAILY_ACTIONS: RoleWorkspaceAction[] = [
  { label: '校園生活', description: '交通、吃飯與住宿服務。', route: 'CampusHome' },
  { label: '我的帳號與設定', description: '查看目前帳號、通知與個人設定。', route: 'MeHome' },
];
