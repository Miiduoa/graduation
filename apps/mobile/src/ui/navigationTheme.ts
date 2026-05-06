import { BottomTabNavigationOptions } from "@react-navigation/bottom-tabs";
import { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { theme, shadowStyle } from "./theme";
import { Platform } from "react-native";

/**
 * 浮動 Tab Bar 所需的 ScrollView 底部留白。
 * Tab Bar 高度 68px + 底部偏移 ~44px（含 safe area）= 112px，加 12px 喘息空間 = 124px。
 */
export const TAB_BAR_CONTENT_BOTTOM_PADDING = 124;

export function createStackScreenOptions(): NativeStackNavigationOptions {
  const isDark = theme.mode === "dark";
  return {
    headerStyle: {
      backgroundColor: isDark ? theme.colors.surface : theme.colors.bg,
    },
    headerTitleStyle: {
      color: theme.colors.text,
      fontSize: 17,
      fontWeight: "600",
    },
    headerTintColor: theme.colors.accent,
    headerShadowVisible: false,
    headerBackVisible: true,
    headerBackButtonDisplayMode: "minimal",
    contentStyle: { backgroundColor: theme.colors.bg },
    animation: "slide_from_right",
  };
}

export function createTabScreenOptions(_routeName: string): BottomTabNavigationOptions {
  const isDark = theme.mode === "dark";
  return {
    headerShown: false,
    tabBarStyle: {
      position: "absolute",
      left: 20,
      right: 20,
      bottom: Platform.OS === "ios" ? 30 : 18,
      backgroundColor: isDark ? theme.colors.surface : "#FFFFFFEE",
      borderTopColor: "transparent",
      borderTopWidth: 0,
      borderRadius: theme.radius.xl,
      height: 68,
      paddingTop: 8,
      paddingBottom: 8,
      paddingHorizontal: 8,
      borderWidth: isDark ? 1 : 0,
      borderColor: isDark ? theme.colors.border : "transparent",
      ...shadowStyle(theme.shadows.lg),
    },
    tabBarLabelStyle: {
      fontSize: 10,
      fontWeight: "600",
      letterSpacing: 0.3,
      marginTop: 1,
    },
    tabBarActiveTintColor: theme.colors.accent,
    tabBarInactiveTintColor: theme.colors.muted,
    tabBarItemStyle: {
      borderRadius: theme.radius.md,
      paddingVertical: 4,
    },
    sceneStyle: { backgroundColor: theme.colors.bg },
  };
}
