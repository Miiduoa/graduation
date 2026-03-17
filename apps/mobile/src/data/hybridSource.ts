import type { DataSource } from "./source";
import type {
  Announcement,
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

function inferSchoolIdFromEntityId(id: string): string {
  if (!id) return "default";
  const parts = id.split("-");
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return `${parts[0]}-${parts[1]}`;
  }
  return "default";
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
  return "default";
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
  
  registerEvent: async (eventId: string, userId: string): Promise<void> => {
    return mockSource.registerEvent(eventId, userId);
  },
  
  unregisterEvent: async (eventId: string, userId: string): Promise<void> => {
    return mockSource.unregisterEvent(eventId, userId);
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
    return mockSource.rateMenuItem(id, userId, rating);
  },
  
  getUser: mockSource.getUser,
  updateUser: mockSource.updateUser,
  getUserByEmail: mockSource.getUserByEmail,
  
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
  
  listGroups: mockSource.listGroups,
  getGroup: mockSource.getGroup,
  createGroup: mockSource.createGroup,
  updateGroup: mockSource.updateGroup,
  deleteGroup: mockSource.deleteGroup,
  joinGroup: mockSource.joinGroup,
  leaveGroup: mockSource.leaveGroup,
  
  listGroupMembers: mockSource.listGroupMembers,
  updateMemberRole: mockSource.updateMemberRole,
  removeMember: mockSource.removeMember,
  
  listGroupPosts: mockSource.listGroupPosts,
  getGroupPost: mockSource.getGroupPost,
  createGroupPost: mockSource.createGroupPost,
  updateGroupPost: mockSource.updateGroupPost,
  deleteGroupPost: mockSource.deleteGroupPost,
  likePost: mockSource.likePost,
  unlikePost: mockSource.unlikePost,
  
  listComments: mockSource.listComments,
  createComment: mockSource.createComment,
  deleteComment: mockSource.deleteComment,
  
  listAssignments: mockSource.listAssignments,
  getAssignment: mockSource.getAssignment,
  createAssignment: mockSource.createAssignment,
  updateAssignment: mockSource.updateAssignment,
  deleteAssignment: mockSource.deleteAssignment,
  
  listSubmissions: mockSource.listSubmissions,
  getSubmission: mockSource.getSubmission,
  submitAssignment: mockSource.submitAssignment,
  gradeSubmission: mockSource.gradeSubmission,
  
  listConversations: mockSource.listConversations,
  getConversation: mockSource.getConversation,
  createConversation: mockSource.createConversation,
  listMessages: mockSource.listMessages,
  sendMessage: mockSource.sendMessage,
  markMessageRead: mockSource.markMessageRead,
  
  listLostFoundItems: mockSource.listLostFoundItems,
  getLostFoundItem: mockSource.getLostFoundItem,
  createLostFoundItem: mockSource.createLostFoundItem,
  updateLostFoundItem: mockSource.updateLostFoundItem,
  resolveLostFoundItem: mockSource.resolveLostFoundItem,
  
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
  
  listNotifications: mockSource.listNotifications,
  markNotificationRead: mockSource.markNotificationRead,
  markAllNotificationsRead: mockSource.markAllNotificationsRead,
  deleteNotification: mockSource.deleteNotification,
  
  listCalendarEvents: mockSource.listCalendarEvents,
  createCalendarEvent: mockSource.createCalendarEvent,
  updateCalendarEvent: mockSource.updateCalendarEvent,
  deleteCalendarEvent: mockSource.deleteCalendarEvent,
  syncCoursesToCalendar: mockSource.syncCoursesToCalendar,
  
  listOrders: mockSource.listOrders,
  getOrder: mockSource.getOrder,
  createOrder: mockSource.createOrder,
  updateOrderStatus: mockSource.updateOrderStatus,
  cancelOrder: mockSource.cancelOrder,
  listTransactions: mockSource.listTransactions,
  processTopup: mockSource.processTopup,
  processPayment: mockSource.processPayment,
  
  listAchievements: mockSource.listAchievements,
  getUserAchievements: mockSource.getUserAchievements,
  updateAchievementProgress: mockSource.updateAchievementProgress,
  
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
