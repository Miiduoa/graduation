/**
 * Firebase Client for Web App
 * 提供與 Firebase Firestore 和 Auth 的連接
 */

import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  QueryConstraint,
  Firestore,
  serverTimestamp,
  increment,
  runTransaction,
} from "firebase/firestore";
import {
  getAuth as firebaseGetAuth,
  Auth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  updateProfile,
  User,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

function getApp(): FirebaseApp {
  if (app) return app;
  
  if (getApps().length === 0) {
    if (!firebaseConfig.projectId) {
      throw new Error("Firebase configuration is missing. Check your environment variables.");
    }
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }
  
  return app;
}

function getDb(): Firestore {
  if (db) return db;
  db = getFirestore(getApp());
  return db;
}

export function getAuth(): Auth | null {
  if (typeof window === "undefined") return null;
  if (auth) return auth;
  try {
    auth = firebaseGetAuth(getApp());
    return auth;
  } catch (error) {
    console.error("[Firebase] Failed to initialize auth:", error);
    return null;
  }
}

export async function signIn(email: string, password: string): Promise<User | null> {
  const authInstance = getAuth();
  if (!authInstance) return null;
  
  const credential = await signInWithEmailAndPassword(authInstance, email, password);
  return credential.user;
}

export async function signUp(
  email: string,
  password: string,
  displayName?: string
): Promise<User | null> {
  const authInstance = getAuth();
  if (!authInstance) return null;
  
  const credential = await createUserWithEmailAndPassword(authInstance, email, password);
  
  if (displayName && credential.user) {
    await updateProfile(credential.user, { displayName });
  }
  
  return credential.user;
}

export async function signOut(): Promise<void> {
  const authInstance = getAuth();
  if (!authInstance) return;
  await firebaseSignOut(authInstance);
}

export async function resetPassword(email: string): Promise<void> {
  const authInstance = getAuth();
  if (!authInstance) throw new Error("Auth not initialized");
  await sendPasswordResetEmail(authInstance, email);
}

export function getCurrentUser(): User | null {
  const authInstance = getAuth();
  return authInstance?.currentUser ?? null;
}

export { onAuthStateChanged };

function parseDocument<T extends { id: string }>(
  docSnap: { id: string; data: () => Record<string, unknown> | undefined }
): T | null {
  const data = docSnap.data();
  if (!data) return null;

  const parsed: Record<string, unknown> = { id: docSnap.id };

  for (const [key, value] of Object.entries(data)) {
    if (value instanceof Timestamp) {
      parsed[key] = value.toDate().toISOString();
    } else {
      parsed[key] = value;
    }
  }

  return parsed as T;
}

export type Announcement = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  source?: string;
  category?: string;
  pinned?: boolean;
  schoolId?: string;
};

export type ClubEvent = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  capacity?: number;
  registeredCount?: number;
  category?: string;
  organizer?: string;
  imageUrl?: string;
  schoolId?: string;
};

export type Poi = {
  id: string;
  name: string;
  description: string;
  category: string;
  lat: number;
  lng: number;
  floor?: number;
  building?: string;
  imageUrl?: string;
  accessible?: boolean;
  schoolId?: string;
};

export type MenuItem = {
  id: string;
  name: string;
  cafeteria: string;
  availableOn: string;
  price?: number;
  category?: string;
  description?: string;
  calories?: number;
  vegetarian?: boolean;
  rating?: number;
  soldOut?: boolean;
  schoolId?: string;
};

export type BusRoute = {
  id: string;
  name: string;
  description?: string;
  stops: Array<{ id: string; name: string; lat: number; lng: number; order: number }>;
  isActive: boolean;
  color?: string;
  schoolId?: string;
};

export type LibraryBook = {
  id: string;
  isbn?: string;
  title: string;
  author: string;
  publisher?: string;
  publishYear?: number;
  location: string;
  available: number;
  total: number;
  coverUrl?: string;
  schoolId?: string;
};

