import React, { useSyncExternalStore } from 'react';
import { ActivityIndicator } from 'react-native';
import StudentTodayScreen from './StudentTodayScreen';
import TeacherTodayScreen from './TeacherTodayScreen';
import { useAuth } from '../state/auth';
import { AIDetailScreen, AICard, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { UnavailableFeatureScreen, type ServiceScreenProps } from './UnavailableFeatureScreen';
import { resolveDashboardRole, type ResolvedDashboardRole } from '../services/dashboardRole';
export { resolveDashboardRole, type ResolvedDashboardRole } from '../services/dashboardRole';

const roleTitles: Partial<Record<ResolvedDashboardRole, string>> = {
  ta: '助教工作台',
  club_officer: '社團工作台',
  department: '系所工作台',
  admin: '管理工作台',
  vendor: '商家工作台',
  staff: '校務服務',
  alumni: '校友服務',
};
export function RoleWorkspaceScreen({
  role,
  ...props
}: ServiceScreenProps & { role: ResolvedDashboardRole }) {
  return (
    <UnavailableFeatureScreen
      {...props}
      title={roleTitles[role] ?? '校園服務'}
      actions={
        role === 'admin'
          ? [
              { label: '管理公告與活動', route: 'AdminDashboard' },
              { label: '查看校方公告', route: '公告總覽' },
            ]
          : undefined
      }
      description={
        role === 'admin'
          ? '可以管理校方公告與活動，或查看目前公開的校園資訊。'
          : role === 'guest'
            ? '可以先查看校方公告與校園活動。個人課務服務需要登入並確認學校身分。'
            : '此身分的工作台尚未開放。你可以先查看校方公告與校園活動。'
      }
    />
  );
}
export default function RoleAwareTodayScreen(props: ServiceScreenProps) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const auth = useAuth();
  if (auth.loading || auth.profileLoading)
    return (
      <AIDetailScreen title="校園服務">
        <AICard>
          <ActivityIndicator accessibilityLabel="確認帳號身分" color={aiTokens.ai} />
        </AICard>
      </AIDetailScreen>
    );
  if (auth.user && auth.profile?.uid !== auth.user.uid)
    return (
      <UnavailableFeatureScreen
        {...props}
        title="確認帳號身分"
        description="目前無法確認帳號身分。請到登入頁重新確認；也可以先查看公開公告。"
        actions={[
          { label: '前往學校登入', route: 'SSOLogin' },
          { label: '查看校方公告', route: '公告總覽' },
        ]}
      />
    );
  const role = resolveDashboardRole(auth.user ? auth.profile : null);
  if (role === 'student') return <StudentTodayScreen />;
  if (role === 'teacher') return <TeacherTodayScreen />;
  return <RoleWorkspaceScreen {...props} role={role} />;
}
