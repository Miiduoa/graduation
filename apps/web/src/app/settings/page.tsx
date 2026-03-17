"use client";

import { SiteShell } from "@/components/SiteShell";
import { resolveSchool } from "@campus/shared/src/schools";
import { useState, useEffect, useCallback } from "react";

type SettingSection = "general" | "notifications" | "appearance" | "privacy" | "account";

const STORAGE_KEYS = {
  SETTINGS: "campus_web_settings",
  THEME: "campus_theme",
  LANGUAGE: "campus_language",
};

interface Settings {
  darkMode: boolean;
  language: string;
  startPage: string;
  autoSync: boolean;
  themeColor: string;
  fontSize: string;
  animations: boolean;
  compactMode: boolean;
  notifications: {
    announcements: boolean;
    events: boolean;
    messages: boolean;
    reminders: boolean;
    marketing: boolean;
  };
  privacy: {
    showProfile: boolean;
    showActivity: boolean;
    analytics: boolean;
  };
}

const defaultSettings: Settings = {
  darkMode: false,
  language: "zh-TW",
  startPage: "home",
  autoSync: true,
  themeColor: "#5B6CFF",
  fontSize: "medium",
  animations: true,
  compactMode: false,
  notifications: {
    announcements: true,
    events: true,
    messages: true,
    reminders: true,
    marketing: false,
  },
  privacy: {
    showProfile: true,
    showActivity: false,
    analytics: true,
  },
};

function loadSettings(): Settings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
  return defaultSettings;
}

