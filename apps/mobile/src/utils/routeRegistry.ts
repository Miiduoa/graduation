/**
 * Route Registry — 中央 route ↔ tab 對照表
 *
 * React Navigation 的 `navigate('SomeRoute')` 在「目前所在 navigator 找不到 SomeRoute」
 * 時不會 throw，只會 silent console.warn → 按鈕看起來「沒反應」。
 *
 * 解法：所有 cross-tab navigation 都要用 `navigate('TabName', { screen: 'RouteName', params })`。
 * 本檔提供：
 *   - ROUTE_TO_TAB：route 名稱 → 所屬 tab 名稱
 *   - resolveTabForRoute(route)：查 tab
 *   - 給 safeNavigate 使用，自動 cross-tab 跳轉
 *
 * 同名 route 出現在多個 stack（例如 'AdminDashboard' 在 LearnStack 和 MeStack）→
 * 此處選「最主要展示位置」作為 canonical tab。
 */

export type TabName = 'Today' | '學習' | '校園' | '訊息' | '我的';

/**
 * Source of truth：每個 route 屬於哪個 tab。
 * 若某 route 沒列出 → 視為當前 stack 內路由（不需 cross-tab）。
 */
export const ROUTE_TO_TAB: Record<string, TabName> = {
  // ── Today tab ──────────────────────────────────────────
  TodayHome: 'Today',
  SmartDashboard: 'Today',
  '公告總覽': 'Today',
  '公告詳情': 'Today',
  '活動總覽': 'Today',
  '活動詳情': 'Today',
  CampusSocialScreen: 'Today',
  CampusGame: 'Today',
  BoardDetail: 'Today',
  PostCompose: 'Today',
  PostDetail: 'Today',
  StoryCompose: 'Today',
  SmartCalendarScreen: 'Today',

  // ── 學習 tab（學生/老師/TA/主任/餐廳 cockpit 與相關工具）─────
  LearnHome: '學習',
  CoursesHome: '學習',
  // deprecated 別名：4+1 改版前的 'AcademicStack' 還有殘留 caller（LearnAiFirstScreen 等）。
  // 把它導向學習 tab，safeNavigate 會自動 fallback 到 LearnHome / CoursesHome 而不噴 alert。
  AcademicStack: '學習',
  CourseHub: '學習',
  CourseModules: '學習',
  CourseCatalog: '學習',
  CourseSchedule: '學習',
  CourseMaterialViewer: '學習',
  CourseDiscussion: '學習',
  DiscussionThreadDetail: '學習',
  CourseNotes: '學習',
  CourseScores: '學習',
  CourseGradebook: '學習',
  AddCourse: '學習',
  Attendance: '學習',
  AttendanceLive: '學習',
  AttendanceAnalytics: '學習',
  AttendanceMultiMethod: '學習',
  Classroom: '學習',
  QuizCenter: '學習',
  QuizTaking: '學習',
  PeerReview: '學習',
  PeerReviewSubmit: '學習',
  HomeworkSubmit: '學習',
  TeacherGrading: '學習',
  VideoMaterial: '學習',
  Survey: '學習',
  MyQuizScores: '學習',
  MyAttendanceHistory: '學習',
  TeachingHub: '學習',
  StaffHub: '學習',
  DepartmentHub: '學習',
  AdminDashboard: '學習',
  AdminCourseVerify: '學習',
  Grades: '學習',
  AcademicOverview: '學習',
  AcademicInsights: '學習',
  LearningAnalytics: '學習',
  AICourseAdvisor: '學習',
  Calendar: '學習',
  // 共用 cockpit / AI / 新增 screen 都在 LearnStack
  TodayCockpit: '學習',
  TeacherCockpit: '學習',
  GradeWhatIf: '學習',
  MistakeRepertoire: '學習',
  PomodoroSession: '學習',
  AIAgentObservatory: '學習',
  AIAgentConsole: '學習',
  StudentInbox: '學習',
  MonthlySummary: '學習',
  StudentOrders: '學習',
  AITrustCard: '學習',
  AIStudyBuddy: '學習',
  VendorRevenueReport: '學習',
  VendorLoyaltyPush: '學習',
  VendorMenuManage: '學習',
  StudentRisk: '學習',
  TeachingEvaluation: '學習',
  CreditAuditStack: '學習',

  // ── 校園 tab ───────────────────────────────────────────
  CampusHome: '校園',
  Map: '校園',
  MapV2: '校園',
  Library: '校園',
  LibraryCatalog: '校園',
  Dormitory: '校園',
  Health: '校園',
  BusSchedule: '校園',
  BusStopDetail: '校園',
  BusV2: '校園',
  OnBusMode: '校園',
  TripPlanner: '校園',
  TransportHub: '校園',
  PoiDetail: '校園',
  ARNavigation: '校園',
  AccessibleRoute: '校園',
  LostFound: '校園',
  LostFoundDetail: '校園',
  LostFoundPost: '校園',
  PrintService: '校園',
  '餐廳總覽': '校園',
  MenuDetail: '校園',
  MenuSubscription: '校園',
  Ordering: '校園',
  Payment: '校園',
  AdminCafeteria: '校園',

  // ── 訊息 tab ───────────────────────────────────────────
  MessagesHome: '訊息',
  Inbox: '訊息',
  Chat: '訊息',
  Dms: '訊息',
  Groups: '訊息',
  GroupDetail: '訊息',
  GroupMembers: '訊息',
  GroupAssignments: '訊息',
  GroupPost: '訊息',
  AssignmentDetail: '訊息',
  FriendSearch: '訊息',
  FriendsManage: '訊息',
  FollowingLists: '訊息',

  // ── 我的 tab（hidden tab，drawer 進入）─────────────────
  MeHome: '我的',
  ProfileEdit: '我的',
  Settings: '我的',
  Notifications: '我的',
  NotificationSettings: '我的',
  LanguageSettings: '我的',
  AccessibilitySettings: '我的',
  AccountDeletion: '我的',
  BugReport: '我的',
  Feedback: '我的',
  Help: '我的',
  DataExport: '我的',
  AIModelManager: '我的',
  ThemePreview: '我的',
  WidgetPreview: '我的',
  Achievements: '我的',
  CampusGarden: '我的',
  Companion: '我的',
  CompanionCollection: '我的',
  Constellation: '我的',
  MerchantHub: '我的',
  GlobalSearch: '我的',
  QRCode: '我的',
};

