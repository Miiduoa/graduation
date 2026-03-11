"use client";

import { useState, useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(display-mode: standalone)").matches;
  });
  const [isVisible, setIsVisible] = useState(() => {
    if (typeof window === "undefined") return false;
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    if (isStandalone) return false;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!isIOS) return false;
    return !localStorage.getItem("pwa-install-dismissed");
  });
  const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);

  useEffect(() => {
    if (isInstalled || isIOS) {
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      
      // Check if previously dismissed
      const dismissed = localStorage.getItem("pwa-install-dismissed");
      if (!dismissed) {
        setIsVisible(true);
      }
    };

    const appInstalledHandler = () => {
      setIsInstalled(true);
      setIsVisible(false);
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", appInstalledHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", appInstalledHandler);
    };
  }, [isInstalled, isIOS]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      setIsVisible(false);
    }

    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem("pwa-install-dismissed", "true");
  };

  if (!isVisible || isInstalled) return null;

  return (
    <div className="pwaInstallBanner">
      <div
        style={{
          maxWidth: 600,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div style={{ fontSize: 32 }}>📲</div>
        
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            安裝校園助手 App
          </div>
          <div style={{ fontSize: 13, opacity: 0.9 }}>
            {isIOS ? (
              <>點擊 <span style={{ fontWeight: 600 }}>分享</span> 按鈕，然後選擇 <span style={{ fontWeight: 600 }}>加入主畫面</span></>
            ) : (
              "快速存取校園資訊，支援離線瀏覽"
            )}
          </div>
        </div>
        
        <div style={{ display: "flex", gap: 8 }}>
          {!isIOS && (
            <button
              onClick={handleInstall}
              style={{
                background: "#fff",
                color: "#7C5CFF",
                border: "none",
                padding: "10px 20px",
                borderRadius: 8,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              安裝
            </button>
          )}
          <button
            onClick={handleDismiss}
            style={{
              background: "rgba(255,255,255,0.2)",
              color: "#fff",
              border: "none",
              padding: "10px 16px",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

export default PWAInstallBanner;
