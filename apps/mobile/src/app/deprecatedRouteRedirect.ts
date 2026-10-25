/** 已刪或已改名的路由：未處理的導覽 silent 轉到現行畫面，不再彈 alert。 */
export type DeprecatedRouteRedirect = { tab: string; screen: string };

export const DEPRECATED_ROUTE_REDIRECT: Record<string, DeprecatedRouteRedirect> = {
  AcademicStack: { tab: '學習', screen: 'CoursesHome' },
  TeachingStack: { tab: '學習', screen: 'TeachingHub' },
  StaffStack: { tab: 'Today', screen: 'TodayHome' },
  DepartmentStack: { tab: 'Today', screen: 'TodayHome' },
  AdminStack: { tab: '學習', screen: 'AdminDashboard' },
  StaffHub: { tab: 'Today', screen: 'TodayHome' },
  DepartmentHub: { tab: 'Today', screen: 'TodayHome' },
  DemoStory: { tab: 'Today', screen: 'TodayHome' },
  GradeWhatIf: { tab: 'Today', screen: 'TodayHome' },
  MistakeRepertoire: { tab: 'Today', screen: 'TodayHome' },
  StudentInbox: { tab: 'Today', screen: 'TodayHome' },
  MonthlySummary: { tab: 'Today', screen: 'TodayHome' },
  VendorRevenueReport: { tab: 'Today', screen: 'TodayHome' },
  VendorLoyaltyPush: { tab: 'Today', screen: 'TodayHome' },
  VendorMenuManage: { tab: 'Today', screen: 'TodayHome' },
  StudentRisk: { tab: 'Today', screen: 'TodayHome' },
  TeachingEvaluation: { tab: 'Today', screen: 'TodayHome' },
  AITrustCard: { tab: 'Today', screen: 'TodayHome' },
  AIStudyBuddy: { tab: 'Today', screen: 'TodayHome' },
  LifeRequests: { tab: 'Today', screen: 'TodayHome' },
  Clubs: { tab: 'Today', screen: 'TodayHome' },
  Career: { tab: 'Today', screen: 'TodayHome' },
  Dormitory: { tab: 'Today', screen: 'TodayHome' },
  DormitoryScreen: { tab: 'Today', screen: 'TodayHome' },
  SmartDashboard: { tab: 'Today', screen: 'TodayHome' },
  CourseHubV2: { tab: 'Today', screen: 'TodayHome' },
  CourseMaterialsV2: { tab: 'Today', screen: 'TodayHome' },
  CourseAssignmentsV2: { tab: 'Today', screen: 'TodayHome' },
  CourseAssignmentDetailV2: { tab: 'Today', screen: 'TodayHome' },
  CourseQuizzesV2: { tab: 'Today', screen: 'TodayHome' },
  CourseQuizTakingV2: { tab: 'Today', screen: 'TodayHome' },
  CourseForumV2: { tab: 'Today', screen: 'TodayHome' },
  CourseForumTopicV2: { tab: 'Today', screen: 'TodayHome' },
  CourseAnnouncementsV2: { tab: 'Today', screen: 'TodayHome' },
  CourseGradesV2: { tab: 'Today', screen: 'TodayHome' },
  CourseAIAssistantV2: { tab: 'Today', screen: 'TodayHome' },
  CourseQuestionBankV2: { tab: 'Today', screen: 'TodayHome' },
  CourseLiveV2: { tab: 'Today', screen: 'TodayHome' },
  DataFlowDebug: { tab: 'Today', screen: 'TodayHome' },
  PostLoginDebug: { tab: 'Today', screen: 'TodayHome' },
  ThemePreview: { tab: 'Today', screen: 'TodayHome' },
  WidgetPreview: { tab: 'Today', screen: 'TodayHome' },
};

export function resolveDeprecatedRouteRedirect(
  routeName: string,
): DeprecatedRouteRedirect | undefined {
  return DEPRECATED_ROUTE_REDIRECT[routeName];
}
