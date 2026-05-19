import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Demo 角色管理（mobile）— 對齊 apps/web/src/lib/demoRole.ts
 *
 * 跨平台用同一套角色定義，避免 web / mobile 上 demo 行為不一致。
 * 持久化：AsyncStorage（key: 'campus.demoRole.v1'）
 */

export type DemoRole =
  | 'student'
  | 'teacher'
  | 'ta'
  | 'club_officer'
  | 'department_head'
  | 'admin'
  | 'alumni'
  | 'guest';

export interface DemoRoleDefinition {
  role: DemoRole;
  label: string;
  shortLabel: string;
  icon: string;
  tone: string;
  toneSoft: string;
  description: string;
  /** 角色預設入口（mobile 路由名） */
  entryRoute: string;
}

export const DEMO_ROLES: DemoRoleDefinition[] = [
  {
    role: 'student',
    label: '學生',
    shortLabel: '學生',
    icon: '👩‍🎓',
    tone: '#5856D6',
    toneSoft: 'rgba(88,86,214,0.12)',
    description: '看課表、成績、公告、加入社團、用校園服務',
    entryRoute: 'Today',
  },
  {
    role: 'teacher',
    label: '教師',
    shortLabel: '教師',
    icon: '🧑‍🏫',
    tone: '#5856D6',
    toneSoft: 'rgba(88,86,214,0.12)',
    description: '教師工作台：點名、成績冊、題庫、教材',
    entryRoute: 'TeacherDashboard',
  },
  {
    role: 'ta',
    label: '助教 TA',
    shortLabel: 'TA',
    icon: '🧑‍💻',
    tone: '#AF52DE',
    toneSoft: 'rgba(124,58,237,0.12)',
    description: '可批改作業、看成績冊，但無法編輯教材或發布成績',
    entryRoute: 'TeacherDashboard',
  },
  {
    role: 'club_officer',
    label: '社團幹部',
    shortLabel: '社團幹部',
    icon: '🎯',
    tone: '#34C759',
    toneSoft: 'rgba(52,199,89,0.14)',
    description: '管理社團公告、活動發布、成員管理',
    entryRoute: 'Clubs',
  },
  {
    role: 'department_head',
    label: '系主任 / 行政',
    shortLabel: '系主任',
    icon: '🏛️',
    tone: '#FF9500',
    toneSoft: 'rgba(255,149,0,0.14)',
    description: '系所公告審核、課程統計、教師名冊',
    entryRoute: 'Admin',
  },
  {
    role: 'admin',
    label: '系統管理員',
    shortLabel: '管理員',
    icon: '🛡️',
    tone: '#FF3B30',
    toneSoft: 'rgba(255,59,48,0.12)',
    description: '使用者管理、學校設定、系統日誌',
    entryRoute: 'Admin',
  },
  {
    role: 'alumni',
    label: '校友',
    shortLabel: '校友',
    icon: '🎓',
    tone: '#8E8E93',
    toneSoft: 'rgba(142,142,147,0.14)',
    description: '可瀏覽校園公告、地圖、活動，無法加入社團或借書',
    entryRoute: 'Today',
  },
  {
    role: 'guest',
    label: '訪客',
    shortLabel: '訪客',
    icon: '👀',
    tone: '#5856D6',
    toneSoft: 'rgba(88,86,214,0.12)',
    description: '未登入身份，僅看公開公告、地圖、餐廳、公車',
    entryRoute: 'Login',
  },
];

export function getDemoRoleDefinition(role: DemoRole): DemoRoleDefinition {
  return DEMO_ROLES.find((r) => r.role === role) ?? DEMO_ROLES[DEMO_ROLES.length - 1];
}

/** 權限矩陣（與 web 端 lib/demoRole.ts 同步）*/
export interface RoleCapabilities {
  canViewTeacherDashboard: boolean;
  canEditModules: boolean;
  canPublishGrades: boolean;
  canGradeAssignments: boolean;
  canEditQuestionBank: boolean;
  canJoinClubs: boolean;
  canPublishClubEvents: boolean;
  canManageClubMembers: boolean;
  canPublishAnnouncements: boolean;
  canApproveAnnouncements: boolean;
  canViewAdminDashboard: boolean;
  canManageUsers: boolean;
  canManageSystem: boolean;
  canBorrowBooks: boolean;
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

// ──────────────────────────────────────────────────────────────
// React Context（mobile 用 AsyncStorage 持久化）
// ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'campus.demoRole.v1';

type DemoRoleContextValue = {
  role: DemoRole;
  setRole: (next: DemoRole) => void;
  capabilities: RoleCapabilities;
  definition: DemoRoleDefinition;
};

const DemoRoleContext = createContext<DemoRoleContextValue | null>(null);

function isRole(x: unknown): x is DemoRole {
  return typeof x === 'string' && DEMO_ROLES.some((r) => r.role === x);
}

export function DemoRoleProvider(props: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<DemoRole>('guest');
  const [, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && isRole(raw)) {
          setRoleState(raw);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setRole = (next: DemoRole) => {
    setRoleState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  };

  const value = useMemo<DemoRoleContextValue>(
    () => ({
      role,
      setRole,
      capabilities: getCapabilities(role),
      definition: getDemoRoleDefinition(role),
    }),
    [role],
  );

  return <DemoRoleContext.Provider value={value}>{props.children}</DemoRoleContext.Provider>;
}

export function useDemoRole(): DemoRoleContextValue {
  const ctx = useContext(DemoRoleContext);
  if (!ctx) {
    // 沒包 provider 時提供一個合理的 fallback，方便測試
    return {
      role: 'guest',
      setRole: () => undefined,
      capabilities: getCapabilities('guest'),
      definition: getDemoRoleDefinition('guest'),
    };
  }
  return ctx;
}
