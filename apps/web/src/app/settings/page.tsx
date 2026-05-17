'use client';

import { SiteShell } from '@/components/SiteShell';
import { useToast } from '@/components/ui';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useState, useCallback, useMemo, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { getAuth } from '@/lib/firebase';
import { useDemoRole, getCapabilities, writeDemoRole } from '@/lib/demoRole';
import { clearAllDemoState } from '@/lib/useRoleScopedState';
import { getDemoUser } from '@/lib/demoData';

type Section =
  | 'general'
  | 'notifications'
  | 'appearance'
  | 'privacy'
  | 'account'
  | 'system'
  | 'department';

const BASE_SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'general', label: '一般', icon: '⚙️' },
  { id: 'notifications', label: '通知', icon: '🔔' },
  { id: 'appearance', label: '外觀', icon: '🎨' },
  { id: 'privacy', label: '隱私', icon: '🔒' },
  { id: 'account', label: '帳號', icon: '👤' },
];

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`toggle${value ? ' on' : ''}`}
      style={{ flexShrink: 0 }}
    >
      <span
        className="toggleThumb"
        style={{ '--toggle-left': value ? '26px' : '3px' } as CSSProperties}
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
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      <div
        className="insetGroupRowIcon"
        style={{
          background: iconBg ?? 'var(--accent-soft)',
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
          style={{ color: danger ? 'var(--danger)' : 'var(--text)' }}
        >
          {title}
        </div>
        {subtitle && <div className="insetGroupRowMeta">{subtitle}</div>}
      </div>
      {right !== undefined ? right : <span className="insetGroupRowChevron">›</span>}
    </div>
  );
}