export type Group = {
  id: string;
  name: string;
  description?: string;
  type: string;
  courseId?: string;
  memberCount: number;
  createdBy: string;
  createdAt: string;
  schoolId?: string;
};

export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.projectId);
}

export async function fetchAnnouncements(
  schoolId: string,
  maxItems: number = 20
): Promise<Announcement[]> {
  if (!isFirebaseConfigured()) {
    console.log("[Firebase] Not configured, returning empty array");
    return [];
  }

  try {
    const firestore = getDb();
    const constraints: QueryConstraint[] = [
      where("schoolId", "==", schoolId),
      orderBy("publishedAt", "desc"),
      limit(maxItems),
    ];

    const q = query(collection(firestore, "announcements"), ...constraints);
    const snap = await getDocs(q);

    return snap.docs
      .map((d) => parseDocument<Announcement>({ id: d.id, data: () => d.data() }))
      .filter((a): a is Announcement => a !== null);
  } catch (error) {
    console.error("[Firebase] Failed to fetch announcements:", error);
    return [];
  }
}

export async function fetchEvents(
  schoolId: string,
  maxItems: number = 20
): Promise<ClubEvent[]> {
  if (!isFirebaseConfigured()) {
    return [];
  }

  try {
    const firestore = getDb();
    const constraints: QueryConstraint[] = [
      where("schoolId", "==", schoolId),
      orderBy("startsAt", "asc"),
      limit(maxItems),
    ];

    const q = query(collection(firestore, "events"), ...constraints);
    const snap = await getDocs(q);

    return snap.docs
      .map((d) => parseDocument<ClubEvent>({ id: d.id, data: () => d.data() }))
      .filter((e): e is ClubEvent => e !== null);
  } catch (error) {
    console.error("[Firebase] Failed to fetch events:", error);
    return [];
  }
}

export async function fetchPois(
  schoolId: string,
  maxItems: number = 100
): Promise<Poi[]> {
  if (!isFirebaseConfigured()) {
    return [];
  }

  try {
    const firestore = getDb();
    const constraints: QueryConstraint[] = [
      where("schoolId", "==", schoolId),
      limit(maxItems),
    ];

    const q = query(collection(firestore, "pois"), ...constraints);
    const snap = await getDocs(q);

    return snap.docs
      .map((d) => parseDocument<Poi>({ id: d.id, data: () => d.data() }))
      .filter((p): p is Poi => p !== null);
  } catch (error) {
    console.error("[Firebase] Failed to fetch POIs:", error);
    return [];
  }
}

export async function fetchMenus(
  schoolId: string,
  maxItems: number = 50
): Promise<MenuItem[]> {
  if (!isFirebaseConfigured()) {
    return [];
  }

  try {
    const firestore = getDb();
    const constraints: QueryConstraint[] = [
      where("schoolId", "==", schoolId),
      orderBy("availableOn", "desc"),
      limit(maxItems),
    ];

    const q = query(collection(firestore, "menus"), ...constraints);
    const snap = await getDocs(q);

    return snap.docs
      .map((d) => parseDocument<MenuItem>({ id: d.id, data: () => d.data() }))
      .filter((m): m is MenuItem => m !== null);
  } catch (error) {
    console.error("[Firebase] Failed to fetch menus:", error);
    return [];
  }
}

export async function fetchBusRoutes(
  schoolId: string
): Promise<BusRoute[]> {
  if (!isFirebaseConfigured()) {
    return [];
  }

  try {
    const firestore = getDb();
    const constraints: QueryConstraint[] = [
      where("schoolId", "==", schoolId),
      where("isActive", "==", true),
    ];

    const q = query(collection(firestore, "busRoutes"), ...constraints);
    const snap = await getDocs(q);

    return snap.docs
      .map((d) => parseDocument<BusRoute>({ id: d.id, data: () => d.data() }))
      .filter((r): r is BusRoute => r !== null);
  } catch (error) {
    console.error("[Firebase] Failed to fetch bus routes:", error);
    return [];
  }
}

