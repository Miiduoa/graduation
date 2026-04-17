/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import type { DataSource } from './source';
import type {
  Announcement,
  Assignment,
  BusArrival,
  BusRoute,
  Cafeteria,
  CalendarEvent,
  ClubEvent,
  Comment,
  Conversation,
  Course,
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
  Notification,
  Order,
  Poi,
  PoiCrowdReport,
  PoiReport,
  PoiReview,
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
} from './types';
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
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  increment,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getDb, getFunctionsInstance } from '../firebase';
import {
  buildConversationCollectionPath,
  buildGroupCollectionPath,
  buildSchoolCollectionPath,
  buildUserCollectionPath,
  buildUserSchoolCollectionPath,
} from '@campus/shared/src';
import { collectionFromSegments, docFromSegments } from './firestorePath';
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
  getPuDiningCafeterias,
  getPuDiningMenuItems,
  hasPuOfficialCafeteriaName,
  hasPuOfficialMenuSignal,
  isProvidenceDiningSchoolId,
} from './puDiningCatalog';

const DEFAULT_PAGE_SIZE = 20;

// ===== 錯誤處理 =====

export class FirebaseDataError extends Error {
  constructor(
    message: string,
    public readonly collection: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'FirebaseDataError';
  }
}

// ===== 工具函數 =====

const DEFAULT_SCHOOL_ID = 'tw-nchu';

function bySchool(schoolId?: string): QueryConstraint {
  return where('schoolId', '==', schoolId || DEFAULT_SCHOOL_ID);
}

function byUser(userId: string): QueryConstraint {
  return where('userId', '==', userId);
}

function parseDocument<T extends { id: string }>(doc: {
  id: string;
  data: () => Record<string, unknown>;
}): T {
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

function normalizeConversationRecord(row: Record<string, unknown>): Conversation {
  const memberIds = Array.isArray(row.memberIds)
    ? row.memberIds
    : Array.isArray(row.participants)
      ? row.participants
      : Array.isArray(row.participantIds)
        ? row.participantIds
        : [];

  return {
    ...(row as Conversation),
    memberIds: memberIds.filter((entry): entry is string => typeof entry === 'string'),
  };
}

function normalizeLibraryLoanRecord(row: Record<string, unknown>): LibraryLoan {
  const status = row.status === 'active' ? 'borrowed' : row.status;
  return {
    ...(row as LibraryLoan),
    status: (status as LibraryLoan['status']) ?? 'borrowed',
  };
}

function normalizeRepairRequestRecord(row: Record<string, unknown>): RepairRequest {
  const statusMap: Record<string, RepairRequest['status']> = {
    pending: 'pending',
    assigned: 'assigned',
    in_progress: 'inProgress',
    inProgress: 'inProgress',
    completed: 'completed',
    cancelled: 'cancelled',
  };

  return {
    ...(row as RepairRequest),
    type: String(row.type ?? row.category ?? 'other') as RepairRequest['type'],
    status: statusMap[String(row.status ?? 'pending')] ?? 'pending',
  };
}

function normalizeDormPackageRecord(row: Record<string, unknown>): DormPackage {
  const statusMap: Record<string, DormPackage['status']> = {
    pending: 'pending',
    arrived: 'pending',
    picked: 'picked',
    picked_up: 'picked',
    returned: 'returned',
  };

  return {
    ...(row as DormPackage),
    userId: String(row.userId ?? row.recipientId ?? ''),
    carrier: String(row.carrier ?? row.courier ?? ''),
    arrivedAt: String(row.arrivedAt ?? row.createdAt ?? new Date().toISOString()),
    status: statusMap[String(row.status ?? 'pending')] ?? 'pending',
    pickedAt: typeof row.pickedAt === 'string'
      ? row.pickedAt
      : typeof row.pickedUpAt === 'string'
        ? row.pickedUpAt
        : undefined,
  };
}

function normalizeWashingReservationRecord(row: Record<string, unknown>): WashingReservation {
  const status = row.status === 'active' ? 'reserved' : row.status;
  return {
    ...(row as WashingReservation),
    status: (status as WashingReservation['status']) ?? 'reserved',
  };
}

function normalizePrintJobRecord(row: Record<string, unknown>): PrintJob {
  const status = row.status === 'queued' ? 'pending' : row.status;
  return {
    ...(row as PrintJob),
    status: (status as PrintJob['status']) ?? 'pending',
  };
}

function normalizeHealthAppointmentRecord(row: Record<string, unknown>): HealthAppointment {
  return {
    ...(row as HealthAppointment),
    timeSlot: String(row.timeSlot ?? row.time ?? ''),
    reason: typeof row.reason === 'string'
      ? row.reason
      : typeof row.symptoms === 'string'
        ? row.symptoms
        : undefined,
    notes: typeof row.notes === 'string'
      ? row.notes
      : typeof row.note === 'string'
        ? row.note
        : undefined,
  };
}

function normalizeHealthRecordRecord(row: Record<string, unknown>): HealthRecord {
  return {
    ...(row as HealthRecord),
    date: String(row.date ?? row.visitDate ?? ''),
    notes: typeof row.notes === 'string'
      ? row.notes
      : typeof row.note === 'string'
        ? row.note
        : undefined,
  };
}

function normalizeCafeteriaRecord(row: Record<string, unknown>): Cafeteria {
  const pilotStatus = String(row.pilotStatus ?? 'inactive');
  return {
    ...(row as Cafeteria),
    name: String(row.name ?? row.cafeteria ?? row.merchantName ?? '未命名餐廳'),
    merchantId: String(row.merchantId ?? row.id ?? ''),
    pilotStatus:
      pilotStatus === 'pilot' || pilotStatus === 'live' ? pilotStatus : 'inactive',
    orderingEnabled: row.orderingEnabled === true,
    activeOperatorCount:
      typeof row.activeOperatorCount === 'number' ? row.activeOperatorCount : 0,
  };
}

function buildLegacyPoiCollectionPath(poiId: string, collectionName: string): string[] {
  return ['pois', poiId, collectionName];
}

function buildLegacyPoiDocumentPath(poiId: string, collectionName: string, docId: string): string[] {
  return ['pois', poiId, collectionName, docId];
}

function getPoiScopedPath(schoolId: string | undefined, poiId: string, collectionName: string): string[] {
  return schoolId
    ? buildSchoolCollectionPath(schoolId, 'pois', poiId, collectionName)
    : buildLegacyPoiCollectionPath(poiId, collectionName);
}

function applyQueryOptions(
  constraints: QueryConstraint[],
  options?: QueryOptions,
): QueryConstraint[] {
  const result = [...constraints];

  if (options?.sortBy) {
    result.push(orderBy(options.sortBy, options.sortOrder ?? 'desc'));
  }

  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  result.push(firestoreLimit(pageSize));

  return result;
}

async function fetchCollection<T extends { id: string }>(
  collectionName: string,
  constraints: (QueryConstraint | null)[],
  schoolId?: string,
  options?: QueryOptions,
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[firebase] Failed to fetch ${collectionName}:`, error);
    throw new FirebaseDataError(
      `無法載入${getCollectionLabel(collectionName)}：${message}`,
      collectionName,
      error,
    );
  }
}

async function fetchCollectionAtPath<T extends { id: string }>(
  pathSegments: string[],
  constraints: (QueryConstraint | null)[],
  options?: QueryOptions,
): Promise<T[]> {
  try {
    const db = getDb();
    const validConstraints = constraints.filter((c): c is QueryConstraint => c !== null);
    const finalConstraints = applyQueryOptions(validConstraints, options);
    const qy = query(collectionFromSegments(db, pathSegments), ...finalConstraints);
    const snap = await getDocs(qy);
    return snap.docs.map((d) => parseDocument<T>(d));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[firebase] Failed to fetch ${pathSegments.join('/')}:`, error);
    throw new FirebaseDataError(
      `無法載入${pathSegments.join('/')}：${message}`,
      pathSegments.join('/'),
      error,
    );
  }
}

