"use client";

import { SiteShell } from "@/components/SiteShell";
import { resolveSchool } from "@campus/shared/src/schools";
import { useState, useEffect } from "react";
import { 
  signIn, 
  signUp, 
  resetPassword, 
  getCurrentUser,
  isFirebaseConfigured 
} from "@/lib/firebase";
import { useRouter } from "next/navigation";

type LoginMethod = "sso" | "email" | "guest";
type AuthMode = "login" | "register";
type SchoolSSOConfig = { authUrl?: string; clientId?: string };

function parseSsoConfig(value: unknown): SchoolSSOConfig | null {
  if (!value || typeof value !== "object") return null;
  const schoolObj = value as Record<string, unknown>;
  const ssoConfig = schoolObj.ssoConfig;
  if (!ssoConfig || typeof ssoConfig !== "object") return null;

  const configObj = ssoConfig as Record<string, unknown>;
  return {
    authUrl: typeof configObj.authUrl === "string" ? configObj.authUrl : undefined,
    clientId: typeof configObj.clientId === "string" ? configObj.clientId : undefined,
  };
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export default function LoginPage(props: { searchParams?: { school?: string; schoolId?: string; redirect?: string } }) {
  const router = useRouter();
  const school = resolveSchool({ school: props.searchParams?.school, schoolId: props.searchParams?.schoolId });
  const redirectPath = props.searchParams?.redirect || "/";
  const q = `?school=${encodeURIComponent(school.code)}&schoolId=${encodeURIComponent(school.id)}`;

  const [loginMethod, setLoginMethod] = useState<LoginMethod>("sso");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [firebaseReady, setFirebaseReady] = useState(false);

  useEffect(() => {
    setFirebaseReady(isFirebaseConfigured());
    
    const user = getCurrentUser();
    if (user) {
      router.push(redirectPath + q);
    }
  }, [router, redirectPath, q]);

  const handleSSOLogin = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const ssoConfig = parseSsoConfig(school);
      
      if (ssoConfig?.authUrl) {
        const redirectUri = encodeURIComponent(window.location.origin + "/sso-callback" + q);
        const ssoUrl = `${ssoConfig.authUrl}?client_id=${ssoConfig.clientId}&redirect_uri=${redirectUri}&response_type=code&scope=openid%20profile%20email`;
        window.location.href = ssoUrl;
      } else {
        if (!firebaseReady) {
          setError("Firebase 尚未設定，請使用電子郵件登入或聯繫管理員");
          setIsLoading(false);
          return;
        }
        
        setError(`${school.name} 尚未設定 SSO 單一登入，請使用電子郵件登入`);
        setLoginMethod("email");
      }
    } catch (err) {
      console.error("SSO login error:", err);
      setError("SSO 登入失敗，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (!firebaseReady) {
        setError("Firebase 尚未設定。請聯繫管理員或稍後再試。");
        setIsLoading(false);
        return;
      }

      if (authMode === "register") {
        if (password !== confirmPassword) {
          setError("密碼與確認密碼不符");
          setIsLoading(false);
          return;
        }
        
        if (password.length < 6) {
          setError("密碼至少需要 6 個字元");
          setIsLoading(false);
          return;
        }

        const user = await signUp(email, password, displayName || undefined);
        if (user) {
          setSuccess("註冊成功！正在跳轉...");
          setTimeout(() => {
            router.push(redirectPath + q);
          }, 1500);
        } else {
          setError("註冊失敗，請稍後再試");
        }
      } else {
        const user = await signIn(email, password);
        if (user) {
          if (rememberMe) {
            localStorage.setItem("campus_remember_email", email);
          } else {
            localStorage.removeItem("campus_remember_email");
          }
          
          router.push(redirectPath + q);
        } else {
          setError("登入失敗，請確認帳號密碼是否正確");
        }
      }
    } catch (err: unknown) {
      console.error("Auth error:", err);
      
      const errorMessages: Record<string, string> = {
        "auth/invalid-email": "電子郵件格式不正確",
        "auth/user-disabled": "此帳號已被停用",
        "auth/user-not-found": "找不到此帳號，請先註冊",
        "auth/wrong-password": "密碼錯誤",
        "auth/email-already-in-use": "此電子郵件已被註冊",
        "auth/weak-password": "密碼強度不足，請使用更複雜的密碼",
        "auth/too-many-requests": "登入嘗試次數過多，請稍後再試",
        "auth/network-request-failed": "網路連線失敗，請檢查網路狀態",
      };
      
      const errorCode = getErrorCode(err);
      const fallbackMessage = getErrorMessage(err, "發生錯誤，請稍後再試");
      setError((errorCode && errorMessages[errorCode]) || fallbackMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError("請先輸入電子郵件地址");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await resetPassword(email);
      setSuccess("密碼重設郵件已寄出，請檢查您的信箱");
    } catch (err: unknown) {
      console.error("Password reset error:", err);
      
      const errorCode = getErrorCode(err);
      if (errorCode === "auth/user-not-found") {
        setError("找不到此電子郵件對應的帳號");
      } else if (errorCode === "auth/invalid-email") {
        setError("電子郵件格式不正確");
      } else {
        setError("無法寄送重設郵件，請稍後再試");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setTimeout(() => {
      router.push("/" + q);
    }, 500);
  };

  useEffect(() => {
    const savedEmail = localStorage.getItem("campus_remember_email");
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="登入"
      subtitle="使用學校帳號、電子郵件或訪客模式進入校園助手。"
    >
      <div className="pageStack" style={{ maxWidth: 560, margin: "0 auto" }}>
        <section className="heroPanel">
          <div className="heroIdentity">
            <div className="heroAvatar is-round">🏫</div>
            <div className="heroCopy">
              <div className="heroTitleRow">
                <h2 className="heroTitle">{school.name}</h2>
                <span className="statusBadge">學校入口</span>
              </div>
              <p className="heroMeta">學校代碼：{school.code}</p>
              <p className="heroText">
                登入後可同步學籍、課表與個人資料；如果只想先看公開資訊，也可以直接用訪客模式進站。
              </p>
            </div>
          </div>
        </section>

        <section className="card sectionCard">
          <div className="segmentedGroup">
            {[
              { key: "sso", label: "學校 SSO", icon: "🔐" },
              { key: "email", label: "電子郵件", icon: "📧" },
              { key: "guest", label: "訪客瀏覽", icon: "👁️" },
            ].map((method) => (
              <button
                key={method.key}
                type="button"
                className={`btn ${loginMethod === method.key ? "primary" : ""}`}
                onClick={() => setLoginMethod(method.key as LoginMethod)}
                style={{ flex: 1 }}
              >
                {method.icon} {method.label}
              </button>
            ))}
          </div>

        {loginMethod === "sso" && (
          <section className="sectionCard">
            <div className="sectionHead">
              <div className="sectionCopy">
                <p className="sectionEyebrow">Single Sign-On</p>
                <h2 className="sectionTitle">學校單一登入</h2>
                <p className="sectionText">使用學校帳號登入，系統會同步學籍資料、課程資訊與權限設定。</p>
              </div>
            </div>

            <div className="surfaceGrid">
              {[
                { icon: "✓", text: "自動同步學籍" },
                { icon: "✓", text: "無需重複註冊" },
                { icon: "✓", text: "安全加密傳輸" },
                { icon: "✓", text: "一鍵快速登入" },
              ].map((feature, idx) => (
                <div key={idx} className="surfaceItem">
                  <div className="surfaceAccent" style={{ "--accent-bg": "rgba(44, 184, 168, 0.14)", "--accent": "var(--success)" } as React.CSSProperties}>
                    {feature.icon}
                  </div>
                  <div className="surfaceContent">
                    <h3 className="surfaceTitle">{feature.text}</h3>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="btn primary"
              onClick={handleSSOLogin}
              disabled={isLoading}
              style={{ width: "100%" }}
            >
              {isLoading ? "正在連線..." : `使用 ${school.name} 帳號登入`}
            </button>

            <div className="surfaceItem">
              <div className="surfaceAccent" style={{ "--accent-bg": "rgba(91, 108, 255, 0.14)" } as React.CSSProperties}>
                i
              </div>
              <div className="surfaceContent">
                <p className="surfaceMeta">登入後帳號資訊由學校 SSO 提供，平台不會儲存您的校務系統密碼。</p>
              </div>
            </div>
          </section>
        )}

        {loginMethod === "email" && (
          <section className="sectionCard">
            <div className="segmentedGroup">
              <button
                type="button"
                className={`btn ${authMode === "login" ? "primary" : ""}`}
                onClick={() => { setAuthMode("login"); setError(null); setSuccess(null); }}
                style={{ flex: 1 }}
              >
                登入
              </button>
              <button
                type="button"
                className={`btn ${authMode === "register" ? "primary" : ""}`}
                onClick={() => { setAuthMode("register"); setError(null); setSuccess(null); }}
                style={{ flex: 1 }}
              >
                註冊
              </button>
            </div>

            <div className="sectionCopy">
              <h2 className="sectionTitle">{authMode === "login" ? "電子郵件登入" : "建立帳號"}</h2>
              <p className="sectionText">
              {authMode === "login" 
                ? "使用您註冊的電子郵件和密碼登入。如果您的學校支援 SSO，建議使用學校帳號登入。"
                : "建立帳號以使用完整功能。如果您的學校支援 SSO，建議使用學校帳號登入。"}
              </p>
            </div>

            {error && (
              <div style={{
                padding: "12px 16px",
                borderRadius: 14,
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "var(--danger)",
                fontSize: 14,
              }}>
                ⚠️ {error}
              </div>
            )}

            {success && (
              <div style={{
                padding: "12px 16px",
                borderRadius: 14,
                background: "rgba(16, 185, 129, 0.1)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                color: "var(--success)",
                fontSize: 14,
              }}>
                ✓ {success}
              </div>
            )}

            <form onSubmit={handleEmailLogin} className="pageStack" style={{ gap: 16 }}>
              {authMode === "register" && (
                <div>
                  <label className="kv" htmlFor="display-name">姓名（選填）</label>
                  <input
                    id="display-name"
                    className="input"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="您的姓名"
                  />
                </div>
              )}

              <div>
                <label className="kv" htmlFor="login-email">電子郵件</label>
                <input
                  id="login-email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  placeholder="your@email.com"
                  required
                  autoComplete="email"
                />
              </div>

              <div>
                <label className="kv" htmlFor="login-password">密碼</label>
                <div style={{ position: "relative" }}>
                  <input
                    id="login-password"
                    className="input"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }}
                    placeholder={authMode === "register" ? "至少 6 個字元" : "輸入密碼"}
                    required
                    autoComplete={authMode === "register" ? "new-password" : "current-password"}
                    style={{
                      paddingRight: 48,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: "absolute",
                      right: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 18,
                    }}
                  >
                    {showPassword ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>

              {authMode === "register" && (
                <div>
                  <label className="kv" htmlFor="confirm-password">確認密碼</label>
                  <input
                    id="confirm-password"
                    className="input"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
                    placeholder="再次輸入密碼"
                    required
                    autoComplete="new-password"
                  />
                </div>
              )}

              {authMode === "login" && (
                <div style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "space-between",
                  marginBottom: 24,
                  fontSize: 14,
                }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      style={{ width: 16, height: 16 }}
                    />
                    記住我
                  </label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    style={{ color: "var(--brand)", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}
                  >
                    忘記密碼？
                  </button>
                </div>
              )}

              <button
                type="submit"
                className="btn primary"
                disabled={isLoading || !email || !password || (authMode === "register" && !confirmPassword)}
                style={{ width: "100%", marginTop: authMode === "register" ? 8 : 0 }}
              >
                {isLoading 
                  ? (authMode === "login" ? "登入中..." : "註冊中...")
                  : (authMode === "login" ? "登入" : "建立帳號")}
              </button>
            </form>

            <div style={{ textAlign: "center", fontSize: 14, color: "var(--muted)" }}>
              {authMode === "login" ? (
                <>還沒有帳號？ <button type="button" onClick={() => setAuthMode("register")} style={{ color: "var(--brand)", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>立即註冊</button></>
              ) : (
                <>已有帳號？ <button type="button" onClick={() => setAuthMode("login")} style={{ color: "var(--brand)", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>立即登入</button></>
              )}
            </div>
          </section>
        )}

        {loginMethod === "guest" && (
          <section className="sectionCard">
            <div className="sectionCopy">
              <p className="sectionEyebrow">Guest Access</p>
              <h2 className="sectionTitle">訪客瀏覽</h2>
              <p className="sectionText">不登入也可以先看公開資訊；需要個人化或互動功能時，再切回登入模式即可。</p>
            </div>

            <div className="sectionCard">
              <div className="sectionCopy">
                <h3 className="sectionTitle">可使用功能</h3>
              </div>
              <div className="toolbarActions">
                {["公告", "活動", "地圖", "餐廳", "公車", "課表"].map((feature) => (
                  <span key={feature} className="pill" style={{ background: "rgba(44, 184, 168, 0.16)", color: "var(--success)" }}>
                    ✓ {feature}
                  </span>
                ))}
              </div>
            </div>

            <div className="sectionCard">
              <div className="sectionCopy">
                <h3 className="sectionTitle">需登入功能</h3>
              </div>
              <div className="toolbarActions">
                {["報名活動", "收藏", "評論", "訊息", "成績查詢"].map((feature) => (
                  <span key={feature} className="pill" style={{ background: "rgba(239, 109, 126, 0.14)", color: "var(--danger)" }}>
                    🔒 {feature}
                  </span>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="btn"
              onClick={handleGuestLogin}
              disabled={isLoading}
              style={{ width: "100%" }}
            >
              {isLoading ? "進入中..." : "以訪客身份瀏覽"}
            </button>
          </section>
        )}

          <div className="surfaceItem" style={{ justifyContent: "center", textAlign: "center" }}>
            <div className="surfaceContent">
              <p className="surfaceMeta">
          🔒 我們重視您的隱私。登入即表示您同意我們的
          <a href="#" style={{ color: "var(--brand)", marginLeft: 4 }}>服務條款</a>
          和
          <a href="#" style={{ color: "var(--brand)", marginLeft: 4 }}>隱私政策</a>
              </p>
            </div>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
