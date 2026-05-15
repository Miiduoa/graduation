/* eslint-disable */
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  NavigationContainer,
  DefaultTheme,
  type LinkingOptions,
} from '@react-navigation/native';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { AppActionIcon } from './src/ui/AppActionIcon';
import {
  ActivityIndicator,
  View,
  Text,
  AppState,
  AppStateStatus,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';

import { theme, softShadowStyle } from './src/ui/theme';
import { SchoolProvider, useSchool } from './src/state/school';
import { FavoritesProvider } from './src/state/favorites';
import { DemoProvider } from './src/state/demo';
import { AuthProvider, useAuth } from './src/state/auth';
import { ThemeProvider, useThemeMode } from './src/state/theme';
import { NotificationsProvider } from './src/state/notifications';
import { SearchHistoryProvider } from './src/state/searchHistory';
import { ScheduleProvider } from './src/state/schedule';
import { PreferencesProvider } from './src/state/preferences';
import { AccessibilityProvider } from './src/state/accessibility';
import { I18nProvider } from './src/i18n';
import { analytics } from './src/services/analytics';
import { initOfflineModeSync, setHybridSourceSchoolContext } from './src/data';
import {
  initNetworkMonitoring,
  syncEssentialData,
  subscribeToSyncEvents,
  subscribeToConflicts,
  getPendingConflicts,
  resolveConflict,
  clearPendingConflict,
  ConflictInfo,
} from './src/services/offline';
import { ToastProvider, useToast } from './src/ui/Toast';
import { FullScreenLoader } from './src/ui/components';
import { NetworkStatusBanner } from './src/ui/OfflineBanner';
import { ConflictResolutionModal } from './src/ui/ConflictResolutionModal';

import { HomeStack } from './src/screens/HomeStack';
import { LearnStack } from './src/screens/LearnStack';
import { MapStack } from './src/screens/MapStack';
import { MessagesStack } from './src/screens/MessagesStack';
import { MeStack } from './src/screens/MeStack';
import { OnboardingScreen, hasSeenOnboarding } from './src/screens/OnboardingScreen';
import { PreAuthStack } from './src/screens/PreAuthStack';
import { usePushNotifications } from './src/app/usePushNotifications';
import { useAIAmbientAwareness } from './src/app/useAIAmbientAwareness';
import { useAIBrainLifecycle } from './src/app/useAIBrain';
import { GlobalAIConfirmModalHost } from './src/components/GlobalAIConfirmModalHost';
import { AIOverlayHost } from './src/components/AIOverlayHost';
import { aiOverlay } from './src/app/useAIOverlay';
import { HeaderDrawerHost } from './src/components/HeaderDrawer';
import { AIFloatingBall } from './src/components/AIFloatingBall';
import { useProactiveAIReporter } from './src/app/useProactiveAIReporter';
import { useProactiveAIAgentLoop } from './src/app/useProactiveAIAgentLoop';
import { useWebLearningSync } from './src/app/useWebLearningSync';
import { initializeRuntimeDataSource } from './src/config/runtime';
import { usePermissions } from './src/hooks/usePermissions';
import {
  rootNavigateNested,
  rootNavigationRef,
  type RootTabParamList,
} from './src/app/rootNavigation';
import {
  parseGroupAssignmentDeepLink,
  parseGroupAssignmentsListDeepLink,
  parseGroupCourseHubDeepLink,
  isInterceptedMessagingDeepLink,
} from './src/app/assignmentDeepLink';
import { navigateFromInboxTask, inboxTaskFromLegacyAssignmentActionTarget } from './src/services/inboxActions';
import { isTeachingRole } from './src/utils/campusOs';
import type { InboxTask } from './src/data/types';
import { navigateToCourseScreen } from './src/utils/courseNavigation';
import { initCrossModuleConnections } from './src/services/crossModuleConnector';
import { registerCompanionCampusBusBridge } from './src/services/companionBusBridge';

/**
 * 4+1 AI-First 導航架構
 *
 *   [ 今天 ] [ 學習 ]  ✨AI 球✨  [ 校園 ] [ 訊息 ]
 *
 * + 隱藏 Tab「我的」：透過左上角頭像抽屜（HeaderDrawer）開啟
 *
 * 設計根據：
 * - Hick's Law: 首層只 4 個情境 Tab（今天/學習/校園/訊息），名字所有角色一致
 * - Fitts's Law: 中央 AI 球比兩側 Tab 大、突出 → 高頻最易點
 * - Spatial Memory: 左上頭像 = 個人，右下/中央 AI = 助理（與通用心智模型對齊）
 * - AI-First: AI 不是其中一個 Tab，而是整個 App 的作業系統（懸浮在所有畫面之上）
 * - 角色策略: Tab 名字統一，內容由 LearnStack 等內部 dispatcher 依角色適配
 */
const Tab = createBottomTabNavigator<RootTabParamList, undefined>();

type TabKey = keyof RootTabParamList;

function assignmentTaskFromDeepLink(parsed: {
  groupId: string;
  assignmentId: string;
  isQuiz?: boolean;
}): InboxTask {
  const isQuiz = !!parsed.isQuiz;
  return {
    id: `deeplink-${parsed.assignmentId}`,
    kind: isQuiz ? 'quiz' : 'assignment',
    groupId: parsed.groupId,
    groupName: '課程',
    title: isQuiz ? '測驗' : '作業',
    subtitle: '',
    assignmentId: parsed.assignmentId,
    priority: 50,
  };
}

const linkingBase: LinkingOptions<RootTabParamList> = {
  prefixes: [Linking.createURL('/'), 'campus://'],
  config: {
    screens: {
      Today: {
        screens: {
          TodayHome: 'home',
          公告總覽: 'announcements',
          公告詳情: 'announcement/:id',
          活動總覽: 'events',
          活動詳情: 'event/:id',
          CampusSocialScreen: 'community',
          BoardDetail: 'board/:boardId',
          PostCompose: 'post/new',
          StoryCompose: 'story/new',
          PostDetail: 'post/:postId',
          SmartCalendarScreen: 'calendar',
          CampusGame: 'home/campus-game',
        },
      },
      學習: {
        screens: {
          LearnHome: 'learn',
          CoursesHome: 'courses',
          TeachingHub: 'teaching',
          StaffHub: 'staff',
          DepartmentHub: 'department',
          AdminDashboard: 'admin',
          CourseSchedule: 'schedule',
          AddCourse: 'course/new',
          CourseHub: 'course-hub',
          CourseCatalog: 'course-catalog',
          CourseModules: 'course-modules',
          QuizCenter: 'quiz-center',
          Attendance: 'attendance',
          Classroom: 'classroom/:sessionId',
          AcademicOverview: 'academic-overview',
          AcademicInsights: 'academic-insights',
          LearningAnalytics: 'learning-analytics',
          CourseGradebook: 'course-gradebook',
          Grades: 'grades',
          Calendar: 'learn/calendar',
          AICourseAdvisor: 'ai-advisor',
          AdminCourseVerify: 'course-verify',
        },
      },
      校園: {
        screens: {
          CampusHome: 'campus',
          Map: 'map',
          PoiDetail: 'poi/:id',
          ARNavigation: 'ar-nav/:destinationId',
          AccessibleRoute: 'accessible-route/:destination',
          BusSchedule: 'bus',
          餐廳總覽: 'cafeteria',
          MenuDetail: 'menu/:id',
          Ordering: 'ordering/:menuId',
          MenuSubscription: 'menu-subscription',
          Library: 'library',
          Health: 'health',
          Dormitory: 'dormitory',
          PrintService: 'print',
          LostFound: 'lost-found',
          LostFoundDetail: 'lost-found/:id',
          LostFoundPost: 'lost-found/post',
          Payment: 'payment',
        },
      },
      訊息: {
        screens: {
          Inbox: 'inbox',
          MessagesHome: 'messages',
          Groups: 'groups',
          GroupDetail: 'group/:groupId',
          GroupPost: 'group/:groupId/post/:postId',
          GroupAssignments: 'group/:groupId/assignments',
          AssignmentDetail: 'group/:groupId/assignment/:assignmentId',
          Dms: 'dms',
          FriendSearch: 'friend-search',
          FriendsManage: 'friends',
          FollowingLists: 'following-lists',
          Chat: 'chat/:peerId',
          AdminCourseVerify: 'messages/course-verify',
        },
      },
      我的: {
        screens: {
          MeHome: 'profile',
          Settings: 'settings',
          Notifications: 'notifications',
          NotificationSettings: 'notification-settings',
          ProfileEdit: 'profile/edit',
          QRCode: 'qrcode',
          GlobalSearch: 'search',
          Achievements: 'achievements',
          CampusGarden: 'campus-garden',
          DataExport: 'data-export',
          AccountDeletion: 'account-deletion',
          SSOLogin: 'sso-login',
        },
      },
    },
  },
};

const { usingFirebase: USING_FIREBASE } = initializeRuntimeDataSource();

function SyncStatusHandler() {
  const toast = useToast();
  const [conflicts, setConflicts] = useState<ConflictInfo[]>(() => getPendingConflicts());
  const [showConflictModal, setShowConflictModal] = useState(
    () => getPendingConflicts().length > 0,
  );

  useEffect(() => {
    const unsubscribeConflicts = subscribeToConflicts((info) => {
      setConflicts((prev) => {
        const exists = prev.some((c) => c.action.id === info.action.id);
        if (exists) return prev;
        return [...prev, info];
      });
      setShowConflictModal(true);
    });

    return unsubscribeConflicts;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToSyncEvents((event) => {
      switch (event.type) {
        case 'queued':
          toast.show({
            message: '目前離線，操作將在網路恢復後同步',
            type: 'info',
            duration: 3000,
          });
          break;
        case 'sync_complete':
          if (event.processed && event.processed > 0) {
            toast.show({
              message: `已同步 ${event.processed} 筆資料`,
              type: 'success',
              duration: 2000,
            });
          }
          break;
        case 'sync_error':
          toast.show({
            message: `同步失敗：${event.error?.message ?? '未知錯誤'}`,
            type: 'error',
            duration: 4000,
          });
          break;
        case 'conflict':
          toast.show({
            message: '部分資料與伺服器衝突，請檢查',
            type: 'warning',
            duration: 4000,
          });
          break;
      }
    });

    return unsubscribe;
  }, [toast]);

  const handleResolveConflict = async (
    actionId: string,
    resolution: 'keep_local' | 'keep_server' | 'merge',
  ) => {
    try {
      await resolveConflict(actionId, resolution);
      clearPendingConflict(actionId);
      setConflicts((prev) => prev.filter((c) => c.action.id !== actionId));

      toast.show({
        message: '衝突已解決',
        type: 'success',
        duration: 2000,
      });
    } catch (error) {
      toast.show({
        message: '解決衝突失敗，請重試',
        type: 'error',
        duration: 3000,
      });
    }
  };

  const handleDismissConflictModal = () => {
    setShowConflictModal(false);
  };

  return (
    <ConflictResolutionModal
      visible={showConflictModal}
      conflicts={conflicts}
      onResolve={handleResolveConflict}
      onDismiss={handleDismissConflictModal}
    />
  );
}

function TokenExpiredModal() {
  const auth = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleSignOut = async () => {
    setIsLoggingOut(true);
    try {
      await auth.signOut();
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleDismiss = () => {
    auth.clearTokenError();
  };

  if (!auth.tokenExpired) return null;

  return (
    <Modal
      visible={auth.tokenExpired}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.6)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
        }}
      >
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.xl,
            padding: 28,
            width: '100%',
            maxWidth: 340,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: theme.colors.border,
            ...softShadowStyle(theme.shadows.soft),
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              backgroundColor: theme.colors.dangerSoft,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <AppActionIcon name="ic_session_expired_clock" size={32} />
          </View>

          <Text
            style={{
              color: theme.colors.text,
              fontSize: 18,
              fontWeight: '700',
              textAlign: 'center',
              marginBottom: 8,
            }}
          >
            登入狀態已過期
          </Text>

          <Text
            style={{
              color: theme.colors.muted,
              fontSize: 14,
              textAlign: 'center',
              lineHeight: 22,
              marginBottom: 24,
            }}
          >
            您的登入已過期或在其他裝置登入。為了保護您的帳號安全，請重新登入。
          </Text>

          <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
            <Pressable
              onPress={handleDismiss}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 13,
                borderRadius: theme.radius.md,
                backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface2,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: 'center',
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 14 }}>
                離線繼續
              </Text>
            </Pressable>

            <Pressable
              onPress={handleSignOut}
              disabled={isLoggingOut}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 13,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.accent,
                alignItems: 'center',
                opacity: isLoggingOut || pressed ? 0.8 : 1,
              })}
            >
              {isLoggingOut ? (
                <ActivityIndicator size="small" color={theme.colors.onAccent} />
              ) : (
                <Text style={{ color: theme.colors.onAccent, fontWeight: '700', fontSize: 14 }}>
                  重新登入
                </Text>
              )}
            </Pressable>
          </View>

          <Text
            style={{
              color: theme.colors.muted,
              fontSize: 11,
              textAlign: 'center',
              marginTop: 14,
              lineHeight: 16,
            }}
          >
            離線模式下仍可瀏覽已快取的資料
          </Text>
        </View>
      </View>
    </Modal>
  );
}

