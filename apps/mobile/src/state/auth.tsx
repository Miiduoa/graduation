import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { getAuthInstance, getDb, hasUsableFirebaseConfig, subscribeToTokenRefresh } from "../firebase";
import { resolveSchoolByEmail } from "@campus/shared/src/schools";
import { clearAllCache } from "../data/cachedSource";
import { clearAllOfflineData, getOfflineQueue } from "../services/offline";
import { getCachedPushToken, removePushTokenFromFirestore } from "../services/notifications";
import { clearMockAuthSession, loadMockAuthSession } from "../services/mockAuth";
import { clearUserScopedStorage } from "../services/scopedStorage";

import type { UserRole as DataUserRole } from "../data/types";

export type UserRole = DataUserRole;

export type UserProfile = {
  uid: string;
  email?: string | null;
  schoolId?: string | null;
  primarySchoolId?: string | null;
  role: UserRole;
  schoolMembershipRole?: string | null;
  displayName?: string | null;
  department?: string | null;
  studentId?: string | null;
  bio?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  isPublicProfile?: boolean | null;
};

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  profileLoading: boolean;
  error: string | null;
  tokenError: Error | null;
  tokenExpired: boolean;
  hasPendingOfflineData: boolean;
  isAdmin: boolean;
  isEditor: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  signOutWithWarning: () => Promise<boolean>;
  clearTokenError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadProfile(u: User | null): Promise<UserProfile | null> {
  if (!u) return null;
  
  try {
    const db = getDb();
    const ref = doc(db, "users", u.uid);
    const snap = await getDoc(ref);
    const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
    const schoolId =
      (data.primarySchoolId as string | undefined) ??
      (data.schoolId as string | undefined) ??
      resolveSchoolByEmail(u.email)?.id ??
      null;
    let schoolMembershipRole: string | null = null;

    if (schoolId) {
      const membershipSnap = await getDoc(doc(db, "schools", schoolId, "members", u.uid)).catch(() => null);
      const membershipData = membershipSnap?.exists() ? (membershipSnap.data() as Record<string, unknown>) : null;
      schoolMembershipRole = typeof membershipData?.role === "string" ? membershipData.role : null;
    }

    return {
      uid: u.uid,
      email: u.email,
      schoolId,
      primarySchoolId: schoolId,
      role: (data.role as UserRole) ?? "student",
      schoolMembershipRole,
      displayName: (data.displayName as string) ?? null,
      department: (data.department as string) ?? null,
      studentId: (data.studentId as string) ?? null,
      bio: (data.bio as string) ?? null,
      phone: (data.phone as string) ?? null,
      avatarUrl: (data.avatarUrl as string) ?? null,
      isPublicProfile: (data.isPublicProfile as boolean) ?? null,
    };
  } catch (error) {
    console.error("[auth] Failed to load profile:", error);
    return {
      uid: u.uid,
      email: u.email,
      schoolId: null,
      primarySchoolId: null,
      role: "student",
      schoolMembershipRole: null,
      displayName: null,
      department: null,
      studentId: null,
      bio: null,
      phone: null,
      avatarUrl: null,
      isPublicProfile: null,
    };
  }
}

function toMockUserProfile(session: {
  uid: string;
  email: string;
  schoolId: string;
  displayName: string;
  role: UserRole;
  department?: string | null;
  studentId?: string | null;
}): UserProfile {
  return {
    uid: session.uid,
    email: session.email,
    schoolId: session.schoolId,
    primarySchoolId: session.schoolId,
    role: session.role,
    schoolMembershipRole: null,
    displayName: session.displayName,
    department: session.department ?? null,
    studentId: session.studentId ?? null,
    bio: null,
    phone: null,
    avatarUrl: null,
    isPublicProfile: null,
  };
}

function toMockFirebaseUser(session: {
  uid: string;
  email: string;
  displayName: string;
}): User {
  return {
    uid: session.uid,
    email: session.email,
    displayName: session.displayName,
    emailVerified: true,
    isAnonymous: false,
    photoURL: null,
    phoneNumber: null,
    providerId: "password",
    tenantId: null,
    delete: async () => undefined,
    getIdToken: async () => "mock-token",
    getIdTokenResult: async () => ({
      token: "mock-token",
      claims: {},
      authTime: new Date().toISOString(),
      issuedAtTime: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      signInProvider: "password",
      signInSecondFactor: null,
    }),
    reload: async () => undefined,
    toJSON: () => ({ uid: session.uid, email: session.email, displayName: session.displayName }),
    metadata: {
      creationTime: new Date().toISOString(),
      lastSignInTime: new Date().toISOString(),
    },
    providerData: [],
    refreshToken: "mock-refresh-token",
  } as User;
}

