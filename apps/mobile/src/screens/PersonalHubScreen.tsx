/* eslint-disable */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

import { useAuth } from '../state/auth';
import { useNotifications } from '../state/notifications';
import { useSchool } from '../state/school';
import { usePermissions } from '../hooks/usePermissions';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { BrandFluxImageHeader } from '../ui/BrandFluxImageHeader';
import { ContextStrip } from '../ui/campusOs';
import { resolveRoleMode } from '../utils/campusOs';
import { navigateToCourseHome } from '../utils/courseNavigation';
import { AIBrainOverviewCard } from '../components/AIBrainOverviewCard';
import { aiOverlay } from '../app/useAIOverlay';
import { generatedUiAssets } from '../ui/generatedUiAssets';

interface ListRowProps {
  icon: string;
  title: string;
  meta?: string;
  tint?: string;
  onPress?: () => void;
  isLast?: boolean;
}

function ListRow({ icon, title, meta, tint, onPress, isLast }: ListRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.md,
        paddingVertical: theme.layout.listItemVertical,
        paddingHorizontal: theme.space.md,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: theme.colors.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <LinearGradient
        colors={
          [`${tint || theme.colors.accent}20`, `${tint || theme.colors.accent}08`] as [
            string,
            string,
          ]
        }
        style={{
          width: 34,
          height: 34,
          borderRadius: theme.radius.md,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Ionicons name={icon as any} size={16} color={tint || theme.colors.accent} />
      </LinearGradient>
      <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '600', flex: 1 }}>
        {title}
      </Text>
      {meta && (
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: '500' }}>
          {meta}
        </Text>
      )}
      <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
    </Pressable>
  );
}

/** iOS-style grouped card container */
function GroupedCard({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        marginHorizontal: theme.layout.screenPadding,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.card,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

interface SectionHeaderProps {
  title: string;
}

function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <Text
      style={{
        color: theme.colors.textSecondary,
        fontSize: 13,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginTop: theme.space.xl,
        marginBottom: theme.space.sm,
        paddingHorizontal: theme.layout.screenPadding,
      }}
    >
      {title}
    </Text>
  );
}

