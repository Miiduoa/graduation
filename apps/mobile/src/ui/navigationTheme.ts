import { BottomTabNavigationOptions } from "@react-navigation/bottom-tabs";
import { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { theme, shadowStyle } from "./theme";
import { Platform } from "react-native";

/** 底部浮動 Tab 列高度 + 間距 + safe area，用於 ScrollView/FlatList 的 contentContainerStyle.paddingBottom 與 Screen 底部留白，避免內容被導航列遮住（預留足夠空間涵蓋各種裝置） */
export const TAB_BAR_CONTENT_BOTTOM_PADDING = 172;

export function createStackScreenOptions(): NativeStackNavigationOptions {
  return {
    headerStyle: {
      backgroundColor: theme.colors.bg,
    },
    headerTitleStyle: {
      color: theme.colors.text,
      fontSize: 17,
      fontWeight: "700",
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
  const shadow = theme.shadows.lg;
  return {
    headerShown: false,
    tabBarStyle: {
      position: "absolute",
      left: 16,
      right: 16,
      bottom: Platform.OS === "ios" ? 28 : 16,
      backgroundColor: theme.mode === "dark"
        ? "rgba(23,33,49,0.92)"
        : "rgba(255,255,255,0.9)",
      borderTopColor: "transparent",
      borderTopWidth: 0,
      borderRadius: theme.radius.xl + 2,
      height: 72,
      paddingTop: 9,
      paddingBottom: 9,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: theme.mode === "dark" ? theme.colors.border : "rgba(255,255,255,0.76)",
      ...shadowStyle(shadow),
    },
    tabBarLabelStyle: {
      fontSize: 10,
      fontWeight: "600",
      letterSpacing: 0.3,
      marginTop: 2,
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
