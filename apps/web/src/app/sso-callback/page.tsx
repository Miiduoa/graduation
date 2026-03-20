"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { completeWebSSOCallback, signInWithCustomAuthToken } from "@/lib/firebase";
import { appendSchoolContext, sanitizeInternalPath } from "@/lib/navigation";
import {
  buildCurrentSsoRedirectUri,
  PENDING_SAML_RESPONSE_KEY,
  readWebSsoCallbackParams,
} from "@/lib/sso";

type CallbackStatus = "loading" | "success" | "error";

function consumePendingSamlResponse(callbackUrl: string): string | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_SAML_RESPONSE_KEY);
    if (!raw) return null;

    const payload = JSON.parse(raw) as {
      callbackUrl?: string;
      samlResponse?: string;
    };

    const sameCallback = payload.callbackUrl === callbackUrl;
    window.sessionStorage.removeItem(PENDING_SAML_RESPONSE_KEY);

    if (!sameCallback || typeof payload.samlResponse !== "string" || !payload.samlResponse) {
      return null;
    }

    return payload.samlResponse;
  } catch {
    window.sessionStorage.removeItem(PENDING_SAML_RESPONSE_KEY);
    return null;
  }
}

function SSOCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<CallbackStatus>("loading");
  const [message, setMessage] = useState("正在驗證身份…");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const school = searchParams.get("school") || "";
      const schoolId = searchParams.get("schoolId") || "";
      const returnUrl = sanitizeInternalPath(searchParams.get("returnUrl"));
      const authError = searchParams.get("error");
      const callbackParams = readWebSsoCallbackParams(searchParams);

      if (authError) {
        if (!cancelled) {
          setStatus("error");
          setMessage(decodeURIComponent(authError.replace(/\+/g, " ")));
        }
        return;
      }

      if (!schoolId || !callbackParams.provider) {
        if (!cancelled) {
          setStatus("error");
          setMessage("缺少學校或登入方式，請重新從登入頁發起");
        }
        return;
      }

      try {
        setMessage("驗證學校身份中…");

        const redirectUri = buildCurrentSsoRedirectUri(new URL(window.location.href));
        const samlResponse =
          callbackParams.samlResponse ||
          (callbackParams.provider === "saml" ? consumePendingSamlResponse(redirectUri) : null);

        if (!callbackParams.code && !callbackParams.ticket && !samlResponse) {
          throw new Error("缺少驗證資料，請重新嘗試登入");
        }

        const result = await completeWebSSOCallback({
          provider: callbackParams.provider,
          schoolId,
          redirectUri,
          code: callbackParams.code ?? undefined,
          ticket: callbackParams.ticket ?? undefined,
          samlResponse: samlResponse ?? undefined,
        });

        setMessage("登入 Campus One…");
        await signInWithCustomAuthToken(result.customToken);

        if (cancelled) return;

        setStatus("success");
        setMessage("登入成功！即將跳轉…");

        const target = school
          ? appendSchoolContext(returnUrl, { code: school, id: schoolId })
          : returnUrl;

        window.sessionStorage.removeItem(PENDING_SAML_RESPONSE_KEY);

        window.setTimeout(() => {
          if (!cancelled) {
            router.replace(target);
          }
        }, 900);
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "登入失敗，請稍後再試");
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  const iconMap: Record<CallbackStatus, string> = {
    loading: "⏳",
    success: "✅",
    error: "❌",
  };

  const bgMap: Record<CallbackStatus, string> = {
    loading: "linear-gradient(135deg, var(--brand) 0%, var(--brand2) 100%)",
    success: "linear-gradient(135deg, var(--success) 0%, #5EE076 100%)",
    error: "linear-gradient(135deg, var(--danger) 0%, #FF6B6B 100%)",
  };
  const loginQuery = new URLSearchParams();
  const school = searchParams.get("school");
  const schoolId = searchParams.get("schoolId");
  const returnUrl = searchParams.get("returnUrl");

  if (school) loginQuery.set("school", school);
  if (schoolId) loginQuery.set("schoolId", schoolId);
  if (returnUrl) loginQuery.set("returnUrl", returnUrl);
  const loginQueryString = loginQuery.toString();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: '"SF Pro Text", "PingFang TC", sans-serif',
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--surface)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: bgMap[status],
            padding: "36px 28px",
            textAlign: "center",
            color: "#fff",
            transition: "background 0.4s ease",
          }}
        >
          <div
            style={{
              fontSize: 56,
              marginBottom: 12,
              animation: status === "loading" ? "spin 1s linear infinite" : "none",
            }}
          >
            {status === "loading" ? "🔄" : iconMap[status]}
          </div>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          <h1
            style={{
              margin: "0 0 8px",
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: "-0.04em",
            }}
          >
            {status === "loading" ? "正在登入" : status === "success" ? "登入成功" : "登入失敗"}
          </h1>
          <p style={{ margin: 0, fontSize: 14, opacity: 0.88, lineHeight: 1.6 }}>{message}</p>
        </div>

        <div style={{ padding: "24px 28px" }}>
          {status === "loading" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {["驗證學校身份", "交換 Firebase 令牌", "同步登入狀態"].map((step, index) => (
                <div
                  key={step}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    borderRadius: "var(--radius-sm)",
                    background: index === 0 ? "var(--accent-soft)" : "var(--panel)",
                    border: "1px solid",
                    borderColor: index === 0 ? "rgba(94,106,210,0.2)" : "var(--border)",
                    opacity: index === 0 ? 1 : 0.5,
                  }}
                >
                  <span style={{ fontSize: 16 }}>{index === 0 ? "⏳" : "○"}</span>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: index === 0 ? 700 : 500,
                      color: index === 0 ? "var(--brand)" : "var(--muted)",
                    }}
                  >
                    {step}
                  </span>
                </div>
              ))}
            </div>
          )}

          {status === "error" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
                {message}
              </div>
              <button
                className="btn primary"
                style={{ width: "100%", minHeight: 48 }}
                onClick={() => router.push(`/login${loginQueryString ? `?${loginQueryString}` : ""}`)}
              >
                返回登入頁
              </button>
            </div>
          )}

          {status === "success" && (
            <div
              style={{
                padding: "14px 16px",
                borderRadius: "var(--radius-sm)",
                background: "var(--success-soft)",
                border: "1px solid rgba(52,199,89,0.2)",
                fontSize: 13,
                color: "var(--success)",
                textAlign: "center",
                fontWeight: 600,
              }}
            >
              即將跳轉至頁面…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SSOCallbackPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--bg)",
          }}
        >
          <div style={{ fontSize: 48 }}>⏳</div>
        </div>
      }
    >
      <SSOCallbackContent />
    </Suspense>
  );
}
