/* eslint-disable */
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
  LibraryBook,
  BusRoute,
  BusArrival,
} from "./types";
import { getAdapter, hasAdapter } from "./apiAdapters/AdapterRegistry";
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

export function configureHybridSource(newConfig: Partial<HybridSourceConfig>): void {
  config = { ...config, ...newConfig };
}

export function setHybridSourceSchoolContext(schoolId: string | null): void {
  currentSchoolContextId = schoolId;
}

const DEFAULT_SCHOOL = 'tw-pu';

function inferSchoolIdFromEntityId(id: string): string {
  if (!id) return DEFAULT_SCHOOL;
  const parts = id.split("-");
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return `${parts[0]}-${parts[1]}`;
  }
  return DEFAULT_SCHOOL;
}

function inferSchoolIdFromUserId(userId: string): string {
  // Accept school-prefixed user ids like "tw-nchu-xxxx".
  const inferred = inferSchoolIdFromEntityId(userId);
  return inferred;
}

function resolveSchoolId(explicitSchoolId?: string, idHint?: string): string {
  if (explicitSchoolId) return explicitSchoolId;
  if (currentSchoolContextId) return currentSchoolContextId;
  if (idHint) return inferSchoolIdFromEntityId(idHint);
  return DEFAULT_SCHOOL;
}

async function fetchWithFallback<T>(
  schoolId: string,
  apiMethod: string,
  mockMethod: () => Promise<T>,
  ...args: unknown[]
): Promise<T> {
  if (!config.preferRealApi || !hasAdapter(schoolId)) {
    return mockMethod();
  }
  
  try {
    const adapter = await getAdapter(schoolId);
    if (!adapter) {
      console.warn(`[HybridSource] No adapter for ${schoolId}, using mock`);
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
    
    if (config.fallbackToMock) {
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
  searchCourses: mockSource.searchCourses,
  listCourseSpaces: async (userId: string, schoolId?: string) => {
    return listWorkspaceCourseSpaces(userId, schoolId ?? currentSchoolContextId ?? undefined);
  },
  getCourseSpace: async (courseSpaceId: string, userId: string, schoolId?: string) => {
    return getWorkspaceCourseSpace(courseSpaceId, userId, schoolId ?? currentSchoolContextId ?? undefined);
  },
  listCourseModules: async (userId: string, courseSpaceId?: string, schoolId?: string) => {
    return listWorkspaceCourseModules(userId, courseSpaceId, schoolId ?? currentSchoolContextId ?? undefined);
  },
  createCourseModule: async (input) => {
    return createCourseSpaceModule(input);
  },
  listCourseMaterials: async (courseSpaceId: string, moduleId?: string) => {
    return listWorkspaceCourseMaterials(courseSpaceId, moduleId);
  },
  listQuizzes: async (userId: string, courseSpaceId?: string, schoolId?: string) => {
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
    return listWorkspaceAttendanceSessions(userId, courseSpaceId, schoolId ?? currentSchoolContextId ?? undefined);
  },
  startAttendanceSession: async (input) => {
    return startCourseAttendanceSession(input);
  },
  checkInAttendance: async (input) => {
    return checkInCourseAttendance(input);
  },
  getAttendanceSummary: async (courseSpaceId: string) => {
    return getCourseAttendanceSummary(courseSpaceId);
  },
  listInboxTasks: async (userId: string, schoolId?: string) => {
    return listWorkspaceInboxTasks(userId, schoolId ?? currentSchoolContextId ?? undefined);
  },
  getCourseGradebook: async (courseSpaceId: string) => {
    return getCourseGradebook(courseSpaceId);
  },
  
  listEnrollments: mockSource.listEnrollments,
  enrollCourse: mockSource.enrollCourse,
  dropCourse: mockSource.dropCourse,
  
  listGrades: async (userId: string, semester?: string): Promise<Grade[]> => {
    const schoolId = currentSchoolContextId ?? inferSchoolIdFromUserId(userId);
    if (schoolId === "default") {
      return mockSource.listGrades(userId, semester);
    }
    return fetchWithFallback(
      schoolId,
      "listGrades",
      () => mockSource.listGrades(userId, semester),
      userId,
      semester
    );
  },
  getGPA: mockSource.getGPA,
  
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
  getBook: mockSource.getBook,
  listLoans: mockSource.listLoans,
  borrowBook: mockSource.borrowBook,
  returnBook: mockSource.returnBook,
  renewBook: mockSource.renewBook,
  
  listSeats: mockSource.listSeats,
  listSeatReservations: mockSource.listSeatReservations,
  reserveSeat: mockSource.reserveSeat,
  cancelSeatReservation: mockSource.cancelSeatReservation,
  
  listBusRoutes: async (schoolId?: string): Promise<BusRoute[]> => {
    const sid = resolveSchoolId(schoolId);
    return fetchWithFallback(
      sid,
      "listBusRoutes",
      () => mockSource.listBusRoutes(schoolId)
    );
  },
  getBusRoute: mockSource.getBusRoute,
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
  
  listOrders: mockSource.listOrders,
  getOrder: mockSource.getOrder,
  createOrder: mockSource.createOrder,
  updateOrderStatus: mockSource.updateOrderStatus,
  cancelOrder: mockSource.cancelOrder,
  listTransactions: mockSource.listTransactions,
  processTopup: mockSource.processTopup,
  processPayment: mockSource.processPayment,
  
  listAchievements: firebaseSource.listAchievements,
  getUserAchievements: firebaseSource.getUserAchievements,
  updateAchievementProgress: firebaseSource.updateAchievementProgress,
  listPoiReviews: firebaseSource.listPoiReviews,
  listPoiCrowdReports: firebaseSource.listPoiCrowdReports,
  submitPoiReview: firebaseSource.submitPoiReview,
  submitPoiCrowdReport: firebaseSource.submitPoiCrowdReport,
  togglePoiReviewHelpful: firebaseSource.togglePoiReviewHelpful,
  submitPoiReport: firebaseSource.submitPoiReport,
  
  getDormitoryInfo: mockSource.getDormitoryInfo,
  listRepairRequests: mockSource.listRepairRequests,
  createRepairRequest: mockSource.createRepairRequest,
  updateRepairRequest: mockSource.updateRepairRequest,
  cancelRepairRequest: mockSource.cancelRepairRequest,
  listDormPackages: mockSource.listDormPackages,
  confirmPackagePickup: mockSource.confirmPackagePickup,
  listWashingMachines: mockSource.listWashingMachines,
  listWashingReservations: mockSource.listWashingReservations,
  reserveWashingMachine: mockSource.reserveWashingMachine,
  cancelWashingReservation: mockSource.cancelWashingReservation,
  listDormAnnouncements: mockSource.listDormAnnouncements,
  
  listPrinters: mockSource.listPrinters,
  getPrinter: mockSource.getPrinter,
  listPrintJobs: mockSource.listPrintJobs,
  createPrintJob: mockSource.createPrintJob,
  cancelPrintJob: mockSource.cancelPrintJob,
  
  listHealthAppointments: mockSource.listHealthAppointments,
  createHealthAppointment: mockSource.createHealthAppointment,
  cancelHealthAppointment: mockSource.cancelHealthAppointment,
  rescheduleHealthAppointment: mockSource.rescheduleHealthAppointment,
  listHealthRecords: mockSource.listHealthRecords,
  listHealthTimeSlots: mockSource.listHealthTimeSlots,
  
  createAccessApplication: mockSource.createAccessApplication,
  createLateReturnRecord: mockSource.createLateReturnRecord,
  createVisitorRecord: mockSource.createVisitorRecord,
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
