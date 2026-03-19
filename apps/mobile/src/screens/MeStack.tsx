import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { MeScreen } from "./MeScreen";
import { SettingsScreen } from "./SettingsScreen";
import { ProfileEditScreen } from "./ProfileEditScreen";
import { NotificationsScreen } from "./NotificationsScreen";
import { NotificationSettingsScreen } from "./NotificationSettingsScreen";
import { QRCodeScreen } from "./QRCodeScreen";
import { GlobalSearchScreen } from "./GlobalSearchScreen";
import { PaymentScreen } from "./PaymentScreen";
import { WidgetPreviewScreen } from "./WidgetPreviewScreen";
import { LibraryScreen } from "./LibraryScreen";
import { LostFoundScreen } from "./LostFoundScreen";
import { LostFoundDetailScreen } from "./LostFoundDetailScreen";
import { LostFoundPostScreen } from "./LostFoundPostScreen";
import { PrintServiceScreen } from "./PrintServiceScreen";
import { DormitoryScreen } from "./DormitoryScreen";
import { HealthScreen } from "./HealthScreen";
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
import { useThemeMode } from "../state/theme";
import { createStackScreenOptions } from "../ui/navigationTheme";
/* 訊息/群組 Screens — 從原 MessagesStack 合併進來（4-Tab 架構重組） */
import { InboxScreen } from "./InboxScreen";
import { MessagesHomeScreen } from "./MessagesHomeScreen";
import { GroupsScreen } from "./GroupsScreen";
import { GroupDetailScreen } from "./GroupDetailScreen";
import { GroupMembersScreen } from "./GroupMembersScreen";
import { GroupPostScreen } from "./GroupPostScreen";
import { GroupAssignmentsScreen } from "./GroupAssignmentsScreen";
import { AssignmentDetailScreen } from "./AssignmentDetailScreen";
import { DmsScreen } from "./DmsScreen";
import { ChatScreen } from "./ChatScreen";

const Stack = createNativeStackNavigator<any, undefined>();

export function MeStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="MeHome"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen name="MeHome" component={MeScreen} options={{ title: "我的", headerShown: false }} />

      {/* 帳號 */}
      <Stack.Screen name="ProfileEdit" component={ProfileEditScreen} options={{ title: "編輯個人資料" }} />
      <Stack.Screen name="SSOLogin" component={SSOLoginScreen} options={{ title: "學校 SSO 登入" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "通知" }} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} options={{ title: "通知設定" }} />
      <Stack.Screen name="QRCode" component={QRCodeScreen} options={{ title: "QR 碼" }} />

      {/* 校園服務 */}
      <Stack.Screen name="Library" component={LibraryScreen} options={{ title: "圖書館" }} />
      <Stack.Screen name="Health" component={HealthScreen} options={{ title: "校園健康" }} />
      <Stack.Screen name="Dormitory" component={DormitoryScreen} options={{ title: "宿舍服務" }} />
      <Stack.Screen name="PrintService" component={PrintServiceScreen} options={{ title: "列印服務" }} />
      <Stack.Screen name="LostFound" component={LostFoundScreen} options={{ title: "失物招領" }} />
      <Stack.Screen name="LostFoundDetail" component={LostFoundDetailScreen} options={{ title: "物品詳情" }} />
      <Stack.Screen name="LostFoundPost" component={LostFoundPostScreen} options={{ title: "發布招領" }} />
      <Stack.Screen name="Payment" component={PaymentScreen} options={{ title: "校園支付" }} />
      <Stack.Screen name="Achievements" component={AchievementsScreen} options={{ title: "成就與積分" }} />
      <Stack.Screen name="GlobalSearch" component={GlobalSearchScreen} options={{ title: "搜尋" }} />
      <Stack.Screen name="WidgetPreview" component={WidgetPreviewScreen} options={{ title: "小工具" }} />

      {/* 設定 */}
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "設定" }} />
      <Stack.Screen name="LanguageSettings" component={LanguageSettingsScreen} options={{ title: "語言設定" }} />
      <Stack.Screen name="AccessibilitySettings" component={AccessibilitySettingsScreen} options={{ title: "無障礙設定" }} />
      <Stack.Screen name="ThemePreview" component={ThemePreviewScreen} options={{ title: "主題預覽" }} />

      {/* 支援 */}
      <Stack.Screen name="Help" component={HelpScreen} options={{ title: "幫助中心" }} />
      <Stack.Screen name="Feedback" component={FeedbackScreen} options={{ title: "意見回饋" }} />
      <Stack.Screen name="BugReport" component={BugReportScreen} options={{ title: "回報問題" }} />

      {/* 帳號安全 */}
      <Stack.Screen name="DataExport" component={DataExportScreen} options={{ title: "資料匯出" }} />
      <Stack.Screen name="AccountDeletion" component={AccountDeletionScreen} options={{ title: "刪除帳號" }} />

      {/* 管理員 */}
      <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} options={{ title: "管理員控制台" }} />
      <Stack.Screen name="AdminCourseVerify" component={AdminCourseVerifyScreen} options={{ title: "課程認證" }} />

      {/* 訊息/群組（由原 MessagesStack 合併）— 4-Tab 架構：Relatedness 需求整合進「我的」 */}
      <Stack.Screen name="Inbox" component={InboxScreen} options={{ title: "收件匣", headerShown: false }} />
      <Stack.Screen name="MessagesHome" component={MessagesHomeScreen} options={{ title: "訊息" }} />
      <Stack.Screen name="Groups" component={GroupsScreen} options={{ title: "群組" }} />
      <Stack.Screen name="GroupDetail" component={GroupDetailScreen} options={{ title: "群組" }} />
      <Stack.Screen name="GroupMembers" component={GroupMembersScreen} options={{ title: "成員" }} />
      <Stack.Screen name="GroupPost" component={GroupPostScreen} options={{ title: "貼文" }} />
      <Stack.Screen name="GroupAssignments" component={GroupAssignmentsScreen} options={{ title: "作業" }} />
      <Stack.Screen name="AssignmentDetail" component={AssignmentDetailScreen} options={{ title: "作業詳情" }} />
      <Stack.Screen name="Dms" component={DmsScreen} options={{ title: "私訊" }} />
      <Stack.Screen name="Chat" component={ChatScreen} options={{ title: "對話" }} />
    </Stack.Navigator>
  );
}
