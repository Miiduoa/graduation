"use client";

import { useState, useEffect } from "react";

export function UpdateBanner() {
  const [showUpdate, setShowUpdate] = useState(false);

  useEffect(() => {
    // Listen for service worker update
    const handleUpdate = () => {
      setShowUpdate(true);
    };

    window.addEventListener("swUpdate", handleUpdate);

    return () => {
      window.removeEventListener("swUpdate", handleUpdate);
    };
  }, []);

  const handleRefresh = () => {
    // Skip waiting and reload
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then((registration) => {
        if (registration?.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      });
    }
    
    window.location.reload();
  };

  if (!showUpdate) return null;

  return (
    <div className="updateBanner">
      <div style={{ fontSize: 24 }}>🔄</div>
      
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 2, color: "var(--text, #fff)" }}>
          有新版本可用
        </div>
        <div style={{ fontSize: 13, color: "var(--muted, #9CA3AF)" }}>
          重新載入以取得最新功能
        </div>
      </div>
      
      <button
        onClick={handleRefresh}
        style={{
          background: "var(--brand, #7C5CFF)",
          color: "#fff",
          border: "none",
          padding: "10px 16px",
          borderRadius: 8,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        更新
      </button>
    </div>
  );
}

export default UpdateBanner;
