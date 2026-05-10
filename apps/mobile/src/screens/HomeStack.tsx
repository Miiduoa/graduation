/* eslint-disable */
/**
 * HomeStack — Today Tab (精簡版)
 *
 * 只保留核心路由：
 * - TodayHome: SmartDashboard（統一儀表板，整合學業分析 + 校園脈動）
 * - 公告/活動詳情
 * - AIChat
 * - 校園社群（唯一的社交入口）
 * - 智慧行事曆
 *
 * 移除的冗餘路由：
 * - ClassicToday → 與 SmartDashboard 重複
 * - AcademicInsightsScreen → 已整合進 SmartDashboard
 * - CourseAdvisorScreen → 已存在於 AcademicStack (AICourseAdvisor)
 * - CampusPulseScreen → 迷你版已整合進 SmartDashboard
 * - StudyBuddyScreen → 整合進校園社群
 * - GamificationScreen → XP/成就已顯示在 SmartDashboard 頂部
 * - ProactiveScreen → 智慧提醒已整合進 SmartDashboard 的建議卡片
 */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SmartDashboardScreen } from './SmartDashboardScreen';
import { AnnouncementsScreen } from './AnnouncementsScreen';
import { AnnouncementDetailScreen } from './AnnouncementDetailScreen';
import { EventsScreen } from './EventsScreen';
import { EventDetailScreen } from './EventDetailScreen';
import { AIChatScreen } from './AIChatScreen';
import { CampusSocialScreen } from './CampusSocialScreen';
import { UnifiedCalendarScreen } from './UnifiedCalendarScreen';
import { useThemeMode } from '../state/theme';
import { createStackScreenOptions } from '../ui/navigationTheme';
import type { CampusActorRole } from '../data';

const Stack = createNativeStackNavigator<any, undefined>();

const HOME_ROUTE_ROLE_REQUIREMENTS: Record<string, CampusActorRole[]> = {
  TodayHome: ['student', 'teacher', 'staff', 'department', 'admin', 'school'],
  AIChat: ['student', 'teacher', 'staff', 'department', 'admin', 'school'],
  CampusSocialScreen: ['student', 'teacher', 'staff', 'department', 'admin', 'school'],
};

export function getHomeRouteRoleRequirements(routeName: string): CampusActorRole[] {
  return (
    HOME_ROUTE_ROLE_REQUIREMENTS[routeName] ?? [
      'student',
      'teacher',
      'staff',
      'department',
      'admin',
      'school',
    ]
  );
}

export function HomeStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="TodayHome"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen
        name="TodayHome"
        component={SmartDashboardScreen}
        options={{ title: 'Today', headerShown: false }}
      />
      <Stack.Screen name="公告總覽" component={AnnouncementsScreen} options={{ title: '公告' }} />
      <Stack.Screen
        name="公告詳情"
        component={AnnouncementDetailScreen}
        options={{ title: '公告詳情' }}
      />
      <Stack.Screen name="活動總覽" component={EventsScreen} options={{ title: '活動' }} />
      <Stack.Screen name="活動詳情" component={EventDetailScreen} options={{ title: '活動詳情' }} />
      <Stack.Screen name="AIChat" component={AIChatScreen} options={{ title: 'AI 助理' }} />
      <Stack.Screen
        name="CampusSocialScreen"
        component={CampusSocialScreen}
        options={{ title: '校園社群', headerShown: false }}
      />
      <Stack.Screen
        name="SmartCalendarScreen"
        component={UnifiedCalendarScreen}
        options={{ title: '行事曆', headerShown: false }}
      />
    </Stack.Navigator>
  );
}