function TokenErrorHandler() {
  const auth = useAuth();
  const toast = useToast();

  useEffect(() => {
    if (auth.tokenError && auth.tokenError.message !== 'TOKEN_REFRESH_EXHAUSTED') {
      toast.show({
        message: '連線問題，稍後會自動重試',
        type: 'warning',
        duration: 3000,
      });
    }
  }, [auth.tokenError, toast]);

  return <TokenExpiredModal />;
}

function AuthAwareStateProviders({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const { school } = useSchool();
  const userId = auth.user?.uid ?? null;
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    if (userId) {
      analytics.setUserId(userId);
      analytics.setFirebaseUserId(userId);
    } else {
      analytics.setUserId(null);
      analytics.setFirebaseUserId(null);
    }
  }, [userId]);

  useEffect(() => {
    setHybridSourceSchoolContext(school?.id ?? null);
  }, [school?.id]);

  useEffect(() => {
    if (school?.id && userId) {
      syncEssentialData(school.id).catch(console.error);
    }
  }, [school?.id, userId]);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        school?.id
      ) {
        syncEssentialData(school.id).catch(console.error);
      }
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        import('./src/services/companionEngine')
          .then(({ applyForegroundCompanionTick }) => applyForegroundCompanionTick())
          .catch(() => void 0);
        import('./src/services/productFeedback')
          .then(({ flushFeedbackQueue }) => flushFeedbackQueue())
          .catch(() => void 0);
      }
      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, [school?.id]);

  const schoolId = school?.id ?? null;

  return (
    <SearchHistoryProvider userId={userId} schoolId={schoolId}>
      <FavoritesProvider userId={userId} schoolId={schoolId}>
        <ScheduleProvider>
          <SyncStatusHandler />
          <TokenErrorHandler />
          {children}
        </ScheduleProvider>
      </FavoritesProvider>
    </SearchHistoryProvider>
  );
}

