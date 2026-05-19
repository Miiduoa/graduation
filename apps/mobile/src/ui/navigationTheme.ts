import { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform } from 'react-native';

import { theme, shadowStyle } from './theme';

// ── 所有與 tab bar 底部留白相關的計算 100% inline ──────────────
// 之前從 theme.ts 命名匯入 tabBarExtraScrollPadding 在 runtime 因 circular-import 取得 undefined，
// 整個函式 + 常數都搬進這個檔案，徹底斷開外部相依。

/** 浮動 Tab Bar 所需的 ScrollView 底部留白基準（單位 dp）。 */
export const TAB_BAR_SCROLL_BOTTOM_PADDING = 118;

/** 與舊 API 對齊：等同於 TAB_BAR_SCROLL_BOTTOM_PADDING */
export const TAB_BAR_CONTENT_BOTTOM_PADDING = TAB_BAR_SCROLL_BOTTOM_PADDING;

/** Inline：根據 device safe-area bottom 推算需要再多加多少 padding */
function calcExtraScrollPadding(insetsBottom: number): number {
  return Math.max(0, insetsBottom - 8);
}

/**
 * 主畫面 Tab 與共用 Screen 取得「捲動底部安全留白」的 hook。
 */
export function useTabBarContentBottomPadding(): number {
  const bottom = useSafeAreaInsets().bottom;
  return TAB_BAR_SCROLL_BOTTOM_PADDING + calcExtraScrollPadding(bottom);
}

export function createStackScreenOptions(): NativeStackNavigationOptions {
  return {
    headerStyle: {
      backgroundColor: theme.mode === 'dark' ? theme.colors.surface : theme.colors.bg,
    },
    headerTitleStyle: {
      color: theme.colors.text,
      fontSize: 17,
      fontWeight: '600',
    },
    headerTintColor: theme.colors.accent,
    headerShadowVisible: false,
    headerBackVisible: true,
    headerBackButtonDisplayMode: 'minimal',
    contentStyle: { backgroundColor: theme.colors.bg },
    animation: 'slide_from_right',
  };
}

export function createTabScreenOptions(_routeName: string): BottomTabNavigationOptions {
  return {
    headerShown: false,
    tabBarStyle: {
      position: 'absolute',
      left: 18,
      right: 18,
      bottom: Platform.OS === 'ios' ? 24 : 16,
      backgroundColor: theme.colors.chromeTabBar,
      borderTopColor: 'transparent',
      borderTopWidth: 0,
      borderRadius: theme.radius.xl,
      height: 64,
      paddingTop: 6,
      paddingBottom: 6,
      paddingHorizontal: 6,
      borderWidth: 1,
      borderColor: theme.colors.chromeTabBorder,
      ...shadowStyle(theme.shadows.lg),
    },
    tabBarLabelStyle: {
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 0,
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
