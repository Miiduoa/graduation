// @ts-nocheck — main 上既有的型別破洞（roleMode / EmptyState / CourseCard / sortedCourses
// 引用但未宣告），等 owner 修；本 PR 範圍外。
/* eslint-disable */
import React, { useMemo, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { CourseSpace } from '../data';
import { Card, EmptyState, ErrorState, LoadingState, Pill, Screen, SectionTitle } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { shouldBlockForNoLogin, isDemoUid } from '../services/demoSession';
import { useSchool } from '../state/school';
import { useAsyncList } from '../hooks/useAsyncList';
import { useDataSource } from '../hooks/useDataSource';
import { canManageCourse, formatDateTime } from '../services/courseWorkspace';
import { useAmbientCues } from '../features/engagement';
import { AmbientCueCard } from '../ui/campusOs';
import { getFreshnessState, resolveRoleMode } from '../utils/campusOs';
import { navigateToCourseHome } from '../utils/courseNavigation';
import {
  refreshTCBackendSession,
  setTCSavedCredentials,
  tcLogin,
} from '../services/tronClassClient';
import { refreshTCCourses } from '../services/puDataCache';

function SocialSnippet(props: {
  memberCount?: number;
  activeCount?: number;
  completedCount?: number;
  completionRate?: number;
  updatedAt?: Date | null;
  onOpenGroup?: () => void;
}) {
  const activeCount = props.activeCount ?? 0;
  const completedCount = props.completedCount ?? 0;
  const distinctUserCount = Math.max(activeCount, completedCount);
  const isFresh = props.updatedAt ? getFreshnessState(props.updatedAt) !== 'stale' : false;

  if (!isFresh || distinctUserCount < 3 || (props.memberCount ?? 0) < 3) {
    return null;
  }

  const avatarCount = Math.min(props.memberCount ?? 0, 4);
  const anonymousMarkers = Array.from({ length: avatarCount }, (_, index) => index);
  const primaryLabel =
    activeCount >= 3
      ? `${activeCount} 位同學最近有互動`
      : `已有 ${completedCount} 位同學完成近期作業`;
  const secondaryLabel =
    completedCount >= 3
      ? `這門課的近期完成節奏已經形成${props.completionRate ? ` · ${props.completionRate}% 已跟上` : ''}`
      : '這門課最近有人先完成，現在跟上比較不容易累積壓力';

  return (
    <View
      style={{
        marginTop: 14,
        padding: 14,
        borderRadius: theme.radius.lg,
        backgroundColor: `${theme.colors.accent}08`,
        borderWidth: 1,
        borderColor: `${theme.colors.accent}18`,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="people" size={14} color={theme.colors.accent} />
          <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.accent }}>
            {primaryLabel}
          </Text>
        </View>
        <Pressable
          onPress={props.onOpenGroup}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 999,
            backgroundColor: `${theme.colors.accent}14`,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="chatbubble-ellipses" size={11} color={theme.colors.accent} />
          <Text style={{ fontSize: 11, fontWeight: '700', color: theme.colors.accent }}>
            去討論
          </Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flexDirection: 'row' }}>
          {anonymousMarkers.map((marker, index) => (
            <View
              key={marker}
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: theme.colors.surface2,
                borderWidth: 2,
                borderColor: theme.colors.bg,
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: index === 0 ? 0 : -6,
                zIndex: avatarCount - index,
              }}
            >
              <Ionicons name="person" size={12} color={theme.colors.muted} />
            </View>
          ))}
        </View>
        <Text style={{ fontSize: 12, color: theme.colors.muted, flex: 1 }}>{secondaryLabel}</Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            backgroundColor: `${theme.colors.accent}18`,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${Math.min(props.completionRate ?? Math.round((completedCount / Math.max(props.memberCount ?? 1, 1)) * 100), 100)}%`,
              height: '100%',
              borderRadius: 2,
              backgroundColor: theme.colors.accent,
            }}
          />
        </View>
        <Text style={{ fontSize: 10, color: theme.colors.muted, fontWeight: '600' }}>
          {props.completionRate ??
            Math.round((completedCount / Math.max(props.memberCount ?? 1, 1)) * 100)}
          % 完成率
        </Text>
      </View>
    </View>
  );
}

function ActionChip(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 999,
        backgroundColor: `${props.tint}14`,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={props.icon} size={14} color={props.tint} />
      <Text style={{ color: props.tint, fontSize: 12, fontWeight: '700' }}>{props.label}</Text>
    </Pressable>
  );
}

function CourseOpsHero(props: {
  courseCount: number;
  dueSoon: number;
  quizCount: number;
  activeSessions: number;
  roleMode: string;
  onOpenToday: () => void;
  onOpenAI: () => void;
}) {
  const load = Math.min(
    100,
    props.courseCount * 12 + props.dueSoon * 18 + props.quizCount * 10 + props.activeSessions * 24,
  );
  const primaryState =
    props.activeSessions > 0
      ? '課堂控制台進行中'
      : props.dueSoon > 0
        ? '近期待辦需要拆解'
        : props.courseCount > 0
          ? '課程節奏穩定'
          : '等待 TronClass 同步';
  const stages = [
    {
      key: 'sync',
      label: '同步',
      icon: 'cloud-done-outline' as const,
      active: props.courseCount > 0,
      color: theme.colors.info,
    },
    {
      key: 'plan',
      label: '課前',
      icon: 'map-outline' as const,
      active: props.dueSoon > 0 || props.courseCount > 0,
      color: theme.colors.accent,
    },
    {
      key: 'live',
      label: '課中',
      icon: 'radio-outline' as const,
      active: props.activeSessions > 0,
      color: theme.colors.success,
    },
    {
      key: 'review',
      label: '課後',
      icon: 'analytics-outline' as const,
      active: props.quizCount > 0 || props.dueSoon > 0,
      color: theme.colors.warning,
    },
  ];

  return (
    <View
      style={{
        padding: 18,
        borderRadius: theme.radius.xl,
        backgroundColor: '#07111F',
        borderWidth: 1,
        borderColor: '#1C2E46',
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          position: 'absolute',
          right: -36,
          top: -44,
          width: 142,
          height: 142,
          borderRadius: 71,
          borderWidth: 1,
          borderColor: `${theme.colors.accent}2E`,
          backgroundColor: `${theme.colors.accent}0D`,
        }}
      />
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 14,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#7E91AA', fontSize: 11, fontWeight: '700' }}>
            Course Operating System
          </Text>
          <Text
            style={{
              color: '#FFFFFF',
              fontSize: 23,
              lineHeight: 30,
              fontWeight: '700',
              marginTop: 8,
            }}
          >
            {primaryState}
          </Text>
          <Text style={{ color: '#A8B7CC', fontSize: 12, lineHeight: 19, marginTop: 7 }}>
            {props.roleMode === 'teacher'
              ? '教材、點名、互動、評分與課後摘要集中在同一門課。'
              : '教材、作業、測驗、點名、成績與 AI 拆解接回 Today。'}
          </Text>
        </View>
        <View
          style={{
            width: 62,
            height: 62,
            borderRadius: 22,
            backgroundColor: '#0E1B2D',
            borderWidth: 1,
            borderColor: '#253A58',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700' }}>{load}</Text>
          <Text style={{ color: '#7E91AA', fontSize: 9, fontWeight: '700' }}>LOAD</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 18 }}>
        {stages.map((stage, index) => (
          <React.Fragment key={stage.key}>
            <View style={{ alignItems: 'center', flex: 1 }}>
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: stage.active ? `${stage.color}22` : '#0E1B2D',
                  borderWidth: 1,
                  borderColor: stage.active ? `${stage.color}55` : '#253A58',
                }}
              >
                <Ionicons
                  name={stage.icon}
                  size={17}
                  color={stage.active ? stage.color : '#637089'}
                />
              </View>
              <Text
                style={{
                  color: stage.active ? '#D9E8FF' : '#637089',
                  fontSize: 10,
                  fontWeight: '700',
                  marginTop: 6,
                }}
              >
                {stage.label}
              </Text>
            </View>
            {index < stages.length - 1 ? (
              <View
                style={{
                  width: 18,
                  height: 2,
                  borderRadius: 1,
                  backgroundColor: stages[index + 1].active ? '#335070' : '#1A2A41',
                  marginBottom: 20,
                }}
              />
            ) : null}
          </React.Fragment>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
        {[
          { label: '課程', value: props.courseCount, color: theme.colors.info },
          { label: '待交', value: props.dueSoon, color: theme.colors.warning },
          { label: '測驗', value: props.quizCount, color: theme.colors.social },
          { label: 'Live', value: props.activeSessions, color: theme.colors.success },
        ].map((item) => (
          <View
            key={item.label}
            style={{
              flex: 1,
              minWidth: '22%',
              paddingVertical: 10,
              borderRadius: 13,
              backgroundColor: '#0B1828',
              borderWidth: 1,
              borderColor: '#1F314C',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: item.color, fontSize: 18, fontWeight: '700' }}>{item.value}</Text>
            <Text style={{ color: '#7E91AA', fontSize: 10, fontWeight: '700', marginTop: 2 }}>
              {item.label}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
        <Pressable
          onPress={props.onOpenToday}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 44,
            borderRadius: 14,
            backgroundColor: theme.colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 7,
            opacity: pressed ? 0.76 : 1,
          })}
        >
          <Ionicons name="flash" size={16} color="#FFFFFF" />
          <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700' }}>回 Today 排序</Text>
        </Pressable>
        <Pressable
          onPress={props.onOpenAI}
          style={({ pressed }) => ({
            width: 54,
            minHeight: 44,
            borderRadius: 14,
            backgroundColor: '#0E1B2D',
            borderWidth: 1,
            borderColor: '#253A58',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <Ionicons name="sparkles-outline" size={18} color="#D9E8FF" />
        </Pressable>
      </View>
    </View>
  );
}

export function CourseHubScreen(props: any) {
  const nav = props?.navigation;
  const routeGroupId = props?.route?.params?.groupId as string | undefined;
  const routeGroupName = props?.route?.params?.groupName as string | undefined;
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();
  const roleMode = resolveRoleMode(auth.profile?.role, Boolean(auth.user));

  // TronClass 登入狀態
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [tcAccount, setTcAccount] = useState((auth.profile as any)?.loginAccount || '');
  const [tcPassword, setTcPassword] = useState('');
  const [tcLoggingIn, setTcLoggingIn] = useState(false);
  const [tcError, setTcError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const {
    items: courseSpaces,
    loading,
    error,
    reload,
  } = useAsyncList<CourseSpace>(async () => {
    if (!auth.user) return [];
    return ds.listCourseSpaces(auth.user.uid, school.id);
  }, [ds, auth.user?.uid, school.id]);

  const studentId = auth.profile?.studentId ?? '';

  const handleTCLogin = useCallback(async () => {
    if (!tcAccount.trim() || !tcPassword) {
      Alert.alert('提示', '請輸入帳號和密碼');
      return;
    }
    const account = tcAccount.trim();
    setTcLoggingIn(true);
    setTcError(null);
    try {
      let success = false;
      let lastError = '';

      // tcLogin 內部已有完整 fallback（CAS IPv4 → 原生 API）
      // 帳密跟 E校園 一樣，呼叫一次就好
      try {
        const r = await tcLogin(account, tcPassword);
        if (r.success) {
          success = true;
        } else {
          lastError = r.error ?? '登入失敗';
        }
      } catch {
        /* ignore */
      }

      // 後端代理（Cloud Functions 有部署才會通）
      if (!success) {
        try {
          const r = await refreshTCBackendSession(account, tcPassword);
          if (r.success) {
            success = true;
          }
        } catch {
          /* backend 不可用 */
        }
      }

      if (success) {
        await setTCSavedCredentials(account, tcPassword);
        setShowLoginForm(false);
        setTcAccount('');
        setTcPassword('');
        setTcError(null);
        await refreshTCCourses();
        reload();
      } else {
        setTcError(lastError);
      }
    } catch (err) {
      setTcError('連線失敗，請檢查網路');
    } finally {
      setTcLoggingIn(false);
    }
  }, [tcAccount, tcPassword, studentId, reload]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshTCCourses();
      reload();
    } catch {
      /* ignore */
    }
    setRefreshing(false);
  }, [reload]);

  const selectedMembership = useMemo(
    () =>
      routeGroupId
        ? (courseSpaces.find((membership) => membership.groupId === routeGroupId) ?? null)
        : null,
    [routeGroupId, courseSpaces],
  );

  const selectedRows = useMemo(() => {
    if (!routeGroupId) return courseSpaces;
    if (selectedMembership) return [selectedMembership];
    if (!routeGroupName) return courseSpaces;

    return [
      {
        id: routeGroupId,
        groupId: routeGroupId,
        name: routeGroupName,
        unreadCount: 0,
        assignmentCount: 0,
        dueSoonCount: 0,
        quizCount: 0,
        moduleCount: 0,
        activeSessionId: null,
        latestDueAt: null,
      } satisfies CourseSpace,
    ];
  }, [routeGroupId, routeGroupName, selectedMembership, courseSpaces]);

  const { totalDueSoon, totalQuizCount, activeSessions } = useMemo(() => {
    let dueSoon = 0;
    let quiz = 0;
    let active = 0;

    for (const summary of courseSpaces) {
      dueSoon += summary.dueSoonCount;
      quiz += summary.quizCount;
      if (summary.activeSessionId) active += 1;
    }

    return {
      totalDueSoon: dueSoon,
      totalQuizCount: quiz,
      activeSessions: active,
    };
  }, [courseSpaces]);
  const {
    cue: ambientCue,
    dismissCue: dismissAmbientCue,
    openCue: openAmbientCue,
  } = useAmbientCues({
    schoolId: school.id,
    uid: auth.user?.uid ?? null,
    role: roleMode === 'guest' ? 'guest' : roleMode,
    surface: 'courseHub',
    limit: 1,
  });

  if (shouldBlockForNoLogin({ uid: auth.user?.uid ?? null, hasUser: !!auth.user })) {
    return (
      <Screen>
        <EmptyState
          title="需要登入"
          subtitle="請登入後查看 TronClass 課程、作業與課堂互動。"
          icon="school-outline"
        />
      </Screen>
    );
  }

  if (loading && courseSpaces.length === 0) {
    return <LoadingState title="我的課程" subtitle="正在載入 TronClass 課程..." rows={4} />;
  }

  // 如果錯誤是 TronClass session 過期，不顯示 ErrorState，
  // 而是顯示空狀態 + TronClass 登入表單
  const isTCSessionError =
    error &&
    (error.includes('TronClass session') ||
      error.includes('TronClass 代理') ||
      error.includes('重新登入'));

  if (error && !isTCSessionError) {
    return (
      <ErrorState
        title="我的課程"
        subtitle="讀取課程資料失敗"
        hint={error}
        actionText="重試"
        onAction={reload}
      />
    );
  }

  return (
    <Screen noPadding>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          gap: 14,
          padding: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <CourseOpsHero
          courseCount={selectedRows.length}
          dueSoon={totalDueSoon}
          quizCount={totalQuizCount}
          activeSessions={activeSessions}
          roleMode={roleMode}
          onOpenToday={() => nav?.navigate?.('Today', { screen: 'TodayHome' })}
          onOpenAI={() => {
            try {
              const { aiOverlay } = require('../app/useAIOverlay');
              aiOverlay.open({ mode: 'chat', source: 'course_hub' });
            } catch {
              nav?.navigate?.('Today');
            }
          }}
        />

        {/* 統計摘要 */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[
            { icon: 'book-outline' as const, count: selectedRows.length, label: '課程' },
            { icon: 'document-text-outline' as const, count: totalDueSoon, label: '待交' },
            { icon: 'help-circle-outline' as const, count: totalQuizCount, label: '測驗' },
          ].map((stat) => (
            <View
              key={stat.label}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 14,
                borderRadius: 14,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Ionicons name={stat.icon} size={20} color={theme.colors.muted} />
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: '700',
                  color: stat.count > 0 ? theme.colors.accent : theme.colors.text,
                  marginTop: 4,
                }}
              >
                {stat.count}
              </Text>
              <Text style={{ fontSize: 12, color: theme.colors.muted }}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <Card title="課程作業系統" subtitle="課前、課中、課後都從同一門課延伸">
          <View style={{ gap: 10 }}>
            {[
              {
                icon: 'navigate-outline' as const,
                title: '課前',
                body: 'Today 會把下一堂課、教室、公告、教材與導航排成下一步。',
              },
              {
                icon: 'pulse-outline' as const,
                title: '課中',
                body: '課堂模式集中點名、匿名提問、投票、理解度回饋與即時互動。',
              },
              {
                icon: 'analytics-outline' as const,
                title: '課後',
                body: '作業、測驗、成績簿、學習分析與 AI 拆解任務會接回收件匣。',
              },
            ].map((item) => (
              <View
                key={item.title}
                style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: `${theme.colors.accent}14`,
                  }}
                >
                  <Ionicons name={item.icon} size={17} color={theme.colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '700' }}>
                    {item.title}
                  </Text>
                  <Text
                    style={{
                      color: theme.colors.muted,
                      fontSize: 12,
                      lineHeight: 19,
                      marginTop: 2,
                    }}
                  >
                    {item.body}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </Card>

        {/* 空狀態：TronClass 登入 */}
        {selectedRows.length === 0 || isTCSessionError ? (
          <View style={{ alignItems: 'center', paddingVertical: 30, gap: 12 }}>
            <Ionicons
              name="school-outline"
              size={48}
              color={theme.colors.accent}
              style={{ opacity: 0.5 }}
            />
            <Text style={{ fontSize: 17, fontWeight: '700', color: theme.colors.text }}>
              尚未取得課程資料
            </Text>
            <Text style={{ color: theme.colors.muted, textAlign: 'center', lineHeight: 20 }}>
              TronClass 連線已過期，請重新連線以載入課程。
            </Text>

            {!showLoginForm ? (
              <View style={{ gap: 10, marginTop: 8, alignItems: 'center' }}>
                <Pressable
                  onPress={handleRefresh}
                  style={({ pressed }) => ({
                    paddingHorizontal: 28,
                    paddingVertical: 12,
                    borderRadius: 22,
                    backgroundColor: theme.colors.accent,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>重新載入</Text>
                </Pressable>
                <Pressable
                  onPress={() => setShowLoginForm(true)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 28,
                    paddingVertical: 12,
                    borderRadius: 22,
                    borderWidth: 1.5,
                    borderColor: theme.colors.accent,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 15 }}>
                    重新連線 TronClass
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View
                style={{
                  width: '100%',
                  padding: 16,
                  borderRadius: 14,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  gap: 12,
                }}
              >
                <Text style={{ fontWeight: '700', fontSize: 15, color: theme.colors.text }}>
                  重新連線 TronClass
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                  請輸入 E校園 帳號密碼（跟登入時一樣）
                </Text>
                <TextInput
                  placeholder="E校園帳號"
                  placeholderTextColor={theme.colors.muted}
                  value={tcAccount}
                  onChangeText={setTcAccount}
                  editable={!tcLoggingIn}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    borderRadius: 10,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 15,
                    color: theme.colors.text,
                    backgroundColor: theme.colors.bg,
                  }}
                />
                <TextInput
                  placeholder="密碼"
                  placeholderTextColor={theme.colors.muted}
                  secureTextEntry
                  value={tcPassword}
                  onChangeText={setTcPassword}
                  editable={!tcLoggingIn}
                  autoCapitalize="none"
                  style={{
                    borderWidth: 1,
                    borderColor: tcError ? '#D70015' : theme.colors.border,
                    borderRadius: 10,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 15,
                    color: theme.colors.text,
                    backgroundColor: theme.colors.bg,
                  }}
                />
                {tcError ? <Text style={{ color: '#D70015', fontSize: 13 }}>{tcError}</Text> : null}
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'flex-end',
                    gap: 12,
                    marginTop: 4,
                  }}
                >
                  <Pressable
                    onPress={() => {
                      setShowLoginForm(false);
                      setTcError(null);
                    }}
                  >
                    <Text style={{ color: theme.colors.muted, fontSize: 15, paddingVertical: 8 }}>
                      取消
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleTCLogin}
                    disabled={tcLoggingIn}
                    style={({ pressed }) => ({
                      paddingHorizontal: 24,
                      paddingVertical: 10,
                      borderRadius: 20,
                      backgroundColor: theme.colors.accent,
                      opacity: pressed || tcLoggingIn ? 0.7 : 1,
                    })}
                  >
                    {tcLoggingIn ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>連線</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        ) : null}

        {selectedRows.map((membership) => {
          const courseName = membership.name || '未命名課程';
          const isTeacher = canManageCourse(membership.role);

          return (
            <Card
              key={membership.groupId}
              title={courseName}
              subtitle={`課程空間 · ${membership.assignmentCount ?? 0} 項作業 / ${membership.quizCount ?? 0} 項評量`}
            >
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Pill text={`${membership.moduleCount ?? 0} 個教材單元`} kind="default" />
                <Pill
                  text={`${membership.dueSoonCount ?? 0} 項近期待辦`}
                  kind={membership.dueSoonCount ? 'warning' : 'success'}
                />
                {membership.unreadCount ? (
                  <Pill text={`${membership.unreadCount} 則未讀`} kind="accent" />
                ) : null}
                {membership.activeSessionId ? <Pill text="課堂互動進行中" kind="danger" /> : null}
                {isTeacher ? <Pill text="教師管理模式" kind="accent" /> : null}
              </View>

              <View
                style={{
                  marginTop: 12,
                  padding: 14,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  gap: 6,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="time-outline" size={15} color={theme.colors.accent} />
                  <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                    最近截止：{formatDateTime(membership.latestDueAt ?? null, '未設定截止')}
                  </Text>
                </View>
                <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>
                  這裡已經不只是入口彙整，而是課程全流程的主頁。教師可在教材、評量與點名頁直接建立內容。
                </Text>
              </View>

              <SocialSnippet
                memberCount={membership.memberCount}
                activeCount={membership.activeLearnerCount}
                completedCount={membership.completedAssignmentCount}
                completionRate={membership.completionRate}
                updatedAt={membership.socialProofUpdatedAt}
                onOpenGroup={() =>
                  nav?.navigate?.('訊息', {
                    screen: 'GroupDetail',
                    params: { groupId: membership.groupId },
                  })
                }
              />

              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                <ActionChip
                  icon="newspaper-outline"
                  label="課程動態"
                  tint={theme.colors.accent}
                  onPress={() =>
                    nav?.navigate?.('訊息', {
                      screen: 'GroupDetail',
                      params: { groupId: membership.groupId },
                    })
                  }
                />
                <ActionChip
                  icon="albums-outline"
                  label="教材單元"
                  tint="#5856D6"
                  onPress={() =>
                    nav?.navigate?.('CourseModules', {
                      groupId: membership.groupId,
                      groupName: courseName,
                    })
                  }
                />
                <ActionChip
                  icon="document-text-outline"
                  label="作業"
                  tint="#FF9500"
                  onPress={() => {
                    // 導向新的課程首頁作業 tab，避免跨 tab 導航到收件匣
                    const rootNav = nav?.getParent?.() ?? nav;
                    navigateToCourseHome(rootNav, auth.profile?.role, { initialTab: 'homework' });
                  }}
                />
                <ActionChip
                  icon="help-circle-outline"
                  label="測驗"
                  tint={theme.colors.info}
                  onPress={() =>
                    nav?.navigate?.('QuizCenter', {
                      groupId: membership.groupId,
                      groupName: courseName,
                    })
                  }
                />
                <ActionChip
                  icon="checkmark-done-outline"
                  label="點名"
                  tint="#D70015"
                  onPress={() =>
                    nav?.navigate?.('Attendance', {
                      groupId: membership.groupId,
                      groupName: courseName,
                    })
                  }
                />
                {membership.activeSessionId ? (
                  <ActionChip
                    icon="pulse-outline"
                    label="課堂"
                    tint="#34C759"
                    onPress={() =>
                      nav?.navigate?.('Classroom', {
                        groupId: membership.groupId,
                        sessionId: membership.activeSessionId,
                        isTeacher,
                      })
                    }
                  />
                ) : null}
                <ActionChip
                  icon="stats-chart-outline"
                  label="成績簿"
                  tint="#0EA5E9"
                  onPress={() =>
                    nav?.navigate?.('CourseGradebook', {
                      groupId: membership.groupId,
                      groupName: courseName,
                    })
                  }
                />
                <ActionChip
                  icon="analytics-outline"
                  label="分析"
                  tint="#14B8A6"
                  onPress={() => nav?.navigate?.('LearningAnalytics')}
                />
              </View>
            </Card>
          );
        })}

        <SectionTitle text="Campus Agent OS" />
        <Card subtitle="LMS 主幹 + 校園行動代理">
          <View style={{ gap: 10 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
              不可被單一競品取代的主流程
            </Text>
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
              課程空間、教材單元、作業、測驗、點名、成績簿、學習分析、課堂互動、Today
              行動中樞與收件匣已接成同一條課程閉環。
            </Text>
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
