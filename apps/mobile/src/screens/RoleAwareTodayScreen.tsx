/**
 * Role-Aware Today — 每個角色看到不同的「Today」入口
 *
 * 5 條 dispatcher 路徑：
 *  - student        → TodayCockpitScreen（學生駕駛艙）
 *  - teacher        → TeacherCockpitScreen（老師駕駛艙）
 *  - staff (TA)     → TADashboardScreen
 *  - department_head → DepartmentDashboardScreen（系所主任）
 *  - admin          → DepartmentDashboardScreen
 *  - vendor / cafeteria → VendorDashboardScreen
 *
 * 判斷依據：
 *  1. auth.profile.roleGroup（最權威）
 *  2. auth.profile.role
 *  3. demo 帳號 uid 前綴（demo_teacher_* 等）
 *  4. fallback → student
 */
import React from 'react';
import { View, ActivityIndicator } from 'react-native';

import TodayCockpitScreen from './TodayCockpitScreen';
import TeacherCockpitScreen from './TeacherCockpitScreen';
import TADashboardScreen from './TADashboardScreen';
import DepartmentDashboardScreen from './DepartmentDashboardScreen';
import VendorDashboardScreen from './VendorDashboardScreen';
import { useAuth } from '../state/auth';
import { theme } from '../ui/theme';

export type ResolvedDashboardRole =
  | 'student'
  | 'teacher'
  | 'ta'
  | 'department'
  | 'vendor';

/** 從 auth.profile 推斷該顯示哪個 cockpit */
export function resolveDashboardRole(profile: {
  uid?: string | null;
  roleGroup?: string | null;
  role?: string | null;
} | null): ResolvedDashboardRole {
  if (!profile) return 'student';

  // 1. demo 帳號 uid prefix 判斷（最直接）
  const uid = profile.uid ?? '';
  if (uid === 'demo_cafeteria' || uid.startsWith('demo_vendor')) return 'vendor';
  if (uid === 'demo_admin_huang' || uid.startsWith('demo_admin')) return 'department';
  if (uid === 'demo_ta_lin' || uid.startsWith('demo_ta')) return 'ta';
  if (uid === 'demo_teacher_chang' || uid.startsWith('demo_teacher')) return 'teacher';
  if (uid === 'demo_student_kuchih' || uid.startsWith('demo_student')) return 'student';

  // 2. roleGroup 判斷
  const rg = profile.roleGroup;
  if (rg === 'admin' || rg === 'department_head') return 'department';
  if (rg === 'teacher') return 'teacher';

  // 3. role 細分
  const r = profile.role;
  if (r === 'vendor' || r === 'service' || r === 'cafeteria') return 'vendor';
  if (r === 'department_head' || r === 'admin') return 'department';
  if (r === 'ta' || r === 'assistant') return 'ta';
  if (r === 'teacher' || r === 'professor') return 'teacher';

  return 'student';
}

export default function RoleAwareTodayScreen() {
  const auth = useAuth();

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

  switch (resolved) {
    case 'teacher':
      return <TeacherCockpitScreen />;
    case 'ta':
      return <TADashboardScreen />;
    case 'department':
      return <DepartmentDashboardScreen />;
    case 'vendor':
      return <VendorDashboardScreen />;
    case 'student':
    default:
      return <TodayCockpitScreen />;
  }
}
