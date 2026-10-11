/**
 * 行事曆
 *
 * 課表統一看「我的課表」（PersonalTimetable），這裡只放行事曆，
 * 免得兩份課表資料對不起來。
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';
import { rootNavigateNested } from '../app/rootNavigation';

import { CalendarPanel } from './unifiedCalendar/CalendarPanel';

export function UnifiedCalendarScreen(props: Record<string, unknown>) {
  useThemeMode();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View
        style={{
          paddingTop: insets.top + 4,
          paddingBottom: 10,
          paddingHorizontal: 16,
          backgroundColor: theme.colors.bg,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        }}
      >
        <Text
          style={{
            fontSize: 22,
            fontWeight: '700',
            color: theme.colors.text,
            marginBottom: 6,
          }}
        >
          行事曆
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => rootNavigateNested('學習', 'PersonalTimetable')}
          style={{ paddingVertical: 6 }}
        >
          <Text style={{ fontSize: 13, color: theme.colors.accent }}>課表請看「我的課表」 →</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1 }}>
        <CalendarPanel {...props} />
      </View>
    </View>
  );
}

export default UnifiedCalendarScreen;
