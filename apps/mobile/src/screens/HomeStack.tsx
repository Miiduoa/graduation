/* eslint-disable */
/**
 * HomeStack — Today Tab (精簡版)
 *
 * 只保留核心路由：
 * - TodayHome: SmartDashboard（統一儀表板）
 * - 公告/活動詳情
 * - 校園社群（唯一的社交入口）
 * - CampusGame：校園漫步原型（`campus://home/campus-game`）
 * - 智慧行事曆
 *
 * AI 對話已改為全域 Overlay（App 層 AIOverlayHost），不再在此 Stack 註冊。
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
// AI-First v1 新版 Today（學生角色用）；其他角色靠 RoleAwareTodayScreen dispatch
import TodayAiFirstScreen from './TodayAiFirstScreen';
import RoleAwareTodayScreen from './RoleAwareTodayScreen';
// AI-First v1：公告 / 活動主入口；舊 AnnouncementsScreen / AnnouncementDetailScreen /
// EventsScreen / EventDetailScreen 已下架
import AnnouncementDetailAiFirstScreen from './AnnouncementDetailAiFirstScreen';
import AnnouncementsListAiFirstScreen from './AnnouncementsListAiFirstScreen';
import EventDetailAiFirstScreen from './EventDetailAiFirstScreen';
import EventsListAiFirstScreen from './EventsListAiFirstScreen';
import { AIChatScreen } from './AIChatScreen';
import { CommunityScreen } from './CommunityScreen';
import { BoardDetailScreen } from './social/BoardDetailScreen';
import { PostComposeScreen } from './social/PostComposeScreen';
import { PostDetailScreen } from './social/PostDetailScreen';
import { StoryComposeScreen } from './social/StoryComposeScreen';
import { UnifiedCalendarScreen } from './UnifiedCalendarScreen';
import { CampusGameScreen } from './CampusGameScreen';
import AIAgentConsoleScreen from './AIAgentConsoleScreen';
import { useThemeMode } from '../state/theme';
import { createStackScreenOptions } from '../ui/navigationTheme';
import type { CampusActorRole } from '../data';

const Stack = createNativeStackNavigator<any, undefined>();

const HOME_ROUTE_ROLE_REQUIREMENTS: Record<string, CampusActorRole[]> = {
  TodayHome: ['student', 'teacher', 'staff', 'department', 'admin', 'school'],
  CampusSocialScreen: ['student', 'teacher', 'staff', 'department', 'admin', 'school'],
  CampusGame: ['student', 'teacher', 'staff', 'department', 'admin', 'school'],
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
      {/* Today 主入口：用 RoleAwareTodayScreen 依角色 dispatch（student→TodayAiFirstScreen,
          teacher→TeacherCockpit, ta→TADashboard, ...）。同時在右上角浮出 DemoRolePill。 */}
      <Stack.Screen
        name="TodayHome"
        component={RoleAwareTodayScreen}
        options={{ title: 'Today', headerShown: false }}
      />
      {/* 直接進舊 student-only AI-First Today（debug 用） */}
      <Stack.Screen
        name="TodayAiFirstDirect"
        component={TodayAiFirstScreen}
        options={{ title: 'Today (學生原型)', headerShown: false }}
      />
      <Stack.Screen
        name="SmartDashboard"
        component={SmartDashboardScreen}
        options={{ title: '智慧儀表板（學生）', headerShown: false }}
      />
      <Stack.Screen name="公告總覽" component={AnnouncementsListAiFirstScreen} options={{ title: '公告', headerShown: false }} />
      <Stack.Screen
        name="公告詳情"
        component={AnnouncementDetailAiFirstScreen}
        options={{ title: '公告詳情', headerShown: false }}
      />
      <Stack.Screen name="活動總覽" component={EventsListAiFirstScreen} options={{ title: '活動', headerShown: false }} />
      <Stack.Screen name="AIChat" component={AIChatScreen} options={{ title: '校園 AI', headerShown: false }} />
      <Stack.Screen name="活動詳情" component={EventDetailAiFirstScreen} options={{ title: '活動詳情', headerShown: false }} />
      <Stack.Screen
        name="CampusSocialScreen"
        component={CommunityScreen}
        options={{ title: '校園社群', headerShown: false }}
      />
      <Stack.Screen name="CampusGame" component={CampusGameScreen} options={{ title: '校園漫步' }} />
      <Stack.Screen name="BoardDetail" component={BoardDetailScreen} options={{ title: '看板' }} />
      <Stack.Screen name="PostCompose" component={PostComposeScreen} options={{ title: '發文' }} />
      <Stack.Screen name="StoryCompose" component={StoryComposeScreen} options={{ title: '發 Story' }} />
      <Stack.Screen name="PostDetail" component={PostDetailScreen} options={{ title: '貼文' }} />
      <Stack.Screen
        name="SmartCalendarScreen"
        component={UnifiedCalendarScreen}
        options={{ title: '行事曆', headerShown: false }}
      />
      <Stack.Screen
        name="AIAgentConsole"
        component={AIAgentConsoleScreen}
        options={{ title: '🤖 AI Agent 駕駛室' }}
      />
    </Stack.Navigator>
  );
}
