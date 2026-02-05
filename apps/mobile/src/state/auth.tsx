import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import Constants from "expo-constants";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getAuthInstance, getDb } from "../firebase";
import { resolveSchoolByEmail } from "@campus/shared/src/schools";

export type UserRole = "student" | "teacher" | "professor" | "principal" | "admin";

export type UserProfile = {
  uid: string;
  email?: string | null;
  schoolId?: string | null;
  role: UserRole;
};

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadProfile(u: User | null): Promise<UserProfile | null> {
  if (!u) return null;
  const db = getDb();
  const ref = doc(db, "users", u.uid);
  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() as any) : {};

  // Auto-bind school by email domain (edu) if available
  let schoolId = data.schoolId ?? null;
  const mapped = resolveSchoolByEmail(u.email);
  if (mapped?.id && mapped.id !== schoolId) {
    schoolId = mapped.id;
    await setDoc(ref, { schoolId, email: u.email ?? null }, { merge: true });
  }

  return {
    uid: u.uid,
    email: u.email,
    schoolId,
    role: (data.role as UserRole) ?? "student",
  };
}

function parseAdminEmails(): string[] {
  const extra = (Constants.expoConfig as any)?.extra ?? (Constants as any)?.manifest?.extra ?? {};
  const raw = String(extra.adminEmails ?? "");
  return raw
    .split(",")
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function AuthProvider(props: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const adminEmails = useMemo(() => parseAdminEmails(), []);
  const isAdmin = useMemo(() => {
    const email = user?.email?.toLowerCase() ?? "";
    return !!email && adminEmails.includes(email);
  }, [user?.email, adminEmails]);

  const refreshProfile = async () => {
    const p = await loadProfile(user);
    setProfile(p);
  };

  useEffect(() => {
    const auth = getAuthInstance();
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setLoading(true);
      try {
        const p = await loadProfile(u);
        setProfile(p);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const value: AuthContextValue = useMemo(
    () => ({
      user,
      profile,
      loading,
      isAdmin,
      refreshProfile,
      signOut: async () => {
        const auth = getAuthInstance();
        await signOut(auth);
      },
    }),
    [user, profile, loading, isAdmin]
  );

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// Helper: ensure a basic user doc exists (role-based feature gating later)
export async function ensureUserDoc(params: { uid: string; schoolId: string; email?: string | null }) {
  const db = getDb();
  const ref = doc(db, "users", params.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    // Keep schoolId in sync (merge) but don't overwrite role.
    await setDoc(ref, { schoolId: params.schoolId, email: params.email ?? null }, { merge: true });
    return;
  }
  await setDoc(ref, {
    schoolId: params.schoolId,
    email: params.email ?? null,
    role: "student",
    createdAt: new Date(),
  });
}