export function PersonalHubScreen(props: any) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const auth = useAuth();

  // 當畫面獲得焦點時重新讀取 auth 狀態（修復從登入頁返回後狀態未更新的問題）
  // native-stack 的 screen freeze 可能導致 context 變更未即時反映
  useFocusEffect(
    useCallback(() => {
      auth.refreshProfile();
    }, [auth.refreshProfile]),
  );

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const notifs = useNotifications();
  const { school } = useSchool();
  const {
    displayName: roleDisplayName,
    badgeColor,
    can,
    isTeacher,
    isStaff,
    isDepartmentHead,
    isAdmin,
  } = usePermissions();
  const roleMode = resolveRoleMode(auth.profile?.role, !!auth.user);
  const activeMerchantAssignments = useMemo(
    () =>
      (auth.profile?.merchantAssignments ?? []).filter(
        (assignment) => assignment.status === 'active',
      ),
    [auth.profile?.merchantAssignments],
  );

  const identity = useMemo(() => {
    if (!auth.user) return '校園訪客';
    return auth.profile?.displayName ?? auth.user.email ?? '校園使用者';
  }, [auth.profile?.displayName, auth.user]);

  // auth 還在載入時不要顯示登入按鈕（避免閃現登入畫面）
  if (auth.loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.bg,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  const isDark = theme.mode === 'dark';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 40,
        }}
      >
        <BrandFluxImageHeader
          variant="personal"
          paddingTop={insets.top + theme.space.lg}
          paddingBottom={24}
        >
          {/* ⚙️ 右上角設定齒輪：開啟全功能 HeaderDrawer */}
          <View
            style={{
              position: 'absolute',
              top: insets.top + 12,
              right: theme.space.lg,
              zIndex: 10,
            }}
          >
            <Pressable
              onPress={() => {
                try {
                  const { headerDrawer } = require('../components/HeaderDrawer');
                  headerDrawer.open();
                } catch {
                  nav?.navigate?.('Settings');
                }
              }}
              hitSlop={12}
              style={({ pressed }) => ({
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                justifyContent: 'center',
                alignItems: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons
                name="menu-outline"
                size={20}
                color={isDark ? 'rgba(255,255,255,0.7)' : theme.colors.textSecondary}
              />
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: theme.layout.screenHorizontalPadding, marginBottom: theme.layout.sectionGapLarge }}>
            {/* Avatar circle */}
            <LinearGradient
              colors={[...theme.gradients.avatar]}
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: theme.space.md,
              }}
            >
              <Ionicons name="person" size={32} color={theme.colors.onAccent} />
            </LinearGradient>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: theme.space.md,
              }}
            >
              <View style={{ flex: 1, gap: theme.space.sm }}>
                <Text
                  style={{
                    color: isDark ? 'rgba(255,255,255,0.6)' : theme.colors.textSecondary,
                    fontSize: 13,
                  }}
                >
                  我的
                </Text>
                <Text
                  style={{
                    color: theme.colors.text,
                    fontSize: 28,
                    fontWeight: '800',
                    letterSpacing: -0.5,
                  }}
                >
                  {identity}
                </Text>
              </View>
              {!auth.user ? (
                <Image
                  accessibilityIgnoresInvertColors
                  source={generatedUiAssets.emptyRelaxed}
                  style={{
                    width: 96,
                    height: 72,
                    borderRadius: theme.radius.md,
                    marginTop: theme.space.sm,
                  }}
                  resizeMode="cover"
                />
              ) : null}
            </View>
            {auth.user ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space.md,
                  marginTop: theme.space.md,
                }}
              >
                <View
                  style={{
                    backgroundColor: badgeColor,
                    paddingHorizontal: theme.space.md,
                    paddingVertical: theme.space.xs,
                    borderRadius: theme.radius.full,
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                    {roleDisplayName}
                  </Text>
                </View>
                {auth.profile?.department ? (
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>
                    {auth.profile.department}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </BrandFluxImageHeader>

        {!auth.user ? (
          <Pressable
            onPress={() => nav?.navigate?.('SSOLogin')}
            style={({ pressed }) => ({
              marginHorizontal: theme.layout.screenPadding,
              marginBottom: theme.space.xl,
              borderRadius: theme.radius.lg,
              overflow: 'hidden',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <LinearGradient
              colors={[theme.colors.accent, '#AF52DE'] as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                paddingVertical: theme.space.lg,
                paddingHorizontal: theme.space.lg,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>登入帳號</Text>
              <Text
                style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: theme.space.xs }}
              >
                使用學校帳號密碼登入以解鎖完整功能
              </Text>
            </LinearGradient>
          </Pressable>
        ) : null}

        <SectionHeader title="AI 與工具" />
        <View style={{ marginHorizontal: theme.layout.screenPadding, marginBottom: theme.space.md }}>
          <AIBrainOverviewCard
            onPress={() =>
              aiOverlay.open({
                mode: 'insights',
                source: 'personal_hub_brain_card',
              })
            }
          />
        </View>
        <GroupedCard>
          <ListRow
            icon="hardware-chip-outline"
            title="AI 模型管理"
            meta="本地推理"
            tint="#AF52DE"
            onPress={() => nav?.navigate?.('AIModelManager')}
          />
          {can('achievements.view') ? (
            <ListRow
              icon="trophy-outline"
              title="成就與積分"
              meta="成長"
              tint={theme.colors.achievement}
              onPress={() => nav?.navigate?.('Achievements')}
            />
          ) : null}
          <ListRow
            icon="leaf-outline"
            title="校園園地"
            meta="同伴與作物"
            tint="#22C55E"
            onPress={() => nav?.navigate?.('CampusGarden')}
          />
          <ListRow
            icon="paw-outline"
            title="校園精靈"
            meta="與你一起長大"
            tint="#FF9500"
            onPress={() => nav?.navigate?.('Companion')}
          />
          <ListRow
            icon="star-outline"
            title="我的收藏"
            meta="解鎖成就"
            tint="#007AFF"
            onPress={() => nav?.navigate?.('CompanionCollection')}
          />
          <ListRow
            icon="planet-outline"
            title="校園星圖"
            meta="走訪足跡"
            tint="#AF52DE"
            onPress={() => nav?.navigate?.('Constellation')}
            isLast={!can('courses.view')}
          />
        </GroupedCard>

        {can('courses.view') ? (
          <>
            <SectionHeader title="課程與學業紀錄" />
            <GroupedCard>
              <ListRow
                icon="document-text-outline"
                title="我的測驗成績"
                meta="跨課程"
                tint="#0EA5E9"
                onPress={() => nav?.navigate?.('學習', { screen: 'MyQuizScores' })}
              />
              <ListRow
                icon="checkmark-done-outline"
                title="我的點名紀錄"
                meta="跨課程 + 智慧分析"
                tint="#16A34A"
                onPress={() => nav?.navigate?.('學習', { screen: 'MyAttendanceHistory' })}
              />
              <ListRow
                icon="school-outline"
                title="學分與畢業規劃"
                meta="規劃"
                tint={theme.colors.roleTeacher}
                onPress={() => nav?.navigate?.('CreditAuditStack')}
                isLast
              />
            </GroupedCard>
          </>
        ) : null}

        <SectionHeader title="開發／診斷" />
        <GroupedCard>
          <ListRow
            icon="bug-outline"
            title="🔍 資料流診斷"
            meta="DEV 工具"
            tint="#0EA5E9"
            onPress={() => nav?.navigate?.('DataFlowDebug')}
            isLast
          />
        </GroupedCard>

        <View style={{ marginHorizontal: theme.layout.screenPadding, marginTop: theme.space.md }}>
          <Pressable
            onPress={() => {
              try {
                const { headerDrawer } = require('../components/HeaderDrawer');
                headerDrawer.open();
              } catch {
                nav?.navigate?.('Settings');
              }
            }}
            style={({ pressed }) => ({
              padding: theme.layout.cardPadding,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space.md,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons name="apps-outline" size={20} color={theme.colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>
                所有設定與工具
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                通知、語言、帳號、隱私、回饋等請從左上角頭像開啟
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
          </Pressable>
        </View>

        {isTeacher || isDepartmentHead || isStaff || isAdmin ? (
          <>
            <SectionHeader
              title={
                isAdmin
                  ? '管理入口'
                  : isStaff
                    ? '服務管理'
                    : isDepartmentHead
                      ? '主管工具'
                      : '教學工具'
              }
            />
            <GroupedCard>
              {isTeacher ? (
                <ListRow
                  icon="school-outline"
                  title="我的課程管理"
                  meta="教學"
                  tint={theme.colors.roleTeacher}
                  onPress={() => navigateToCourseHome(nav, auth.profile?.role)}
                />
              ) : null}
              {isStaff ? (
                <ListRow
                  icon="construct-outline"
                  title="設施與工單管理"
                  meta="服務"
                  tint={theme.colors.warning}
                  onPress={() => nav?.navigate?.('PrintService')}
                />
              ) : null}
              {isDepartmentHead ? (
                <ListRow
                  icon="stats-chart-outline"
                  title="系所數據與審核"
                  meta="審核"
                  tint={theme.colors.calm}
                  onPress={() => nav?.navigate?.('AdminDashboard')}
                />
              ) : null}
              {isAdmin ? (
                <>
                  <ListRow
                    icon="settings-outline"
                    title="管理員控制台"
                    meta="Admin"
                    tint={theme.colors.roleAdmin}
                    onPress={() => nav?.navigate?.('AdminDashboard')}
                  />
                  <ListRow
                    icon="checkmark-done-outline"
                    title="課程驗證管理"
                    meta="審核"
                    tint={theme.colors.urgent}
                    onPress={() => nav?.navigate?.('AdminCourseVerify')}
                    isLast
                  />
                </>
              ) : null}
            </GroupedCard>
          </>
        ) : null}

        {auth.user ? (
          <>
            <SectionHeader title="帳號" />
            <GroupedCard>
              <Pressable
                onPress={() => {
                  Alert.alert('確認登出', '登出後需要重新使用學校帳號登入，確定要登出嗎？', [
                    { text: '取消', style: 'cancel' },
                    {
                      text: '登出',
                      style: 'destructive',
                      onPress: async () => {
                        setIsLoggingOut(true);
                        try {
                          await auth.signOut();
                        } finally {
                          setIsLoggingOut(false);
                        }
                      },
                    },
                  ]);
                }}
                disabled={isLoggingOut}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space.md,
                  paddingVertical: theme.layout.listItemVertical,
                  paddingHorizontal: theme.space.md,
                  opacity: pressed || isLoggingOut ? 0.7 : 1,
                })}
              >
                {isLoggingOut ? (
                  <ActivityIndicator size="small" color={theme.colors.danger} />
                ) : (
                  <Ionicons name="log-out-outline" size={18} color={theme.colors.danger} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.danger, fontSize: 15, fontWeight: '600' }}>
                    登出帳號
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                    {auth.user.email ?? '已登入'}
                  </Text>
                </View>
              </Pressable>
            </GroupedCard>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