export async function searchBooks(
  schoolId: string,
  searchQuery: string,
  maxItems: number = 20
): Promise<LibraryBook[]> {
  if (!isFirebaseConfigured()) {
    return [];
  }

  try {
    const firestore = getDb();
    const constraints: QueryConstraint[] = [
      where("schoolId", "==", schoolId),
      limit(100),
    ];

    const q = query(collection(firestore, "libraryBooks"), ...constraints);
    const snap = await getDocs(q);

    const books = snap.docs
      .map((d) => parseDocument<LibraryBook>({ id: d.id, data: () => d.data() }))
      .filter((b): b is LibraryBook => b !== null);

    const lowerQuery = searchQuery.toLowerCase();
    return books
      .filter(
        (b) =>
          b.title.toLowerCase().includes(lowerQuery) ||
          b.author.toLowerCase().includes(lowerQuery) ||
          b.isbn?.includes(lowerQuery)
      )
      .slice(0, maxItems);
  } catch (error) {
    console.error("[Firebase] Failed to search books:", error);
    return [];
  }
}

export async function fetchGroups(
  schoolId: string,
  maxItems: number = 20
): Promise<Group[]> {
  if (!isFirebaseConfigured()) {
    return [];
  }

  try {
    const firestore = getDb();
    const constraints: QueryConstraint[] = [
      where("schoolId", "==", schoolId),
      orderBy("createdAt", "desc"),
      limit(maxItems),
    ];

    const q = query(collection(firestore, "groups"), ...constraints);
    const snap = await getDocs(q);

    return snap.docs
      .map((d) => parseDocument<Group>({ id: d.id, data: () => d.data() }))
      .filter((g): g is Group => g !== null);
  } catch (error) {
    console.error("[Firebase] Failed to fetch groups:", error);
    return [];
  }
}

export type Grade = {
  id: string;
  userId: string;
  courseId: string;
  courseName: string;
  courseCode: string;
  credits: number;
  grade: string;
  score?: number;
  gpa?: number;
  instructor?: string;
  rank?: number;
  classSize?: number;
  semester: string;
  publishedAt?: string;
  schoolId?: string;
};

export type UserProfile = {
  id: string;
  email: string;
  displayName?: string;
  studentId?: string;
  department?: string;
  grade?: string;
  enrollmentYear?: number;
  avatarUrl?: string;
  phone?: string;
  bio?: string;
  schoolId?: string;
};

export type LibraryLoan = {
  id: string;
  userId: string;
  bookId: string;
  bookTitle?: string;
  bookAuthor?: string;
  borrowedAt: string;
  dueAt: string;
  returnedAt?: string;
  renewCount: number;
  status: string;
};

export async function fetchGrades(
  userId: string,
  semester?: string
): Promise<Grade[]> {
  if (!isFirebaseConfigured()) {
    return [];
  }

  try {
    const firestore = getDb();
    const constraints: QueryConstraint[] = [
      where("userId", "==", userId),
    ];
    
    if (semester) {
      constraints.push(where("semester", "==", semester));
    }
    
    constraints.push(orderBy("publishedAt", "desc"));

    const q = query(collection(firestore, "grades"), ...constraints);
    const snap = await getDocs(q);

    return snap.docs
      .map((d) => parseDocument<Grade>({ id: d.id, data: () => d.data() }))
      .filter((g): g is Grade => g !== null);
  } catch (error) {
    console.error("[Firebase] Failed to fetch grades:", error);
    return [];
  }
}

export async function fetchGPA(userId: string): Promise<{ cumulative: number; semesters: Array<{ semester: string; gpa: number }> } | null> {
  if (!isFirebaseConfigured()) {
    return null;
  }

  try {
    const firestore = getDb();
    const docRef = doc(firestore, "users", userId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      return null;
    }
    
    const data = docSnap.data();
    return {
      cumulative: data.cumulativeGpa ?? 0,
      semesters: data.semesterGpas ?? [],
    };
  } catch (error) {
    console.error("[Firebase] Failed to fetch GPA:", error);
    return null;
  }
}

