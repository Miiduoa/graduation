'use client';

/**
 * Demo 角色管理
 *
 * 用途：讓所有頁面知道目前是以哪個身份在 demo，根據角色顯示對應的操作 / 提示。
 * 儲存：localStorage('demoRole')。重新整理也記得，但僅用於 demo（正式登入用 Firebase）。
 */

import { useEffect, useState, useCallback } from 'react';

export type DemoRole =
  | 'student'
  | 'teacher'
  | 'ta'
  | 'club_officer'
  | 'department_head'
  | 'admin'
  | 'alumni'
  | 'guest';

export const DEMO_ROLE_KEY = 'demoRole';

export interface DemoRoleDefinition {
  role: DemoRole;
  label: string;
  shortLabel: string;
  icon: string;
  tone: string;
  toneSoft: string;
  description: string;
  /** 點下去時 demo 的進入點 */
  entryHref: string;
  /** 該角色在 demoData 對應的 user uid */
  demoUserUid: string;
}

export const DEMO_ROLES: DemoRoleDefinition[] = [
  {
    role: 'student',
    label: '學生',
    shortLabel: '學生',
    icon: '👩‍🎓',
    tone: '#5E6AD2',
    toneSoft: 'rgba(94,106,210,0.12)',
    description: '看課表、成績、公告、加入社團、用校園服務',
    entryHref: '/timetable',
    demoUserUid: 'demo-student-1',
  },
  {
    role: 'teacher',
    label: '教師',
    shortLabel: '教師',
    icon: '🧑‍🏫',
    tone: '#0F8B8D',
    toneSoft: 'rgba(15,139,141,0.12)',
    description: '進入教師端：點名、成績冊、題庫、教材管理',
    entryHref: '/teacher/course/c1',
    demoUserUid: 'demo-teacher-1',
  },
  {
    role: 'ta',
    label: '助教 TA',
    shortLabel: 'TA',
    icon: '🧑‍💻',
    tone: '#7C3AED',
    toneSoft: 'rgba(124,58,237,0.12)',
    description: '可批改作業、看成績冊，但無法編輯教材結構與發布成績',
    entryHref: '/teacher/course/c1',
    demoUserUid: 'demo-ta-1',
  },
  {
    role: 'club_officer',
    label: '社團幹部',
    shortLabel: '社團幹部',
    icon: '🎯',
    tone: '#34C759',
    toneSoft: 'rgba(52,199,89,0.14)',
    description: '管理社團公告、活動發布、成員管理',
    entryHref: '/clubs',
    demoUserUid: 'demo-club-1',
  },
  {
    role: 'department_head',
    label: '系主任 / 行政',
    shortLabel: '系主任',
    icon: '🏛️',
    tone: '#FF9500',
    toneSoft: 'rgba(255,149,0,0.14)',
    description: '系所公告審核、課程統計、教師名冊',
    entryHref: '/admin',
    demoUserUid: 'demo-dept-1',
  },
  {
    role: 'admin',
    label: '系統管理員',
    shortLabel: '管理員',
    icon: '🛡️',
    tone: '#FF3B30',
    toneSoft: 'rgba(255,59,48,0.12)',
    description: '使用者管理、學校設定、系統日誌',
    entryHref: '/admin',
    demoUserUid: 'demo-admin-1',
  },
  {
    role: 'alumni',
    label: '校友',
    shortLabel: '校友',
    icon: '🎓',
    tone: '#8E8E93',
    toneSoft: 'rgba(142,142,147,0.14)',
    description: '可瀏覽校園公告、地圖、活動，但無法加入社團或借書',
    entryHref: '/',
    demoUserUid: 'demo-alumni-1',
  },
  {
    role: 'guest',
    label: '訪客',
    shortLabel: '訪客',
    icon: '👀',
    tone: '#007AFF',
    toneSoft: 'rgba(0,122,255,0.12)',
    description: '未登入身份，僅看公開公告、地圖、餐廳、公車',
    entryHref: '/',
    demoUserUid: '',
  },
];