export default function SettingsPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const router = useRouter();
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const { success, info } = useToast();

  // 根據角色決定 sidebar sections
  const SECTIONS = useMemo<{ id: Section; label: string; icon: string }[]>(() => {
    const list = [...BASE_SECTIONS];
    if (caps.canManageSystem) {
      list.push({ id: 'system', label: '系統管理', icon: '🛡️' });
    }
    if (demoRole === 'department_head') {
      list.push({ id: 'department', label: '系所設定', icon: '🏛️' });
    }
    return list;
  }, [caps.canManageSystem, demoRole]);

  const [activeSection, setActiveSection] = useState<Section>('general');
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const auth = getAuth();
      if (auth) {
        await signOut(auth);
      }
    } catch (err) {
      console.error('[settings] signOut failed', err);
    } finally {
      // Demo 體驗：登出時也把 demoRole 清回 guest
      writeDemoRole('guest');
      router.replace(`/login${q}`);
    }
  }, [signingOut, router, q]);

  // Settings state
  const [darkMode, setDarkMode] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [language, setLanguage] = useState('zh-TW');
  const [autoSync, setAutoSync] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [animations, setAnimations] = useState(true);
  const [fontSize, setFontSize] = useState('medium');
  const [themeColor, setThemeColor] = useState('#5E6AD2');

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
    document.documentElement.setAttribute('data-theme', v ? 'dark' : 'light');
  }, []);

  const THEME_COLORS = [
    '#5E6AD2',
    '#007AFF',
    '#34C759',
    '#FF9500',
    '#FF3B30',
    '#BF5AF2',
    '#FF6B35',
    '#32ADE6',
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
              subtitle={schoolName || '靜宜大學'}
              right={
                <span className="pill subtle" style={{ fontSize: 11 }}>
                  PU
                </span>
              }
            />
            <SettingRow
              icon="🔄"
              iconBg="#E8FFF2"
              title="自動同步"
              right={<Toggle value={autoSync} onChange={setAutoSync} />}
            />
            <SettingRow
              icon="🌐"
              iconBg="#FFF3E8"
              title="語言"
              subtitle="繁體中文"
              right={
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {language === 'zh-TW' ? '繁體中文' : 'English'} ›
                </span>
              }
            />
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
                <div className="segmentedGroup" style={{ padding: '3px', gap: 3 }}>
                  {['small', 'medium', 'large'].map((s) => (
                    <button
                      key={s}
                      className={fontSize === s ? 'active' : ''}
                      onClick={() => setFontSize(s)}
                      style={{ padding: '4px 10px', fontSize: 12 }}
                    >
                      {s === 'small' ? '小' : s === 'medium' ? '中' : '大'}
                    </button>
                  ))}
                </div>
              }
            />
            <SettingRow
              icon="▤"
              iconBg="#FFF8E8"
              title="緊湊模式"
              subtitle="縮小卡片間距"
              right={<Toggle value={compactMode} onChange={setCompactMode} />}
            />
            <SettingRow
              icon="✨"
              iconBg="#FFF0F5"
              title="動畫效果"
              right={<Toggle value={animations} onChange={setAnimations} />}
            />
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
              iconBg={pushEnabled ? 'rgba(94,106,210,0.12)' : 'var(--panel)'}
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
                <SettingRow
                  icon="📢"
                  iconBg="#FFF3E8"
                  title="公告與通知"
                  right={<Toggle value={announcements} onChange={setAnnouncements} />}
                />
                <SettingRow
                  icon="📊"
                  iconBg="var(--danger-soft)"
                  title="成績公布"
                  right={<Toggle value={gradeReleases} onChange={setGradeReleases} />}
                />
                <SettingRow
                  icon="📅"
                  iconBg="var(--info-soft)"
                  title="上課提醒"
                  subtitle="課程開始前 15 分鐘"
                  right={<Toggle value={classReminders} onChange={setClassReminders} />}
                />
                <SettingRow
                  icon="📚"
                  iconBg="var(--success-soft)"
                  title="借閱到期提醒"
                  right={<Toggle value={libraryDue} onChange={setLibraryDue} />}
                />
              </div>
            </div>
            <div>
              <div className="insetGroupHeader">校園活動</div>
              <div className="insetGroup">
                <SettingRow
                  icon="🎉"
                  iconBg="#F3F0FF"
                  title="校園活動"
                  subtitle="社團活動與校慶資訊"
                  right={<Toggle value={campusEvents} onChange={setCampusEvents} />}
                />
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
              icon={darkMode ? '🌙' : '☀️'}
              iconBg={darkMode ? '#2C2C2E' : '#FFF8E8'}
              title="深色模式"
              subtitle={darkMode ? '目前：深色' : '目前：淺色'}
              right={<Toggle value={darkMode} onChange={toggleDark} />}
            />
          </div>
        </div>

        <div>
          <div className="insetGroupHeader">主色調</div>
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {THEME_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setThemeColor(c)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: c,
                    border: themeColor === c ? '3px solid var(--text)' : '3px solid transparent',
                    boxShadow: themeColor === c ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                    cursor: 'pointer',
                    transition: 'box-shadow 0.2s ease, transform 0.15s ease',
                    transform: themeColor === c ? 'scale(1.15)' : 'scale(1)',
                  }}
                  title={c}
                />
              ))}
            </div>
            <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              目前主色：<code style={{ color: 'var(--brand)' }}>{themeColor}</code>
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
            <SettingRow
              icon="👤"
              iconBg="var(--accent-soft)"
              title="公開個人頁面"
              subtitle="其他同學可查看你的基本資訊"
              right={<Toggle value={showProfile} onChange={setShowProfile} />}
            />
            <SettingRow
              icon="📋"
              iconBg="var(--info-soft)"
              title="顯示活動紀錄"
              subtitle="讓他人看到你最近的課程活動"
              right={<Toggle value={showActivity} onChange={setShowActivity} />}
            />
          </div>
        </div>
        <div>
          <div className="insetGroupHeader">資料與分析</div>
          <div className="insetGroup">
            <SettingRow
              icon="📈"
              iconBg="var(--success-soft)"
              title="使用情況分析"
              subtitle="協助改善應用程式體驗"
              right={<Toggle value={analytics} onChange={setAnalytics} />}
            />
          </div>
        </div>
        <div>
          <div className="insetGroupHeader">資料管理</div>
          <div className="insetGroup">
            <SettingRow
              icon="📤"
              iconBg="var(--info-soft)"
              title="匯出個人資料"
              subtitle="下載你的所有資料"
            />
            <SettingRow
              icon="🗑"
              iconBg="var(--danger-soft)"
              title="刪除帳號"
              subtitle="永久刪除帳號與所有資料"
              danger
            />
          </div>
        </div>
      </div>
    );
  }

  // 帳號顯示資訊：從 demoData DEMO_USERS 取，確保與其他頁面一致
  const demoUser = demoRole !== 'guest' ? getDemoUser(demoRole) : undefined;
  const roleDisplay = {
    name: demoUser?.displayName ?? '訪客',
    avatar: demoUser?.displayName?.[0] ?? '訪',
  };

  function renderAccount() {
    return (
      <div className="pageStack">
        {/* Profile mini card */}
        <div
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '18px 20px',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand2) 100%)',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontSize: 24,
              fontWeight: 800,
              flexShrink: 0,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            {roleDisplay.avatar}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{roleDisplay.name}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
              學號登入 · {schoolName || '靜宜大學'}
            </div>
          </div>
          <span style={{ fontSize: 13, color: 'var(--brand)', fontWeight: 600, cursor: 'pointer' }}>
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
              right={
                <span className="pill success" style={{ fontSize: 11 }}>
                  啟用中
                </span>
              }
            />
          </div>
        </div>

        <div>
          <div className="insetGroupHeader">安全性</div>
          <div className="insetGroup">
            <SettingRow
              icon="🔑"
              iconBg="#FFF3E8"
              title="密碼管理"
              subtitle="請至靜宜 e 校園修改你的登入密碼"
            />
            <SettingRow
              icon="🔥"
              iconBg="var(--success-soft)"
              title="Firebase 會話"
              subtitle="登入後由 Campus One 自動建立"
              right={
                <span className="pill subtle" style={{ fontSize: 11 }}>
                  已啟用
                </span>
              }
            />
          </div>
        </div>

        <div>
          <div className="insetGroupHeader">Demo 工具</div>
          <div className="insetGroup">
            <SettingRow
              icon="🔄"
              iconBg="#FFF8E8"
              title="重置 demo 資料"
              subtitle="清除所有 demo 角色、收藏、加入社團等狀態，回到初始訪客身份"
              onClick={() => {
                if (typeof window === 'undefined') return;
                const ok = window.confirm(
                  '確定要清除所有 demo 狀態？此動作會：\n\n• 清除目前的 demo 角色\n• 清除以各角色收藏的公告\n• 清除加入的社團、續借記錄等\n\n網頁會回到登入頁，但不會影響真實 Firebase 帳號。',
                );
                if (!ok) return;
                clearAllDemoState();
                success('已重置所有 demo 資料');
                router.replace(`/login${q}`);
              }}
            />
          </div>
        </div>

        <div>
          <div className="insetGroupHeader">登出</div>
          <div className="insetGroup">
            <SettingRow
              icon="🚪"
              iconBg="var(--danger-soft)"
              title={signingOut ? '正在登出…' : '登出'}
              subtitle="結束本次連線並回到登入頁"
              danger
              right={null}
              onClick={handleSignOut}
            />
          </div>
        </div>
      </div>
    );
  }

  function renderSystem() {
    return (
      <div className="pageStack">
        <div>
          <div className="insetGroupHeader">使用者管理</div>
          <div className="insetGroup">
            <SettingRow
              icon="👥"
              iconBg="#FFF0F5"
              title="使用者列表"
              subtitle="檢視 / 編輯所有帳號"
              onClick={() => info('已開啟使用者管理面板（demo）')}
            />
            <SettingRow
              icon="🎭"
              iconBg="#F3F0FF"
              title="角色與權限"
              subtitle="11 種正式角色 + 衍生身份"
              onClick={() => info('已開啟角色管理（demo）')}
            />
            <SettingRow
              icon="🛡️"
              iconBg="#FFF3E8"
              title="登入安全策略"
              subtitle="密碼複雜度、雙因素、SSO"
              onClick={() => info('已開啟安全策略（demo）')}
            />
          </div>
        </div>
        <div>
          <div className="insetGroupHeader">學校資訊</div>
          <div className="insetGroup">
            <SettingRow
              icon="🏫"
              iconBg="#E8F4FD"
              title="校徽 / 名稱"
              onClick={() => info('已開啟學校設定（demo）')}
            />
            <SettingRow
              icon="📅"
              iconBg="#FFF8E8"
              title="學期設定"
              subtitle="目前學期：114-2"
              onClick={() => info('已開啟學期設定（demo）')}
            />
            <SettingRow
              icon="🌐"
              iconBg="#E8FFF2"
              title="網域 / API 設定"
              onClick={() => info('已開啟整合設定（demo）')}
            />
          </div>
        </div>
        <div>
          <div className="insetGroupHeader">系統日誌</div>
          <div className="insetGroup">
            <SettingRow
              icon="📊"
              iconBg="#E8F4FD"
              title="登入紀錄"
              subtitle="近 24 小時 1,247 次"
              onClick={() => info('已開啟登入紀錄（demo）')}
            />
            <SettingRow
              icon="⚠️"
              iconBg="var(--warning-soft)"
              title="錯誤日誌"
              subtitle="近 24 小時 3 次"
              onClick={() => info('已開啟錯誤日誌（demo）')}
            />
            <SettingRow
              icon="📡"
              iconBg="#F3F0FF"
              title="API 監控"
              onClick={() => info('已開啟 API 監控（demo）')}
            />
          </div>
        </div>
        <div>
          <div className="insetGroupHeader">高權限動作</div>
          <div className="insetGroup">
            <SettingRow
              icon="💾"
              iconBg="#E8F4FD"
              title="資料備份"
              onClick={() => success('已啟動備份（demo）')}
            />
            <SettingRow
              icon="🚧"
              iconBg="var(--warning-soft)"
              title="維護模式"
              subtitle="目前為正常運作"
              right={<Toggle value={false} onChange={() => info('維護模式切換（demo）')} />}
            />
          </div>
        </div>
      </div>
    );
  }

  function renderDepartment() {
    return (
      <div className="pageStack">
        <div>
          <div className="insetGroupHeader">系所資訊</div>
          <div className="insetGroup">
            <SettingRow
              icon="🏛️"
              iconBg="#FFF3E8"
              title="資訊管理系"
              subtitle="本學期開課 8 門 · 教師 18 人 · 學生 132 人"
            />
            <SettingRow
              icon="📚"
              iconBg="#E8F4FD"
              title="課程規劃"
              subtitle="畢業學分要求、必選修配置"
              onClick={() => info('已開啟課程規劃（demo）')}
            />
            <SettingRow
              icon="🎯"
              iconBg="#F3F0FF"
              title="畢業審查規則"
              subtitle="進入學分稽核系統"
              onClick={() => router.push(`/credit-planner${q}`)}
            />
          </div>
        </div>
        <div>
          <div className="insetGroupHeader">公告審核</div>
          <div className="insetGroup">
            <SettingRow
              icon="📥"
              iconBg="var(--warning-soft)"
              title="待審公告"
              subtitle="目前 3 件待處理"
              onClick={() => router.push(`/admin${q}`)}
            />
            <SettingRow
              icon="📢"
              iconBg="#E8FFF2"
              title="發布系所公告"
              onClick={() => success('已開啟「發布系所公告」表單（demo）')}
            />
          </div>
        </div>
        <div>
          <div className="insetGroupHeader">教師與助教</div>
          <div className="insetGroup">
            <SettingRow
              icon="🧑‍🏫"
              iconBg="#E8FFF2"
              title="教師名冊"
              subtitle="管理任課教師資料與權限"
              onClick={() => router.push(`/admin${q}`)}
            />
            <SettingRow
              icon="🧑‍💻"
              iconBg="#F3F0FF"
              title="助教指派"
              subtitle="管理 TA 與課程的對應"
              onClick={() => info('已開啟助教指派（demo）')}
            />
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
    system: renderSystem,
    department: renderDepartment,
  };

  return (
    <SiteShell title="設定" subtitle="個人化您的 Campus One 體驗" schoolName={schoolName}>
      <div className="settingsLayout">
        {/* ── Sidebar ── */}
        <aside className="settingsSidebar">
          <div className="sidebarMenu">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`sidebarMenuButton${activeSection === s.id ? ' active' : ''}`}
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