export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  if (!isFirebaseConfigured()) {
    return null;
  }

  try {
    const firestore = getDb();
    const docRef = doc(firestore, "users", userId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      return null;
    }
    
    return parseDocument<UserProfile>({ id: docSnap.id, data: () => docSnap.data() });
  } catch (error) {
    console.error("[Firebase] Failed to fetch user profile:", error);
    return null;
  }
}

export async function fetchLibraryLoans(userId: string): Promise<LibraryLoan[]> {
  if (!isFirebaseConfigured()) {
    return [];
  }

  try {
    const firestore = getDb();
    const constraints: QueryConstraint[] = [
      where("userId", "==", userId),
      where("status", "==", "active"),
      orderBy("dueAt", "asc"),
    ];

    const q = query(collection(firestore, "libraryLoans"), ...constraints);
    const snap = await getDocs(q);

    return snap.docs
      .map((d) => parseDocument<LibraryLoan>({ id: d.id, data: () => d.data() }))
      .filter((l): l is LibraryLoan => l !== null);
  } catch (error) {
    console.error("[Firebase] Failed to fetch library loans:", error);
    return [];
  }
}

export async function fetchGroupPosts(
  groupId: string,
  maxItems: number = 20
): Promise<Array<{ id: string; groupId: string; authorId: string; authorName?: string; content: string; createdAt: string }>> {
  if (!isFirebaseConfigured()) {
    return [];
  }

  try {
    const firestore = getDb();
    const constraints: QueryConstraint[] = [
      where("groupId", "==", groupId),
      orderBy("createdAt", "desc"),
      limit(maxItems),
    ];

    const q = query(collection(firestore, "groupPosts"), ...constraints);
    const snap = await getDocs(q);

    return snap.docs
      .map((d) => parseDocument<{ id: string; groupId: string; authorId: string; authorName?: string; content: string; createdAt: string }>({ id: d.id, data: () => d.data() }))
      .filter((p): p is { id: string; groupId: string; authorId: string; authorName?: string; content: string; createdAt: string } => p !== null);
  } catch (error) {
    console.error("[Firebase] Failed to fetch group posts:", error);
    return [];
  }
}

// ========== 寫入操作 ==========

export type WriteResult = {
  success: boolean;
  id?: string;
  error?: string;
};

/**
 * 活動報名
 */