export function getDemoRoleDefinition(role: DemoRole): DemoRoleDefinition {
  return DEMO_ROLES.find((r) => r.role === role) ?? DEMO_ROLES[DEMO_ROLES.length - 1];
}

/** 讀目前 demo 角色（SSR 安全） */
export function readDemoRole(): DemoRole {
  if (typeof window === 'undefined') return 'guest';
  const raw = window.localStorage.getItem(DEMO_ROLE_KEY);
  if (!raw) return 'guest';
  const valid = DEMO_ROLES.map((r) => r.role) as string[];
  return valid.includes(raw) ? (raw as DemoRole) : 'guest';
}

/** 寫入 demo 角色 */
export function writeDemoRole(role: DemoRole): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DEMO_ROLE_KEY, role);
  // 派發 storage 事件讓同一頁的其他元件也能同步
  window.dispatchEvent(new CustomEvent('demoRoleChange', { detail: role }));
}

/** React hook：讀取與切換 demo 角色 */
export function useDemoRole(): [DemoRole, (next: DemoRole) => void] {
  // 初始用 'guest'（SSR）；mount 後立即用 client-side localStorage 同步
  const [role, setRole] = useState<DemoRole>('guest');
  const [hydrated, setHydrated] = useState(false);

  // Mount 一次：把 localStorage 值同步進來。
  // 用 hydrated flag 避免 hydration mismatch warning。
  useEffect(() => {
    const initial = readDemoRole();
    if (initial !== role) {
      setRole(initial);
    }
    setHydrated(true);
    // 後續 subscribe 變動
    const handler = (e: Event) => {
      const next = (e as CustomEvent<DemoRole>).detail;
      if (next) setRole(next);
    };
    const storageHandler = (e: StorageEvent) => {
      if (e.key === DEMO_ROLE_KEY) {
        setRole(readDemoRole());
      }
    };
    window.addEventListener('demoRoleChange', handler);
    window.addEventListener('storage', storageHandler);
    return () => {
      window.removeEventListener('demoRoleChange', handler);
      window.removeEventListener('storage', storageHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 用 hydrated 標記避免 unused-vars warning（並保留給 caller 將來判斷 hydration 狀態）
  void hydrated;

  const update = useCallback((next: DemoRole) => {
    writeDemoRole(next);
    setRole(next);
  }, []);

  return [role, update];
}

/** 權限矩陣：每個角色能做什麼 */
export interface RoleCapabilities {
  /** 看教師工作台（教材 / 點名 / 成績冊） */
  canViewTeacherDashboard: boolean;
  /** 編輯教材結構（新增單元 / 刪除）— 教師才能，TA 只能批改 */
  canEditModules: boolean;
  /** 發布成績（讓學生看見）— 教師才能 */
  canPublishGrades: boolean;
  /** 批改作業 — 教師、TA */
  canGradeAssignments: boolean;
  /** 編輯題庫 — 教師才能 */
  canEditQuestionBank: boolean;
  /** 加入 / 退出社團 */
  canJoinClubs: boolean;
  /** 發布社團活動 / 公告 — 社團幹部、管理員 */
  canPublishClubEvents: boolean;
  /** 管理社團成員 */
  canManageClubMembers: boolean;
  /** 發布全校 / 系所公告 — 系主任、管理員、教師 */
  canPublishAnnouncements: boolean;
  /** 審核公告 — 系主任、管理員 */
  canApproveAnnouncements: boolean;
  /** 看 admin 儀表板 */
  canViewAdminDashboard: boolean;
  /** 管理使用者 — 管理員 */
  canManageUsers: boolean;
  /** 系統設定 — 管理員 */
  canManageSystem: boolean;
  /** 借書 / 續借 — 學生、教師、TA、社團幹部、系主任、管理員 */
  canBorrowBooks: boolean;
  /** 讀公開資訊 — 所有人 */
  canReadPublic: boolean;
}

const CAPS: Record<DemoRole, RoleCapabilities> = {
  student: {
    canViewTeacherDashboard: false,
    canEditModules: false,
    canPublishGrades: false,
    canGradeAssignments: false,
    canEditQuestionBank: false,
    canJoinClubs: true,
    canPublishClubEvents: false,
    canManageClubMembers: false,
    canPublishAnnouncements: false,
    canApproveAnnouncements: false,
    canViewAdminDashboard: false,
    canManageUsers: false,
    canManageSystem: false,
    canBorrowBooks: true,
    canReadPublic: true,
  },
  teacher: {
    canViewTeacherDashboard: true,
    canEditModules: true,
    canPublishGrades: true,
    canGradeAssignments: true,
    canEditQuestionBank: true,
    canJoinClubs: true,
    canPublishClubEvents: false,
    canManageClubMembers: false,
    canPublishAnnouncements: true,
    canApproveAnnouncements: false,
    canViewAdminDashboard: false,
    canManageUsers: false,
    canManageSystem: false,
    canBorrowBooks: true,
    canReadPublic: true,
  },
  ta: {
    canViewTeacherDashboard: true,
    canEditModules: false,
    canPublishGrades: false,
    canGradeAssignments: true,
    canEditQuestionBank: false,
    canJoinClubs: true,
    canPublishClubEvents: false,
    canManageClubMembers: false,
    canPublishAnnouncements: false,
    canApproveAnnouncements: false,
    canViewAdminDashboard: false,
    canManageUsers: false,
    canManageSystem: false,
    canBorrowBooks: true,
    canReadPublic: true,
  },
  club_officer: {
    canViewTeacherDashboard: false,
    canEditModules: false,
    canPublishGrades: false,
    canGradeAssignments: false,
    canEditQuestionBank: false,
    canJoinClubs: true,
    canPublishClubEvents: true,
    canManageClubMembers: true,
    canPublishAnnouncements: false,
    canApproveAnnouncements: false,
    canViewAdminDashboard: false,
    canManageUsers: false,
    canManageSystem: false,
    canBorrowBooks: true,
    canReadPublic: true,
  },
  department_head: {
    canViewTeacherDashboard: false,
    canEditModules: false,
    canPublishGrades: false,
    canGradeAssignments: false,
    canEditQuestionBank: false,
    canJoinClubs: false,
    canPublishClubEvents: false,
    canManageClubMembers: false,
    canPublishAnnouncements: true,
    canApproveAnnouncements: true,
    canViewAdminDashboard: true,
    canManageUsers: false,
    canManageSystem: false,
    canBorrowBooks: true,
    canReadPublic: true,
  },
  admin: {
    canViewTeacherDashboard: true,
    canEditModules: true,
    canPublishGrades: true,
    canGradeAssignments: true,
    canEditQuestionBank: true,
    canJoinClubs: true,
    canPublishClubEvents: true,
    canManageClubMembers: true,
    canPublishAnnouncements: true,
    canApproveAnnouncements: true,
    canViewAdminDashboard: true,
    canManageUsers: true,
    canManageSystem: true,
    canBorrowBooks: true,
    canReadPublic: true,
  },
  alumni: {
    canViewTeacherDashboard: false,
    canEditModules: false,
    canPublishGrades: false,
    canGradeAssignments: false,
    canEditQuestionBank: false,
    canJoinClubs: false,
    canPublishClubEvents: false,
    canManageClubMembers: false,
    canPublishAnnouncements: false,
    canApproveAnnouncements: false,
    canViewAdminDashboard: false,
    canManageUsers: false,
    canManageSystem: false,
    canBorrowBooks: false,
    canReadPublic: true,
  },
  guest: {
    canViewTeacherDashboard: false,
    canEditModules: false,
    canPublishGrades: false,
    canGradeAssignments: false,
    canEditQuestionBank: false,
    canJoinClubs: false,
    canPublishClubEvents: false,
    canManageClubMembers: false,
    canPublishAnnouncements: false,
    canApproveAnnouncements: false,
    canViewAdminDashboard: false,
    canManageUsers: false,
    canManageSystem: false,
    canBorrowBooks: false,
    canReadPublic: true,
  },
};

export function getCapabilities(role: DemoRole): RoleCapabilities {
  return CAPS[role];
}

export function useCapabilities(): RoleCapabilities {
  const [role] = useDemoRole();
  return getCapabilities(role);
}
