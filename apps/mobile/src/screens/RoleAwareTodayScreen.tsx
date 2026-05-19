/**
 * Role-Aware Today — 每個角色看到不同的「Today」入口
 *
 * 8 條 dispatcher 路徑：
 *  - student         → TodayCockpitScreen（學生駕駛艙）
 *  - teacher         → TeacherCockpitScreen（老師駕駛艙）
 *  - ta              → TADashboardScreen（助教）
 *  - club_officer    → ClubOfficerDashboardScreen（社團幹部）
 *  - department      → DepartmentDashboardScreen（系主任 / 行政）
 *  - admin           → AdminDashboardScreen（系統管理員）
 *  - vendor          → VendorDashboardScreen（餐廳店家）
 *  - alumni          → AlumniHomeScreen（校友）
 *  - guest           → GuestHomeScreen（訪客）
 *
 * 判斷依據：
 *  1. auth.profile.roleGroup（最權威）
 *  2. auth.profile.role
 *  3. demo 帳號 uid 前綴（demo_teacher_* 等）
 *  4. fallback → student
 */
import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import TodayCockpitScreen from './TodayCockpitScreen';
import TeacherCockpitScreen from './TeacherCockpitScreen';
import TADashboardScreen from './TADashboardScreen';
import DepartmentDashboardScreen from './DepartmentDashboardScreen';
import VendorDashboardScreen from './VendorDashboardScreen';
import { AdminDashboardScreen } from './AdminDashboardScreen';
import ClubOfficerDashboardScreen from './ClubOfficerDashboardScreen';
import AlumniHomeScreen from './AlumniHomeScreen';
import GuestHomeScreen from './GuestHomeScreen';
import { useAuth } from '../state/auth';
import { theme } from '../ui/theme';
import DemoRolePill from '../components/DemoRolePill';

export type ResolvedDashboardRole =
  | 'student'
  | 'teacher'
  | 'ta'
  | 'club_officer'
  | 'department'
  | 'admin'
  | 'vendor'
  | 'alumni'
  | 'guest';

/** 從 auth.profile 推斷該顯示哪個 cockpit */
export function resolveDashboardRole(profile: {
  uid?: string | null;
  roleGroup?: string | null;
  role?: string | null;
} | null): ResolvedDashboardRole {
  if (!profile) return 'guest';

  // 1. demo 帳號 uid prefix 判斷（最直接）
  const uid = profile.uid ?? '';
  if (uid === 'demo_guest') return 'guest';
  if (uid === 'demo_alumni_chang' || uid.startsWith('demo_alumni')) return 'alumni';
  if (uid === 'demo_admin_sys') return 'admin';
  if (uid === 'demo_cafeteria' || uid.startsWith('demo_vendor')) return 'vendor';
  if (uid === 'demo_admin_huang' || uid.startsWith('demo_dept')) return 'department';
  if (uid === 'demo_club_wei' || uid.startsWith('demo_club')) return 'club_officer';
  if (uid === 'demo_ta_lin' || uid.startsWith('demo_ta')) return 'ta';
  if (uid === 'demo_teacher_chang' || uid.startsWith('demo_teacher')) return 'teacher';
  if (uid === 'demo_student_kuchih' || uid.startsWith('demo_student')) return 'student';

  // 2. roleGroup 判斷
  const rg = profile.roleGroup;
  if (rg === 'guest') return 'guest';
  if (rg === 'alumni') return 'alumni';
  if (rg === 'admin') return 'admin';
  if (rg === 'department_head') return 'department';
  if (rg === 'club_officer') return 'club_officer';
  if (rg === 'ta') return 'ta';
  if (rg === 'teacher') return 'teacher';
  if (rg === 'staff') return 'vendor';

  // 3. role 細分
  const r = profile.role;
  if (r === 'guest') return 'guest';
  if (r === 'alumni') return 'alumni';
  if (r === 'vendor' || r === 'service' || r === 'cafeteria') return 'vendor';
  if (r === 'admin' || r === 'school') return 'admin';
  if (r === 'department_head' || r === 'principal' || r === 'department') return 'department';
  if (r === 'club_officer') return 'club_officer';
  if (r === 'ta' || r === 'assistant') return 'ta';
  if (r === 'teacher' || r === 'professor') return 'teacher';

  return 'student';
}

function renderDashboard(role: ResolvedDashboardRole): React.ReactNode {
  switch (role) {
    case 'teacher':
      return <TeacherCockpitScreen />;
    case 'ta':
      return <TADashboardScreen />;
    case 'club_officer':
      return <ClubOfficerDashboardScreen />;
    case 'department':
      return <DepartmentDashboardScreen />;
    case 'admin':
      return <AdminDashboardScreen />;
    case 'vendor':
      return <VendorDashboardScreen />;
    case 'alumni':
      return <AlumniHomeScreen />;
    case 'guest':
      return <GuestHomeScreen />;
    case 'student':
    default:
      return <TodayCockpitScreen />;
  }
}

export default function RoleAwareTodayScreen() {
  const auth = useAuth();
  const insets = useSafeAreaInsets();

  // 還在 load → spinner
  if (auth.loading || auth.profileLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surfaceMuted,
        }}
      >
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  const resolved = resolveDashboardRole({
    uid: auth.user?.uid ?? null,
    roleGroup: auth.profile?.roleGroup ?? null,
    role: auth.profile?.role ?? null,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {renderDashboard(resolved)}
      {/* 全域 DemoRolePill — 浮在右上角，所有 demo dashboard 都看得到，可一鍵切角色 */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: insets.top + 6,
          right: theme.layout.screenHorizontalPadding,
          zIndex: 50,
        }}
      >
        <DemoRolePill />
      </View>
    </View>
  );
}
