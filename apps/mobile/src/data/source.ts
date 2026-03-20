import type { 
  Announcement, 
  Assignment,
  Attachment,
  AttendanceSession,
  AttendanceSummary,
  BusArrival,
  BusRoute,
  CalendarEvent,
  ClubEvent, 
  Comment,
  Conversation,
  Course,
  CourseGradebookData,
  CourseMaterial,
  CourseModule,
  CourseSpace,
  DormAnnouncement,
  DormitoryInfo,
  DormPackage,
  Enrollment,
  Grade,
  Group,
  GroupMember,
  GroupPost,
  HealthAppointment,
  HealthRecord,
  HealthTimeSlot,
  LibraryBook,
  LibraryLoan,
  LibrarySeat,
  LostFoundItem,
  MenuItem, 
  Message,
  InboxTask,
  Notification,
  Order,
  Quiz,
  PaginatedResult,
  Poi,
  Printer,
  PrintJob,
  QueryOptions,
  RepairRequest,
  SeatReservation,
  Submission,
  Transaction,
  User,
  UserAchievement,
  WashingMachine,
  WashingReservation,
} from "./types";

export type { QueryOptions } from "./types";

// ===== DataSource 介面定義 =====

export type DataSource = {
  // 公告
  listAnnouncements: (schoolId?: string, options?: QueryOptions) => Promise<Announcement[]>;
  getAnnouncement: (id: string) => Promise<Announcement | null>;
  
  // 活動
  listEvents: (schoolId?: string, options?: QueryOptions) => Promise<ClubEvent[]>;
  getEvent: (id: string, schoolId?: string) => Promise<ClubEvent | null>;
  registerEvent: (eventId: string, userId: string, schoolId?: string) => Promise<void>;
  unregisterEvent: (eventId: string, userId: string, schoolId?: string) => Promise<void>;
  
  // 地點
  listPois: (schoolId?: string, options?: QueryOptions) => Promise<Poi[]>;
  getPoi: (id: string) => Promise<Poi | null>;
  
  // 餐廳菜單
  listMenus: (schoolId?: string, options?: QueryOptions) => Promise<MenuItem[]>;
  getMenuItem: (id: string) => Promise<MenuItem | null>;
  rateMenuItem: (id: string, userId: string, rating: number) => Promise<void>;
  
  // 使用者
  getUser: (id: string) => Promise<User | null>;
  updateUser: (id: string, data: Partial<User>) => Promise<User>;
  getUserByEmail: (email: string) => Promise<User | null>;
  
  // 課程
  listCourses: (schoolId?: string, options?: QueryOptions) => Promise<Course[]>;
  getCourse: (id: string) => Promise<Course | null>;
  searchCourses: (query: string, schoolId?: string) => Promise<Course[]>;
  listCourseSpaces: (userId: string, schoolId?: string) => Promise<CourseSpace[]>;
  getCourseSpace: (courseSpaceId: string, userId: string, schoolId?: string) => Promise<CourseSpace | null>;
  listCourseModules: (userId: string, courseSpaceId?: string, schoolId?: string) => Promise<CourseModule[]>;
  createCourseModule: (input: {
    courseSpaceId: string;
    title: string;
    description?: string;
    week?: number;
    order?: number;
    estimatedMinutes?: number;
    resourceLabel?: string;
    resourceUrl?: string;
    createdBy: string;
    createdByEmail?: string | null;
    schoolId?: string;
  }) => Promise<{ id: string }>;
  listCourseMaterials: (courseSpaceId: string, moduleId?: string) => Promise<CourseMaterial[]>;
  listQuizzes: (userId: string, courseSpaceId?: string, schoolId?: string) => Promise<Quiz[]>;
  getQuiz: (quizId: string, userId: string, courseSpaceId?: string, schoolId?: string) => Promise<Quiz | null>;
  createQuiz: (input: {
    courseSpaceId: string;
    title: string;
    description?: string;
    dueAt?: Date | null;
    type: "quiz" | "exam";
    questionCount?: number;
    durationMinutes?: number;
    points?: number;
    weight?: number;
    createdBy: string;
    createdByEmail?: string | null;
    schoolId?: string;
  }) => Promise<{ id: string }>;
  submitQuiz: (input: {
    courseSpaceId: string;
    quizId: string;
    userId: string;
    content?: string;
    answers?: Record<string, string | string[]>;
    attachments?: Attachment[];
  }) => Promise<Submission>;
  listAttendanceSessions: (userId: string, courseSpaceId?: string, schoolId?: string) => Promise<AttendanceSession[]>;
  startAttendanceSession: (input: {
    courseSpaceId: string;
    classroomLat?: number;
    classroomLng?: number;
    qrExpiryMinutes?: number;
  }) => Promise<{ success: boolean; sessionId: string; qrToken?: string; qrExpiresAt?: string }>;
  checkInAttendance: (input: {
    courseSpaceId: string;
    sessionId: string;
    qrToken?: string;
  }) => Promise<{ success: boolean }>;
  getAttendanceSummary: (courseSpaceId: string) => Promise<AttendanceSummary>;
  listInboxTasks: (userId: string, schoolId?: string) => Promise<InboxTask[]>;
  getCourseGradebook: (courseSpaceId: string) => Promise<CourseGradebookData | null>;
  
  // 選課
  listEnrollments: (userId: string, semester?: string, schoolId?: string) => Promise<Enrollment[]>;
  enrollCourse: (userId: string, courseId: string, semester: string, schoolId?: string) => Promise<Enrollment>;
  dropCourse: (enrollmentId: string, userId?: string, schoolId?: string) => Promise<void>;
  
  // 成績
  listGrades: (userId: string, semester?: string, schoolId?: string) => Promise<Grade[]>;
  getGPA: (userId: string, schoolId?: string) => Promise<{ gpa: number; totalCredits: number; totalPoints: number }>;
  
  // 群組
  listGroups: (userId: string, options?: QueryOptions) => Promise<Group[]>;
  getGroup: (id: string) => Promise<Group | null>;
  createGroup: (data: Omit<Group, "id" | "createdAt" | "memberCount">) => Promise<Group>;
  updateGroup: (id: string, data: Partial<Group>) => Promise<Group>;
  deleteGroup: (id: string) => Promise<void>;
  joinGroup: (groupId: string, userId: string, joinCode?: string) => Promise<GroupMember>;
  leaveGroup: (groupId: string, userId: string) => Promise<void>;
  
  // 群組成員
  listGroupMembers: (groupId: string, options?: QueryOptions) => Promise<GroupMember[]>;
  updateMemberRole: (groupId: string, userId: string, role: "admin" | "member") => Promise<void>;
  removeMember: (groupId: string, userId: string) => Promise<void>;
  
  // 群組貼文
  listGroupPosts: (groupId: string, options?: QueryOptions) => Promise<GroupPost[]>;
  getGroupPost: (id: string, groupId?: string) => Promise<GroupPost | null>;
  createGroupPost: (data: Omit<GroupPost, "id" | "createdAt" | "likeCount" | "commentCount">) => Promise<GroupPost>;
  updateGroupPost: (id: string, data: Partial<GroupPost>, groupId?: string) => Promise<GroupPost>;
  deleteGroupPost: (id: string, groupId?: string) => Promise<void>;
  likePost: (postId: string, userId: string, groupId?: string) => Promise<void>;
  unlikePost: (postId: string, userId: string, groupId?: string) => Promise<void>;
  
  // 留言
  listComments: (postId: string, options?: QueryOptions, groupId?: string) => Promise<Comment[]>;
  createComment: (data: Omit<Comment, "id" | "createdAt" | "likeCount">) => Promise<Comment>;
  deleteComment: (id: string, groupId?: string, postId?: string) => Promise<void>;
  
  // 作業
  listAssignments: (groupId: string, options?: QueryOptions) => Promise<Assignment[]>;
  getAssignment: (id: string, groupId?: string) => Promise<Assignment | null>;
  createAssignment: (data: Omit<Assignment, "id" | "createdAt" | "submissionCount">) => Promise<Assignment>;
  updateAssignment: (id: string, data: Partial<Assignment>, groupId?: string) => Promise<Assignment>;
  deleteAssignment: (id: string, groupId?: string) => Promise<void>;
  
  // 作業繳交
  listSubmissions: (assignmentId: string, options?: QueryOptions, groupId?: string) => Promise<Submission[]>;
  getSubmission: (assignmentId: string, userId: string, groupId?: string) => Promise<Submission | null>;
  submitAssignment: (data: Omit<Submission, "id" | "submittedAt" | "status">) => Promise<Submission>;
  gradeSubmission: (
    id: string,
    grade: number,
    feedback?: string,
    groupId?: string,
    assignmentId?: string,
    userId?: string
  ) => Promise<Submission>;
  
  // 訊息
  listConversations: (userId: string, options?: QueryOptions) => Promise<Conversation[]>;
  getConversation: (id: string) => Promise<Conversation | null>;
  createConversation: (participantIds: string[]) => Promise<Conversation>;
  listMessages: (conversationId: string, options?: QueryOptions) => Promise<Message[]>;
  sendMessage: (data: Omit<Message, "id" | "createdAt">) => Promise<Message>;
  markMessageRead: (messageId: string, userId: string, conversationId?: string) => Promise<void>;
  
  // 失物招領
  listLostFoundItems: (schoolId?: string, options?: QueryOptions) => Promise<LostFoundItem[]>;
  getLostFoundItem: (id: string) => Promise<LostFoundItem | null>;
  createLostFoundItem: (data: Omit<LostFoundItem, "id" | "createdAt" | "status">) => Promise<LostFoundItem>;
  updateLostFoundItem: (id: string, data: Partial<LostFoundItem>) => Promise<LostFoundItem>;
  resolveLostFoundItem: (id: string) => Promise<void>;
  
  // 圖書館
  searchBooks: (query: string, schoolId?: string, options?: QueryOptions) => Promise<LibraryBook[]>;
  getBook: (id: string) => Promise<LibraryBook | null>;
  listLoans: (userId: string, schoolId?: string) => Promise<LibraryLoan[]>;
  borrowBook: (bookId: string, userId: string, schoolId?: string) => Promise<LibraryLoan>;
  returnBook: (loanId: string, userId?: string, schoolId?: string) => Promise<void>;
  renewBook: (loanId: string, userId?: string, schoolId?: string) => Promise<LibraryLoan>;
  
  // 圖書館座位
  listSeats: (schoolId?: string, zone?: string) => Promise<LibrarySeat[]>;
  listSeatReservations: (userId: string, schoolId?: string) => Promise<SeatReservation[]>;
  reserveSeat: (seatId: string, userId: string, date: string, startTime: string, endTime: string, schoolId?: string) => Promise<SeatReservation>;
  cancelSeatReservation: (id: string, userId?: string, schoolId?: string) => Promise<void>;
  
  // 公車
  listBusRoutes: (schoolId?: string) => Promise<BusRoute[]>;
  getBusRoute: (id: string) => Promise<BusRoute | null>;
  getBusArrivals: (stopId: string) => Promise<BusArrival[]>;
  
  // 通知
  listNotifications: (userId: string, options?: QueryOptions) => Promise<Notification[]>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: (userId: string) => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  
  // 行事曆
  listCalendarEvents: (userId: string, startDate: string, endDate: string, schoolId?: string) => Promise<CalendarEvent[]>;
  createCalendarEvent: (data: Omit<CalendarEvent, "id">) => Promise<CalendarEvent>;
  updateCalendarEvent: (id: string, data: Partial<CalendarEvent>, userId?: string, schoolId?: string) => Promise<CalendarEvent>;
  deleteCalendarEvent: (id: string, userId?: string, schoolId?: string) => Promise<void>;
  syncCoursesToCalendar: (userId: string, semester: string, schoolId?: string) => Promise<void>;
  
  // 訂單與支付
  listOrders: (userId: string, options?: QueryOptions, schoolId?: string) => Promise<Order[]>;
  getOrder: (id: string, userId?: string, schoolId?: string) => Promise<Order | null>;
  createOrder: (data: Omit<Order, "id" | "createdAt" | "status" | "paymentStatus">) => Promise<Order>;
  updateOrderStatus: (id: string, status: Order["status"], userId?: string, schoolId?: string) => Promise<Order>;
  cancelOrder: (id: string, userId?: string, schoolId?: string) => Promise<void>;
  listTransactions: (userId: string, options?: QueryOptions, schoolId?: string) => Promise<Transaction[]>;
  
  // 安全的儲值/支付操作（必須通過後端處理）
  processTopup: (data: {
    userId: string;
    amount: number;
    paymentMethod: string;
  }) => Promise<{
    success: boolean;
    newBalance?: number;
    transactionId?: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
  
  processPayment: (data: {
    userId: string;
    amount: number;
    paymentMethod: string;
    merchantId: string;
    description: string;
  }) => Promise<{
    success: boolean;
    newBalance?: number;
    transactionId?: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
  
  // 成就
  listAchievements: () => Promise<UserAchievement[]>;
  getUserAchievements: (userId: string, schoolId?: string) => Promise<UserAchievement[]>;
  updateAchievementProgress: (userId: string, achievementId: string, progress: number, schoolId?: string) => Promise<UserAchievement>;
  
  // 宿舍服務
  getDormitoryInfo: (userId: string) => Promise<DormitoryInfo | null>;
  listRepairRequests: (userId: string, options?: QueryOptions) => Promise<RepairRequest[]>;
  createRepairRequest: (data: Omit<RepairRequest, "id" | "createdAt" | "status">) => Promise<RepairRequest>;
  updateRepairRequest: (id: string, data: Partial<RepairRequest>) => Promise<RepairRequest>;
  cancelRepairRequest: (id: string) => Promise<void>;
  listDormPackages: (userId: string, options?: QueryOptions) => Promise<DormPackage[]>;
  confirmPackagePickup: (id: string) => Promise<void>;
  listWashingMachines: (schoolId?: string, building?: string) => Promise<WashingMachine[]>;
  listWashingReservations: (userId: string) => Promise<WashingReservation[]>;
  reserveWashingMachine: (machineId: string, userId: string) => Promise<WashingReservation>;
  cancelWashingReservation: (id: string) => Promise<void>;
  listDormAnnouncements: (schoolId?: string, building?: string) => Promise<DormAnnouncement[]>;
  
  // 列印服務
  listPrinters: (schoolId?: string, options?: QueryOptions) => Promise<Printer[]>;
  getPrinter: (id: string) => Promise<Printer | null>;
  listPrintJobs: (userId: string, options?: QueryOptions) => Promise<PrintJob[]>;
  createPrintJob: (data: Omit<PrintJob, "id" | "createdAt" | "status" | "cost">) => Promise<PrintJob>;
  cancelPrintJob: (id: string) => Promise<void>;
  
  // 健康服務
  listHealthAppointments: (userId: string, options?: QueryOptions) => Promise<HealthAppointment[]>;
  createHealthAppointment: (data: Omit<HealthAppointment, "id" | "createdAt" | "status">) => Promise<HealthAppointment>;
  cancelHealthAppointment: (id: string) => Promise<void>;
  rescheduleHealthAppointment: (id: string, data: { date: string; timeSlot: string; doctorId?: string; doctorName?: string }) => Promise<HealthAppointment>;
  listHealthRecords: (userId: string, options?: QueryOptions) => Promise<HealthRecord[]>;
  listHealthTimeSlots: (department: string, date: string, schoolId?: string) => Promise<HealthTimeSlot[]>;
  
  // 宿舍進階服務
  createAccessApplication: (data: {
    userId: string;
    type: "extended_hours" | "temporary_access";
    requestedTime?: string;
    reason: string;
    schoolId?: string;
  }) => Promise<{ id: string; status: "pending" }>;
  
  createLateReturnRecord: (data: {
    userId: string;
    building?: string;
    room?: string;
    returnTime: string;
    schoolId?: string;
  }) => Promise<{ id: string }>;
  
  createVisitorRecord: (data: {
    userId: string;
    visitorName: string;
    visitorPhone: string;
    building?: string;
    room?: string;
    arrivalTime: string;
    expectedLeaveTime: string;
    schoolId?: string;
  }) => Promise<{ id: string }>;
};

// ===== 全域 DataSource 管理 =====

let _source: DataSource | null = null;

export function setDataSource(ds: DataSource) {
  _source = ds;
}

export function getDataSource(): DataSource {
  if (!_source) {
    throw new Error("DataSource not set. Call setDataSource() in App.tsx.");
  }
  return _source;
}

export function hasDataSource(): boolean {
  return _source !== null;
}

// ===== 便捷函數 =====

export async function withDataSource<T>(
  operation: (ds: DataSource) => Promise<T>,
  fallback?: T
): Promise<T> {
  try {
    const ds = getDataSource();
    return await operation(ds);
  } catch (error) {
    if (fallback !== undefined) {
      console.warn("[DataSource] Operation failed, returning fallback:", error);
      return fallback;
    }
    throw error;
  }
}
