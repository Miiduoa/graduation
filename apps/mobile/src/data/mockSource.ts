/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import type { DataSource } from './source';
import type {
  Announcement,
  Assignment,
  AttendanceSession,
  AttendanceSummary,
  BusArrival,
  BusRoute,
  Cafeteria,
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
  PoiCrowdReport,
  PoiReport,
  PoiReview,
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
} from './types';
import {
  getDemoAnnouncements,
  getDemoCourses,
  getDemoEvents,
  getDemoPois,
  getDemoCafeterias,
  getDemoMenuItems,
  getDemoGroups,
  getDemoGroupPosts,
  getDemoUsers,
  getDemoBusRoutes,
  getDemoLibraryBooks,
  getDemoNotifications,
  getDemoAssignments,
  getDemoLostFoundItems,
  getDemoCalendarEvents,
  getDemoConversations,
  getDemoMessages,
  getDemoGroupMembers,
  getDemoComments,
  getDemoSubmissions,
  getDemoLibraryLoans,
  getDemoLibrarySeats,
  getDemoAchievements,
  getDemoCourseModules,
  getDemoCourseMaterials,
  getDemoQuizzes,
  getDemoAttendanceSessions,
  getDemoInboxTasks,
  getDemoEnrollments,
  getDemoGrades,
  getDemoGPA,
  getDemoDormitoryInfo,
  getDemoRepairRequests,
  getDemoDormPackages,
  getDemoDormAnnouncements,
  getDemoWashingMachines,
  getDemoPrinters,
  getDemoPrintJobs,
  getDemoHealthAppointments,
  getDemoHealthTimeSlots,
  getDemoHealthRecords,
  getDemoOrders,
  getDemoTransactions,
  getDemoCourseGradebook,
} from './demoData';

