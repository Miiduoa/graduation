/* eslint-disable */
/**
 * 📅 統一行事曆 — Unified Calendar Screen
 *
 * 整合三個頁面為一：課表 | 行事曆 | 智慧助手（截止日 + 番茄鐘）
 * 用頂部 segmented tab 切換，底層直接渲染原本三個畫面元件。
 */
import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';

import { CourseSchedulePanel } from './unifiedCalendar/CourseSchedulePanel';
import { CalendarPanel } from './unifiedCalendar/CalendarPanel';
import { SmartCalendarPanel } from './unifiedCalendar/SmartCalendarPanel';

type TabKey = 'schedule' | 'calendar' | 'smart';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'schedule', label: '課表', icon: 'grid-outline' },
  { key: 'calendar', label: '行事曆', icon: 'calendar-outline' },
  { key: 'smart', label: '智慧助手', icon: 'sparkles-outline' },
];

export function UnifiedCalendarScreen(props: Record<string, unknown>) {
  useThemeMode();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabKey>('schedule');

  // 支援從 route.params.initialTab 指定初始 tab
  const route = (props as any)?.route;
  const initialTab = route?.params?.initialTab as TabKey | undefined;
  useEffect(() => {
    if (initialTab && TABS.some((t) => t.key === initialTab)) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {/* ─── Top Segment Tabs ─── */}
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
            fontWeight: '800',
            color: theme.colors.text,
            marginBottom: 10,
          }}
        >
          行事曆
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  paddingVertical: 9,
                  borderRadius: theme.radius.md,
                  backgroundColor: active ? theme.colors.accent : theme.colors.surface,
                  borderWidth: active ? 0 : 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Ionicons
                  name={tab.icon as any}
                  size={15}
                  color={active ? '#fff' : theme.colors.textSecondary}
                />
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: active ? '700' : '500',
                    color: active ? '#fff' : theme.colors.textSecondary,
                  }}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* ─── Content — 只渲染當前 tab ─── */}
      <View style={{ flex: 1 }}>
        {activeTab === 'schedule' && (
          <CourseSchedulePanel {...props} />
        )}
        {activeTab === 'calendar' && (
          <CalendarPanel {...props} />
        )}
        {activeTab === 'smart' && (
          <SmartCalendarPanel />
        )}
      </View>
    </View>
  );
}

export default UnifiedCalendarScreen;
