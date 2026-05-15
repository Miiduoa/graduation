/* eslint-disable */
/**
 * LearnStack — 統一的「學習」Tab
 * ═══════════════════════════════════════════════════════════════════════
 * 取代原本的：
 *   - 課程 Tab (AcademicStack)
 *   - 教學 Tab (TeachingStack)
 *   - 服務 Tab (StaffStack)
 *   - 審核 Tab (DepartmentStack)
 *   - 管理 Tab (AdminStack)
 *
 * 設計：所有角色看到同一個 Tab 名字「學習」，內容依角色自動切換。
 *  - 學生/校友 → CoursesHomeScreen (我的課程、作業、成績、行事曆)
 *  - 教師/教授 → TeachingHubScreen (我的班、待批改、出席、評量)
 *  - 系所主管/校方 → DepartmentHubScreen (審核 + 教學狀況)
 *  - 管理員 → AdminDashboardScreen (全校管理)
 *  - 職員/商家 → StaffHubScreen (服務工單) 或 MerchantHubScreen
 *
 * 心理學：Tab 統一名字 = 一致心智模型；內容感知角色 = 個人化體驗。
 */
import React, { useMemo } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CoursesHomeScreen } from './CoursesHomeScreen';
import { TeachingHubScreen } from './TeachingHubScreen';
import { StaffHubScreen } from './StaffHubScreen';
import { DepartmentHubScreen } from './DepartmentHubScreen';
import { AdminDashboardScreen } from './AdminDashboardScreen';
import { AddCourseScreen } from './AddCourseScreen';
import { AcademicScreen } from './AcademicScreen';
import { CreditAuditStack } from './CreditAuditStack';
import { UnifiedCalendarScreen } from './UnifiedCalendarScreen';
import { AICourseAdvisorScreen } from './AICourseAdvisorScreen';
import { CourseHubScreen } from './CourseHubScreen';
import { CourseCatalogScreen } from './CourseCatalogScreen';
import { CourseModulesScreen } from './CourseModulesScreen';
import { QuizCenterScreen } from './QuizCenterScreen';
import { AttendanceScreen } from './AttendanceScreen';
import { ClassroomScreen } from './ClassroomScreen';
import { QuizTakingScreen } from './QuizTakingScreen';
import { PeerReviewScreen } from './PeerReviewScreen';
import AttendanceLiveScreen from './AttendanceLiveScreen';
import AttendanceAnalyticsScreen from './AttendanceAnalyticsScreen';
import { AdminCourseVerifyScreen } from './AdminCourseVerifyScreen';
import { MerchantHubScreen } from './MerchantHubScreen';
import CourseDiscussionScreen from './CourseDiscussionScreen';
import DiscussionThreadDetailScreen from './DiscussionThreadDetailScreen';
import CourseMaterialViewerScreen from './CourseMaterialViewerScreen';
import HomeworkSubmitScreen from './HomeworkSubmitScreen';
import VideoMaterialScreen from './VideoMaterialScreen';
import SurveyScreen from './SurveyScreen';
import PeerReviewSubmitScreen from './PeerReviewSubmitScreen';
import TeacherGradingScreen from './TeacherGradingScreen';
import CourseNotesScreen from './CourseNotesScreen';
import AttendanceMultiMethodScreen from './AttendanceMultiMethodScreen';
import MyQuizScoresScreen from './MyQuizScoresScreen';
import MyAttendanceHistoryScreen from './MyAttendanceHistoryScreen';
import CourseScoresScreen from './CourseScoresScreen';
import { useThemeMode } from '../state/theme';
import { createStackScreenOptions } from '../ui/navigationTheme';
import { RouteGuard } from '../ui/RouteGuard';
import { usePermissions } from '../hooks/usePermissions';
import { useAuth } from '../state/auth';

const Stack = createNativeStackNavigator<any, undefined>();

type AcademicTab = 'grades' | 'insights' | 'gradebook' | 'analytics';

function withAcademicInitialTab(tab: AcademicTab) {
  return function AcademicTabRoute(props: any) {
    const mergedParams = { ...(props.route?.params ?? {}), initialTab: tab };
    return <AcademicScreen {...props} route={{ ...props.route, params: mergedParams }} />;
  };
}

const AcademicGradesRoute = withAcademicInitialTab('grades');
const AcademicInsightsRoute = withAcademicInitialTab('insights');
const AcademicGradebookRoute = withAcademicInitialTab('gradebook');
const AcademicAnalyticsRoute = withAcademicInitialTab('analytics');