/**
 * FloatingTabBar — 4+1 AI-First 導航
 *
 * 佈局：
 *   [ 今天 ] [ 學習 ]  ✨AI 球✨  [ 校園 ] [ 訊息 ]
 *
 * - 4 個情境 Tab 平均分布兩側
 * - 中央 AI 球凸出於 TabBar 上方（懸浮 FAB）
 * - 「我的」Tab 不顯示於 Bar 上，僅供 HeaderDrawer 內部 navigate 觸發
 *
 * 心理學：
 * - Fitts's Law：AI 球大且置中 → 高頻最易點
 * - Affordance：球體會脈動（活的）vs Tab 是死的（被動）
 * - Mental Model：使用者學到「找東西點 Tab；要 AI 做點球」
 */
/** 須與下方 AIFloatingBall size 一致 */
const FAB_SIZE = 62;
/** 整顆 FAB 相對 Tab 列的微調（像素；預設 0，避免與章面 nudge 疊加偏移） */
const FAB_SHELL_NUDGE_X = 0;
const FAB_SHELL_NUDGE_Y = 0;
/** 與 TabBar pill `paddingVertical` 對齊，供 FAB overlay 垂直錨點 */
const TAB_BAR_PILL_PADDING_V = 6;
/** 中央為 AI 球保留的淨空；若拿掉會讓左右各兩個 Tab 往中線擠、視覺與點擊區「跑掉」 */
const FAB_CENTER_GAP = Math.max(72, FAB_SIZE + 10);

