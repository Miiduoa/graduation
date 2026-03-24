/* eslint-disable */
/**
 * HomeStack — Today Tab
 *
 * 心理學架構：
 * - Temporal Self-Regulation：今日 Dashboard + 收件匣整合，同一個時間心智框架
 * - Zeigarnik Effect：未完成任務始終可見
 * - Peak-End Rule：每日體驗以正向的「完成感」作結
 *
 * 包含：今日首頁、公告、活動（收件匣任務整合進 TodayScreen）
 */
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { TodayScreen } from "./TodayScreen";
import { AnnouncementsScreen } from "./AnnouncementsScreen";
import { AnnouncementDetailScreen } from "./AnnouncementDetailScreen";
import { EventsScreen } from "./EventsScreen";
import { EventDetailScreen } from "./EventDetailScreen";
import { AIChatScreen } from "./AIChatScreen";
import { useThemeMode } from "../state/theme";
import { createStackScreenOptions } from "../ui/navigationTheme";

const Stack = createNativeStackNavigator<any, undefined>();

export function HomeStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="TodayHome"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen name="TodayHome" component={TodayScreen} options={{ title: "Today", headerShown: false }} />
      <Stack.Screen name="公告總覽" component={AnnouncementsScreen} options={{ title: "公告" }} />
      <Stack.Screen name="公告詳情" component={AnnouncementDetailScreen} options={{ title: "公告詳情" }} />
      <Stack.Screen name="活動總覽" component={EventsScreen} options={{ title: "活動" }} />
      <Stack.Screen name="活動詳情" component={EventDetailScreen} options={{ title: "活動詳情" }} />
      <Stack.Screen name="AIChat" component={AIChatScreen} options={{ title: "AI 助理" }} />
    </Stack.Navigator>
  );
}