// 包裝需要「開課/管理」權限的畫面
function GuardedAddCourse(props: any) {
  return (
    <RouteGuard requires="courses.create">
      <AddCourseScreen {...props} />
    </RouteGuard>
  );
}

function GuardedAttendance(props: any) {
  return (
    <RouteGuard requires={['courses.view', 'courses.attendance']}>
      <AttendanceScreen {...props} />
    </RouteGuard>
  );
}

function GuardLearnAdminCourseVerify(props: any) {
  return (
    <RouteGuard requires="admin.course_verify">
      <AdminCourseVerifyScreen {...props} />
    </RouteGuard>
  );
}

function GuardedGradebook(props: any) {
  // 學生：看到自己這門課的成績總覽（initialTab=grades 顯示個人加權）
  // 教師：看到全班 gradebook（initialTab=gradebook）
  // 這裡不再用 RouteGuard 擋學生；改成依角色顯示不同預設 tab，
  // AcademicScreen 內已會依角色決定可看到哪些 row。
  const isTeacher = (props.route?.params?.role ?? '') === 'teacher';
  const mergedParams = {
    ...(props.route?.params ?? {}),
    initialTab: (isTeacher ? 'gradebook' : 'grades') as 'gradebook' | 'grades',
  };
  return <AcademicScreen {...props} route={{ ...props.route, params: mergedParams }} />;
}

function GuardedLearningAnalytics(props: any) {
  const mergedParams = { ...(props.route?.params ?? {}), initialTab: 'analytics' as const };
  return (
    <RouteGuard requires={['admin.analytics', 'courses.manage']}>
      <AcademicScreen {...props} route={{ ...props.route, params: mergedParams }} />
    </RouteGuard>
  );
}

/**
 * 根據角色選擇主畫面。內部用 alias，所有角色都映射到 'LearnHome' 路由。
 */
function LearnHomeDispatcher(props: any) {
  const { isStudent, isTeacher, isStaff, isDepartmentHead, isAdmin } = usePermissions();
  const auth = useAuth();

  const hasMerchant = useMemo(
    () =>
      (auth.profile?.merchantAssignments ?? []).some((a) => a.status === 'active'),
    [auth.profile?.merchantAssignments],
  );

  if (isAdmin) {
    return <AdminDashboardScreen {...props} />;
  }
  if (isDepartmentHead) {
    return <DepartmentHubScreen {...props} />;
  }
  if (isTeacher) {
    return <TeachingHubScreen {...props} />;
  }
  if (isStaff && hasMerchant) {
    return <MerchantHubScreen {...props} />;
  }
  if (isStaff) {
    return <StaffHubScreen {...props} />;
  }
  // 學生 / 校友 / 訪客 → 預設課程首頁
  return <CoursesHomeScreen {...props} />;
}

