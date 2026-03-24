/* eslint-disable */
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { PersonalHubScreen } from "./PersonalHubScreen";
import { SettingsScreen } from "./SettingsScreen";
import { ProfileEditScreen } from "./ProfileEditScreen";
import { NotificationsScreen } from "./NotificationsScreen";
import { NotificationSettingsScreen } from "./NotificationSettingsScreen";
import { QRCodeScreen } from "./QRCodeScreen";
import { GlobalSearchScreen } from "./GlobalSearchScreen";
import { WidgetPreviewScreen } from "./WidgetPreviewScreen";
import { AchievementsScreen } from "./AchievementsScreen";
import { AdminDashboardScreen } from "./AdminDashboardScreen";
import { AdminCourseVerifyScreen } from "./AdminCourseVerifyScreen";
import { SSOLoginScreen } from "./SSOLoginScreen";
import { DataExportScreen } from "./DataExportScreen";
import { AccountDeletionScreen } from "./AccountDeletionScreen";
import { AccessibilitySettingsScreen } from "./AccessibilitySettingsScreen";
import { LanguageSettingsScreen } from "./LanguageSettingsScreen";
import { BugReportScreen } from "./BugReportScreen";
import { ThemePreviewScreen } from "./ThemePreviewScreen";
import { FeedbackScreen } from "./FeedbackScreen";
import { HelpScreen } from "./HelpScreen";
import { MerchantHubScreen } from "./MerchantHubScreen";
import { CreditAuditStack } from "./CreditAuditStack";
import { useThemeMode } from "../state/theme";
import { createStackScreenOptions } from "../ui/navigationTheme";
import { RouteGuard } from "../ui/RouteGuard";

const Stack = createNativeStackNavigator<any, undefined>();

// Route-guarded wrappers — 防止直接 deep-link 繞過權限
function GuardedAdminDashboard(props: any) {
  return (
    <RouteGuard requires="admin.dashboard">
      <AdminDashboardScreen {...props} />
    </RouteGuard>
  );
}

function GuardedAdminCourseVerify(props: any) {
  return (
    <RouteGuard requires="admin.course_verify">
      <AdminCourseVerifyScreen {...props} />
    </RouteGuard>
  );
}

export function MeStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="MeHome"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen name="MeHome" component={PersonalHubScreen} options={{ title: "我的", headerShown: false }} />

      <Stack.Screen name="ProfileEdit" component={ProfileEditScreen} options={{ title: "編輯個人資料" }} />
      <Stack.Screen name="SSOLogin" component={SSOLoginScreen} options={{ title: "學校登入" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "通知" }} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} options={{ title: "通知設定" }} />
      <Stack.Screen name="QRCode" component={QRCodeScreen} options={{ title: "QR 碼" }} />
      <Stack.Screen name="MerchantHub" component={MerchantHubScreen} options={{ title: "商家接單" }} />

      <Stack.Screen name="Achievements" component={AchievementsScreen} options={{ title: "成就與積分" }} />
      <Stack.Screen name="GlobalSearch" component={GlobalSearchScreen} options={{ title: "搜尋" }} />
      <Stack.Screen name="WidgetPreview" component={WidgetPreviewScreen} options={{ title: "小工具" }} />
      <Stack.Screen name="CreditAuditStack" component={CreditAuditStack} options={{ headerShown: false }} />

      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "設定" }} />
      <Stack.Screen name="LanguageSettings" component={LanguageSettingsScreen} options={{ title: "語言設定" }} />
      <Stack.Screen name="AccessibilitySettings" component={AccessibilitySettingsScreen} options={{ title: "無障礙設定" }} />
      <Stack.Screen name="ThemePreview" component={ThemePreviewScreen} options={{ title: "主題預覽" }} />

      <Stack.Screen name="Help" component={HelpScreen} options={{ title: "幫助中心" }} />
      <Stack.Screen name="Feedback" component={FeedbackScreen} options={{ title: "意見回饋" }} />
      <Stack.Screen name="BugReport" component={BugReportScreen} options={{ title: "回報問題" }} />

      <Stack.Screen name="DataExport" component={DataExportScreen} options={{ title: "資料匯出" }} />
      <Stack.Screen name="AccountDeletion" component={AccountDeletionScreen} options={{ title: "刪除帳號" }} />

      {/* 🔒 Route-guarded — 非授權使用者即使 deep-link 也會看到拒絕畫面 */}
      <Stack.Screen name="AdminDashboard" component={GuardedAdminDashboard} options={{ title: "管理員控制台" }} />
      <Stack.Screen name="AdminCourseVerify" component={GuardedAdminCourseVerify} options={{ title: "課程認證" }} />
    </Stack.Navigator>
  );
}
