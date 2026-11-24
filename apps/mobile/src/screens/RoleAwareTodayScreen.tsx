import { pageTitleFont } from '../ui/styles';
import React, { useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { DormStaffHome } from './DormStaffHome';
import ShopDockScreen from './ShopDockScreen';
import StudentTodayScreen from './StudentTodayScreen';
import TeacherTodayScreen from './TeacherTodayScreen';
import { useAuth } from '../state/auth';
import { AIDetailScreen, AICard, AIButton, AIScreen, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme, theme } from '../ui/theme';
import { UnavailableFeatureScreen, type ServiceScreenProps } from './UnavailableFeatureScreen';
import { resolveDashboardRole, type ResolvedDashboardRole } from '../services/dashboardRole';
import { isSchoolLoginEntryAvailable } from '../services/schoolLoginAvailability';
import { roleWorkspaceFlow, ROLE_DAILY_ACTIONS, type RoleWorkspaceAction } from '../services/roleWorkspaceFlow';
import { safeNavigate } from '../utils/safeNavigate';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
export { resolveDashboardRole, type ResolvedDashboardRole } from '../services/dashboardRole';

function RoleWorkflow({ role, navigation, children }: ServiceScreenProps & {
  role: ResolvedDashboardRole;
  children?: React.ReactNode;
}) {
  const s = useThemeStyleSheet(createStyles);
  const [dailyOpen, setDailyOpen] = useState(false);
  const flow = roleWorkspaceFlow(role);
  const open = (action: RoleWorkspaceAction) => safeNavigate(navigation, action.route);
  const daily = ROLE_DAILY_ACTIONS.filter((action) =>
    action.route !== flow.primary.route && !flow.next.some((next) => next.route === action.route),
  );
  const row = (action: RoleWorkspaceAction) => (
    <Pressable key={action.route} accessibilityRole="button" accessibilityLabel={action.label}
      onPress={() => open(action)} style={s.row}>
      <View style={s.rowText}>
        <Text style={s.rowTitle}>{action.label}</Text>
        <Text style={s.description}>{action.description}</Text>
      </View>
      <Text style={s.arrow} accessibilityElementsHidden importantForAccessibility="no">›</Text>
    </Pressable>
  );
  return (
    <AIScreen>
      <View style={s.heading}>
        <Text accessibilityRole="header" style={s.title}>{flow.title}</Text>
        <Text style={s.description}>{flow.description}</Text>
      </View>
      {children}
      <View style={s.section}>
        <Text accessibilityRole="header" style={s.sectionTitle}>從這裡開始</Text>
        <Text style={s.primaryDescription}>{flow.primary.description}</Text>
        <AIButton label={flow.primary.label} onPress={() => open(flow.primary)} />
      </View>
      <View style={s.section}>
        <Text accessibilityRole="header" style={s.sectionTitle}>接著處理</Text>
        <View style={s.rows}>{flow.next.map(row)}</View>
      </View>
      <View style={s.section}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: dailyOpen }}
          onPress={() => setDailyOpen((current) => !current)} style={s.disclosure}>
          <Text style={s.sectionTitle}>日常與帳號</Text>
          <Text style={s.arrow}>{dailyOpen ? '−' : '＋'}</Text>
        </Pressable>
        {dailyOpen ? <View style={s.rows}>{daily.map(row)}</View> : null}
      </View>
    </AIScreen>
  );
}

export function RoleWorkspaceScreen({
  role,
  ...props
}: ServiceScreenProps & { role: ResolvedDashboardRole }) {
  if (role === 'vendor') return <ShopDockScreen navigation={props.navigation} />;
  const workspace = (children?: React.ReactNode) => (
    <RoleWorkflow key={role} {...props} role={role}>{children}</RoleWorkflow>
  );
  return role === 'staff' ? (
    <DormStaffHome
      fallback={workspace}
      onOpen={(route) => safeNavigate(props.navigation, route)}
    />
  ) : (
    workspace()
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
          ...(isSchoolLoginEntryAvailable() ? [{ label: '前往學校登入', route: 'SSOLogin' }] : []),
          { label: '查看帳號與登入狀態', route: 'MeHome' },
          { label: '查看校方公告', route: '公告總覽' },
        ]}
      />
    );
  const role = resolveDashboardRole(auth.user ? auth.profile : null);
  if (role === 'student') return <StudentTodayScreen />;
  if (role === 'teacher') return <TeacherTodayScreen />;
  return <RoleWorkspaceScreen key={auth.user?.uid} {...props} role={role} />;
}

const createStyles = () => StyleSheet.create({
  heading: { paddingHorizontal: 22, paddingTop: 24, paddingBottom: 8, gap: 8 },
  title: { fontFamily: pageTitleFont, color: theme.colors.text, fontSize: 28, lineHeight: 36, fontWeight: '700' },
  description: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21 },
  primaryDescription: { color: theme.colors.text, fontSize: 15, lineHeight: 23, marginBottom: 6 },
  section: {
    marginHorizontal: 22,
    marginTop: 20,
    paddingTop: 16,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  sectionTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  rows: {},
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  arrow: { color: theme.colors.muted, fontSize: 20 },
  disclosure: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});
