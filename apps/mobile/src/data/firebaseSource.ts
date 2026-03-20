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
import { getDb } from "../firebase";
import { buildSchoolCollectionPath } from "@campus/shared/src";
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
    const qy = query(collection(db, ...pathSegments), ...finalConstraints);
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
  data: Omit<T, "id">
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
  async listEnrollments(userId, semester) {
    const constraints: (QueryConstraint | null)[] = [byUser(userId)];
    if (semester) {
      constraints.push(where("semester", "==", semester));
    }
    return fetchCollection<Enrollment>("enrollments", constraints);
  },

  async enrollCourse(userId, courseId, semester) {
    return createDocument<Enrollment>("enrollments", {
      userId,
      courseId,
      semester,
      status: "enrolled",
    } as Omit<Enrollment, "id">);
  },

  async dropCourse(enrollmentId) {
    await updateDocument<Enrollment>("enrollments", enrollmentId, { status: "dropped" });
  },

  // ===== 成績 =====
  async listGrades(userId, semester) {
    const constraints: (QueryConstraint | null)[] = [byUser(userId)];
    if (semester) {
      constraints.push(where("semester", "==", semester));
    }
    constraints.push(orderBy("publishedAt", "desc"));
    return fetchCollection<Grade>("grades", constraints);
  },

  async getGPA(userId) {
    const grades = await this.listGrades(userId);
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
    const memberDocs = await fetchCollection<GroupMember>(
      "groupMembers",
      [byUser(userId)]
    );
    const groupIds = memberDocs.map((m) => m.groupId);
    
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
    const db = getDb();
    const groupRef = await addDoc(collection(db, "groups"), {
      ...data,
      memberCount: 1,
      createdAt: serverTimestamp(),
    });
    
    await addDoc(collection(db, "groupMembers"), {
      groupId: groupRef.id,
      userId: data.createdBy,
      role: "owner",
      joinedAt: serverTimestamp(),
    });
    
    return { ...data, id: groupRef.id, memberCount: 1, createdAt: new Date().toISOString() } as Group;
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
    if (group.isPrivate && group.joinCode !== joinCode) {
      throw new Error("加入碼錯誤");
    }
    
    const db = getDb();
    const groupRef = doc(db, "groups", groupId);
    const memberRef = await addDoc(collection(db, "groupMembers"), {
      groupId,
      userId,
      role: "member",
      joinedAt: serverTimestamp(),
    });
    
    await updateDoc(groupRef, { memberCount: increment(1) });
    
    return {
      id: memberRef.id,
      groupId,
      userId,
      role: "member",
      joinedAt: new Date().toISOString(),
    };
  },

  async leaveGroup(groupId, userId) {
    const db = getDb();
    const membersSnap = await getDocs(
      query(
        collection(db, "groupMembers"),
        where("groupId", "==", groupId),
        where("userId", "==", userId)
      )
    );
    
    if (!membersSnap.empty) {
      const batch = writeBatch(db);
      membersSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.update(doc(db, "groups", groupId), { memberCount: increment(-1) });
      await batch.commit();
    }
  },

  // ===== 群組成員 =====
  async listGroupMembers(groupId, options) {
    return fetchCollection<GroupMember>(
      "groupMembers",
      [where("groupId", "==", groupId)],
      undefined,
      options
    );
  },

  async updateMemberRole(groupId, userId, role) {
    const db = getDb();
    const membersSnap = await getDocs(
      query(
        collection(db, "groupMembers"),
        where("groupId", "==", groupId),
        where("userId", "==", userId)
      )
    );
    
    if (!membersSnap.empty) {
      await updateDoc(membersSnap.docs[0].ref, { role });
    }
  },

  async removeMember(groupId, userId) {
    await this.leaveGroup(groupId, userId);
  },

  // ===== 群組貼文 =====
  async listGroupPosts(groupId, options) {
    return fetchCollection<GroupPost>(
      "groupPosts",
      [where("groupId", "==", groupId), orderBy("createdAt", "desc")],
      undefined,
      options
    );
  },

  async getGroupPost(id) {
    return fetchDocument<GroupPost>("groupPosts", id);
  },

  async createGroupPost(data) {
    return createDocument<GroupPost>("groupPosts", {
      ...data,
      likeCount: 0,
      commentCount: 0,
    } as Omit<GroupPost, "id">);
  },

  async updateGroupPost(id, data) {
    return updateDocument<GroupPost>("groupPosts", id, data);
  },

  async deleteGroupPost(id) {
    await deleteDocument("groupPosts", id);
  },

  async likePost(postId, userId) {
    const db = getDb();
    const likeRef = doc(db, "postLikes", `${postId}_${userId}`);
    const postRef = doc(db, "groupPosts", postId);
    
    const batch = writeBatch(db);
    batch.set(likeRef, { postId, userId, createdAt: serverTimestamp() });
    batch.update(postRef, { likeCount: increment(1) });
    await batch.commit();
  },

  async unlikePost(postId, userId) {
    const db = getDb();
    const likeRef = doc(db, "postLikes", `${postId}_${userId}`);
    const postRef = doc(db, "groupPosts", postId);
    
    const batch = writeBatch(db);
    batch.delete(likeRef);
    batch.update(postRef, { likeCount: increment(-1) });
    await batch.commit();
  },

  // ===== 留言 =====
  async listComments(postId, options) {
    return fetchCollection<Comment>(
      "comments",
      [where("postId", "==", postId), orderBy("createdAt", "asc")],
      undefined,
      options
    );
  },

  async createComment(data) {
    const db = getDb();
    const comment = await createDocument<Comment>("comments", {
      ...data,
      likeCount: 0,
    } as Omit<Comment, "id">);
    
    await updateDoc(doc(db, "groupPosts", data.postId), {
      commentCount: increment(1),
    });
    
    return comment;
  },

  async deleteComment(id) {
    const comment = await fetchDocument<Comment>("comments", id);
    if (comment) {
      const db = getDb();
      await deleteDocument("comments", id);
      await updateDoc(doc(db, "groupPosts", comment.postId), {
        commentCount: increment(-1),
      });
    }
  },

  // ===== 作業 =====
  async listAssignments(groupId, options) {
    return fetchCollection<Assignment>(
      "assignments",
      [where("groupId", "==", groupId), orderBy("dueAt", "asc")],
      undefined,
      options
    );
  },

  async getAssignment(id) {
    return fetchDocument<Assignment>("assignments", id);
  },

  async createAssignment(data) {
    return createDocument<Assignment>("assignments", {
      ...data,
      submissionCount: 0,
    } as Omit<Assignment, "id">);
  },

  async updateAssignment(id, data) {
    return updateDocument<Assignment>("assignments", id, data);
  },

  async deleteAssignment(id) {
    await deleteDocument("assignments", id);
  },

  // ===== 作業繳交 =====
  async listSubmissions(assignmentId, options) {
    return fetchCollection<Submission>(
      "submissions",
      [where("assignmentId", "==", assignmentId)],
      undefined,
      options
    );
  },

  async getSubmission(assignmentId, userId) {
    const submissions = await fetchCollection<Submission>(
      "submissions",
      [where("assignmentId", "==", assignmentId), where("userId", "==", userId)]
    );
    return submissions[0] ?? null;
  },

  async submitAssignment(data) {
    const db = getDb();
    const submission = await createDocument<Submission>("submissions", {
      ...data,
      status: "submitted",
      submittedAt: new Date().toISOString(),
    } as Omit<Submission, "id">);
    
    await updateDoc(doc(db, "assignments", data.assignmentId), {
      submissionCount: increment(1),
    });
    
    return submission;
  },

  async gradeSubmission(id, grade, feedback) {
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Omit<Conversation, "id">);
  },

  async listMessages(conversationId, options) {
    return fetchCollection<Message>(
      "messages",
      [where("conversationId", "==", conversationId), orderBy("createdAt", "asc")],
      undefined,
      options
    );
  },

  async sendMessage(data) {
    const db = getDb();
    const message = await createDocument<Message>("messages", data as Omit<Message, "id">);
    
    await updateDoc(doc(db, "conversations", data.conversationId), {
      lastMessage: message,
      updatedAt: serverTimestamp(),
    });
    
    return message;
  },

  async markMessageRead(messageId, userId) {
    const db = getDb();
    await updateDoc(doc(db, "messages", messageId), {
      readBy: arrayUnion(userId),
    });
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

  async listLoans(userId) {
    return fetchCollection<LibraryLoan>(
      "libraryLoans",
      [byUser(userId), where("status", "!=", "returned")]
    );
  },

  async borrowBook(bookId, userId) {
    const db = getDb();
    const book = await this.getBook(bookId);
    if (!book || book.available <= 0) {
      throw new Error("書籍不可借閱");
    }
    
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14);
    
    const loan = await createDocument<LibraryLoan>("libraryLoans", {
      userId,
      bookId,
      borrowedAt: new Date().toISOString(),
      dueAt: dueDate.toISOString(),
      renewCount: 0,
      status: "borrowed",
    } as Omit<LibraryLoan, "id">);
    
    await updateDoc(doc(db, "libraryBooks", bookId), {
      available: increment(-1),
    });
    
    return loan;
  },

  async returnBook(loanId) {
    const loan = await fetchDocument<LibraryLoan>("libraryLoans", loanId);
    if (!loan) throw new Error("借閱記錄不存在");
    
    const db = getDb();
    await updateDoc(doc(db, "libraryLoans", loanId), {
      status: "returned",
      returnedAt: serverTimestamp(),
    });
    
    await updateDoc(doc(db, "libraryBooks", loan.bookId), {
      available: increment(1),
    });
  },

  async renewBook(loanId) {
    const loan = await fetchDocument<LibraryLoan>("libraryLoans", loanId);
    if (!loan) throw new Error("借閱記錄不存在");
    if (loan.renewCount >= 2) throw new Error("已達續借上限");
    
    const newDueDate = new Date(loan.dueAt);
    newDueDate.setDate(newDueDate.getDate() + 7);
    
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

  async listSeatReservations(userId) {
    return fetchCollection<SeatReservation>(
      "seatReservations",
      [byUser(userId), where("status", "==", "active")]
    );
  },

  async reserveSeat(seatId, userId, date, startTime, endTime) {
    const db = getDb();
    
    const conflicting = await getDocs(
      query(
        collection(db, "seatReservations"),
        where("seatId", "==", seatId),
        where("date", "==", date),
        where("status", "==", "active")
      )
    );
    
    if (!conflicting.empty) {
      throw new Error("該時段座位已被預約");
    }
    
    return createDocument<SeatReservation>("seatReservations", {
      seatId,
      userId,
      date,
      startTime,
      endTime,
      status: "active",
    } as Omit<SeatReservation, "id">);
  },

  async cancelSeatReservation(id) {
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
  async listCalendarEvents(userId, startDate, endDate) {
    return fetchCollection<CalendarEvent>(
      "calendarEvents",
      [
        byUser(userId),
        where("startAt", ">=", startDate),
        where("startAt", "<=", endDate),
        orderBy("startAt", "asc"),
      ]
    );
  },

  async createCalendarEvent(data) {
    return createDocument<CalendarEvent>("calendarEvents", data as Omit<CalendarEvent, "id">);
  },

  async updateCalendarEvent(id, data) {
    return updateDocument<CalendarEvent>("calendarEvents", id, data);
  },

  async deleteCalendarEvent(id) {
    await deleteDocument("calendarEvents", id);
  },

  async syncCoursesToCalendar(userId, semester) {
    const enrollments = await this.listEnrollments(userId, semester);
    const db = getDb();
    
    for (const enrollment of enrollments) {
      if (enrollment.status !== "enrolled") continue;
      
      const course = await this.getCourse(enrollment.courseId);
      if (!course) continue;
      
      for (const schedule of course.schedule) {
        await addDoc(collection(db, "calendarEvents"), {
          userId,
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
  async listOrders(userId, options) {
    return fetchCollection<Order>(
      "orders",
      [byUser(userId), orderBy("createdAt", "desc")],
      undefined,
      options
    );
  },

  async getOrder(id) {
    return fetchDocument<Order>("orders", id);
  },

  async createOrder(data) {
    return createDocument<Order>("orders", {
      ...data,
      status: "pending",
      paymentStatus: "pending",
    } as Omit<Order, "id">);
  },

  async updateOrderStatus(id, status) {
    return updateDocument<Order>("orders", id, { status });
  },

  async cancelOrder(id) {
    await updateDocument<Order>("orders", id, { status: "cancelled" });
  },

  async listTransactions(userId, options) {
    return fetchCollection<Transaction>(
      "transactions",
      [byUser(userId), orderBy("createdAt", "desc")],
      undefined,
      options
    );
  },

  // ===== 成就 =====
  async listAchievements() {
    return fetchCollection<UserAchievement>("achievements", []);
  },

  async getUserAchievements(userId) {
    return fetchCollection<UserAchievement>(
      "userAchievements",
      [byUser(userId)]
    );
  },

  async updateAchievementProgress(userId, achievementId, progress) {
    const db = getDb();
    const docId = `${userId}_${achievementId}`;
    const ref = doc(db, "userAchievements", docId);
    
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
    
    return fetchDocument<UserAchievement>("userAchievements", docId) as Promise<UserAchievement>;
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
    const { getAuth } = await import("firebase/auth");
    const auth = getAuth();
    
    // 確保使用者已登入
    if (!auth.currentUser) {
      return {
        success: false,
        errorCode: "AUTH_ERROR",
        errorMessage: "請先登入",
      };
    }
    
    // 取得使用者的 ID Token 用於驗證
    const idToken = await auth.currentUser.getIdToken();
    
    try {
      // 呼叫後端 Cloud Function 處理儲值
      // Cloud Function 會負責：
      // 1. 驗證使用者身份
      // 2. 驗證金額限制
      // 3. 處理支付（連接第三方支付服務）
      // 4. 使用 Firestore Transaction 原子性地更新餘額和建立交易記錄
      const response = await fetch(
        `https://asia-east1-${process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "campus-app"}.cloudfunctions.net/processTopup`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            userId: data.userId,
            amount: data.amount,
            paymentMethod: data.paymentMethod,
          }),
        }
      );
      
      const result = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          errorCode: result.code || "SERVER_ERROR",
          errorMessage: result.message || "儲值失敗，請稍後再試",
        };
      }
      
      return {
        success: true,
        newBalance: result.newBalance,
        transactionId: result.transactionId,
      };
    } catch (error) {
      console.error("[firebaseSource] processTopup error:", error);
      return {
        success: false,
        errorCode: "NETWORK_ERROR",
        errorMessage: "網路連線失敗，請檢查網路狀態",
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
    const { getAuth } = await import("firebase/auth");
    const auth = getAuth();
    
    if (!auth.currentUser) {
      return {
        success: false,
        errorCode: "AUTH_ERROR",
        errorMessage: "請先登入",
      };
    }
    
    const idToken = await auth.currentUser.getIdToken();
    
    try {
      const response = await fetch(
        `https://asia-east1-${process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "campus-app"}.cloudfunctions.net/processPayment`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            userId: data.userId,
            amount: data.amount,
            paymentMethod: data.paymentMethod,
            merchantId: data.merchantId,
            description: data.description,
          }),
        }
      );
      
      const result = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          errorCode: result.code || "SERVER_ERROR",
          errorMessage: result.message || "支付失敗，請稍後再試",
        };
      }
      
      return {
        success: true,
        newBalance: result.newBalance,
        transactionId: result.transactionId,
      };
    } catch (error) {
      console.error("[firebaseSource] processPayment error:", error);
      return {
        success: false,
        errorCode: "NETWORK_ERROR",
        errorMessage: "網路連線失敗，請檢查網路狀態",
      };
    }
  },
};
