import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './auth';

/**
 * Demo 角色管理（mobile）— 對齊 apps/web/src/lib/demoRole.ts
 *
 * 跨平台用同一套角色定義，避免 web / mobile 上 demo 行為不一致。
 * 持久化：AsyncStorage（key: 'campus.demoRole.v1'）
 *
 * **同步機制**：DemoRoleProvider 監聽 auth.user.uid 變化，自動從 uid 推斷 demoRole。
 *   這避免 LoginLanding 登入後 demoRole context 還停留在上一個角色的 stale state，
 *   導致 MessagesAiFirstScreen 等用 useDemoRole() 的螢幕篩出別人的訊息。
 */

/** 從 demo auth uid 推斷 DemoRole（uid prefix matching） */
export function inferDemoRoleFromUid(uid: string | null | undefined): DemoRole | null {
  if (!uid) return null;
  if (uid === 'demo_guest') return 'guest';
  if (uid === 'demo_alumni_chang' || uid.startsWith('demo_alumni')) return 'alumni';
  if (uid === 'demo_admin_sys') return 'admin';
  if (uid === 'demo_cafeteria' || uid.startsWith('demo_vendor')) return 'vendor';
  if (uid === 'demo_admin_huang' || uid.startsWith('demo_dept')) return 'department_head';
  if (uid === 'demo_club_wei' || uid.startsWith('demo_club')) return 'club_officer';
  if (uid === 'demo_ta_lin' || uid.startsWith('demo_ta')) return 'ta';
  if (uid === 'demo_teacher_chang' || uid.startsWith('demo_teacher')) return 'teacher';
  if (uid === 'demo_student_kuchih' || uid.startsWith('demo_student')) return 'student';
  return null;
}

function inferDemoRoleFromAuthRole(role: string | null | undefined): DemoRole | null {
  if (!role) return null;
  if (isRole(role)) return role;
  if (role === 'professor') return 'teacher';
  if (role === 'principal') return 'department_head';
  if (role === 'staff') return 'admin';
  return null;
}

export type DemoRole =
  | 'student'
  | 'teacher'
  | 'ta'
  | 'club_officer'
  | 'department_head'
  | 'admin'
  | 'vendor'
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
    // 餐廳員工 / 校內廠商 — 跟學生/教師完全隔離，只看到自己店面的菜單、訂單、營收
    role: 'vendor',
    label: '餐廳員工 / 廠商',
    shortLabel: '餐廳',
    icon: '🍱',
    tone: '#C95F28',
    toneSoft: 'rgba(201,95,40,0.14)',
    description: '管理菜單、收訂單、推播優惠、看店面營收',
    entryRoute: 'VendorDashboard',
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
  vendor: {
    // 餐廳員工：不碰學術系統，但有自家店面的全部營運權限
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
  const auth = useAuth();
  const [role, setRoleState] = useState<DemoRole>('guest');
  const [, setLoaded] = useState(false);

  // 目前登入者是最高優先來源；只有沒有 auth role 時才讀取舊設定。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const inferred = inferDemoRoleFromUid(auth.user?.uid) ?? inferDemoRoleFromAuthRole(auth.profile?.role);
        if (inferred) {
          if (!cancelled) {
            setRoleState(inferred);
            AsyncStorage.setItem(STORAGE_KEY, inferred).catch(() => undefined);
          }
          return;
        }
        if (!auth.user?.uid) {
          if (!cancelled) {
            setRoleState('guest');
            AsyncStorage.setItem(STORAGE_KEY, 'guest').catch(() => undefined);
          }
          return;
        }
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
  }, [auth.profile?.role, auth.user?.uid]);

  // 同步：auth.user.uid 變化時，自動從 uid 推斷 demoRole。
  // 沒這個 effect 的話，學生用 LoginLanding 登入會看到上次角色的 stale role
  // → MessagesAiFirstScreen 篩出別人的訊息（嚴重 demo bug）。
  useEffect(() => {
    const uid = auth.user?.uid;
    const inferred = inferDemoRoleFromUid(uid) ?? inferDemoRoleFromAuthRole(auth.profile?.role);
    if (inferred && inferred !== role) {
      setRoleState(inferred);
      AsyncStorage.setItem(STORAGE_KEY, inferred).catch(() => undefined);
    } else if (!uid && role !== 'guest') {
      // 登出：回到訪客身份
      setRoleState('guest');
      AsyncStorage.setItem(STORAGE_KEY, 'guest').catch(() => undefined);
    }
  }, [auth.profile?.role, auth.user?.uid, role]);

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
