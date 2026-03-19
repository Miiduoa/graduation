import type { DataSource } from "./source";
import type {
  Announcement,
  Assignment,
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
  Poi,
  Printer,
  PrintJob,
  Quiz,
  RepairRequest,
  SeatReservation,
  Submission,
  Transaction,
  User,
  UserAchievement,
  WashingMachine,
  WashingReservation,
} from "./types";
import {
  mockAnnouncements,
  mockClubEvents,
  mockMenus,
  mockPois,
} from "@campus/shared/src/mockData";

// 生成唯一 ID
const generateId = () => `mock_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Mock 使用者資料
const mockUsers: Record<string, User> = {
  user1: {
    id: "user1",
    email: "demo@campus.edu",
    displayName: "Demo 使用者",
    studentId: "B10901001",
    department: "資訊工程學系",
    year: 3,
    role: "student",
    schoolId: "default",
    createdAt: "2024-01-01T00:00:00Z",
    avatarUrl: null,
    phone: null,
    bio: "這是一個測試帳號",
    joinedAt: "2024-01-01T00:00:00Z",
    settings: {
      notifications: true,
      emailNotifications: true,
      language: "zh-TW",
    },
  },
};

// Mock 群組資料
const mockGroups: Group[] = [
  {
    id: "group1",
    name: "資工系課程討論",
    description: "課程討論與交流",
    type: "course",
    courseId: "CS101",
    memberCount: 45,
    createdAt: "2024-01-15T00:00:00Z",
    ownerId: "user1",
    schoolId: "default",
    joinCode: "ABC12345",
    isPublic: false,
  },
];

// Mock 貼文資料
const mockPosts: GroupPost[] = [];

// Mock 課程資料
const mockCourses: Course[] = [
  {
    id: "CS101",
    code: "CS101",
    name: "程式設計導論",
    instructor: "王教授",
    credits: 3,
    semester: "113-1",
    schoolId: "default",
    department: "資訊工程學系",
    description: "本課程介紹程式設計的基本概念",
    schedule: [
      { dayOfWeek: 1, day: 1, startTime: "09:00", endTime: "12:00", location: "工程館 101" },
    ],
    capacity: 60,
    enrolled: 45,
  },
];

// 通用的「未實作」錯誤提示工廠函數
function createNotImplementedMethod<T>(methodName: string): () => Promise<T> {
  return async () => {
    console.warn(`[MockSource] ${methodName} 方法在 Mock 模式下不支援此操作`);
    throw new Error(`Mock 模式不支援 ${methodName}`);
  };
}

// 通用的空陣列回傳工廠函數
function createEmptyArrayMethod<T>(methodName: string): () => Promise<T[]> {
  return async () => {
    console.info(`[MockSource] ${methodName} 返回空資料（Mock 模式）`);
    return [];
  };
}

// 通用的 null 回傳工廠函數
function createNullMethod<T>(methodName: string): () => Promise<T | null> {
  return async () => {
    console.info(`[MockSource] ${methodName} 返回 null（Mock 模式）`);
    return null;
  };
}

export const mockSource: DataSource = {
  // ===== 公告 =====
  async listAnnouncements() {
    return mockAnnouncements as Announcement[];
  },
  async getAnnouncement(id: string) {
    const found = (mockAnnouncements as Announcement[]).find((a) => a.id === id);
    return found || null;
  },

  // ===== 活動 =====
  async listEvents() {
    return mockClubEvents as ClubEvent[];
  },
  async getEvent(id: string) {
    const found = (mockClubEvents as ClubEvent[]).find((e) => e.id === id);
    return found || null;
  },
  async registerEvent() {
    console.info("[MockSource] registerEvent 模擬成功");
  },
  async unregisterEvent() {
    console.info("[MockSource] unregisterEvent 模擬成功");
  },

  // ===== 地點 =====
  async listPois() {
    return mockPois as Poi[];
  },
  async getPoi(id: string) {
    const found = (mockPois as Poi[]).find((p) => p.id === id);
    return found || null;
  },

  // ===== 餐廳菜單 =====
  async listMenus() {
    return mockMenus as MenuItem[];
  },
  async getMenuItem(id: string) {
    const found = (mockMenus as MenuItem[]).find((m) => m.id === id);
    return found || null;
  },
  async rateMenuItem() {
    console.info("[MockSource] rateMenuItem 模擬成功");
  },

  // ===== 使用者 =====
  async getUser(id: string) {
    return mockUsers[id] || null;
  },
  async updateUser(id: string, data: Partial<User>) {
    if (mockUsers[id]) {
      mockUsers[id] = { ...mockUsers[id], ...data };
      return mockUsers[id];
    }
    throw new Error("使用者不存在");
  },
  async getUserByEmail(email: string) {
    const user = Object.values(mockUsers).find((u) => u.email === email);
    return user || null;
  },

  // ===== 課程 =====
  async listCourses() {
    return mockCourses;
  },
  async getCourse(id: string) {
    return mockCourses.find((c) => c.id === id) || null;
  },
  async searchCourses(query: string) {
    const q = query.toLowerCase();
    return mockCourses.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.instructor.toLowerCase().includes(q)
    );
  },
  async listCourseSpaces(_userId: string, schoolId?: string): Promise<CourseSpace[]> {
    return mockGroups
      .filter((group) => group.type === "course" && (!schoolId || group.schoolId === schoolId))
      .map((group) => ({
        id: group.id,
        groupId: group.id,
        courseId: group.courseId,
        name: group.name,
        description: group.description,
        unreadCount: 0,
        assignmentCount: 0,
        dueSoonCount: 0,
        quizCount: 0,
        moduleCount: 0,
        activeSessionId: null,
        latestDueAt: null,
        schoolId: group.schoolId,
      }));
  },
  async getCourseSpace(courseSpaceId: string, userId: string, schoolId?: string): Promise<CourseSpace | null> {
    const spaces = await this.listCourseSpaces(userId, schoolId);
    return spaces.find((space) => space.groupId === courseSpaceId) ?? null;
  },
  async listCourseModules(): Promise<CourseModule[]> {
    return [];
  },
  async createCourseModule(_input): Promise<{ id: string }> {
    return { id: generateId() };
  },
  async listCourseMaterials(): Promise<CourseMaterial[]> {
    return [];
  },
  async listQuizzes(): Promise<Quiz[]> {
    return [];
  },
  async getQuiz(): Promise<Quiz | null> {
    return null;
  },
  async createQuiz(_input): Promise<{ id: string }> {
    return { id: generateId() };
  },
  async submitQuiz(input): Promise<Submission> {
    return {
      id: generateId(),
      assignmentId: input.quizId,
      userId: input.userId,
      content: input.content,
      attachments: input.attachments,
      submittedAt: new Date().toISOString(),
      status: "submitted",
    };
  },
  async listAttendanceSessions(): Promise<AttendanceSession[]> {
    return [];
  },
  async startAttendanceSession(): Promise<{ success: boolean; sessionId: string; qrToken?: string; qrExpiresAt?: string }> {
    return { success: true, sessionId: generateId() };
  },
  async checkInAttendance(): Promise<{ success: boolean }> {
    return { success: true };
  },
  async getAttendanceSummary(courseSpaceId: string): Promise<AttendanceSummary> {
    return {
      groupId: courseSpaceId,
      totalSessions: 0,
      activeSessions: 0,
      totalAttendees: 0,
      latestSession: null,
    };
  },
  async listInboxTasks(): Promise<InboxTask[]> {
    return [];
  },
  async getCourseGradebook(): Promise<CourseGradebookData | null> {
    return null;
  },

  // ===== 選課 =====
  async listEnrollments(): Promise<Enrollment[]> {
    return [];
  },
  async enrollCourse(userId: string, courseId: string, semester: string): Promise<Enrollment> {
    return {
      id: generateId(),
      userId,
      courseId,
      semester,
      status: "enrolled",
      createdAt: new Date().toISOString(),
      enrolledAt: new Date().toISOString(),
    };
  },
  async dropCourse() {
    console.info("[MockSource] dropCourse 模擬成功");
  },

  // ===== 成績 =====
  async listGrades(): Promise<Grade[]> {
    return [];
  },
  async getGPA() {
    return { gpa: 3.5, totalCredits: 60, totalPoints: 210 };
  },

  // ===== 群組 =====
  async listGroups() {
    return mockGroups;
  },
  async getGroup(id: string) {
    return mockGroups.find((g) => g.id === id) || null;
  },
  async createGroup(data): Promise<Group> {
    const newGroup: Group = {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
      memberCount: 1,
    };
    mockGroups.push(newGroup);
    return newGroup;
  },
  async updateGroup(id: string, data: Partial<Group>): Promise<Group> {
    const idx = mockGroups.findIndex((g) => g.id === id);
    if (idx === -1) throw new Error("群組不存在");
    mockGroups[idx] = { ...mockGroups[idx], ...data };
    return mockGroups[idx];
  },
  async deleteGroup(id: string) {
    const idx = mockGroups.findIndex((g) => g.id === id);
    if (idx !== -1) mockGroups.splice(idx, 1);
  },
  async joinGroup(groupId: string, userId: string): Promise<GroupMember> {
    return {
      id: generateId(),
      userId,
      groupId,
      role: "member",
      joinedAt: new Date().toISOString(),
      displayName: "Mock 使用者",
    };
  },
  async leaveGroup() {
    console.info("[MockSource] leaveGroup 模擬成功");
  },

  // ===== 群組成員 =====
  async listGroupMembers(): Promise<GroupMember[]> {
    return [];
  },
  async updateMemberRole() {
    console.info("[MockSource] updateMemberRole 模擬成功");
  },
  async removeMember() {
    console.info("[MockSource] removeMember 模擬成功");
  },

  // ===== 群組貼文 =====
  async listGroupPosts(): Promise<GroupPost[]> {
    return mockPosts;
  },
  async getGroupPost(id: string) {
    return mockPosts.find((p) => p.id === id) || null;
  },
  async createGroupPost(data): Promise<GroupPost> {
    const newPost: GroupPost = {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
      likeCount: 0,
      commentCount: 0,
    };
    mockPosts.push(newPost);
    return newPost;
  },
  async updateGroupPost(id: string, data: Partial<GroupPost>): Promise<GroupPost> {
    const idx = mockPosts.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error("貼文不存在");
    mockPosts[idx] = { ...mockPosts[idx], ...data };
    return mockPosts[idx];
  },
  async deleteGroupPost(id: string) {
    const idx = mockPosts.findIndex((p) => p.id === id);
    if (idx !== -1) mockPosts.splice(idx, 1);
  },
  async likePost() {
    console.info("[MockSource] likePost 模擬成功");
  },
  async unlikePost() {
    console.info("[MockSource] unlikePost 模擬成功");
  },

  // ===== 留言 =====
  async listComments(): Promise<Comment[]> {
    return [];
  },
  async createComment(data): Promise<Comment> {
    return {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
      likeCount: 0,
    };
  },
  async deleteComment() {
    console.info("[MockSource] deleteComment 模擬成功");
  },

  // ===== 作業 =====
  async listAssignments(): Promise<Assignment[]> {
    return [];
  },
  async getAssignment(): Promise<Assignment | null> {
    return null;
  },
  async createAssignment(data): Promise<Assignment> {
    return {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
      submissionCount: 0,
    };
  },
  async updateAssignment(id: string, data: Partial<Assignment>): Promise<Assignment> {
    throw new Error("Mock 模式不支援此操作");
  },
  async deleteAssignment() {
    console.info("[MockSource] deleteAssignment 模擬成功");
  },

  // ===== 作業繳交 =====
  async listSubmissions(): Promise<Submission[]> {
    return [];
  },
  async getSubmission(): Promise<Submission | null> {
    return null;
  },
  async submitAssignment(data): Promise<Submission> {
    return {
      ...data,
      id: generateId(),
      submittedAt: new Date().toISOString(),
      status: "submitted",
    };
  },
  async gradeSubmission(id: string, grade: number, feedback?: string): Promise<Submission> {
    return {
      id,
      assignmentId: "mock",
      userId: "mock",
      content: "",
      submittedAt: new Date().toISOString(),
      status: "graded",
      grade,
      feedback,
    };
  },

  // ===== 訊息 =====
  async listConversations(): Promise<Conversation[]> {
    return [];
  },
  async getConversation(): Promise<Conversation | null> {
    return null;
  },
  async createConversation(participantIds: string[]): Promise<Conversation> {
    return {
      id: generateId(),
      participants: participantIds,
      participantIds,
      lastMessage: null,
      lastMessageAt: null,
      unreadCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },
  async listMessages(): Promise<Message[]> {
    return [];
  },
  async sendMessage(data): Promise<Message> {
    return {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
  },
  async markMessageRead() {
    console.info("[MockSource] markMessageRead 模擬成功");
  },

  // ===== 失物招領 =====
  async listLostFoundItems(): Promise<LostFoundItem[]> {
    return [];
  },
  async getLostFoundItem(): Promise<LostFoundItem | null> {
    return null;
  },
  async createLostFoundItem(data): Promise<LostFoundItem> {
    return {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
      status: "active",
    };
  },
  async updateLostFoundItem(id: string, data: Partial<LostFoundItem>): Promise<LostFoundItem> {
    throw new Error("Mock 模式不支援此操作");
  },
  async resolveLostFoundItem() {
    console.info("[MockSource] resolveLostFoundItem 模擬成功");
  },

  // ===== 圖書館 =====
  async searchBooks(): Promise<LibraryBook[]> {
    return [];
  },
  async getBook(): Promise<LibraryBook | null> {
    return null;
  },
  async listLoans(): Promise<LibraryLoan[]> {
    return [];
  },
  async borrowBook(bookId: string, userId: string): Promise<LibraryLoan> {
    return {
      id: generateId(),
      bookId,
      userId,
      borrowedAt: new Date().toISOString(),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      status: "borrowed",
      renewCount: 0,
    };
  },
  async returnBook() {
    console.info("[MockSource] returnBook 模擬成功");
  },
  async renewBook(loanId: string): Promise<LibraryLoan> {
    return {
      id: loanId,
      bookId: "mock",
      userId: "mock",
      borrowedAt: new Date().toISOString(),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      status: "borrowed",
      renewCount: 1,
    };
  },

  // ===== 圖書館座位 =====
  async listSeats(): Promise<LibrarySeat[]> {
    return [];
  },
  async listSeatReservations(): Promise<SeatReservation[]> {
    return [];
  },
  async reserveSeat(
    seatId: string,
    userId: string,
    date: string,
    startTime: string,
    endTime: string
  ): Promise<SeatReservation> {
    return {
      id: generateId(),
      seatId,
      userId,
      date,
      startTime,
      endTime,
      status: "active",
      createdAt: new Date().toISOString(),
    };
  },
  async cancelSeatReservation() {
    console.info("[MockSource] cancelSeatReservation 模擬成功");
  },

  // ===== 公車 =====
  async listBusRoutes(): Promise<BusRoute[]> {
    return [
      {
        id: "route1",
        name: "校園巡迴線",
        schoolId: "default",
        stops: [
          { id: "stop1", name: "校門口", lat: 25.0173, lng: 121.5398 },
          { id: "stop2", name: "圖書館", lat: 25.018, lng: 121.54 },
          { id: "stop3", name: "體育館", lat: 25.019, lng: 121.541 },
        ],
        schedule: {
          weekday: ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"],
          weekend: ["09:00", "12:00", "15:00"],
        },
        color: "#4CAF50",
      },
    ];
  },
  async getBusRoute(id: string): Promise<BusRoute | null> {
    const routes = await mockSource.listBusRoutes();
    return routes.find((r) => r.id === id) || null;
  },
  async getBusArrivals(): Promise<BusArrival[]> {
    return [
      {
        id: "arr1",
        routeId: "route1",
        stopId: "stop1",
        estimatedArrival: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        estimatedMinutes: 5,
        busId: "bus1",
      },
    ];
  },

  // ===== 通知 =====
  async listNotifications(): Promise<Notification[]> {
    return [];
  },
  async markNotificationRead() {
    console.info("[MockSource] markNotificationRead 模擬成功");
  },
  async markAllNotificationsRead() {
    console.info("[MockSource] markAllNotificationsRead 模擬成功");
  },
  async deleteNotification() {
    console.info("[MockSource] deleteNotification 模擬成功");
  },

  // ===== 行事曆 =====
  async listCalendarEvents(): Promise<CalendarEvent[]> {
    return [];
  },
  async createCalendarEvent(data): Promise<CalendarEvent> {
    return {
      ...data,
      id: generateId(),
    };
  },
  async updateCalendarEvent(id: string, data: Partial<CalendarEvent>): Promise<CalendarEvent> {
    return {
      id,
      title: data.title || "Mock Event",
      startDate: data.startDate || new Date().toISOString(),
      endDate: data.endDate || new Date().toISOString(),
      userId: data.userId || "mock",
      ...data,
    };
  },
  async deleteCalendarEvent() {
    console.info("[MockSource] deleteCalendarEvent 模擬成功");
  },
  async syncCoursesToCalendar() {
    console.info("[MockSource] syncCoursesToCalendar 模擬成功");
  },

  // ===== 訂單與支付 =====
  async listOrders(): Promise<Order[]> {
    return [];
  },
  async getOrder(): Promise<Order | null> {
    return null;
  },
  async createOrder(data): Promise<Order> {
    return {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
      status: "pending",
      paymentStatus: "unpaid",
    };
  },
  async updateOrderStatus(id: string, status: Order["status"]): Promise<Order> {
    return {
      id,
      userId: "mock",
      items: [],
      totalAmount: 0,
      createdAt: new Date().toISOString(),
      status,
      paymentStatus: "unpaid",
    };
  },
  async cancelOrder() {
    console.info("[MockSource] cancelOrder 模擬成功");
  },
  async listTransactions(): Promise<Transaction[]> {
    return [];
  },

  // ===== 成就 =====
  async listAchievements(): Promise<UserAchievement[]> {
    return [
      {
        id: "ach1",
        name: "新手上路",
        description: "完成首次登入",
        icon: "rocket",
        points: 10,
        category: "general",
        unlockedAt: new Date().toISOString(),
        progress: 100,
        maxProgress: 100,
      },
    ];
  },
  async getUserAchievements(): Promise<UserAchievement[]> {
    return mockSource.listAchievements();
  },
  async updateAchievementProgress(
    userId: string,
    achievementId: string,
    progress: number
  ): Promise<UserAchievement> {
    return {
      id: achievementId,
      name: "Mock Achievement",
      description: "",
      icon: "star",
      points: 10,
      category: "general",
      progress,
      maxProgress: 100,
    };
  },

  // ===== 宿舍服務 =====
  async getDormitoryInfo(userId: string): Promise<DormitoryInfo | null> {
    return {
      id: "dorm1",
      building: "A棟",
      room: "512",
      floor: 5,
      roommates: ["王大明", "李小華"],
      startDate: "2024-09-01",
      endDate: "2025-06-30",
      userId,
    };
  },

  async listRepairRequests(userId: string): Promise<RepairRequest[]> {
    return [
      {
        id: "r1",
        type: "ac",
        title: "冷氣不冷",
        description: "房間冷氣開強也不涼",
        status: "assigned",
        createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        room: "A棟 512",
        userId,
      },
      {
        id: "r2",
        type: "plumbing",
        title: "水龍頭漏水",
        description: "浴室水龍頭滴水",
        status: "completed",
        createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        completedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        room: "A棟 512",
        userId,
      },
    ];
  },

  async createRepairRequest(data): Promise<RepairRequest> {
    return {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
      status: "pending",
    };
  },

  async updateRepairRequest(id: string, data: Partial<RepairRequest>): Promise<RepairRequest> {
    return {
      id,
      type: data.type || "other",
      title: data.title || "",
      description: data.description || "",
      status: data.status || "pending",
      createdAt: new Date().toISOString(),
      room: data.room || "",
      userId: data.userId || "mock",
      ...data,
    };
  },

  async cancelRepairRequest() {
    console.info("[MockSource] cancelRepairRequest 模擬成功");
  },

  async listDormPackages(userId: string): Promise<DormPackage[]> {
    return [
      {
        id: "p1",
        trackingNumber: "SF1234567890",
        carrier: "順豐速運",
        arrivedAt: new Date(Date.now() - 4 * 3600000).toISOString(),
        status: "pending",
        location: "管理室",
        userId,
      },
      {
        id: "p2",
        trackingNumber: "711234567890",
        carrier: "7-11 交貨便",
        arrivedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
        status: "pending",
        location: "A棟 1F 郵件櫃",
        userId,
      },
      {
        id: "p3",
        trackingNumber: "PCH1234567",
        carrier: "黑貓宅急便",
        arrivedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        status: "picked",
        location: "管理室",
        userId,
        pickedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
    ];
  },

  async confirmPackagePickup() {
    console.info("[MockSource] confirmPackagePickup 模擬成功");
  },

  async listWashingMachines(): Promise<WashingMachine[]> {
    return [
      { id: "w1", number: 1, floor: "1F", building: "A棟", status: "available", type: "washer", price: 20 },
      { id: "w2", number: 2, floor: "1F", building: "A棟", status: "inUse", remainingTime: 25, type: "washer", price: 20 },
      { id: "w3", number: 3, floor: "1F", building: "A棟", status: "inUse", remainingTime: 8, type: "washer", price: 20 },
      { id: "w4", number: 4, floor: "1F", building: "A棟", status: "maintenance", type: "washer", price: 20 },
      { id: "d1", number: 1, floor: "1F", building: "A棟", status: "available", type: "dryer", price: 10 },
      { id: "d2", number: 2, floor: "1F", building: "A棟", status: "inUse", remainingTime: 42, type: "dryer", price: 10 },
    ];
  },

  async listWashingReservations(): Promise<WashingReservation[]> {
    return [];
  },

  async reserveWashingMachine(machineId: string, userId: string): Promise<WashingReservation> {
    return {
      id: generateId(),
      machineId,
      userId,
      startTime: new Date().toISOString(),
      status: "reserved",
      createdAt: new Date().toISOString(),
    };
  },

  async cancelWashingReservation() {
    console.info("[MockSource] cancelWashingReservation 模擬成功");
  },

  async listDormAnnouncements(): Promise<DormAnnouncement[]> {
    return [
      {
        id: "da1",
        title: "停水通知",
        content: "3/5 (二) 08:00-12:00 進行管線維修，屆時將停止供水",
        type: "maintenance",
        building: "A棟",
        publishedAt: new Date().toISOString(),
      },
    ];
  },

  // ===== 列印服務 =====
  async listPrinters(): Promise<Printer[]> {
    return [
      {
        id: "p1",
        name: "圖書館 1F 印表機",
        location: "圖書館 1F 入口處",
        building: "圖書館",
        floor: "1F",
        status: "online",
        capabilities: ["color", "duplex", "a4"],
        queueLength: 2,
        pricePerPage: { bw: 1, color: 5 },
      },
      {
        id: "p2",
        name: "工程館 3F 印表機",
        location: "工程館 3F 走廊",
        building: "工程館",
        floor: "3F",
        status: "online",
        capabilities: ["duplex", "a4", "a3"],
        queueLength: 0,
        pricePerPage: { bw: 1, color: 5 },
      },
      {
        id: "p3",
        name: "學生活動中心印表機",
        location: "學生活動中心 2F",
        building: "學生活動中心",
        floor: "2F",
        status: "busy",
        capabilities: ["color", "duplex", "a4", "scan", "copy"],
        queueLength: 5,
        pricePerPage: { bw: 1, color: 5 },
      },
    ];
  },

  async getPrinter(id: string): Promise<Printer | null> {
    const printers = await mockSource.listPrinters();
    return printers.find((p) => p.id === id) || null;
  },

  async listPrintJobs(userId: string): Promise<PrintJob[]> {
    return [
      {
        id: "job1",
        userId,
        printerId: "p1",
        fileName: "作業報告.pdf",
        pages: 10,
        copies: 1,
        color: false,
        duplex: true,
        status: "completed",
        cost: 10,
        createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        completedAt: new Date(Date.now() - 2 * 86400000 + 300000).toISOString(),
      },
    ];
  },

  async createPrintJob(data): Promise<PrintJob> {
    const pages = data.pages || 1;
    const copies = data.copies || 1;
    const cost = data.color ? pages * copies * 5 : pages * copies * 1;
    return {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
      status: "pending",
      cost,
    };
  },

  async cancelPrintJob() {
    console.info("[MockSource] cancelPrintJob 模擬成功");
  },

  // ===== 健康服務 =====
  async listHealthAppointments(userId: string): Promise<HealthAppointment[]> {
    return [
      {
        id: "ha1",
        userId,
        department: "general",
        doctorName: "陳醫師",
        date: new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0],
        timeSlot: "10:00",
        status: "scheduled",
        reason: "感冒症狀",
        createdAt: new Date().toISOString(),
      },
    ];
  },

  async createHealthAppointment(data): Promise<HealthAppointment> {
    return {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
      status: "scheduled",
    };
  },

  async cancelHealthAppointment() {
    console.info("[MockSource] cancelHealthAppointment 模擬成功");
  },

  async listHealthRecords(userId: string): Promise<HealthRecord[]> {
    return [
      {
        id: "hr1",
        userId,
        type: "appointment",
        date: new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0],
        department: "general",
        doctorName: "陳醫師",
        diagnosis: "上呼吸道感染",
        prescription: "感冒藥三日份",
      },
    ];
  },

  async listHealthTimeSlots(department: string, date: string): Promise<HealthTimeSlot[]> {
    const slots: HealthTimeSlot[] = [];
    const times = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "15:30", "16:00"];
    
    times.forEach((time, idx) => {
      slots.push({
        id: `slot_${idx}`,
        department: department as any,
        doctorName: "陳醫師",
        date,
        time,
        available: Math.random() > 0.3,
        capacity: 1,
        booked: Math.random() > 0.3 ? 0 : 1,
      });
    });
    
    return slots;
  },

  // ===== 安全支付操作 =====
  async processTopup(data: {
    userId: string;
    amount: number;
    paymentMethod: string;
  }): Promise<{
    success: boolean;
    newBalance?: number;
    transactionId?: string;
    errorCode?: string;
    errorMessage?: string;
  }> {
    // 模擬後端處理
    await delay(1000);
    
    // 模擬驗證
    if (data.amount < 100) {
      return {
        success: false,
        errorCode: "MIN_TOPUP_AMOUNT",
        errorMessage: "最低儲值金額為 $100",
      };
    }
    
    if (data.amount > 10000) {
      return {
        success: false,
        errorCode: "MAX_TOPUP_AMOUNT",
        errorMessage: "單次儲值上限為 $10,000",
      };
    }
    
    // 模擬成功
    const mockCurrentBalance = 1234;
    const newBalance = mockCurrentBalance + data.amount;
    
    return {
      success: true,
      newBalance,
      transactionId: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };
  },

  async processPayment(data: {
    userId: string;
    amount: number;
    paymentMethod: string;
    merchantId: string;
    description: string;
  }): Promise<{
    success: boolean;
    newBalance?: number;
    transactionId?: string;
    errorCode?: string;
    errorMessage?: string;
  }> {
    // 模擬後端處理
    await delay(1000);
    
    const mockCurrentBalance = 1234;
    
    // 模擬餘額不足
    if (data.amount > mockCurrentBalance) {
      return {
        success: false,
        errorCode: "INSUFFICIENT_BALANCE",
        errorMessage: "餘額不足",
      };
    }
    
    const newBalance = mockCurrentBalance - data.amount;
    
    return {
      success: true,
      newBalance,
      transactionId: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };
  },
  
  async rescheduleHealthAppointment(id: string, data: { date: string; timeSlot: string; doctorId?: string; doctorName?: string }): Promise<any> {
    console.info("[MockSource] rescheduleHealthAppointment:", id, data);
    await delay(500);
    return {
      id,
      ...data,
      status: "scheduled",
    };
  },
  
  async createAccessApplication(data: {
    userId: string;
    type: "extended_hours" | "temporary_access";
    requestedTime?: string;
    reason: string;
    schoolId?: string;
  }): Promise<{ id: string; status: "pending" }> {
    console.info("[MockSource] createAccessApplication:", data);
    await delay(500);
    return {
      id: `access_${Date.now()}`,
      status: "pending",
    };
  },
  
  async createLateReturnRecord(data: {
    userId: string;
    building?: string;
    room?: string;
    returnTime: string;
    schoolId?: string;
  }): Promise<{ id: string }> {
    console.info("[MockSource] createLateReturnRecord:", data);
    await delay(300);
    return {
      id: `late_${Date.now()}`,
    };
  },
  
  async createVisitorRecord(data: {
    userId: string;
    visitorName: string;
    visitorPhone: string;
    building?: string;
    room?: string;
    arrivalTime: string;
    expectedLeaveTime: string;
    schoolId?: string;
  }): Promise<{ id: string }> {
    console.info("[MockSource] createVisitorRecord:", data);
    await delay(500);
    return {
      id: `visitor_${Date.now()}`,
    };
  },
};