export function resolveTabForRoute(route: string): TabName | null {
  return ROUTE_TO_TAB[route] ?? null;
}

/**
 * 給定一個 navigation 物件（可能在任何 stack 內），判斷 route 是否就在當前 navigator。
 *
 * 用 collectRouteNames 收集所有 nested route 名稱，比對 route 是否其中之一。
 */
export function isRouteRegistered(
  navigation: { getState?: () => unknown; getParent?: () => unknown } | null | undefined,
  route: string,
): boolean {
  if (!navigation || typeof navigation.getState !== 'function') return false;
  try {
    const names = new Set<string>();
    let cursor: any = navigation;
    let topMost: any = navigation;
    let safety = 0;
    while (cursor && typeof cursor.getParent === 'function' && safety < 10) {
      const parent = cursor.getParent();
      if (!parent) break;
      topMost = parent;
      cursor = parent;
      safety++;
    }
    collectRouteNames(topMost?.getState?.() ?? navigation.getState!(), names);
    return names.has(route);
  } catch {
    return false;
  }
}

function collectRouteNames(state: unknown, out: Set<string>): void {
  if (!state || typeof state !== 'object') return;
  const s = state as { routeNames?: string[]; routes?: Array<{ state?: unknown }> };
  if (Array.isArray(s.routeNames)) {
    for (const r of s.routeNames) out.add(r);
  }
  if (Array.isArray(s.routes)) {
    for (const r of s.routes) {
      if (r?.state) collectRouteNames(r.state, out);
    }
  }
}