export function LearnStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="LearnHome"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen
        name="LearnHome"
        component={LearnHomeDispatcher}
        options={{ title: '學習', headerShown: false }}
      />
      {/* 保留舊路由名稱作為別名，向後相容（兩個都導到同一個 dispatcher） */}
      <Stack.Screen
        name="CoursesHome"
        component={LearnHomeDispatcher}
        options={{ title: '學習', headerShown: false }}
      />
      <Stack.Screen
        name="TeachingHub"
        component={LearnHomeDispatcher}
        options={{ title: '學習', headerShown: false }}
      />
      <Stack.Screen
        name="StaffHub"
        component={LearnHomeDispatcher}
        options={{ title: '服務', headerShown: false }}
      />
      <Stack.Screen
        name="DepartmentHub"
        component={LearnHomeDispatcher}
        options={{ title: '審核', headerShown: false }}
      />
      <Stack.Screen
        name="AdminDashboard"
        component={LearnHomeDispatcher}
        options={{ title: '管理', headerShown: false }}
      />

      <Stack.Screen
        name="CourseSchedule"
        component={UnifiedCalendarScreen}
        options={{ title: '行事曆', headerShown: false }}
      />
      <Stack.Screen name="AddCourse" component={GuardedAddCourse} options={{ title: '新增課程' }} />
      <Stack.Screen name="CourseHub" component={CourseHubScreen} options={{ title: '課程中樞' }} />
      <Stack.Screen
        name="CourseCatalog"
        component={CourseCatalogScreen}
        options={{ title: '課綱查詢', headerShown: false }}
      />
      <Stack.Screen
        name="CourseModules"
        component={CourseModulesScreen}
        options={{ title: '教材單元' }}
      />
      <Stack.Screen name="QuizCenter" component={QuizCenterScreen} options={{ title: '測驗中心' }} />
      <Stack.Screen
        name="Attendance"
        component={GuardedAttendance}
        options={{ title: '智慧點名', headerShown: false }}
      />
      <Stack.Screen
        name="AcademicOverview"
        component={AcademicScreen}
        options={{ title: '學業總覽', headerShown: false }}
      />
      <Stack.Screen
        name="CourseGradebook"
        component={GuardedGradebook}
        options={{ title: '課內成績簿' }}
      />
      <Stack.Screen name="Classroom" component={ClassroomScreen} options={{ title: '課堂互動' }} />
      <Stack.Screen
        name="Grades"
        component={AcademicGradesRoute}
        options={{ title: '成績查詢', headerShown: false }}
      />
      <Stack.Screen
        name="AcademicInsights"
        component={AcademicInsightsRoute}
        options={{ title: '學業 AI 分析', headerShown: false }}
      />
      <Stack.Screen
        name="LearningAnalytics"
        component={GuardedLearningAnalytics}
        options={{ title: '學習分析' }}
      />
      <Stack.Screen
        name="CreditAuditStack"
        component={CreditAuditStack}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Calendar"
        component={UnifiedCalendarScreen}
        options={{ title: '行事曆', headerShown: false }}
      />
      <Stack.Screen
        name="AICourseAdvisor"
        component={AICourseAdvisorScreen}
        options={{ title: 'AI 選課助理' }}
      />
      <Stack.Screen
        name="QuizTaking"
        component={QuizTakingScreen}
        options={{ title: '作答中', headerShown: false }}
      />
      <Stack.Screen
        name="PeerReview"
        component={PeerReviewScreen}
        options={{ title: '同儕互評' }}
      />
      <Stack.Screen
        name="AttendanceLive"
        component={AttendanceLiveScreen}
        options={{ title: '即時點名', headerShown: false }}
      />
      <Stack.Screen
        name="AttendanceAnalytics"
        component={AttendanceAnalyticsScreen}
        options={{ title: '出席分析', headerShown: false }}
      />
      <Stack.Screen
        name="AdminCourseVerify"
        component={GuardLearnAdminCourseVerify}
        options={{ title: '課程認證' }}
      />
      <Stack.Screen
        name="CourseDiscussion"
        component={CourseDiscussionScreen}
        options={{ title: '課程討論' }}
      />
      <Stack.Screen
        name="DiscussionThreadDetail"
        component={DiscussionThreadDetailScreen}
        options={{ title: '討論串' }}
      />
      <Stack.Screen
        name="CourseMaterialViewer"
        component={CourseMaterialViewerScreen}
        options={{ title: '在 APP 內查看', headerShown: false }}
      />
      <Stack.Screen
        name="HomeworkSubmit"
        component={HomeworkSubmitScreen}
        options={{ title: '繳交作業' }}
      />
      <Stack.Screen
        name="VideoMaterial"
        component={VideoMaterialScreen}
        options={{ title: '影片教材', headerShown: false }}
      />
      <Stack.Screen name="Survey" component={SurveyScreen} options={{ title: '課程問卷' }} />
      <Stack.Screen
        name="PeerReviewSubmit"
        component={PeerReviewSubmitScreen}
        options={{ title: '同儕互評' }}
      />
      <Stack.Screen
        name="TeacherGrading"
        component={TeacherGradingScreen}
        options={{ title: '批改作業' }}
      />
      <Stack.Screen
        name="CourseNotes"
        component={CourseNotesScreen}
        options={{ title: '課程筆記', headerShown: false }}
      />
      <Stack.Screen
        name="AttendanceMultiMethod"
        component={AttendanceMultiMethodScreen}
        options={{ title: '智慧簽到' }}
      />
      <Stack.Screen
        name="MyQuizScores"
        component={MyQuizScoresScreen}
        options={{ title: '我的測驗成績' }}
      />
      <Stack.Screen
        name="MyAttendanceHistory"
        component={MyAttendanceHistoryScreen}
        options={{ title: '我的點名紀錄' }}
      />
      <Stack.Screen
        name="CourseScores"
        component={CourseScoresScreen}
        options={{ title: '課內成績' }}
      />
    </Stack.Navigator>
  );
}
