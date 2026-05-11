/* eslint-disable */
/**
 * 📊 學業總覽 — Academic Screen
 *
 * 整合學業相關功能：成績查詢 | AI 分析 | 成績簿(教師) | 學習分析(教師/管理)
 * 根據使用者角色自動顯示可用的 tab。
 */
import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';
import { useAuth } from '../state/auth';

import { GradesScreen } from './GradesScreen';
import { CourseGradebookScreen } from './CourseGradebookScreen';
import { LearningAnalyticsScreen } from './LearningAnalyticsScreen';
import { AcademicInsightsScreen } from './AcademicInsightsScreen';

type TabKey = 'grades' | 'gradebook' | 'analytics' | 'insights';

interface TabDef {
  key: TabKey;
  label: string;
  icon: string;
  roles: string[];
}

const ALL_TABS: TabDef[] = [
  { key: 'grades', label: '成績', icon: 'school-outline', roles: ['student', 'teacher', 'admin', 'staff', 'department', 'school'] },
  { key: 'insights', label: 'AI 分析', icon: 'sparkles-outline', roles: ['student', 'teacher', 'admin', 'department', 'school'] },
  { key: 'gradebook', label: '成績簿', icon: 'clipboard-outline', roles: ['teacher', 'admin', 'department', 'school'] },
  { key: 'analytics', label: '學習分析', icon: 'analytics-outline', roles: ['teacher', 'admin', 'department', 'school'] },
];

export function AcademicScreen(props: Record<string, unknown>) {
  useThemeMode();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const userRole = profile?.role ?? 'student';

  const tabs = useMemo(
    () => ALL_TABS.filter((t) => t.roles.includes(userRole)),
    [userRole],
  );

  const [activeTab, setActiveTab] = useState<TabKey>('grades');

  const route = (props as any)?.route;
  const initialTab = route?.params?.initialTab as TabKey | undefined;
  useEffect(() => {
    if (initialTab && tabs.some((t) => t.key === initialTab)) {
      setActiveTab(initialTab);
    }
  }, [initialTab, tabs]);

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
        <Text style={{ fontSize: 22, fontWeight: '800', color: theme.colors.text, marginBottom: 10 }}>
          學業總覽
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {tabs.map((tab) => {
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
                  gap: 4,
                  paddingVertical: 9,
                  borderRadius: theme.radius.md,
                  backgroundColor: active ? theme.colors.accent : theme.colors.surface,
                  borderWidth: active ? 0 : 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Ionicons name={tab.icon as any} size={14} color={active ? '#fff' : theme.colors.textSecondary} />
                <Text
                  style={{
                    fontSize: 12,
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

      <View style={{ flex: 1 }}>
        {activeTab === 'grades' && <GradesScreen {...props} />}
        {activeTab === 'insights' && <AcademicInsightsScreen />}
        {activeTab === 'gradebook' && <CourseGradebookScreen {...props} />}
        {activeTab === 'analytics' && <LearningAnalyticsScreen {...props} />}
      </View>
    </View>
  );
}

export default AcademicScreen;
