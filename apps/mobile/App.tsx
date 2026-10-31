import { useClassReminders } from './src/hooks/useClassReminders';
import { useNextClassWidget } from './src/widgets/useNextClassWidget';
/* eslint-disable */
import { useSubmittedAssignmentReminders } from './src/app/useSubmittedAssignmentReminders';
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  NavigationContainer,
  DefaultTheme,
  getStateFromPath,
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
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';

import { theme, softShadowStyle } from './src/ui/theme';
import { SchoolProvider, useSchool } from './src/state/school';
import { FavoritesProvider } from './src/state/favorites';
import { DemoProvider } from './src/state/demo';
import { DemoRoleProvider } from './src/state/demoRole';
import { DemoStoreProvider } from './src/state/demoStore';
import { AuthProvider, useAuth } from './src/state/auth';
import { PersonalImportSyncBridge } from './src/components/PersonalImportSyncBridge';
import { PersonalEventReminderBridge } from './src/components/PersonalEventReminderBridge';
import {
  markPublicNavigationReady,
  markPublicNavigationUnready,
  publicNavigationRef,
} from './src/app/publicNavigation';
import { NuniSessionProvider } from './src/state/nuniSession';
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
import { SchoolSessionBoundary, hasReadySchoolSession } from './src/app/SchoolSessionBoundary';
import { preAuthLinking } from './src/app/preAuthLinking';
import { usePushNotifications } from './src/app/usePushNotifications';
import { useAIAmbientAwareness } from './src/app/useAIAmbientAwareness';
import { useAIBrainLifecycle } from './src/app/useAIBrain';
import { HeaderDrawerHost } from './src/components/HeaderDrawer';
import { useProactiveAIReporter } from './src/app/useProactiveAIReporter';
import { useProactiveAIAgentLoop } from './src/app/useProactiveAIAgentLoop';
import { useWebLearningSync } from './src/app/useWebLearningSync';
import { initializeRuntimeDataSource } from './src/config/runtime';
import { usePermissions } from './src/hooks/usePermissions';
import { useUnreadMessagingCount } from './src/hooks/useUnreadMessagingCount';
import {
  markSchoolNavigationReady,
  markSchoolNavigationUnready,
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
import {
  navigateFromInboxTask,
  inboxTaskFromLegacyAssignmentActionTarget,
} from './src/services/inboxActions';
import { isTeachingRole } from './src/utils/campusOs';
import type { InboxTask } from './src/data/types';
import { navigateToCourseScreen } from './src/utils/courseNavigation';
import { initCrossModuleConnections } from './src/services/crossModuleConnector';
import { registerCompanionCampusBusBridge } from './src/services/companionBusBridge';
import { rewriteLegacyShopsPath } from './src/app/legacyShopsPath';
import { resolveDeprecatedRouteRedirect } from './src/app/deprecatedRouteRedirect';

/**
 * 學生四個入口：今天｜課務｜生活｜我
 * 訊息仍在導覽堆疊，從「我」進入。
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
          AdminDashboard: 'admin',
          CourseSchedule: 'schedule',
          PersonalTimetable: 'personal-timetable',
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
          PersonalCalendar: {
            path: 'personal-calendar/:eventId?',
            parse: {
              eventId: (value: string | undefined) => (value && value.length ? value : undefined),
            },
          },
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
          SchoolInfo: 'school-info',
          Health: 'health',
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
          NuniWorkspace: 'campus-one',
        },
      },
    },
  },
  getStateFromPath: (path, options) => getStateFromPath(rewriteLegacyShopsPath(path), options),
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
  useNextClassWidget();
  useClassReminders();
  const auth = useAuth();
  const { school } = useSchool();
  const schoolSessionReady = hasReadySchoolSession(auth, school?.id ?? null);
  const userId = schoolSessionReady ? auth.user!.uid : null;
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
        school?.id &&
        userId
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
  }, [school?.id, userId]);

  const schoolId = school?.id ?? null;

  return (
    <SearchHistoryProvider userId={userId} schoolId={schoolId}>
      <FavoritesProvider userId={userId} schoolId={schoolId}>
        <ScheduleProvider>
          {schoolSessionReady ? <SyncStatusHandler /> : null}
          {schoolSessionReady ? <TokenErrorHandler /> : null}
          {children}
        </ScheduleProvider>
      </FavoritesProvider>
    </SearchHistoryProvider>
  );
}

const TAB_BAR_PILL_PADDING_V = 6;

function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const permissions = usePermissions();
  // 訊息 Tab 上的紅色未讀徽章：即時訂閱我自己 DM 未讀數
  const unreadDms = useUnreadMessagingCount();

  const visibleTabKeys = permissions.tabs.map((t) => t.key);
  const visibleRoutes = state.routes.filter((r) => visibleTabKeys.includes(r.name));

  const renderTab = (route: (typeof visibleRoutes)[number]) => {
    const originalIndex = state.routes.findIndex((r) => r.key === route.key);
    const { options } = descriptors[route.key];
    const focused = state.index === originalIndex;
    const config = permissions.tabs.find((t) => t.key === route.name);
    const iconName = config?.icon ?? 'ic_tab_today';
    const showUnreadBadge = route.name === '我的' && unreadDms > 0;
    const badgeLabel = unreadDms > 99 ? '99+' : String(unreadDms);

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
          transform: [{ scale: pressed ? 0.95 : 1 }],
        })}
      >
        <View
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            paddingVertical: 8,
            paddingHorizontal: 4,
            borderRadius: theme.radius.md,
            backgroundColor: focused ? theme.colors.chromeTabItemActive : 'transparent',
            minHeight: 54,
          }}
        >
          <View>
            <AppActionIcon
              name={iconName}
              size={focused ? 22 : 20}
              fallback="ionicon"
              color={focused ? theme.colors.accent : theme.colors.muted}
              style={{ opacity: focused ? 1 : 0.66 }}
            />
            {showUnreadBadge ? (
              <View
                accessibilityLabel={`未讀訊息 ${unreadDms} 則`}
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -10,
                  minWidth: 16,
                  height: 16,
                  paddingHorizontal: 4,
                  borderRadius: 8,
                  backgroundColor: '#ef4444',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: theme.colors.chromeTabBar,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>{badgeLabel}</Text>
              </View>
            ) : null}
          </View>
          <Text
            style={{
              fontSize: 10,
              lineHeight: 13,
              fontWeight: focused ? '700' : '600',
              color: focused ? theme.colors.accent : theme.colors.muted,
              letterSpacing: 0,
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
        bottom: Math.max(insets.bottom, 8) + 6,
        left: 14,
        right: 14,
        minHeight: 76,
      }}
      pointerEvents="box-none"
    >
      {/* 底部四個入口：今天｜課務｜生活｜我 */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: theme.radius.lg,
          overflow: 'hidden',
        }}
        pointerEvents="none"
      >
        <BlurView
          intensity={70}
          tint={theme.mode === 'dark' ? 'dark' : 'light'}
          style={{ flex: 1 }}
        />
      </View>
      <View
        style={{
          flex: 1,
          position: 'relative',
          flexDirection: 'row',
          alignItems: 'stretch',
          overflow: 'hidden',
          borderRadius: theme.radius.lg,
          paddingVertical: TAB_BAR_PILL_PADDING_V,
          paddingHorizontal: 8,
          borderWidth: 1,
          borderColor: theme.colors.chromeTabBorder,
          backgroundColor: theme.colors.chromeTabBar,
          ...softShadowStyle(theme.shadows.soft),
        }}
      >
        {visibleRoutes.map(renderTab)}
      </View>
    </View>
  );
}