function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const permissions = usePermissions();

  // 只顯示 4 個情境 Tab，過濾掉 '我的' 隱藏 Tab
  const visibleTabKeys = permissions.tabs.map((t) => t.key);
  const visibleRoutes = state.routes.filter((r) => visibleTabKeys.includes(r.name));

  // 左 2／右 2 之間保留 FAB_CENTER_GAP，避免 Tab 標籤與中央球在版面與心理上重疊
  const leftRoutes = visibleRoutes.slice(0, 2);
  const rightRoutes = visibleRoutes.slice(2, 4);

  const renderTab = (route: typeof visibleRoutes[number]) => {
    const originalIndex = state.routes.findIndex((r) => r.key === route.key);
    const { options } = descriptors[route.key];
    const focused = state.index === originalIndex;
    const config = permissions.tabs.find((t) => t.key === route.name);
    const iconName = config?.icon ?? 'ic_tab_today';

    return (
      <Pressable
        key={route.key}
        testID={`tab-${String(route.name)}`}
        accessibilityRole="button"
        accessibilityState={focused ? { selected: true } : {}}
        accessibilityLabel={options.tabBarAccessibilityLabel}
        onPress={() => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        }}
        style={({ pressed }) => ({
          flex: 1,
          justifyContent: 'center',
          transform: [{ scale: pressed ? 0.94 : 1 }],
        })}
      >
        <View
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            paddingVertical: 9,
            paddingHorizontal: 4,
            borderRadius: theme.radius.md,
            backgroundColor: focused ? theme.colors.chromeTabItemActive : 'transparent',
            minHeight: 52,
          }}
        >
          <AppActionIcon
            name={iconName}
            size={focused ? 22 : 20}
            fallback="ionicon"
            color={focused ? theme.colors.accent : theme.colors.muted}
            style={{ opacity: focused ? 1 : 0.55 }}
          />
          <Text
            style={{
              fontSize: 10,
              lineHeight: 13,
              fontWeight: focused ? '700' : '600',
              color: focused ? theme.colors.accent : theme.colors.muted,
              letterSpacing: focused ? 0.15 : 0.25,
            }}
          >
            {config?.label ?? route.name}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View
      style={{
        position: 'absolute',
        bottom: Math.max(insets.bottom, 8) + 8,
        left: 12,
        right: 12,
        minHeight: 72,
      }}
      pointerEvents="box-none"
    >
      {/* TabBar pill：左右僅四個 Tab；FAB 另層絕對 overlay 對齊 pill 寬度幾何置中 */}
      <View
        style={{
          flex: 1,
          position: 'relative',
          flexDirection: 'row',
          alignItems: 'stretch',
          overflow: 'visible',
          borderRadius: theme.radius.xl,
          paddingVertical: TAB_BAR_PILL_PADDING_V,
          paddingHorizontal: 10,
          borderWidth: 1,
          borderColor: theme.colors.chromeTabBorder,
          backgroundColor: theme.colors.chromeTabBar,
          ...softShadowStyle(theme.shadows.soft),
        }}
      >
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'stretch',
            minWidth: 0,
            zIndex: 1,
          }}
        >
          {leftRoutes.map(renderTab)}
        </View>

        <View
          style={{
            width: FAB_CENTER_GAP,
            alignSelf: 'stretch',
            zIndex: 1,
          }}
          pointerEvents="none"
        />

        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'stretch',
            minWidth: 0,
            zIndex: 1,
          }}
        >
          {rightRoutes.map(renderTab)}
        </View>

        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: TAB_BAR_PILL_PADDING_V,
            alignItems: 'center',
            zIndex: 10,
          }}
        >
          <View
            style={{
              marginTop: -theme.layout.fabOffset,
              transform: [
                { translateX: FAB_SHELL_NUDGE_X },
                { translateY: FAB_SHELL_NUDGE_Y },
              ],
            }}
            pointerEvents="box-none"
          >
            <AIFloatingBall
              size={FAB_SIZE}
              onPress={() => aiOverlay.open({ mode: 'chat', source: 'tabbar' })}
              onLongPress={() => aiOverlay.open({ mode: 'quick', source: 'tabbar_long' })}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * AppTabNavigator — 統一的 4+1 導航
 *
 * 4 個情境 Tab + 1 個隱藏 Tab（我的，透過 HeaderDrawer 觸發）
 * 不再依角色變 Tab 結構，角色適配交給 LearnStack 內部 dispatcher。
 */
