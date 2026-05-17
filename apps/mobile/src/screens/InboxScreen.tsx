/* eslint-disable */
import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, Text, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CourseSpace, InboxTask } from '../data';
import { useAsyncList } from '../hooks/useAsyncList';
import { useDataSource } from '../hooks/useDataSource';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { usePermissions } from '../hooks/usePermissions';
import { useAmbientCues } from '../features/engagement';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import {
  ActionableInboxRow,
  AmbientCueCard,
  CompletionState,
  ContextStrip,
  TimelineCard,
} from '../ui/campusOs';
import { formatDueWindow, isTeachingRole, resolveRoleMode, toInboxItem } from '../utils/campusOs';
import { navigateToCourseHome } from '../utils/courseNavigation';
import { navigateFromInboxTask, resolveInboxAction } from '../services/inboxActions';
import { HeaderAvatarButton } from '../components/HeaderAvatarButton';
import { AIMissionControl } from '../components/AIMissionControl';
import { getPersona } from '../data/demoPersona';

export function InboxScreen(props: any) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { school } = useSchool();
  const permissions = usePermissions();
  const ds = useDataSource();
  const roleMode = resolveRoleMode(auth.profile?.role, !!auth.user);
  const teachingMode = isTeachingRole(auth.profile?.role);
  const ambientRole = roleMode === 'guest' ? 'guest' : roleMode;

  const {
    items: courseSpaces,
    loading: membershipsLoading,
    refresh: refreshMemberships,
    refreshing: membershipsRefreshing,
  } = useAsyncList<CourseSpace>(async () => {
    if (!auth.user) return [];
    return ds.listCourseSpaces(auth.user.uid, school.id);
  }, [auth.user?.uid, ds, school.id]);

  const {
    items: inboxTasks,
    loading: inboxLoading,
    refresh: refreshInbox,
    refreshing: inboxRefreshing,
  } = useAsyncList<InboxTask>(async () => {
    if (!auth.user) return [];
    return ds.listInboxTasks(auth.user.uid, school.id);
  }, [auth.user?.uid, ds, school.id]);

  const inboxItems = useMemo(
    () =>
      inboxTasks
        .map((task) => {
          const item = toInboxItem(task);
          const action = resolveInboxAction(task, { isTeachingRole: teachingMode });
          return action ? { ...item, actionLabel: action.label } : item;
        })
        .sort((a, b) => a.priority - b.priority),
    [inboxTasks, teachingMode],
  );

  const emptyInbox = useMemo(() => {
    const role = auth.profile?.role;
    if (permissions.isAdmin) {
      return {
        title: '目前沒有全校治理待辦',
        description:
          '帳號同步、課程認證與合規項目會出現在此。您仍可從「學習」分頁開啟管理儀表板與認證佇列。',
        actionLabel: '開啟學習／管理首頁',
        onPress: () => navigateToCourseHome(nav, role),
      };
    }
    if (permissions.isDepartmentHead) {
      return {
        title: '目前沒有系所簽核待辦',
        description:
          '課綱異動、獎助名單與院級表單會集中顯示。教學面的待批改項目也會一併出現在同一張清單。',
        actionLabel: '回到審核／教學首頁',
        onPress: () => navigateToCourseHome(nav, role),
      };
    }
    if (permissions.isTeacher) {
      return {
        title: '目前沒有教學待辦',
        description:
          '待批改、測驗成績公開、討論區待回覆與課堂 LIVE 會出現在這裡。暫時清空代表本輪工作已完成。',
        actionLabel: '回到教學首頁',
        onPress: () => navigateToCourseHome(nav, role),
      };
    }
    if (permissions.isStaff) {
      return {
        title: '目前沒有服務／工單待辦',
        description:
          '總務、場務、採購簽核與場地審議會出現在此工作台。可改從「學習」進入職員服務中樞。',
        actionLabel: '開啟職員首頁',
        onPress: () => navigateToCourseHome(nav, role),
      };
    }
    return {
      title: '目前沒有待辦項目',
      description: '一切就緒，你可以回到課程或探索其他功能。',
      actionLabel: '打開課程',
      onPress: () => navigateToCourseHome(nav, role),
    };
  }, [auth.profile?.role, nav, permissions.isAdmin, permissions.isDepartmentHead, permissions.isStaff, permissions.isTeacher]);
  const {
    cue: ambientCue,
    dismissCue: dismissAmbientCue,
    openCue: openAmbientCue,
  } = useAmbientCues({
    schoolId: school.id,
    uid: auth.user?.uid ?? null,
    role: ambientRole,
    surface: 'inbox',
    limit: 1,
  });

  const liveCount = inboxItems.filter((item) => item.kind === 'live').length;
  const dueCount = inboxItems.filter(
    (item) => item.kind === 'assignment' || item.kind === 'quiz',
  ).length;
  const unreadCount = courseSpaces.reduce(
    (sum, membership) => sum + (membership.unreadCount ?? 0),
    0,
  );

  const openItem = (item: (typeof inboxItems)[number]) => {
    if (
      navigateFromInboxTask(nav, item, {
        role: auth.profile?.role,
        isTeachingRole: teachingMode,
      })
    ) {
      return;
    }

    nav?.navigate?.('訊息', { screen: 'GroupDetail', params: { groupId: item.groupId } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={membershipsRefreshing || inboxRefreshing}
            onRefresh={async () => {
              await Promise.all([refreshMemberships(), refreshInbox()]);
            }}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
          gap: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
          <HeaderAvatarButton />
          <View style={{ flex: 1, gap: theme.space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text
                style={{
                  color: theme.colors.muted,
                  fontSize: theme.typography.overline.fontSize,
                  fontWeight: theme.typography.overline.fontWeight ?? '700',
                  letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
                  textTransform: 'uppercase',
                }}
              >
                訊息
              </Text>
              {auth.user && getPersona(auth.user.uid) && (
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 999,
                    backgroundColor: theme.colors.accentSoft,
                  }}
                >
                  <Text style={{ color: theme.colors.accent, fontSize: 10, fontWeight: '700' }}>
                    {getPersona(auth.user.uid)?.shortLabel}視角
                  </Text>
                </View>
              )}
            </View>
            <Text
              style={{
                color: theme.colors.text,
                fontSize: theme.typography.display.fontSize,
                fontWeight: theme.typography.display.fontWeight ?? '800',
                letterSpacing: theme.typography.display.letterSpacing,
              }}
            >
              任務
            </Text>
          </View>
        </View>

        {/* AI 任務指揮中心 — 把 AI 排好的下一步放最上面 */}
        {auth.user && getPersona(auth.user.uid) && (
          <AIMissionControl uid={auth.user.uid} maxVisible={3} hideWhenEmpty />
        )}

        {auth.user ? (
          <>
            <Pressable
              onPress={() => nav?.getParent()?.navigate?.('Today', { screen: 'CampusSocialScreen' })}
              accessibilityRole="button"
              accessibilityLabel="開啟校園社群"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space.md,
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.socialSoft,
                borderWidth: 1,
                borderColor: theme.colors.social + '35',
                opacity: pressed ? 0.88 : 1,
              })}
            >
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  backgroundColor: theme.colors.social + '22',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="planet-outline" size={19} color={theme.colors.social} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 15 }}>校園社群</Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                  動態、看板、即時 Story、學伴
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
            </Pressable>
            <Pressable
              onPress={() => nav?.navigate?.('FriendsManage')}
              accessibilityRole="button"
              accessibilityLabel="管理好友與邀請"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space.md,
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.88 : 1,
              })}
            >
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  backgroundColor: theme.colors.accentSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="people-outline" size={19} color={theme.colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 15 }}>好友與邀請</Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                  查看邀請、我的好友、複製 UID
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
            </Pressable>
            <Pressable
              onPress={() => nav?.navigate?.('FriendSearch')}
              accessibilityRole="button"
              accessibilityLabel="搜尋聯絡人並加好友"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space.md,
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.accentSoft,
                borderWidth: 1,
                borderColor: theme.colors.accent + '33',
                opacity: pressed ? 0.88 : 1,
              })}
            >
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  backgroundColor: theme.colors.accent + '18',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="person-add-outline" size={19} color={theme.colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 15 }}>搜尋／加好友</Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                  依通訊錄找同校對象並送出好友邀請
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
            </Pressable>
          </>
        ) : null}

        <Pressable
          testID="e2e-open-groups"
          onPress={() => nav?.navigate?.('Groups')}
          accessibilityRole="button"
          accessibilityLabel="開啟課程群組"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.md,
            paddingHorizontal: 16,
            paddingVertical: 14,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            opacity: pressed ? 0.88 : 1,
          })}
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              backgroundColor: theme.colors.warning + '22',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="people-circle-outline" size={19} color={theme.colors.warning} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 15 }}>課程群組</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
              加入碼、建立群組、查看課程討論
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
        </Pressable>

        {!auth.user ? (
          <CompletionState
            title="登入後才會出現可執行的訊息工作台"
            description="訊息分頁會把課程更新、作業、評量、課堂與私訊整合成單一工作台。"
            actionLabel="前往登入"
            onPress={() => nav?.navigate?.('我的', { screen: 'SSOLogin' })}
          />
        ) : null}

        {auth.user && inboxItems.length === 0 ? (
          <CompletionState
            title={emptyInbox.title}
            description={emptyInbox.description}
            actionLabel={emptyInbox.actionLabel}
            onPress={emptyInbox.onPress}
          />
        ) : null}

        {auth.user && ambientCue ? (
          <AmbientCueCard
            signalType={ambientCue.signalType}
            headline={ambientCue.headline}
            body={ambientCue.body}
            metric={ambientCue.metric}
            actionLabel={ambientCue.ctaLabel}
            onPress={() => openAmbientCue(ambientCue, nav)}
            onDismiss={() => {
              void dismissAmbientCue(ambientCue);
            }}
          />
        ) : null}

        {auth.user && inboxItems.length > 0 ? (
          <View style={{ gap: theme.space.md }}>
            <View style={{ gap: theme.space.md }}>
              {inboxItems.slice(0, 8).map((item) => (
                <ActionableInboxRow
                  key={item.id}
                  icon={
                    item.kind === 'assistant_queue'
                      ? 'chatbubbles-outline'
                      : item.kind === 'live'
                        ? 'pulse-outline'
                        : item.kind === 'assignment'
                          ? 'document-text-outline'
                          : item.kind === 'quiz'
                            ? 'help-circle-outline'
                            : 'mail-outline'
                  }
                  title={`${item.title} · ${item.groupName}`}
                  reason={item.reason ?? '這個項目需要你確認下一步'}
                  consequence={item.consequence ?? '後續可能變成更高壓的處理'}
                  nextStep={item.nextStep ?? '先打開內容'}
                  urgency={item.urgency}
                  actionLabel={item.actionLabel}
                  onPress={() => openItem(item)}
                />
              ))}
            </View>

            <View style={{ gap: theme.space.md, marginTop: theme.space.lg }}>
              <Text
                style={{
                  color: theme.colors.muted,
                  fontSize: theme.typography.overline.fontSize,
                  fontWeight: theme.typography.overline.fontWeight ?? '700',
                  letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
                  textTransform: 'uppercase',
                }}
              >
                快速存取
              </Text>
              <Pressable
                onPress={() => navigateToCourseHome(nav, auth.profile?.role)}
                style={({ pressed }) => ({
                  paddingHorizontal: theme.space.md,
                  paddingVertical: theme.space.md,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.82 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                  課程入口
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4 }}>
                  {courseSpaces.length} 門課
                </Text>
              </Pressable>
              <Pressable
                onPress={() => nav?.navigate?.('Dms')}
                style={({ pressed }) => ({
                  paddingHorizontal: theme.space.md,
                  paddingVertical: theme.space.md,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.82 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                  私訊
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4 }}>
                  一對一溝通
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
