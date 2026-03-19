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

import { theme, shadowStyle, softShadowStyle } from "./src/ui/theme";
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
import { MeStack } from "./src/screens/MeStack";
import { MessagesStack } from "./src/screens/MessagesStack";
import { OnboardingScreen, hasSeenOnboarding } from "./src/screens/OnboardingScreen";
import { usePushNotifications } from "./src/app/usePushNotifications";
import { initializeRuntimeDataSource } from "./src/config/runtime";

type RootTabParamList = {
  首頁: undefined;
  課業: undefined;
  地圖: undefined;
  訊息: undefined;
  我的: undefined;
};

type AppNavigationRef = ReturnType<typeof useNavigationContainerRef<RootTabParamList>>;

const Tab = createBottomTabNavigator<RootTabParamList, undefined>();

type TabKey = keyof RootTabParamList;

const TAB_CONFIG: Array<{
  key: TabKey;
  label: string;
  icon: { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap };
}> = [
  {
    key: "首頁",
    label: "首頁",
    icon: { active: "home", inactive: "home-outline" },
  },
  {
    key: "課業",
    label: "課業",
    icon: { active: "school", inactive: "school-outline" },
  },
  {
    key: "地圖",
    label: "地圖",
    icon: { active: "map", inactive: "map-outline" },
  },
  {
    key: "訊息",
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
      首頁: {
        screens: {
          HomeMain: "home",
          公告總覽: "announcements",
          公告詳情: "announcement/:id",
          活動總覽: "events",
          活動詳情: "event/:id",
          餐廳總覽: "cafeteria",
          MenuDetail: "menu/:id",
          Ordering: "ordering/:menuId",
        },
      },
      課業: {
        screens: {
          AcademicHome: "academic",
          CourseSchedule: "schedule",
          Grades: "grades",
          Calendar: "calendar",
          AIChat: "ai-chat",
          AICourseAdvisor: "ai-advisor",
        },
      },
      地圖: {
        screens: {
          Map: "map",
          PoiDetail: "poi/:id",
          ARNavigation: "ar-nav/:destinationId",
          AccessibleRoute: "accessible-route/:destination",
          BusSchedule: "bus",
        },
      },
      訊息: {
        screens: {
          MessagesHome: "messages",
          Chat: "chat/:peerId",
          GroupDetail: "group/:groupId",
          GroupPost: "group/:groupId/post/:postId",
          AssignmentDetail: "group/:groupId/assignment/:assignmentId",
          Groups: "groups",
          Dms: "dms",
        },
      },
      我的: {
        screens: {
          MeHome: "me",
          Settings: "settings",
          Notifications: "notifications",
          ProfileEdit: "profile/edit",
          QRCode: "qrcode",
          Library: "library",
          LostFound: "lost-found",
          GlobalSearch: "search",
        },
      },
    },
  },
};

const { usingFirebase: USING_FIREBASE } = initializeRuntimeDataSource();

function SyncStatusHandler() {
  const toast = useToast();
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [showConflictModal, setShowConflictModal] = useState(false);
  
  useEffect(() => {
    const existingConflicts = getPendingConflicts();
    if (existingConflicts.length > 0) {
      setConflicts(existingConflicts);
      setShowConflictModal(true);
    }
    
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
            borderRadius: 16,
            padding: 24,
            width: "100%",
            maxWidth: 340,
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: "rgba(239, 68, 68, 0.15)",
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
              lineHeight: 20,
              marginBottom: 24,
            }}
          >
            您的登入已過期或在其他裝置登入。為了保護您的帳號安全，請重新登入。
          </Text>
          
          <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
            <Pressable
              onPress={handleDismiss}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: theme.colors.surface2,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: "center",
              }}
            >
              <Text style={{ color: theme.colors.text, fontWeight: "600" }}>以離線模式繼續</Text>
            </Pressable>
            
            <Pressable
              onPress={handleSignOut}
              disabled={isLoggingOut}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: theme.colors.accent,
                alignItems: "center",
                opacity: isLoggingOut ? 0.7 : 1,
              }}
            >
              {isLoggingOut ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "600" }}>重新登入</Text>
              )}
            </Pressable>
          </View>
          
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: 11,
              textAlign: "center",
              marginTop: 12,
              lineHeight: 16,
            }}
          >
            選擇「以離線模式繼續」後，您可以瀏覽已快取的資料，但無法存取需要登入的功能。
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

