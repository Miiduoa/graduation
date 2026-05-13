import { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { theme, shadowStyle, TAB_BAR_SCROLL_BOTTOM_PADDING } from './theme';
import { Platform } from 'react-native';

/**
 * 浮動 Tab Bar 所需的 ScrollView 底部留白（與 theme.layout.scrollBottomInset 對齊）。
 */
export const TAB_BAR_CONTENT_BOTTOM_PADDING = TAB_BAR_SCROLL_BOTTOM_PADDING;

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
      left: 24,
      right: 24,
      bottom: Platform.OS === 'ios' ? 30 : 18,
      backgroundColor: theme.colors.chromeTabBar,
      borderTopColor: 'transparent',
      borderTopWidth: 0,
      borderRadius: theme.radius.full,
      height: 68,
      paddingTop: 8,
      paddingBottom: 8,
      paddingHorizontal: 8,
      borderWidth: 1,
      borderColor: theme.colors.chromeTabBorder,
      ...shadowStyle(theme.shadows.lg),
    },
    tabBarLabelStyle: {
      fontSize: 10,
      fontWeight: '600',
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