export async function registerForEvent(
  eventId: string,
  userId: string,
  userInfo?: { name?: string; email?: string; phone?: string }
): Promise<WriteResult> {
  if (!isFirebaseConfigured()) {
    return { success: false, error: "Firebase not configured" };
  }

  try {
    const firestore = getDb();
    const eventRef = doc(firestore, "events", eventId);
    const registrationRef = doc(collection(firestore, "events", eventId, "registrations"), userId);

    await runTransaction(firestore, async (transaction) => {
      const eventDoc = await transaction.get(eventRef);
      
      if (!eventDoc.exists()) {
        throw new Error("活動不存在");
      }

      const eventData = eventDoc.data();
      const capacity = eventData.capacity ?? 0;
      const registeredCount = eventData.registeredCount ?? 0;

      if (capacity > 0 && registeredCount >= capacity) {
        throw new Error("活動已額滿");
      }

      const existingReg = await transaction.get(registrationRef);
      if (existingReg.exists()) {
        throw new Error("您已報名此活動");
      }

      transaction.set(registrationRef, {
        userId,
        eventId,
        name: userInfo?.name,
        email: userInfo?.email,
        phone: userInfo?.phone,
        status: "registered",
        registeredAt: serverTimestamp(),
      });

      transaction.update(eventRef, {
        registeredCount: increment(1),
      });
    });

    return { success: true, id: eventId };
  } catch (error) {
    console.error("[Firebase] Failed to register for event:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * 取消活動報名
 */
export async function cancelEventRegistration(
  eventId: string,
  userId: string
): Promise<WriteResult> {
  if (!isFirebaseConfigured()) {
    return { success: false, error: "Firebase not configured" };
  }

  try {
    const firestore = getDb();
    const eventRef = doc(firestore, "events", eventId);
    const registrationRef = doc(collection(firestore, "events", eventId, "registrations"), userId);

    await runTransaction(firestore, async (transaction) => {
      const regDoc = await transaction.get(registrationRef);
      
      if (!regDoc.exists()) {
        throw new Error("您尚未報名此活動");
      }

      transaction.delete(registrationRef);
      transaction.update(eventRef, {
        registeredCount: increment(-1),
      });
    });

    return { success: true };
  } catch (error) {
    console.error("[Firebase] Failed to cancel registration:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * 檢查是否已報名
 */
export async function checkEventRegistration(
  eventId: string,
  userId: string
): Promise<boolean> {
  if (!isFirebaseConfigured() || !userId) {
    return false;
  }

  try {
    const firestore = getDb();
    const registrationRef = doc(collection(firestore, "events", eventId, "registrations"), userId);
    const regDoc = await getDoc(registrationRef);
    return regDoc.exists();
  } catch (error) {
    console.error("[Firebase] Failed to check registration:", error);
    return false;
  }
}

/**
 * 收藏項目
 */
export async function addFavorite(
  userId: string,
  itemType: "announcement" | "event" | "poi" | "menu" | "group",
  itemId: string,
  itemTitle?: string
): Promise<WriteResult> {
  if (!isFirebaseConfigured()) {
    return { success: false, error: "Firebase not configured" };
  }

  try {
    const firestore = getDb();
    const favoriteId = `${itemType}_${itemId}`;
    const favoriteRef = doc(collection(firestore, "users", userId, "favorites"), favoriteId);

    await setDoc(favoriteRef, {
      type: itemType,
      itemId,
      itemTitle,
      addedAt: serverTimestamp(),
    });

    return { success: true, id: favoriteId };
  } catch (error) {
    console.error("[Firebase] Failed to add favorite:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * 取消收藏
 */
export async function removeFavorite(
  userId: string,
  itemType: "announcement" | "event" | "poi" | "menu" | "group",
  itemId: string
): Promise<WriteResult> {
  if (!isFirebaseConfigured()) {
    return { success: false, error: "Firebase not configured" };
  }

  try {
    const firestore = getDb();
    const favoriteId = `${itemType}_${itemId}`;
    const favoriteRef = doc(collection(firestore, "users", userId, "favorites"), favoriteId);

    await deleteDoc(favoriteRef);

    return { success: true };
  } catch (error) {
    console.error("[Firebase] Failed to remove favorite:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * 檢查是否已收藏
 */
export async function checkFavorite(
  userId: string,
  itemType: "announcement" | "event" | "poi" | "menu" | "group",
  itemId: string
): Promise<boolean> {
  if (!isFirebaseConfigured() || !userId) {
    return false;
  }

  try {
    const firestore = getDb();
    const favoriteId = `${itemType}_${itemId}`;
    const favoriteRef = doc(collection(firestore, "users", userId, "favorites"), favoriteId);
    const favDoc = await getDoc(favoriteRef);
    return favDoc.exists();
  } catch (error) {
    console.error("[Firebase] Failed to check favorite:", error);
    return false;
  }
}

/**
 * 獲取使用者收藏列表
 */
export async function fetchFavorites(
  userId: string,
  itemType?: "announcement" | "event" | "poi" | "menu" | "group"
): Promise<Array<{ id: string; type: string; itemId: string; itemTitle?: string; addedAt: string }>> {
  if (!isFirebaseConfigured() || !userId) {
    return [];
  }

  try {
    const firestore = getDb();
    const favoritesRef = collection(firestore, "users", userId, "favorites");
    
    let q;
    if (itemType) {
      q = query(favoritesRef, where("type", "==", itemType), orderBy("addedAt", "desc"));
    } else {
      q = query(favoritesRef, orderBy("addedAt", "desc"));
    }

    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        type: data.type,
        itemId: data.itemId,
        itemTitle: data.itemTitle,
        addedAt: data.addedAt?.toDate?.()?.toISOString?.() ?? "",
      };
    });
  } catch (error) {
    console.error("[Firebase] Failed to fetch favorites:", error);
    return [];
  }
}

/**
 * 發表評論
 */
export async function postComment(
  targetType: "announcement" | "event" | "menu" | "poi",
  targetId: string,
  userId: string,
  content: string,
  rating?: number,
  userName?: string
): Promise<WriteResult> {
  if (!isFirebaseConfigured()) {
    return { success: false, error: "Firebase not configured" };
  }

  if (!content.trim()) {
    return { success: false, error: "評論內容不可為空" };
  }

  try {
    const firestore = getDb();
    const commentsRef = collection(firestore, `${targetType}s`, targetId, "comments");

    const docRef = await addDoc(commentsRef, {
      userId,
      userName,
      content: content.trim(),
      rating: rating ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      likes: 0,
      status: "active",
    });

    const targetRef = doc(firestore, `${targetType}s`, targetId);
    await updateDoc(targetRef, {
      commentCount: increment(1),
    });

    return { success: true, id: docRef.id };
  } catch (error) {
    console.error("[Firebase] Failed to post comment:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * 獲取評論列表
 */
export async function fetchComments(
  targetType: "announcement" | "event" | "menu" | "poi",
  targetId: string,
  maxItems: number = 50
): Promise<Array<{
  id: string;
  userId: string;
  userName?: string;
  content: string;
  rating?: number;
  likes: number;
  createdAt: string;
}>> {
  if (!isFirebaseConfigured()) {
    return [];
  }

  try {
    const firestore = getDb();
    const commentsRef = collection(firestore, `${targetType}s`, targetId, "comments");
    const q = query(
      commentsRef,
      where("status", "==", "active"),
      orderBy("createdAt", "desc"),
      limit(maxItems)
    );

    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        userId: data.userId,
        userName: data.userName,
        content: data.content,
        rating: data.rating,
        likes: data.likes ?? 0,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? "",
      };
    });
  } catch (error) {
    console.error("[Firebase] Failed to fetch comments:", error);
    return [];
  }
}

/**
 * 刪除評論
 */
export async function deleteComment(
  targetType: "announcement" | "event" | "menu" | "poi",
  targetId: string,
  commentId: string,
  userId: string
): Promise<WriteResult> {
  if (!isFirebaseConfigured()) {
    return { success: false, error: "Firebase not configured" };
  }

  try {
    const firestore = getDb();
    const commentRef = doc(firestore, `${targetType}s`, targetId, "comments", commentId);
    
    const commentDoc = await getDoc(commentRef);
    if (!commentDoc.exists()) {
      return { success: false, error: "評論不存在" };
    }
    
    if (commentDoc.data().userId !== userId) {
      return { success: false, error: "您無權刪除此評論" };
    }

    await updateDoc(commentRef, {
      status: "deleted",
      deletedAt: serverTimestamp(),
    });

    const targetRef = doc(firestore, `${targetType}s`, targetId);
    await updateDoc(targetRef, {
      commentCount: increment(-1),
    });

    return { success: true };
  } catch (error) {
    console.error("[Firebase] Failed to delete comment:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * 對評論按讚
 */
export async function likeComment(
  targetType: "announcement" | "event" | "menu" | "poi",
  targetId: string,
  commentId: string,
  userId: string
): Promise<WriteResult> {
  if (!isFirebaseConfigured()) {
    return { success: false, error: "Firebase not configured" };
  }

  try {
    const firestore = getDb();
    const commentRef = doc(firestore, `${targetType}s`, targetId, "comments", commentId);
    const likeRef = doc(collection(firestore, `${targetType}s`, targetId, "comments", commentId, "likes"), userId);

    await runTransaction(firestore, async (transaction) => {
      const likeDoc = await transaction.get(likeRef);
      
      if (likeDoc.exists()) {
        transaction.delete(likeRef);
        transaction.update(commentRef, { likes: increment(-1) });
      } else {
        transaction.set(likeRef, { userId, createdAt: serverTimestamp() });
        transaction.update(commentRef, { likes: increment(1) });
      }
    });

    return { success: true };
  } catch (error) {
    console.error("[Firebase] Failed to toggle comment like:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * 加入群組
 */
export async function joinGroup(
  groupId: string,
  userId: string,
  userName?: string
): Promise<WriteResult> {
  if (!isFirebaseConfigured()) {
    return { success: false, error: "Firebase not configured" };
  }

  try {
    const firestore = getDb();
    const groupRef = doc(firestore, "groups", groupId);
    const memberRef = doc(collection(firestore, "groups", groupId, "members"), userId);

    await runTransaction(firestore, async (transaction) => {
      const groupDoc = await transaction.get(groupRef);
      
      if (!groupDoc.exists()) {
        throw new Error("群組不存在");
      }

      const existingMember = await transaction.get(memberRef);
      if (existingMember.exists()) {
        throw new Error("您已是此群組成員");
      }

      transaction.set(memberRef, {
        userId,
        userName,
        role: "member",
        status: "active",
        joinedAt: serverTimestamp(),
      });

      transaction.update(groupRef, {
        memberCount: increment(1),
      });
    });

    return { success: true, id: groupId };
  } catch (error) {
    console.error("[Firebase] Failed to join group:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * 離開群組
 */
export async function leaveGroup(
  groupId: string,
  userId: string
): Promise<WriteResult> {
  if (!isFirebaseConfigured()) {
    return { success: false, error: "Firebase not configured" };
  }

  try {
    const firestore = getDb();
    const groupRef = doc(firestore, "groups", groupId);
    const memberRef = doc(collection(firestore, "groups", groupId, "members"), userId);

    await runTransaction(firestore, async (transaction) => {
      const memberDoc = await transaction.get(memberRef);
      
      if (!memberDoc.exists()) {
        throw new Error("您不是此群組成員");
      }

      if (memberDoc.data().role === "owner") {
        throw new Error("群組擁有者無法直接離開，請先轉移擁有權");
      }

      transaction.delete(memberRef);
      transaction.update(groupRef, {
        memberCount: increment(-1),
      });
    });

    return { success: true };
  } catch (error) {
    console.error("[Firebase] Failed to leave group:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * 檢查是否為群組成員
 */
export async function checkGroupMembership(
  groupId: string,
  userId: string
): Promise<{ isMember: boolean; role?: string }> {
  if (!isFirebaseConfigured() || !userId) {
    return { isMember: false };
  }

  try {
    const firestore = getDb();
    const memberRef = doc(collection(firestore, "groups", groupId, "members"), userId);
    const memberDoc = await getDoc(memberRef);
    
    if (!memberDoc.exists()) {
      return { isMember: false };
    }
    
    return {
      isMember: true,
      role: memberDoc.data().role,
    };
  } catch (error) {
    console.error("[Firebase] Failed to check group membership:", error);
    return { isMember: false };
  }
}

/**
 * 發表群組貼文
 */
export async function postToGroup(
  groupId: string,
  userId: string,
  content: string,
  userName?: string
): Promise<WriteResult> {
  if (!isFirebaseConfigured()) {
    return { success: false, error: "Firebase not configured" };
  }

  if (!content.trim()) {
    return { success: false, error: "貼文內容不可為空" };
  }

  try {
    const firestore = getDb();
    
    const membership = await checkGroupMembership(groupId, userId);
    if (!membership.isMember) {
      return { success: false, error: "您不是此群組成員" };
    }

    const postsRef = collection(firestore, "groupPosts");
    const docRef = await addDoc(postsRef, {
      groupId,
      authorId: userId,
      authorName: userName,
      content: content.trim(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      likes: 0,
      commentCount: 0,
      status: "active",
    });

    const groupRef = doc(firestore, "groups", groupId);
    await updateDoc(groupRef, {
      postCount: increment(1),
      lastActivityAt: serverTimestamp(),
    });

    return { success: true, id: docRef.id };
  } catch (error) {
    console.error("[Firebase] Failed to post to group:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * 更新使用者資料
 */
export async function updateUserProfile(
  userId: string,
  updates: Partial<{
    displayName: string;
    phone: string;
    bio: string;
    avatarUrl: string;
  }>
): Promise<WriteResult> {
  if (!isFirebaseConfigured()) {
    return { success: false, error: "Firebase not configured" };
  }

  try {
    const firestore = getDb();
    const userRef = doc(firestore, "users", userId);

    await updateDoc(userRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });

    const authInstance = getAuth();
    if (authInstance?.currentUser && updates.displayName) {
      await updateProfile(authInstance.currentUser, { displayName: updates.displayName });
    }

    return { success: true };
  } catch (error) {
    console.error("[Firebase] Failed to update user profile:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * 對菜單評分
 */
export async function rateMenuItem(
  menuId: string,
  userId: string,
  rating: number
): Promise<WriteResult> {
  if (!isFirebaseConfigured()) {
    return { success: false, error: "Firebase not configured" };
  }

  if (rating < 1 || rating > 5) {
    return { success: false, error: "評分必須在 1-5 之間" };
  }

  try {
    const firestore = getDb();
    const menuRef = doc(firestore, "menus", menuId);
    const ratingRef = doc(collection(firestore, "menus", menuId, "ratings"), userId);

    await runTransaction(firestore, async (transaction) => {
      const menuDoc = await transaction.get(menuRef);
      if (!menuDoc.exists()) {
        throw new Error("菜單項目不存在");
      }

      const existingRating = await transaction.get(ratingRef);
      const menuData = menuDoc.data();
      const currentRatingSum = (menuData.rating ?? 0) * (menuData.ratingCount ?? 0);
      
      if (existingRating.exists()) {
        const oldRating = existingRating.data().rating;
        const newRatingSum = currentRatingSum - oldRating + rating;
        const newAverage = newRatingSum / (menuData.ratingCount ?? 1);
        
        transaction.update(menuRef, { rating: newAverage });
        transaction.update(ratingRef, { rating, updatedAt: serverTimestamp() });
      } else {
        const newCount = (menuData.ratingCount ?? 0) + 1;
        const newRatingSum = currentRatingSum + rating;
        const newAverage = newRatingSum / newCount;
        
        transaction.update(menuRef, { 
          rating: newAverage,
          ratingCount: newCount,
        });
        transaction.set(ratingRef, { 
          userId,
          rating,
          createdAt: serverTimestamp(),
        });
      }
    });

    return { success: true };
  } catch (error) {
    console.error("[Firebase] Failed to rate menu item:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * 提交意見回饋
 */
export async function submitFeedback(
  userId: string | null,
  type: "bug" | "feature" | "general",
  content: string,
  contactEmail?: string,
  attachmentUrls?: string[]
): Promise<WriteResult> {
  if (!isFirebaseConfigured()) {
    return { success: false, error: "Firebase not configured" };
  }

  if (!content.trim()) {
    return { success: false, error: "回饋內容不可為空" };
  }

  try {
    const firestore = getDb();
    const feedbackRef = collection(firestore, "feedback");

    const docRef = await addDoc(feedbackRef, {
      userId,
      type,
      content: content.trim(),
      contactEmail,
      attachmentUrls: attachmentUrls ?? [],
      status: "new",
      createdAt: serverTimestamp(),
      platform: "web",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });

    return { success: true, id: docRef.id };
  } catch (error) {
    console.error("[Firebase] Failed to submit feedback:", error);
    return { success: false, error: String(error) };
  }
}
