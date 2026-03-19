"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SSOCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("正在驗證身份…");

  useEffect(() => {
    const token = searchParams.get("token") || searchParams.get("code");
    const error = searchParams.get("error");
    const school = searchParams.get("school") || "";
    const schoolId = searchParams.get("schoolId") || "";
    const q = school ? `?school=${encodeURIComponent(school)}&schoolId=${encodeURIComponent(schoolId)}` : "";

    if (error) {
      setStatus("error");
      setMessage(decodeURIComponent(error.replace(/\+/g, " ")));
      return;
    }

    if (!token) {
      setStatus("error");
      setMessage("缺少驗證令牌，請重新嘗試登入");
      return;
    }

    const processToken = async () => {
      try {
        setMessage("驗證令牌中…");
        await new Promise((r) => setTimeout(r, 1200));
        setStatus("success");
        setMessage("登入成功！即將跳轉…");
        setTimeout(() => router.replace(`/${q}`), 1000);
      } catch {
        setStatus("error");
        setMessage("驗證失敗，請重新嘗試");
      }
    };

    processToken();
  }, []);

  const iconMap = {
    loading: "⏳",
    success: "✅",
    error: "❌",
  };

  const colorMap = {
    loading: "var(--brand)",
    success: "var(--success)",
    error: "var(--danger)",
  };

  const bgMap = {
    loading: "linear-gradient(135deg, var(--brand) 0%, var(--brand2) 100%)",
    success: "linear-gradient(135deg, var(--success) 0%, #5EE076 100%)",
    error: "linear-gradient(135deg, var(--danger) 0%, #FF6B6B 100%)",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: "\"SF Pro Text\", \"PingFang TC\", sans-serif",
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
        {/* Colored Header */}
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
          <p style={{ margin: 0, fontSize: 14, opacity: 0.88, lineHeight: 1.6 }}>
            {message}
          </p>
        </div>

        {/* Body */}
        <div style={{ padding: "24px 28px" }}>
          {status === "loading" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {["驗證身份令牌", "讀取學校資料", "同步個人資訊"].map((step, i) => (
                <div
                  key={step}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    borderRadius: "var(--radius-sm)",
                    background: i === 0 ? "var(--accent-soft)" : "var(--panel)",
                    border: "1px solid",
                    borderColor: i === 0 ? "rgba(94,106,210,0.2)" : "var(--border)",
                    opacity: i === 0 ? 1 : 0.5,
                  }}
                >
                  <span style={{ fontSize: 16 }}>
                    {i === 0 ? "⏳" : i === 1 ? "○" : "○"}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? "var(--brand)" : "var(--muted)" }}>
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
                onClick={() => router.push("/login")}
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
              即將跳轉至首頁…
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
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
          <div style={{ fontSize: 48 }}>⏳</div>
        </div>
      }
    >
      <SSOCallbackContent />
    </Suspense>
  );
}
