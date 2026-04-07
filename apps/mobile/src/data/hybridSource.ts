/* eslint-disable */
import { PROVIDENCE_UNIVERSITY_SCHOOL_ID } from "@campus/shared/src";
import type { DataSource } from "./source";
import type {
  Announcement,
  Cafeteria,
  ClubEvent,
  MenuItem,
  Poi,
  Course,
  QueryOptions,
  Grade,
  Enrollment,
  LibraryBook,
  BusRoute,
  BusArrival,
  Order,
} from "./types";
import { getAdapter, hasAdapter } from "./apiAdapters/AdapterRegistry";
import { PUAdapter } from "./apiAdapters/PUAdapter";
import {
  checkInAttendance as checkInCourseAttendance,
  createCourseModule as createCourseSpaceModule,
  createQuiz as createCourseSpaceQuiz,
  getAttendanceSummary as getCourseAttendanceSummary,
  getCourseGradebook,
  getCourseSpace as getWorkspaceCourseSpace,
  getQuiz as getWorkspaceQuiz,
  listAttendanceSessions as listWorkspaceAttendanceSessions,
  listCourseMaterials as listWorkspaceCourseMaterials,
  listCourseModules as listWorkspaceCourseModules,
  listCourseSpaces as listWorkspaceCourseSpaces,
  listInboxTasks as listWorkspaceInboxTasks,
  listQuizzes as listWorkspaceQuizzes,
  startAttendanceSession as startCourseAttendanceSession,
  submitQuiz as submitCourseSpaceQuiz,
} from "./courseSpaceSource";
import { firebaseSource } from "./firebaseSource";
import { mockSource } from "./mockSource";
import {
  isProvidenceSchoolId,
  toInternalSchoolId,
  toPublicSchoolId,
} from "./schoolIds";

/**
 * 嘗試取得 PUAdapter 實例（用於 TronClass 資料）。
 * 如果不是 PU 學校或沒有 adapter 則回傳 null。
 */
async function getPUAdapterIfAvailable(schoolId?: string | null): Promise<PUAdapter | null> {
  const sid = toInternalSchoolId(schoolId ?? currentSchoolContextId ?? DEFAULT_SCHOOL);
  if (sid !== "tw-pu" || !hasAdapter(sid)) return null;
  try {
    const adapter = await getAdapter(sid);
    if (adapter instanceof PUAdapter) return adapter;
  } catch { /* ignore */ }
  return null;
}

async function listProvidenceEnrollments(
  userId: string,
  semester?: string,
  schoolId?: string,
): Promise<Enrollment[] | null> {
  const puAdapter = await getPUAdapterIfAvailable(schoolId);
  if (!puAdapter) return null;

  const courses = await puAdapter.listCourses(userId, semester);
  const timestamp = new Date().toISOString();

  return courses.map((course, index) => ({
    id: `pu-enr-${course.id}-${index}`,
    userId,
    courseId: course.id,
    semester: course.semester ?? semester ?? "未指定",
    schoolId: PROVIDENCE_UNIVERSITY_SCHOOL_ID,
    status: "enrolled",
    createdAt: timestamp,
    enrolledAt: timestamp,
  }));
}

export type HybridSourceConfig = {
  preferRealApi: boolean;
  fallbackToMock: boolean;
  cacheRealApiResults: boolean;
  realApiTimeout: number;
};

const defaultConfig: HybridSourceConfig = {
  preferRealApi: true,
  fallbackToMock: true,
  cacheRealApiResults: true,
  realApiTimeout: 10000,
};

let config = { ...defaultConfig };
let currentSchoolContextId: string | null = null;
const PROVIDENCE_NO_MOCK_FALLBACK_METHODS = new Set([
  "listAnnouncements",
  "listCourses",
  "listGrades",
]);

export function configureHybridSource(newConfig: Partial<HybridSourceConfig>): void {
  config = { ...config, ...newConfig };
}

export function setHybridSourceSchoolContext(schoolId: string | null): void {
  currentSchoolContextId = toPublicSchoolId(schoolId);
}

const DEFAULT_SCHOOL = PROVIDENCE_UNIVERSITY_SCHOOL_ID;

