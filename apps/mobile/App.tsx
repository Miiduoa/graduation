/* eslint-disable */
import React, { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  NavigationContainer,
  DefaultTheme,
  useNavigationContainerRef,
  type LinkingOptions,
} from "@react-navigation/native";
import { createBottomTabNavigator, BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, View, Text, AppState, AppStateStatus, Modal, Pressable } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Linking from "expo-linking";

import { theme, softShadowStyle } from "./src/ui/theme";
import { SchoolProvider, useSchool } from "./src/state/school";
import { FavoritesProvider } from "./src/state/favorites";
import { DemoProvider } from "./src/state/demo";
import { AuthProvider, useAuth } from "./src/state/auth";
import { ThemeProvider, useThemeMode } from "./src/state/theme";
import { NotificationsProvider } from "./src/state/notifications";
import { SearchHistoryProvider } from "./src/state/searchHistory";
import { ScheduleProvider } from "./src/state/schedule";
import { PreferencesProvider } from "./src/state/preferences";
import { I18nProvider } from "./src/i18n";
import { analytics } from "./src/services/analytics";
import {
  initOfflineModeSync,
  setHybridSourceSchoolContext,
} from "./src/data";
import {
  initNetworkMonitoring,
  syncEssentialData,
  subscribeToSyncEvents,
  subscribeToConflicts,
  getPendingConflicts,
  resolveConflict,
  clearPendingConflict,
  ConflictInfo,
} from "./src/services/offline";
import { ToastProvider, useToast } from "./src/ui/Toast";
import { NetworkStatusBanner } from "./src/ui/OfflineBanner";
import { ConflictResolutionModal } from "./src/ui/ConflictResolutionModal";

import { HomeStack } from "./src/screens/HomeStack";
import { AcademicStack } from "./src/screens/AcademicStack";
import { MapStack } from "./src/screens/MapStack";
import { MessagesStack } from "./src/screens/MessagesStack";
import { MeStack } from "./src/screens/MeStack";
import { TeachingStack } from "./src/screens/TeachingStack";
import { StaffStack } from "./src/screens/StaffStack";
import { DepartmentStack } from "./src/screens/DepartmentStack";
import { AdminStack } from "./src/screens/AdminStack";
import { OnboardingScreen, hasSeenOnboarding } from "./src/screens/OnboardingScreen";
import { usePushNotifications } from "./src/app/usePushNotifications";
import { initializeRuntimeDataSource } from "./src/config/runtime";
import { usePermissions } from "./src/hooks/usePermissions";

/**
 * 5-Tab 心理學導航架構（Hick's Law + Progressive Disclosure）
 *
 * Today / [課程|教學|服務|審核|管理] / 校園 / 收件匣 / 我的
 *
 * 設計根據：
 * - Hick's Law: 首層只保留 5 個穩定入口，避免首頁變成功能總表
 * - Temporal Self-Regulation: Today 只處理下一步、今日課務與校園情境
 * - Context-Dependent Memory: 課程主流程與收件匣分工清楚，減少切換迷失
 * - Spatial Cognition: 校園服務依移動與生活情境集中到同一入口
 * - RBAC: 第二個 Tab 根據使用者角色動態改變
 */
type RootTabParamList = {
  Today: undefined;
  課程: undefined;
  教學: undefined;
  服務: undefined;
  審核: undefined;
  管理: undefined;
  校園: undefined;
  收件匣: undefined;
  我的: undefined;
};

type AppNavigationRef = ReturnType<typeof useNavigationContainerRef<RootTabParamList>>;

const Tab = createBottomTabNavigator<RootTabParamList, undefined>();

type TabKey = keyof RootTabParamList;

// Static TAB_CONFIG for backward compatibility - will be replaced by dynamic config in FloatingTabBar
const TAB_CONFIG: Array<{
  key: string;
  label: string;
  icon: { active: string; inactive: string };
}> = [
  {
    key: "Today",
    label: "Today",
    icon: { active: "sunny", inactive: "sunny-outline" },
  },
  {
    key: "課程",
    label: "課程",
    icon: { active: "book", inactive: "book-outline" },
  },
  {
    key: "校園",
    label: "校園",
    icon: { active: "map", inactive: "map-outline" },
  },
  {
    key: "收件匣",
    label: "收件匣",
    icon: { active: "mail", inactive: "mail-outline" },
  },
  {
    key: "我的",
    label: "我的",
    icon: { active: "person-circle", inactive: "person-circle-outline" },
  },
];