function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const isDark = theme.mode === "dark";

  return (
    <View style={{
      position: "absolute",
      bottom: Math.max(insets.bottom, 10) + 10,
      left: 16,
      right: 16,
      borderRadius: theme.radius.xl,
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderWidth: 1,
      borderColor: isDark ? theme.colors.border : "#E5E5EA",
      backgroundColor: isDark ? theme.colors.surface : "#FFFFFF",
      ...softShadowStyle(theme.shadows.soft),
    }}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const config = TAB_CONFIG.find((t) => t.key === route.name);
        const iconName: keyof typeof Ionicons.glyphMap = config
          ? (focused ? config.icon.active : config.icon.inactive)
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
              paddingHorizontal: 3,
              transform: [{ scale: pressed ? 0.95 : 1 }],
            })}
          >
            <View style={{
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              paddingVertical: 7,
              paddingHorizontal: 6,
              borderRadius: theme.radius.sm,
              backgroundColor: focused ? theme.colors.accentSoft : "transparent",
              minHeight: 54,
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
                letterSpacing: 0.2,
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

/** 浮動 Tab 列本體高度（含圓角區），不含底部 safe area */
const FLOATING_TAB_BAR_HEIGHT = 72;
/** Tab 列距離螢幕底部的間距（與 FloatingTabBar 的 bottom 一致：Math.max(insets.bottom, 10) + 10） */
function getTabBarBottomOffset(insetsBottom: number) {
  return Math.max(insetsBottom, 10) + 10;
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
        <Tab.Navigator
          id={undefined}
          initialRouteName="首頁"
          tabBar={(props) => <FloatingTabBar {...props} />}
          screenOptions={() => ({
            headerShown: false,
            sceneStyle: { backgroundColor: theme.colors.bg },
          })}
        >
          <Tab.Screen name="首頁" component={HomeStack} />
          <Tab.Screen name="課業" component={AcademicStack} />
          <Tab.Screen name="地圖" component={MapStack} />
          <Tab.Screen name="訊息" component={MessagesStack} />
          <Tab.Screen name="我的" component={MeStack} />
        </Tab.Navigator>
      </View>
    </NavigationContainer>
  );
}

function AppInner() {
  const navigationRef = useNavigationContainerRef<RootTabParamList>();
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Initialize network monitoring for offline support and sync cache layer offline mode
  useEffect(() => {
    const networkCleanup = initNetworkMonitoring();
    
    // 同步快取層的離線模式狀態
    let offlineModeCleanup: (() => void) | null = null;
    initOfflineModeSync().then((cleanup) => {
      offlineModeCleanup = cleanup;
    });
    
    return () => {
      networkCleanup?.();
      offlineModeCleanup?.();
    };
  }, []);

  // Check if user has seen onboarding
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

  // When Firebase is enabled, force demoMode back to normal so it doesn't hide real data.
  useEffect(() => {
    if (!USING_FIREBASE) return;
    AsyncStorage.setItem("campus.demoMode.v1", "normal").catch(() => void 0);
  }, []);

  // Re-render when theme mode changes so NavigationContainer + tab styles update.
  useThemeMode();

  // Show loading while checking onboarding status
  if (isCheckingOnboarding) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  // Show onboarding for first-time users
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
            padding: 24,
          }}
        >
          <Ionicons name="warning" size={64} color={theme.colors.danger} />
          <Text
            style={{
              color: theme.colors.text,
              fontSize: 20,
              fontWeight: "700",
              marginTop: 16,
              textAlign: "center",
            }}
          >
            應用程式發生錯誤
          </Text>
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: 14,
              marginTop: 8,
              textAlign: "center",
            }}
          >
            {this.state.error?.message ?? "未知錯誤"}
          </Text>
          <Text
            style={{
              color: theme.colors.accent,
              fontSize: 14,
              fontWeight: "600",
              marginTop: 24,
            }}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            點擊重試
          </Text>
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