async function fetchDocumentAtPath<T extends { id: string }>(
  pathSegments: string[],
): Promise<T | null> {
  try {
    const db = getDb();
    const docSnap = await getDoc(docFromSegments(db, pathSegments));

    if (!docSnap.exists()) {
      return null;
    }

    return parseDocument<T>({
      id: docSnap.id,
      data: () => docSnap.data() as Record<string, unknown>,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[firebase] Failed to fetch ${pathSegments.join('/')}:`, error);
    throw new FirebaseDataError(
      `無法載入${pathSegments.join('/')}：${message}`,
      pathSegments.join('/'),
      error,
    );
  }
}

async function createDocumentAtPath<T extends { id: string }>(
  pathSegments: string[],
  data: Omit<T, 'id' | 'createdAt'> & Partial<Pick<T, Extract<keyof T, 'createdAt'>>>,
): Promise<T> {
  try {
    const db = getDb();
    const docRef = await addDoc(collectionFromSegments(db, pathSegments), {
      ...data,
      createdAt: serverTimestamp(),
    });
    const created = await fetchDocumentAtPath<T>([...pathSegments, docRef.id]);

    if (!created) {
      throw new Error('Document not found after creation');
    }

    return created;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[firebase] Failed to create ${pathSegments.join('/')}:`, error);
    throw new FirebaseDataError(
      `無法建立${pathSegments.join('/')}：${message}`,
      pathSegments.join('/'),
      error,
    );
  }
}

async function updateDocumentAtPath<T extends { id?: string }>(
  pathSegments: string[],
  data: Partial<T>,
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
        params.options,
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
        params.options,
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
      params.options,
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
    pathCandidates.push(
      buildUserSchoolCollectionPath(
        params.uid,
        params.schoolId,
        params.canonicalCollection,
        params.docId,
      ),
    );
  }
  if (params.fallbackUserCollection) {
    pathCandidates.push(
      buildUserCollectionPath(params.uid, params.fallbackUserCollection, params.docId),
    );
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
  preferredSchoolId?: string | null,
): Promise<string> {
  if (preferredSchoolId) {
    return preferredSchoolId;
  }

  const userDoc = await fetchDocumentAtPath<{
    id: string;
    schoolId?: string | null;
    primarySchoolId?: string | null;
  }>(['users', uid]).catch(() => null);

  return userDoc?.primarySchoolId ?? userDoc?.schoolId ?? DEFAULT_SCHOOL_ID;
}

async function resolveEventSchoolId(
  eventId: string,
  preferredSchoolId?: string | null,
): Promise<string | null> {
  if (preferredSchoolId) {
    return preferredSchoolId;
  }

  const legacyEvent =
    (await fetchDocument<ClubEvent>('events', eventId).catch(() => null)) ??
    (await fetchDocument<ClubEvent>('clubEvents', eventId).catch(() => null));

  return legacyEvent?.schoolId ?? null;
}

async function ensureCanonicalEventDocument(eventId: string, schoolId: string): Promise<string[]> {
  const db = getDb();
  const canonicalPath = buildSchoolCollectionPath(schoolId, 'events', eventId);
  const canonicalRef = docFromSegments(db, canonicalPath);
  const canonicalSnap = await getDoc(canonicalRef);

  if (canonicalSnap.exists()) {
    return canonicalPath;
  }

  const legacyRootEvent =
    (await fetchDocument<ClubEvent>('events', eventId).catch(() => null)) ??
    (await fetchDocument<ClubEvent>('clubEvents', eventId).catch(() => null));
  const legacySchoolEvent =
    (await fetchDocumentAtPath<ClubEvent>(
      buildSchoolCollectionPath(schoolId, 'clubEvents', eventId),
    ).catch(() => null)) ??
    (await fetchDocumentAtPath<ClubEvent>(
      buildSchoolCollectionPath(schoolId, 'events', eventId),
    ).catch(() => null));
  const sourceEvent = legacySchoolEvent ?? legacyRootEvent;

  if (sourceEvent) {
    await setDoc(
      canonicalRef,
      {
        ...sourceEvent,
        schoolId,
        migratedAt: serverTimestamp(),
        sourcePath: legacySchoolEvent
          ? buildSchoolCollectionPath(schoolId, 'clubEvents', eventId).join('/')
          : legacyRootEvent
            ? `events/${eventId}`
            : undefined,
      },
      { merge: true },
    );
  } else {
    await setDoc(
      canonicalRef,
      {
        id: eventId,
        schoolId,
        registeredCount: 0,
        createdAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }

  return canonicalPath;
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
          params.options,
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
      params.options,
    );
  }

  if (lastError) {
    throw lastError;
  }

  return [];
}

async function fetchDocument<T extends { id: string }>(
  collectionName: string,
  docId: string,
): Promise<T | null> {
  try {
    const db = getDb();
    const docRef = doc(db, collectionName, docId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return null;
    }

    return parseDocument<T>({
      id: docSnap.id,
      data: () => docSnap.data() as Record<string, unknown>,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[firebase] Failed to fetch ${collectionName}/${docId}:`, error);
    throw new FirebaseDataError(
      `無法載入${getCollectionLabel(collectionName)}：${message}`,
      collectionName,
      error,
    );
  }
}

async function createDocument<T extends { id: string }>(
  collectionName: string,
  data: Omit<T, 'id' | 'createdAt'> & Partial<Pick<T, Extract<keyof T, 'createdAt'>>>,
): Promise<T> {
  try {
    const db = getDb();
    const docRef = await addDoc(collection(db, collectionName), {
      ...data,
      createdAt: serverTimestamp(),
    });

    const created = await fetchDocument<T>(collectionName, docRef.id);
    if (!created) {
      throw new Error('Document not found after creation');
    }

    return created;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[firebase] Failed to create in ${collectionName}:`, error);
    throw new FirebaseDataError(
      `無法建立${getCollectionLabel(collectionName)}：${message}`,
      collectionName,
      error,
    );
  }
}

async function updateDocument<T extends { id: string }>(
  collectionName: string,
  docId: string,
  data: Partial<T>,
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
      throw new Error('Document not found after update');
    }
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[firebase] Failed to update ${collectionName}/${docId}:`, error);
    throw new FirebaseDataError(
      `無法更新${getCollectionLabel(collectionName)}：${message}`,
      collectionName,
      error,
    );
  }
}

async function deleteDocument(collectionName: string, docId: string): Promise<void> {
  try {
    const db = getDb();
    const docRef = doc(db, collectionName, docId);
    await deleteDoc(docRef);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[firebase] Failed to delete ${collectionName}/${docId}:`, error);
    throw new FirebaseDataError(
      `無法刪除${getCollectionLabel(collectionName)}：${message}`,
      collectionName,
      error,
    );
  }
}

function getCollectionLabel(collectionName: string): string {
  const labels: Record<string, string> = {
    announcements: '公告',
    events: '活動',
    pois: '地點',
    menus: '菜單',
    users: '使用者',
    courses: '課程',
    enrollments: '選課',
    grades: '成績',
    groups: '群組',
    groupMembers: '群組成員',
    groupPosts: '貼文',
    comments: '留言',
    assignments: '作業',
    submissions: '繳交',
    conversations: '對話',
    messages: '訊息',
    lostFoundItems: '失物招領',
    libraryBooks: '書籍',
    libraryLoans: '借閱',
    librarySeats: '座位',
    seatReservations: '座位預約',
    busRoutes: '公車路線',
    notifications: '通知',
    calendarEvents: '行事曆',
    orders: '訂單',
    transactions: '交易',
    achievements: '成就',
  };
  return labels[collectionName] ?? collectionName;
}

// ===== Firebase DataSource 實作 =====

