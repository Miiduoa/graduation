/* eslint-disable */
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CoursesHomeScreen } from "./CoursesHomeScreen";
import { CourseScheduleScreen } from "./CourseScheduleScreen";
import { AddCourseScreen } from "./AddCourseScreen";
import { GradesScreen } from "./GradesScreen";
import { CreditAuditStack } from "./CreditAuditStack";
import { CalendarScreen } from "./CalendarScreen";
import { AICourseAdvisorScreen } from "./AICourseAdvisorScreen";
import { AIChatScreen } from "./AIChatScreen";
import { CourseHubScreen } from "./CourseHubScreen";
import { CourseModulesScreen } from "./CourseModulesScreen";
import { QuizCenterScreen } from "./QuizCenterScreen";
import { AttendanceScreen } from "./AttendanceScreen";
import { ClassroomScreen } from "./ClassroomScreen";
import { LearningAnalyticsScreen } from "./LearningAnalyticsScreen";
import { CourseGradebookScreen } from "./CourseGradebookScreen";
import { QuizTakingScreen } from "./QuizTakingScreen";
import { PeerReviewScreen } from "./PeerReviewScreen";
import { useThemeMode } from "../state/theme";
import { createStackScreenOptions } from "../ui/navigationTheme";
import { RouteGuard } from "../ui/RouteGuard";

const Stack = createNativeStackNavigator<any, undefined>();

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
    <RouteGuard requires="courses.attendance">
      <AttendanceScreen {...props} />
    </RouteGuard>
  );
}

function GuardedGradebook(props: any) {
  return (
    <RouteGuard requires="courses.grade">
      <CourseGradebookScreen {...props} />
    </RouteGuard>
  );
}

function GuardedLearningAnalytics(props: any) {
  return (
    <RouteGuard requires={["admin.analytics", "courses.manage"]}>
      <LearningAnalyticsScreen {...props} />
    </RouteGuard>
  );
}

export function AcademicStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="CoursesHome"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen name="CoursesHome" component={CoursesHomeScreen} options={{ title: "課程", headerShown: false }} />
      <Stack.Screen name="CourseSchedule" component={CourseScheduleScreen} options={{ title: "課表" }} />
      {/* 需要 courses.create 權限 — 教師/主管/管理員 */}
      <Stack.Screen name="AddCourse" component={GuardedAddCourse} options={{ title: "新增課程" }} />
      <Stack.Screen name="CourseHub" component={CourseHubScreen} options={{ title: "課程中樞" }} />
      <Stack.Screen name="CourseModules" component={CourseModulesScreen} options={{ title: "教材單元" }} />
      <Stack.Screen name="QuizCenter" component={QuizCenterScreen} options={{ title: "測驗中心" }} />
      {/* 需要 courses.attendance 權限 — 教師/主管/管理員 */}
      <Stack.Screen name="Attendance" component={GuardedAttendance} options={{ title: "點名中心" }} />
      {/* 需要 courses.grade 權限 — 教師/主管/管理員 */}
      <Stack.Screen name="CourseGradebook" component={GuardedGradebook} options={{ title: "課內成績簿" }} />
      <Stack.Screen name="Classroom" component={ClassroomScreen} options={{ title: "課堂互動" }} />
      <Stack.Screen name="Grades" component={GradesScreen} options={{ title: "成績查詢" }} />
      {/* 需要分析權限 — 管理員/教師 */}
      <Stack.Screen name="LearningAnalytics" component={GuardedLearningAnalytics} options={{ title: "學習分析" }} />
      <Stack.Screen name="CreditAuditStack" component={CreditAuditStack} options={{ headerShown: false }} />
      <Stack.Screen name="Calendar" component={CalendarScreen} options={{ title: "行事曆" }} />
      <Stack.Screen name="AICourseAdvisor" component={AICourseAdvisorScreen} options={{ title: "AI 選課助理" }} />
      <Stack.Screen name="AIChat" component={AIChatScreen} options={{ title: "AI 校園助理" }} />
      <Stack.Screen name="QuizTaking" component={QuizTakingScreen} options={{ title: "作答中", headerShown: false }} />
      <Stack.Screen name="PeerReview" component={PeerReviewScreen} options={{ title: "同儕互評" }} />
    </Stack.Navigator>
  );
}