function inferSchoolIdFromEntityId(id: string): string {
  if (!id) return DEFAULT_SCHOOL;
  if (id.startsWith("pu-") || id.startsWith("tc-") || id.startsWith("tw-pu")) {
    return PROVIDENCE_UNIVERSITY_SCHOOL_ID;
  }
  const parts = id.split("-");
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return toPublicSchoolId(`${parts[0]}-${parts[1]}`) ?? `${parts[0]}-${parts[1]}`;
  }
  return DEFAULT_SCHOOL;
}

function inferSchoolIdFromUserId(userId: string): string {
  if (userId.startsWith("pu-")) return PROVIDENCE_UNIVERSITY_SCHOOL_ID;
  // Accept school-prefixed user ids like "tw-nchu-xxxx".
  const inferred = inferSchoolIdFromEntityId(userId);
  return inferred;
}

function resolveSchoolId(explicitSchoolId?: string, idHint?: string): string {
  if (explicitSchoolId) return toPublicSchoolId(explicitSchoolId) ?? explicitSchoolId;
  if (currentSchoolContextId) return toPublicSchoolId(currentSchoolContextId) ?? currentSchoolContextId;
  if (idHint) return inferSchoolIdFromEntityId(idHint);
  return DEFAULT_SCHOOL;
}

async function fetchWithFallback<T>(
  schoolId: string,
  apiMethod: string,
  mockMethod: () => Promise<T>,
  ...args: unknown[]
): Promise<T> {
  const publicSchoolId = toPublicSchoolId(schoolId) ?? schoolId;
  const adapterSchoolId = toInternalSchoolId(publicSchoolId) ?? publicSchoolId;
  const disableMockFallback =
    isProvidenceSchoolId(publicSchoolId) &&
    PROVIDENCE_NO_MOCK_FALLBACK_METHODS.has(apiMethod);

  if (!config.preferRealApi || !hasAdapter(adapterSchoolId)) {
    if (disableMockFallback) {
      throw new Error(`Providence adapter unavailable for ${apiMethod}`);
    }
    return mockMethod();
  }
  
  try {
    const adapter = await getAdapter(adapterSchoolId);
    if (!adapter) {
      console.warn(`[HybridSource] No adapter for ${adapterSchoolId}, using mock`);
      if (disableMockFallback) {
        throw new Error(`Providence adapter unavailable for ${apiMethod}`);
      }
      return mockMethod();
    }
    
    const method = (adapter as any)[apiMethod];
    if (typeof method !== "function") {
      console.warn(`[HybridSource] Adapter doesn't support ${apiMethod}, using mock`);
      return mockMethod();
    }
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("API timeout")), config.realApiTimeout);
    });
    
    const result = await Promise.race([
      method.apply(adapter, args),
      timeoutPromise,
    ]);
    
    return result as T;
    
  } catch (error) {
    console.warn(`[HybridSource] API error for ${apiMethod}:`, error);
    
    if (config.fallbackToMock && !disableMockFallback) {
      console.info(`[HybridSource] Falling back to mock data for ${apiMethod}`);
      return mockMethod();
    }
    
    throw error;
  }
}

