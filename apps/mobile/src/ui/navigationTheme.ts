import { BottomTabNavigationOptions } from "@react-navigation/bottom-tabs";
import { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { theme, shadowStyle } from "./theme";
import { Platform } from "react-native";

/**
 * 浮動 Tab Bar 所需的 ScrollView 底部留白。
 * Tab Bar 高度 72px + 底部偏移 ~44px（含 safe area）= 116px，加 8px 喘息空間 = 124px。
 * 此值供所有 ScrollView/FlatList 的 contentContainerStyle.paddingBottom 使用。
 */
export const TAB_BAR_CONTENT_BOTTOM_PADDING = 124;

export function createStackScreenOptions(): NativeStackNavigationOptions {
  const isDark = theme.mode === "dark";
  return {
    headerStyle: {
      backgroundColor: isDark ? theme.colors.surface : "#FFFFFF",
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
  const shadow = theme.shadows.md;
  return {
    headerShown: false,
    tabBarStyle: {
      position: "absolute",
      left: 16,
      right: 16,
      bottom: Platform.OS === "ios" ? 28 : 16,
      backgroundColor: isDark ? theme.colors.surface : "#FFFFFF",
      borderTopColor: "transparent",
      borderTopWidth: 0,
      borderRadius: theme.radius.xl,
      height: 72,
      paddingTop: 9,
      paddingBottom: 9,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: isDark ? theme.colors.border : "#E5E5EA",
      ...shadowStyle(shadow),
    },
    tabBarLabelStyle: {
      fontSize: 10,
      fontWeight: "600",
      letterSpacing: 0.2,
      marginTop: 2,
    },
    tabBarActiveTintColor: theme.colors.accent,
    tabBarInactiveTintColor: theme.colors.muted,
    tabBarItemStyle: {
      borderRadius: theme.radius.sm,
      paddingVertical: 4,
    },
    sceneStyle: { backgroundColor: theme.colors.bg },
  };
}