const linking: LinkingOptions<RootTabParamList> = {
  prefixes: [Linking.createURL("/"), "campus://"],
  config: {
    screens: {
      Today: {
        screens: {
          TodayHome: "home",
          公告總覽: "announcements",
          公告詳情: "announcement/:id",
          活動總覽: "events",
          活動詳情: "event/:id",
          AIChat: "ai-chat",
        },
      },
      課程: {
        screens: {
          CoursesHome: "courses",
          CourseSchedule: "schedule",
          AddCourse: "course/new",
          CourseHub: "course-hub",
          CourseModules: "course-modules",
          QuizCenter: "quiz-center",
          Attendance: "attendance",
          Classroom: "classroom/:sessionId",
          LearningAnalytics: "learning-analytics",
          CourseGradebook: "course-gradebook",
          Grades: "grades",
          Calendar: "calendar",
          AICourseAdvisor: "ai-advisor",
          AIChat: "course-ai-chat",
        },
      },
      教學: {
        screens: {
          TeachingHub: "teaching",
          CourseSchedule: "schedule",
          AddCourse: "course/new",
          CourseHub: "course-hub",
          CourseModules: "course-modules",
          QuizCenter: "quiz-center",
          Attendance: "attendance",
          Classroom: "classroom/:sessionId",
          LearningAnalytics: "learning-analytics",
          CourseGradebook: "course-gradebook",
          Grades: "grades",
          Calendar: "calendar",
          AICourseAdvisor: "ai-advisor",
          AIChat: "course-ai-chat",
        },
      },
      服務: {
        screens: {
          StaffHub: "staff",
          MapStack: "map",
          MessagesStack: "messages",
        },
      },
      審核: {
        screens: {
          DepartmentHub: "department",
        },
      },
      管理: {
        screens: {
          AdminDashboard: "admin",
        },
      },
      校園: {
        screens: {
          CampusHome: "campus",
          Map: "map",
          PoiDetail: "poi/:id",
          ARNavigation: "ar-nav/:destinationId",
          AccessibleRoute: "accessible-route/:destination",
          BusSchedule: "bus",
          餐廳總覽: "cafeteria",
          MenuDetail: "menu/:id",
          Ordering: "ordering/:menuId",
          MenuSubscription: "menu-subscription",
          Library: "library",
          Health: "health",
          Dormitory: "dormitory",
          PrintService: "print",
          LostFound: "lost-found",
          LostFoundDetail: "lost-found/:id",
          LostFoundPost: "lost-found/post",
          Payment: "payment",
        },
      },
      收件匣: {
        screens: {
          Inbox: "inbox",
          MessagesHome: "messages",
          Groups: "groups",
          GroupDetail: "group/:groupId",
          GroupPost: "group/:groupId/post/:postId",
          GroupAssignments: "group/:groupId/assignments",
          AssignmentDetail: "group/:groupId/assignment/:assignmentId",
          Dms: "dms",
          Chat: "chat/:peerId",
          AdminCourseVerify: "course-verify",
        },
      },
      我的: {
        screens: {
          MeHome: "profile",
          Settings: "settings",
          Notifications: "notifications",
          NotificationSettings: "notification-settings",
          ProfileEdit: "profile/edit",
          QRCode: "qrcode",
          GlobalSearch: "search",
          Achievements: "achievements",
          DataExport: "data-export",
          AccountDeletion: "account-deletion",
          SSOLogin: "sso-login",
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
    () => getPendingConflicts().length > 0
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
        case "queued":
          toast.show({
            message: "目前離線，操作將在網路恢復後同步",
            type: "info",
            duration: 3000,
          });
          break;
        case "sync_complete":
          if (event.processed && event.processed > 0) {
            toast.show({
              message: `已同步 ${event.processed} 筆資料`,
              type: "success",
              duration: 2000,
            });
          }
          break;
        case "sync_error":
          toast.show({
            message: `同步失敗：${event.error?.message ?? "未知錯誤"}`,
            type: "error",
            duration: 4000,
          });
          break;
        case "conflict":
          toast.show({
            message: "部分資料與伺服器衝突，請檢查",
            type: "warning",
            duration: 4000,
          });
          break;
      }
    });
    
    return unsubscribe;
  }, [toast]);
  
  const handleResolveConflict = async (
    actionId: string,
    resolution: "keep_local" | "keep_server" | "merge"
  ) => {
    try {
      await resolveConflict(actionId, resolution);
      clearPendingConflict(actionId);
      setConflicts((prev) => prev.filter((c) => c.action.id !== actionId));
      
      toast.show({
        message: "衝突已解決",
        type: "success",
        duration: 2000,
      });
    } catch (error) {
      toast.show({
        message: "解決衝突失敗，請重試",
        type: "error",
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
          backgroundColor: "rgba(0,0,0,0.6)",
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
      >
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.xl,
            padding: 28,
            width: "100%",
            maxWidth: 340,
            alignItems: "center",
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
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Ionicons name="time-outline" size={32} color={theme.colors.danger} />
          </View>
          
          <Text
            style={{
              color: theme.colors.text,
              fontSize: 18,
              fontWeight: "700",
              textAlign: "center",
              marginBottom: 8,
            }}
          >
            登入狀態已過期
          </Text>
          
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: 14,
              textAlign: "center",
              lineHeight: 22,
              marginBottom: 24,
            }}
          >
            您的登入已過期或在其他裝置登入。為了保護您的帳號安全，請重新登入。
          </Text>
          
          <View style={{ flexDirection: "row", gap: 10, width: "100%" }}>
            <Pressable
              onPress={handleDismiss}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 13,
                borderRadius: theme.radius.md,
                backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface2,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: "center",
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 14 }}>離線繼續</Text>
            </Pressable>
            
            <Pressable
              onPress={handleSignOut}
              disabled={isLoggingOut}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 13,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.accent,
                alignItems: "center",
                opacity: isLoggingOut || pressed ? 0.8 : 1,
              })}
            >
              {isLoggingOut ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>重新登入</Text>
              )}
            </Pressable>
          </View>
          
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: 11,
              textAlign: "center",
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
    if (auth.tokenError && auth.tokenError.message !== "TOKEN_REFRESH_EXHAUSTED") {
      toast.show({
        message: "連線問題，稍後會自動重試",
        type: "warning",
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
        nextAppState === "active" &&
        school?.id
      ) {
        syncEssentialData(school.id).catch(console.error);
      }
      appState.current = nextAppState;
    };
    
    const subscription = AppState.addEventListener("change", handleAppStateChange);
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
 * FloatingTabBar — Calm Clarity 設計語言 with RBAC Support
 *
 * 心理學：
 * - Fitts's Law: 5 個清楚命名的 Tab 仍維持穩定大目標區，降低誤觸
 * - Affordance: 清晰的選中/未選中視覺差異
 * - Gestalt 接近法則: 毛玻璃背景與底部安全區完整融合
 * - RBAC: 根據使用者角色動態調整 Tab 配置
 */
function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const isDark = theme.mode === "dark";
  const permissions = usePermissions();

  // Get dynamic tab config based on role
  const dynamicTabs = permissions.tabs;

  return (
    <View style={{
      position: "absolute",
      bottom: Math.max(insets.bottom, 8) + 8,
      left: 12,
      right: 12,
      borderRadius: 26,
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 6,
      paddingHorizontal: 8,
      borderWidth: 1,
      borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
      backgroundColor: isDark ? "rgba(26,29,39,0.97)" : "rgba(255,255,255,0.98)",
      ...softShadowStyle(theme.shadows.soft),
    }}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const config = dynamicTabs.find((t) => t.key === route.name);
        const iconName: keyof typeof Ionicons.glyphMap = config
          ? (focused ? (config.icon.active as keyof typeof Ionicons.glyphMap) : (config.icon.inactive as keyof typeof Ionicons.glyphMap))
          : (focused ? "ellipse" : "ellipse-outline");

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            onPress={() => {
              const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            style={({ pressed }) => ({
              flex: 1,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}
          >
            <View style={{
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              paddingVertical: 9,
              paddingHorizontal: 4,
              borderRadius: 18,
              backgroundColor: focused
                ? (isDark ? "rgba(37,99,235,0.16)" : "rgba(37,99,235,0.08)")
                : "transparent",
              minHeight: 52,
            }}>
              <Ionicons
                name={iconName}
                size={focused ? 22 : 20}
                color={focused ? theme.colors.accent : theme.colors.muted}
              />
              <Text style={{
                fontSize: 10,
                fontWeight: focused ? "700" : "500",
                color: focused ? theme.colors.accent : theme.colors.muted,
                letterSpacing: focused ? 0 : 0.1,
              }}>
                {config?.label ?? route.name}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * RoleAwareTabNavigator — Dynamically render tabs based on user role
 * Maps role-specific tab keys to stack components
 */
function RoleAwareTabNavigator() {
  const permissions = usePermissions();

  // Map initialRoute to RootTabParamList keys
  const getInitialRouteName = (): keyof RootTabParamList => {
    switch (permissions.initialRoute) {
      case "管理":
        return "管理";
      case "審核":
        return "審核";
      case "教學":
        return "教學";
      case "服務":
        return "服務";
      case "Today":
        return "Today";
      default:
        return "Today";
    }
  };

  return (
    <Tab.Navigator
      id={undefined}
      initialRouteName={getInitialRouteName()}
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={() => ({
        headerShown: false,
        sceneStyle: { backgroundColor: theme.colors.bg },
      })}
    >
      <Tab.Screen name="Today" component={HomeStack} />

      {/* Render role-specific tab */}
      {permissions.isStudent && <Tab.Screen name="課程" component={AcademicStack} />}
      {permissions.isTeacher && <Tab.Screen name="教學" component={TeachingStack} />}
      {permissions.isStaff && <Tab.Screen name="服務" component={StaffStack} />}
      {permissions.isDepartmentHead && <Tab.Screen name="審核" component={DepartmentStack} />}
      {permissions.isAdmin && <Tab.Screen name="管理" component={AdminStack} />}

      {/* Shared tabs */}
      <Tab.Screen name="校園" component={MapStack} />
      <Tab.Screen name="收件匣" component={MessagesStack} />
      <Tab.Screen name="我的" component={MeStack} />
    </Tab.Navigator>
  );
}

function AppNavigation({
  navigationRef,
}: {
  navigationRef: AppNavigationRef;
}) {
  const auth = useAuth();
  usePushNotifications(navigationRef, auth.user?.uid);

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
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.colors.bg }}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      linking={linking}
      fallback={
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.colors.bg }}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
        </View>
      }
    >
      <View style={{ flex: 1 }}>
        <NetworkStatusBanner />
        <RoleAwareTabNavigator />
      </View>
    </NavigationContainer>
  );
}

function AppInner() {
  const navigationRef = useNavigationContainerRef<RootTabParamList>();
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const networkCleanup = initNetworkMonitoring();
    
    let offlineModeCleanup: (() => void) | null = null;
    initOfflineModeSync().then((cleanup) => {
      offlineModeCleanup = cleanup;
    });
    
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
    AsyncStorage.setItem("campus.demoMode.v1", "normal").catch(() => void 0);
  }, []);

  useThemeMode();

  if (isCheckingOnboarding) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
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
                <AppNavigation navigationRef={navigationRef} />
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
    console.error("[AppErrorBoundary] Caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View
          style={{
            flex: 1,
            backgroundColor: theme.colors.bg,
            justifyContent: "center",
            alignItems: "center",
            padding: 32,
          }}
        >
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 24,
              backgroundColor: theme.colors.dangerSoft,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 20,
            }}
          >
            <Ionicons name="warning-outline" size={36} color={theme.colors.danger} />
          </View>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: 20,
              fontWeight: "700",
              textAlign: "center",
              marginBottom: 10,
            }}
          >
            應用程式發生錯誤
          </Text>
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: 14,
              textAlign: "center",
              lineHeight: 22,
              marginBottom: 28,
            }}
          >
            {this.state.error?.message ?? "未知錯誤"}
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
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>重新嘗試</Text>
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
          <PreferencesProvider>
            <I18nProvider>
              <AppInner />
            </I18nProvider>
          </PreferencesProvider>
        </ThemeProvider>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}