/**
 * 學生四個入口：今天｜課務｜生活｜我
 * 訊息仍在導覽堆疊，從「我」進入。
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
      <Tab.Screen name="訊息" component={MessagesStack} options={{ tabBarButton: () => null }} />
      <Tab.Screen name="我的" component={MeStack} />
    </Tab.Navigator>
  );
}

function AppNavigation() {
  return (
    <SchoolSessionBoundary publicContent={<PublicNavigation />}>
      <SchoolNavigation />
    </SchoolSessionBoundary>
  );
}

function PublicNavigation() {
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
  useEffect(() => {
    return () => {
      markPublicNavigationUnready();
    };
  }, []);
  return (
    <NavigationContainer
      ref={publicNavigationRef}
      theme={navTheme}
      linking={preAuthLinking}
      onReady={() => {
        markPublicNavigationReady();
      }}
    >
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <PreAuthStack />
      </View>
    </NavigationContainer>
  );
}

function SchoolNavigation() {
  const { school } = useSchool();
  const auth = useAuth();
  const pendingMessagingDeepLinkRef = useRef<string | null>(null);
  const authRoleRef = useRef(auth.profile?.role);
  const authTeachingRef = useRef(isTeachingRole(auth.profile?.role));
  authRoleRef.current = auth.profile?.role;
  authTeachingRef.current = isTeachingRole(auth.profile?.role);

  useSubmittedAssignmentReminders(auth.user?.uid, school.id);
  usePushNotifications(
    rootNavigationRef,
    auth.user?.uid,
    auth.profile?.role,
    school.id,
  );
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

  useEffect(() => {
    return () => {
      markSchoolNavigationUnready();
    };
  }, []);

  return (
    <NavigationContainer
      ref={rootNavigationRef}
      theme={navTheme}
      linking={linkingConfig}
      onReady={() => {
        markSchoolNavigationReady();
        flushPendingMessagingDeepLink();
      }}
      fallback={<FullScreenLoader />}
      onUnhandledAction={(action) => {
        // Keep unhandled links recoverable without exposing internal route names.
        try {
          const payload = (action as any)?.payload;
          const targetName = payload?.name ?? '未知頁面';

          // 已被改名 / 整合的 deprecated route：silent 自動 redirect，不再彈 alert
          // （例如 AcademicStack 在 4+1 改版已整合進 LearnStack）
          const redirect = resolveDeprecatedRouteRedirect(targetName);
          if (redirect) {
            try {
              rootNavigateNested(redirect.tab as any, redirect.screen);
            } catch {
              /* swallow */
            }
            return;
          }

          // 已知子路由名 → 自動 fallback 到正確的 Tab + Stack
          const TAB_HINTS: Record<string, string> = {
            CourseGradebook: '學習',
            CourseHub: '學習',
            CourseDiscussion: '學習',
            CourseModules: '學習',
            Attendance: '學習',
            QuizCenter: '學習',
            AcademicInsights: '學習',
            AcademicOverview: '學習',
            LearningAnalytics: '學習',
            GroupDetail: '訊息',
            Groups: '訊息',
            Chat: '訊息',
            Inbox: '訊息',
            FriendsManage: '訊息',
            餐廳總覽: '校園',
            MenuDetail: '校園',
            Map: '校園',
            BusSchedule: '校園',
            公告總覽: 'Today',
            活動總覽: 'Today',
            SmartCalendarScreen: 'Today',
          };
          const hint = TAB_HINTS[targetName];
          const { Alert } = require('react-native');
          Alert.alert(
            '目前無法開啟頁面',
            hint
              ? '請從對應分頁重新開啟這項服務。'
              : '這個連結目前無法使用，請回到首頁後重新開啟。',
            [
              { text: '取消', style: 'cancel' },
              hint
                ? {
                    text: `前往${hint === 'Today' ? '首頁' : hint}`,
                    onPress: () => {
                      try {
                        rootNavigateNested(hint as any, targetName);
                      } catch {
                        /* swallow */
                      }
                    },
                  }
                : {
                    text: '回主畫面',
                    onPress: () => {
                      try {
                        rootNavigateNested('Today', 'TodayHome');
                      } catch {
                        /* swallow */
                      }
                    },
                  },
            ],
          );
        } catch {
          /* swallow */
        }
      }}
    >
      <View style={{ flex: 1 }}>
        <NetworkStatusBanner />
        <AppTabNavigator />
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
      <NuniSessionProvider>
        <AuthProvider>
          <PersonalImportSyncBridge />
          <PersonalEventReminderBridge />
          <NotificationsProvider>
            <ToastProvider>
              <AuthAwareStateProviders>
                <DemoProvider>
                  <DemoRoleProvider>
                    <DemoStoreProvider>
                      <AppNavigation />
                    </DemoStoreProvider>
                  </DemoRoleProvider>
                </DemoProvider>
              </AuthAwareStateProviders>
            </ToastProvider>
          </NotificationsProvider>
        </AuthProvider>
      </NuniSessionProvider>
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
      {/* iOS: status bar 字色隨主題自動切換（亮底深字、暗底白字）；translucent 讓內容貼齊頂部 */}
      <StatusBar style="auto" translucent />
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
