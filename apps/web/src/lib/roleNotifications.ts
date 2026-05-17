/**
 * 角色感知的 demo notifications
 *
 * 每個角色看到不同類別的通知；hook 給 SiteShell / 通知中心使用。
 */

import type { DemoRole } from './demoRole';

export interface DemoNotification {
  id: string;
  icon: string;
  title: string;
  body: string;
  time: string;
  href?: string;
  type: 'info' | 'warning' | 'success' | 'action';
}

const COMMON_PUBLIC: DemoNotification[] = [
  {
    id: 'n-pub-1',
    icon: '⚠️',
    title: '校園網路維護公告',
    body: '5/20 凌晨 02:00-04:00 校園網路維護，期間部分服務無法使用',
    time: '昨天',
    href: '/announcements/ann-4',
    type: 'warning',
  },
];

const ROLE_NOTIFICATIONS: Record<DemoRole, DemoNotification[]> = {
  student: [
    {
      id: 'n-st-1',
      icon: '📚',
      title: '【資料結構】期中考公告',
      body: '5/22 09:00 工程館 302，範圍第 1-7 章',
      time: '2 小時前',
      href: '/announcements/ann-1',
      type: 'warning',
    },
    {
      id: 'n-st-2',
      icon: '📤',
      title: '作業二 即將截止',
      body: '【作業系統】第三次作業 5/23 23:59 截止',
      time: '8 小時前',
      href: '/course/c3',
      type: 'action',
    },
    {
      id: 'n-st-3',
      icon: '🎯',
      title: '【程式設計社】黑客松報名開始',
      body: '本週五黑客松，獎金 NTD 30,000，限 6 人組隊',
      time: '5 小時前',
      href: '/clubs',
      type: 'info',
    },
    ...COMMON_PUBLIC,
  ],
  teacher: [
    {
      id: 'n-tc-1',
      icon: '📝',
      title: '8 件作業待批改',
      body: '【資料結構】作業二已收齊，請於 5/30 前批改完成',
      time: '1 小時前',
      href: '/teacher/course/c1/gradebook',
      type: 'action',
    },
    {
      id: 'n-tc-2',
      icon: '✅',
      title: '今日 09:00 點名',
      body: '工程館 302，學生數 48 人，請開啟 QR 點名',
      time: '今天 08:30',
      href: '/teacher/course/c1/attendance',
      type: 'info',
    },
    {
      id: 'n-tc-3',
      icon: '📥',
      title: '系主任已核准你的課程公告',
      body: '「期中考試範圍公布」已發布給選課學生',
      time: '昨天',
      href: '/announcements',
      type: 'success',
    },
    ...COMMON_PUBLIC,
  ],
  ta: [
    {
      id: 'n-ta-1',
      icon: '📝',
      title: '【資料結構】3 件待批改',
      body: '王老師指派你批改作業二第 11-20 號學生',
      time: '30 分鐘前',
      href: '/teacher/course/c1/gradebook',
      type: 'action',
    },
    {
      id: 'n-ta-2',
      icon: '✅',
      title: '助教時間提醒',
      body: '今天 14:00 答疑時間，工程館 305',
      time: '今天 13:00',
      type: 'info',
    },
    ...COMMON_PUBLIC,
  ],
  club_officer: [
    {
      id: 'n-cl-1',
      icon: '🎯',
      title: '黑客松報名已達 18 組',
      body: '距離報名截止剩 3 天，目前 18/20 組',
      time: '1 小時前',
      href: '/clubs',
      type: 'action',
    },
    {
      id: 'n-cl-2',
      icon: '📥',
      title: '3 位新成員入社申請',
      body: '請至「管理成員」面板審核',
      time: '今天',
      href: '/clubs',
      type: 'info',
    },
    ...COMMON_PUBLIC,
  ],
  department_head: [
    {
      id: 'n-dh-1',
      icon: '⏳',
      title: '3 件公告待你審核',
      body: '畢業專題評分標準、暑期實習說明會、系友回娘家',
      time: '2 小時前',
      href: '/admin',
      type: 'action',
    },
    {
      id: 'n-dh-2',
      icon: '🧑‍🏫',
      title: '新進教師資料審核',
      body: '林宜珊老師的教師資料已送出，請審核',
      time: '昨天',
      href: '/admin',
      type: 'info',
    },
    ...COMMON_PUBLIC,
  ],
  admin: [
    {
      id: 'n-ad-1',
      icon: '⚠️',
      title: '異常登入嘗試',
      body: '檢測到 5 次來自境外 IP 的失敗登入',
      time: '30 分鐘前',
      href: '/admin',
      type: 'warning',
    },
    {
      id: 'n-ad-2',
      icon: '💾',
      title: '每日備份完成',
      body: '已備份 1.2GB 資料至雲端，存放 30 天',
      time: '今天 03:00',
      href: '/admin',
      type: 'success',
    },
    {
      id: 'n-ad-3',
      icon: '📡',
      title: 'API 速率警告',
      body: 'tronclass-proxy 在過去 1 小時內請求數超出 80% 閾值',
      time: '1 小時前',
      href: '/admin',
      type: 'warning',
    },
    ...COMMON_PUBLIC,
  ],
  alumni: [
    {
      id: 'n-al-1',
      icon: '🎓',
      title: '系友回娘家 邀請函',
      body: '6/15 系友回娘家活動歡迎您回來分享',
      time: '昨天',
      href: '/announcements',
      type: 'info',
    },
    ...COMMON_PUBLIC,
  ],
  guest: COMMON_PUBLIC,
};

export function getNotificationsForRole(role: DemoRole): DemoNotification[] {
  return ROLE_NOTIFICATIONS[role] ?? COMMON_PUBLIC;
}
