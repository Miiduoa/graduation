import type { DataSource } from "./source";
import type { 
  Achievement,
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
  QueryOptions,
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
  addDoc,
  collection, 
  deleteDoc,
  doc,
  getDoc,
  getDocs, 
  limit as firestoreLimit, 
  orderBy, 
  query, 
  QueryConstraint,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  increment,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getAuthInstance, getDb, getFunctionsInstance } from "../firebase";
import {
  buildConversationCollectionPath,
  buildGroupCollectionPath,
  buildSchoolCollectionPath,
  buildUserCollectionPath,
  buildUserSchoolCollectionPath,
} from "@campus/shared/src";
import { collectionFromSegments, docFromSegments } from "./firestorePath";
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

const DEFAULT_LIMIT = 100;
const DEFAULT_PAGE_SIZE = 20;

// ===== 錯誤處理 =====

export class FirebaseDataError extends Error {
  constructor(
    message: string,
    public readonly collection: string,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = "FirebaseDataError";
  }
}

// ===== 工具函數 =====

function bySchool(schoolId?: string): QueryConstraint | null {
  return schoolId ? where("schoolId", "==", schoolId) : null;
}

function byUser(userId: string): QueryConstraint {
  return where("userId", "==", userId);
}

function parseDocument<T extends { id: string }>(doc: { id: string; data: () => Record<string, unknown> }): T {
  const data = doc.data();
  const parsed: Record<string, unknown> = { id: doc.id };
  
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof Timestamp) {
      parsed[key] = value.toDate().toISOString();
    } else {
      parsed[key] = value;
    }
  }
  
  return parsed as T;
}

function applyQueryOptions(
  constraints: QueryConstraint[],
  options?: QueryOptions
): QueryConstraint[] {
  const result = [...constraints];
  
  if (options?.sortBy) {
    result.push(orderBy(options.sortBy, options.sortOrder ?? "desc"));
  }
  
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  result.push(firestoreLimit(pageSize));
  
  return result;
}

async function fetchCollection<T extends { id: string }>(
  collectionName: string,
  constraints: (QueryConstraint | null)[],
  schoolId?: string,
  options?: QueryOptions
): Promise<T[]> {
  try {
    const db = getDb();
    const validConstraints = constraints.filter((c): c is QueryConstraint => c !== null);
    const finalConstraints = applyQueryOptions(validConstraints, options);
    
    const qy = query(collection(db, collectionName), ...finalConstraints);
    const snap = await getDocs(qy);
    
    if (__DEV__) {
      console.log(`[firebase] ${collectionName}`, { schoolId, size: snap.size });
    }
    
    return snap.docs.map((d) => parseDocument<T>(d));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[firebase] Failed to fetch ${collectionName}:`, error);
    throw new FirebaseDataError(
      `無法載入${getCollectionLabel(collectionName)}：${message}`,
      collectionName,
      error
    );
  }
}

async function fetchCollectionAtPath<T extends { id: string }>(
  pathSegments: string[],
  constraints: (QueryConstraint | null)[],
  options?: QueryOptions
): Promise<T[]> {
  try {
    const db = getDb();
    const validConstraints = constraints.filter((c): c is QueryConstraint => c !== null);
    const finalConstraints = applyQueryOptions(validConstraints, options);
    const qy = query(collectionFromSegments(db, pathSegments), ...finalConstraints);
    const snap = await getDocs(qy);
    return snap.docs.map((d) => parseDocument<T>(d));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[firebase] Failed to fetch ${pathSegments.join("/")}:`, error);
    throw new FirebaseDataError(
      `無法載入${pathSegments.join("/")}：${message}`,
      pathSegments.join("/"),
      error
    );
  }
}

async function fetchDocumentAtPath<T extends { id: string }>(
  pathSegments: string[]
): Promise<T | null> {
  try {
    const db = getDb();
    const docSnap = await getDoc(docFromSegments(db, pathSegments));

    if (!docSnap.exists()) {
      return null;
    }

    return parseDocument<T>({ id: docSnap.id, data: () => docSnap.data() as Record<string, unknown> });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[firebase] Failed to fetch ${pathSegments.join("/")}:`, error);
    throw new FirebaseDataError(
      `無法載入${pathSegments.join("/")}：${message}`,
      pathSegments.join("/"),
      error
    );
  }
}

async function createDocumentAtPath<T extends { id: string }>(
  pathSegments: string[],
  data: Omit<T, "id" | "createdAt"> & Partial<Pick<T, Extract<keyof T, "createdAt">>>
): Promise<T> {
  try {
    const db = getDb();
    const docRef = await addDoc(collectionFromSegments(db, pathSegments), {
      ...data,
      createdAt: serverTimestamp(),
    });
    const created = await fetchDocumentAtPath<T>([...pathSegments, docRef.id]);

    if (!created) {
      throw new Error("Document not found after creation");
    }

    return created;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[firebase] Failed to create ${pathSegments.join("/")}:`, error);
    throw new FirebaseDataError(
      `無法建立${pathSegments.join("/")}：${message}`,
      pathSegments.join("/"),
      error
    );
  }
}

