"use client";

import { useEffect, useState, ReactNode, createContext, useContext, useCallback } from "react";
import { onAuthStateChanged, User, signOut } from "firebase/auth";
import { getAuth } from "@/lib/firebase";
import Link from "next/link";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: Error | null;
}

interface AuthContextType extends AuthState {
  signOutUser: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>(() => {
    const auth = getAuth();
    if (!auth) {
      return { user: null, loading: false, error: null };
    }
    return { user: auth.currentUser, loading: true, error: null };
  });

  useEffect(() => {
    const auth = getAuth();
    if (!auth) {
      return;
    }

    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        setState({ user, loading: false, error: null });
      },
      (error) => {
        console.error("Auth state change error:", error);
        setState({ user: null, loading: false, error });
      }
    );

    return () => unsubscribe();
  }, []);

  const signOutUser = useCallback(async () => {
    const auth = getAuth();
    if (!auth) return;
    
    try {
      await signOut(auth);
      setState({ user: null, loading: false, error: null });
    } catch (error) {
      console.error("Sign out error:", error);
      throw error;
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const auth = getAuth();
    if (!auth?.currentUser) return;
    
    try {
      await auth.currentUser.reload();
      setState((prev) => ({
        ...prev,
        user: auth.currentUser,
      }));
    } catch (error) {
      console.error("Refresh user error:", error);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, signOutUser, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

interface AuthGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
  redirectTo?: string;
  requireAuth?: boolean;
}

export function AuthGuard({
  children,
  fallback,
  redirectTo = "/login",
  requireAuth = true,
}: AuthGuardProps) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && requireAuth && !user) {
      const currentPath = window.location.pathname + window.location.search;
      const loginUrl = `${redirectTo}?returnUrl=${encodeURIComponent(currentPath)}`;
      window.location.href = loginUrl;
    }
  }, [user, loading, requireAuth, redirectTo]);

  if (loading) {
    return fallback ?? <AuthLoadingScreen />;
  }

  if (requireAuth && !user) {
    return fallback ?? <AuthLoadingScreen message="重新導向至登入頁面..." />;
  }

  return <>{children}</>;
}

interface AuthLoadingScreenProps {
  message?: string;
}

function AuthLoadingScreen({ message = "驗證身份中..." }: AuthLoadingScreenProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: "16px",
      }}
    >
      <div
        style={{
          width: "48px",
          height: "48px",
          border: "4px solid var(--border)",
          borderTopColor: "var(--brand)",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ color: "var(--muted)", fontSize: "14px" }}>{message}</p>
    </div>
  );
}

interface ProtectedContentProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function ProtectedContent({ children, fallback }: ProtectedContentProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          padding: "20px",
          textAlign: "center",
          color: "var(--muted)",
        }}
      >
        <div className="skeleton" style={{ height: "100px", borderRadius: "12px" }} />
      </div>
    );
  }

  if (!user) {
    return (
      fallback ?? (
        <div
          style={{
            padding: "40px 20px",
            textAlign: "center",
            background: "var(--panel)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>🔒</div>
          <h3
            style={{
              margin: "0 0 8px",
              fontSize: "18px",
              fontWeight: 700,
              color: "var(--text)",
            }}
          >
            需要登入
          </h3>
          <p
            style={{
              margin: "0 0 20px",
              fontSize: "14px",
              color: "var(--muted)",
            }}
          >
            請先登入以查看此內容
          </p>
          <Link
            href="/login"
            className="btn primary"
            style={{
              display: "inline-block",
              padding: "12px 24px",
              borderRadius: "12px",
              background: "var(--brand)",
              color: "#fff",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            前往登入
          </Link>
        </div>
      )
    );
  }

  return <>{children}</>;
}

interface GuestOnlyProps {
  children: ReactNode;
  redirectTo?: string;
}

export function GuestOnly({ children, redirectTo = "/" }: GuestOnlyProps) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      const searchParams = new URLSearchParams(window.location.search);
      const returnUrl = searchParams.get("returnUrl") || redirectTo;
      window.location.href = returnUrl;
    }
  }, [user, loading, redirectTo]);

  if (loading) {
    return <AuthLoadingScreen />;
  }

  if (user) {
    return <AuthLoadingScreen message="已登入，重新導向中..." />;
  }

  return <>{children}</>;
}

interface RoleGuardProps {
  children: ReactNode;
  allowedRoles: string[];
  fallback?: ReactNode;
}

export function RoleGuard({ children, allowedRoles, fallback }: RoleGuardProps) {
  const { user, loading } = useAuth();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    async function fetchUserRole() {
      if (!user) {
        setRoleLoading(false);
        return;
      }

      try {
        const tokenResult = await user.getIdTokenResult();
        setUserRole((tokenResult.claims.role as string) || "user");
      } catch (error) {
        console.error("Failed to get user role:", error);
        setUserRole("user");
      } finally {
        setRoleLoading(false);
      }
    }

    fetchUserRole();
  }, [user]);

  if (loading || roleLoading) {
    return <AuthLoadingScreen message="檢查權限中..." />;
  }

  if (!user || !userRole || !allowedRoles.includes(userRole)) {
    return (
      fallback ?? (
        <div
          style={{
            padding: "40px 20px",
            textAlign: "center",
            background: "var(--panel)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>⛔</div>
          <h3
            style={{
              margin: "0 0 8px",
              fontSize: "18px",
              fontWeight: 700,
              color: "var(--text)",
            }}
          >
            權限不足
          </h3>
          <p
            style={{
              margin: "0 0 20px",
              fontSize: "14px",
              color: "var(--muted)",
            }}
          >
            您沒有權限存取此頁面
          </p>
          <Link
            href="/"
            className="btn"
            style={{
              display: "inline-block",
              padding: "12px 24px",
              borderRadius: "12px",
              background: "var(--panel2)",
              color: "var(--text)",
              fontWeight: 600,
              textDecoration: "none",
              border: "1px solid var(--border)",
            }}
          >
            返回首頁
          </Link>
        </div>
      )
    );
  }

  return <>{children}</>;
}
