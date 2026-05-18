/* eslint-disable */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// AI-First v1：我的 Tab 主入口（舊版 PersonalHubScreen / ProfileEditScreen /
// SettingsScreen / NotificationsScreen / AchievementsScreen 已下架，
// 引用全部走 *AiFirstScreen）
import MeAiFirstScreen from './MeAiFirstScreen';
import ProfileEditAiFirstScreen from './ProfileEditAiFirstScreen';
import AchievementsAiFirstScreen from './AchievementsAiFirstScreen';
import SettingsAiFirstScreen from './SettingsAiFirstScreen';
import NotificationsAiFirstScreen from './NotificationsAiFirstScreen';
import { NotificationSettingsScreen } from './NotificationSettingsScreen';
import { QRCodeScreen } from './QRCodeScreen';
import { GlobalSearchScreen } from './GlobalSearchScreen';
import { WidgetPreviewScreen } from './WidgetPreviewScreen';
import { CampusGardenScreen } from './CampusGardenScreen';
import CompanionScreen from './CompanionScreen';
import CompanionCollectionScreen from './CompanionCollectionScreen';
import ConstellationScreen from './ConstellationScreen';
import DataFlowDebugScreen from './DataFlowDebugScreen';
import { AdminDashboardScreen } from './AdminDashboardScreen';
import { AdminCourseVerifyScreen } from './AdminCourseVerifyScreen';
import { SSOLoginScreen } from './SSOLoginScreen';
import { DataExportScreen } from './DataExportScreen';
import { AccountDeletionScreen } from './AccountDeletionScreen';
import { AccessibilitySettingsScreen } from './AccessibilitySettingsScreen';
import { LanguageSettingsScreen } from './LanguageSettingsScreen';
import { BugReportScreen } from './BugReportScreen';
import { ThemePreviewScreen } from './ThemePreviewScreen';
import { FeedbackScreen } from './FeedbackScreen';
import { HelpScreen } from './HelpScreen';
import { PostLoginDebugScreen } from './PostLoginDebugScreen';
import { MerchantHubScreen } from './MerchantHubScreen';
import { CreditAuditStack } from './CreditAuditStack';
import AIModelManagerScreen from './AIModelManagerScreen';
import { useThemeMode } from '../state/theme';
import { createStackScreenOptions } from '../ui/navigationTheme';
import { RouteGuard } from '../ui/RouteGuard';

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

/** 學分／畢業試算與個人修課資料綁定；職員身分僅 catalog 時不應進入。 */
function GuardedCreditAuditStack(props: any) {
  return (
    <RouteGuard requires="courses.view">
      <CreditAuditStack {...props} />
    </RouteGuard>
  );
}

/** 成就與 gamification：student/teacher 等有 achievements.view；無權限不透過 deep link 進入。 */
function GuardedAchievementsAiFirst(props: any) {
  return (
    <RouteGuard requires="achievements.view">
      <AchievementsAiFirstScreen {...props} />
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
      {/* AI-First v1：landing 換新版 */}
      <Stack.Screen
        name="MeHome"
        component={MeAiFirstScreen}
        options={{ title: '我的', headerShown: false }}
      />
      <Stack.Screen
        name="ProfileEdit"
        component={ProfileEditAiFirstScreen}
        options={{ title: '編輯個人資料', headerShown: false }}
      />
      <Stack.Screen name="SSOLogin" component={SSOLoginScreen} options={{ title: '學校登入' }} />
      <Stack.Screen
        name="Notifications"
        component={NotificationsAiFirstScreen}
        options={{ title: '通知', headerShown: false }}
      />
      <Stack.Screen
        name="NotificationSettings"
        component={NotificationSettingsScreen}
        options={{ title: '通知設定' }}
      />
      <Stack.Screen name="QRCode" component={QRCodeScreen} options={{ title: 'QR 碼' }} />
      <Stack.Screen
        name="MerchantHub"
        component={MerchantHubScreen}
        options={{ title: '商家接單' }}
      />

      <Stack.Screen
        name="Achievements"
        component={GuardedAchievementsAiFirst}
        options={{ title: '成就與積分' }}
      />
      <Stack.Screen
        name="CampusGarden"
        component={CampusGardenScreen}
        options={{ title: '校園園地' }}
      />
      <Stack.Screen
        name="Companion"
        component={CompanionScreen}
        options={{ title: '校園精靈' }}
      />
      <Stack.Screen
        name="CompanionCollection"
        component={CompanionCollectionScreen}
        options={{ title: '我的收藏' }}
      />
      <Stack.Screen
        name="Constellation"
        component={ConstellationScreen}
        options={{ title: '校園星圖' }}
      />
      <Stack.Screen
        name="DataFlowDebug"
        component={DataFlowDebugScreen}
        options={{ title: '🔍 資料流診斷' }}
      />
      <Stack.Screen
        name="GlobalSearch"
        component={GlobalSearchScreen}
        options={{ title: '搜尋' }}
      />
      <Stack.Screen
        name="WidgetPreview"
        component={WidgetPreviewScreen}
        options={{ title: '小工具' }}
      />
      <Stack.Screen
        name="CreditAuditStack"
        component={GuardedCreditAuditStack}
        options={{ headerShown: false }}
      />

      <Stack.Screen
        name="AIModelManager"
        component={AIModelManagerScreen}
        options={{ title: 'AI 模型管理' }}
      />
      <Stack.Screen name="Settings" component={SettingsAiFirstScreen} options={{ title: '設定', headerShown: false }} />
      <Stack.Screen
        name="LanguageSettings"
        component={LanguageSettingsScreen}
        options={{ title: '語言設定' }}
      />
      <Stack.Screen
        name="AccessibilitySettings"
        component={AccessibilitySettingsScreen}
        options={{ title: '無障礙設定' }}
      />
      <Stack.Screen
        name="ThemePreview"
        component={ThemePreviewScreen}
        options={{ title: '主題預覽' }}
      />

      <Stack.Screen name="Help" component={HelpScreen} options={{ title: '幫助中心' }} />
      <Stack.Screen
        name="PostLoginDebug"
        component={PostLoginDebugScreen}
        options={{ title: 'Post-login 除錯' }}
      />
      <Stack.Screen name="Feedback" component={FeedbackScreen} options={{ title: '意見回饋' }} />
      <Stack.Screen name="BugReport" component={BugReportScreen} options={{ title: '回報問題' }} />

      <Stack.Screen
        name="DataExport"
        component={DataExportScreen}
        options={{ title: '資料匯出' }}
      />
      <Stack.Screen
        name="AccountDeletion"
        component={AccountDeletionScreen}
        options={{ title: '刪除帳號' }}
      />

      {/* 🔒 Route-guarded — 非授權使用者即使 deep-link 也會看到拒絕畫面 */}
      <Stack.Screen
        name="AdminDashboard"
        component={GuardedAdminDashboard}
        options={{ title: '管理員控制台' }}
      />
      <Stack.Screen
        name="AdminCourseVerify"
        component={GuardedAdminCourseVerify}
        options={{ title: '課程認證' }}
      />
    </Stack.Navigator>
  );
}
