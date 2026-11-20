/* eslint-disable */
import { PROVIDENCE_UNIVERSITY_SCHOOL_ID } from '@campus/shared/src';
import type { DataSource } from './source';
import { assertOrderRequest } from './orderSource';
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
} from './types';
import { getAdapter, hasAdapter } from './apiAdapters/AdapterRegistry';
import { PUAdapter } from './apiAdapters/PUAdapter';
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
} from './courseSpaceSource';
import {
  listNextBestActions as listAgentNextBestActions,
  listPulseAggregates as listAgentPulseAggregates,
  listRiskSnapshots as listAgentRiskSnapshots,
  submitPulseReport as submitAgentPulseReport,
} from './campusAgentSource';
import { firebaseSource } from './firebaseSource';
import { mockSource } from './mockSource';
import { isProvidenceSchoolId, toInternalSchoolId, toPublicSchoolId } from './schoolIds';
import {
  fetchCafeteriaLocations,
  fetchCafeteriaMenu,
} from '../services/cafeteriaCatalog';
import type { CafeteriaCatalogMenuItem, CafeteriaCatalogRecord } from '@campus/shared/src/cafeteriaCatalog';

function toHybridCafeteria(row: CafeteriaCatalogRecord): Cafeteria {
  return {
    id: row.id,
    schoolId: row.schoolId,
    name: row.name,
    location: row.location,
    openingHours: row.openingHours,
    description: row.intro,
    sourceLabel: row.sourceLabel,
    sourceUrl: row.websiteUrl,
  };
}

function toHybridMenu(row: CafeteriaCatalogMenuItem): MenuItem {
  return {
    id: row.id,
    name: row.name,
    cafeteria: row.cafeteria,
    cafeteriaId: row.cafeteriaId,
    availableOn: row.availableOn,
    price: row.price,
    description: row.description,
    soldOut: row.soldOut,
    schoolId: row.schoolId,
  };
}

/**
 * 嘗試取得 PUAdapter 實例（用於 TronClass 資料）。
 * 如果不是 PU 學校或沒有 adapter 則回傳 null。
 */
async function getPUAdapterIfAvailable(schoolId?: string | null): Promise<PUAdapter | null> {
  const sid = toInternalSchoolId(resolveSchoolId(schoolId));
  if (sid !== 'tw-pu' || !hasAdapter(sid)) return null;
  try {
    const adapter = await getAdapter(sid);
    if (adapter instanceof PUAdapter) return adapter;
  } catch {
    /* ignore */
  }
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
    semester: course.semester ?? semester ?? '未指定',
    schoolId: PROVIDENCE_UNIVERSITY_SCHOOL_ID,
    status: 'enrolled',
    createdAt: timestamp,
    enrolledAt: timestamp,
  }));
}

export type HybridSourceConfig = {
  preferRealApi: boolean;
  fallbackToMock: boolean;
  enforceRealDataForCriticalDomains: boolean;
  cacheRealApiResults: boolean;
  realApiTimeout: number;
};

const defaultConfig: HybridSourceConfig = {
  preferRealApi: true,
  fallbackToMock: true,
  enforceRealDataForCriticalDomains: false,
  cacheRealApiResults: true,
  realApiTimeout: 10000,
};

let config = { ...defaultConfig };
let currentSchoolContextId: string | null = null;
const PROVIDENCE_NO_MOCK_FALLBACK_METHODS = new Set([
  'listAnnouncements',
  'listCourses',
  'listGrades',
]);
const CRITICAL_NO_MOCK_FALLBACK_METHODS = new Set([
  'listAnnouncements',
  'listCourses',
  'listGrades',
  'listEnrollments',
  'listAssignments',
  'listAttendanceSessions',
  'listInboxTasks',
  'listQuizzes',
]);
const EXPECTED_OPTIONAL_MOCK_FALLBACK_METHODS = new Set(['listBusRoutes']);

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { code?: unknown; originalError?: unknown };
  if (typeof record.code === 'string') return record.code;
  return getErrorCode(record.originalError);
}

function isPermissionDenied(error: unknown): boolean {
  if (getErrorCode(error) === 'permission-denied') return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Missing or insufficient permissions|permission-denied/i.test(message);
}

function logFallbackToMock(method: string, error: unknown): void {
  const logger = isPermissionDenied(error) ? console.debug : console.warn;
  logger(`[HybridSource] Falling back to mock ${method}:`, error);
}

