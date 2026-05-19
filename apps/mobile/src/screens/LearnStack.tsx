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
// AI-First v1：學習 Tab 主入口換新版
import LearnAiFirstScreen from './LearnAiFirstScreen';
import GradesAiFirstScreen from './GradesAiFirstScreen';
import CourseHubAiFirstScreen from './CourseHubAiFirstScreen';
import AcademicOverviewAiFirstScreen from './AcademicOverviewAiFirstScreen';
import QuizCenterAiFirstScreen from './QuizCenterAiFirstScreen';
import AddCourseAiFirstScreen from './AddCourseAiFirstScreen';
import TeacherCockpitAiFirstScreen from './TeacherCockpitAiFirstScreen';
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
import TodayCockpitScreen from './TodayCockpitScreen';
import { DemoStoryScreen } from './DemoStoryScreen';
import GradeWhatIfScreen from './GradeWhatIfScreen';
import MistakeRepertoireScreen from './MistakeRepertoireScreen';
import PomodoroSessionScreen from './PomodoroSessionScreen';
import AIAgentObservatoryScreen from './AIAgentObservatoryScreen';
import AIAgentConsoleScreen from './AIAgentConsoleScreen';
import StudentInboxScreen from './StudentInboxScreen';
import MonthlySummaryScreen from './MonthlySummaryScreen';
import StudentOrdersScreen from './StudentOrdersScreen';
import LifeRequestsScreen from './LifeRequestsScreen';
import TeacherCockpitScreen from './TeacherCockpitScreen';
import TADashboardScreen from './TADashboardScreen';
import DepartmentDashboardScreen from './DepartmentDashboardScreen';
import VendorDashboardScreen from './VendorDashboardScreen';
import VendorRevenueReportScreen from './VendorRevenueReportScreen';
import VendorLoyaltyPushScreen from './VendorLoyaltyPushScreen';
import VendorMenuManageScreen from './VendorMenuManageScreen';
import StudentRiskScreen from './StudentRiskScreen';
import TeachingEvaluationScreen from './TeachingEvaluationScreen';
import AITrustCardScreen from './AITrustCardScreen';
import AIStudyBuddyScreen from './AIStudyBuddyScreen';
// LMS v2 — 新版課程子頁 (取代舊 Course*Screen 系列)
import CourseHubV2Screen from './lmsV2/CourseHubV2Screen';
import CourseMaterialsV2Screen from './lmsV2/CourseMaterialsV2Screen';
import CourseAssignmentsV2Screen from './lmsV2/CourseAssignmentsV2Screen';
import CourseAssignmentDetailV2Screen from './lmsV2/CourseAssignmentDetailV2Screen';
import CourseQuizzesV2Screen from './lmsV2/CourseQuizzesV2Screen';
import CourseQuizTakingV2Screen from './lmsV2/CourseQuizTakingV2Screen';
import CourseForumV2Screen from './lmsV2/CourseForumV2Screen';
import CourseForumTopicV2Screen from './lmsV2/CourseForumTopicV2Screen';
import CourseAnnouncementsV2Screen from './lmsV2/CourseAnnouncementsV2Screen';
import CourseGradesV2Screen from './lmsV2/CourseGradesV2Screen';
import CourseAIAssistantV2Screen from './lmsV2/CourseAIAssistantV2Screen';
import CourseQuestionBankV2Screen from './lmsV2/CourseQuestionBankV2Screen';
import CourseLiveV2Screen from './lmsV2/CourseLiveV2Screen';
import { isLmsV2Enabled } from '../services/lmsV2FeatureFlag';
import { ensureLmsV2DemoSignIn } from '../services/lmsV2DemoSignIn';
import { useThemeMode } from '../state/theme';
import { createStackScreenOptions } from '../ui/navigationTheme';
import { RouteGuard } from '../ui/RouteGuard';
import { usePermissions } from '../hooks/usePermissions';
import { useAuth } from '../state/auth';
import { resolveDashboardRole } from './RoleAwareTodayScreen';

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
  // 學生：預設成績分頁；授課身分（教師／系所／管理）預設進成績簿，與路由參數 role 脫鉤以免教授、系主管被誤判
  const { isTeacher, isDepartmentHead, isAdmin } = usePermissions();
  const openAsInstructor = isTeacher || isDepartmentHead || isAdmin;
  const mergedParams = {
    ...(props.route?.params ?? {}),
    initialTab: (openAsInstructor ? 'gradebook' : 'grades') as 'gradebook' | 'grades',
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

/** 僅 catalog 權限的職員／店家不應視為選課學生而進入個人「學業總覽」工作區；與 courses.view gate 對齊。 */
function GuardedAcademicOverview(props: any) {
  return (
    <RouteGuard requires="courses.view">
      <AcademicScreen {...props} />
    </RouteGuard>
  );
}

/** 成績／學業 AI 分頁與學業總覽相同：須具備課程工作區檢視權（與職員僅 catalog 區隔）。 */
function GuardedAcademicGrades(props: any) {
  return (
    <RouteGuard requires="courses.view">
      <AcademicGradesRoute {...props} />
    </RouteGuard>
  );
}

function GuardedAcademicInsights(props: any) {
  return (
    <RouteGuard requires="courses.view">
      <AcademicInsightsRoute {...props} />
    </RouteGuard>
  );
}

/** 畢業學分試算 — 個人選課/畢業進度規劃工具，僅限「學生」身份使用。
 *  教師 / 助教 / 系主任 / 管理員 / 校友 / 訪客一律攔截到友善說明頁,
 *  與 web 端 /credit-planner 行為對齊。
 */
function GuardedCreditAuditLearn(props: any) {
  const { isStudent, displayName } = usePermissions();
  if (isStudent) {
    return <CreditAuditStack {...props} />;
  }
  return <CreditAuditBlockedScreen roleLabel={displayName} navigation={props.navigation} />;
}

function CreditAuditBlockedScreen({ roleLabel, navigation }: { roleLabel: string; navigation: any }) {
  // 動態 import 避免在 LearnStack 頂端拉一堆 RN UI module(只在阻擋時才用)
  const { View, Text, Pressable, ScrollView } = require('react-native');
  const { Ionicons } = require('@expo/vector-icons');
  const { theme } = require('../ui/theme');
  return (
    <ScrollView contentContainerStyle={{ padding: 20, alignItems: 'center', backgroundColor: theme.bg }}>
      <View style={{ marginTop: 60, padding: 24, alignItems: 'center', maxWidth: 420 }}>
        <View style={{
          width: 80, height: 80, borderRadius: 24,
          backgroundColor: 'rgba(88,86,214,0.10)',
          alignItems: 'center', justifyContent: 'center', marginBottom: 16,
        }}>
          <Ionicons name="school-outline" size={48} color="#5856D6" />
        </View>
        <Text style={{ fontSize: 20, fontWeight: '700', color: theme.text, marginBottom: 8, textAlign: 'center' }}>
          學分試算僅限在校學生使用
        </Text>
        <Text style={{ fontSize: 14, color: theme.muted, lineHeight: 22, textAlign: 'center', marginBottom: 24 }}>
          目前身份為 <Text style={{ fontWeight: '700', color: theme.text }}>{roleLabel}</Text>。
          學分試算是學生個人選課與畢業進度規劃工具,屬學生專屬功能 — 教師/職員可由「教學工作台」管理課程,系主任/管理員可由「管理後台」查看全系統計。
        </Text>
        <Pressable
          onPress={() => navigation?.goBack?.()}
          style={{
            paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12,
            backgroundColor: '#5856D6',
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>← 返回</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/** 選課助理：學生／教師用課程工作區；職員僅限課綱查詢語意時保留 catalog 唯讀。 */
function GuardedAICourseAdvisor(props: any) {
  return (
    <RouteGuard requires={['courses.view', 'courses.catalog']}>
      <AICourseAdvisorScreen {...props} />
    </RouteGuard>
  );
}

/** 職員／店家／通知 deeplink 進入課程 chip 流時，需具備 courses.view；否則由 RouteGuard 引導至課綱查詢等 fallback */
function guardCourseView(Component: React.ComponentType<any>) {
  return function GuardedCourseWorkspace(props: any) {
    return (
      <RouteGuard requires="courses.view">
        <Component {...props} />
      </RouteGuard>
    );
  };
}

function GuardedTeacherGrading(props: any) {
  return (
    <RouteGuard requires={['courses.grade', 'courses.manage']}>
      <TeacherGradingScreen {...props} />
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

  // 1. demo 帳號 uid 優先判斷（最精準）
  const demoResolved = resolveDashboardRole({
    uid: auth.user?.uid ?? null,
    roleGroup: auth.profile?.roleGroup ?? null,
    role: auth.profile?.role ?? null,
  });
  if (demoResolved === 'vendor') {
    return <VendorDashboardScreen {...props} />;
  }
  if (demoResolved === 'ta') {
    return <TADashboardScreen {...props} />;
  }

  // 2. 一般 roleGroup 判斷
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

  // LMS v2:首次進入學習 Tab 時,自動用 demo 帳號登入 Supabase
  // (Production 改用 lmsAuthBridge)
  React.useEffect(() => {
    if (isLmsV2Enabled()) {
      ensureLmsV2DemoSignIn('student').then(r => {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          // eslint-disable-next-line no-console
          console.log('[LMS v2] demo sign-in:', r);
        }
      });
    }
  }, []);

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="LearnHome"
      screenOptions={createStackScreenOptions()}
    >
      {/* AI-First v1：landing 唯一入口 */}
      <Stack.Screen
        name="LearnHome"
        component={LearnAiFirstScreen}
        options={{ title: '學習', headerShown: false }}
      />
      {/* 保留舊路由名稱作為別名（向後相容 deep link），全部導向新版 landing */}
      <Stack.Screen
        name="CoursesHome"
        component={LearnAiFirstScreen}
        options={{ title: '學習', headerShown: false }}
      />
      <Stack.Screen
        name="TeachingHub"
        component={LearnAiFirstScreen}
        options={{ title: '學習', headerShown: false }}
      />
      <Stack.Screen
        name="StaffHub"
        component={LearnAiFirstScreen}
        options={{ title: '服務', headerShown: false }}
      />
      <Stack.Screen
        name="DepartmentHub"
        component={LearnAiFirstScreen}
        options={{ title: '審核', headerShown: false }}
      />
      <Stack.Screen
        name="AdminDashboard"
        component={LearnAiFirstScreen}
        options={{ title: '管理', headerShown: false }}
      />

      <Stack.Screen
        name="CourseSchedule"
        component={UnifiedCalendarScreen}
        options={{ title: '行事曆', headerShown: false }}
      />
      <Stack.Screen name="AddCourse" component={AddCourseAiFirstScreen} options={{ title: '新增課程', headerShown: false }} />
      {/* ═══════════════════════════════════════════════════════════
          LMS v2 整批接管:Supabase 連上時,舊路由名沿用但 component 改 V2
          (保留路由名 = CoursesHomeScreen/TodayCockpit 不用改;component 換掉 = 看到新 UI)
          ═══════════════════════════════════════════════════════════ */}
      {/* AI-First v1：課程中樞唯一入口 */}
      <Stack.Screen
        name="CourseHub"
        component={CourseHubAiFirstScreen}
        options={{ title: '課程中樞', headerShown: false }}
      />
      <Stack.Screen
        name="CourseModules"
        component={isLmsV2Enabled() ? CourseHubV2Screen : guardCourseView(CourseModulesScreen)}
        options={{ title: '課程', headerShown: false }}
      />
      {/* LMS v2 課程子頁(13 個)*/}
      <Stack.Screen name="CourseHubV2" component={CourseHubV2Screen} options={{ title: '課程中樞', headerShown: false }} />
      <Stack.Screen name="CourseMaterialsV2" component={CourseMaterialsV2Screen} options={{ title: '教材', headerShown: false }} />
      <Stack.Screen name="CourseAssignmentsV2" component={CourseAssignmentsV2Screen} options={{ title: '作業', headerShown: false }} />
      <Stack.Screen name="CourseAssignmentDetailV2" component={CourseAssignmentDetailV2Screen} options={{ title: '作業', headerShown: false }} />
      <Stack.Screen name="CourseQuizzesV2" component={CourseQuizzesV2Screen} options={{ title: '測驗', headerShown: false }} />
      <Stack.Screen name="CourseQuizTakingV2" component={CourseQuizTakingV2Screen} options={{ title: '作答', headerShown: false }} />
      <Stack.Screen name="CourseForumV2" component={CourseForumV2Screen} options={{ title: '討論', headerShown: false }} />
      <Stack.Screen name="CourseForumTopicV2" component={CourseForumTopicV2Screen} options={{ title: '討論', headerShown: false }} />
      <Stack.Screen name="CourseAnnouncementsV2" component={CourseAnnouncementsV2Screen} options={{ title: '公告', headerShown: false }} />
      <Stack.Screen name="CourseGradesV2" component={CourseGradesV2Screen} options={{ title: '成績', headerShown: false }} />
      <Stack.Screen name="CourseAIAssistantV2" component={CourseAIAssistantV2Screen} options={{ title: 'AI 助教', headerShown: false }} />
      <Stack.Screen name="CourseQuestionBankV2" component={CourseQuestionBankV2Screen} options={{ title: '題庫', headerShown: false }} />
      <Stack.Screen name="CourseLiveV2" component={CourseLiveV2Screen} options={{ title: '直播', headerShown: false }} />
      <Stack.Screen
        name="CourseCatalog"
        component={CourseCatalogScreen}
        options={{ title: '課綱查詢', headerShown: false }}
      />
      <Stack.Screen
        name="QuizCenter"
        component={QuizCenterAiFirstScreen}
        options={{ title: '測驗', headerShown: false }}
      />
      <Stack.Screen
        name="Attendance"
        component={isLmsV2Enabled() ? CourseLiveV2Screen : GuardedAttendance}
        options={{ title: '智慧點名', headerShown: false }}
      />
      <Stack.Screen
        name="AcademicOverview"
        component={AcademicOverviewAiFirstScreen}
        options={{ title: '學業總覽', headerShown: false }}
      />
      <Stack.Screen
        name="CourseGradebook"
        component={isLmsV2Enabled() ? CourseGradesV2Screen : GuardedGradebook}
        options={{ title: '成績', headerShown: false }}
      />
      <Stack.Screen
        name="Classroom"
        component={guardCourseView(ClassroomScreen)}
        options={{ title: '課堂互動' }}
      />
      {/* AI-First v1：Grades 唯一入口 */}
      <Stack.Screen
        name="Grades"
        component={GradesAiFirstScreen}
        options={{ title: '成績', headerShown: false }}
      />
      <Stack.Screen
        name="AcademicInsights"
        component={GuardedAcademicInsights}
        options={{ title: '學業 AI 分析', headerShown: false }}
      />
      <Stack.Screen
        name="LearningAnalytics"
        component={GuardedLearningAnalytics}
        options={{ title: '學習分析' }}
      />
      <Stack.Screen
        name="CreditAuditStack"
        component={GuardedCreditAuditLearn}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Calendar"
        component={UnifiedCalendarScreen}
        options={{ title: '行事曆', headerShown: false }}
      />
      <Stack.Screen
        name="AICourseAdvisor"
        component={GuardedAICourseAdvisor}
        options={{ title: 'AI 選課助理' }}
      />
      <Stack.Screen
        name="QuizTaking"
        component={isLmsV2Enabled() ? CourseQuizTakingV2Screen : guardCourseView(QuizTakingScreen)}
        options={{ title: '作答中', headerShown: false }}
      />
      <Stack.Screen
        name="PeerReview"
        component={guardCourseView(PeerReviewScreen)}
        options={{ title: '同儕互評' }}
      />
      <Stack.Screen
        name="AttendanceLive"
        component={guardCourseView(AttendanceLiveScreen)}
        options={{ title: '即時點名', headerShown: false }}
      />
      <Stack.Screen
        name="AttendanceAnalytics"
        component={guardCourseView(AttendanceAnalyticsScreen)}
        options={{ title: '出席分析', headerShown: false }}
      />
      <Stack.Screen
        name="AdminCourseVerify"
        component={GuardLearnAdminCourseVerify}
        options={{ title: '課程認證' }}
      />
      <Stack.Screen
        name="CourseDiscussion"
        component={isLmsV2Enabled() ? CourseForumV2Screen : guardCourseView(CourseDiscussionScreen)}
        options={{ title: '課程討論', headerShown: false }}
      />
      <Stack.Screen
        name="DiscussionThreadDetail"
        component={isLmsV2Enabled() ? CourseForumTopicV2Screen : guardCourseView(DiscussionThreadDetailScreen)}
        options={{ title: '討論串', headerShown: false }}
      />
      <Stack.Screen
        name="CourseMaterialViewer"
        component={guardCourseView(CourseMaterialViewerScreen)}
        options={{ title: '在 APP 內查看', headerShown: false }}
      />
      <Stack.Screen
        name="HomeworkSubmit"
        component={isLmsV2Enabled() ? CourseAssignmentDetailV2Screen : guardCourseView(HomeworkSubmitScreen)}
        options={{ title: '繳交作業', headerShown: false }}
      />
      <Stack.Screen
        name="VideoMaterial"
        component={guardCourseView(VideoMaterialScreen)}
        options={{ title: '影片教材', headerShown: false }}
      />
      <Stack.Screen
        name="Survey"
        component={guardCourseView(SurveyScreen)}
        options={{ title: '課程問卷' }}
      />
      <Stack.Screen
        name="PeerReviewSubmit"
        component={guardCourseView(PeerReviewSubmitScreen)}
        options={{ title: '同儕互評' }}
      />
      <Stack.Screen
        name="TeacherGrading"
        component={GuardedTeacherGrading}
        options={{ title: '批改作業' }}
      />
      <Stack.Screen
        name="CourseNotes"
        component={guardCourseView(CourseNotesScreen)}
        options={{ title: '課程筆記', headerShown: false }}
      />
      <Stack.Screen
        name="AttendanceMultiMethod"
        component={isLmsV2Enabled() ? CourseLiveV2Screen : guardCourseView(AttendanceMultiMethodScreen)}
        options={{ title: '智慧簽到', headerShown: false }}
      />
      <Stack.Screen
        name="MyQuizScores"
        component={guardCourseView(MyQuizScoresScreen)}
        options={{ title: '我的測驗成績' }}
      />
      <Stack.Screen
        name="MyAttendanceHistory"
        component={guardCourseView(MyAttendanceHistoryScreen)}
        options={{ title: '我的點名紀錄' }}
      />
      <Stack.Screen
        name="CourseScores"
        component={isLmsV2Enabled() ? CourseGradesV2Screen : guardCourseView(CourseScoresScreen)}
        options={{ title: '課內成績', headerShown: false }}
      />
      <Stack.Screen
        name="TodayCockpit"
        component={TodayCockpitScreen}
        options={{ title: '🚀 今日駕駛艙' }}
      />
      <Stack.Screen
        name="DemoStory"
        component={DemoStoryScreen}
        options={{ title: '今天的故事' }}
      />
      <Stack.Screen
        name="GradeWhatIf"
        component={GradeWhatIfScreen}
        options={{ title: '📊 成績試算' }}
      />
      <Stack.Screen
        name="MistakeRepertoire"
        component={MistakeRepertoireScreen}
        options={{ title: '🧠 錯題本' }}
      />
      <Stack.Screen
        name="TeacherCockpit"
        component={TeacherCockpitAiFirstScreen}
        options={{ title: '👨‍🏫 教師駕駛艙' }}
      />
      <Stack.Screen
        name="PomodoroSession"
        component={PomodoroSessionScreen}
        options={{ title: '🍅 番茄專注' }}
      />
      <Stack.Screen
        name="AIAgentObservatory"
        component={AIAgentObservatoryScreen}
        options={{ title: '🤖 AI 觀察台' }}
      />
      <Stack.Screen
        name="AIAgentConsole"
        component={AIAgentConsoleScreen}
        options={{ title: '🤖 AI Agent 駕駛室' }}
      />
      <Stack.Screen
        name="StudentInbox"
        component={StudentInboxScreen}
        options={{ title: '📥 我的 Inbox' }}
      />
      <Stack.Screen
        name="MonthlySummary"
        component={MonthlySummaryScreen}
        options={{ title: '📅 本月學習回顧' }}
      />
      <Stack.Screen
        name="StudentOrders"
        component={StudentOrdersScreen}
        options={{ title: '🛒 我的訂單' }}
      />
      <Stack.Screen
        name="VendorRevenueReport"
        component={VendorRevenueReportScreen}
        options={{ title: '📊 月度報表' }}
      />
      <Stack.Screen
        name="VendorLoyaltyPush"
        component={VendorLoyaltyPushScreen}
        options={{ title: '📣 Loyalty 推播' }}
      />
      <Stack.Screen
        name="VendorMenuManage"
        component={VendorMenuManageScreen}
        options={{ title: '🍽 菜單管理' }}
      />
      <Stack.Screen
        name="StudentRisk"
        component={StudentRiskScreen}
        options={{ title: '🏛 學生風險' }}
      />
      <Stack.Screen
        name="TeachingEvaluation"
        component={TeachingEvaluationScreen}
        options={{ title: '🏛 教學評鑑' }}
      />
      <Stack.Screen
        name="AITrustCard"
        component={AITrustCardScreen}
        options={{ title: '🛡 AI 信任卡' }}
      />
      <Stack.Screen
        name="AIStudyBuddy"
        component={AIStudyBuddyScreen}
        options={{ title: '🤝 AI 學伴' }}
      />
      <Stack.Screen
        name="LifeRequests"
        component={LifeRequestsScreen}
        options={{ title: '📝 請假 / 報修' }}
      />
    </Stack.Navigator>
  );
}
