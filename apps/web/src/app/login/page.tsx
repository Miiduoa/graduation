"use client";

import { SiteShell } from "@/components/SiteShell";
import { useState, useEffect, type CSSProperties, type FormEvent } from "react";
import {
  getCurrentUser,
  isFirebaseConfigured,
  resetPassword,
  signIn,
  signUp,
} from "@/lib/firebase";
import {
  appendSchoolContext,
  buildSsoCallbackPath,
  sanitizeInternalPath,
} from "@/lib/navigation";
import { resolveSchoolPageContext } from "@/lib/pageContext";
import { buildWebSsoStartUrl } from "@/lib/sso";
import { useSchoolSsoConfig } from "@/lib/useSchoolSsoConfig";
import { useRouter } from "next/navigation";

type LoginMethod = "sso" | "email" | "guest";
type AuthMode = "login" | "register";

const ERROR_MAP: Record<string, string> = {
  "auth/user-not-found": "找不到此電子郵件帳號",
  "auth/wrong-password": "密碼錯誤",
  "auth/email-already-in-use": "此電子郵件已被使用",
  "auth/weak-password": "密碼強度不足（至少 6 位）",
  "auth/invalid-email": "電子郵件格式不正確",
  "auth/too-many-requests": "嘗試次數過多，請稍後再試",
  "auth/network-request-failed": "網路連線失敗",
};