function AppTabNavigator() {
  return (
    <Tab.Navigator
      id={undefined}
      initialRouteName="Today"
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={() => ({
        headerShown: false,
        sceneStyle: { backgroundColor: theme.colors.bg },
      })}
    >
      <Tab.Screen name="Today" component={HomeStack} />
      <Tab.Screen name="學習" component={LearnStack} />
      <Tab.Screen name="校園" component={MapStack} />
      <Tab.Screen name="訊息" component={MessagesStack} />
      {/* 隱藏 Tab：僅作為 HeaderDrawer 跳轉用，不顯示於 TabBar */}
      <Tab.Screen
        name="我的"
        component={MeStack}
        options={{ tabBarButton: () => null }}
      />
    </Tab.Navigator>
  );
}

function AppNavigation() {
  const auth = useAuth();
  const pendingMessagingDeepLinkRef = useRef<string | null>(null);
  const authRoleRef = useRef(auth.profile?.role);
  const authTeachingRef = useRef(isTeachingRole(auth.profile?.role));
  authRoleRef.current = auth.profile?.role;
  authTeachingRef.current = isTeachingRole(auth.profile?.role);

  usePushNotifications(rootNavigationRef, auth.user?.uid, auth.profile?.role);
  useAIAmbientAwareness();
  useAIBrainLifecycle();
  useProactiveAIReporter();
  useProactiveAIAgentLoop();
  useWebLearningSync();

  const flushPendingMessagingDeepLink = useCallback(() => {
    if (!rootNavigationRef.isReady()) return;
    const url = pendingMessagingDeepLinkRef.current;
    if (!url) return;
    pendingMessagingDeepLinkRef.current = null;

    const parsedAssignment = parseGroupAssignmentDeepLink(url);
    if (parsedAssignment) {
      const task = assignmentTaskFromDeepLink(parsedAssignment);
      const ok = navigateFromInboxTask(rootNavigationRef, task, {
        role: authRoleRef.current,
        isTeachingRole: authTeachingRef.current,
      });
      if (!ok) {
        rootNavigateNested('訊息', 'AssignmentDetail', {
          groupId: parsedAssignment.groupId,
          assignmentId: parsedAssignment.assignmentId,
        });
      }
      return;
    }

    const list = parseGroupAssignmentsListDeepLink(url);
    if (list) {
      navigateToCourseScreen(rootNavigationRef, authRoleRef.current, 'CourseHub', {
        groupId: list.groupId,
      });
      return;
    }

    const hub = parseGroupCourseHubDeepLink(url);
    if (hub) {
      navigateToCourseScreen(rootNavigationRef, authRoleRef.current, 'CourseHub', {
        groupId: hub.groupId,
      });
    }
  }, []);

  const linkingConfig = useMemo(
    () => ({
      ...linkingBase,
      async getInitialURL() {
        const url = await Linking.getInitialURL();
        if (url && isInterceptedMessagingDeepLink(url)) {
          pendingMessagingDeepLinkRef.current = url;
          return null;
        }
        return url;
      },
      subscribe(listener: (url: string) => void) {
        const subscription = Linking.addEventListener('url', ({ url }) => {
          const parsedAssignment = parseGroupAssignmentDeepLink(url);
          if (parsedAssignment) {
            if (rootNavigationRef.isReady()) {
              pendingMessagingDeepLinkRef.current = null;
              const task = assignmentTaskFromDeepLink(parsedAssignment);
              const ok = navigateFromInboxTask(rootNavigationRef, task, {
                role: authRoleRef.current,
                isTeachingRole: authTeachingRef.current,
              });
              if (!ok) {
                rootNavigateNested('訊息', 'AssignmentDetail', {
                  groupId: parsedAssignment.groupId,
                  assignmentId: parsedAssignment.assignmentId,
                });
              }
            } else {
              pendingMessagingDeepLinkRef.current = url;
            }
            return;
          }

          const list = parseGroupAssignmentsListDeepLink(url);
          if (list) {
            if (rootNavigationRef.isReady()) {
              pendingMessagingDeepLinkRef.current = null;
              navigateToCourseScreen(rootNavigationRef, authRoleRef.current, 'CourseHub', {
                groupId: list.groupId,
              });
            } else {
              pendingMessagingDeepLinkRef.current = url;
            }
            return;
          }

          const hub = parseGroupCourseHubDeepLink(url);
          if (hub) {
            if (rootNavigationRef.isReady()) {
              pendingMessagingDeepLinkRef.current = null;
              navigateToCourseScreen(rootNavigationRef, authRoleRef.current, 'CourseHub', {
                groupId: hub.groupId,
              });
            } else {
              pendingMessagingDeepLinkRef.current = url;
            }
            return;
          }

          listener(url);
        });
        return () => subscription.remove();
      },
    }),
    [],
  );

  const navTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: theme.colors.bg,
      card: theme.colors.surface,
      text: theme.colors.text,
      border: theme.colors.border,
      primary: theme.colors.accent,
    },
  };

  if (auth.loading || auth.profileLoading) {
    return <FullScreenLoader />;
  }

  // 沒有登入 session → Landing + 可進入正式學校登入（SSOLoginScreen）
  if (!auth.user && !auth.profile) {
    return (
      <NavigationContainer ref={rootNavigationRef} theme={navTheme}>
        <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
          <PreAuthStack />
        </View>
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer
      ref={rootNavigationRef}
      theme={navTheme}
      linking={linkingConfig}
      onReady={flushPendingMessagingDeepLink}
      fallback={<FullScreenLoader />}
    >
      <View style={{ flex: 1 }}>
        <NetworkStatusBanner />
        <AppTabNavigator />
        <GlobalAIConfirmModalHost />
        <AIOverlayHost />
        <HeaderDrawerHost />
      </View>
    </NavigationContainer>
  );
}

