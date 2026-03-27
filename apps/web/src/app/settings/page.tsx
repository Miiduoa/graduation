"use client";

import { SiteShell } from "@/components/SiteShell";
import { resolveSchoolPageContext } from "@/lib/pageContext";
import { useState, useCallback, type CSSProperties, type ReactNode } from "react";

type Section = "general" | "notifications" | "appearance" | "privacy" | "account";

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "general", label: "一般", icon: "⚙️" },
  { id: "notifications", label: "通知", icon: "🔔" },
  { id: "appearance", label: "外觀", icon: "🎨" },
  { id: "privacy", label: "隱私", icon: "🔒" },
  { id: "account", label: "帳號", icon: "👤" },
];

function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`toggle${value ? " on" : ""}`}
      style={{ flexShrink: 0 }}
    >
      <span
        className="toggleThumb"
        style={{ "--toggle-left": value ? "26px" : "3px" } as CSSProperties}
      />
    </button>
  );
}

function SettingRow({
  icon,
  iconBg,
  title,
  subtitle,
  right,
  danger,
  onClick,
}: {
  icon: string;
  iconBg?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className="insetGroupRow"
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      <div
        className="insetGroupRowIcon"
        style={{
          background: iconBg ?? "var(--accent-soft)",
          fontSize: 17,
          width: 34,
          height: 34,
          borderRadius: 9,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div className="insetGroupRowContent">
        <div
          className="insetGroupRowTitle"
          style={{ color: danger ? "var(--danger)" : "var(--text)" }}
        >
          {title}
        </div>
        {subtitle && <div className="insetGroupRowMeta">{subtitle}</div>}
      </div>
      {right !== undefined ? (
        right
      ) : (
        <span className="insetGroupRowChevron">›</span>
      )}
    </div>
  );
}

export default function SettingsPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName } = resolveSchoolPageContext(props.searchParams);
  const [activeSection, setActiveSection] = useState<Section>("general");

  // Settings state
  const [darkMode, setDarkMode] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [language, setLanguage] = useState("zh-TW");
  const [autoSync, setAutoSync] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [animations, setAnimations] = useState(true);
  const [fontSize, setFontSize] = useState("medium");
  const [themeColor, setThemeColor] = useState("#5E6AD2");

  // Notifications
  const [pushEnabled, setPushEnabled] = useState(true);
  const [announcements, setAnnouncements] = useState(true);
  const [gradeReleases, setGradeReleases] = useState(true);
  const [classReminders, setClassReminders] = useState(true);
  const [libraryDue, setLibraryDue] = useState(true);
  const [campusEvents, setCampusEvents] = useState(false);

  // Privacy
  const [showProfile, setShowProfile] = useState(true);
  const [showActivity, setShowActivity] = useState(false);
  const [analytics, setAnalytics] = useState(true);

  const toggleDark = useCallback((v: boolean) => {
    setDarkMode(v);
    document.documentElement.setAttribute("data-theme", v ? "dark" : "light");
  }, []);

  const THEME_COLORS = [
    "#5E6AD2", "#007AFF", "#34C759", "#FF9500",
    "#FF3B30", "#BF5AF2", "#FF6B35", "#32ADE6",
  ];

  function renderGeneral() {
    return (
      <div className="pageStack">
        <div>
          <div className="insetGroupHeader">帳號與學校</div>
          <div className="insetGroup">
            <SettingRow
              icon="🏫"
              iconBg="#E8F4FD"
              title="目前校園"
              subtitle={schoolName || "靜宜大學"}
              right={<span className="pill subtle" style={{ fontSize: 11 }}>PU</span>}
            />
            <SettingRow icon="🔄" iconBg="#E8FFF2" title="自動同步" right={<Toggle value={autoSync} onChange={setAutoSync} />} />
            <SettingRow icon="🌐" iconBg="#FFF3E8" title="語言" subtitle="繁體中文" right={<span style={{ fontSize: 13, color: "var(--muted)" }}>{language === "zh-TW" ? "繁體中文" : "English"} ›</span>} />
          </div>
        </div>
        <div>
          <div className="insetGroupHeader">閱讀偏好</div>
          <div className="insetGroup">
            <SettingRow
              icon="📏"
              iconBg="#F3F0FF"
              title="字體大小"
              right={
                <div className="segmentedGroup" style={{ padding: "3px", gap: 3 }}>
                  {["small", "medium", "large"].map((s) => (
                    <button
                      key={s}
                      className={fontSize === s ? "active" : ""}
                      onClick={() => setFontSize(s)}
                      style={{ padding: "4px 10px", fontSize: 12 }}
                    >
                      {s === "small" ? "小" : s === "medium" ? "中" : "大"}
                    </button>
                  ))}
                </div>
              }
            />
            <SettingRow icon="▤" iconBg="#FFF8E8" title="緊湊模式" subtitle="縮小卡片間距" right={<Toggle value={compactMode} onChange={setCompactMode} />} />
            <SettingRow icon="✨" iconBg="#FFF0F5" title="動畫效果" right={<Toggle value={animations} onChange={setAnimations} />} />
          </div>
        </div>
        <div>
          <div className="insetGroupHeader">關於</div>
          <div className="insetGroup">
            <SettingRow icon="ℹ️" iconBg="#E8F4FD" title="Campus One" subtitle="版本 2.0.0" />
            <SettingRow icon="📄" iconBg="#F3F0FF" title="服務條款" />
            <SettingRow icon="🔐" iconBg="#E8FFF2" title="隱私政策" />
          </div>
        </div>
      </div>
    );
  }

  function renderNotifications() {
    return (
      <div className="pageStack">
        <div>
          <div className="insetGroupHeader">總開關</div>
          <div className="insetGroup">
            <SettingRow
              icon="🔔"
              iconBg={pushEnabled ? "rgba(94,106,210,0.12)" : "var(--panel)"}
              title="推播通知"
              subtitle="接收應用程式通知"
              right={<Toggle value={pushEnabled} onChange={setPushEnabled} />}
            />
          </div>
        </div>

        {pushEnabled && (
          <>
            <div>
              <div className="insetGroupHeader">學術通知</div>
              <div className="insetGroup">
                <SettingRow icon="📢" iconBg="#FFF3E8" title="公告與通知" right={<Toggle value={announcements} onChange={setAnnouncements} />} />
                <SettingRow icon="📊" iconBg="var(--danger-soft)" title="成績公布" right={<Toggle value={gradeReleases} onChange={setGradeReleases} />} />
                <SettingRow icon="📅" iconBg="var(--info-soft)" title="上課提醒" subtitle="課程開始前 15 分鐘" right={<Toggle value={classReminders} onChange={setClassReminders} />} />
                <SettingRow icon="📚" iconBg="var(--success-soft)" title="借閱到期提醒" right={<Toggle value={libraryDue} onChange={setLibraryDue} />} />
              </div>
            </div>
            <div>
              <div className="insetGroupHeader">校園活動</div>
              <div className="insetGroup">
                <SettingRow icon="🎉" iconBg="#F3F0FF" title="校園活動" subtitle="社團活動與校慶資訊" right={<Toggle value={campusEvents} onChange={setCampusEvents} />} />
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  function renderAppearance() {
    return (
      <div className="pageStack">
        <div>
          <div className="insetGroupHeader">主題</div>
          <div className="insetGroup">
            <SettingRow
              icon={darkMode ? "🌙" : "☀️"}
              iconBg={darkMode ? "#2C2C2E" : "#FFF8E8"}
              title="深色模式"
              subtitle={darkMode ? "目前：深色" : "目前：淺色"}
              right={<Toggle value={darkMode} onChange={toggleDark} />}
            />
          </div>
        </div>

        <div>
          <div className="insetGroupHeader">主色調</div>
          <div className="card" style={{ padding: "16px 18px" }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {THEME_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setThemeColor(c)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: c,
                    border: themeColor === c ? "3px solid var(--text)" : "3px solid transparent",
                    boxShadow: themeColor === c ? "var(--shadow-md)" : "var(--shadow-sm)",
                    cursor: "pointer",
                    transition: "box-shadow 0.2s ease, transform 0.15s ease",
                    transform: themeColor === c ? "scale(1.15)" : "scale(1)",
                  }}
                  title={c}
                />
              ))}
            </div>
            <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--muted)" }}>
              目前主色：<code style={{ color: "var(--brand)" }}>{themeColor}</code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  function renderPrivacy() {
    return (
      <div className="pageStack">
        <div>
          <div className="insetGroupHeader">個人資料可見性</div>
          <div className="insetGroup">
            <SettingRow icon="👤" iconBg="var(--accent-soft)" title="公開個人頁面" subtitle="其他同學可查看你的基本資訊" right={<Toggle value={showProfile} onChange={setShowProfile} />} />
            <SettingRow icon="📋" iconBg="var(--info-soft)" title="顯示活動紀錄" subtitle="讓他人看到你最近的課程活動" right={<Toggle value={showActivity} onChange={setShowActivity} />} />
          </div>
        </div>
        <div>
          <div className="insetGroupHeader">資料與分析</div>
          <div className="insetGroup">
            <SettingRow icon="📈" iconBg="var(--success-soft)" title="使用情況分析" subtitle="協助改善應用程式體驗" right={<Toggle value={analytics} onChange={setAnalytics} />} />
          </div>
        </div>
        <div>
          <div className="insetGroupHeader">資料管理</div>
          <div className="insetGroup">
            <SettingRow icon="📤" iconBg="var(--info-soft)" title="匯出個人資料" subtitle="下載你的所有資料" />
            <SettingRow icon="🗑" iconBg="var(--danger-soft)" title="刪除帳號" subtitle="永久刪除帳號與所有資料" danger />
          </div>
        </div>
      </div>
    );
  }

  function renderAccount() {
    return (
      <div className="pageStack">
        {/* Profile mini card */}
        <div
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "18px 20px",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "linear-gradient(135deg, var(--brand) 0%, var(--brand2) 100%)",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontSize: 24,
              fontWeight: 800,
              flexShrink: 0,
              boxShadow: "var(--shadow-sm)",
            }}
          >
            學
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>學生姓名</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
              學號登入 · {schoolName || "靜宜大學"}
            </div>
          </div>
          <span style={{ fontSize: 13, color: "var(--brand)", fontWeight: 600, cursor: "pointer" }}>
            編輯
          </span>
        </div>

        <div>
          <div className="insetGroupHeader">登入方式</div>
          <div className="insetGroup">
            <SettingRow
              icon="🪪"
              iconBg="#E8F4FD"
              title="靜宜學號登入"
              subtitle="使用靜宜 e 校園帳號密碼"
              right={<span className="pill success" style={{ fontSize: 11 }}>啟用中</span>}
            />
          </div>
        </div>

        <div>
          <div className="insetGroupHeader">安全性</div>
          <div className="insetGroup">
            <SettingRow icon="🔑" iconBg="#FFF3E8" title="密碼管理" subtitle="請至靜宜 e 校園修改你的登入密碼" />
            <SettingRow icon="🔥" iconBg="var(--success-soft)" title="Firebase 會話" subtitle="登入後由 Campus One 自動建立" right={<span className="pill subtle" style={{ fontSize: 11 }}>已啟用</span>} />
          </div>
        </div>

        <div>
          <div className="insetGroupHeader">登出</div>
          <div className="insetGroup">
            <SettingRow icon="🚪" iconBg="var(--danger-soft)" title="登出" danger right={null} onClick={() => {}} />
          </div>
        </div>
      </div>
    );
  }

  const contentMap: Record<Section, () => ReactNode> = {
    general: renderGeneral,
    notifications: renderNotifications,
    appearance: renderAppearance,
    privacy: renderPrivacy,
    account: renderAccount,
  };

  return (
    <SiteShell
      title="設定"
      subtitle="個人化您的 Campus One 體驗"
      schoolName={schoolName}
    >
      <div className="settingsLayout">
        {/* ── Sidebar ── */}
        <aside className="settingsSidebar">
          <div className="sidebarMenu">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`sidebarMenuButton${activeSection === s.id ? " active" : ""}`}
                onClick={() => setActiveSection(s.id)}
              >
                <span style={{ fontSize: 18 }}>{s.icon}</span>
                {s.label}
              </button>
            ))}
          </div>
        </aside>

        {/* ── Content ── */}
        <div>{contentMap[activeSection]()}</div>
      </div>
    </SiteShell>
  );
}