function throwPermissionDeniedForPrivateData(method: string, error: unknown): void {
  if (!isPermissionDenied(error)) return;
  console.debug(`[HybridSource] ${method} permission denied; not using mock private data:`, error);
  throw error;
}

export function configureHybridSource(newConfig: Partial<HybridSourceConfig>): void {
  config = { ...config, ...newConfig };
}

export function setHybridSourceSchoolContext(schoolId: string | null): void {
  currentSchoolContextId = toPublicSchoolId(schoolId);
}

function resolveSchoolId(explicitSchoolId?: string | null): string {
  const id = toPublicSchoolId(explicitSchoolId === undefined ? currentSchoolContextId : explicitSchoolId);
  if (!id) throw new Error('請先選擇學校。');
  return id;
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
    isProvidenceSchoolId(publicSchoolId) && PROVIDENCE_NO_MOCK_FALLBACK_METHODS.has(apiMethod);
  const disableCriticalFallback =
    config.enforceRealDataForCriticalDomains && CRITICAL_NO_MOCK_FALLBACK_METHODS.has(apiMethod);
  const shouldDisableFallback = disableMockFallback || disableCriticalFallback;

  if (!config.preferRealApi || !hasAdapter(adapterSchoolId)) {
    if (shouldDisableFallback) {
      throw new Error(`Providence adapter unavailable for ${apiMethod}`);
    }
    return mockMethod();
  }

  try {
    const adapter = await getAdapter(adapterSchoolId);
    if (!adapter) {
      console.warn(`[HybridSource] No adapter for ${adapterSchoolId}, using mock`);
      if (shouldDisableFallback) {
        throw new Error(`Providence adapter unavailable for ${apiMethod}`);
      }
      return mockMethod();
    }

    const method = (adapter as any)[apiMethod];
    if (typeof method !== 'function') {
      const logger = EXPECTED_OPTIONAL_MOCK_FALLBACK_METHODS.has(apiMethod)
        ? console.debug
        : console.warn;
      logger(`[HybridSource] Adapter doesn't support ${apiMethod}, using mock`);
      return mockMethod();
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('API timeout')), config.realApiTimeout);
    });

    const result = await Promise.race([method.apply(adapter, args), timeoutPromise]);

    return result as T;
  } catch (error) {
    console.warn(`[HybridSource] API error for ${apiMethod}:`, error);

    if (config.fallbackToMock && !shouldDisableFallback) {
      console.info(`[HybridSource] Falling back to mock data for ${apiMethod}`);
      return mockMethod();
    }

    throw error;
  }
}