function AppInner() {
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const networkCleanup = initNetworkMonitoring();
    import('./src/services/localAssistant')
      .then(({ localAssistant }) => localAssistant.initialize())
      .catch((error) => {
        console.warn('[App] Local assistant initialization failed:', error);
      });

    let offlineModeCleanup: (() => void) | null = null;
    initOfflineModeSync().then((cleanup) => {
      offlineModeCleanup = cleanup;
    });

    initCrossModuleConnections();
    registerCompanionCampusBusBridge();

    import('./src/services/productFeedback')
      .then(({ flushFeedbackQueue }) => flushFeedbackQueue())
      .catch(() => void 0);

    return () => {
      networkCleanup?.();
      offlineModeCleanup?.();
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const hasSeen = await hasSeenOnboarding();
        setShowOnboarding(!hasSeen);
      } catch {
        setShowOnboarding(false);
      } finally {
        setIsCheckingOnboarding(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!USING_FIREBASE) return;
    AsyncStorage.setItem('campus.demoMode.v1', 'normal').catch(() => void 0);
  }, []);

  useThemeMode();

  if (isCheckingOnboarding) {
    return <FullScreenLoader message="準備你的校園體驗…" />;
  }

  if (showOnboarding) {
    return <OnboardingScreen onComplete={() => setShowOnboarding(false)} />;
  }

  return (
    <SchoolProvider>
      <AuthProvider>
        <NotificationsProvider>
          <ToastProvider>
            <AuthAwareStateProviders>
              <DemoProvider>
                <AppNavigation />
              </DemoProvider>
            </AuthAwareStateProviders>
          </ToastProvider>
        </NotificationsProvider>
      </AuthProvider>
    </SchoolProvider>
  );
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[AppErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View
          style={{
            flex: 1,
            backgroundColor: theme.colors.bg,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 32,
          }}
        >
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 24,
              backgroundColor: theme.colors.dangerSoft,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
            }}
          >
            <AppActionIcon name="ic_warning_triangle" size={36} />
          </View>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: 20,
              fontWeight: '700',
              textAlign: 'center',
              marginBottom: 10,
            }}
          >
            應用程式發生錯誤
          </Text>
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: 14,
              textAlign: 'center',
              lineHeight: 22,
              marginBottom: 28,
            }}
          >
            {this.state.error?.message ?? '未知錯誤'}
          </Text>
          <Pressable
            onPress={() => this.setState({ hasError: false, error: null })}
            style={({ pressed }) => ({
              paddingHorizontal: 24,
              paddingVertical: 13,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.accent,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ color: theme.colors.onAccent, fontSize: 15, fontWeight: '700' }}>
              重新嘗試
            </Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <ThemeProvider>
          <AccessibilityProvider>
            <PreferencesProvider>
              <I18nProvider>
                <AppInner />
              </I18nProvider>
            </PreferencesProvider>
          </AccessibilityProvider>
        </ThemeProvider>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}
