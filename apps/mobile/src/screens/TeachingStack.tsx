/* eslint-disable */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TeachingHubScreen } from './TeachingHubScreen';
import { AddCourseScreen } from './AddCourseScreen';
import { CreditAuditStack } from './CreditAuditStack';
import { UnifiedCalendarScreen } from './UnifiedCalendarScreen';
import { AICourseAdvisorScreen } from './AICourseAdvisorScreen';
import { AIChatScreen } from './AIChatScreen';
import { CourseHubScreen } from './CourseHubScreen';
import { CourseModulesScreen } from './CourseModulesScreen';
import { QuizCenterScreen } from './QuizCenterScreen';
import { AttendanceScreen } from './AttendanceScreen';
import { ClassroomScreen } from './ClassroomScreen';
import { AcademicScreen } from './AcademicScreen';
import { QuizTakingScreen } from './QuizTakingScreen';
import { PeerReviewScreen } from './PeerReviewScreen';
import { useThemeMode } from '../state/theme';
import { createStackScreenOptions } from '../ui/navigationTheme';

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

export function TeachingStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="TeachingHub"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen
        name="TeachingHub"
        component={TeachingHubScreen}
        options={{ title: '教學', headerShown: false }}
      />
      <Stack.Screen
        name="CourseSchedule"
        component={UnifiedCalendarScreen}
        options={{ title: '行事曆', headerShown: false }}
      />
      <Stack.Screen name="AddCourse" component={AddCourseScreen} options={{ title: '新增課程' }} />
      <Stack.Screen name="CourseHub" component={CourseHubScreen} options={{ title: '課程中樞' }} />
      <Stack.Screen
        name="CourseModules"
        component={CourseModulesScreen}
        options={{ title: '教材單元' }}
      />
      <Stack.Screen
        name="QuizCenter"
        component={QuizCenterScreen}
        options={{ title: '測驗中心' }}
      />
      <Stack.Screen
        name="Attendance"
        component={AttendanceScreen}
        options={{ title: '點名中心' }}
      />
      {/* 學業總覽 — 整合成績/AI分析/成績簿/學習分析 */}
      <Stack.Screen
        name="AcademicOverview"
        component={AcademicScreen}
        options={{ title: '學業總覽', headerShown: false }}
      />
      <Stack.Screen
        name="CourseGradebook"
        component={AcademicGradebookRoute}
        options={{ title: '課內成績簿', headerShown: false }}
      />
      <Stack.Screen name="Classroom" component={ClassroomScreen} options={{ title: '課堂互動' }} />
      <Stack.Screen name="Grades" component={AcademicGradesRoute} options={{ title: '成績查詢', headerShown: false }} />
      <Stack.Screen
        name="AcademicInsights"
        component={AcademicInsightsRoute}
        options={{ title: '學業 AI 分析', headerShown: false }}
      />
      <Stack.Screen
        name="LearningAnalytics"
        component={AcademicAnalyticsRoute}
        options={{ title: '學習分析', headerShown: false }}
      />
      <Stack.Screen
        name="CreditAuditStack"
        component={CreditAuditStack}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="Calendar" component={UnifiedCalendarScreen} options={{ title: '行事曆', headerShown: false }} />
      <Stack.Screen
        name="AICourseAdvisor"
        component={AICourseAdvisorScreen}
        options={{ title: 'AI 選課助理' }}
      />
      <Stack.Screen name="AIChat" component={AIChatScreen} options={{ title: 'AI 校園助理' }} />
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
    </Stack.Navigator>
  );
}