export default function LoginPage(props: {
  searchParams?: { school?: string; schoolId?: string; redirect?: string; returnUrl?: string };
}) {
  const { schoolContext, schoolName, schoolSearch: q, schoolId } = resolveSchoolPageContext(props.searchParams);
  const router = useRouter();
  const { config, ssoConfig, allowEmailLogin, availability, ssoReady, loading: ssoLoading } = useSchoolSsoConfig(schoolId);

  const [loginMethod, setLoginMethod] = useState<LoginMethod>("sso");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [firebaseReady, setFirebaseReady] = useState(false);

  useEffect(() => {
    setFirebaseReady(isFirebaseConfigured());
    const checkUser = () => {
      const user = getCurrentUser();
      if (user) {
        const redirect = props.searchParams?.redirect || props.searchParams?.returnUrl || "/";
        const safe = sanitizeInternalPath(redirect);
        router.replace(appendSchoolContext(safe, schoolContext));
      }
    };
    checkUser();
  }, [props.searchParams?.redirect, props.searchParams?.returnUrl, router, schoolContext]);

  const handleSSOLogin = () => {
    if (!ssoConfig) return;
    setError("");
    setSuccess("");
    setIsLoading(true);

    try {
      const callbackPath = buildSsoCallbackPath(
        schoolContext,
        ssoConfig.provider,
        props.searchParams?.redirect || props.searchParams?.returnUrl
      );
      const callbackUrl = new URL(callbackPath, window.location.origin).toString();
      const samlAcsUrl = new URL("/sso/acs", window.location.origin).toString();
      const startUrl = buildWebSsoStartUrl(ssoConfig, {
        redirectUri: callbackUrl,
        samlAcsUrl,
        samlRelayState: callbackUrl,
      });

      window.location.assign(startUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SSO 設定不完整，請聯絡管理員");
      setIsLoading(false);
    }
  };

  const handleEmailAuth = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (authMode === "register" && password !== confirmPassword) {
      setError("兩次輸入的密碼不一致");
      return;
    }
    setIsLoading(true);
    try {
      if (authMode === "login") {
        await signIn(email, password);
      } else {
        await signUp(email, password, displayName || undefined);
      }
      const redirect = props.searchParams?.redirect || props.searchParams?.returnUrl || "/";
      router.replace(appendSchoolContext(sanitizeInternalPath(redirect), schoolContext));
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      setError(ERROR_MAP[code] ?? "發生錯誤，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) { setError("請先輸入電子郵件地址"); return; }
    setIsLoading(true);
    try {
      await resetPassword(email);
      setSuccess("重設密碼郵件已寄出，請查看信箱");
    } catch {
      setError("寄送失敗，請確認電子郵件是否正確");
    } finally {
      setIsLoading(false);
    }
  };

  const emailAllowed = firebaseReady && allowEmailLogin;

  const inputStyle: CSSProperties = {
    width: "100%",
    minHeight: 48,
    padding: "0 15px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    fontSize: 15,
    boxShadow: "inset 3px 3px 7px rgba(174,174,192,0.25), inset -2px -2px 5px rgba(255,255,255,0.88)",
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
        {/* ── School Info Card ── */}
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
            {schoolName ? `歡迎回到 ${schoolName}` : "Campus One 校園助手"}
          </h1>
          <p style={{ margin: 0, fontSize: 14, opacity: 0.82 }}>
            {schoolName ? "請登入以存取您的校園資訊" : "選擇登入方式以開始使用"}
          </p>
        </div>

        {/* ── Login Method Picker ── */}
        <div className="card" style={{ padding: "20px 20px 24px" }}>
          {/* Segmented Control */}
          <div className="segmentedGroup" style={{ marginBottom: 20 }}>
            {([
              { key: "sso", label: "🏫 學校登入" },
              { key: "email", label: "📧 電子郵件" },
              { key: "guest", label: "👤 訪客" },
            ] as { key: LoginMethod; label: string }[]).map((m) => (
              <button
                key={m.key}
                className={loginMethod === m.key ? "active" : ""}
                onClick={() => setLoginMethod(m.key)}
                style={{ fontSize: 13 }}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* ── SSO Panel ── */}
          {loginMethod === "sso" && (
            <div style={{ textAlign: "center" }}>
              {ssoLoading ? (
                <div style={{ padding: "24px 0", color: "var(--muted)", fontSize: 14 }}>
                  <div className="skeleton" style={{ height: 16, width: "60%", margin: "0 auto 8px" }} />
                  <div className="skeleton" style={{ height: 44, width: "100%", borderRadius: "var(--radius-sm)" }} />
                </div>
              ) : ssoReady && ssoConfig ? (
                <div>
                  <div
                    style={{
                      padding: "14px 16px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--panel)",
                      border: "1px solid var(--border)",
                      marginBottom: 16,
                      textAlign: "left",
                      fontSize: 13,
                      color: "var(--muted)",
                      lineHeight: 1.7,
                    }}
                  >
                    <strong style={{ color: "var(--text)" }}>🔒 安全登入</strong><br />
                    點擊下方按鈕將跳轉至學校官方身份驗證系統，登入後自動返回 Campus One。
                  </div>
                  <button
                    className="btn primary"
                    style={{ width: "100%", minHeight: 50, fontSize: 15, borderRadius: "var(--radius-sm)" }}
                    onClick={handleSSOLogin}
                    disabled={isLoading}
                  >
                    {isLoading ? "跳轉中…" : `使用 ${config?.schoolName ?? schoolName ?? "學校"} SSO 登入 →`}
                  </button>
                </div>
              ) : (
                <div style={{ padding: "12px 0" }}>
                  <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 12 }}>
                    {availability.message}。請先選擇已開通學校或改用電子郵件登入。
                  </div>
                  {ssoConfig && (
                    <div
                      style={{
                        padding: "12px 14px",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--panel)",
                        border: "1px solid var(--border)",
                        fontSize: 12,
                        color: "var(--muted)",
                        lineHeight: 1.6,
                        marginBottom: 12,
                        textAlign: "left",
                      }}
                    >
                      狀態：{availability.setupStatus === "live" ? "已開通" : availability.setupStatus === "testing" ? "測試中" : "未開通"}
                      {availability.missingFields.length > 0 ? ` · 缺少欄位：${availability.missingFields.join(", ")}` : ""}
                    </div>
                  )}
                  <button
                    className="btn"
                    style={{ width: "100%" }}
                    onClick={() => router.push(`/join${q}`)}
                  >
                    🏫 選擇學校
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Email Panel ── */}
          {loginMethod === "email" && (
            <div>
              {!emailAllowed && (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--warning-soft)",
                    border: "1px solid rgba(255,149,0,0.2)",
                    fontSize: 13,
                    color: "var(--warning)",
                    marginBottom: 14,
                  }}
                >
                  ⚠️ 電子郵件登入尚未設定
                </div>
              )}

              {/* Auth mode switcher */}
              <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
                {(["login", "register"] as AuthMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setAuthMode(m); setError(""); setSuccess(""); }}
                    style={{
                      flex: 1,
                      padding: "10px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid",
                      borderColor: authMode === m ? "var(--brand)" : "var(--border)",
                      background: authMode === m ? "var(--accent-soft)" : "var(--surface)",
                      color: authMode === m ? "var(--brand)" : "var(--muted)",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                      boxShadow: authMode === m ? "var(--shadow-sm)" : "none",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {m === "login" ? "登入" : "註冊新帳號"}
                  </button>
                ))}
              </div>

              <form onSubmit={handleEmailAuth} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {authMode === "register" && (
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>
                      姓名（選填）
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="你的顯示名稱"
                      style={inputStyle}
                    />
                  </div>
                )}
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>
                    電子郵件
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>
                    密碼
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="請輸入密碼"
                      required
                      style={{ ...inputStyle, paddingRight: 44 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                        background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--muted)",
                      }}
                    >
                      {showPassword ? "🙈" : "👁️"}
                    </button>
                  </div>
                </div>
                {authMode === "register" && (
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>
                      確認密碼
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="再次輸入密碼"
                      required
                      style={inputStyle}
                    />
                  </div>
                )}

                {error && (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--danger-soft)",
                      border: "1px solid rgba(255,59,48,0.2)",
                      fontSize: 13,
                      color: "var(--danger)",
                    }}
                  >
                    ❌ {error}
                  </div>
                )}
                {success && (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--success-soft)",
                      border: "1px solid rgba(52,199,89,0.2)",
                      fontSize: 13,
                      color: "var(--success)",
                    }}
                  >
                    ✅ {success}
                  </div>
                )}

                <button
                  type="submit"
                  className="btn primary"
                  disabled={isLoading || !emailAllowed}
                  style={{ width: "100%", minHeight: 48, fontSize: 15 }}
                >
                  {isLoading ? "處理中…" : authMode === "login" ? "登入" : "建立帳號"}
                </button>

                {authMode === "login" && (
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "var(--brand)", fontSize: 13, fontWeight: 600, textAlign: "center",
                    }}
                  >
                    忘記密碼？
                  </button>
                )}
              </form>
            </div>
          )}

          {/* ── Guest Panel ── */}
          {loginMethod === "guest" && (
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  marginBottom: 16,
                  textAlign: "left",
                  fontSize: 13,
                  color: "var(--muted)",
                  lineHeight: 1.7,
                }}
              >
                <strong style={{ color: "var(--text)" }}>👤 訪客模式</strong><br />
                不需登入即可瀏覽大部分功能，但個人化設定、成績查詢等需要登入。
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginBottom: 14 }}>
                {["📢 公告", "📅 課表", "🗺 地圖", "🍱 餐廳", "🚌 公車", "📚 圖書館"].map((f) => (
                  <span key={f} className="pill subtle">{f}</span>
                ))}
              </div>
              <button
                className="btn primary"
                style={{ width: "100%", minHeight: 50, fontSize: 15 }}
                onClick={() => router.push(`/${q}`)}
              >
                以訪客身份進入 →
              </button>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <p style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", margin: 0, lineHeight: 1.8 }}>
          繼續即表示您同意我們的{" "}
          <a href="#" style={{ color: "var(--brand)" }}>服務條款</a>{" "}
          與{" "}
          <a href="#" style={{ color: "var(--brand)" }}>隱私政策</a>
        </p>
      </div>
    </SiteShell>
  );
}
