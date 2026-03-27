"use client";

import { SiteShell } from "@/components/SiteShell";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import {
  getCurrentUser,
  isFirebaseConfigured,
  signInWithPuStudentId,
} from "@/features/auth/client";
import { appendSchoolContext, sanitizeInternalPath } from "@/lib/navigation";
import { resolveSchoolPageContext } from "@/lib/pageContext";
import { useRouter } from "next/navigation";

export default function LoginPage(props: {
  searchParams?: { school?: string; schoolId?: string; redirect?: string; returnUrl?: string };
}) {
  const { schoolContext, schoolName } = resolveSchoolPageContext(props.searchParams);
  const router = useRouter();

  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [firebaseReady, setFirebaseReady] = useState(false);

  useEffect(() => {
    setFirebaseReady(isFirebaseConfigured());
    const user = getCurrentUser();
    if (user) {
      const redirect = props.searchParams?.redirect || props.searchParams?.returnUrl || "/";
      router.replace(appendSchoolContext(sanitizeInternalPath(redirect), schoolContext));
    }
  }, [props.searchParams?.redirect, props.searchParams?.returnUrl, router, schoolContext]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!studentId.trim() || !password.trim()) {
      setError("請輸入學號與密碼");
      return;
    }

    if (!firebaseReady) {
      setError("Firebase 尚未設定完成，暫時無法使用靜宜學號登入。");
      return;
    }

    setIsLoading(true);
    try {
      await signInWithPuStudentId(studentId.trim().toUpperCase(), password);
      const redirect = props.searchParams?.redirect || props.searchParams?.returnUrl || "/";
      router.replace(appendSchoolContext(sanitizeInternalPath(redirect), schoolContext));
    } catch (err) {
      setError(err instanceof Error ? err.message : "學號登入失敗，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    minHeight: 50,
    padding: "0 15px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    fontSize: 15,
    boxShadow:
      "inset 3px 3px 7px rgba(174,174,192,0.25), inset -2px -2px 5px rgba(255,255,255,0.88)",
    outline: "none",
    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
    fontFamily: "inherit",
  };

  return (
    <SiteShell schoolName={schoolName}>
      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div
          className="card"
          style={{
            textAlign: "center",
            padding: "28px 24px",
            background: "linear-gradient(135deg, var(--brand) 0%, var(--brand2) 100%)",
            border: "none",
            color: "#fff",
            boxShadow: "6px 6px 16px rgba(94,106,210,0.36), -3px -3px 8px rgba(255,255,255,0.7)",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              background: "rgba(255,255,255,0.22)",
              display: "grid",
              placeItems: "center",
              fontSize: 32,
              margin: "0 auto 14px",
              border: "1px solid rgba(255,255,255,0.3)",
            }}
          >
            🎓
          </div>
          <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800, letterSpacing: "-0.04em" }}>
            {schoolName}
          </h1>
          <p style={{ margin: 0, fontSize: 14, opacity: 0.82 }}>
            Campus One 目前已鎖定為 PU-only，請使用靜宜 e 校園帳號密碼登入。
          </p>
        </div>

        <form className="card" style={{ padding: "22px 20px 24px" }} onSubmit={handleLogin}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div
              style={{
                padding: "14px 16px",
                borderRadius: "var(--radius-sm)",
                background: "var(--panel)",
                border: "1px solid var(--border)",
                fontSize: 13,
                color: "var(--muted)",
                lineHeight: 1.6,
              }}
            >
              登入後會建立 Firebase session，並同步靜宜課表、成績、TronClass 與校園資料。舊版的 SSO、電子郵件與訪客登入入口已停用。
            </div>

            <label style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>學號</span>
              <input
                type="text"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value.toUpperCase())}
                placeholder="例如 B11234567"
                autoCapitalize="characters"
                autoCorrect="off"
                style={inputStyle}
                disabled={isLoading}
              />
            </label>

            <label style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>密碼</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="輸入 e 校園密碼"
                style={inputStyle}
                disabled={isLoading}
              />
            </label>

            {error ? (
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--danger-soft)",
                  border: "1px solid rgba(255,59,48,0.18)",
                  fontSize: 13,
                  color: "var(--danger)",
                  lineHeight: 1.6,
                }}
              >
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              className="btn primary"
              disabled={isLoading || !studentId.trim() || !password.trim()}
              style={{ width: "100%", minHeight: 50 }}
            >
              {isLoading ? "登入中…" : "使用學號登入"}
            </button>

            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
              若只想先瀏覽公開資訊，可以直接返回首頁或公告頁，不需要訪客登入。
            </p>
          </div>
        </form>
      </div>
    </SiteShell>
  );
}