// 生成唯一 ID
const generateId = () => `mock_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Default school ID for demo data
const DEFAULT_SCHOOL = 'tw-nchu';

// Mock 使用者資料 - populated from demoData by default, mutation support
const mockUsers: Record<string, User> = {
  user1: {
    id: 'user1',
    email: 'demo@campus.edu',
    displayName: 'Demo 使用者',
    studentId: 'B10901001',
    department: '資訊工程學系',
    year: 3,
    role: 'student',
    schoolId: 'tw-nchu',
    balance: 1234,
    createdAt: '2024-01-01T00:00:00Z',
    avatarUrl: null,
    phone: null,
    bio: '這是一個測試帳號',
    joinedAt: '2024-01-01T00:00:00Z',
    settings: {
      notifications: true,
      emailNotifications: true,
      language: 'zh-TW',
    },
  },
};

// Mock 群組資料 - start with demo data
let mockGroups: Group[] = getDemoGroups(DEFAULT_SCHOOL);

// Mock 貼文資料 - start populated from demo
let mockPosts: GroupPost[] = getDemoGroupPosts(DEFAULT_SCHOOL, 'group1');
const mockPoiReviews = new Map<string, PoiReview[]>();
const mockPoiCrowdReports = new Map<string, PoiCrowdReport[]>();
const mockPoiReports = new Map<string, PoiReport[]>();

// Mock 課程資料 - start with demo data
let mockCourses: Course[] = getDemoCourses(DEFAULT_SCHOOL);

// Mock 餐廳資料 - start with demo data
let mockCafeterias: Cafeteria[] = getDemoCafeterias(DEFAULT_SCHOOL);

function getScopedPoiKey(poiId: string, schoolId?: string): string {
  return `${schoolId ?? DEFAULT_SCHOOL}:${poiId}`;
}

function getPoiReviews(poiId: string, schoolId?: string): PoiReview[] {
  return mockPoiReviews.get(getScopedPoiKey(poiId, schoolId)) ?? [];
}

function getPoiCrowdReports(poiId: string, schoolId?: string): PoiCrowdReport[] {
  return mockPoiCrowdReports.get(getScopedPoiKey(poiId, schoolId)) ?? [];
}

export const mockSource: DataSource = {
  // ===== 公告 =====
  async listAnnouncements(schoolId?: string) {
    return getDemoAnnouncements(schoolId || DEFAULT_SCHOOL);
  },
  async getAnnouncement(id: string, schoolId?: string) {
    const found = getDemoAnnouncements(schoolId || DEFAULT_SCHOOL).find((a) => a.id === id);
    return found || null;
  },

  // ===== 活動 =====
  async listEvents(schoolId?: string) {
    return getDemoEvents(schoolId || DEFAULT_SCHOOL);
  },
  async getEvent(id: string, schoolId?: string) {
    const found = getDemoEvents(schoolId || DEFAULT_SCHOOL).find((e) => e.id === id);
    return found || null;
  },
  async registerEvent() {
    console.info('[MockSource] registerEvent 模擬成功');
  },
  async unregisterEvent() {
    console.info('[MockSource] unregisterEvent 模擬成功');
  },

  // ===== 地點 =====
  async listPois(schoolId?: string) {
    return getDemoPois(schoolId || DEFAULT_SCHOOL);
  },
  async getPoi(id: string, schoolId?: string) {
    const found = getDemoPois(schoolId || DEFAULT_SCHOOL).find((p) => p.id === id);
    return found || null;
  },
  async listPoiReviews(poiId: string, schoolId?: string) {
    return [...getPoiReviews(poiId, schoolId)].sort((a, b) =>
      (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
    );
  },
  async listPoiCrowdReports(poiId: string, schoolId?: string) {
    return [...getPoiCrowdReports(poiId, schoolId)].sort((a, b) =>
      (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
    );
  },
  async submitPoiReview(data) {
    const key = getScopedPoiKey(data.poiId, data.schoolId);
    const nextReview: PoiReview = {
      id: data.uid,
      uid: data.uid,
      schoolId: data.schoolId,
      displayName: data.displayName ?? null,
      avatarUrl: data.avatarUrl ?? null,
      rating: data.rating,
      comment: data.comment.trim(),
      tags: data.tags ?? [],
      helpful: 0,
      helpfulBy: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const current = getPoiReviews(data.poiId, data.schoolId).filter((review) => review.id !== nextReview.id);
    mockPoiReviews.set(key, [nextReview, ...current]);
  },
  async submitPoiCrowdReport(data) {
    const key = getScopedPoiKey(data.poiId, data.schoolId);
    const nextReport: PoiCrowdReport = {
      id: generateId(),
      uid: data.uid,
      schoolId: data.schoolId,
      level: data.level,
      createdAt: new Date().toISOString(),
    };
    mockPoiCrowdReports.set(key, [nextReport, ...getPoiCrowdReports(data.poiId, data.schoolId)]);
  },
  async togglePoiReviewHelpful(data) {
    const key = getScopedPoiKey(data.poiId, data.schoolId);
    const nextReviews = getPoiReviews(data.poiId, data.schoolId).map((review) => {
      if (review.id !== data.reviewId) return review;
      const helpfulBy = new Set(review.helpfulBy ?? []);
      if (data.alreadyHelpful) {
        helpfulBy.delete(data.uid);
      } else {
        helpfulBy.add(data.uid);
      }
      return {
        ...review,
        helpfulBy: Array.from(helpfulBy),
        helpful: helpfulBy.size,
        updatedAt: new Date().toISOString(),
      };
    });
    mockPoiReviews.set(key, nextReviews);
  },
  async submitPoiReport(data) {
    const key = getScopedPoiKey(data.poiId, data.schoolId);
    const nextReport: PoiReport = {
      id: generateId(),
      uid: data.uid,
      schoolId: data.schoolId,
      email: data.email ?? null,
      type: data.type,
      description: data.description.trim(),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    mockPoiReports.set(key, [nextReport, ...(mockPoiReports.get(key) ?? [])]);
  },

  // ===== 餐廳菜單 =====
  async listCafeterias(schoolId?: string): Promise<Cafeteria[]> {
    return getDemoCafeterias(schoolId || DEFAULT_SCHOOL);
  },
  async listMenus(schoolId?: string) {
    return getDemoMenuItems(schoolId || DEFAULT_SCHOOL).map((menu) => {
      const cafeteria = mockCafeterias.find((row) => row.id === menu.cafeteriaId);
      return {
        ...menu,
        cafeteriaId: cafeteria?.id,
        orderingEnabled: cafeteria?.orderingEnabled,
        pilotStatus: cafeteria?.pilotStatus,
      };
    });
  },
  async getMenuItem(id: string, schoolId?: string) {
    const found = getDemoMenuItems(schoolId || DEFAULT_SCHOOL).find((m) => m.id === id);
    return found || null;
  },
  async rateMenuItem() {
    console.info('[MockSource] rateMenuItem 模擬成功');
  },

  // ===== 使用者 =====
  async getUser(id: string, schoolId?: string) {
    // First check mutation store
    if (mockUsers[id]) {
      return mockUsers[id];
    }
    // Then check demo data
    const demoUser = getDemoUsers(schoolId || DEFAULT_SCHOOL).find((u) => u.id === id);
    return demoUser || null;
  },
  async updateUser(id: string, data: Partial<User>) {
    if (mockUsers[id]) {
      mockUsers[id] = { ...mockUsers[id], ...data };
      return mockUsers[id];
    }
    throw new Error('使用者不存在');
  },
  async getUserByEmail(email: string, schoolId?: string) {
    // Check demo data
    const demoUser = getDemoUsers(schoolId || DEFAULT_SCHOOL).find((u) => u.email === email);
    if (demoUser) return demoUser;
    // Check mutation store
    const user = Object.values(mockUsers).find((u) => u.email === email);
    return user || null;
  },

  // ===== 課程 =====
  async listCourses(schoolId?: string) {
    return getDemoCourses(schoolId || DEFAULT_SCHOOL);
  },
  async getCourse(id: string, schoolId?: string) {
    return getDemoCourses(schoolId || DEFAULT_SCHOOL).find((c) => c.id === id) || null;
  },
  async searchCourses(query: string, schoolId?: string) {
    const q = query.toLowerCase();
    return getDemoCourses(schoolId || DEFAULT_SCHOOL).filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.instructor.toLowerCase().includes(q),
    );
  },
  async listCourseSpaces(_userId: string, schoolId?: string): Promise<CourseSpace[]> {
    return getDemoGroups(schoolId || DEFAULT_SCHOOL)
      .filter((group) => group.type === 'course')
      .map((group) => ({
        id: group.id,
        groupId: group.id,
        name: group.name,
        description: group.description,
        courseId: group.courseId,
        memberCount: group.memberCount,
        unreadCount: Math.floor(Math.random() * 5),
        assignmentCount: 3,
        dueSoonCount: 1,
        quizCount: 2,
        moduleCount: 5,
        activeSessionId: null,
        latestDueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }));
  },
  async getCourseSpace(
    id: string,
    _userId?: string,
  ): Promise<CourseSpace | null> {
    const group = mockGroups.find((g) => g.id === id);
    if (!group || group.type !== 'course') return null;
    return {
      id: group.id,
      groupId: group.id,
      name: group.name,
      description: group.description,
      courseId: group.courseId,
      memberCount: group.memberCount,
      unreadCount: Math.floor(Math.random() * 5),
      assignmentCount: 3,
      dueSoonCount: 1,
      quizCount: 2,
      moduleCount: 5,
      activeSessionId: null,
      latestDueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };
  },
  async listCourseModules(_userId: string, courseSpaceId?: string, schoolId?: string): Promise<CourseModule[]> {
    return getDemoCourseModules(schoolId || DEFAULT_SCHOOL, courseSpaceId);
  },
  async createCourseModule(_input): Promise<{ id: string }> {
    return { id: generateId() };
  },
  async listCourseMaterials(courseSpaceId: string, moduleId?: string, schoolId?: string): Promise<CourseMaterial[]> {
    return getDemoCourseMaterials(courseSpaceId, moduleId);
  },
  async listQuizzes(userId: string, courseSpaceId?: string, schoolId?: string): Promise<Quiz[]> {
    return getDemoQuizzes(userId, courseSpaceId, schoolId || DEFAULT_SCHOOL);
  },
  async getQuiz(quizId: string, userId: string, courseSpaceId?: string, schoolId?: string): Promise<Quiz | null> {
    const quizzes = getDemoQuizzes(userId, courseSpaceId, schoolId || DEFAULT_SCHOOL);
    return quizzes.find(q => q.id === quizId) || null;
  },
  async createQuiz(_input): Promise<{ id: string }> {
    return { id: generateId() };
  },
  async submitQuiz(input): Promise<Submission> {
    return {
      id: generateId(),
      assignmentId: input.quizId,
      userId: input.userId,
      content: JSON.stringify(input.answers ?? {}),
      attachments: input.attachments,
      submittedAt: new Date().toISOString(),
      status: 'submitted',
    };
  },
  async listAttendanceSessions(userId: string, courseSpaceId?: string, schoolId?: string): Promise<AttendanceSession[]> {
    return getDemoAttendanceSessions(userId, courseSpaceId, schoolId || DEFAULT_SCHOOL);
  },
  async startAttendanceSession(): Promise<{
    success: boolean;
    sessionId: string;
    qrToken?: string;
    qrExpiresAt?: string;
  }> {
    return { success: true, sessionId: generateId() };
  },
  async checkInAttendance(): Promise<{ success: boolean }> {
    return { success: true };
  },
  async getAttendanceSummary(groupId: string): Promise<AttendanceSummary> {
    return {
      groupId,
      totalSessions: 10,
      activeSessions: 1,
      totalAttendees: 35,
      latestSession: null,
    };
  },
  async listInboxTasks(userId: string, schoolId?: string): Promise<InboxTask[]> {
    return getDemoInboxTasks(userId, schoolId || DEFAULT_SCHOOL);
  },
  async getCourseGradebook(groupId?: string): Promise<CourseGradebookData | null> {
    // For demo purposes, return gradebook for any course
    if (!groupId) return null;
    return getDemoCourseGradebook(DEFAULT_SCHOOL);
  },
  async listEnrollments(userId: string, semester?: string, schoolId?: string): Promise<Enrollment[]> {
    return getDemoEnrollments(userId, semester, schoolId || DEFAULT_SCHOOL);
  },
  async enrollCourse(userId: string, courseId: string, semester: string): Promise<Enrollment> {
    return {
      id: generateId(),
      userId,
      courseId,
      semester,
      createdAt: new Date().toISOString(),
      enrolledAt: new Date().toISOString(),
      status: 'enrolled',
    };
  },
  async dropCourse() {
    console.info('[MockSource] dropCourse 模擬成功');
  },
  async listGrades(userId: string, semester?: string, schoolId?: string): Promise<Grade[]> {
    return getDemoGrades(userId, semester, schoolId || DEFAULT_SCHOOL);
  },
  async getGPA(userId: string, schoolId?: string) {
    return getDemoGPA(userId, schoolId || DEFAULT_SCHOOL);
  },
  async listGroups(userId?: string, options?: any) {
    return getDemoGroups(options?.schoolId || DEFAULT_SCHOOL);
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
    if (idx === -1) throw new Error('群組不存在');
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
      role: 'member',
      joinedAt: new Date().toISOString(),
      displayName: 'Mock 使用者',
    };
  },
  async leaveGroup() {
    console.info('[MockSource] leaveGroup 模擬成功');
  },

  // ===== 群組成員 =====
  async listGroupMembers(groupId: string, options?: any): Promise<GroupMember[]> {
    return getDemoGroupMembers(groupId, options?.schoolId || DEFAULT_SCHOOL);
  },
  async updateMemberRole() {
    console.info('[MockSource] updateMemberRole 模擬成功');
  },
  async removeMember() {
    console.info('[MockSource] removeMember 模擬成功');
  },

  // ===== 群組貼文 =====
  async listGroupPosts(groupId?: string, options?: any): Promise<GroupPost[]> {
    if (groupId) {
      return getDemoGroupPosts(options?.schoolId || DEFAULT_SCHOOL, groupId);
    }
    return mockPosts;
  },
  async getGroupPost(id: string, groupId?: string) {
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
    if (idx === -1) throw new Error('貼文不存在');
    mockPosts[idx] = { ...mockPosts[idx], ...data };
    return mockPosts[idx];
  },
  async deleteGroupPost(id: string) {
    const idx = mockPosts.findIndex((p) => p.id === id);
    if (idx !== -1) mockPosts.splice(idx, 1);
  },
  async likePost() {
    console.info('[MockSource] likePost 模擬成功');
  },
  async unlikePost() {
    console.info('[MockSource] unlikePost 模擬成功');
  },

  // ===== 留言 =====
  async listComments(postId: string, options?: any, groupId?: string): Promise<Comment[]> {
    return getDemoComments(postId, options?.schoolId || DEFAULT_SCHOOL);
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
    console.info('[MockSource] deleteComment 模擬成功');
  },

  // ===== 作業 =====
  async listAssignments(groupId?: string, options?: any): Promise<Assignment[]> {
    if (groupId) {
      return getDemoAssignments(options?.schoolId || DEFAULT_SCHOOL, groupId);
    }
    return [];
  },
  async getAssignment(id?: string, groupId?: string, schoolId?: string): Promise<Assignment | null> {
    if (id && groupId) {
      const assignments = getDemoAssignments(schoolId || DEFAULT_SCHOOL, groupId);
      return assignments.find((a) => a.id === id) || null;
    }
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
    throw new Error('Mock 模式不支援此操作');
  },
  async deleteAssignment() {
    console.info('[MockSource] deleteAssignment 模擬成功');
  },

  // ===== 作業繳交 =====
  async listSubmissions(assignmentId: string, options?: any, groupId?: string): Promise<Submission[]> {
    return getDemoSubmissions(assignmentId, options?.schoolId || DEFAULT_SCHOOL);
  },
  async getSubmission(assignmentId: string, userId: string, groupId?: string): Promise<Submission | null> {
    const subs = getDemoSubmissions(assignmentId, DEFAULT_SCHOOL);
    return subs.find(s => s.userId === userId) || null;
  },
  async submitAssignment(data): Promise<Submission> {
    return {
      ...data,
      id: generateId(),
      submittedAt: new Date().toISOString(),
      status: 'submitted',
    };
  },
  async gradeSubmission(id: string, grade: number, feedback?: string): Promise<Submission> {
    return {
      id,
      assignmentId: 'mock',
      userId: 'mock',
      content: '',
      submittedAt: new Date().toISOString(),
      status: 'graded',
      grade,
      feedback,
    };
  },

  // ===== 訊息 =====
  async listConversations(userId?: string, options?: any, schoolId?: string): Promise<Conversation[]> {
    if (userId) {
      return getDemoConversations(schoolId || DEFAULT_SCHOOL, userId);
    }
    return [];
  },
  async getConversation(id: string, schoolId?: string): Promise<Conversation | null> {
    const convs = getDemoConversations(schoolId || DEFAULT_SCHOOL, 'user1');
    return convs.find(c => c.id === id) || null;
  },
  async createConversation(
    participantIds: string[],
    schoolId?: string,
    conversationId?: string
  ): Promise<Conversation> {
    return {
      id: conversationId || generateId(),
      memberIds: participantIds,
      schoolId: schoolId ?? null,
      lastMessage: null,
      lastMessageAt: null,
      unreadCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },
  async listMessages(conversationId: string, options?: any): Promise<Message[]> {
    return getDemoMessages(conversationId);
  },
  async sendMessage(data): Promise<Message> {
    return {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
  },
  async markMessageRead() {
    console.info('[MockSource] markMessageRead 模擬成功');
  },

  // ===== 失物招領 =====
  async listLostFoundItems(schoolId?: string): Promise<LostFoundItem[]> {
    return getDemoLostFoundItems(schoolId || DEFAULT_SCHOOL);
  },
  async getLostFoundItem(id: string, schoolId?: string): Promise<LostFoundItem | null> {
    const found = getDemoLostFoundItems(schoolId || DEFAULT_SCHOOL).find((item) => item.id === id);
    return found || null;
  },
  async createLostFoundItem(data): Promise<LostFoundItem> {
    return {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
      status: 'active',
    };
  },
  async updateLostFoundItem(id: string, data: Partial<LostFoundItem>): Promise<LostFoundItem> {
    throw new Error('Mock 模式不支援此操作');
  },
  async resolveLostFoundItem() {
    console.info('[MockSource] resolveLostFoundItem 模擬成功');
  },

  // ===== 圖書館 =====
  async searchBooks(query: string, schoolId?: string): Promise<LibraryBook[]> {
    const q = query.toLowerCase();
    return getDemoLibraryBooks(schoolId || DEFAULT_SCHOOL).filter(
      (book) =>
        book.title.toLowerCase().includes(q) ||
        book.author.toLowerCase().includes(q) ||
        book.isbn.toLowerCase().includes(q),
    );
  },
  async getBook(id: string, schoolId?: string): Promise<LibraryBook | null> {
    const found = getDemoLibraryBooks(schoolId || DEFAULT_SCHOOL).find((book) => book.id === id);
    return found || null;
  },
  async listLoans(userId: string, schoolId?: string): Promise<LibraryLoan[]> {
    return getDemoLibraryLoans(userId, schoolId || DEFAULT_SCHOOL);
  },
  async borrowBook(bookId: string, userId: string): Promise<LibraryLoan> {
    return {
      id: generateId(),
      bookId,
      userId,
      borrowedAt: new Date().toISOString(),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'borrowed',
      renewCount: 0,
    };
  },
  async returnBook() {
    console.info('[MockSource] returnBook 模擬成功');
  },
  async renewBook(loanId: string): Promise<LibraryLoan> {
    return {
      id: loanId,
      bookId: 'mock',
      userId: 'mock',
      borrowedAt: new Date().toISOString(),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'borrowed',
      renewCount: 1,
    };
  },

  // ===== 圖書館座位 =====
  async listSeats(schoolId?: string): Promise<LibrarySeat[]> {
    return getDemoLibrarySeats(schoolId || DEFAULT_SCHOOL);
  },
  async listSeatReservations(): Promise<SeatReservation[]> {
    return [];
  },
  async reserveSeat(
    seatId: string,
    userId: string,
    date: string,
    startTime: string,
    endTime: string,
  ): Promise<SeatReservation> {
    return {
      id: generateId(),
      seatId,
      userId,
      date,
      startTime,
      endTime,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
  },
  async cancelSeatReservation() {
    console.info('[MockSource] cancelSeatReservation 模擬成功');
  },

  // ===== 公車 =====
  async listBusRoutes(schoolId?: string): Promise<BusRoute[]> {
    return getDemoBusRoutes(schoolId || DEFAULT_SCHOOL);
  },
  async getBusRoute(id: string, schoolId?: string): Promise<BusRoute | null> {
    const routes = getDemoBusRoutes(schoolId || DEFAULT_SCHOOL);
    return routes.find((r) => r.id === id) || null;
  },
  async getBusArrivals(): Promise<BusArrival[]> {
    return [
      {
        id: 'arr1',
        routeId: 'route1',
        stopId: 'stop1',
        estimatedArrival: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        estimatedMinutes: 5,
        busId: 'bus1',
      },
    ];
  },

  // ===== 通知 =====
  async listNotifications(userId?: string, options?: any): Promise<Notification[]> {
    if (userId) {
      return getDemoNotifications(options?.schoolId || DEFAULT_SCHOOL, userId);
    }
    return [];
  },
  async markNotificationRead() {
    console.info('[MockSource] markNotificationRead 模擬成功');
  },
  async markAllNotificationsRead() {
    console.info('[MockSource] markAllNotificationsRead 模擬成功');
  },
  async deleteNotification() {
    console.info('[MockSource] deleteNotification 模擬成功');
  },

  // ===== 行事曆 =====
  async listCalendarEvents(userId?: string, startDate?: string, endDate?: string, schoolId?: string): Promise<CalendarEvent[]> {
    if (userId) {
      return getDemoCalendarEvents(schoolId || DEFAULT_SCHOOL, userId);
    }
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
      title: data.title || 'Mock Event',
      startDate: data.startDate || new Date().toISOString(),
      endDate: data.endDate || new Date().toISOString(),
      userId: data.userId || 'mock',
      ...data,
    };
  },
  async deleteCalendarEvent() {
    console.info('[MockSource] deleteCalendarEvent 模擬成功');
  },
  async syncCoursesToCalendar() {
    console.info('[MockSource] syncCoursesToCalendar 模擬成功');
  },

  // ===== 訂單與支付 =====
  async listOrders(userId: string, options?: any, schoolId?: string): Promise<Order[]> {
    return getDemoOrders(userId, schoolId || DEFAULT_SCHOOL);
  },
  async getOrder(id: string, userId?: string, schoolId?: string): Promise<Order | null> {
    const orders = getDemoOrders(userId || 'user1', schoolId || DEFAULT_SCHOOL);
    return orders.find(o => o.id === id) || null;
  },
  async createOrder(data): Promise<Order> {
    return {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
      status: 'pending',
      paymentStatus: 'unpaid',
      merchantId: data.merchantId ?? (data as { cafeteriaId?: string }).cafeteriaId,
    };
  },
  async updateOrderStatus(id: string, status: Order['status']): Promise<Order> {
    return {
      id,
      userId: 'mock',
      items: [],
      totalAmount: 0,
      createdAt: new Date().toISOString(),
      status,
      paymentStatus: 'unpaid',
    };
  },
  async cancelOrder() {
    console.info('[MockSource] cancelOrder 模擬成功');
  },
  async listTransactions(userId: string, options?: any, schoolId?: string): Promise<Transaction[]> {
    return getDemoTransactions(userId, schoolId || DEFAULT_SCHOOL);
  },

  // ===== 成就 =====
  async listAchievements(schoolId?: string): Promise<UserAchievement[]> {
    return getDemoAchievements('user1', schoolId || DEFAULT_SCHOOL);
  },
  async getUserAchievements(userId: string, schoolId?: string): Promise<UserAchievement[]> {
    return getDemoAchievements(userId, schoolId || DEFAULT_SCHOOL);
  },
  async updateAchievementProgress(_userId: string, achievementId: string, progress: number): Promise<UserAchievement> {
    return {
      id: achievementId,
      name: 'Mock Achievement',
      description: '',
      icon: 'star',
      points: 10,
      category: 'general',
      progress,
      maxProgress: 100,
    };
  },

  // ===== 宿舍 =====
  async listDormAnnouncements(schoolId?: string): Promise<DormAnnouncement[]> {
    return getDemoDormAnnouncements(schoolId || DEFAULT_SCHOOL);
  },
  async getDormitoryInfo(userId: string, schoolId?: string): Promise<DormitoryInfo | null> {
    return getDemoDormitoryInfo(userId, schoolId || DEFAULT_SCHOOL);
  },
  async listDormPackages(userId: string, options?: any, schoolId?: string): Promise<DormPackage[]> {
    return getDemoDormPackages(userId, schoolId || DEFAULT_SCHOOL);
  },
  async createRepairRequest(): Promise<RepairRequest> {
    return {
      id: generateId(),
      userId: 'mock',
      type: 'other',
      title: 'Mock issue',
      description: 'Mock description',
      room: 'Mock room',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  },

  // ===== 健康與醫療 =====
  async listHealthAppointments(userId: string, options?: any, schoolId?: string): Promise<HealthAppointment[]> {
    return getDemoHealthAppointments(userId, schoolId || DEFAULT_SCHOOL);
  },
  async createHealthAppointment(data: any): Promise<HealthAppointment> {
    return {
      ...data,
      id: generateId(),
      status: 'scheduled',
      createdAt: new Date().toISOString(),
    };
  },
  async cancelHealthAppointment() {
    console.info('[MockSource] cancelHealthAppointment 模擬成功');
  },
  async rescheduleHealthAppointment(id: string, data: any): Promise<HealthAppointment> {
    return {
      id,
      userId: 'mock',
      department: 'general',
      date: data.date,
      timeSlot: data.timeSlot,
      status: 'scheduled',
      createdAt: new Date().toISOString(),
    };
  },
  async listHealthRecords(userId: string, options?: any, schoolId?: string): Promise<HealthRecord[]> {
    return getDemoHealthRecords(userId, schoolId || DEFAULT_SCHOOL);
  },
  async listHealthTimeSlots(department: string, date: string, schoolId?: string): Promise<HealthTimeSlot[]> {
    return getDemoHealthTimeSlots(department as any, date, schoolId || DEFAULT_SCHOOL);
  },

  // ===== 列印 =====
  async listPrinters(schoolId?: string): Promise<Printer[]> {
    return getDemoPrinters(schoolId || DEFAULT_SCHOOL);
  },
  async getPrinter(id: string, schoolId?: string): Promise<Printer | null> {
    const printers = getDemoPrinters(schoolId || DEFAULT_SCHOOL);
    return printers.find(p => p.id === id) || null;
  },
  async listPrintJobs(userId: string, options?: any, schoolId?: string): Promise<PrintJob[]> {
    return getDemoPrintJobs(userId, schoolId || DEFAULT_SCHOOL);
  },
  async createPrintJob(): Promise<PrintJob> {
    return {
      id: generateId(),
      userId: 'mock',
      printerId: 'mock',
      fileName: 'mock.pdf',
      pages: 10,
      copies: 1,
      color: false,
      duplex: false,
      status: 'pending',
      cost: 10,
      createdAt: new Date().toISOString(),
    };
  },
  async cancelPrintJob() {
    console.info('[MockSource] cancelPrintJob 模擬成功');
  },

  // ===== 洗衣機 =====
  async listWashingMachines(schoolId?: string): Promise<WashingMachine[]> {
    return getDemoWashingMachines(schoolId || DEFAULT_SCHOOL);
  },
  async listWashingReservations(): Promise<WashingReservation[]> {
    return [];
  },
  async reserveWashingMachine(): Promise<WashingReservation> {
    return {
      id: generateId(),
      machineId: 'mock',
      userId: 'mock',
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      status: 'reserved',
      createdAt: new Date().toISOString(),
    };
  },
  async cancelWashingReservation() {
    console.info('[MockSource] cancelWashingReservation 模擬成功');
  },

  // ===== 維修 =====
  async listRepairRequests(userId: string, options?: any, schoolId?: string): Promise<RepairRequest[]> {
    return getDemoRepairRequests(userId, schoolId || DEFAULT_SCHOOL);
  },
  async updateRepairRequest(id: string, data: Partial<RepairRequest>): Promise<RepairRequest> {
    return {
      id,
      type: data.type || 'other',
      title: data.title || '',
      description: data.description || '',
      status: data.status || 'pending',
      createdAt: new Date().toISOString(),
      room: data.room || '',
      userId: data.userId || 'mock',
      ...data,
    };
  },
  async cancelRepairRequest() {
    console.info('[MockSource] cancelRepairRequest 模擬成功');
  },

  // ===== 包裹 =====
  async confirmPackagePickup() {
    console.info('[MockSource] confirmPackagePickup 模擬成功');
  },

  // ===== 安全支付操作 =====
  async processTopup(data: { userId: string; amount: number; paymentMethod: string }) {
    await delay(1000);
    if (data.amount < 100) {
      return { success: false, errorCode: 'MIN_TOPUP_AMOUNT', errorMessage: '最低儲值金額為 $100' };
    }
    if (data.amount > 10000) {
      return { success: false, errorCode: 'MAX_TOPUP_AMOUNT', errorMessage: '單次儲值上限為 $10,000' };
    }
    return {
      success: true,
      newBalance: 1234 + data.amount,
      transactionId: `txn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    };
  },
  async processPayment(data: {
    userId: string;
    amount: number;
    paymentMethod: string;
    merchantId: string;
    description: string;
  }) {
    await delay(1000);
    const mockBalance = 1234;
    if (data.amount > mockBalance) {
      return { success: false, errorCode: 'INSUFFICIENT_BALANCE', errorMessage: '餘額不足' };
    }
    return {
      success: true,
      newBalance: mockBalance - data.amount,
      transactionId: `txn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    };
  },

  // ===== 宿舍進出管理 =====
  async createAccessApplication(data: any) {
    await delay(500);
    return { id: `access_${Date.now()}`, status: 'pending' as const };
  },
  async createLateReturnRecord(data: any) {
    await delay(300);
    return { id: `late_${Date.now()}` };
  },
  async createVisitorRecord(data: any) {
    await delay(500);
    return { id: `visitor_${Date.now()}` };
  },

};