export const firebaseSource: DataSource = {
  // ===== 公告 =====
  async listAnnouncements(schoolId, options) {
    return fetchCanonicalSchoolCollection<Announcement>({
      schoolId,
      canonicalCollections: ['announcements'],
      schoolConstraints: [orderBy('publishedAt', 'desc')],
      fallbackCollection: 'announcements',
      fallbackConstraints: [bySchool(schoolId), orderBy('publishedAt', 'desc')],
      options,
    });
  },

  async getAnnouncement(id) {
    return fetchDocument<Announcement>('announcements', id);
  },

  // ===== 活動 =====
  async listEvents(schoolId, options) {
    return fetchCanonicalSchoolCollection<ClubEvent>({
      schoolId,
      canonicalCollections: ['events', 'clubEvents'],
      schoolConstraints: [orderBy('startsAt', 'asc')],
      fallbackCollection: 'events',
      fallbackConstraints: [bySchool(schoolId), orderBy('startsAt', 'asc')],
      options,
    });
  },

  async getEvent(id, schoolId = undefined) {
    if (schoolId) {
      const canonicalEvent =
        (await fetchDocumentAtPath<ClubEvent>(buildSchoolCollectionPath(schoolId, 'events', id))) ??
        (await fetchDocumentAtPath<ClubEvent>(
          buildSchoolCollectionPath(schoolId, 'clubEvents', id),
        ));
      if (canonicalEvent) {
        return { ...canonicalEvent, schoolId: canonicalEvent.schoolId ?? schoolId };
      }
    }

    return (
      (await fetchDocument<ClubEvent>('events', id)) ??
      (await fetchDocument<ClubEvent>('clubEvents', id))
    );
  },

  async registerEvent(eventId, userId, schoolId = undefined) {
    const db = getDb();
    const resolvedSchoolId = await resolveEventSchoolId(eventId, schoolId);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法報名活動');
    }

    const eventPath = await ensureCanonicalEventDocument(eventId, resolvedSchoolId);
    const eventRef = docFromSegments(db, eventPath);
    const registrationRef = docFromSegments(
      db,
      buildSchoolCollectionPath(resolvedSchoolId, 'events', eventId, 'registrations', userId),
    );

    const registrationSnap = await getDoc(registrationRef);
    if (registrationSnap.exists()) {
      return;
    }

    const batch = writeBatch(db);
    batch.set(registrationRef, {
      eventId,
      userId,
      schoolId: resolvedSchoolId,
      registeredAt: serverTimestamp(),
    });
    batch.update(eventRef, {
      registeredCount: increment(1),
    });
    await batch.commit();
  },

  async unregisterEvent(eventId, userId, schoolId = undefined) {
    const db = getDb();
    const resolvedSchoolId = await resolveEventSchoolId(eventId, schoolId);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法取消活動報名');
    }

    const eventPath = await ensureCanonicalEventDocument(eventId, resolvedSchoolId);
    const eventRef = docFromSegments(db, eventPath);
    const registrationRef = docFromSegments(
      db,
      buildSchoolCollectionPath(resolvedSchoolId, 'events', eventId, 'registrations', userId),
    );

    const registrationSnap = await getDoc(registrationRef);
    if (!registrationSnap.exists()) {
      return;
    }

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
      canonicalCollections: ['pois'],
      fallbackCollection: 'pois',
      fallbackConstraints: [bySchool(schoolId)],
      options,
    });
  },

  async getPoi(id) {
    return fetchDocument<Poi>('pois', id);
  },

  async listPoiReviews(poiId, schoolId = undefined) {
    if (schoolId) {
      try {
        const rows = await fetchCollectionAtPath<PoiReview>(
          buildSchoolCollectionPath(schoolId, 'pois', poiId, 'reviews'),
          [orderBy('createdAt', 'desc')],
          { pageSize: 100 },
        );
        if (rows.length > 0) {
          return rows.map((row) => ({
            ...row,
            helpful: typeof row.helpful === 'number' ? row.helpful : 0,
            helpfulBy: Array.isArray(row.helpfulBy) ? row.helpfulBy : [],
          }));
        }
      } catch (error) {
        console.warn('[firebaseSource] listPoiReviews school-scoped read failed:', error);
      }
    }

    const legacyRows = await fetchCollectionAtPath<PoiReview>(
      buildLegacyPoiCollectionPath(poiId, 'reviews'),
      [orderBy('createdAt', 'desc')],
      { pageSize: 100 },
    ).catch(() => []);

    return legacyRows.map((row) => ({
      ...row,
      helpful: typeof row.helpful === 'number' ? row.helpful : 0,
      helpfulBy: Array.isArray(row.helpfulBy) ? row.helpfulBy : [],
    }));
  },

  async listPoiCrowdReports(poiId, schoolId = undefined) {
    if (schoolId) {
      try {
        const rows = await fetchCollectionAtPath<PoiCrowdReport>(
          buildSchoolCollectionPath(schoolId, 'pois', poiId, 'crowdReports'),
          [orderBy('createdAt', 'desc')],
          { pageSize: 100 },
        );
        if (rows.length > 0) {
          return rows;
        }
      } catch (error) {
        console.warn('[firebaseSource] listPoiCrowdReports school-scoped read failed:', error);
      }
    }

    return fetchCollectionAtPath<PoiCrowdReport>(
      buildLegacyPoiCollectionPath(poiId, 'crowdReports'),
      [orderBy('createdAt', 'desc')],
      { pageSize: 100 },
    ).catch(() => []);
  },

  async submitPoiReview(data) {
    const db = getDb();
    await setDoc(docFromSegments(db, [...getPoiScopedPath(data.schoolId, data.poiId, 'reviews'), data.uid]), {
      uid: data.uid,
      schoolId: data.schoolId ?? null,
      displayName: data.displayName ?? null,
      avatarUrl: data.avatarUrl ?? null,
      rating: data.rating,
      comment: data.comment.trim(),
      tags: data.tags ?? [],
      helpful: 0,
      helpfulBy: [],
      createdAt: serverTimestamp(),
    });
  },

  async submitPoiCrowdReport(data) {
    await createDocumentAtPath<PoiCrowdReport>(getPoiScopedPath(data.schoolId, data.poiId, 'crowdReports'), {
      uid: data.uid,
      schoolId: data.schoolId,
      level: data.level,
    });
  },

  async togglePoiReviewHelpful(data) {
    const db = getDb();
    const canonicalPath = data.schoolId
      ? buildSchoolCollectionPath(data.schoolId, 'pois', data.poiId, 'reviews', data.reviewId)
      : null;
    const legacyPath = buildLegacyPoiDocumentPath(data.poiId, 'reviews', data.reviewId);
    const canonicalDoc = canonicalPath ? await getDoc(docFromSegments(db, canonicalPath)).catch(() => null) : null;
    const targetPath = canonicalDoc?.exists() ? canonicalPath! : legacyPath;

    await updateDoc(docFromSegments(db, targetPath), {
      helpfulBy: data.alreadyHelpful ? arrayRemove(data.uid) : arrayUnion(data.uid),
      helpful: increment(data.alreadyHelpful ? -1 : 1),
      updatedAt: serverTimestamp(),
    });
  },

  async submitPoiReport(data) {
    await createDocumentAtPath<PoiReport>(getPoiScopedPath(data.schoolId, data.poiId, 'reports'), {
      uid: data.uid,
      schoolId: data.schoolId,
      email: data.email ?? null,
      type: data.type,
      description: data.description.trim(),
      status: 'pending',
    });
  },

  // ===== 餐廳菜單 =====
  async listCafeterias(schoolId, options) {
    if (schoolId) {
      try {
        const rows = await fetchCollectionAtPath<Cafeteria>(
          buildSchoolCollectionPath(schoolId, 'cafeterias'),
          [orderBy('name', 'asc')],
          options,
        );
        const normalized = rows.map((row) =>
          normalizeCafeteriaRecord(row as unknown as Record<string, unknown>),
        );
        if (
          !isProvidenceDiningSchoolId(schoolId) ||
          normalized.some((row) => hasPuOfficialCafeteriaName(row.name))
        ) {
          return normalized;
        }
        console.info(
          '[firebaseSource] Falling back to curated PU cafeteria catalog because Firestore data does not match verified campus venues.',
        );
      } catch (error) {
        console.warn('[firebaseSource] listCafeterias school-scoped read failed:', error);
      }
    }

    if (isProvidenceDiningSchoolId(schoolId)) {
      return getPuDiningCafeterias(schoolId || 'pu');
    }

    return [];
  },

  async listMenus(schoolId, options) {
    try {
      const rows = await fetchCanonicalSchoolCollection<MenuItem>({
        schoolId,
        canonicalCollections: ['menus', 'cafeteriaMenus'],
        schoolConstraints: [orderBy('availableOn', 'desc')],
        fallbackCollection: 'menus',
        fallbackConstraints: [bySchool(schoolId), orderBy('availableOn', 'desc')],
        options,
      });
      if (
        !isProvidenceDiningSchoolId(schoolId) ||
        rows.some((row) => hasPuOfficialMenuSignal({ name: row.name, cafeteria: row.cafeteria }))
      ) {
        return rows;
      }
      console.info(
        '[firebaseSource] Falling back to curated PU menu catalog because Firestore data does not match verified campus dining entries.',
      );
      return getPuDiningMenuItems(schoolId || 'pu');
    } catch (error) {
      if (isProvidenceDiningSchoolId(schoolId)) {
        console.warn('[firebaseSource] listMenus falling back to curated PU catalog:', error);
        return getPuDiningMenuItems(schoolId || 'pu');
      }
      throw error;
    }
  },

  async getMenuItem(id) {
    return fetchDocument<MenuItem>('menus', id);
  },

  async rateMenuItem(id, userId, rating) {
    const db = getDb();
    const menuRef = doc(db, 'menus', id);
    const ratingRef = doc(db, 'menuRatings', `${id}_${userId}`);

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
    return fetchDocument<User>('users', id);
  },

  async updateUser(id, data) {
    return updateDocument<User>('users', id, data);
  },

  async getUserByEmail(email) {
    const users = await fetchCollection<User>('users', [where('email', '==', email)]);
    return users[0] ?? null;
  },

  // ===== 課程 =====
  async listCourses(schoolId, options) {
    return fetchCollection<Course>(
      'courses',
      [bySchool(schoolId), orderBy('code', 'asc')],
      schoolId,
      options,
    );
  },

  async getCourse(id) {
    return fetchDocument<Course>('courses', id);
  },

  async searchCourses(searchQuery, schoolId) {
    const allCourses = await fetchCollection<Course>('courses', [bySchool(schoolId)], schoolId);
    const q = searchQuery.toLowerCase();
    return allCourses.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.instructor.toLowerCase().includes(q),
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
      constraints.push(where('semester', '==', semester));
    }
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    return fetchCanonicalUserSchoolCollection<Enrollment>({
      uid: userId,
      schoolId: resolvedSchoolId,
      canonicalCollection: 'enrollments',
      canonicalConstraints: constraints,
      fallbackUserCollection: 'enrollments',
      fallbackUserConstraints: constraints,
      fallbackRootCollection: 'enrollments',
      fallbackRootConstraints: constraints,
    });
  },

  async enrollCourse(userId, courseId, semester, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法建立選課資料');
    }

    return createDocumentAtPath<Enrollment>(
      buildUserSchoolCollectionPath(userId, resolvedSchoolId, 'enrollments'),
      {
        userId,
        courseId,
        semester,
        status: 'enrolled',
        createdAt: new Date().toISOString(),
      } as Omit<Enrollment, 'id'>,
    );
  },

  async dropCourse(enrollmentId, userId = undefined, schoolId = undefined) {
    const resolvedSchoolId = userId
      ? await resolveUserSchoolId(userId, schoolId)
      : (schoolId ?? null);
    if (userId && resolvedSchoolId) {
      await updateDocumentAtPath<Enrollment>(
        buildUserSchoolCollectionPath(userId, resolvedSchoolId, 'enrollments', enrollmentId),
        { status: 'dropped' },
      );
      return;
    }

    await updateDocument<Enrollment>('enrollments', enrollmentId, { status: 'dropped' });
  },

  // ===== 成績 =====
  async listGrades(userId, semester, schoolId = undefined) {
    const constraints: (QueryConstraint | null)[] = [byUser(userId)];
    if (semester) {
      constraints.push(where('semester', '==', semester));
    }
    constraints.push(orderBy('publishedAt', 'desc'));
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    return fetchCanonicalUserSchoolCollection<Grade>({
      uid: userId,
      schoolId: resolvedSchoolId,
      canonicalCollection: 'grades',
      canonicalConstraints: constraints,
      fallbackUserCollection: 'grades',
      fallbackUserConstraints: constraints,
      fallbackRootCollection: 'grades',
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
      options?.filters?.find((filter) => filter.field === 'schoolId' && filter.operator === '==')
        ?.value ?? null;
    const constraints = [where('status', '==', 'active')] as QueryConstraint[];

    if (typeof schoolId === 'string' && schoolId) {
      constraints.push(where('schoolId', '==', schoolId));
    }

    const membershipSnap = await getDocs(
      query(collection(db, buildUserCollectionPath(userId, 'groups').join('/')), ...constraints),
    );
    const groupIds = membershipSnap.docs
      .map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        return typeof data.groupId === 'string' ? data.groupId : docSnap.id;
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
    return fetchDocument<Group>('groups', id);
  },

  async createGroup(data) {
    const createGroup = httpsCallable<
      {
        name: string;
        description?: string;
        type: Group['type'];
        schoolId: string;
        isPrivate?: boolean;
        isPublished?: boolean;
        verification?: { status?: string };
      },
      { success: boolean; groupId: string; joinCode?: string | null }
    >(getFunctionsInstance(), 'createGroup');
    const result = await createGroup({
      name: data.name,
      description: data.description,
      type: data.type,
      schoolId: data.schoolId ?? '',
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
    return updateDocument<Group>('groups', id, data);
  },

  async deleteGroup(id) {
    await deleteDocument('groups', id);
  },

  async joinGroup(groupId, userId, joinCode) {
    const group = await this.getGroup(groupId);
    if (!group) throw new Error('群組不存在');
    if (!group.schoolId) {
      throw new Error('群組缺少 schoolId');
    }

    await httpsCallable<
      { joinCode: string; schoolId: string },
      { success: boolean; groupId: string; groupName?: string }
    >(
      getFunctionsInstance(),
      'joinGroupByCode',
    )({
      joinCode: String(joinCode ?? group.joinCode ?? '')
        .trim()
        .toUpperCase(),
      schoolId: group.schoolId,
    });

    const memberSnap = await getDoc(
      doc(getDb(), buildGroupCollectionPath(groupId, 'members', userId).join('/')),
    );
    const memberData = memberSnap.data() as Record<string, unknown> | undefined;

    return {
      id: userId,
      groupId,
      userId,
      uid: userId,
      role: (memberData?.role as GroupMember['role']) ?? 'member',
      status: (memberData?.status as string | undefined) ?? 'active',
      joinedAt:
        memberData?.joinedAt && typeof (memberData.joinedAt as any)?.toDate === 'function'
          ? (memberData.joinedAt as any).toDate().toISOString()
          : new Date().toISOString(),
    };
  },

  async leaveGroup(groupId, userId) {
    await httpsCallable<{ groupId: string }, { success: boolean }>(
      getFunctionsInstance(),
      'leaveGroup',
    )({
      groupId,
    });
  },

  // ===== 群組成員 =====
  async listGroupMembers(groupId, options) {
    try {
      const rows = await fetchCollectionAtPath<GroupMember>(
        buildGroupCollectionPath(groupId, 'members'),
        [where('status', '==', 'active')],
        options,
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
      console.warn('[firebaseSource] listGroupMembers canonical read failed:', error);
    }

    return fetchCollection<GroupMember>(
      'groupMembers',
      [where('groupId', '==', groupId)],
      undefined,
      options,
    );
  },

  async updateMemberRole(groupId, userId, role) {
    try {
      await updateDocumentAtPath<GroupMember>(
        buildGroupCollectionPath(groupId, 'members', userId),
        { role },
      );
      await updateDocumentAtPath<GroupMember>(buildUserCollectionPath(userId, 'groups', groupId), {
        role,
      });
      return;
    } catch (error) {
      console.warn('[firebaseSource] updateMemberRole canonical write failed:', error);
    }

    const db = getDb();
    const membersSnap = await getDocs(
      query(
        collection(db, 'groupMembers'),
        where('groupId', '==', groupId),
        where('userId', '==', userId),
      ),
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
    try {
      const rows = await fetchCollectionAtPath<GroupPost>(
        buildGroupCollectionPath(groupId, 'posts'),
        [orderBy('createdAt', 'desc')],
        options,
      );
      if (rows.length > 0) {
        return rows.map((row) => ({ ...row, groupId: row.groupId ?? groupId }));
      }
    } catch (error) {
      console.warn('[firebaseSource] listGroupPosts canonical read failed:', error);
    }

    return fetchCollection<GroupPost>(
      'groupPosts',
      [where('groupId', '==', groupId), orderBy('createdAt', 'desc')],
      undefined,
      options,
    );
  },

  async getGroupPost(id, groupId = undefined) {
    if (groupId) {
      const canonicalPost = await fetchDocumentAtPath<GroupPost>(
        buildGroupCollectionPath(groupId, 'posts', id),
      );
      if (canonicalPost) {
        return { ...canonicalPost, groupId: canonicalPost.groupId ?? groupId };
      }
    }
    return fetchDocument<GroupPost>('groupPosts', id);
  },

  async createGroupPost(data) {
    return createDocumentAtPath<GroupPost>(buildGroupCollectionPath(data.groupId, 'posts'), {
      ...data,
      likeCount: 0,
      commentCount: 0,
    } as Omit<GroupPost, 'id'>);
  },

  async updateGroupPost(id, data, groupId = undefined) {
    if (groupId) {
      await updateDocumentAtPath<GroupPost>(buildGroupCollectionPath(groupId, 'posts', id), data);
      return (await fetchDocumentAtPath<GroupPost>(
        buildGroupCollectionPath(groupId, 'posts', id),
      )) as GroupPost;
    }
    return updateDocument<GroupPost>('groupPosts', id, data);
  },

  async deleteGroupPost(id, groupId = undefined) {
    if (groupId) {
      await deleteDocumentAtPath(buildGroupCollectionPath(groupId, 'posts', id));
      return;
    }
    await deleteDocument('groupPosts', id);
  },

  async likePost(postId, userId, groupId = undefined) {
    const db = getDb();
    if (groupId) {
      await updateDoc(docFromSegments(db, buildGroupCollectionPath(groupId, 'posts', postId)), {
        likeCount: increment(1),
        likedBy: arrayUnion(userId),
      });
      return;
    }

    const likeRef = doc(db, 'postLikes', `${postId}_${userId}`);
    const postRef = doc(db, 'groupPosts', postId);
    const batch = writeBatch(db);
    batch.set(likeRef, { postId, userId, createdAt: serverTimestamp() });
    batch.update(postRef, { likeCount: increment(1) });
    await batch.commit();
  },

  async unlikePost(postId, userId, groupId = undefined) {
    const db = getDb();
    if (groupId) {
      await updateDoc(docFromSegments(db, buildGroupCollectionPath(groupId, 'posts', postId)), {
        likeCount: increment(-1),
        likedBy: arrayRemove(userId),
      });
      return;
    }

    const likeRef = doc(db, 'postLikes', `${postId}_${userId}`);
    const postRef = doc(db, 'groupPosts', postId);
    const batch = writeBatch(db);
    batch.delete(likeRef);
    batch.update(postRef, { likeCount: increment(-1) });
    await batch.commit();
  },

  // ===== 留言 =====
  async listComments(postId, options, groupId = undefined) {
    try {
      const rows = await fetchCollectionAtPath<Comment>(
        buildGroupCollectionPath(groupId, 'posts', postId, 'comments'),
        [orderBy('createdAt', 'asc')],
        options,
      );
      if (rows.length > 0) {
        return rows.map((row) => ({
          ...row,
          postId: row.postId ?? postId,
          groupId: (row as any).groupId ?? groupId,
        }));
      }
    } catch (error) {
      console.warn('[firebaseSource] listComments canonical read failed:', error);
    }

    return fetchCollection<Comment>(
      'comments',
      [where('postId', '==', postId), orderBy('createdAt', 'asc')],
      undefined,
      options,
    );
  },

  async createComment(data) {
    const db = getDb();
    const groupId = (data as any).groupId as string | undefined;
    if (groupId) {
      const comment = await createDocumentAtPath<Comment>(
        buildGroupCollectionPath(groupId, 'posts', data.postId, 'comments'),
        {
          ...data,
          likeCount: 0,
        } as Omit<Comment, 'id'>,
      );
      await updateDoc(
        docFromSegments(db, buildGroupCollectionPath(groupId, 'posts', data.postId)),
        {
          commentCount: increment(1),
        },
      );
      return comment;
    }

    const comment = await createDocument<Comment>('comments', { ...data, likeCount: 0 } as Omit<
      Comment,
      'id'
    >);
    await updateDoc(doc(db, 'groupPosts', data.postId), { commentCount: increment(1) });
    return comment;
  },

  async deleteComment(id, groupId = undefined, postId = undefined) {
    if (groupId && postId) {
      const db = getDb();
      await deleteDocumentAtPath(
        buildGroupCollectionPath(groupId, 'posts', postId, 'comments', id),
      );
      await updateDoc(docFromSegments(db, buildGroupCollectionPath(groupId, 'posts', postId)), {
        commentCount: increment(-1),
      });
      return;
    }

    const comment = await fetchDocument<Comment>('comments', id);
    if (!comment) return;
    const db = getDb();
    await deleteDocument('comments', id);
    await updateDoc(doc(db, 'groupPosts', comment.postId), { commentCount: increment(-1) });
  },

  // ===== 作業 =====
  async listAssignments(groupId, options) {
    try {
      const rows = await fetchCollectionAtPath<Assignment>(
        buildGroupCollectionPath(groupId, 'assignments'),
        [orderBy('dueAt', 'asc')],
        options,
      );
      if (rows.length > 0) {
        return rows.map((row) => ({ ...row, groupId: row.groupId ?? groupId }));
      }
    } catch (error) {
      console.warn('[firebaseSource] listAssignments canonical read failed:', error);
    }

    return fetchCollection<Assignment>(
      'assignments',
      [where('groupId', '==', groupId), orderBy('dueAt', 'asc')],
      undefined,
      options,
    );
  },

  async getAssignment(id, groupId = undefined) {
    if (groupId) {
      const canonicalAssignment = await fetchDocumentAtPath<Assignment>(
        buildGroupCollectionPath(groupId, 'assignments', id),
      );
      if (canonicalAssignment) {
        return { ...canonicalAssignment, groupId: canonicalAssignment.groupId ?? groupId };
      }
    }
    return fetchDocument<Assignment>('assignments', id);
  },

  async createAssignment(data) {
    return createDocumentAtPath<Assignment>(buildGroupCollectionPath(data.groupId, 'assignments'), {
      ...data,
      submissionCount: 0,
    } as Omit<Assignment, 'id'>);
  },

  async updateAssignment(id, data, groupId = undefined) {
    if (groupId) {
      await updateDocumentAtPath<Assignment>(
        buildGroupCollectionPath(groupId, 'assignments', id),
        data,
      );
      return (await fetchDocumentAtPath<Assignment>(
        buildGroupCollectionPath(groupId, 'assignments', id),
      )) as Assignment;
    }
    return updateDocument<Assignment>('assignments', id, data);
  },

  async deleteAssignment(id, groupId = undefined) {
    if (groupId) {
      await deleteDocumentAtPath(buildGroupCollectionPath(groupId, 'assignments', id));
      return;
    }
    await deleteDocument('assignments', id);
  },

  // ===== 作業繳交 =====
  async listSubmissions(assignmentId, options, groupId = undefined) {
    if (groupId) {
      try {
        const rows = await fetchCollectionAtPath<Submission>(
          buildGroupCollectionPath(groupId, 'assignments', assignmentId, 'submissions'),
          [],
          options,
        );
        if (rows.length > 0) {
          return rows.map((row) => ({ ...row, assignmentId: row.assignmentId ?? assignmentId }));
        }
      } catch (error) {
        console.warn('[firebaseSource] listSubmissions canonical read failed:', error);
      }
    }

    return fetchCollection<Submission>(
      'submissions',
      [where('assignmentId', '==', assignmentId)],
      undefined,
      options,
    );
  },

  async getSubmission(assignmentId, userId, groupId = undefined) {
    if (groupId) {
      const canonicalSubmission = await fetchDocumentAtPath<Submission>(
        buildGroupCollectionPath(groupId, 'assignments', assignmentId, 'submissions', userId),
      );
      if (canonicalSubmission) {
        return {
          ...canonicalSubmission,
          assignmentId: canonicalSubmission.assignmentId ?? assignmentId,
        };
      }
    }

    const submissions = await fetchCollection<Submission>('submissions', [
      where('assignmentId', '==', assignmentId),
      where('userId', '==', userId),
    ]);
    return submissions[0] ?? null;
  },

  async submitAssignment(data) {
    const db = getDb();
    const groupId = (data as any).groupId as string;
    const submissionPath = buildGroupCollectionPath(
      groupId,
      'assignments',
      data.assignmentId,
      'submissions',
      data.userId,
    );
    await setDoc(
      docFromSegments(db, submissionPath),
      {
        ...data,
        status: 'submitted',
        submittedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    await updateDoc(
      docFromSegments(db, buildGroupCollectionPath(groupId, 'assignments', data.assignmentId)),
      {
        submissionCount: increment(1),
      },
    );

    return (await fetchDocumentAtPath<Submission>(submissionPath)) as Submission;
  },

  async gradeSubmission(
    id,
    grade,
    feedback,
    groupId = undefined,
    assignmentId = undefined,
    userId = undefined,
  ) {
    if (groupId && assignmentId && userId) {
      const submissionPath = buildGroupCollectionPath(
        groupId,
        'assignments',
        assignmentId,
        'submissions',
        userId,
      );
      await updateDocumentAtPath<Submission>(submissionPath, {
        grade,
        feedback,
        status: 'graded',
        gradedAt: new Date().toISOString(),
      });
      return (await fetchDocumentAtPath<Submission>(submissionPath)) as Submission;
    }

    return updateDocument<Submission>('submissions', id, {
      grade,
      feedback,
      status: 'graded',
      gradedAt: new Date().toISOString(),
    });
  },

  // ===== 訊息 =====
  async listConversations(userId, options, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    const rows = await fetchCollection<Conversation>(
      'conversations',
      [
        where('memberIds', 'array-contains', userId),
        where('schoolId', '==', resolvedSchoolId),
        orderBy('updatedAt', 'desc'),
      ],
      undefined,
      options,
    );

    return rows.map((row) =>
      normalizeConversationRecord(row as unknown as Record<string, unknown>),
    );
  },

  async getConversation(id) {
    const row = await fetchDocument<Conversation>('conversations', id);
    return row ? normalizeConversationRecord(row as unknown as Record<string, unknown>) : null;
  },

  async createConversation(participantIds, schoolId = undefined, conversationId = undefined) {
    const currentUid = getAuthInstance().currentUser?.uid ?? null;
    const resolvedSchoolId = currentUid
      ? await resolveUserSchoolId(currentUid, schoolId)
      : schoolId ?? null;
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法建立對話');
    }

    const memberIds = Array.from(
      new Set(
        [...participantIds, ...(currentUid ? [currentUid] : [])].filter(
          (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
        ),
      ),
    ).sort();

    const payload = {
      memberIds,
      schoolId: resolvedSchoolId,
      type: memberIds.length === 2 ? 'dm' : 'group_chat',
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };

    if (conversationId) {
      const db = getDb();
      const ref = docFromSegments(db, buildConversationCollectionPath(conversationId));
      const existing = await getDoc(ref).catch(() => null);
      if (!existing?.exists()) {
        await setDoc(ref, payload);
      }
      const row = await fetchDocumentAtPath<Conversation>(buildConversationCollectionPath(conversationId));
      return normalizeConversationRecord((row ?? { id: conversationId, ...payload }) as Record<string, unknown>);
    }

    const row = await createDocument<Conversation>(
      'conversations',
      payload as unknown as Omit<Conversation, 'id'>,
    );
    return normalizeConversationRecord(row as unknown as Record<string, unknown>);
  },

  async listMessages(conversationId, options) {
    try {
      const rows = await fetchCollectionAtPath<Message>(
        buildConversationCollectionPath(conversationId, 'messages'),
        [orderBy('createdAt', 'asc')],
        options,
      );
      if (rows.length > 0) {
        return rows.map((row) => ({
          ...row,
          conversationId: row.conversationId ?? conversationId,
        }));
      }
    } catch (error) {
      console.warn('[firebaseSource] listMessages canonical read failed:', error);
    }

    return fetchCollection<Message>(
      'messages',
      [where('conversationId', '==', conversationId), orderBy('createdAt', 'asc')],
      undefined,
      options,
    );
  },

  async sendMessage(data) {
    const db = getDb();
    const message = await createDocumentAtPath<Message>(
      buildConversationCollectionPath(data.conversationId, 'messages'),
      {
        ...data,
        type: data.type ?? 'text',
        readBy: Array.isArray(data.readBy) ? data.readBy : [data.senderId],
      } as Omit<Message, 'id'>,
    );

    await updateDoc(doc(db, 'conversations', data.conversationId), {
      lastMessage: message,
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return message;
  },

  async markMessageRead(messageId, userId, conversationId = undefined) {
    const db = getDb();
    if (conversationId) {
      await updateDoc(
        docFromSegments(db, buildConversationCollectionPath(conversationId, 'messages', messageId)),
        {
          readBy: arrayUnion(userId),
        },
      );
      return;
    }

    await updateDoc(doc(db, 'messages', messageId), { readBy: arrayUnion(userId) });
  },

  // ===== 失物招領 =====
  async listLostFoundItems(schoolId, options) {
    return fetchCanonicalSchoolCollection<LostFoundItem>({
      schoolId,
      canonicalCollections: ['lostFound'],
      schoolConstraints: [orderBy('createdAt', 'desc')],
      fallbackCollection: 'lostFoundItems',
      fallbackConstraints: [bySchool(schoolId), orderBy('createdAt', 'desc')],
      options,
    });
  },

  async getLostFoundItem(id) {
    return fetchDocument<LostFoundItem>('lostFoundItems', id);
  },

  async createLostFoundItem(data) {
    return createDocument<LostFoundItem>('lostFoundItems', {
      ...data,
      status: 'open',
    } as Omit<LostFoundItem, 'id'>);
  },

  async updateLostFoundItem(id, data) {
    return updateDocument<LostFoundItem>('lostFoundItems', id, data);
  },

  async resolveLostFoundItem(id) {
    await updateDocument<LostFoundItem>('lostFoundItems', id, {
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
    });
  },

  // ===== 圖書館 =====
  async searchBooks(searchQuery, schoolId, options) {
    const allBooks = await fetchCanonicalSchoolCollection<LibraryBook>({
      schoolId,
      canonicalCollections: ['libraryBooks'],
      fallbackCollection: 'libraryBooks',
      fallbackConstraints: [bySchool(schoolId)],
      options,
    });
    const q = searchQuery.toLowerCase();
    return allBooks.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.isbn?.includes(q),
    );
  },

  async getBook(id) {
    return fetchDocument<LibraryBook>('libraryBooks', id);
  },

  async listLoans(userId, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    const constraints: (QueryConstraint | null)[] = [
      byUser(userId),
      where('status', '!=', 'returned'),
    ];
    const canonicalRows = await fetchCanonicalUserSchoolCollection<LibraryLoan>({
      uid: userId,
      schoolId: resolvedSchoolId,
      canonicalCollection: 'libraryLoans',
      canonicalConstraints: constraints,
      fallbackRootCollection: 'libraryLoans',
      fallbackRootConstraints: constraints,
    });
    if (canonicalRows.length > 0) {
      return canonicalRows.map((row) =>
        normalizeLibraryLoanRecord(row as unknown as Record<string, unknown>),
      );
    }

    if (resolvedSchoolId) {
      try {
        const schoolRows = await fetchCollectionAtPath<LibraryLoan>(
          buildSchoolCollectionPath(resolvedSchoolId, 'libraryLoans'),
          constraints,
        );
        if (schoolRows.length > 0) {
          return schoolRows.map((row) =>
            normalizeLibraryLoanRecord(row as unknown as Record<string, unknown>),
          );
        }
      } catch (error) {
        console.warn('[firebaseSource] listLoans school-scoped read failed:', error);
      }
    }

    return canonicalRows;
  },

  async borrowBook(bookId, userId, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法借閱書籍');
    }
    const borrowBook = httpsCallable<
      { schoolId: string; bookId: string },
      { loanId?: string; dueAt?: string }
    >(getFunctionsInstance(), 'borrowBook');
    const result = await borrowBook({ schoolId: resolvedSchoolId, bookId });
    const loanId = result.data?.loanId;

    if (loanId) {
      const loan = await fetchCanonicalUserSchoolDocument<LibraryLoan>({
        uid: userId,
        schoolId: resolvedSchoolId,
        canonicalCollection: 'libraryLoans',
        docId: loanId,
        fallbackRootCollection: 'libraryLoans',
      });
      if (loan) {
        return normalizeLibraryLoanRecord(loan as unknown as Record<string, unknown>);
      }
    }

    return {
      id: loanId ?? `${bookId}_${Date.now()}`,
      userId,
      schoolId: resolvedSchoolId,
      bookId,
      borrowedAt: new Date().toISOString(),
      dueAt: result.data?.dueAt,
      renewCount: 0,
      status: 'borrowed',
    };
  },

  async returnBook(loanId, userId = undefined, schoolId = undefined) {
    const resolvedSchoolId = userId
      ? await resolveUserSchoolId(userId, schoolId)
      : (schoolId ?? null);
    const loan =
      userId && resolvedSchoolId
        ? await fetchCanonicalUserSchoolDocument<LibraryLoan>({
            uid: userId,
            schoolId: resolvedSchoolId,
            canonicalCollection: 'libraryLoans',
            docId: loanId,
            fallbackRootCollection: 'libraryLoans',
          })
        : await fetchDocument<LibraryLoan>('libraryLoans', loanId);
    if (!loan) throw new Error('借閱記錄不存在');
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法歸還書籍');
    }

    const returnBook = httpsCallable<
      { schoolId: string; loanId: string },
      { success?: boolean }
    >(getFunctionsInstance(), 'returnBook');
    await returnBook({ schoolId: resolvedSchoolId, loanId });
  },

  async renewBook(loanId, userId = undefined, schoolId = undefined) {
    const resolvedSchoolId = userId
      ? await resolveUserSchoolId(userId, schoolId)
      : (schoolId ?? null);
    const loan =
      userId && resolvedSchoolId
        ? await fetchCanonicalUserSchoolDocument<LibraryLoan>({
            uid: userId,
            schoolId: resolvedSchoolId,
            canonicalCollection: 'libraryLoans',
            docId: loanId,
            fallbackRootCollection: 'libraryLoans',
          })
        : await fetchDocument<LibraryLoan>('libraryLoans', loanId);
    if (!loan) throw new Error('借閱記錄不存在');
    if (loan.renewCount >= 2) throw new Error('已達續借上限');
    if (!resolvedSchoolId || !userId) {
      throw new Error('缺少 schoolId，無法續借書籍');
    }

    const renewBook = httpsCallable<
      { schoolId: string; loanId: string },
      { newDueAt?: string; renewCount?: number }
    >(getFunctionsInstance(), 'renewBook');
    const result = await renewBook({ schoolId: resolvedSchoolId, loanId });
    const updated = await fetchCanonicalUserSchoolDocument<LibraryLoan>({
      uid: userId,
      schoolId: resolvedSchoolId,
      canonicalCollection: 'libraryLoans',
      docId: loanId,
      fallbackRootCollection: 'libraryLoans',
    });
    if (updated) {
      return normalizeLibraryLoanRecord(updated as unknown as Record<string, unknown>);
    }

    return {
      ...normalizeLibraryLoanRecord(loan as unknown as Record<string, unknown>),
      dueAt: result.data?.newDueAt ?? loan.dueAt,
      renewCount: result.data?.renewCount ?? loan.renewCount + 1,
    };
  },

  // ===== 圖書館座位 =====
  async listSeats(schoolId, zone) {
    const constraints: (QueryConstraint | null)[] = [];
    if (zone) {
      constraints.push(where('zone', '==', zone));
    }
    return fetchCanonicalSchoolCollection<LibrarySeat>({
      schoolId,
      canonicalCollections: ['librarySeats'],
      schoolConstraints: constraints,
      fallbackCollection: 'librarySeats',
      fallbackConstraints: [bySchool(schoolId), ...constraints],
    });
  },

  async listSeatReservations(userId, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    const constraints: (QueryConstraint | null)[] = [
      byUser(userId),
      where('status', '==', 'active'),
    ];
    const canonicalRows = await fetchCanonicalUserSchoolCollection<SeatReservation>({
      uid: userId,
      schoolId: resolvedSchoolId,
      canonicalCollection: 'seatReservations',
      canonicalConstraints: constraints,
      fallbackRootCollection: 'seatReservations',
      fallbackRootConstraints: constraints,
    });
    if (canonicalRows.length > 0 || !resolvedSchoolId) {
      return canonicalRows;
    }

    try {
      return await fetchCollectionAtPath<SeatReservation>(
        buildSchoolCollectionPath(resolvedSchoolId, 'seatReservations'),
        constraints,
      );
    } catch (error) {
      console.warn('[firebaseSource] listSeatReservations school-scoped read failed:', error);
      return canonicalRows;
    }
  },

  async reserveSeat(seatId, userId, date, startTime, endTime, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法預約座位');
    }
    const reserveSeat = httpsCallable<
      { schoolId: string; seatId: string; date: string; startTime: string; endTime: string },
      { reservationId?: string }
    >(getFunctionsInstance(), 'reserveSeat');
    const result = await reserveSeat({
      schoolId: resolvedSchoolId,
      seatId,
      date,
      startTime,
      endTime,
    });
    const reservationId = result.data?.reservationId;
    if (reservationId) {
      const reservation = await fetchCanonicalUserSchoolDocument<SeatReservation>({
        uid: userId,
        schoolId: resolvedSchoolId,
        canonicalCollection: 'seatReservations',
        docId: reservationId,
        fallbackRootCollection: 'seatReservations',
      });
      if (reservation) {
        return reservation;
      }
    }

    return {
      id: reservationId ?? `${seatId}_${Date.now()}`,
      seatId,
      userId,
      schoolId: resolvedSchoolId,
      date,
      startTime,
      endTime,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
  },

  async cancelSeatReservation(id, userId = undefined, schoolId = undefined) {
    const resolvedSchoolId = userId
      ? await resolveUserSchoolId(userId, schoolId)
      : (schoolId ?? null);
    if (resolvedSchoolId) {
      const cancelSeatReservation = httpsCallable<
        { schoolId: string; reservationId: string },
        { success?: boolean }
      >(getFunctionsInstance(), 'cancelSeatReservation');
      await cancelSeatReservation({ schoolId: resolvedSchoolId, reservationId: id });
      return;
    }

    await updateDocument<SeatReservation>('seatReservations', id, { status: 'cancelled' });
  },

  // ===== 公車 =====
  async listBusRoutes(schoolId) {
    return fetchCanonicalSchoolCollection<BusRoute>({
      schoolId,
      canonicalCollections: ['busRoutes'],
      schoolConstraints: [where('isActive', '==', true)],
      fallbackCollection: 'busRoutes',
      fallbackConstraints: [bySchool(schoolId), where('isActive', '==', true)],
    });
  },

  async getBusRoute(id) {
    return fetchDocument<BusRoute>('busRoutes', id);
  },

  async getBusArrivals(stopId) {
    return fetchCollection<BusArrival>('busArrivals', [where('stopId', '==', stopId)]);
  },

  // ===== 通知 =====
  async listNotifications(userId, options) {
    return fetchCollection<Notification>(
      'notifications',
      [byUser(userId), orderBy('createdAt', 'desc')],
      undefined,
      options,
    );
  },

  async markNotificationRead(id) {
    await updateDocument<Notification>('notifications', id, { read: true });
  },

  async markAllNotificationsRead(userId) {
    const db = getDb();
    const unread = await getDocs(
      query(
        collection(db, 'notifications'),
        where('userId', '==', userId),
        where('read', '==', false),
      ),
    );

    const batch = writeBatch(db);
    unread.docs.forEach((d) => batch.update(d.ref, { read: true }));
    await batch.commit();
  },

  async deleteNotification(id) {
    await deleteDocument('notifications', id);
  },

  // ===== 行事曆 =====
  async listCalendarEvents(userId, startDate, endDate, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    const constraints: (QueryConstraint | null)[] = [
      byUser(userId),
      where('startAt', '>=', startDate),
      where('startAt', '<=', endDate),
      orderBy('startAt', 'asc'),
    ];
    return fetchCanonicalUserSchoolCollection<CalendarEvent>({
      uid: userId,
      schoolId: resolvedSchoolId,
      canonicalCollection: 'calendarEvents',
      canonicalConstraints: constraints,
      fallbackRootCollection: 'calendarEvents',
      fallbackRootConstraints: constraints,
    });
  },

  async createCalendarEvent(data) {
    if (!data.userId) {
      throw new Error('缺少 userId，無法建立行事曆事件');
    }
    const resolvedSchoolId = await resolveUserSchoolId(data.userId, (data as any).schoolId);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法建立行事曆事件');
    }

    return createDocumentAtPath<CalendarEvent>(
      buildUserSchoolCollectionPath(data.userId, resolvedSchoolId, 'calendarEvents'),
      {
        ...(data as Omit<CalendarEvent, 'id'>),
      },
    );
  },

  async updateCalendarEvent(id, data, userId = undefined, schoolId = undefined) {
    const ownerId = userId ?? data.userId;
    const resolvedSchoolId = ownerId
      ? await resolveUserSchoolId(ownerId, schoolId ?? (data as any).schoolId)
      : null;
    if (ownerId && resolvedSchoolId) {
      await updateDocumentAtPath<CalendarEvent>(
        buildUserSchoolCollectionPath(ownerId, resolvedSchoolId, 'calendarEvents', id),
        data,
      );
      return (await fetchCanonicalUserSchoolDocument<CalendarEvent>({
        uid: ownerId,
        schoolId: resolvedSchoolId,
        canonicalCollection: 'calendarEvents',
        docId: id,
        fallbackRootCollection: 'calendarEvents',
      })) as CalendarEvent;
    }

    return updateDocument<CalendarEvent>('calendarEvents', id, data);
  },

  async deleteCalendarEvent(id, userId = undefined, schoolId = undefined) {
    const resolvedSchoolId = userId
      ? await resolveUserSchoolId(userId, schoolId)
      : (schoolId ?? null);
    if (userId && resolvedSchoolId) {
      await deleteDocumentAtPath(
        buildUserSchoolCollectionPath(userId, resolvedSchoolId, 'calendarEvents', id),
      );
      return;
    }
    await deleteDocument('calendarEvents', id);
  },

  async syncCoursesToCalendar(userId, semester, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    const enrollments = await this.listEnrollments(userId, semester, resolvedSchoolId ?? undefined);
    const db = getDb();

    for (const enrollment of enrollments) {
      if (enrollment.status !== 'enrolled') continue;

      const course = await this.getCourse(enrollment.courseId);
      if (!course) continue;

      for (const schedule of course.schedule) {
        if (!resolvedSchoolId) continue;
        await addDoc(
          collectionFromSegments(
            db,
            buildUserSchoolCollectionPath(userId, resolvedSchoolId, 'calendarEvents'),
          ),
          {
            userId,
            schoolId: resolvedSchoolId,
            title: course.name,
            description: `${course.code} - ${course.instructor}`,
            startAt: schedule.startTime,
            endAt: schedule.endTime,
            location: schedule.location,
            type: 'class',
            sourceId: course.id,
            sourceType: 'course',
            recurrence: {
              frequency: 'weekly',
              byDays: [schedule.dayOfWeek],
            },
            createdAt: serverTimestamp(),
          },
        );
      }
    }
  },

  // ===== 訂單與支付 =====
  async listOrders(userId, options, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    const constraints: (QueryConstraint | null)[] = [byUser(userId), orderBy('createdAt', 'desc')];

    if (resolvedSchoolId) {
      const canonicalRows = await fetchCanonicalUserSchoolCollection<Order>({
        uid: userId,
        schoolId: resolvedSchoolId,
        canonicalCollection: 'orders',
        canonicalConstraints: constraints,
        fallbackRootCollection: 'orders',
        fallbackRootConstraints: constraints,
        options,
      });
      if (canonicalRows.length > 0) {
        return canonicalRows;
      }

      try {
        return fetchCollectionAtPath<Order>(
          buildSchoolCollectionPath(resolvedSchoolId, 'orders'),
          constraints,
          options,
        );
      } catch (error) {
        console.warn('[firebaseSource] listOrders school orders fallback failed:', error);
      }
    }

    return fetchCollection<Order>('orders', constraints, undefined, options);
  },

  async getOrder(id, userId = undefined, schoolId = undefined) {
    const resolvedSchoolId = userId
      ? await resolveUserSchoolId(userId, schoolId)
      : (schoolId ?? null);
    if (userId && resolvedSchoolId) {
      const canonicalOrder = await fetchCanonicalUserSchoolDocument<Order>({
        uid: userId,
        schoolId: resolvedSchoolId,
        canonicalCollection: 'orders',
        docId: id,
        fallbackRootCollection: 'orders',
      });
      if (canonicalOrder) {
        return canonicalOrder;
      }
      return fetchDocumentAtPath<Order>(buildSchoolCollectionPath(resolvedSchoolId, 'orders', id));
    }
    return fetchDocument<Order>('orders', id);
  },

  async createOrder(data) {
    const resolvedSchoolId = await resolveUserSchoolId(data.userId, (data as any).schoolId);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法建立訂單');
    }
    const createOrder = httpsCallable<
      {
        schoolId: string;
        cafeteriaId: string;
        merchantId?: string;
        cafeteria?: string;
        items: Array<Record<string, unknown>>;
        pickupTime?: string;
        note?: string;
        paymentMethod?: string;
      },
      { orderId?: string; total?: number }
    >(getFunctionsInstance(), 'createOrder');
    const cafeteriaId = (data as Record<string, unknown>).cafeteriaId as string | undefined;
    if (!cafeteriaId) {
      throw new Error('缺少 cafeteriaId，無法建立訂單');
    }
    const result = await createOrder({
      schoolId: resolvedSchoolId,
      cafeteriaId,
      merchantId: (data as Record<string, unknown>).merchantId as string | undefined,
      cafeteria: (data as Record<string, unknown>).cafeteria as string | undefined,
      items: data.items as Array<Record<string, unknown>>,
      pickupTime: (data as Record<string, unknown>).pickupTime as string | undefined,
      note: (data as Record<string, unknown>).note as string | undefined,
      paymentMethod: (data as Record<string, unknown>).paymentMethod as string | undefined,
    });
    const orderId = result.data?.orderId;
    if (!orderId) {
      throw new Error('建立訂單失敗');
    }

    const order = await fetchCanonicalUserSchoolDocument<Order>({
      uid: data.userId,
      schoolId: resolvedSchoolId,
      canonicalCollection: 'orders',
      docId: orderId,
      fallbackRootCollection: 'orders',
    });
    if (!order) {
      throw new Error('建立訂單後找不到訂單資料');
    }
    return order;
  },

  async updateOrderStatus(id, status, userId = undefined, schoolId = undefined) {
    const resolvedSchoolId = userId
      ? await resolveUserSchoolId(userId, schoolId)
      : (schoolId ?? null);
    if (resolvedSchoolId) {
      const updateOrderStatus = httpsCallable<
        { schoolId: string; orderId: string; status: string },
        { success?: boolean }
      >(getFunctionsInstance(), 'updateOrderStatus');
      await updateOrderStatus({ schoolId: resolvedSchoolId, orderId: id, status });
      if (userId) {
        return (await fetchCanonicalUserSchoolDocument<Order>({
          uid: userId,
          schoolId: resolvedSchoolId,
          canonicalCollection: 'orders',
          docId: id,
          fallbackRootCollection: 'orders',
        })) as Order;
      }

      return (await fetchDocumentAtPath<Order>(
        buildSchoolCollectionPath(resolvedSchoolId, 'orders', id),
      )) as Order;
    }

    return updateDocument<Order>('orders', id, { status });
  },

  async cancelOrder(id, userId = undefined, schoolId = undefined) {
    const resolvedSchoolId = userId
      ? await resolveUserSchoolId(userId, schoolId)
      : (schoolId ?? null);
    if (resolvedSchoolId) {
      const cancelOrder = httpsCallable<
        { schoolId: string; orderId: string },
        { success?: boolean }
      >(getFunctionsInstance(), 'cancelOrder');
      await cancelOrder({ schoolId: resolvedSchoolId, orderId: id });
      return;
    }
    await updateDocument<Order>('orders', id, { status: 'cancelled' });
  },

  async listTransactions(userId, options, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    try {
      const getTransactionHistory = httpsCallable<
        { schoolId?: string; limit?: number; type?: string },
        { transactions?: Array<Record<string, unknown>> }
      >(getFunctionsInstance(), 'getTransactionHistory');
      const result = await getTransactionHistory({
        schoolId: resolvedSchoolId ?? undefined,
        limit: options?.pageSize ?? DEFAULT_PAGE_SIZE,
      });

      const rows = Array.isArray(result.data?.transactions) ? result.data.transactions : [];
      return rows.map((row) => ({
        id: String(row.id ?? ''),
        userId,
        amount: Number(row.amount ?? 0),
        currency: String(row.currency ?? 'TWD'),
        type: String(row.type ?? 'payment') as Transaction['type'],
        status: String(row.status ?? 'pending') as Transaction['status'],
        description: String(row.description ?? '交易'),
        merchantId: typeof row.merchantId === 'string' ? row.merchantId : undefined,
        merchantName: typeof row.merchantName === 'string' ? row.merchantName : undefined,
        paymentMethodId:
          typeof row.paymentMethod === 'string'
            ? row.paymentMethod
            : typeof row.paymentMethodId === 'string'
              ? row.paymentMethodId
              : undefined,
        createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString(),
        completedAt: typeof row.completedAt === 'string' ? row.completedAt : undefined,
      }));
    } catch (error) {
      console.warn('[firebaseSource] listTransactions callable failed, falling back:', error);
      const constraints: (QueryConstraint | null)[] = [
        byUser(userId),
        orderBy('createdAt', 'desc'),
      ];
      return fetchCanonicalUserSchoolCollection<Transaction>({
        uid: userId,
        schoolId: resolvedSchoolId,
        canonicalCollection: 'transactions',
        canonicalConstraints: constraints,
        fallbackRootCollection: 'transactions',
        fallbackRootConstraints: constraints,
        options,
      });
    }
  },

  // ===== 成就 =====
  async listAchievements() {
    return fetchCollection<UserAchievement>('achievements', []);
  },

  async getUserAchievements(userId, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    return fetchCanonicalUserSchoolCollection<UserAchievement>({
      uid: userId,
      schoolId: resolvedSchoolId,
      canonicalCollection: 'achievements',
      canonicalConstraints: [orderBy('updatedAt', 'desc')],
      fallbackUserCollection: 'achievements',
      fallbackUserConstraints: [orderBy('updatedAt', 'desc')],
      fallbackRootCollection: 'userAchievements',
      fallbackRootConstraints: [byUser(userId)],
    });
  },

  async updateAchievementProgress(userId, achievementId, progress, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法更新成就');
    }
    const trackAchievement = httpsCallable<
      { schoolId: string; achievementId: string; progress: number },
      { success?: boolean; unlocked?: boolean }
    >(getFunctionsInstance(), 'trackAchievement');
    await trackAchievement({ schoolId: resolvedSchoolId, achievementId, progress });
    return (await fetchDocumentAtPath<UserAchievement>(
      buildUserSchoolCollectionPath(userId, resolvedSchoolId, 'achievements', achievementId),
    )) as UserAchievement;
  },

  // ===== 宿舍服務 =====
  async getDormitoryInfo(userId) {
    const docs = await fetchCollection<DormitoryInfo>('dormitoryInfo', [byUser(userId)]);
    return docs[0] ?? null;
  },

  async listRepairRequests(userId, options, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    if (resolvedSchoolId) {
      try {
        const rows = await fetchCollectionAtPath<RepairRequest>(
          buildSchoolCollectionPath(resolvedSchoolId, 'repairRequests'),
          [byUser(userId), orderBy('createdAt', 'desc')],
          options,
        );
        if (rows.length > 0) {
          return rows.map((row) =>
            normalizeRepairRequestRecord(row as unknown as Record<string, unknown>),
          );
        }
      } catch (error) {
        console.warn('[firebaseSource] listRepairRequests school-scoped read failed:', error);
      }
    }

    const legacyRows = await fetchCollection<RepairRequest>(
      'repairRequests',
      [byUser(userId), orderBy('createdAt', 'desc')],
      undefined,
      options,
    );
    return legacyRows.map((row) =>
      normalizeRepairRequestRecord(row as unknown as Record<string, unknown>),
    );
  },

  async createRepairRequest(data) {
    const resolvedSchoolId = await resolveUserSchoolId(data.userId, data.schoolId);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法建立報修單');
    }

    const submitRepairRequest = httpsCallable<
      {
        schoolId: string;
        dormitory: string;
        room: string;
        category: string;
        description: string;
        urgency?: string;
        images?: string[];
      },
      { requestId?: string }
    >(getFunctionsInstance(), 'submitRepairRequest');
    const result = await submitRepairRequest({
      schoolId: resolvedSchoolId,
      dormitory: data.room?.split(' ')[0] || '宿舍',
      room: data.room,
      category: data.type,
      description: data.description,
      urgency: data.priority,
      images: data.images,
    });
    const requestId = result.data?.requestId;
    if (!requestId) {
      throw new Error('建立報修單失敗');
    }

    const row = await fetchDocumentAtPath<RepairRequest>(
      buildSchoolCollectionPath(resolvedSchoolId, 'repairRequests', requestId),
    );
    return normalizeRepairRequestRecord(
      (row ?? {
        id: requestId,
        ...data,
        schoolId: resolvedSchoolId,
        status: 'pending',
        createdAt: new Date().toISOString(),
      }) as Record<string, unknown>,
    );
  },

  async updateRepairRequest(id, data) {
    return updateDocument<RepairRequest>('repairRequests', id, data);
  },

  async cancelRepairRequest(id) {
    await updateDocument<RepairRequest>('repairRequests', id, { status: 'cancelled' });
  },

  async listDormPackages(userId, options, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    if (resolvedSchoolId) {
      try {
        const rows = await fetchCollectionAtPath<DormPackage>(
          buildSchoolCollectionPath(resolvedSchoolId, 'packages'),
          [where('recipientId', '==', userId), orderBy('createdAt', 'desc')],
          options,
        );
        if (rows.length > 0) {
          return rows.map((row) =>
            normalizeDormPackageRecord(row as unknown as Record<string, unknown>),
          );
        }
      } catch (error) {
        console.warn('[firebaseSource] listDormPackages school-scoped read failed:', error);
      }
    }

    const legacyRows = await fetchCollection<DormPackage>(
      'dormPackages',
      [byUser(userId), orderBy('arrivedAt', 'desc')],
      undefined,
      options,
    );
    return legacyRows.map((row) =>
      normalizeDormPackageRecord(row as unknown as Record<string, unknown>),
    );
  },

  async confirmPackagePickup(id, schoolId = undefined) {
    const uid = getAuthInstance().currentUser?.uid;
    if (!uid) {
      throw new Error('請先登入');
    }

    const resolvedSchoolId = await resolveUserSchoolId(uid, schoolId);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法確認取件');
    }

    const confirmPackagePickup = httpsCallable<
      { schoolId: string; packageId: string },
      { success?: boolean }
    >(getFunctionsInstance(), 'confirmPackagePickup');
    await confirmPackagePickup({ schoolId: resolvedSchoolId, packageId: id });
  },

  async listWashingMachines(schoolId, building) {
    const constraints: (QueryConstraint | null)[] = [];
    if (building) {
      constraints.push(where('building', '==', building));
    }

    if (schoolId) {
      try {
        return await fetchCollectionAtPath<WashingMachine>(
          buildSchoolCollectionPath(schoolId, 'washingMachines'),
          constraints,
        );
      } catch (error) {
        console.warn('[firebaseSource] listWashingMachines school-scoped read failed:', error);
      }
    }

    return fetchCollection<WashingMachine>('washingMachines', [bySchool(schoolId), ...constraints], schoolId);
  },

  async listWashingReservations(userId, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    if (resolvedSchoolId) {
      try {
        const rows = await fetchCollectionAtPath<WashingReservation>(
          buildSchoolCollectionPath(resolvedSchoolId, 'washingReservations'),
          [byUser(userId), where('status', 'in', ['reserved', 'inUse', 'active'])],
        );
        if (rows.length > 0) {
          return rows.map((row) =>
            normalizeWashingReservationRecord(row as unknown as Record<string, unknown>),
          );
        }
      } catch (error) {
        console.warn('[firebaseSource] listWashingReservations school-scoped read failed:', error);
      }
    }

    const legacyRows = await fetchCollection<WashingReservation>('washingReservations', [
      byUser(userId),
      where('status', 'in', ['reserved', 'inUse']),
    ]);
    return legacyRows.map((row) =>
      normalizeWashingReservationRecord(row as unknown as Record<string, unknown>),
    );
  },

  async reserveWashingMachine(machineId, userId, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法預約洗衣機');
    }

    const machine = await fetchDocumentAtPath<WashingMachine>(
      buildSchoolCollectionPath(resolvedSchoolId, 'washingMachines', machineId),
    );
    if (!machine || machine.status !== 'available') {
      throw new Error('洗衣機目前不可預約');
    }

    const reserveWashingMachine = httpsCallable<
      { schoolId: string; dormitory: string; machineId: string; startTime: string },
      { reservationId?: string; reservedUntil?: string }
    >(getFunctionsInstance(), 'reserveWashingMachine');
    const startTime = new Date().toISOString();
    const result = await reserveWashingMachine({
      schoolId: resolvedSchoolId,
      dormitory: machine.building,
      machineId,
      startTime,
    });
    const reservationId = result.data?.reservationId;
    if (reservationId) {
      const reservation = await fetchDocumentAtPath<WashingReservation>(
        buildSchoolCollectionPath(resolvedSchoolId, 'washingReservations', reservationId),
      );
      if (reservation) {
        return normalizeWashingReservationRecord(
          reservation as unknown as Record<string, unknown>,
        );
      }
    }

    return {
      id: reservationId ?? `${machineId}_${Date.now()}`,
      machineId,
      userId,
      startTime,
      status: 'reserved',
      createdAt: new Date().toISOString(),
    };
  },

  async cancelWashingReservation(id, schoolId = undefined) {
    const uid = getAuthInstance().currentUser?.uid;
    if (!uid) {
      throw new Error('請先登入');
    }

    const resolvedSchoolId = await resolveUserSchoolId(uid, schoolId);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法取消洗衣預約');
    }

    const cancelWashingReservation = httpsCallable<
      { schoolId: string; reservationId: string },
      { success?: boolean }
    >(getFunctionsInstance(), 'cancelWashingReservation');
    await cancelWashingReservation({ schoolId: resolvedSchoolId, reservationId: id });
  },

  async listDormAnnouncements(schoolId, building) {
    const constraints: (QueryConstraint | null)[] = [
      bySchool(schoolId),
      orderBy('publishedAt', 'desc'),
    ];
    if (building) {
      constraints.push(where('building', '==', building));
    }
    return fetchCollection<DormAnnouncement>('dormAnnouncements', constraints, schoolId);
  },

  // ===== 列印服務 =====
  async listPrinters(schoolId, options) {
    if (schoolId) {
      try {
        return await fetchCollectionAtPath<Printer>(
          buildSchoolCollectionPath(schoolId, 'printers'),
          [],
          options,
        );
      } catch (error) {
        console.warn('[firebaseSource] listPrinters school-scoped read failed:', error);
      }
    }

    return fetchCollection<Printer>('printers', [bySchool(schoolId)], schoolId, options);
  },

  async getPrinter(id) {
    return fetchDocument<Printer>('printers', id);
  },

  async listPrintJobs(userId, options, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    if (resolvedSchoolId) {
      try {
        const rows = await fetchCollectionAtPath<PrintJob>(
          buildSchoolCollectionPath(resolvedSchoolId, 'printJobs'),
          [byUser(userId), orderBy('createdAt', 'desc')],
          options,
        );
        if (rows.length > 0) {
          return rows.map((row) =>
            normalizePrintJobRecord(row as unknown as Record<string, unknown>),
          );
        }
      } catch (error) {
        console.warn('[firebaseSource] listPrintJobs school-scoped read failed:', error);
      }
    }

    const legacyRows = await fetchCollection<PrintJob>(
      'printJobs',
      [byUser(userId), orderBy('createdAt', 'desc')],
      undefined,
      options,
    );
    return legacyRows.map((row) =>
      normalizePrintJobRecord(row as unknown as Record<string, unknown>),
    );
  },

  async createPrintJob(data) {
    const resolvedSchoolId = await resolveUserSchoolId(data.userId, (data as Record<string, unknown>).schoolId as string | undefined);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法建立列印工作');
    }

    const submitPrintJob = httpsCallable<
      {
        schoolId: string;
        printerId: string;
        fileName: string;
        fileUrl?: string;
        copies?: number;
        color?: boolean;
        duplex?: boolean;
        pages?: number;
      },
      { jobId?: string }
    >(getFunctionsInstance(), 'submitPrintJob');
    const result = await submitPrintJob({
      schoolId: resolvedSchoolId,
      printerId: data.printerId,
      fileName: data.fileName,
      fileUrl: data.fileUrl,
      copies: data.copies,
      color: data.color,
      duplex: data.duplex,
      pages: data.pages,
    });
    const jobId = result.data?.jobId;
    if (!jobId) {
      throw new Error('建立列印工作失敗');
    }

    const job = await fetchDocumentAtPath<PrintJob>(
      buildSchoolCollectionPath(resolvedSchoolId, 'printJobs', jobId),
    );
    return normalizePrintJobRecord(
      (job ?? {
        id: jobId,
        ...data,
        status: 'pending',
        cost: 0,
        createdAt: new Date().toISOString(),
      }) as Record<string, unknown>,
    );
  },

  async cancelPrintJob(id, schoolId = undefined) {
    const uid = getAuthInstance().currentUser?.uid;
    if (!uid) {
      throw new Error('請先登入');
    }

    const resolvedSchoolId = await resolveUserSchoolId(uid, schoolId);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法取消列印工作');
    }

    const cancelPrintJob = httpsCallable<
      { schoolId: string; jobId: string },
      { success?: boolean }
    >(getFunctionsInstance(), 'cancelPrintJob');
    await cancelPrintJob({ schoolId: resolvedSchoolId, jobId: id });
  },

  // ===== 健康服務 =====
  async listHealthAppointments(userId, options, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    if (resolvedSchoolId) {
      try {
        const rows = await fetchCollectionAtPath<HealthAppointment>(
          buildSchoolCollectionPath(resolvedSchoolId, 'healthAppointments'),
          [byUser(userId), orderBy('date', 'desc')],
          options,
        );
        if (rows.length > 0) {
          return rows.map((row) =>
            normalizeHealthAppointmentRecord(row as unknown as Record<string, unknown>),
          );
        }
      } catch (error) {
        console.warn('[firebaseSource] listHealthAppointments school-scoped read failed:', error);
      }
    }

    const legacyRows = await fetchCollection<HealthAppointment>(
      'healthAppointments',
      [byUser(userId), orderBy('date', 'desc')],
      undefined,
      options,
    );
    return legacyRows.map((row) =>
      normalizeHealthAppointmentRecord(row as unknown as Record<string, unknown>),
    );
  },

  async createHealthAppointment(data) {
    const resolvedSchoolId = await resolveUserSchoolId(data.userId, data.schoolId);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法建立健康預約');
    }

    const bookHealthAppointment = httpsCallable<
      {
        schoolId: string;
        date: string;
        timeSlot: string;
        department: string;
        doctorId?: string;
        doctorName?: string;
        reason?: string;
        notes?: string;
      },
      { appointmentId?: string }
    >(getFunctionsInstance(), 'bookHealthAppointment');
    const result = await bookHealthAppointment({
      schoolId: resolvedSchoolId,
      date: data.date,
      timeSlot: data.timeSlot,
      department: data.department,
      doctorId: data.doctorId,
      doctorName: data.doctorName,
      reason: data.reason,
      notes: data.notes,
    });
    const appointmentId = result.data?.appointmentId;
    if (!appointmentId) {
      throw new Error('建立健康預約失敗');
    }

    const appointment = await fetchDocumentAtPath<HealthAppointment>(
      buildSchoolCollectionPath(resolvedSchoolId, 'healthAppointments', appointmentId),
    );
    return normalizeHealthAppointmentRecord(
      (appointment ?? {
        id: appointmentId,
        ...data,
        schoolId: resolvedSchoolId,
        status: 'scheduled',
        createdAt: new Date().toISOString(),
      }) as Record<string, unknown>,
    );
  },

  async cancelHealthAppointment(id, schoolId = undefined) {
    const uid = getAuthInstance().currentUser?.uid;
    if (!uid) {
      throw new Error('請先登入');
    }

    const resolvedSchoolId = await resolveUserSchoolId(uid, schoolId);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法取消健康預約');
    }

    const cancelHealthAppointment = httpsCallable<
      { schoolId: string; appointmentId: string },
      { success?: boolean }
    >(getFunctionsInstance(), 'cancelHealthAppointment');
    await cancelHealthAppointment({ schoolId: resolvedSchoolId, appointmentId: id });
  },

  async rescheduleHealthAppointment(id, data, schoolId = undefined) {
    const uid = getAuthInstance().currentUser?.uid;
    if (!uid) {
      throw new Error('請先登入');
    }

    const resolvedSchoolId = await resolveUserSchoolId(uid, schoolId);
    if (!resolvedSchoolId) {
      throw new Error('缺少 schoolId，無法更改健康預約');
    }

    const rescheduleHealthAppointment = httpsCallable<
      { schoolId: string; appointmentId: string; date: string; timeSlot: string; doctorId?: string; doctorName?: string },
      { success?: boolean }
    >(getFunctionsInstance(), 'rescheduleHealthAppointment');
    await rescheduleHealthAppointment({
      schoolId: resolvedSchoolId,
      appointmentId: id,
      date: data.date,
      timeSlot: data.timeSlot,
      doctorId: data.doctorId,
      doctorName: data.doctorName,
    });

    const appointment = await fetchDocumentAtPath<HealthAppointment>(
      buildSchoolCollectionPath(resolvedSchoolId, 'healthAppointments', id),
    );
    return normalizeHealthAppointmentRecord(appointment as unknown as Record<string, unknown>);
  },

  async listHealthRecords(userId, options, schoolId = undefined) {
    const resolvedSchoolId = await resolveUserSchoolId(userId, schoolId);
    if (!resolvedSchoolId) {
      return [];
    }

    try {
      const getHealthRecords = httpsCallable<
        { schoolId: string; limit?: number },
        { records?: Array<Record<string, unknown>> }
      >(getFunctionsInstance(), 'getHealthRecords');
      const result = await getHealthRecords({
        schoolId: resolvedSchoolId,
        limit: options?.pageSize ?? DEFAULT_PAGE_SIZE,
      });
      const rows = Array.isArray(result.data?.records) ? result.data.records : [];
      return rows.map((row) => normalizeHealthRecordRecord(row));
    } catch (error) {
      console.warn('[firebaseSource] listHealthRecords callable failed, falling back:', error);
    }

    const fallbackRows = await fetchCollectionAtPath<HealthRecord>(
      buildSchoolCollectionPath(resolvedSchoolId, 'healthRecords'),
      [byUser(userId), orderBy('date', 'desc')],
      options,
    ).catch(() => []);
    return fallbackRows.map((row) =>
      normalizeHealthRecordRecord(row as unknown as Record<string, unknown>),
    );
  },

  async listHealthTimeSlots(department, date, schoolId) {
    if (schoolId) {
      try {
        return await fetchCollectionAtPath<HealthTimeSlot>(
          buildSchoolCollectionPath(schoolId, 'healthTimeSlots'),
          [where('department', '==', department), where('date', '==', date)],
        );
      } catch (error) {
        console.warn('[firebaseSource] listHealthTimeSlots school-scoped read failed:', error);
      }
    }

    return fetchCollection<HealthTimeSlot>(
      'healthTimeSlots',
      [bySchool(schoolId), where('department', '==', department), where('date', '==', date)],
      schoolId,
    );
  },

  async createAccessApplication(data) {
    const db = getDb();
    const docRef = await addDoc(collection(db, 'accessApplications'), {
      ...data,
      status: 'pending',
      createdAt: serverTimestamp(),
    });

    return {
      id: docRef.id,
      status: 'pending' as const,
    };
  },

  async createLateReturnRecord(data) {
    const db = getDb();
    const docRef = await addDoc(collection(db, 'lateReturnRecords'), {
      ...data,
      createdAt: serverTimestamp(),
    });

    return { id: docRef.id };
  },

  async createVisitorRecord(data) {
    const db = getDb();
    const docRef = await addDoc(collection(db, 'visitorRecords'), {
      ...data,
      createdAt: serverTimestamp(),
    });

    return { id: docRef.id };
  },

  // ===== 安全支付操作 =====
  // 這些操作必須通過後端 Cloud Function 處理，確保餘額更新的安全性
  async processTopup(data: { userId: string; amount: number; paymentMethod: string }): Promise<{
    success: boolean;
    newBalance?: number;
    transactionId?: string;
    errorCode?: string;
    errorMessage?: string;
  }> {
    if (!getAuthInstance().currentUser) {
      return {
        success: false,
        errorCode: 'AUTH_ERROR',
        errorMessage: '請先登入',
      };
    }

    const normalizedPaymentMethod =
      data.paymentMethod === 'mobile_pay'
        ? 'linepay'
        : data.paymentMethod === 'credit_card'
          ? 'credit_card'
          : data.paymentMethod === 'student_card'
            ? 'linepay'
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
      >(getFunctionsInstance(), 'createTopupIntent');
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
            (payload.status === 'provider_disabled'
              ? 'EXTERNAL_PROVIDER_DISABLED'
              : 'PAYMENT_PROVIDER_UNAVAILABLE'),
          errorMessage: payload.errorMessage ?? '外部儲值服務尚未開通，請等待支付供應商完成設定。',
        };
      }

      return {
        success: true,
        newBalance: payload.newBalance,
        transactionId:
          (typeof payload.transactionId === 'string' ? payload.transactionId : undefined) ??
          (typeof payload.intentId === 'string' ? payload.intentId : undefined),
      };
    } catch (error: any) {
      console.error('[firebaseSource] processTopup error:', error);
      return {
        success: false,
        errorCode: error?.code ?? 'NETWORK_ERROR',
        errorMessage: error?.message ?? '儲值失敗，請稍後再試',
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
        errorCode: 'AUTH_ERROR',
        errorMessage: '請先登入',
      };
    }

    const normalizedPaymentMethod =
      data.paymentMethod === 'student_card'
        ? 'campus_card'
        : data.paymentMethod === 'mobile_pay'
          ? 'linepay'
          : data.paymentMethod === 'credit_card'
            ? 'credit_card'
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
      >(getFunctionsInstance(), 'createPaymentIntent');
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
            (payload.status === 'provider_disabled'
              ? 'EXTERNAL_PROVIDER_DISABLED'
              : 'PAYMENT_FAILED'),
          errorMessage: payload.errorMessage ?? '支付失敗，請稍後再試',
        };
      }

      return {
        success: true,
        newBalance: payload.newBalance,
        transactionId:
          (typeof payload.transactionId === 'string' ? payload.transactionId : undefined) ??
          (typeof payload.intentId === 'string' ? payload.intentId : undefined),
      };
    } catch (error: any) {
      console.error('[firebaseSource] processPayment error:', error);
      return {
        success: false,
        errorCode: error?.code ?? 'NETWORK_ERROR',
        errorMessage: error?.message ?? '支付失敗，請稍後再試',
      };
    }
  },
};