function saveSettings(settings: Settings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    localStorage.setItem(STORAGE_KEYS.LANGUAGE, settings.language);
    document.documentElement.setAttribute("data-theme", settings.darkMode ? "dark" : "light");
    document.documentElement.style.setProperty("--brand", settings.themeColor);
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

export default function SettingsPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({
    school: props.searchParams?.school,
    schoolId: props.searchParams?.schoolId,
  });

  const [activeSection, setActiveSection] = useState<SettingSection>("general");
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const updateSettings = useCallback((updates: Partial<Settings>) => {
    setIsSaving(true);
    setSettings((prev) => {
      return { ...prev, ...updates };
    });
    setTimeout(() => {
      setIsSaving(false);
      setSaveMessage("設定已儲存");
      setTimeout(() => setSaveMessage(null), 2000);
    }, 300);
  }, []);

  const { darkMode, language, notifications, privacy, themeColor, fontSize, animations, compactMode, startPage, autoSync } = settings;

  const setDarkMode = (value: boolean) => updateSettings({ darkMode: value });
  const setLanguage = (value: string) => updateSettings({ language: value });
  const setNotifications = (value: typeof notifications) => updateSettings({ notifications: value });
  const setPrivacy = (value: typeof privacy) => updateSettings({ privacy: value });
  const setThemeColor = (value: string) => updateSettings({ themeColor: value });
  const setFontSize = (value: string) => updateSettings({ fontSize: value });
  const setAnimations = (value: boolean) => updateSettings({ animations: value });
  const setCompactMode = (value: boolean) => updateSettings({ compactMode: value });
  const setStartPage = (value: string) => updateSettings({ startPage: value });
  const setAutoSync = (value: boolean) => updateSettings({ autoSync: value });

  const handleExportData = async () => {
    const data = {
      exportedAt: new Date().toISOString(),
      settings,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campus-settings-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearCache = () => {
    if (confirm("確定要清除快取資料嗎？這將會清除本地儲存的暫存資料。")) {
      const keysToKeep = [STORAGE_KEYS.SETTINGS, STORAGE_KEYS.LANGUAGE, STORAGE_KEYS.THEME];
      const allKeys = Object.keys(localStorage);
      allKeys.forEach((key) => {
        if (!keysToKeep.includes(key)) {
          localStorage.removeItem(key);
        }
      });
      setSaveMessage("快取已清除");
      setTimeout(() => setSaveMessage(null), 2000);
    }
  };

  const handleResetSettings = () => {
    if (confirm("確定要重設所有設定嗎？這將會恢復到預設值。")) {
      setSettings(defaultSettings);
      saveSettings(defaultSettings);
      setSaveMessage("設定已重設");
      setTimeout(() => setSaveMessage(null), 2000);
    }
  };

  const sections: { key: SettingSection; label: string; icon: string }[] = [
    { key: "general", label: "一般設定", icon: "⚙️" },
    { key: "notifications", label: "通知設定", icon: "🔔" },
    { key: "appearance", label: "外觀設定", icon: "🎨" },
    { key: "privacy", label: "隱私設定", icon: "🔒" },
    { key: "account", label: "帳號設定", icon: "👤" },
  ];

  const languages = [
    { code: "zh-TW", label: "繁體中文", flag: "🇹🇼" },
    { code: "zh-CN", label: "简体中文", flag: "🇨🇳" },
    { code: "en", label: "English", flag: "🇺🇸" },
    { code: "ja", label: "日本語", flag: "🇯🇵" },
    { code: "ko", label: "한국어", flag: "🇰🇷" },
  ];

  const SettingRow = ({ 
    label, 
    description, 
    children 
  }: { 
    label: string; 
    description?: string; 
    children: React.ReactNode;
  }) => (
    <div className="settingsRow">
      <div className="settingsRowCopy">
        <div className="settingsRowTitle">{label}</div>
        {description ? <div className="settingsRowText">{description}</div> : null}
      </div>
      <div>{children}</div>
    </div>
  );

  const Toggle = ({ 
    checked, 
    onChange 
  }: { 
    checked: boolean; 
    onChange: (checked: boolean) => void;
  }) => (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="toggle"
      style={
        checked
          ? ({ "--toggle-bg": "var(--brand)", "--toggle-border": "var(--brand)", "--toggle-left": "26px" } as React.CSSProperties)
          : undefined
      }
    >
      <div className="toggleThumb" />
    </button>
  );

  const renderGeneralSettings = () => (
    <div>
      <SettingRow 
        label="預設學校" 
        description="選擇您的主要學校以便快速存取相關資訊"
      >
        <select
          value={school.id}
          disabled
          className="input"
          style={{ minWidth: 160 }}
        >
          <option>{school.name}</option>
        </select>
      </SettingRow>

      <SettingRow 
        label="語言" 
        description="選擇應用程式的顯示語言"
      >
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="input"
          style={{ minWidth: 160 }}
        >
          {languages.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.flag} {lang.label}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow 
        label="啟動頁面" 
        description="選擇應用程式啟動時顯示的頁面"
      >
        <select
          value={startPage}
          onChange={(e) => setStartPage(e.target.value)}
          className="input"
          style={{ minWidth: 160 }}
        >
          <option value="home">首頁</option>
          <option value="announcements">公告</option>
          <option value="timetable">課表</option>
          <option value="map">地圖</option>
        </select>
      </SettingRow>

      <SettingRow 
        label="自動同步" 
        description="在背景自動同步最新資料"
      >
        <Toggle checked={autoSync} onChange={setAutoSync} />
      </SettingRow>
    </div>
  );

  const renderNotificationSettings = () => (
    <div>
      <SettingRow 
        label="公告通知" 
        description="接收學校重要公告的推播通知"
      >
        <Toggle 
          checked={notifications.announcements} 
          onChange={(v) => setNotifications({ ...notifications, announcements: v })} 
        />
      </SettingRow>

      <SettingRow 
        label="活動通知" 
        description="接收活動報名、提醒等通知"
      >
        <Toggle 
          checked={notifications.events} 
          onChange={(v) => setNotifications({ ...notifications, events: v })} 
        />
      </SettingRow>

      <SettingRow 
        label="訊息通知" 
        description="接收新訊息和留言通知"
      >
        <Toggle 
          checked={notifications.messages} 
          onChange={(v) => setNotifications({ ...notifications, messages: v })} 
        />
      </SettingRow>

      <SettingRow 
        label="課程提醒" 
        description="接收課程開始前的提醒"
      >
        <Toggle 
          checked={notifications.reminders} 
          onChange={(v) => setNotifications({ ...notifications, reminders: v })} 
        />
      </SettingRow>

      <SettingRow 
        label="行銷訊息" 
        description="接收校園優惠和推廣訊息"
      >
        <Toggle 
          checked={notifications.marketing} 
          onChange={(v) => setNotifications({ ...notifications, marketing: v })} 
        />
      </SettingRow>

      <div style={{ 
        marginTop: 20, 
        padding: 16, 
        background: "var(--panel2)", 
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}>
        <span style={{ fontSize: 24 }}>📱</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>啟用瀏覽器推播</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            在瀏覽器接收即時通知
          </div>
        </div>
        <button className="btn primary" style={{ fontSize: 13 }}>
          啟用推播
        </button>
      </div>
    </div>
  );

  const renderAppearanceSettings = () => (
    <div>
      <SettingRow 
        label="深色模式" 
        description="使用深色主題減少眼睛疲勞"
      >
        <Toggle checked={darkMode} onChange={setDarkMode} />
      </SettingRow>

      <SettingRow 
        label="主題色彩" 
        description="選擇應用程式的主要色彩"
      >
        <div style={{ display: "flex", gap: 8 }}>
          {["#8B5CF6", "#EC4899", "#3B82F6", "#10B981", "#F59E0B"].map((color) => (
            <button
              key={color}
              onClick={() => setThemeColor(color)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                background: color,
                border: color === themeColor ? "3px solid #fff" : "none",
                boxShadow: color === themeColor ? `0 0 0 2px ${color}` : "none",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            />
          ))}
        </div>
      </SettingRow>

      <SettingRow 
        label="字體大小" 
        description="調整應用程式的文字大小"
      >
        <select
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value)}
          className="input"
          style={{ minWidth: 160 }}
        >
          <option value="small">小</option>
          <option value="medium">中（預設）</option>
          <option value="large">大</option>
          <option value="xlarge">特大</option>
        </select>
      </SettingRow>

      <SettingRow 
        label="動畫效果" 
        description="啟用介面轉場和動畫"
      >
        <Toggle checked={animations} onChange={setAnimations} />
      </SettingRow>

      <SettingRow 
        label="緊湊模式" 
        description="減少介面元素間距，顯示更多內容"
      >
        <Toggle checked={compactMode} onChange={setCompactMode} />
      </SettingRow>
    </div>
  );

  const renderPrivacySettings = () => (
    <div>
      <SettingRow 
        label="公開個人檔案" 
        description="允許其他使用者查看您的基本資訊"
      >
        <Toggle 
          checked={privacy.showProfile} 
          onChange={(v) => setPrivacy({ ...privacy, showProfile: v })} 
        />
      </SettingRow>

      <SettingRow 
        label="顯示活動狀態" 
        description="顯示您的線上狀態和最近活動"
      >
        <Toggle 
          checked={privacy.showActivity} 
          onChange={(v) => setPrivacy({ ...privacy, showActivity: v })} 
        />
      </SettingRow>

      <SettingRow 
        label="使用分析" 
        description="幫助我們改善應用程式體驗（匿名資料）"
      >
        <Toggle 
          checked={privacy.analytics} 
          onChange={(v) => setPrivacy({ ...privacy, analytics: v })} 
        />
      </SettingRow>

      <div style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>📦 資料管理</h3>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button 
            className="btn" 
            onClick={handleExportData}
            style={{ 
              justifyContent: "space-between", 
              padding: "14px 16px",
              display: "flex",
            }}
          >
            <span>📥 匯出我的資料</span>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>下載 JSON</span>
          </button>
          
          <button 
            className="btn" 
            onClick={handleClearCache}
            style={{ 
              justifyContent: "space-between", 
              padding: "14px 16px",
              display: "flex",
            }}
          >
            <span>🗑️ 清除快取資料</span>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>釋放空間</span>
          </button>

          <button 
            className="btn" 
            onClick={handleResetSettings}
            style={{ 
              justifyContent: "space-between", 
              padding: "14px 16px",
              display: "flex",
            }}
          >
            <span>🔄 重設所有設定</span>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>恢復預設值</span>
          </button>
          
          <button 
            className="btn" 
            style={{ 
              justifyContent: "space-between", 
              padding: "14px 16px",
              display: "flex",
              color: "#EF4444",
            }}
          >
            <span>⚠️ 刪除帳號</span>
            <span style={{ fontSize: 13, opacity: 0.7 }}>不可復原</span>
          </button>
        </div>
      </div>
    </div>
  );

  const renderAccountSettings = () => (
    <div>
      {/* Profile Preview */}
      <div style={{
        padding: 20,
        background: "var(--panel2)",
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        gap: 16,
        marginBottom: 24,
      }}>
        <div style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          background: "linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 24,
          fontWeight: 700,
        }}>
          U
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>訪客使用者</div>
          <div style={{ color: "var(--muted)", fontSize: 14 }}>guest@campus.app</div>
          <div style={{ 
            marginTop: 8, 
            display: "inline-block",
            padding: "4px 10px",
            background: "rgba(139,92,246,0.2)",
            borderRadius: 999,
            fontSize: 12,
            color: "var(--brand)",
            fontWeight: 600,
          }}>
            訪客帳號
          </div>
        </div>
        <button className="btn" style={{ fontSize: 13 }}>
          ✏️ 編輯
        </button>
      </div>

      <SettingRow label="顯示名稱" description="其他使用者看到的名稱">
        <input
          className="input"
          type="text"
          placeholder="設定顯示名稱"
          style={{ width: 180 }}
        />
      </SettingRow>

      <SettingRow label="電子郵件" description="用於登入和接收通知">
        <span style={{ color: "var(--muted)", fontSize: 14 }}>guest@campus.app</span>
      </SettingRow>

      <SettingRow label="學校帳號" description="連結學校 SSO 帳號">
        <button className="btn" style={{ fontSize: 13 }}>
          🔗 連結帳號
        </button>
      </SettingRow>

      <div style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>🔐 安全性</h3>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button 
            className="btn" 
            style={{ 
              justifyContent: "space-between", 
              padding: "14px 16px",
              display: "flex",
            }}
          >
            <span>🔑 變更密碼</span>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>→</span>
          </button>
          
          <button 
            className="btn" 
            style={{ 
              justifyContent: "space-between", 
              padding: "14px 16px",
              display: "flex",
            }}
          >
            <span>📱 兩步驟驗證</span>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>未啟用</span>
          </button>
          
          <button 
            className="btn" 
            style={{ 
              justifyContent: "space-between", 
              padding: "14px 16px",
              display: "flex",
            }}
          >
            <span>📋 登入裝置</span>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>1 個裝置</span>
          </button>
        </div>
      </div>

      <div style={{ marginTop: 24, textAlign: "center" }}>
        <button 
          className="btn" 
          style={{ 
            color: "#EF4444",
            padding: "14px 32px",
          }}
        >
          🚪 登出
        </button>
      </div>
    </div>
  );

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="設定"
      subtitle="個人化您的應用程式體驗"
    >
      {(isSaving || saveMessage) && (
        <div
          className="floatingToast"
          style={isSaving ? undefined : { background: "rgba(44, 184, 168, 0.92)", color: "#fff", borderColor: "rgba(44, 184, 168, 0.32)" }}
        >
          {isSaving ? (
            <>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⏳</span>
              儲存中...
            </>
          ) : (
            <>
              ✓ {saveMessage}
            </>
          )}
        </div>
      )}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <div className="settingsLayout">
        <div className="card settingsSidebar" style={{ padding: 8 }}>
          <div className="sidebarMenu">
            {sections.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveSection(section.key)}
                className={`sidebarMenuButton${activeSection === section.key ? " active" : ""}`}
              >
                <span style={{ fontSize: 18 }}>{section.icon}</span>
                {section.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card sectionCard">
          <div className="sectionCopy">
            <p className="sectionEyebrow">Preferences</p>
            <h2 className="sectionTitle">
              {sections.find((s) => s.key === activeSection)?.icon}{" "}
              {sections.find((s) => s.key === activeSection)?.label}
            </h2>
            <p className="sectionText">
              {activeSection === "general" && "調整應用程式的基本設定"}
              {activeSection === "notifications" && "管理推播和通知偏好"}
              {activeSection === "appearance" && "自訂外觀和主題"}
              {activeSection === "privacy" && "控制您的隱私和資料"}
              {activeSection === "account" && "管理您的帳號資訊"}
            </p>
          </div>

          {activeSection === "general" && renderGeneralSettings()}
          {activeSection === "notifications" && renderNotificationSettings()}
          {activeSection === "appearance" && renderAppearanceSettings()}
          {activeSection === "privacy" && renderPrivacySettings()}
          {activeSection === "account" && renderAccountSettings()}
        </div>
      </div>

      {/* App Info Footer */}
      <div className="card" style={{ 
        marginTop: 24, 
        textAlign: "center",
        background: "var(--panel2)",
      }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>🏫</div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Campus App</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
          版本 1.0.0 · 最後更新：2025-03-01
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 16, fontSize: 13 }}>
          <a href="#" style={{ color: "var(--brand)" }}>使用條款</a>
          <a href="#" style={{ color: "var(--brand)" }}>隱私政策</a>
          <a href="#" style={{ color: "var(--brand)" }}>回報問題</a>
          <a href="#" style={{ color: "var(--brand)" }}>關於我們</a>
        </div>
      </div>
    </SiteShell>
  );
}