export const hybridSource: DataSource = {
  listAnnouncements: async (schoolId?: string, options?: QueryOptions): Promise<Announcement[]> => {
    const sid = resolveSchoolId(schoolId);
    return fetchWithFallback(sid, 'listAnnouncements', () =>
      mockSource.listAnnouncements(sid, options),
    );
  },

  getAnnouncement: async (id: string, schoolId?: string): Promise<Announcement | null> => {
    const sid = resolveSchoolId(schoolId);
    return fetchWithFallback(sid, 'getAnnouncement', () => mockSource.getAnnouncement(id, sid), id, sid);
  },

  listEvents: async (schoolId?: string, options?: QueryOptions): Promise<ClubEvent[]> => {
    const sid = resolveSchoolId(schoolId);
    return fetchWithFallback(sid, 'listEvents', () => mockSource.listEvents(sid, options));
  },

  getEvent: async (id: string): Promise<ClubEvent | null> => {
    const schoolId = resolveSchoolId();
    return fetchWithFallback(schoolId, 'getEvent', () => mockSource.getEvent(id), id);
  },

  registerEvent: async (eventId: string, userId: string, requestedSchoolId?: string): Promise<void> => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    return firebaseSource.registerEvent(
      eventId,
      userId,
      schoolId,
    );
  },

  unregisterEvent: async (eventId: string, userId: string, requestedSchoolId?: string): Promise<void> => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    return firebaseSource.unregisterEvent(
      eventId,
      userId,
      schoolId,
    );
  },

  listPois: async (schoolId?: string, options?: QueryOptions): Promise<Poi[]> => {
    const sid = resolveSchoolId(schoolId);
    return fetchWithFallback(sid, 'listPois', () => mockSource.listPois(sid, options));
  },

  getPoi: async (id: string): Promise<Poi | null> => {
    const schoolId = resolveSchoolId();
    return fetchWithFallback(schoolId, 'getPoi', () => mockSource.getPoi(id), id);
  },

  listCafeterias: async (schoolId?: string, options?: QueryOptions): Promise<Cafeteria[]> => {
    const sid = resolveSchoolId(schoolId);
    if (sid) {
      try {
        return (await fetchCafeteriaLocations(sid)).map(toHybridCafeteria);
      } catch {
        // Keep the existing Firebase path when the platform catalog is unavailable.
      }
    }
    try {
      return await firebaseSource.listCafeterias(sid, options);
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock cafeterias:', error);
      return mockSource.listCafeterias(sid, options);
    }
  },

  listMenus: async (schoolId?: string, options?: QueryOptions): Promise<MenuItem[]> => {
    const sid = resolveSchoolId(schoolId);
    if (sid) {
      try {
        const locations = await fetchCafeteriaLocations(sid);
        const menus = (
          await Promise.all(locations.slice(0, 40).map((row) => fetchCafeteriaMenu(sid, row)))
        ).flat();
        return menus.map(toHybridMenu);
      } catch {
        // Keep the existing Firebase path when the platform catalog is unavailable.
      }
    }
    return fetchWithFallback(sid, 'listMenu', () => mockSource.listMenus(sid, options));
  },

  getMenuItem: async (id: string): Promise<MenuItem | null> => {
    const schoolId = resolveSchoolId();
    return fetchWithFallback(schoolId, 'getMenuItem', () => mockSource.getMenuItem(id), id);
  },

  rateMenuItem: async (id: string, userId: string, rating: number): Promise<void> => {
    return firebaseSource.rateMenuItem(id, userId, rating);
  },

  getUser: firebaseSource.getUser,
  updateUser: firebaseSource.updateUser,
  getUserByEmail: firebaseSource.getUserByEmail,

  listCourses: async (schoolId?: string, options?: QueryOptions): Promise<Course[]> => {
    const sid = resolveSchoolId(schoolId);
    return fetchWithFallback(sid, 'listCourses', () => mockSource.listCourses(sid, options));
  },

  getCourse: async (id: string, schoolId?: string): Promise<Course | null> => {
    const sid = resolveSchoolId(schoolId);
    const course = await fetchWithFallback(
      sid, 'getCourse', () => mockSource.getCourse(id, sid), id, sid,
    );
    return course && (!course.schoolId || toPublicSchoolId(course.schoolId) === sid) ? course : null;
  },
  searchCourses: async (searchQuery: string, schoolId?: string) => {
    const sid = resolveSchoolId(schoolId);
    try {
      return await firebaseSource.searchCourses(searchQuery, sid);
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock searchCourses:', error);
      return mockSource.searchCourses(searchQuery, sid);
    }
  },
  listCourseSpaces: async (userId: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    // 優先用 PUAdapter（TronClass 資料）
    const puAdapter = await getPUAdapterIfAvailable(schoolId);
    if (puAdapter) {
      return puAdapter.listCourseSpaces(userId, schoolId);
    }
    return listWorkspaceCourseSpaces(userId, schoolId);
  },
  getCourseSpace: async (courseSpaceId: string, userId: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    const puAdapter = await getPUAdapterIfAvailable(schoolId);
    if (puAdapter && courseSpaceId.startsWith('tc-')) {
      return puAdapter.getCourseSpace(courseSpaceId, userId);
    }
    return getWorkspaceCourseSpace(
      courseSpaceId,
      userId,
      schoolId,
    );
  },
  listCourseModules: async (userId: string, courseSpaceId?: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    const puAdapter = await getPUAdapterIfAvailable(schoolId);
    if (puAdapter && (!courseSpaceId || courseSpaceId.startsWith('tc-'))) {
      return puAdapter.listCourseModules(userId, courseSpaceId);
    }
    return listWorkspaceCourseModules(
      userId,
      courseSpaceId,
      schoolId,
    );
  },
  createCourseModule: async (input) => {
    return createCourseSpaceModule(input);
  },
  listCourseMaterials: async (courseSpaceId: string, moduleId?: string) => {
    // TronClass materials are embedded in modules, not separate
    return listWorkspaceCourseMaterials(courseSpaceId, moduleId);
  },
  listQuizzes: async (userId: string, courseSpaceId?: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    const puAdapter = await getPUAdapterIfAvailable(schoolId);
    if (puAdapter) {
      return puAdapter.listQuizzes(userId, courseSpaceId);
    }
    return listWorkspaceQuizzes(
      userId,
      courseSpaceId,
      schoolId,
    );
  },
  getQuiz: async (quizId: string, userId: string, courseSpaceId?: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    return getWorkspaceQuiz(
      quizId,
      userId,
      courseSpaceId,
      schoolId,
    );
  },
  createQuiz: async (input) => {
    return createCourseSpaceQuiz(input);
  },
  submitQuiz: async (input) => {
    return submitCourseSpaceQuiz(input);
  },
  listAttendanceSessions: async (userId: string, courseSpaceId?: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    const puAdapter = await getPUAdapterIfAvailable(schoolId);
    if (puAdapter) {
      return puAdapter.listAttendanceSessions(userId, courseSpaceId);
    }
    return listWorkspaceAttendanceSessions(
      userId,
      courseSpaceId,
      schoolId,
    );
  },
  startAttendanceSession: async (input) => {
    return startCourseAttendanceSession(input);
  },
  checkInAttendance: async (input) => {
    return checkInCourseAttendance(input);
  },
  getAttendanceSummary: async (courseSpaceId: string) => {
    const puAdapter = await getPUAdapterIfAvailable();
    if (puAdapter && courseSpaceId.startsWith('tc-')) {
      return puAdapter.getAttendanceSummary(courseSpaceId);
    }
    return getCourseAttendanceSummary(courseSpaceId);
  },
  listInboxTasks: async (userId: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    const puAdapter = await getPUAdapterIfAvailable(schoolId);
    if (puAdapter) {
      return puAdapter.listInboxTasks(userId);
    }
    return listWorkspaceInboxTasks(userId, schoolId);
  },
  getCourseGradebook: async (courseSpaceId: string) => {
    return getCourseGradebook(courseSpaceId);
  },
  listNextBestActions: async (userId: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    return listAgentNextBestActions(userId, schoolId);
  },
  listRiskSnapshots: async (userId: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    return listAgentRiskSnapshots(userId, schoolId);
  },
  listPulseAggregates: async (schoolId?: string) => {
    return listAgentPulseAggregates(resolveSchoolId(schoolId));
  },
  submitPulseReport: async (input) => {
    return submitAgentPulseReport({
      ...input,
      schoolId: resolveSchoolId(input.schoolId),
    });
  },
  createActionQueueItem: async (input) => {
    const schoolId = resolveSchoolId(input.schoolId);
    try {
      if (!firebaseSource.createActionQueueItem) {
        throw new Error('Firebase action queue is not available');
      }
      return await firebaseSource.createActionQueueItem({
        ...input,
        schoolId,
      });
    } catch (error) {
      if (input.sensitivity === 'high' || input.sensitivity === 'sensitive') {
        console.warn(
          '[HybridSource] createActionQueueItem failed for sensitive action; not falling back to mock:',
          error,
        );
        throw error;
      }
      console.warn('[HybridSource] Falling back to mock action queue:', error);
      if (!mockSource.createActionQueueItem) {
        throw error;
      }
      return mockSource.createActionQueueItem({
        ...input,
        schoolId,
      });
    }
  },

  listEnrollments: async (userId: string, semester?: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    const puEnrollments = await listProvidenceEnrollments(userId, semester, schoolId);
    if (puEnrollments) {
      return puEnrollments;
    }

    try {
      return await firebaseSource.listEnrollments(
        userId,
        semester,
        schoolId,
      );
    } catch (error) {
      throwPermissionDeniedForPrivateData('listEnrollments', error);
      console.warn('[HybridSource] Falling back to mock enrollments:', error);
      return mockSource.listEnrollments(userId, semester, schoolId);
    }
  },
  enrollCourse: async (userId: string, courseId: string, semester?: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.enrollCourse(
        userId,
        courseId,
        semester,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock enrollCourse:', error);
      return mockSource.enrollCourse(userId, courseId, semester, schoolId);
    }
  },
  dropCourse: async (enrollmentId: string, userId?: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.dropCourse(
        enrollmentId,
        userId,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock dropCourse:', error);
      return mockSource.dropCourse(enrollmentId, userId, schoolId);
    }
  },

  listGrades: async (userId: string, semester?: string, schoolId?: string): Promise<Grade[]> => {
    const resolvedSchoolId = resolveSchoolId(schoolId);
    if (resolvedSchoolId === 'default') {
      return mockSource.listGrades(userId, semester);
    }
    return fetchWithFallback(
      resolvedSchoolId,
      'listGrades',
      () => mockSource.listGrades(userId, semester),
      userId,
      semester,
    );
  },
  getGPA: async (userId: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    // 優先用 PUAdapter 計算真實 GPA
    const puAdapter = await getPUAdapterIfAvailable(schoolId);
    if (puAdapter) {
      try {
        const result = await puAdapter.getGPA(userId);
        if (result.totalCredits > 0) return result;
      } catch {
        /* fallback */
      }
    }
    try {
      return await firebaseSource.getGPA(userId, schoolId);
    } catch (error) {
      throwPermissionDeniedForPrivateData('getGPA', error);
      console.warn('[HybridSource] Falling back to mock getGPA:', error);
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
    options?: QueryOptions,
  ): Promise<LibraryBook[]> => {
    const sid = resolveSchoolId(schoolId);
    return fetchWithFallback(
      sid,
      'searchLibraryBooks',
      () => mockSource.searchBooks(query, sid, options),
      query,
    );
  },
  getBook: async (id: string) => {
    try {
      return await firebaseSource.getBook(id);
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock getBook:', error);
      return mockSource.getBook(id);
    }
  },
  listLoans: async (userId: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.listLoans(
        userId,
        schoolId,
      );
    } catch (error) {
      throwPermissionDeniedForPrivateData('listLoans', error);
      logFallbackToMock('listLoans', error);
      return mockSource.listLoans(userId, schoolId);
    }
  },
  borrowBook: async (bookId: string, userId: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.borrowBook(
        bookId,
        userId,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock borrowBook:', error);
      return mockSource.borrowBook(bookId, userId, schoolId);
    }
  },
  returnBook: async (loanId: string, userId?: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.returnBook(
        loanId,
        userId,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock returnBook:', error);
      return mockSource.returnBook(loanId, userId, schoolId);
    }
  },
  renewBook: async (loanId: string, userId?: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.renewBook(
        loanId,
        userId,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock renewBook:', error);
      return mockSource.renewBook(loanId, userId, schoolId);
    }
  },

  listSeats: async (requestedSchoolId?: string, zone?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.listSeats(schoolId, zone);
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock listSeats:', error);
      return mockSource.listSeats(schoolId, zone);
    }
  },
  listSeatReservations: async (userId: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.listSeatReservations(
        userId,
        schoolId,
      );
    } catch (error) {
      throwPermissionDeniedForPrivateData('listSeatReservations', error);
      logFallbackToMock('listSeatReservations', error);
      return mockSource.listSeatReservations(userId, schoolId);
    }
  },
  reserveSeat: async (
    seatId: string,
    userId: string,
    date: string,
    startTime: string,
    endTime: string,
    requestedSchoolId?: string,
  ) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.reserveSeat(
        seatId,
        userId,
        date,
        startTime,
        endTime,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock reserveSeat:', error);
      return mockSource.reserveSeat(seatId, userId, date, startTime, endTime, schoolId);
    }
  },
  cancelSeatReservation: async (id: string, userId?: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.cancelSeatReservation(
        id,
        userId,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock cancelSeatReservation:', error);
      return mockSource.cancelSeatReservation(id, userId, schoolId);
    }
  },

  listBusRoutes: async (schoolId?: string): Promise<BusRoute[]> => {
    const sid = resolveSchoolId(schoolId);
    return fetchWithFallback(sid, 'listBusRoutes', () => mockSource.listBusRoutes(sid));
  },
  getBusRoute: async (id: string) => {
    try {
      return await firebaseSource.getBusRoute(id);
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock getBusRoute:', error);
      return mockSource.getBusRoute(id);
    }
  },
  getBusArrivals: async (stopId: string): Promise<BusArrival[]> => {
    const schoolId = resolveSchoolId();
    return fetchWithFallback(
      schoolId,
      'getBusArrivals',
      () => mockSource.getBusArrivals(stopId),
      stopId,
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

  listOrders: async (userId: string, options?: QueryOptions, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.listOrders(
        userId,
        options,
        schoolId,
      );
    } catch (error) {
      throwPermissionDeniedForPrivateData('listOrders', error);
      logFallbackToMock('listOrders', error);
      return mockSource.listOrders(userId, options, schoolId);
    }
  },
  getOrder: async (id: string, userId?: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.getOrder(
        id,
        userId,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock getOrder:', error);
      return mockSource.getOrder(id, userId, schoolId);
    }
  },
  createOrder: async (data) => {
    assertOrderRequest(data);
    return firebaseSource.createOrder(data);
  },
  updateOrderStatus: async (
    id: string,
    status: Order['status'],
    userId?: string,
    requestedSchoolId?: string,
  ) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.updateOrderStatus(
        id,
        status,
        userId,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock updateOrderStatus:', error);
      return mockSource.updateOrderStatus(id, status, userId, schoolId);
    }
  },
  cancelOrder: async (id: string, userId?: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.cancelOrder(
        id,
        userId,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock cancelOrder:', error);
      return mockSource.cancelOrder(id, userId, schoolId);
    }
  },
  listTransactions: async (userId: string, options?: QueryOptions, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.listTransactions(
        userId,
        options,
        schoolId,
      );
    } catch (error) {
      throwPermissionDeniedForPrivateData('listTransactions', error);
      console.warn('[HybridSource] Falling back to mock listTransactions:', error);
      return mockSource.listTransactions(userId, options, schoolId);
    }
  },
  processTopup: async (data: { userId: string; amount: number; paymentMethod: string }) => {
    try {
      return await firebaseSource.processTopup(data);
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock processTopup:', error);
      return mockSource.processTopup(data);
    }
  },
  processPayment: async (data: {
    userId: string;
    amount: number;
    paymentMethod: string;
    merchantId: string;
    description: string;
  }) => {
    try {
      return await firebaseSource.processPayment(data);
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock processPayment:', error);
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
      throwPermissionDeniedForPrivateData('getDormitoryInfo', error);
      console.warn('[HybridSource] Falling back to mock getDormitoryInfo:', error);
      return mockSource.getDormitoryInfo(userId);
    }
  },
  listRepairRequests: async (userId: string, options?: QueryOptions, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.listRepairRequests(
        userId,
        options,
        schoolId,
      );
    } catch (error) {
      throwPermissionDeniedForPrivateData('listRepairRequests', error);
      logFallbackToMock('listRepairRequests', error);
      return mockSource.listRepairRequests(userId, options, schoolId);
    }
  },
  createRepairRequest: async (data: any) => {
    try {
      return await firebaseSource.createRepairRequest(data);
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock createRepairRequest:', error);
      return mockSource.createRepairRequest(data);
    }
  },
  updateRepairRequest: async (id: string, data: any) => {
    try {
      return await firebaseSource.updateRepairRequest(id, data);
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock updateRepairRequest:', error);
      return mockSource.updateRepairRequest(id, data);
    }
  },
  cancelRepairRequest: async (id: string) => {
    try {
      return await firebaseSource.cancelRepairRequest(id);
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock cancelRepairRequest:', error);
      return mockSource.cancelRepairRequest(id);
    }
  },
  listDormPackages: async (userId: string, options?: QueryOptions, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.listDormPackages(
        userId,
        options,
        schoolId,
      );
    } catch (error) {
      throwPermissionDeniedForPrivateData('listDormPackages', error);
      logFallbackToMock('listDormPackages', error);
      return mockSource.listDormPackages(userId, options, schoolId);
    }
  },
  confirmPackagePickup: async (id: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.confirmPackagePickup(
        id,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock confirmPackagePickup:', error);
      return mockSource.confirmPackagePickup(id, schoolId);
    }
  },
  listWashingMachines: async (requestedSchoolId?: string, building?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.listWashingMachines(
        schoolId,
        building,
      );
    } catch (error) {
      logFallbackToMock('listWashingMachines', error);
      return mockSource.listWashingMachines(schoolId, building);
    }
  },
  listWashingReservations: async (userId: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.listWashingReservations(
        userId,
        schoolId,
      );
    } catch (error) {
      throwPermissionDeniedForPrivateData('listWashingReservations', error);
      logFallbackToMock('listWashingReservations', error);
      return mockSource.listWashingReservations(userId, schoolId);
    }
  },
  reserveWashingMachine: async (machineId: string, userId: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.reserveWashingMachine(
        machineId,
        userId,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock reserveWashingMachine:', error);
      return mockSource.reserveWashingMachine(machineId, userId, schoolId);
    }
  },
  cancelWashingReservation: async (id: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.cancelWashingReservation(
        id,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock cancelWashingReservation:', error);
      return mockSource.cancelWashingReservation(id, schoolId);
    }
  },
  listDormAnnouncements: async (requestedSchoolId?: string, building?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.listDormAnnouncements(
        schoolId,
        building,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock listDormAnnouncements:', error);
      return mockSource.listDormAnnouncements(schoolId, building);
    }
  },

  listPrinters: async (requestedSchoolId?: string, options?: QueryOptions) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.listPrinters(
        schoolId,
        options,
      );
    } catch (error) {
      logFallbackToMock('listPrinters', error);
      return mockSource.listPrinters(schoolId, options);
    }
  },
  getPrinter: async (id: string) => {
    try {
      return await firebaseSource.getPrinter(id);
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock getPrinter:', error);
      return mockSource.getPrinter(id);
    }
  },
  listPrintJobs: async (userId: string, options?: QueryOptions, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.listPrintJobs(
        userId,
        options,
        schoolId,
      );
    } catch (error) {
      throwPermissionDeniedForPrivateData('listPrintJobs', error);
      logFallbackToMock('listPrintJobs', error);
      return mockSource.listPrintJobs(userId, options, schoolId);
    }
  },
  createPrintJob: async (data: any) => {
    try {
      return await firebaseSource.createPrintJob(data);
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock createPrintJob:', error);
      return mockSource.createPrintJob(data);
    }
  },
  cancelPrintJob: async (id: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.cancelPrintJob(
        id,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock cancelPrintJob:', error);
      return mockSource.cancelPrintJob(id, schoolId);
    }
  },

  listHealthAppointments: async (userId: string, options?: QueryOptions, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.listHealthAppointments(
        userId,
        options,
        schoolId,
      );
    } catch (error) {
      throwPermissionDeniedForPrivateData('listHealthAppointments', error);
      logFallbackToMock('listHealthAppointments', error);
      return mockSource.listHealthAppointments(userId, options, schoolId);
    }
  },
  createHealthAppointment: async (data: any) => {
    try {
      return await firebaseSource.createHealthAppointment(data);
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock createHealthAppointment:', error);
      return mockSource.createHealthAppointment(data);
    }
  },
  cancelHealthAppointment: async (id: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.cancelHealthAppointment(
        id,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock cancelHealthAppointment:', error);
      return mockSource.cancelHealthAppointment(id, schoolId);
    }
  },
  rescheduleHealthAppointment: async (id: string, data: any, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.rescheduleHealthAppointment(
        id,
        data,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock rescheduleHealthAppointment:', error);
      return mockSource.rescheduleHealthAppointment(id, data, schoolId);
    }
  },
  listHealthRecords: async (userId: string, options?: QueryOptions, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.listHealthRecords(
        userId,
        options,
        schoolId,
      );
    } catch (error) {
      throwPermissionDeniedForPrivateData('listHealthRecords', error);
      console.warn('[HybridSource] Falling back to mock listHealthRecords:', error);
      return mockSource.listHealthRecords(userId, options, schoolId);
    }
  },
  listHealthTimeSlots: async (departmentId: string, date: string, requestedSchoolId?: string) => {
    const schoolId = resolveSchoolId(requestedSchoolId);
    try {
      return await firebaseSource.listHealthTimeSlots(
        departmentId,
        date,
        schoolId,
      );
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock listHealthTimeSlots:', error);
      return mockSource.listHealthTimeSlots(departmentId, date, schoolId);
    }
  },

  createAccessApplication: async (data: any) => {
    try {
      return await firebaseSource.createAccessApplication(data);
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock createAccessApplication:', error);
      return mockSource.createAccessApplication(data);
    }
  },
  createLateReturnRecord: async (data: any) => {
    try {
      return await firebaseSource.createLateReturnRecord(data);
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock createLateReturnRecord:', error);
      return mockSource.createLateReturnRecord(data);
    }
  },
  createVisitorRecord: async (data: any) => {
    try {
      return await firebaseSource.createVisitorRecord(data);
    } catch (error) {
      console.warn('[HybridSource] Falling back to mock createVisitorRecord:', error);
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
  const { listRegisteredSchools } = require('./apiAdapters/AdapterRegistry');
  return {
    preferRealApi: config.preferRealApi,
    fallbackToMock: config.fallbackToMock,
    registeredSchools: listRegisteredSchools(),
    schoolContextId: currentSchoolContextId,
  };
}