async function updateDocumentAtPath<T extends { id?: string }>(
  pathSegments: string[],
  data: Partial<T>
): Promise<void> {
  const db = getDb();
  await updateDoc(docFromSegments(db, pathSegments), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

async function deleteDocumentAtPath(pathSegments: string[]): Promise<void> {
  const db = getDb();
  await deleteDoc(docFromSegments(db, pathSegments));
}

async function fetchCanonicalUserSchoolCollection<T extends { id: string }>(params: {
  uid: string;
  schoolId?: string | null;
  canonicalCollection: string;
  canonicalConstraints?: (QueryConstraint | null)[];
  fallbackUserCollection?: string;
  fallbackUserConstraints?: (QueryConstraint | null)[];
  fallbackRootCollection?: string;
  fallbackRootConstraints?: (QueryConstraint | null)[];
  options?: QueryOptions;
}): Promise<T[]> {
  let lastError: unknown = null;

  if (params.schoolId) {
    try {
      const canonicalRows = await fetchCollectionAtPath<T>(
        buildUserSchoolCollectionPath(params.uid, params.schoolId, params.canonicalCollection),
        params.canonicalConstraints ?? [],
        params.options
      );
      if (canonicalRows.length > 0) {
        return canonicalRows;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (params.fallbackUserCollection) {
    try {
      const fallbackUserRows = await fetchCollectionAtPath<T>(
        buildUserCollectionPath(params.uid, params.fallbackUserCollection),
        params.fallbackUserConstraints ?? [],
        params.options
      );
      if (fallbackUserRows.length > 0) {
        return fallbackUserRows;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (params.fallbackRootCollection) {
    return fetchCollection<T>(
      params.fallbackRootCollection,
      params.fallbackRootConstraints ?? [],
      params.schoolId ?? undefined,
      params.options
    );
  }

  if (lastError) {
    throw lastError;
  }

  return [];
}

async function fetchCanonicalUserSchoolDocument<T extends { id: string }>(params: {
  uid: string;
  schoolId?: string | null;
  canonicalCollection: string;
  docId: string;
  fallbackUserCollection?: string;
  fallbackRootCollection?: string;
}): Promise<T | null> {
  const pathCandidates: string[][] = [];

  if (params.schoolId) {
    pathCandidates.push(buildUserSchoolCollectionPath(params.uid, params.schoolId, params.canonicalCollection, params.docId));
  }
  if (params.fallbackUserCollection) {
    pathCandidates.push(buildUserCollectionPath(params.uid, params.fallbackUserCollection, params.docId));
  }
  if (params.fallbackRootCollection) {
    pathCandidates.push([params.fallbackRootCollection, params.docId]);
  }

  for (const pathSegments of pathCandidates) {
    const row = await fetchDocumentAtPath<T>(pathSegments);
    if (row) {
      return row;
    }
  }

  return null;
}

async function resolveUserSchoolId(
  uid: string,
  preferredSchoolId?: string | null
): Promise<string | null> {
  if (preferredSchoolId) {
    return preferredSchoolId;
  }

  const userDoc = await fetchDocumentAtPath<{ id: string; schoolId?: string | null; primarySchoolId?: string | null }>([
    "users",
    uid,
  ]).catch(() => null);

  return userDoc?.primarySchoolId ?? userDoc?.schoolId ?? null;
}

async function fetchCanonicalSchoolCollection<T extends { id: string }>(params: {
  schoolId?: string;
  canonicalCollections: string[];
  schoolConstraints?: (QueryConstraint | null)[];
  fallbackCollection?: string;
  fallbackConstraints?: (QueryConstraint | null)[];
  options?: QueryOptions;
}): Promise<T[]> {
  const schoolConstraints = params.schoolConstraints ?? [];
  const fallbackConstraints = params.fallbackConstraints ?? [];
  let lastError: unknown = null;

  if (params.schoolId) {
    for (const collectionName of params.canonicalCollections) {
      try {
        const rows = await fetchCollectionAtPath<T>(
          buildSchoolCollectionPath(params.schoolId, collectionName),
          schoolConstraints,
          params.options
        );

        if (rows.length > 0) {
          return rows;
        }
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (params.fallbackCollection) {
    return fetchCollection<T>(
      params.fallbackCollection,
      fallbackConstraints,
      params.schoolId,
      params.options
    );
  }

  if (lastError) {
    throw lastError;
  }

  return [];
}

async function fetchDocument<T extends { id: string }>(
  collectionName: string,
  docId: string
): Promise<T | null> {
  try {
    const db = getDb();
    const docRef = doc(db, collectionName, docId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      return null;
    }
    
    return parseDocument<T>({ id: docSnap.id, data: () => docSnap.data() as Record<string, unknown> });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[firebase] Failed to fetch ${collectionName}/${docId}:`, error);
    throw new FirebaseDataError(
      `無法載入${getCollectionLabel(collectionName)}：${message}`,
      collectionName,
      error
    );
  }
}

async function createDocument<T extends { id: string }>(
  collectionName: string,
  data: Omit<T, "id" | "createdAt"> & Partial<Pick<T, Extract<keyof T, "createdAt">>>
): Promise<T> {
  try {
    const db = getDb();
    const docRef = await addDoc(collection(db, collectionName), {
      ...data,
      createdAt: serverTimestamp(),
    });

    const created = await fetchDocument<T>(collectionName, docRef.id);
    if (!created) {
      throw new Error("Document not found after creation");
    }

    return created;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[firebase] Failed to create in ${collectionName}:`, error);
    throw new FirebaseDataError(
      `無法建立${getCollectionLabel(collectionName)}：${message}`,
      collectionName,
      error
    );
  }
}

async function updateDocument<T extends { id: string }>(
  collectionName: string,
  docId: string,
  data: Partial<T>
): Promise<T> {
  try {
    const db = getDb();
    const docRef = doc(db, collectionName, docId);
    
    await updateDoc(docRef, {
      ...data,
      updatedAt: serverTimestamp(),
    });
    
    const updated = await fetchDocument<T>(collectionName, docId);
    if (!updated) {
      throw new Error("Document not found after update");
    }
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[firebase] Failed to update ${collectionName}/${docId}:`, error);
    throw new FirebaseDataError(
      `無法更新${getCollectionLabel(collectionName)}：${message}`,
      collectionName,
      error
    );
  }
}

async function deleteDocument(collectionName: string, docId: string): Promise<void> {
  try {
    const db = getDb();
    const docRef = doc(db, collectionName, docId);
    await deleteDoc(docRef);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[firebase] Failed to delete ${collectionName}/${docId}:`, error);
    throw new FirebaseDataError(
      `無法刪除${getCollectionLabel(collectionName)}：${message}`,
      collectionName,
      error
    );
  }
}

function getCollectionLabel(collectionName: string): string {
  const labels: Record<string, string> = {
    announcements: "公告",
    events: "活動",
    pois: "地點",
    menus: "菜單",
    users: "使用者",
    courses: "課程",
    enrollments: "選課",
    grades: "成績",
    groups: "群組",
    groupMembers: "群組成員",
    groupPosts: "貼文",
    comments: "留言",
    assignments: "作業",
    submissions: "繳交",
    conversations: "對話",
    messages: "訊息",
    lostFoundItems: "失物招領",
    libraryBooks: "書籍",
    libraryLoans: "借閱",
    librarySeats: "座位",
    seatReservations: "座位預約",
    busRoutes: "公車路線",
    notifications: "通知",
    calendarEvents: "行事曆",
    orders: "訂單",
    transactions: "交易",
    achievements: "成就",
  };
  return labels[collectionName] ?? collectionName;
}

// ===== Firebase DataSource 實作 =====

export const firebaseSource: DataSource = {
  // ===== 公告 =====
  async listAnnouncements(schoolId, options) {
    return fetchCanonicalSchoolCollection<Announcement>({
      schoolId,
      canonicalCollections: ["announcements"],
      schoolConstraints: [orderBy("publishedAt", "desc")],
      fallbackCollection: "announcements",
      fallbackConstraints: [bySchool(schoolId), orderBy("publishedAt", "desc")],
      options,
    });
  },

  async getAnnouncement(id) {
    return fetchDocument<Announcement>("announcements", id);
  },

  // ===== 活動 =====
  async listEvents(schoolId, options) {
    return fetchCanonicalSchoolCollection<ClubEvent>({
      schoolId,
      canonicalCollections: ["clubEvents", "events"],
      schoolConstraints: [orderBy("startsAt", "asc")],
      fallbackCollection: "events",
      fallbackConstraints: [bySchool(schoolId), orderBy("startsAt", "asc")],
      options,
    });
  },

  async getEvent(id) {
    return fetchDocument<ClubEvent>("events", id);
  },

  async registerEvent(eventId, userId) {
    const db = getDb();
    const eventRef = doc(db, "events", eventId);
    const registrationRef = doc(db, "eventRegistrations", `${eventId}_${userId}`);
    
    const batch = writeBatch(db);
    batch.set(registrationRef, {
      eventId,
      userId,
      registeredAt: serverTimestamp(),
    });
    batch.update(eventRef, {
      registeredCount: increment(1),
    });
    await batch.commit();
  },

  async unregisterEvent(eventId, userId) {
    const db = getDb();
    const eventRef = doc(db, "events", eventId);
    const registrationRef = doc(db, "eventRegistrations", `${eventId}_${userId}`);
    
    const batch = writeBatch(db);
    batch.delete(registrationRef);
    batch.update(eventRef, {
      registeredCount: increment(-1),
    });
    await batch.commit();
  },

  // ===== 地點 =====
  async listPois(schoolId, options) {
    return fetchCanonicalSchoolCollection<Poi>({
      schoolId,
      canonicalCollections: ["pois"],
      fallbackCollection: "pois",
      fallbackConstraints: [bySchool(schoolId)],
      options,
    });
  },

  async getPoi(id) {
    return fetchDocument<Poi>("pois", id);
  },

  // ===== 餐廳菜單 =====
  async listMenus(schoolId, options) {
    return fetchCanonicalSchoolCollection<MenuItem>({
      schoolId,
      canonicalCollections: ["menus", "cafeteriaMenus"],
      schoolConstraints: [orderBy("availableOn", "desc")],
      fallbackCollection: "menus",
      fallbackConstraints: [bySchool(schoolId), orderBy("availableOn", "desc")],
      options,
    });
  },

  async getMenuItem(id) {
    return fetchDocument<MenuItem>("menus", id);
  },

  async rateMenuItem(id, userId, rating) {
    const db = getDb();
    const menuRef = doc(db, "menus", id);
    const ratingRef = doc(db, "menuRatings", `${id}_${userId}`);
    
    const existingRating = await getDoc(ratingRef);
    const isNewRating = !existingRating.exists();
    
    const batch = writeBatch(db);
    batch.set(ratingRef, { menuId: id, userId: userId, rating, updatedAt: serverTimestamp() });
    
    if (isNewRating) {
      batch.update(menuRef, { ratingCount: increment(1) });
    }
    
    await batch.commit();
  },

  // ===== 使用者 =====
  async getUser(id) {
    return fetchDocument<User>("users", id);
  },

  async updateUser(id, data) {
    return updateDocument<User>("users", id, data);
  },

  async getUserByEmail(email) {
    const users = await fetchCollection<User>("users", [where("email", "==", email)]);
    return users[0] ?? null;
  },

  // ===== 課程 =====
  async listCourses(schoolId, options) {
    return fetchCollection<Course>(
      "courses",
      [bySchool(schoolId), orderBy("code", "asc")],
      schoolId,
      options
    );
  },

  async getCourse(id) {
    return fetchDocument<Course>("courses", id);
  },

  async searchCourses(searchQuery, schoolId) {
    const allCourses = await fetchCollection<Course>(
      "courses",
      [bySchool(schoolId)],
      schoolId
    );
    const q = searchQuery.toLowerCase();
    return allCourses.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.instructor.toLowerCase().includes(q)
    );
  },

  async listCourseSpaces(userId, schoolId) {
    return listWorkspaceCourseSpaces(userId, schoolId);
  },

  async getCourseSpace(courseSpaceId, userId, schoolId) {
    return getWorkspaceCourseSpace(courseSpaceId, userId, schoolId);
  },

  async listCourseModules(userId, courseSpaceId, schoolId) {
    return listWorkspaceCourseModules(userId, courseSpaceId, schoolId);
  },

  async createCourseModule(input) {
    return createCourseSpaceModule(input);
  },

  async listCourseMaterials(courseSpaceId, moduleId) {
    return listWorkspaceCourseMaterials(courseSpaceId, moduleId);
  },

  async listQuizzes(userId, courseSpaceId, schoolId) {
    return listWorkspaceQuizzes(userId, courseSpaceId, schoolId);
  },

  async getQuiz(quizId, userId, courseSpaceId, schoolId) {
    return getWorkspaceQuiz(quizId, userId, courseSpaceId, schoolId);
  },

  async createQuiz(input) {
    return createCourseSpaceQuiz(input);
  },

  async submitQuiz(input) {
    return submitCourseSpaceQuiz(input);
  },

  async listAttendanceSessions(userId, courseSpaceId, schoolId) {
    return listWorkspaceAttendanceSessions(userId, courseSpaceId, schoolId);
  },

  async startAttendanceSession(input) {
    return startCourseAttendanceSession(input);
  },

  async checkInAttendance(input) {
    return checkInCourseAttendance(input);
  },

  async getAttendanceSummary(courseSpaceId) {
    return getCourseAttendanceSummary(courseSpaceId);
  },

  async listInboxTasks(userId, schoolId) {
    return listWorkspaceInboxTasks(userId, schoolId);
  },

  async getCourseGradebook(courseSpaceId) {
    return getCourseGradebook(courseSpaceId);
  },

  // ===== 選課 =====
  async listEnrollments(userId, semester, schoolId = undefined) {
    const constraints: (QueryConstraint | null)[] = [byUser(userId)];
    if (semester) {
      constraints.push(where("semester", "==", semester));
    }
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    return fetchCanonicalUserSchoolCollection<Enrollment>({
      uid: userId,
      schoolId: resolvedSchoolId,
      canonicalCollection: "enrollments",
      canonicalConstraints: constraints,
      fallbackUserCollection: "enrollments",
      fallbackUserConstraints: constraints,
      fallbackRootCollection: "enrollments",
      fallbackRootConstraints: constraints,
    });
  },

  async enrollCourse(userId, courseId, semester, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    if (!resolvedSchoolId) {
      throw new Error("缺少 schoolId，無法建立選課資料");
    }

    return createDocumentAtPath<Enrollment>(buildUserSchoolCollectionPath(userId, resolvedSchoolId, "enrollments"), {
      userId,
      courseId,
      semester,
      status: "enrolled",
      createdAt: new Date().toISOString(),
    } as Omit<Enrollment, "id">);
  },

  async dropCourse(enrollmentId, userId = undefined, schoolId = undefined) {
    const resolvedSchoolId = userId ? await resolveUserSchoolId(userId, schoolId) : schoolId ?? null;
    if (userId && resolvedSchoolId) {
      await updateDocumentAtPath<Enrollment>(
        buildUserSchoolCollectionPath(userId, resolvedSchoolId, "enrollments", enrollmentId),
        { status: "dropped" }
      );
      return;
    }

    await updateDocument<Enrollment>("enrollments", enrollmentId, { status: "dropped" });
  },

  // ===== 成績 =====
  async listGrades(userId, semester, schoolId = undefined) {
    const constraints: (QueryConstraint | null)[] = [byUser(userId)];
    if (semester) {
      constraints.push(where("semester", "==", semester));
    }
    constraints.push(orderBy("publishedAt", "desc"));
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    return fetchCanonicalUserSchoolCollection<Grade>({
      uid: userId,
      schoolId: resolvedSchoolId,
      canonicalCollection: "grades",
      canonicalConstraints: constraints,
      fallbackUserCollection: "grades",
      fallbackUserConstraints: constraints,
      fallbackRootCollection: "grades",
      fallbackRootConstraints: constraints,
    });
  },

  async getGPA(userId, schoolId = undefined) {
    const grades = await this.listGrades(userId, undefined, schoolId);
    let totalPoints = 0;
    let totalCredits = 0;
    
    for (const grade of grades) {
      totalPoints += grade.gradePoints * grade.credits;
      totalCredits += grade.credits;
    }
    
    return {
      gpa: totalCredits > 0 ? totalPoints / totalCredits : 0,
      totalCredits,
      totalPoints,
    };
  },

  // ===== 群組 =====
  async listGroups(userId, options) {
    const db = getDb();
    const schoolId =
      options?.filters?.find((filter) => filter.field === "schoolId" && filter.operator === "==")?.value ?? null;
    const constraints = [where("status", "==", "active")] as QueryConstraint[];

    if (typeof schoolId === "string" && schoolId) {
      constraints.push(where("schoolId", "==", schoolId));
    }

    const membershipSnap = await getDocs(
      query(collection(db, buildUserCollectionPath(userId, "groups").join("/")), ...constraints)
    );
    const groupIds = membershipSnap.docs
      .map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        return typeof data.groupId === "string" ? data.groupId : docSnap.id;
      })
      .filter(Boolean);
    
    if (groupIds.length === 0) return [];
    
    const groups: Group[] = [];
    for (const gid of groupIds.slice(0, 10)) {
      const group = await this.getGroup(gid);
      if (group) groups.push(group);
    }
    return groups;
  },

  async getGroup(id) {
    return fetchDocument<Group>("groups", id);
  },

  async createGroup(data) {
    const createGroup = httpsCallable<
      {
        name: string;
        description?: string;
        type: Group["type"];
        schoolId: string;
        isPrivate?: boolean;
        isPublished?: boolean;
        verification?: { status?: string };
      },
      { success: boolean; groupId: string; joinCode?: string | null }
    >(getFunctionsInstance(), "createGroup");
    const result = await createGroup({
      name: data.name,
      description: data.description,
      type: data.type,
      schoolId: data.schoolId ?? "",
      isPrivate: data.isPrivate,
      isPublished: (data as any).isPublished,
      verification: (data as any).verification,
    });
    const group = await this.getGroup(result.data.groupId);
    if (group) return group;

    return {
      ...data,
      id: result.data.groupId,
      joinCode: result.data.joinCode ?? data.joinCode,
      memberCount: 1,
      createdAt: new Date().toISOString(),
    } as Group;
  },

  async updateGroup(id, data) {
    return updateDocument<Group>("groups", id, data);
  },

  async deleteGroup(id) {
    await deleteDocument("groups", id);
  },

  async joinGroup(groupId, userId, joinCode) {
    const group = await this.getGroup(groupId);
    if (!group) throw new Error("群組不存在");
    if (!group.schoolId) {
      throw new Error("群組缺少 schoolId");
    }

    await httpsCallable<
      { joinCode: string; schoolId: string },
      { success: boolean; groupId: string; groupName?: string }
    >(getFunctionsInstance(), "joinGroupByCode")({
      joinCode: String(joinCode ?? group.joinCode ?? "").trim().toUpperCase(),
      schoolId: group.schoolId,
    });

    const memberSnap = await getDoc(doc(getDb(), buildGroupCollectionPath(groupId, "members", userId).join("/")));
    const memberData = memberSnap.data() as Record<string, unknown> | undefined;

    return {
      id: userId,
      groupId,
      userId,
      uid: userId,
      role: (memberData?.role as GroupMember["role"]) ?? "member",
      status: (memberData?.status as string | undefined) ?? "active",
      joinedAt:
        memberData?.joinedAt && typeof (memberData.joinedAt as any)?.toDate === "function"
          ? (memberData.joinedAt as any).toDate().toISOString()
          : new Date().toISOString(),
    };
  },

  async leaveGroup(groupId, userId) {
    await httpsCallable<{ groupId: string }, { success: boolean }>(getFunctionsInstance(), "leaveGroup")({
      groupId,
    });
  },

  // ===== 群組成員 =====
  async listGroupMembers(groupId, options) {
    try {
      const rows = await fetchCollectionAtPath<GroupMember>(
        buildGroupCollectionPath(groupId, "members"),
        [where("status", "==", "active")],
        options
      );
      if (rows.length > 0) {
        return rows.map((row) => ({
          ...row,
          id: row.id,
          groupId,
          userId: row.userId ?? row.uid ?? row.id,
          uid: row.uid ?? row.userId ?? row.id,
        }));
      }
    } catch (error) {
      console.warn("[firebaseSource] listGroupMembers canonical read failed:", error);
    }

    return fetchCollection<GroupMember>("groupMembers", [where("groupId", "==", groupId)], undefined, options);
  },

  async updateMemberRole(groupId, userId, role) {
    try {
      await updateDocumentAtPath<GroupMember>(buildGroupCollectionPath(groupId, "members", userId), { role });
      await updateDocumentAtPath<GroupMember>(buildUserCollectionPath(userId, "groups", groupId), { role });
      return;
    } catch (error) {
      console.warn("[firebaseSource] updateMemberRole canonical write failed:", error);
    }

    const db = getDb();
    const membersSnap = await getDocs(query(collection(db, "groupMembers"), where("groupId", "==", groupId), where("userId", "==", userId)));
    if (!membersSnap.empty) {
      await updateDoc(membersSnap.docs[0].ref, { role });
    }
  },

  async removeMember(groupId, userId) {
    await this.leaveGroup(groupId, userId);
  },

  // ===== 群組貼文 =====
  async listGroupPosts(groupId, options) {
    try {
      const rows = await fetchCollectionAtPath<GroupPost>(
        buildGroupCollectionPath(groupId, "posts"),
        [orderBy("createdAt", "desc")],
        options
      );
      if (rows.length > 0) {
        return rows.map((row) => ({ ...row, groupId: row.groupId ?? groupId }));
      }
    } catch (error) {
      console.warn("[firebaseSource] listGroupPosts canonical read failed:", error);
    }

    return fetchCollection<GroupPost>("groupPosts", [where("groupId", "==", groupId), orderBy("createdAt", "desc")], undefined, options);
  },

  async getGroupPost(id, groupId = undefined) {
    if (groupId) {
      const canonicalPost = await fetchDocumentAtPath<GroupPost>(buildGroupCollectionPath(groupId, "posts", id));
      if (canonicalPost) {
        return { ...canonicalPost, groupId: canonicalPost.groupId ?? groupId };
      }
    }
    return fetchDocument<GroupPost>("groupPosts", id);
  },

  async createGroupPost(data) {
    return createDocumentAtPath<GroupPost>(buildGroupCollectionPath(data.groupId, "posts"), {
      ...data,
      likeCount: 0,
      commentCount: 0,
    } as Omit<GroupPost, "id">);
  },

  async updateGroupPost(id, data, groupId = undefined) {
    if (groupId) {
      await updateDocumentAtPath<GroupPost>(buildGroupCollectionPath(groupId, "posts", id), data);
      return (await fetchDocumentAtPath<GroupPost>(buildGroupCollectionPath(groupId, "posts", id))) as GroupPost;
    }
    return updateDocument<GroupPost>("groupPosts", id, data);
  },

  async deleteGroupPost(id, groupId = undefined) {
    if (groupId) {
      await deleteDocumentAtPath(buildGroupCollectionPath(groupId, "posts", id));
      return;
    }
    await deleteDocument("groupPosts", id);
  },

  async likePost(postId, userId, groupId = undefined) {
    const db = getDb();
    if (groupId) {
      await updateDoc(docFromSegments(db, buildGroupCollectionPath(groupId, "posts", postId)), {
        likeCount: increment(1),
        likedBy: arrayUnion(userId),
      });
      return;
    }

    const likeRef = doc(db, "postLikes", `${postId}_${userId}`);
    const postRef = doc(db, "groupPosts", postId);
    const batch = writeBatch(db);
    batch.set(likeRef, { postId, userId, createdAt: serverTimestamp() });
    batch.update(postRef, { likeCount: increment(1) });
    await batch.commit();
  },

  async unlikePost(postId, userId, groupId = undefined) {
    const db = getDb();
    if (groupId) {
      await updateDoc(docFromSegments(db, buildGroupCollectionPath(groupId, "posts", postId)), {
        likeCount: increment(-1),
        likedBy: arrayRemove(userId),
      });
      return;
    }

    const likeRef = doc(db, "postLikes", `${postId}_${userId}`);
    const postRef = doc(db, "groupPosts", postId);
    const batch = writeBatch(db);
    batch.delete(likeRef);
    batch.update(postRef, { likeCount: increment(-1) });
    await batch.commit();
  },

  // ===== 留言 =====
  async listComments(postId, options, groupId = undefined) {
    try {
      const rows = await fetchCollectionAtPath<Comment>(
        buildGroupCollectionPath(groupId, "posts", postId, "comments"),
        [orderBy("createdAt", "asc")],
        options
      );
      if (rows.length > 0) {
        return rows.map((row) => ({ ...row, postId: row.postId ?? postId, groupId: (row as any).groupId ?? groupId }));
      }
    } catch (error) {
      console.warn("[firebaseSource] listComments canonical read failed:", error);
    }

    return fetchCollection<Comment>("comments", [where("postId", "==", postId), orderBy("createdAt", "asc")], undefined, options);
  },

  async createComment(data) {
    const db = getDb();
    const groupId = (data as any).groupId as string | undefined;
    if (groupId) {
      const comment = await createDocumentAtPath<Comment>(
        buildGroupCollectionPath(groupId, "posts", data.postId, "comments"),
        {
          ...data,
          likeCount: 0,
        } as Omit<Comment, "id">
      );
      await updateDoc(docFromSegments(db, buildGroupCollectionPath(groupId, "posts", data.postId)), {
        commentCount: increment(1),
      });
      return comment;
    }

    const comment = await createDocument<Comment>("comments", { ...data, likeCount: 0 } as Omit<Comment, "id">);
    await updateDoc(doc(db, "groupPosts", data.postId), { commentCount: increment(1) });
    return comment;
  },

  async deleteComment(id, groupId = undefined, postId = undefined) {
    if (groupId && postId) {
      const db = getDb();
      await deleteDocumentAtPath(buildGroupCollectionPath(groupId, "posts", postId, "comments", id));
      await updateDoc(docFromSegments(db, buildGroupCollectionPath(groupId, "posts", postId)), {
        commentCount: increment(-1),
      });
      return;
    }

    const comment = await fetchDocument<Comment>("comments", id);
    if (!comment) return;
    const db = getDb();
    await deleteDocument("comments", id);
    await updateDoc(doc(db, "groupPosts", comment.postId), { commentCount: increment(-1) });
  },

  // ===== 作業 =====
  async listAssignments(groupId, options) {
    try {
      const rows = await fetchCollectionAtPath<Assignment>(
        buildGroupCollectionPath(groupId, "assignments"),
        [orderBy("dueAt", "asc")],
        options
      );
      if (rows.length > 0) {
        return rows.map((row) => ({ ...row, groupId: row.groupId ?? groupId }));
      }
    } catch (error) {
      console.warn("[firebaseSource] listAssignments canonical read failed:", error);
    }

    return fetchCollection<Assignment>("assignments", [where("groupId", "==", groupId), orderBy("dueAt", "asc")], undefined, options);
  },

  async getAssignment(id, groupId = undefined) {
    if (groupId) {
      const canonicalAssignment = await fetchDocumentAtPath<Assignment>(buildGroupCollectionPath(groupId, "assignments", id));
      if (canonicalAssignment) {
        return { ...canonicalAssignment, groupId: canonicalAssignment.groupId ?? groupId };
      }
    }
    return fetchDocument<Assignment>("assignments", id);
  },

  async createAssignment(data) {
    return createDocumentAtPath<Assignment>(buildGroupCollectionPath(data.groupId, "assignments"), {
      ...data,
      submissionCount: 0,
    } as Omit<Assignment, "id">);
  },

  async updateAssignment(id, data, groupId = undefined) {
    if (groupId) {
      await updateDocumentAtPath<Assignment>(buildGroupCollectionPath(groupId, "assignments", id), data);
      return (await fetchDocumentAtPath<Assignment>(buildGroupCollectionPath(groupId, "assignments", id))) as Assignment;
    }
    return updateDocument<Assignment>("assignments", id, data);
  },

  async deleteAssignment(id, groupId = undefined) {
    if (groupId) {
      await deleteDocumentAtPath(buildGroupCollectionPath(groupId, "assignments", id));
      return;
    }
    await deleteDocument("assignments", id);
  },

  // ===== 作業繳交 =====
  async listSubmissions(assignmentId, options, groupId = undefined) {
    if (groupId) {
      try {
        const rows = await fetchCollectionAtPath<Submission>(
          buildGroupCollectionPath(groupId, "assignments", assignmentId, "submissions"),
          [],
          options
        );
        if (rows.length > 0) {
          return rows.map((row) => ({ ...row, assignmentId: row.assignmentId ?? assignmentId }));
        }
      } catch (error) {
        console.warn("[firebaseSource] listSubmissions canonical read failed:", error);
      }
    }

    return fetchCollection<Submission>("submissions", [where("assignmentId", "==", assignmentId)], undefined, options);
  },

  async getSubmission(assignmentId, userId, groupId = undefined) {
    if (groupId) {
      const canonicalSubmission = await fetchDocumentAtPath<Submission>(
        buildGroupCollectionPath(groupId, "assignments", assignmentId, "submissions", userId)
      );
      if (canonicalSubmission) {
        return { ...canonicalSubmission, assignmentId: canonicalSubmission.assignmentId ?? assignmentId };
      }
    }

    const submissions = await fetchCollection<Submission>("submissions", [where("assignmentId", "==", assignmentId), where("userId", "==", userId)]);
    return submissions[0] ?? null;
  },

  async submitAssignment(data) {
    const db = getDb();
    const groupId = (data as any).groupId as string;
    const submissionPath = buildGroupCollectionPath(groupId, "assignments", data.assignmentId, "submissions", data.userId);
    await setDoc(
      docFromSegments(db, submissionPath),
      {
        ...data,
        status: "submitted",
        submittedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    await updateDoc(docFromSegments(db, buildGroupCollectionPath(groupId, "assignments", data.assignmentId)), {
      submissionCount: increment(1),
    });

    return (await fetchDocumentAtPath<Submission>(submissionPath)) as Submission;
  },

  async gradeSubmission(id, grade, feedback, groupId = undefined, assignmentId = undefined, userId = undefined) {
    if (groupId && assignmentId && userId) {
      const submissionPath = buildGroupCollectionPath(groupId, "assignments", assignmentId, "submissions", userId);
      await updateDocumentAtPath<Submission>(submissionPath, {
        grade,
        feedback,
        status: "graded",
        gradedAt: new Date().toISOString(),
      });
      return (await fetchDocumentAtPath<Submission>(submissionPath)) as Submission;
    }

    return updateDocument<Submission>("submissions", id, {
      grade,
      feedback,
      status: "graded",
      gradedAt: new Date().toISOString(),
    });
  },

  // ===== 訊息 =====
  async listConversations(userId, options) {
    return fetchCollection<Conversation>(
      "conversations",
      [where("participants", "array-contains", userId), orderBy("updatedAt", "desc")],
      undefined,
      options
    );
  },

  async getConversation(id) {
    return fetchDocument<Conversation>("conversations", id);
  },

  async createConversation(participantIds) {
    return createDocument<Conversation>("conversations", {
      participants: participantIds,
      participantIds,
      schoolId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Omit<Conversation, "id">);
  },

  async listMessages(conversationId, options) {
    try {
      const rows = await fetchCollectionAtPath<Message>(
        buildConversationCollectionPath(conversationId, "messages"),
        [orderBy("createdAt", "asc")],
        options
      );
      if (rows.length > 0) {
        return rows.map((row) => ({ ...row, conversationId: row.conversationId ?? conversationId }));
      }
    } catch (error) {
      console.warn("[firebaseSource] listMessages canonical read failed:", error);
    }

    return fetchCollection<Message>("messages", [where("conversationId", "==", conversationId), orderBy("createdAt", "asc")], undefined, options);
  },

  async sendMessage(data) {
    const db = getDb();
    const message = await createDocumentAtPath<Message>(
      buildConversationCollectionPath(data.conversationId, "messages"),
      data as Omit<Message, "id">
    );

    await updateDoc(doc(db, "conversations", data.conversationId), {
      lastMessage: message,
      updatedAt: serverTimestamp(),
    });
    
    return message;
  },

  async markMessageRead(messageId, userId, conversationId = undefined) {
    const db = getDb();
    if (conversationId) {
      await updateDoc(docFromSegments(db, buildConversationCollectionPath(conversationId, "messages", messageId)), {
        readBy: arrayUnion(userId),
      });
      return;
    }

    await updateDoc(doc(db, "messages", messageId), { readBy: arrayUnion(userId) });
  },

  // ===== 失物招領 =====
  async listLostFoundItems(schoolId, options) {
    return fetchCanonicalSchoolCollection<LostFoundItem>({
      schoolId,
      canonicalCollections: ["lostFound"],
      schoolConstraints: [orderBy("createdAt", "desc")],
      fallbackCollection: "lostFoundItems",
      fallbackConstraints: [bySchool(schoolId), orderBy("createdAt", "desc")],
      options,
    });
  },

  async getLostFoundItem(id) {
    return fetchDocument<LostFoundItem>("lostFoundItems", id);
  },

  async createLostFoundItem(data) {
    return createDocument<LostFoundItem>("lostFoundItems", {
      ...data,
      status: "open",
    } as Omit<LostFoundItem, "id">);
  },

  async updateLostFoundItem(id, data) {
    return updateDocument<LostFoundItem>("lostFoundItems", id, data);
  },

  async resolveLostFoundItem(id) {
    await updateDocument<LostFoundItem>("lostFoundItems", id, {
      status: "resolved",
      resolvedAt: new Date().toISOString(),
    });
  },

  // ===== 圖書館 =====
  async searchBooks(searchQuery, schoolId, options) {
    const allBooks = await fetchCanonicalSchoolCollection<LibraryBook>({
      schoolId,
      canonicalCollections: ["libraryBooks"],
      fallbackCollection: "libraryBooks",
      fallbackConstraints: [bySchool(schoolId)],
      options,
    });
    const q = searchQuery.toLowerCase();
    return allBooks.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.isbn?.includes(q)
    );
  },

  async getBook(id) {
    return fetchDocument<LibraryBook>("libraryBooks", id);
  },

  async listLoans(userId, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    const constraints: (QueryConstraint | null)[] = [byUser(userId), where("status", "!=", "returned")];
    return fetchCanonicalUserSchoolCollection<LibraryLoan>({
      uid: userId,
      schoolId: resolvedSchoolId,
      canonicalCollection: "libraryLoans",
      canonicalConstraints: constraints,
      fallbackRootCollection: "libraryLoans",
      fallbackRootConstraints: constraints,
    });
  },

  async borrowBook(bookId, userId, schoolId = undefined) {
    const db = getDb();
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    if (!resolvedSchoolId) {
      throw new Error("缺少 schoolId，無法借閱書籍");
    }
    const book = await this.getBook(bookId);
    if (!book || book.available <= 0) {
      throw new Error("書籍不可借閱");
    }
    
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14);
    
    const loan = await createDocumentAtPath<LibraryLoan>(
      buildUserSchoolCollectionPath(userId, resolvedSchoolId, "libraryLoans"),
      {
        userId,
        schoolId: resolvedSchoolId,
        bookId,
        borrowedAt: new Date().toISOString(),
        dueAt: dueDate.toISOString(),
        renewCount: 0,
        status: "borrowed",
      } as Omit<LibraryLoan, "id">
    );
    
    await updateDoc(docFromSegments(db, buildSchoolCollectionPath(resolvedSchoolId, "libraryBooks", bookId)), {
      available: increment(-1),
    });
    
    return loan;
  },

  async returnBook(loanId, userId = undefined, schoolId = undefined) {
    const resolvedSchoolId = userId ? await resolveUserSchoolId(userId, schoolId) : schoolId ?? null;
    const loan =
      userId && resolvedSchoolId
        ? await fetchCanonicalUserSchoolDocument<LibraryLoan>({
            uid: userId,
            schoolId: resolvedSchoolId,
            canonicalCollection: "libraryLoans",
            docId: loanId,
            fallbackRootCollection: "libraryLoans",
          })
        : await fetchDocument<LibraryLoan>("libraryLoans", loanId);
    if (!loan) throw new Error("借閱記錄不存在");
    
    const db = getDb();
    if (userId && resolvedSchoolId) {
      await updateDocumentAtPath<LibraryLoan>(
        buildUserSchoolCollectionPath(userId, resolvedSchoolId, "libraryLoans", loanId),
        { status: "returned", returnedAt: serverTimestamp() as never }
      );
    } else {
      await updateDoc(doc(db, "libraryLoans", loanId), {
        status: "returned",
        returnedAt: serverTimestamp(),
      });
    }

    if (resolvedSchoolId) {
      await updateDoc(docFromSegments(db, buildSchoolCollectionPath(resolvedSchoolId, "libraryBooks", loan.bookId)), {
        available: increment(1),
      });
    } else {
      await updateDoc(doc(db, "libraryBooks", loan.bookId), {
        available: increment(1),
      });
    }
  },

  async renewBook(loanId, userId = undefined, schoolId = undefined) {
    const resolvedSchoolId = userId ? await resolveUserSchoolId(userId, schoolId) : schoolId ?? null;
    const loan =
      userId && resolvedSchoolId
        ? await fetchCanonicalUserSchoolDocument<LibraryLoan>({
            uid: userId,
            schoolId: resolvedSchoolId,
            canonicalCollection: "libraryLoans",
            docId: loanId,
            fallbackRootCollection: "libraryLoans",
          })
        : await fetchDocument<LibraryLoan>("libraryLoans", loanId);
    if (!loan) throw new Error("借閱記錄不存在");
    if (loan.renewCount >= 2) throw new Error("已達續借上限");
    
    const newDueDate = new Date(loan.dueAt);
    newDueDate.setDate(newDueDate.getDate() + 7);
    
    if (userId && resolvedSchoolId) {
      await updateDocumentAtPath<LibraryLoan>(
        buildUserSchoolCollectionPath(userId, resolvedSchoolId, "libraryLoans", loanId),
        {
          dueAt: newDueDate.toISOString(),
          renewCount: loan.renewCount + 1,
        }
      );
      return (
        await fetchCanonicalUserSchoolDocument<LibraryLoan>({
          uid: userId,
          schoolId: resolvedSchoolId,
          canonicalCollection: "libraryLoans",
          docId: loanId,
          fallbackRootCollection: "libraryLoans",
        })
      ) as LibraryLoan;
    }

    return updateDocument<LibraryLoan>("libraryLoans", loanId, {
      dueAt: newDueDate.toISOString(),
      renewCount: loan.renewCount + 1,
    });
  },

  // ===== 圖書館座位 =====
  async listSeats(schoolId, zone) {
    const constraints: (QueryConstraint | null)[] = [];
    if (zone) {
      constraints.push(where("zone", "==", zone));
    }
    return fetchCanonicalSchoolCollection<LibrarySeat>({
      schoolId,
      canonicalCollections: ["librarySeats"],
      schoolConstraints: constraints,
      fallbackCollection: "librarySeats",
      fallbackConstraints: [bySchool(schoolId), ...constraints],
    });
  },

  async listSeatReservations(userId, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    const constraints: (QueryConstraint | null)[] = [byUser(userId), where("status", "==", "active")];
    return fetchCanonicalUserSchoolCollection<SeatReservation>({
      uid: userId,
      schoolId: resolvedSchoolId,
      canonicalCollection: "seatReservations",
      canonicalConstraints: constraints,
      fallbackRootCollection: "seatReservations",
      fallbackRootConstraints: constraints,
    });
  },

  async reserveSeat(seatId, userId, date, startTime, endTime, schoolId = undefined) {
    const db = getDb();
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    if (!resolvedSchoolId) {
      throw new Error("缺少 schoolId，無法預約座位");
    }
    
    const conflicting = await getDocs(
      query(
        collectionFromSegments(db, buildUserSchoolCollectionPath(userId, resolvedSchoolId, "seatReservations")),
        where("seatId", "==", seatId),
        where("date", "==", date),
        where("status", "==", "active")
      )
    );
    
    if (!conflicting.empty) {
      throw new Error("該時段座位已被預約");
    }
    
    return createDocumentAtPath<SeatReservation>(
      buildUserSchoolCollectionPath(userId, resolvedSchoolId, "seatReservations"),
      {
        seatId,
        userId,
        schoolId: resolvedSchoolId,
        date,
        startTime,
        endTime,
        status: "active",
      } as Omit<SeatReservation, "id">
    );
  },

  async cancelSeatReservation(id, userId = undefined, schoolId = undefined) {
    const resolvedSchoolId = userId ? await resolveUserSchoolId(userId, schoolId) : schoolId ?? null;
    if (userId && resolvedSchoolId) {
      await updateDocumentAtPath<SeatReservation>(
        buildUserSchoolCollectionPath(userId, resolvedSchoolId, "seatReservations", id),
        { status: "cancelled" }
      );
      return;
    }

    await updateDocument<SeatReservation>("seatReservations", id, { status: "cancelled" });
  },

  // ===== 公車 =====
  async listBusRoutes(schoolId) {
    return fetchCanonicalSchoolCollection<BusRoute>({
      schoolId,
      canonicalCollections: ["busRoutes"],
      schoolConstraints: [where("isActive", "==", true)],
      fallbackCollection: "busRoutes",
      fallbackConstraints: [bySchool(schoolId), where("isActive", "==", true)],
    });
  },

  async getBusRoute(id) {
    return fetchDocument<BusRoute>("busRoutes", id);
  },

  async getBusArrivals(stopId) {
    return fetchCollection<BusArrival>(
      "busArrivals",
      [where("stopId", "==", stopId)]
    );
  },

  // ===== 通知 =====
  async listNotifications(userId, options) {
    return fetchCollection<Notification>(
      "notifications",
      [byUser(userId), orderBy("createdAt", "desc")],
      undefined,
      options
    );
  },

  async markNotificationRead(id) {
    await updateDocument<Notification>("notifications", id, { read: true });
  },

  async markAllNotificationsRead(userId) {
    const db = getDb();
    const unread = await getDocs(
      query(
        collection(db, "notifications"),
        where("userId", "==", userId),
        where("read", "==", false)
      )
    );
    
    const batch = writeBatch(db);
    unread.docs.forEach((d) => batch.update(d.ref, { read: true }));
    await batch.commit();
  },

  async deleteNotification(id) {
    await deleteDocument("notifications", id);
  },

  // ===== 行事曆 =====
  async listCalendarEvents(userId, startDate, endDate, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    const constraints: (QueryConstraint | null)[] = [
      byUser(userId),
      where("startAt", ">=", startDate),
      where("startAt", "<=", endDate),
      orderBy("startAt", "asc"),
    ];
    return fetchCanonicalUserSchoolCollection<CalendarEvent>({
      uid: userId,
      schoolId: resolvedSchoolId,
      canonicalCollection: "calendarEvents",
      canonicalConstraints: constraints,
      fallbackRootCollection: "calendarEvents",
      fallbackRootConstraints: constraints,
    });
  },

  async createCalendarEvent(data) {
    if (!data.userId) {
      throw new Error("缺少 userId，無法建立行事曆事件");
    }
    const resolvedSchoolId = await resolveUserSchoolId(data.userId, (data as any).schoolId);
    if (!resolvedSchoolId) {
      throw new Error("缺少 schoolId，無法建立行事曆事件");
    }

    return createDocumentAtPath<CalendarEvent>(
      buildUserSchoolCollectionPath(data.userId, resolvedSchoolId, "calendarEvents"),
      {
        ...(data as Omit<CalendarEvent, "id">),
      }
    );
  },

  async updateCalendarEvent(id, data, userId = undefined, schoolId = undefined) {
    const ownerId = userId ?? data.userId;
    const resolvedSchoolId = ownerId ? await resolveUserSchoolId(ownerId, schoolId ?? (data as any).schoolId) : null;
    if (ownerId && resolvedSchoolId) {
      await updateDocumentAtPath<CalendarEvent>(
        buildUserSchoolCollectionPath(ownerId, resolvedSchoolId, "calendarEvents", id),
        data
      );
      return (
        await fetchCanonicalUserSchoolDocument<CalendarEvent>({
          uid: ownerId,
          schoolId: resolvedSchoolId,
          canonicalCollection: "calendarEvents",
          docId: id,
          fallbackRootCollection: "calendarEvents",
        })
      ) as CalendarEvent;
    }

    return updateDocument<CalendarEvent>("calendarEvents", id, data);
  },

  async deleteCalendarEvent(id, userId = undefined, schoolId = undefined) {
    const resolvedSchoolId = userId ? await resolveUserSchoolId(userId, schoolId) : schoolId ?? null;
    if (userId && resolvedSchoolId) {
      await deleteDocumentAtPath(buildUserSchoolCollectionPath(userId, resolvedSchoolId, "calendarEvents", id));
      return;
    }
    await deleteDocument("calendarEvents", id);
  },

  async syncCoursesToCalendar(userId, semester, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    const enrollments = await this.listEnrollments(userId, semester, resolvedSchoolId ?? undefined);
    const db = getDb();
    
    for (const enrollment of enrollments) {
      if (enrollment.status !== "enrolled") continue;
      
      const course = await this.getCourse(enrollment.courseId);
      if (!course) continue;
      
      for (const schedule of course.schedule) {
        if (!resolvedSchoolId) continue;
        await addDoc(collectionFromSegments(db, buildUserSchoolCollectionPath(userId, resolvedSchoolId, "calendarEvents")), {
          userId,
          schoolId: resolvedSchoolId,
          title: course.name,
          description: `${course.code} - ${course.instructor}`,
          startAt: schedule.startTime,
          endAt: schedule.endTime,
          location: schedule.location,
          type: "class",
          sourceId: course.id,
          sourceType: "course",
          recurrence: {
            frequency: "weekly",
            byDays: [schedule.dayOfWeek],
          },
          createdAt: serverTimestamp(),
        });
      }
    }
  },

  // ===== 訂單與支付 =====
  async listOrders(userId, options, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    const constraints: (QueryConstraint | null)[] = [byUser(userId), orderBy("createdAt", "desc")];

    if (resolvedSchoolId) {
      const canonicalRows = await fetchCanonicalUserSchoolCollection<Order>({
        uid: userId,
        schoolId: resolvedSchoolId,
        canonicalCollection: "orders",
        canonicalConstraints: constraints,
        fallbackRootCollection: "orders",
        fallbackRootConstraints: constraints,
        options,
      });
      if (canonicalRows.length > 0) {
        return canonicalRows;
      }

      try {
        return fetchCollectionAtPath<Order>(
          buildSchoolCollectionPath(resolvedSchoolId, "orders"),
          constraints,
          options
        );
      } catch (error) {
        console.warn("[firebaseSource] listOrders school orders fallback failed:", error);
      }
    }

    return fetchCollection<Order>("orders", constraints, undefined, options);
  },

  async getOrder(id, userId = undefined, schoolId = undefined) {
    const resolvedSchoolId = userId ? await resolveUserSchoolId(userId, schoolId) : schoolId ?? null;
    if (userId && resolvedSchoolId) {
      const canonicalOrder = await fetchCanonicalUserSchoolDocument<Order>({
        uid: userId,
        schoolId: resolvedSchoolId,
        canonicalCollection: "orders",
        docId: id,
        fallbackRootCollection: "orders",
      });
      if (canonicalOrder) {
        return canonicalOrder;
      }
      return fetchDocumentAtPath<Order>(buildSchoolCollectionPath(resolvedSchoolId, "orders", id));
    }
    return fetchDocument<Order>("orders", id);
  },

  async createOrder(data) {
    const resolvedSchoolId = await resolveUserSchoolId(data.userId, (data as any).schoolId);
    if (!resolvedSchoolId) {
      throw new Error("缺少 schoolId，無法建立訂單");
    }

    const db = getDb();
    const schoolOrdersRef = collectionFromSegments(db, buildSchoolCollectionPath(resolvedSchoolId, "orders"));
    const schoolOrderRef = doc(schoolOrdersRef);
    const orderPayload = {
      ...data,
      schoolId: resolvedSchoolId,
      status: "pending",
      paymentStatus: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(schoolOrderRef, orderPayload);
    await setDoc(
      docFromSegments(db, buildUserSchoolCollectionPath(data.userId, resolvedSchoolId, "orders", schoolOrderRef.id)),
      orderPayload,
      { merge: true }
    );

    return (await fetchDocumentAtPath<Order>(buildUserSchoolCollectionPath(data.userId, resolvedSchoolId, "orders", schoolOrderRef.id))) as Order;
  },

  async updateOrderStatus(id, status, userId = undefined, schoolId = undefined) {
    const resolvedSchoolId = userId ? await resolveUserSchoolId(userId, schoolId) : schoolId ?? null;
    if (userId && resolvedSchoolId) {
      await updateDocumentAtPath<Order>(buildUserSchoolCollectionPath(userId, resolvedSchoolId, "orders", id), { status });
      await updateDocumentAtPath<Order>(buildSchoolCollectionPath(resolvedSchoolId, "orders", id), { status });
      return (
        await fetchCanonicalUserSchoolDocument<Order>({
          uid: userId,
          schoolId: resolvedSchoolId,
          canonicalCollection: "orders",
          docId: id,
          fallbackRootCollection: "orders",
        })
      ) as Order;
    }

    return updateDocument<Order>("orders", id, { status });
  },

  async cancelOrder(id, userId = undefined, schoolId = undefined) {
    const resolvedSchoolId = userId ? await resolveUserSchoolId(userId, schoolId) : schoolId ?? null;
    if (userId && resolvedSchoolId) {
      await updateDocumentAtPath<Order>(buildUserSchoolCollectionPath(userId, resolvedSchoolId, "orders", id), {
        status: "cancelled",
      });
      await updateDocumentAtPath<Order>(buildSchoolCollectionPath(resolvedSchoolId, "orders", id), {
        status: "cancelled",
      });
      return;
    }
    await updateDocument<Order>("orders", id, { status: "cancelled" });
  },

  async listTransactions(userId, options, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    try {
      const getTransactionHistory = httpsCallable<
        { schoolId?: string; limit?: number; type?: string },
        { transactions?: Array<Record<string, unknown>> }
      >(getFunctionsInstance(), "getTransactionHistory");
      const result = await getTransactionHistory({
        schoolId: resolvedSchoolId ?? undefined,
        limit: options?.pageSize ?? DEFAULT_PAGE_SIZE,
      });

      const rows = Array.isArray(result.data?.transactions) ? result.data.transactions : [];
      return rows.map((row) => ({
        id: String(row.id ?? ""),
        userId,
        amount: Number(row.amount ?? 0),
        currency: String(row.currency ?? "TWD"),
        type: (String(row.type ?? "payment") as Transaction["type"]),
        status: (String(row.status ?? "pending") as Transaction["status"]),
        description: String(row.description ?? "交易"),
        merchantId: typeof row.merchantId === "string" ? row.merchantId : undefined,
        merchantName: typeof row.merchantName === "string" ? row.merchantName : undefined,
        paymentMethodId:
          typeof row.paymentMethod === "string"
            ? row.paymentMethod
            : typeof row.paymentMethodId === "string"
              ? row.paymentMethodId
              : undefined,
        createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
        completedAt: typeof row.completedAt === "string" ? row.completedAt : undefined,
      }));
    } catch (error) {
      console.warn("[firebaseSource] listTransactions callable failed, falling back:", error);
      const constraints: (QueryConstraint | null)[] = [byUser(userId), orderBy("createdAt", "desc")];
      return fetchCanonicalUserSchoolCollection<Transaction>({
        uid: userId,
        schoolId: resolvedSchoolId,
        canonicalCollection: "transactions",
        canonicalConstraints: constraints,
        fallbackRootCollection: "transactions",
        fallbackRootConstraints: constraints,
        options,
      });
    }
  },

  // ===== 成就 =====
  async listAchievements() {
    return fetchCollection<UserAchievement>("achievements", []);
  },

  async getUserAchievements(userId, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    return fetchCanonicalUserSchoolCollection<UserAchievement>({
      uid: userId,
      schoolId: resolvedSchoolId,
      canonicalCollection: "achievements",
      canonicalConstraints: [orderBy("updatedAt", "desc")],
      fallbackUserCollection: "achievements",
      fallbackUserConstraints: [orderBy("updatedAt", "desc")],
      fallbackRootCollection: "userAchievements",
      fallbackRootConstraints: [byUser(userId)],
    });
  },

  async updateAchievementProgress(userId, achievementId, progress, schoolId = undefined) {
    const db = getDb();
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    if (!resolvedSchoolId) {
      throw new Error("缺少 schoolId，無法更新成就");
    }

    const ref = docFromSegments(db, buildUserSchoolCollectionPath(userId, resolvedSchoolId, "achievements", achievementId));
    const existing = await getDoc(ref);
    const achievement = await fetchDocument<Achievement>("achievements", achievementId);
    const completed = achievement ? progress >= achievement.requirement : false;
    
    if (existing.exists()) {
      await updateDoc(ref, {
        progress,
        completed,
        ...(completed && !existing.data().completed ? { unlockedAt: serverTimestamp() } : {}),
      });
    } else {
      await setDoc(ref, {
        userId,
        achievementId,
        progress,
        completed,
        ...(completed ? { unlockedAt: serverTimestamp() } : {}),
      });
    }
    
    return (await fetchDocumentAtPath<UserAchievement>(
      buildUserSchoolCollectionPath(userId, resolvedSchoolId, "achievements", achievementId)
    )) as UserAchievement;
  },

  // ===== 宿舍服務 =====
  async getDormitoryInfo(userId) {
    const docs = await fetchCollection<DormitoryInfo>(
      "dormitoryInfo",
      [byUser(userId)]
    );
    return docs[0] ?? null;
  },

  async listRepairRequests(userId, options) {
    return fetchCollection<RepairRequest>(
      "repairRequests",
      [byUser(userId), orderBy("createdAt", "desc")],
      undefined,
      options
    );
  },

  async createRepairRequest(data) {
    return createDocument<RepairRequest>("repairRequests", {
      ...data,
      status: "pending",
    } as Omit<RepairRequest, "id">);
  },

  async updateRepairRequest(id, data) {
    return updateDocument<RepairRequest>("repairRequests", id, data);
  },

  async cancelRepairRequest(id) {
    await updateDocument<RepairRequest>("repairRequests", id, { status: "cancelled" });
  },

  async listDormPackages(userId, options) {
    return fetchCollection<DormPackage>(
      "dormPackages",
      [byUser(userId), orderBy("arrivedAt", "desc")],
      undefined,
      options
    );
  },

  async confirmPackagePickup(id) {
    await updateDocument<DormPackage>("dormPackages", id, {
      status: "picked",
      pickedAt: new Date().toISOString(),
    });
  },

  async listWashingMachines(schoolId, building) {
    const constraints: (QueryConstraint | null)[] = [bySchool(schoolId)];
    if (building) {
      constraints.push(where("building", "==", building));
    }
    return fetchCollection<WashingMachine>("washingMachines", constraints, schoolId);
  },

  async listWashingReservations(userId) {
    return fetchCollection<WashingReservation>(
      "washingReservations",
      [byUser(userId), where("status", "in", ["reserved", "inUse"])]
    );
  },

  async reserveWashingMachine(machineId, userId) {
    const db = getDb();
    const machine = await fetchDocument<WashingMachine>("washingMachines", machineId);
    if (!machine || machine.status !== "available") {
      throw new Error("洗衣機目前不可預約");
    }
    
    const reservation = await createDocument<WashingReservation>("washingReservations", {
      machineId,
      userId,
      startTime: new Date().toISOString(),
      status: "reserved",
    } as Omit<WashingReservation, "id">);
    
    const reservedUntil = new Date();
    reservedUntil.setMinutes(reservedUntil.getMinutes() + 10);
    
    await updateDoc(doc(db, "washingMachines", machineId), {
      status: "reserved",
      reservedBy: userId,
      reservedUntil: reservedUntil.toISOString(),
    });
    
    return reservation;
  },

  async cancelWashingReservation(id) {
    const reservation = await fetchDocument<WashingReservation>("washingReservations", id);
    if (!reservation) throw new Error("預約不存在");
    
    const db = getDb();
    await updateDocument<WashingReservation>("washingReservations", id, { status: "cancelled" });
    await updateDoc(doc(db, "washingMachines", reservation.machineId), {
      status: "available",
      reservedBy: null,
      reservedUntil: null,
    });
  },

  async listDormAnnouncements(schoolId, building) {
    const constraints: (QueryConstraint | null)[] = [
      bySchool(schoolId),
      orderBy("publishedAt", "desc"),
    ];
    if (building) {
      constraints.push(where("building", "==", building));
    }
    return fetchCollection<DormAnnouncement>("dormAnnouncements", constraints, schoolId);
  },

  // ===== 列印服務 =====
  async listPrinters(schoolId, options) {
    return fetchCollection<Printer>(
      "printers",
      [bySchool(schoolId)],
      schoolId,
      options
    );
  },

  async getPrinter(id) {
    return fetchDocument<Printer>("printers", id);
  },

  async listPrintJobs(userId, options) {
    return fetchCollection<PrintJob>(
      "printJobs",
      [byUser(userId), orderBy("createdAt", "desc")],
      undefined,
      options
    );
  },

  async createPrintJob(data) {
    const printer = data.printerId ? await this.getPrinter(data.printerId) : null;
    const pricePerPage = printer?.pricePerPage ?? { bw: 1, color: 5 };
    const pages = data.pages || 1;
    const copies = data.copies || 1;
    const cost = data.color ? pages * copies * pricePerPage.color : pages * copies * pricePerPage.bw;
    
    const db = getDb();
    const job = await createDocument<PrintJob>("printJobs", {
      ...data,
      status: "pending",
      cost,
    } as Omit<PrintJob, "id">);
    
    if (data.printerId) {
      await updateDoc(doc(db, "printers", data.printerId), {
        queueLength: increment(1),
      });
    }
    
    return job;
  },

  async cancelPrintJob(id) {
    const job = await fetchDocument<PrintJob>("printJobs", id);
    if (!job) throw new Error("列印工作不存在");
    if (job.status !== "pending") throw new Error("只能取消待處理的列印工作");
    
    const db = getDb();
    await updateDocument<PrintJob>("printJobs", id, { status: "cancelled" });
    
    if (job.printerId) {
      await updateDoc(doc(db, "printers", job.printerId), {
        queueLength: increment(-1),
      });
    }
  },

  // ===== 健康服務 =====
  async listHealthAppointments(userId, options) {
    return fetchCollection<HealthAppointment>(
      "healthAppointments",
      [byUser(userId), orderBy("date", "desc")],
      undefined,
      options
    );
  },

  async createHealthAppointment(data) {
    return createDocument<HealthAppointment>("healthAppointments", {
      ...data,
      status: "scheduled",
    } as Omit<HealthAppointment, "id">);
  },

  async cancelHealthAppointment(id) {
    await updateDocument<HealthAppointment>("healthAppointments", id, { status: "cancelled" });
  },

  async rescheduleHealthAppointment(id, data) {
    return updateDocument<HealthAppointment>("healthAppointments", id, {
      date: data.date,
      timeSlot: data.timeSlot,
      ...(data.doctorId ? { doctorId: data.doctorId } : {}),
      ...(data.doctorName ? { doctorName: data.doctorName } : {}),
      status: "scheduled",
    });
  },

  async listHealthRecords(userId, options) {
    return fetchCollection<HealthRecord>(
      "healthRecords",
      [byUser(userId), orderBy("date", "desc")],
      undefined,
      options
    );
  },

  async listHealthTimeSlots(department, date, schoolId) {
    return fetchCollection<HealthTimeSlot>(
      "healthTimeSlots",
      [
        bySchool(schoolId),
        where("department", "==", department),
        where("date", "==", date),
      ],
      schoolId
    );
  },

  async createAccessApplication(data) {
    const db = getDb();
    const docRef = await addDoc(collection(db, "accessApplications"), {
      ...data,
      status: "pending",
      createdAt: serverTimestamp(),
    });

    return {
      id: docRef.id,
      status: "pending" as const,
    };
  },

  async createLateReturnRecord(data) {
    const db = getDb();
    const docRef = await addDoc(collection(db, "lateReturnRecords"), {
      ...data,
      createdAt: serverTimestamp(),
    });

    return { id: docRef.id };
  },

  async createVisitorRecord(data) {
    const db = getDb();
    const docRef = await addDoc(collection(db, "visitorRecords"), {
      ...data,
      createdAt: serverTimestamp(),
    });

    return { id: docRef.id };
  },

  // ===== 安全支付操作 =====
  // 這些操作必須通過後端 Cloud Function 處理，確保餘額更新的安全性
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
    if (!getAuthInstance().currentUser) {
      return {
        success: false,
        errorCode: "AUTH_ERROR",
        errorMessage: "請先登入",
      };
    }

    const normalizedPaymentMethod =
      data.paymentMethod === "mobile_pay"
        ? "linepay"
        : data.paymentMethod === "credit_card"
          ? "credit_card"
          : data.paymentMethod === "student_card"
            ? "linepay"
            : data.paymentMethod;

    try {
      const createTopupIntent = httpsCallable<
        { amount: number; paymentMethod: string },
        {
          success?: boolean;
          newBalance?: number;
          transactionId?: string;
          intentId?: string;
          errorCode?: string;
          errorMessage?: string;
          status?: string;
        }
      >(getFunctionsInstance(), "createTopupIntent");
      const result = await createTopupIntent({
        amount: data.amount,
        paymentMethod: normalizedPaymentMethod,
      });

      const payload = result.data ?? {};
      if (!payload.success) {
        return {
          success: false,
          errorCode:
            payload.errorCode ??
            (payload.status === "provider_disabled"
              ? "EXTERNAL_PROVIDER_DISABLED"
              : "PAYMENT_PROVIDER_UNAVAILABLE"),
          errorMessage:
            payload.errorMessage ??
            "外部儲值服務尚未開通，請等待支付供應商完成設定。",
        };
      }

      return {
        success: true,
        newBalance: payload.newBalance,
        transactionId:
          (typeof payload.transactionId === "string" ? payload.transactionId : undefined) ??
          (typeof payload.intentId === "string" ? payload.intentId : undefined),
      };
    } catch (error: any) {
      console.error("[firebaseSource] processTopup error:", error);
      return {
        success: false,
        errorCode: error?.code ?? "NETWORK_ERROR",
        errorMessage: error?.message ?? "儲值失敗，請稍後再試",
      };
    }
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
    if (!getAuthInstance().currentUser) {
      return {
        success: false,
        errorCode: "AUTH_ERROR",
        errorMessage: "請先登入",
      };
    }

    const normalizedPaymentMethod =
      data.paymentMethod === "student_card"
        ? "campus_card"
        : data.paymentMethod === "mobile_pay"
          ? "linepay"
          : data.paymentMethod === "credit_card"
            ? "credit_card"
            : data.paymentMethod;

    try {
      const createPaymentIntent = httpsCallable<
        {
          amount: number;
          paymentMethod: string;
          merchantId: string;
          description: string;
        },
        {
          success?: boolean;
          newBalance?: number;
          transactionId?: string;
          intentId?: string;
          errorCode?: string;
          errorMessage?: string;
          status?: string;
        }
      >(getFunctionsInstance(), "createPaymentIntent");
      const result = await createPaymentIntent({
        amount: data.amount,
        paymentMethod: normalizedPaymentMethod,
        merchantId: data.merchantId,
        description: data.description,
      });

      const payload = result.data ?? {};
      if (!payload.success) {
        return {
          success: false,
          errorCode:
            payload.errorCode ??
            (payload.status === "provider_disabled"
              ? "EXTERNAL_PROVIDER_DISABLED"
              : "PAYMENT_FAILED"),
          errorMessage:
            payload.errorMessage ??
            "支付失敗，請稍後再試",
        };
      }

      return {
        success: true,
        newBalance: payload.newBalance,
        transactionId:
          (typeof payload.transactionId === "string" ? payload.transactionId : undefined) ??
          (typeof payload.intentId === "string" ? payload.intentId : undefined),
      };
    } catch (error: any) {
      console.error("[firebaseSource] processPayment error:", error);
      return {
        success: false,
        errorCode: error?.code ?? "NETWORK_ERROR",
        errorMessage: error?.message ?? "支付失敗，請稍後再試",
      };
    }
  },
};