export function AuthProvider(props: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<Error | null>(null);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [hasPendingOfflineData, setHasPendingOfflineData] = useState(false);
  
  const requestIdRef = useRef(0);
  const isSigningOutRef = useRef(false);

  const isAdmin = useMemo(() => {
    const role = profile?.role;
    const schoolMembershipRole = profile?.schoolMembershipRole;
    return role === "admin" || schoolMembershipRole === "admin";
  }, [profile?.role, profile?.schoolMembershipRole]);
  
  const isEditor = useMemo(() => {
    const role = profile?.role;
    const schoolMembershipRole = profile?.schoolMembershipRole;
    return (
      isAdmin ||
      schoolMembershipRole === "admin" ||
      schoolMembershipRole === "editor" ||
      role === "admin" ||
      role === "teacher" ||
      role === "professor" ||
      role === "principal"
    );
  }, [isAdmin, profile?.role, profile?.schoolMembershipRole]);

  const refreshProfile = useCallback(async () => {
    if (!hasUsableFirebaseConfig()) {
      const session = await loadMockAuthSession();
      if (!session) {
        setUser(null);
        setProfile(null);
        return;
      }

      setUser(toMockFirebaseUser(session));
      setProfile(toMockUserProfile(session));
      setError(null);
      return;
    }

    const currentUser = getAuthInstance().currentUser;
    if (!currentUser) {
      setProfile(null);
      return;
    }
    
    const currentRequestId = ++requestIdRef.current;
    setProfileLoading(true);
    
    try {
      // 等待一小段時間確保 Firebase Auth 狀態已完全同步
      // 這解決了 SSO 登入後立即呼叫 refreshProfile 時可能拿到舊資料的問題
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      const p = await loadProfile(currentUser);
      if (requestIdRef.current === currentRequestId) {
        setProfile(p);
        setError(null);
      }
    } catch (e) {
      if (requestIdRef.current === currentRequestId) {
        console.error("[auth] refreshProfile failed:", e);
        setError("無法載入使用者資料");
      }
    } finally {
      if (requestIdRef.current === currentRequestId) {
        setProfileLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!hasUsableFirebaseConfig()) {
      let isCancelled = false;

      (async () => {
        try {
          const session = await loadMockAuthSession();
          if (isCancelled) return;

          setUser(session ? toMockFirebaseUser(session) : null);
          setProfile(session ? toMockUserProfile(session) : null);
          setTokenError(null);
          setTokenExpired(false);
          setError(null);
        } finally {
          if (!isCancelled) {
            setLoading(false);
            setProfileLoading(false);
          }
        }
      })();

      return () => {
        isCancelled = true;
      };
    }

    const auth = getAuthInstance();
    let isCancelled = false;
    
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (isCancelled) return;
      
      const currentRequestId = ++requestIdRef.current;
      
      setUser(u);
      setLoading(true);
      setProfileLoading(!!u);
      setError(null);
      
      if (!u) {
        setTokenError(null);
        setTokenExpired(false);
      }
      
      try {
        const p = await loadProfile(u);
        if (!isCancelled && requestIdRef.current === currentRequestId) {
          setProfile(p);
        }
      } catch (e) {
        if (!isCancelled && requestIdRef.current === currentRequestId) {
          console.error("[auth] onAuthStateChanged profile load failed:", e);
          setError("無法載入使用者資料");
          setProfile(null);
        }
      } finally {
        if (!isCancelled && requestIdRef.current === currentRequestId) {
          setLoading(false);
          setProfileLoading(false);
        }
      }
    });
    
    const unsubToken = subscribeToTokenRefresh((tokenUser, err) => {
      if (isCancelled) return;
      
      if (err) {
        setTokenError(err);
        if (err.message === "TOKEN_REFRESH_EXHAUSTED") {
          setTokenExpired(true);
          setError("登入狀態已過期，請重新登入");
        }
      } else {
        setTokenError(null);
        setTokenExpired(false);
      }
    });
    
    return () => {
      isCancelled = true;
      unsub();
      unsubToken();
    };
  }, []);

  useEffect(() => {
    const checkPendingData = async () => {
      try {
        const queue = await getOfflineQueue();
        setHasPendingOfflineData(queue.length > 0);
      } catch {
        setHasPendingOfflineData(false);
      }
    };
    
    checkPendingData();
    const interval = setInterval(checkPendingData, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleSignOut = useCallback(async (): Promise<{ success: boolean; hadCleanupErrors: boolean }> => {
    if (isSigningOutRef.current) {
      console.log("[auth] Sign out already in progress");
      return { success: false, hadCleanupErrors: false };
    }
    
    isSigningOutRef.current = true;
    const currentUserId = hasUsableFirebaseConfig() ? getAuthInstance().currentUser?.uid : user?.uid;
    
    // 先清理本地資料，再登出
    // 這解決了登出後清理過程中發生錯誤時，使用者已登出但本地還有上一個使用者資料殘留的問題
    const cleanupErrors: Error[] = [];
    const cleanupTasks: Promise<unknown>[] = [
      clearAllCache().catch((e) => {
        console.warn("[auth] clearAllCache failed:", e);
        throw e;
      }),
      clearAllOfflineData().catch((e) => {
        console.warn("[auth] clearAllOfflineData failed:", e);
        throw e;
      }),
      clearUserScopedStorage({
        uid: currentUserId ?? null,
        schoolId: profile?.schoolId ?? null,
      }).catch((e) => {
        console.warn("[auth] Scoped storage cleanup failed:", e);
        throw e;
      }),
    ];

    if (currentUserId && hasUsableFirebaseConfig()) {
      cleanupTasks.push(
        getCachedPushToken()
          .then((token) => {
            if (!token) return;
            return removePushTokenFromFirestore(currentUserId, token);
          })
          .catch((e) => {
            console.warn("[auth] Failed to remove push token during sign out:", e);
            throw e;
          })
      );
    }

    // 使用 Promise.allSettled 來確保所有清理操作都嘗試執行
    const cleanupResults = await Promise.allSettled(cleanupTasks);
    
    cleanupResults.forEach((result, index) => {
      if (result.status === "rejected") {
        cleanupErrors.push(
          result.reason instanceof Error ? result.reason : new Error(String(result.reason))
        );
      }
    });
    
    const hadCleanupErrors = cleanupErrors.length > 0;
    if (hadCleanupErrors) {
      console.warn("[auth] Some cleanup operations failed:", cleanupErrors);
    }
    
    try {
      if (hasUsableFirebaseConfig()) {
        const auth = getAuthInstance();
        await signOut(auth);
      } else {
        await clearMockAuthSession();
        setUser(null);
        setProfile(null);
      }
      
      setTokenError(null);
      setTokenExpired(false);
      setError(null);
      
      return { success: true, hadCleanupErrors };
    } catch (e) {
      console.error("[auth] Sign out failed:", e);
      throw e;
    } finally {
      isSigningOutRef.current = false;
    }
  }, [profile?.schoolId, user?.uid]);

  const handleSignOutWithWarning = useCallback(async (): Promise<boolean> => {
    const pendingQueue = await getOfflineQueue();
    
    const performSignOut = async (): Promise<boolean> => {
      try {
        const result = await handleSignOut();
        if (result.hadCleanupErrors) {
          const { Alert } = require("react-native");
          Alert.alert(
            "登出成功",
            "部分快取資料清理失敗，但這不會影響您下次登入。",
            [{ text: "好", style: "default" }]
          );
        }
        return result.success;
      } catch (e) {
        const { Alert } = require("react-native");
        Alert.alert(
          "登出失敗",
          "登出時發生錯誤，請稍後再試。",
          [{ text: "好", style: "default" }]
        );
        return false;
      }
    };
    
    if (pendingQueue.length > 0) {
      return new Promise((resolve) => {
        const { Alert } = require("react-native");
        Alert.alert(
          "尚有未同步的資料",
          `您有 ${pendingQueue.length} 筆資料尚未同步到伺服器。登出後這些資料將會遺失。\n\n確定要登出嗎？`,
          [
            { text: "取消", style: "cancel", onPress: () => resolve(false) },
            {
              text: "仍然登出",
              style: "destructive",
              onPress: async () => {
                const success = await performSignOut();
                resolve(success);
              },
            },
          ]
        );
      });
    }
    
    return performSignOut();
  }, [handleSignOut]);

  const clearTokenError = useCallback(() => {
    setTokenError(null);
    setTokenExpired(false);
    setError(null);
  }, []);

  const value: AuthContextValue = useMemo(
    () => ({
      user,
      profile,
      loading,
      profileLoading,
      error,
      tokenError,
      tokenExpired,
      hasPendingOfflineData,
      isAdmin,
      isEditor,
      refreshProfile,
      signOut: async () => {
        await handleSignOut();
      },
      signOutWithWarning: handleSignOutWithWarning,
      clearTokenError,
    }),
    [user, profile, loading, profileLoading, error, tokenError, tokenExpired, hasPendingOfflineData, isAdmin, isEditor, refreshProfile, handleSignOut, handleSignOutWithWarning, clearTokenError]
  );

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
