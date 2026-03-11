"use client";

import { useState, useEffect } from "react";

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(() => {
    if (typeof navigator === "undefined") return false;
    return !navigator.onLine;
  });

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--top-offset", isOffline ? "44px" : "0px");
    return () => {
      root.style.setProperty("--top-offset", "0px");
    };
  }, [isOffline]);

  if (!isOffline) return null;

  return (
    <div className="offlineBanner">
      <span>📡</span>
      <span>您目前處於離線狀態，部分功能可能無法使用</span>
    </div>
  );
}

export default OfflineBanner;