export const hybridSource: DataSource = {
  listAnnouncements: async (schoolId?: string, options?: QueryOptions): Promise<Announcement[]> => {
    const sid = resolveSchoolId(schoolId);
    return fetchWithFallback(
      sid,
      "listAnnouncements",
      () => mockSource.listAnnouncements(schoolId, options)
    );
  },
  
  getAnnouncement: async (id: string): Promise<Announcement | null> => {
    const schoolId = resolveSchoolId(undefined, id);
    return fetchWithFallback(
      schoolId,
      "getAnnouncement",
      () => mockSource.getAnnouncement(id),
      id
    );
  },
  
  listEvents: async (schoolId?: string, options?: QueryOptions): Promise<ClubEvent[]> => {
    const sid = resolveSchoolId(schoolId);
    return fetchWithFallback(
      sid,
      "listEvents",
      () => mockSource.listEvents(schoolId, options)
    );
  },
  
  getEvent: async (id: string): Promise<ClubEvent | null> => {
    const schoolId = resolveSchoolId(undefined, id);
    return fetchWithFallback(
      schoolId,
      "getEvent",
      () => mockSource.getEvent(id),
      id
    );
  },
  
  registerEvent: async (eventId: string, userId: string, schoolId?: string): Promise<void> => {
    return firebaseSource.registerEvent(eventId, userId, schoolId ?? currentSchoolContextId ?? undefined);
  },
  
  unregisterEvent: async (eventId: string, userId: string, schoolId?: string): Promise<void> => {
    return firebaseSource.unregisterEvent(eventId, userId, schoolId ?? currentSchoolContextId ?? undefined);
  },
  
  listPois: async (schoolId?: string, options?: QueryOptions): Promise<Poi[]> => {
    const sid = resolveSchoolId(schoolId);
    return fetchWithFallback(
      sid,
      "listPois",
      () => mockSource.listPois(schoolId, options)
    );
  },
  
  getPoi: async (id: string): Promise<Poi | null> => {
    const schoolId = resolveSchoolId(undefined, id);
    return fetchWithFallback(
      schoolId,
      "getPoi",
      () => mockSource.getPoi(id),
      id
    );
  },

  listCafeterias: async (schoolId?: string, options?: QueryOptions): Promise<Cafeteria[]> => {
    try {
      return await firebaseSource.listCafeterias(schoolId ?? currentSchoolContextId ?? undefined, options);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock cafeterias:", error);
      return mockSource.listCafeterias(schoolId, options);
    }
  },
  
  listMenus: async (schoolId?: string, options?: QueryOptions): Promise<MenuItem[]> => {
    const sid = resolveSchoolId(schoolId);
    return fetchWithFallback(
      sid,
      "listMenu",
      () => mockSource.listMenus(schoolId, options)
    );
  },
  
  getMenuItem: async (id: string): Promise<MenuItem | null> => {
    const schoolId = resolveSchoolId(undefined, id);
    return fetchWithFallback(
      schoolId,
      "getMenuItem",
      () => mockSource.getMenuItem(id),
      id
    );
  },
  
  rateMenuItem: async (id: string, userId: string, rating: number): Promise<void> => {
    return firebaseSource.rateMenuItem(id, userId, rating);
  },
  
  getUser: firebaseSource.getUser,
  updateUser: firebaseSource.updateUser,
  getUserByEmail: firebaseSource.getUserByEmail,
  
  listCourses: async (schoolId?: string, options?: QueryOptions): Promise<Course[]> => {
    const sid = resolveSchoolId(schoolId);
    return fetchWithFallback(
      sid,
      "listCourses",
      () => mockSource.listCourses(schoolId, options)
    );
  },
  
  getCourse: async (id: string): Promise<Course | null> => {
    const schoolId = resolveSchoolId(undefined, id);
    return fetchWithFallback(
      schoolId,
      "getCourse",
      () => mockSource.getCourse(id),
      id
    );
  },
  searchCourses: async (searchQuery: string, schoolId?: string) => {
    const sid = resolveSchoolId(schoolId);
    try {
      return await firebaseSource.searchCourses(searchQuery, sid);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock searchCourses:", error);
      return mockSource.searchCourses(searchQuery, schoolId);
    }
  },
  listCourseSpaces: async (userId: string, schoolId?: string) => {
    // 優先用 PUAdapter（TronClass 資料）
    const puAdapter = await getPUAdapterIfAvailable(schoolId);
    if (puAdapter) {
      try {
        return await puAdapter.listCourseSpaces(userId, schoolId);
      } catch (error) {
        console.warn("[HybridSource] PUAdapter.listCourseSpaces failed, falling back to Firebase:", error);
      }
    }
    return listWorkspaceCourseSpaces(userId, schoolId ?? currentSchoolContextId ?? undefined);
  },
  getCourseSpace: async (courseSpaceId: string, userId: string, schoolId?: string) => {
    const puAdapter = await getPUAdapterIfAvailable(schoolId);
    if (puAdapter && courseSpaceId.startsWith("tc-")) {
      try {
        return await puAdapter.getCourseSpace(courseSpaceId, userId);
      } catch (error) {
        console.warn("[HybridSource] PUAdapter.getCourseSpace failed, falling back to Firebase:", error);
      }
    }
    return getWorkspaceCourseSpace(courseSpaceId, userId, schoolId ?? currentSchoolContextId ?? undefined);
  },
  listCourseModules: async (userId: string, courseSpaceId?: string, schoolId?: string) => {
    const puAdapter = await getPUAdapterIfAvailable(schoolId);
    if (puAdapter && (!courseSpaceId || courseSpaceId.startsWith("tc-"))) {
      try {
        return await puAdapter.listCourseModules(userId, courseSpaceId);
      } catch (error) {
        console.warn("[HybridSource] PUAdapter.listCourseModules failed, falling back to Firebase:", error);
      }
    }
    return listWorkspaceCourseModules(userId, courseSpaceId, schoolId ?? currentSchoolContextId ?? undefined);
  },
  createCourseModule: async (input) => {
    return createCourseSpaceModule(input);
  },
  listCourseMaterials: async (courseSpaceId: string, moduleId?: string) => {
    // TronClass materials are embedded in modules, not separate
    return listWorkspaceCourseMaterials(courseSpaceId, moduleId);
  },
  listQuizzes: async (userId: string, courseSpaceId?: string, schoolId?: string) => {
    const puAdapter = await getPUAdapterIfAvailable(schoolId);
    if (puAdapter) {
      try {
        return await puAdapter.listQuizzes(userId, courseSpaceId);
      } catch (error) {
        console.warn("[HybridSource] PUAdapter.listQuizzes failed, falling back to Firebase:", error);
      }
    }
    return listWorkspaceQuizzes(userId, courseSpaceId, schoolId ?? currentSchoolContextId ?? undefined);
  },
  getQuiz: async (quizId: string, userId: string, courseSpaceId?: string, schoolId?: string) => {
    return getWorkspaceQuiz(quizId, userId, courseSpaceId, schoolId ?? currentSchoolContextId ?? undefined);
  },
  createQuiz: async (input) => {
    return createCourseSpaceQuiz(input);
  },
  submitQuiz: async (input) => {
    return submitCourseSpaceQuiz(input);
  },
  listAttendanceSessions: async (userId: string, courseSpaceId?: string, schoolId?: string) => {
    const puAdapter = await getPUAdapterIfAvailable(schoolId);
    if (puAdapter) {
      try {
        return await puAdapter.listAttendanceSessions(userId, courseSpaceId);
      } catch (error) {
        console.warn("[HybridSource] PUAdapter.listAttendanceSessions failed, falling back to Firebase:", error);
      }
    }
    return listWorkspaceAttendanceSessions(userId, courseSpaceId, schoolId ?? currentSchoolContextId ?? undefined);
  },
  startAttendanceSession: async (input) => {
    return startCourseAttendanceSession(input);
  },
  checkInAttendance: async (input) => {
    return checkInCourseAttendance(input);
  },
  getAttendanceSummary: async (courseSpaceId: string) => {
    const puAdapter = await getPUAdapterIfAvailable();
    if (puAdapter && courseSpaceId.startsWith("tc-")) {
      try {
        return await puAdapter.getAttendanceSummary(courseSpaceId);
      } catch (error) {
        console.warn("[HybridSource] PUAdapter.getAttendanceSummary failed, falling back to Firebase:", error);
      }
    }
    return getCourseAttendanceSummary(courseSpaceId);
  },
  listInboxTasks: async (userId: string, schoolId?: string) => {
    const puAdapter = await getPUAdapterIfAvailable(schoolId);
    if (puAdapter) {
      try {
        return await puAdapter.listInboxTasks(userId);
      } catch (error) {
        console.warn("[HybridSource] PUAdapter.listInboxTasks failed, falling back to Firebase:", error);
      }
    }
    return listWorkspaceInboxTasks(userId, schoolId ?? currentSchoolContextId ?? undefined);
  },
  getCourseGradebook: async (courseSpaceId: string) => {
    return getCourseGradebook(courseSpaceId);
  },
  
  listEnrollments: async (userId: string, semester?: string, schoolId?: string) => {
    const puEnrollments = await listProvidenceEnrollments(userId, semester, schoolId);
    if (puEnrollments) {
      return puEnrollments;
    }

    try {
      return await firebaseSource.listEnrollments(userId, semester, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock enrollments:", error);
      return mockSource.listEnrollments(userId, semester, schoolId);
    }
  },
  enrollCourse: async (userId: string, courseId: string, semester?: string, schoolId?: string) => {
    try {
      return await firebaseSource.enrollCourse(userId, courseId, semester, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock enrollCourse:", error);
      return mockSource.enrollCourse(userId, courseId, semester, schoolId);
    }
  },
  dropCourse: async (enrollmentId: string, userId?: string, schoolId?: string) => {
    try {
      return await firebaseSource.dropCourse(enrollmentId, userId, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock dropCourse:", error);
      return mockSource.dropCourse(enrollmentId, userId, schoolId);
    }
  },
  
  listGrades: async (userId: string, semester?: string, schoolId?: string): Promise<Grade[]> => {
    const resolvedSchoolId = resolveSchoolId(schoolId, userId || undefined) || inferSchoolIdFromUserId(userId);
    if (resolvedSchoolId === "default") {
      return mockSource.listGrades(userId, semester);
    }
    return fetchWithFallback(
      resolvedSchoolId,
      "listGrades",
      () => mockSource.listGrades(userId, semester),
      userId,
      semester
    );
  },
  getGPA: async (userId: string, schoolId?: string) => {
    // 優先用 PUAdapter 計算真實 GPA
    const puAdapter = await getPUAdapterIfAvailable();
    if (puAdapter) {
      try {
        const result = await puAdapter.getGPA(userId);
        if (result.totalCredits > 0) return result;
      } catch { /* fallback */ }
    }
    try {
      return await firebaseSource.getGPA(userId, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock getGPA:", error);
      return mockSource.getGPA(userId, schoolId);
    }
  },
  
  listGroups: firebaseSource.listGroups,
  getGroup: firebaseSource.getGroup,
  createGroup: firebaseSource.createGroup,
  updateGroup: firebaseSource.updateGroup,
  deleteGroup: firebaseSource.deleteGroup,
  joinGroup: firebaseSource.joinGroup,
  leaveGroup: firebaseSource.leaveGroup,
  
  listGroupMembers: firebaseSource.listGroupMembers,
  updateMemberRole: firebaseSource.updateMemberRole,
  removeMember: firebaseSource.removeMember,
  
  listGroupPosts: firebaseSource.listGroupPosts,
  getGroupPost: firebaseSource.getGroupPost,
  createGroupPost: firebaseSource.createGroupPost,
  updateGroupPost: firebaseSource.updateGroupPost,
  deleteGroupPost: firebaseSource.deleteGroupPost,
  likePost: firebaseSource.likePost,
  unlikePost: firebaseSource.unlikePost,
  
  listComments: firebaseSource.listComments,
  createComment: firebaseSource.createComment,
  deleteComment: firebaseSource.deleteComment,
  
  listAssignments: firebaseSource.listAssignments,
  getAssignment: firebaseSource.getAssignment,
  createAssignment: firebaseSource.createAssignment,
  updateAssignment: firebaseSource.updateAssignment,
  deleteAssignment: firebaseSource.deleteAssignment,
  
  listSubmissions: firebaseSource.listSubmissions,
  getSubmission: firebaseSource.getSubmission,
  submitAssignment: firebaseSource.submitAssignment,
  gradeSubmission: firebaseSource.gradeSubmission,
  
  listConversations: firebaseSource.listConversations,
  getConversation: firebaseSource.getConversation,
  createConversation: firebaseSource.createConversation,
  listMessages: firebaseSource.listMessages,
  sendMessage: firebaseSource.sendMessage,
  markMessageRead: firebaseSource.markMessageRead,
  
  listLostFoundItems: firebaseSource.listLostFoundItems,
  getLostFoundItem: firebaseSource.getLostFoundItem,
  createLostFoundItem: firebaseSource.createLostFoundItem,
  updateLostFoundItem: firebaseSource.updateLostFoundItem,
  resolveLostFoundItem: firebaseSource.resolveLostFoundItem,
  
  searchBooks: async (
    query: string,
    schoolId?: string,
    options?: QueryOptions
  ): Promise<LibraryBook[]> => {
    const sid = resolveSchoolId(schoolId);
    return fetchWithFallback(
      sid,
      "searchLibraryBooks",
      () => mockSource.searchBooks(query, schoolId, options),
      query
    );
  },
  getBook: async (id: string) => {
    try {
      return await firebaseSource.getBook(id);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock getBook:", error);
      return mockSource.getBook(id);
    }
  },
  listLoans: async (userId: string, schoolId?: string) => {
    try {
      return await firebaseSource.listLoans(userId, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock listLoans:", error);
      return mockSource.listLoans(userId, schoolId);
    }
  },
  borrowBook: async (bookId: string, userId: string, schoolId?: string) => {
    try {
      return await firebaseSource.borrowBook(bookId, userId, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock borrowBook:", error);
      return mockSource.borrowBook(bookId, userId, schoolId);
    }
  },
  returnBook: async (loanId: string, userId?: string, schoolId?: string) => {
    try {
      return await firebaseSource.returnBook(loanId, userId, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock returnBook:", error);
      return mockSource.returnBook(loanId, userId, schoolId);
    }
  },
  renewBook: async (loanId: string, userId?: string, schoolId?: string) => {
    try {
      return await firebaseSource.renewBook(loanId, userId, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock renewBook:", error);
      return mockSource.renewBook(loanId, userId, schoolId);
    }
  },

  listSeats: async (schoolId?: string, zone?: string) => {
    try {
      return await firebaseSource.listSeats(schoolId ?? currentSchoolContextId ?? undefined, zone);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock listSeats:", error);
      return mockSource.listSeats(schoolId, zone);
    }
  },
  listSeatReservations: async (userId: string, schoolId?: string) => {
    try {
      return await firebaseSource.listSeatReservations(userId, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock listSeatReservations:", error);
      return mockSource.listSeatReservations(userId, schoolId);
    }
  },
  reserveSeat: async (seatId: string, userId: string, date: string, startTime: string, endTime: string, schoolId?: string) => {
    try {
      return await firebaseSource.reserveSeat(seatId, userId, date, startTime, endTime, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock reserveSeat:", error);
      return mockSource.reserveSeat(seatId, userId, date, startTime, endTime, schoolId);
    }
  },
  cancelSeatReservation: async (id: string, userId?: string, schoolId?: string) => {
    try {
      return await firebaseSource.cancelSeatReservation(id, userId, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock cancelSeatReservation:", error);
      return mockSource.cancelSeatReservation(id, userId, schoolId);
    }
  },
  
  listBusRoutes: async (schoolId?: string): Promise<BusRoute[]> => {
    const sid = resolveSchoolId(schoolId);
    return fetchWithFallback(
      sid,
      "listBusRoutes",
      () => mockSource.listBusRoutes(schoolId)
    );
  },
  getBusRoute: async (id: string) => {
    try {
      return await firebaseSource.getBusRoute(id);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock getBusRoute:", error);
      return mockSource.getBusRoute(id);
    }
  },
  getBusArrivals: async (stopId: string): Promise<BusArrival[]> => {
    const schoolId = resolveSchoolId(undefined, stopId);
    return fetchWithFallback(
      schoolId,
      "getBusArrivals",
      () => mockSource.getBusArrivals(stopId),
      stopId
    );
  },
  
  listNotifications: firebaseSource.listNotifications,
  markNotificationRead: firebaseSource.markNotificationRead,
  markAllNotificationsRead: firebaseSource.markAllNotificationsRead,
  deleteNotification: firebaseSource.deleteNotification,
  
  listCalendarEvents: firebaseSource.listCalendarEvents,
  createCalendarEvent: firebaseSource.createCalendarEvent,
  updateCalendarEvent: firebaseSource.updateCalendarEvent,
  deleteCalendarEvent: firebaseSource.deleteCalendarEvent,
  syncCoursesToCalendar: firebaseSource.syncCoursesToCalendar,
  
  listOrders: async (userId: string, options?: QueryOptions, schoolId?: string) => {
    try {
      return await firebaseSource.listOrders(userId, options, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock listOrders:", error);
      return mockSource.listOrders(userId, options, schoolId);
    }
  },
  getOrder: async (id: string, userId?: string, schoolId?: string) => {
    try {
      return await firebaseSource.getOrder(id, userId, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock getOrder:", error);
      return mockSource.getOrder(id, userId, schoolId);
    }
  },
  createOrder: async (data: any) => {
    try {
      return await firebaseSource.createOrder(data);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock createOrder:", error);
      return mockSource.createOrder(data);
    }
  },
  updateOrderStatus: async (id: string, status: Order["status"], userId?: string, schoolId?: string) => {
    try {
      return await firebaseSource.updateOrderStatus(id, status, userId, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock updateOrderStatus:", error);
      return mockSource.updateOrderStatus(id, status, userId, schoolId);
    }
  },
  cancelOrder: async (id: string, userId?: string, schoolId?: string) => {
    try {
      return await firebaseSource.cancelOrder(id, userId, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock cancelOrder:", error);
      return mockSource.cancelOrder(id, userId, schoolId);
    }
  },
  listTransactions: async (userId: string, options?: QueryOptions, schoolId?: string) => {
    try {
      return await firebaseSource.listTransactions(userId, options, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock listTransactions:", error);
      return mockSource.listTransactions(userId, options, schoolId);
    }
  },
  processTopup: async (data: { userId: string; amount: number; paymentMethod: string }) => {
    try {
      return await firebaseSource.processTopup(data);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock processTopup:", error);
      return mockSource.processTopup(data);
    }
  },
  processPayment: async (data: { userId: string; amount: number; paymentMethod: string; merchantId: string; description: string }) => {
    try {
      return await firebaseSource.processPayment(data);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock processPayment:", error);
      return mockSource.processPayment(data);
    }
  },
  
  listAchievements: firebaseSource.listAchievements,
  getUserAchievements: firebaseSource.getUserAchievements,
  updateAchievementProgress: firebaseSource.updateAchievementProgress,
  listPoiReviews: firebaseSource.listPoiReviews,
  listPoiCrowdReports: firebaseSource.listPoiCrowdReports,
  submitPoiReview: firebaseSource.submitPoiReview,
  submitPoiCrowdReport: firebaseSource.submitPoiCrowdReport,
  togglePoiReviewHelpful: firebaseSource.togglePoiReviewHelpful,
  submitPoiReport: firebaseSource.submitPoiReport,
  
  getDormitoryInfo: async (userId: string) => {
    try {
      return await firebaseSource.getDormitoryInfo(userId);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock getDormitoryInfo:", error);
      return mockSource.getDormitoryInfo(userId);
    }
  },
  listRepairRequests: async (userId: string, options?: QueryOptions, schoolId?: string) => {
    try {
      return await firebaseSource.listRepairRequests(userId, options, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock listRepairRequests:", error);
      return mockSource.listRepairRequests(userId, options, schoolId);
    }
  },
  createRepairRequest: async (data: any) => {
    try {
      return await firebaseSource.createRepairRequest(data);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock createRepairRequest:", error);
      return mockSource.createRepairRequest(data);
    }
  },
  updateRepairRequest: async (id: string, data: any) => {
    try {
      return await firebaseSource.updateRepairRequest(id, data);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock updateRepairRequest:", error);
      return mockSource.updateRepairRequest(id, data);
    }
  },
  cancelRepairRequest: async (id: string) => {
    try {
      return await firebaseSource.cancelRepairRequest(id);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock cancelRepairRequest:", error);
      return mockSource.cancelRepairRequest(id);
    }
  },
  listDormPackages: async (userId: string, options?: QueryOptions, schoolId?: string) => {
    try {
      return await firebaseSource.listDormPackages(userId, options, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock listDormPackages:", error);
      return mockSource.listDormPackages(userId, options, schoolId);
    }
  },
  confirmPackagePickup: async (id: string, schoolId?: string) => {
    try {
      return await firebaseSource.confirmPackagePickup(id, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock confirmPackagePickup:", error);
      return mockSource.confirmPackagePickup(id, schoolId);
    }
  },
  listWashingMachines: async (schoolId?: string, building?: string) => {
    try {
      return await firebaseSource.listWashingMachines(schoolId ?? currentSchoolContextId ?? undefined, building);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock listWashingMachines:", error);
      return mockSource.listWashingMachines(schoolId, building);
    }
  },
  listWashingReservations: async (userId: string, schoolId?: string) => {
    try {
      return await firebaseSource.listWashingReservations(userId, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock listWashingReservations:", error);
      return mockSource.listWashingReservations(userId, schoolId);
    }
  },
  reserveWashingMachine: async (machineId: string, userId: string, schoolId?: string) => {
    try {
      return await firebaseSource.reserveWashingMachine(machineId, userId, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock reserveWashingMachine:", error);
      return mockSource.reserveWashingMachine(machineId, userId, schoolId);
    }
  },
  cancelWashingReservation: async (id: string, schoolId?: string) => {
    try {
      return await firebaseSource.cancelWashingReservation(id, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock cancelWashingReservation:", error);
      return mockSource.cancelWashingReservation(id, schoolId);
    }
  },
  listDormAnnouncements: async (schoolId?: string, building?: string) => {
    try {
      return await firebaseSource.listDormAnnouncements(schoolId ?? currentSchoolContextId ?? undefined, building);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock listDormAnnouncements:", error);
      return mockSource.listDormAnnouncements(schoolId, building);
    }
  },

  listPrinters: async (schoolId?: string, options?: QueryOptions) => {
    try {
      return await firebaseSource.listPrinters(schoolId ?? currentSchoolContextId ?? undefined, options);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock listPrinters:", error);
      return mockSource.listPrinters(schoolId, options);
    }
  },
  getPrinter: async (id: string) => {
    try {
      return await firebaseSource.getPrinter(id);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock getPrinter:", error);
      return mockSource.getPrinter(id);
    }
  },
  listPrintJobs: async (userId: string, options?: QueryOptions, schoolId?: string) => {
    try {
      return await firebaseSource.listPrintJobs(userId, options, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock listPrintJobs:", error);
      return mockSource.listPrintJobs(userId, options, schoolId);
    }
  },
  createPrintJob: async (data: any) => {
    try {
      return await firebaseSource.createPrintJob(data);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock createPrintJob:", error);
      return mockSource.createPrintJob(data);
    }
  },
  cancelPrintJob: async (id: string, schoolId?: string) => {
    try {
      return await firebaseSource.cancelPrintJob(id, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock cancelPrintJob:", error);
      return mockSource.cancelPrintJob(id, schoolId);
    }
  },

  listHealthAppointments: async (userId: string, options?: QueryOptions, schoolId?: string) => {
    try {
      return await firebaseSource.listHealthAppointments(userId, options, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock listHealthAppointments:", error);
      return mockSource.listHealthAppointments(userId, options, schoolId);
    }
  },
  createHealthAppointment: async (data: any) => {
    try {
      return await firebaseSource.createHealthAppointment(data);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock createHealthAppointment:", error);
      return mockSource.createHealthAppointment(data);
    }
  },
  cancelHealthAppointment: async (id: string, schoolId?: string) => {
    try {
      return await firebaseSource.cancelHealthAppointment(id, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock cancelHealthAppointment:", error);
      return mockSource.cancelHealthAppointment(id, schoolId);
    }
  },
  rescheduleHealthAppointment: async (id: string, data: any, schoolId?: string) => {
    try {
      return await firebaseSource.rescheduleHealthAppointment(id, data, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock rescheduleHealthAppointment:", error);
      return mockSource.rescheduleHealthAppointment(id, data, schoolId);
    }
  },
  listHealthRecords: async (userId: string, options?: QueryOptions, schoolId?: string) => {
    try {
      return await firebaseSource.listHealthRecords(userId, options, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock listHealthRecords:", error);
      return mockSource.listHealthRecords(userId, options, schoolId);
    }
  },
  listHealthTimeSlots: async (departmentId: string, date: string, schoolId?: string) => {
    try {
      return await firebaseSource.listHealthTimeSlots(departmentId, date, schoolId ?? currentSchoolContextId ?? undefined);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock listHealthTimeSlots:", error);
      return mockSource.listHealthTimeSlots(departmentId, date, schoolId);
    }
  },

  createAccessApplication: async (data: any) => {
    try {
      return await firebaseSource.createAccessApplication(data);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock createAccessApplication:", error);
      return mockSource.createAccessApplication(data);
    }
  },
  createLateReturnRecord: async (data: any) => {
    try {
      return await firebaseSource.createLateReturnRecord(data);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock createLateReturnRecord:", error);
      return mockSource.createLateReturnRecord(data);
    }
  },
  createVisitorRecord: async (data: any) => {
    try {
      return await firebaseSource.createVisitorRecord(data);
    } catch (error) {
      console.warn("[HybridSource] Falling back to mock createVisitorRecord:", error);
      return mockSource.createVisitorRecord(data);
    }
  },
};

export function getHybridSourceStatus(): {
  preferRealApi: boolean;
  fallbackToMock: boolean;
  registeredSchools: string[];
  schoolContextId: string | null;
} {
  const { listRegisteredSchools } = require("./apiAdapters/AdapterRegistry");
  return {
    preferRealApi: config.preferRealApi,
    fallbackToMock: config.fallbackToMock,
    registeredSchools: listRegisteredSchools(),
    schoolContextId: currentSchoolContextId,
  };
}
