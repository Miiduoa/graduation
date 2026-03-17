import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AcademicScreen } from "./AcademicScreen";
import { CourseScheduleScreen } from "./CourseScheduleScreen";
import { AddCourseScreen } from "./AddCourseScreen";
import { GradesScreen } from "./GradesScreen";
import { CreditAuditStack } from "./CreditAuditStack";
import { CalendarScreen } from "./CalendarScreen";
import { AICourseAdvisorScreen } from "./AICourseAdvisorScreen";
import { AIChatScreen } from "./AIChatScreen";
import { useThemeMode } from "../state/theme";
import { createStackScreenOptions } from "../ui/navigationTheme";

const Stack = createNativeStackNavigator<any, undefined>();

export function AcademicStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="AcademicHome"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen name="AcademicHome" component={AcademicScreen} options={{ title: "課業", headerShown: false }} />
      <Stack.Screen name="CourseSchedule" component={CourseScheduleScreen} options={{ title: "課表" }} />
      <Stack.Screen name="AddCourse" component={AddCourseScreen} options={{ title: "新增課程" }} />
      <Stack.Screen name="Grades" component={GradesScreen} options={{ title: "成績查詢" }} />
      <Stack.Screen name="CreditAuditStack" component={CreditAuditStack} options={{ headerShown: false }} />
      <Stack.Screen name="Calendar" component={CalendarScreen} options={{ title: "行事曆" }} />
      <Stack.Screen name="AICourseAdvisor" component={AICourseAdvisorScreen} options={{ title: "AI 選課助理" }} />
      <Stack.Screen name="AIChat" component={AIChatScreen} options={{ title: "AI 校園助理" }} />
    </Stack.Navigator>
  );
}
