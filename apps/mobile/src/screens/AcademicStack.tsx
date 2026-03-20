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
import { useThemeMode } from "../state/theme";
import { createStackScreenOptions } from "../ui/navigationTheme";

const Stack = createNativeStackNavigator<any, undefined>();

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
      <Stack.Screen name="AddCourse" component={AddCourseScreen} options={{ title: "新增課程" }} />
      <Stack.Screen name="CourseHub" component={CourseHubScreen} options={{ title: "課程中樞" }} />
      <Stack.Screen name="CourseModules" component={CourseModulesScreen} options={{ title: "教材單元" }} />
      <Stack.Screen name="QuizCenter" component={QuizCenterScreen} options={{ title: "測驗中心" }} />
      <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ title: "點名中心" }} />
      <Stack.Screen name="CourseGradebook" component={CourseGradebookScreen} options={{ title: "課內成績簿" }} />
      <Stack.Screen name="Classroom" component={ClassroomScreen} options={{ title: "課堂互動" }} />
      <Stack.Screen name="Grades" component={GradesScreen} options={{ title: "成績查詢" }} />
      <Stack.Screen name="LearningAnalytics" component={LearningAnalyticsScreen} options={{ title: "學習分析" }} />
      <Stack.Screen name="CreditAuditStack" component={CreditAuditStack} options={{ headerShown: false }} />
      <Stack.Screen name="Calendar" component={CalendarScreen} options={{ title: "行事曆" }} />
      <Stack.Screen name="AICourseAdvisor" component={AICourseAdvisorScreen} options={{ title: "AI 選課助理" }} />
      <Stack.Screen name="AIChat" component={AIChatScreen} options={{ title: "AI 校園助理" }} />
    </Stack.Navigator>
  );
}
