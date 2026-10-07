'use client';

import Link from 'next/link';
import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { type User } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { useAuth } from '@/components/AuthGuard';
import {
  defaultNotificationPreferences,
  normalizeNotificationPreferences,
} from '@campus/shared/src';

import { SiteShell } from '@/components/SiteShell';
import { useToast } from '@/components/ui';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import {
  getAuth,
  getDb,
  isFirebaseConfigured,
  saveNotificationPreferences,
  signOut,
  type NotificationPreferences,
  type UserProfile,
  updateUserProfile,
} from '@/lib/firebase';
import {
  applyWebAppearancePreferences,
  defaultThemeColor,
  defaultWebPreferences,
  readStoredWebPreferences,
  writeStoredWebPreferences,
  type FontSizePreference,
  type StoredWebPreferences,
  type ThemePreference,
} from '@/lib/webPreferences';

type Section = 'general' | 'notifications' | 'appearance' | 'privacy' | 'account';
type NotificationToggleKey =
  | 'announcements'
  | 'events'
  | 'groups'
  | 'assignments'
  | 'grades'
  | 'messages';

type ProfileFormState = {
  displayName: string;
  studentId: string;
  department: string;
  grade: string;
  phone: string;
  bio: string;
};

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'general', label: '一般', icon: '⚙️' },
  { id: 'notifications', label: '通知', icon: '🔔' },
  { id: 'appearance', label: '外觀', icon: '🎨' },
  { id: 'privacy', label: '隱私', icon: '🔒' },
  { id: 'account', label: '帳號', icon: '👤' },
];

const THEME_COLORS = [
  '#314D40',
  '#007AFF',
  '#386146',
  '#8B631E',
  '#FF6B35',
  '#BF5AF2',
  '#983F32',
  '#32ADE6',
];

function Toggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={value}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`toggle${value ? ' on' : ''}`}
      style={{
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
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
  right?: ReactNode;
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
        {subtitle ? <div className="insetGroupRowMeta">{subtitle}</div> : null}
      </div>
      {right !== undefined ? right : <span className="insetGroupRowChevron">›</span>}
    </div>
  );
}

function emptyProfileForm(user: User | null, profile?: UserProfile | null): ProfileFormState {
  return {
    displayName: profile?.displayName ?? user?.displayName ?? '',
    studentId: profile?.studentId ?? '',
    department: profile?.department ?? '',
    grade: profile?.grade ?? '',
    phone: profile?.phone ?? '',
    bio: profile?.bio ?? '',
  };
}

function profileDisplayName(user: User | null, form: ProfileFormState): string {
  const fallback = user?.displayName ?? user?.email?.split('@')[0] ?? '未登入使用者';
  return form.displayName.trim() || fallback;
}

function saveLocalPreferences(prefs: StoredWebPreferences) {
  if (typeof window === 'undefined') {
    return;
  }

  writeStoredWebPreferences(window.localStorage, prefs);
}

export default function SettingsPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string }>;
}) {
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const { schoolName, schoolSearch } = resolveSchoolPageContext(searchParams);
  const { user, loading } = useAuth();
  if (loading)
    return (
      <SiteShell title="設定" schoolName={schoolName}>
        <p role="status">確認帳號…</p>
      </SiteShell>
    );
  return (
    <SettingsContent
      key={user?.uid ?? 'guest'}
      user={user}
      schoolName={schoolName}
      schoolSearch={schoolSearch}
    />
  );
}

function SettingsContent({
  user,
  schoolName,
  schoolSearch,
}: {
  user: User | null;
  schoolName: string;
  schoolSearch: string;
}) {
  const mounted = useRef(true);
  const profileLock = useRef(false);
  const notificationLock = useRef(false);
  const [profileLoadError, setProfileLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isCurrent = useCallback(
    () => mounted.current && !!user && getAuth()?.currentUser?.uid === user.uid,
    [user],
  );
  const { success, error, info } = useToast();
  const [activeSection, setActiveSection] = useState<Section>('general');
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileFormState>(emptyProfileForm(null));
  const [generalPrefs, setGeneralPrefs] = useState(defaultWebPreferences.general);
  const [appearancePrefs, setAppearancePrefs] = useState(defaultWebPreferences.appearance);
  const [privacyPrefs, setPrivacyPrefs] = useState(defaultWebPreferences.privacy);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(
    defaultNotificationPreferences,
  );
  const [localPrefsReady, setLocalPrefsReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const stored = readStoredWebPreferences(window.localStorage);
    setGeneralPrefs(stored.general);
    setAppearancePrefs(stored.appearance);
    setPrivacyPrefs(stored.privacy);
    applyWebAppearancePreferences(document, stored.appearance);
    setLocalPrefsReady(true);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    applyWebAppearancePreferences(document, appearancePrefs);
  }, [appearancePrefs]);

  useEffect(() => {
    if (!localPrefsReady) {
      return;
    }

    saveLocalPreferences({
      general: generalPrefs,
      appearance: appearancePrefs,
      privacy: privacyPrefs,
    });
  }, [appearancePrefs, generalPrefs, localPrefsReady, privacyPrefs]);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!user) {
        if (!active) {
          return;
        }

        setProfileForm(emptyProfileForm(null));
        setNotificationPrefs(defaultNotificationPreferences);
        setLoadingProfile(false);
        return;
      }

      setLoadingProfile(true);
      setProfileLoadError('');

      try {
        if (!isFirebaseConfigured()) throw new Error('Account service is unavailable');
        const [profileDoc, prefsDoc] = await Promise.all([
          getDocFromServer(doc(getDb(), 'users', user.uid)),
          getDocFromServer(doc(getDb(), 'users', user.uid, 'settings', 'notifications')),
        ]);
        if (!active || !isCurrent()) return;
        if (!profileDoc.exists()) throw new Error('Account profile is missing');
        setProfileForm(emptyProfileForm(user, profileDoc.data() as UserProfile));
        setNotificationPrefs(
          normalizeNotificationPreferences(
            prefsDoc.exists() ? prefsDoc.data() : defaultNotificationPreferences,
          ),
        );
      } catch (loadError) {
        if (!active) {
          return;
        }

        console.error('Failed to load settings data:', loadError);
        setProfileLoadError('暫時無法讀取帳號設定。重新讀取成功後才能儲存變更。');
        setProfileForm(emptyProfileForm(user));
        setNotificationPrefs(defaultNotificationPreferences);
      } finally {
        if (active) {
          setLoadingProfile(false);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [user, loadAttempt, isCurrent]);

  const currentDisplayName = useMemo(
    () => profileDisplayName(user, profileForm),
    [profileForm, user],
  );
  const cloudEnabled =
    Boolean(user) && isFirebaseConfigured() && !loadingProfile && !profileLoadError;

  const updateProfileField = (field: keyof ProfileFormState, value: string) => {
    setProfileForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateAppearance = <K extends keyof typeof appearancePrefs>(
    key: K,
    value: (typeof appearancePrefs)[K],
  ) => {
    setAppearancePrefs((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveNotifications = async () => {
    if (!user) {
      info('請先登入後再儲存通知設定');
      return;
    }

    if (!isFirebaseConfigured()) {
      info('目前無法連線帳號服務，通知設定尚未儲存');
      return;
    }

    if (!isCurrent() || loadingProfile || profileLoadError || notificationLock.current) return;
    notificationLock.current = true;
    const expected = notificationPrefs;
    setSavingNotifications(true);

    try {
      await saveNotificationPreferences(user.uid, expected);
      if (!isCurrent()) return;
      const saved = await getDocFromServer(
        doc(getDb(), 'users', user.uid, 'settings', 'notifications'),
      );
      if (!isCurrent()) return;
      const actual = saved.exists() ? normalizeNotificationPreferences(saved.data()) : null;
      if (
        !actual ||
        JSON.stringify(actual) !== JSON.stringify(normalizeNotificationPreferences(expected))
      )
        throw new Error('Notification settings were not confirmed');
      success('通知設定已同步');
    } catch (saveError) {
      console.error('Failed to save notification settings:', saveError);
      if (isCurrent()) {
        setProfileLoadError('通知設定的儲存結果尚未確認。請重新讀取後檢查。');
        error('通知設定尚未確認', '請重新讀取後檢查，不會自動重送');
      }
    } finally {
      notificationLock.current = false;
      if (isCurrent()) setSavingNotifications(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!user) {
      info('請先登入後再儲存個人資料');
      return;
    }

    if (!isFirebaseConfigured()) {
      info('目前無法連線帳號服務，個人資料尚未儲存');
      return;
    }

    if (!isCurrent() || loadingProfile || profileLoadError || profileLock.current) return;
    profileLock.current = true;
    const expected = Object.fromEntries(
      Object.entries(profileForm).map(([key, value]) => [key, value.trim()]),
    ) as ProfileFormState;
    setSavingProfile(true);

    try {
      const result = await updateUserProfile(user.uid, expected);
      if (!isCurrent()) return;

      if (!result.success) {
        throw new Error(result.error ?? 'Unknown profile update error');
      }

      const saved = await getDocFromServer(doc(getDb(), 'users', user.uid));
      if (!isCurrent()) return;
      if (
        !saved.exists() ||
        Object.entries(expected).some(([key, value]) => saved.data()[key] !== value)
      )
        throw new Error('Profile changes were not confirmed');
      setProfileForm(emptyProfileForm(user, saved.data() as UserProfile));
      success('個人資料已更新');
    } catch (saveError) {
      console.error('Failed to save profile:', saveError);
      if (isCurrent()) {
        setProfileLoadError('個人資料的儲存結果尚未確認。請重新讀取後檢查。');
        error('個人資料尚未確認', '請重新讀取後檢查，不會自動重送');
      }
    } finally {
      profileLock.current = false;
      if (isCurrent()) setSavingProfile(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      success('已登出帳號');
    } catch (signOutError) {
      console.error('Failed to sign out:', signOutError);
      error('登出失敗', '請稍後再試一次');
    }
  };

  function renderGeneral() {
    return (
      <div className="pageStack">
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div className="sectionTitle">裝置偏好</div>
              <div className="sectionText">外觀設定會自動儲存在目前這台裝置。</div>
            </div>
            <span className="pill subtle">{localPrefsReady ? '已啟用自動儲存' : '載入中…'}</span>
          </div>
        </div>

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
              icon="🌐"
              title="介面語言"
              subtitle="繁體中文"
              right={<span className="pill subtle">目前提供</span>}
            />
          </div>
        </div>

        <div>
          <div className="insetGroupHeader">法務與支援</div>
          <div className="insetGroup">
            <Link href={`/terms${schoolSearch}`}>
              <SettingRow
                icon="📄"
                iconBg="#F3F0FF"
                title="服務條款"
                subtitle="查看目前 Web 版條款說明"
              />
            </Link>
            <Link href={`/privacy${schoolSearch}`}>
              <SettingRow
                icon="🔐"
                iconBg="#E8FFF2"
                title="隱私政策"
                subtitle="檢查資料蒐集與使用方式"
              />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  function renderNotifications() {
    const notificationRows: Array<{
      key: NotificationToggleKey;
      icon: string;
      iconBg: string;
      title: string;
      subtitle?: string;
    }> = [
      {
        key: 'announcements',
        icon: '📢',
        iconBg: '#FFF3E8',
        title: '公告',
        subtitle: '校方公告與課務更新',
      },
      {
        key: 'events',
        icon: '🎉',
        iconBg: 'var(--success-soft)',
        title: '活動',
        subtitle: '校園活動與社團行程',
      },
      {
        key: 'groups',
        icon: '💬',
        iconBg: 'var(--info-soft)',
        title: '群組',
        subtitle: '課程與社群互動通知',
      },
      {
        key: 'assignments',
        icon: '📝',
        iconBg: 'var(--warning-soft)',
        title: '作業',
        subtitle: '截止提醒與繳交更新',
      },
      {
        key: 'grades',
        icon: '📊',
        iconBg: 'var(--danger-soft)',
        title: '成績',
        subtitle: '分數公布與成績異動',
      },
      { key: 'messages', icon: '📨', iconBg: '#F3F0FF', title: '訊息', subtitle: '私訊與服務通知' },
    ];

    return (
      <div className="pageStack">
        {!user && (
          <div
            className="card"
            style={{
              display: 'grid',
              gap: 10,
              background: 'var(--warning-soft)',
              borderColor: 'var(--warning)',
            }}
          >
            <div className="sectionTitle">通知同步需要登入</div>
            <div className="sectionText">登入後即可把通知偏好儲存到你的帳號。</div>
            <div>
              <Link href={`/login${schoolSearch}`} className="btn primary">
                前往登入
              </Link>
            </div>
          </div>
        )}

        {user && !isFirebaseConfigured() && (
          <div
            className="card"
            style={{
              display: 'grid',
              gap: 10,
              background: 'var(--warning-soft)',
              borderColor: 'var(--warning)',
            }}
          >
            <div className="sectionTitle">目前無法連線帳號服務</div>
            <div className="sectionText">連線恢復後才能讀取與儲存通知設定。</div>
          </div>
        )}

        <div>
          <div className="insetGroupHeader">總開關</div>
          <div className="insetGroup">
            <SettingRow
              icon="🔔"
              iconBg={notificationPrefs.enabled ? 'rgba(37,99,235,0.12)' : 'var(--panel)'}
              title="推播通知"
              subtitle={notificationPrefs.enabled ? '接收校園系統通知' : '目前已停用所有通知'}
              right={
                <Toggle
                  label="推播通知"
                  disabled={!cloudEnabled || savingNotifications}
                  value={notificationPrefs.enabled}
                  onChange={(value) =>
                    setNotificationPrefs((prev) => ({
                      ...prev,
                      enabled: value,
                    }))
                  }
                />
              }
            />
          </div>
        </div>

        {notificationPrefs.enabled ? (
          <>
            <div>
              <div className="insetGroupHeader">通知類型</div>
              <div className="insetGroup">
                {notificationRows.map((row) => (
                  <SettingRow
                    key={row.key}
                    icon={row.icon}
                    iconBg={row.iconBg}
                    title={row.title}
                    subtitle={row.subtitle}
                    right={
                      <Toggle
                        label={row.title}
                        disabled={!cloudEnabled || savingNotifications}
                        value={notificationPrefs[row.key] as boolean}
                        onChange={(value) =>
                          setNotificationPrefs((prev) => ({
                            ...prev,
                            [row.key]: value,
                          }))
                        }
                      />
                    }
                  />
                ))}
              </div>
            </div>

            <div className="card" style={{ display: 'grid', gap: 16 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div className="sectionTitle">勿擾時段</div>
                  <div className="sectionText">在指定時段內靜音通知，但仍保留資料同步。</div>
                </div>
                <Toggle
                  label="勿擾時段"
                  disabled={!cloudEnabled || savingNotifications}
                  value={notificationPrefs.quietHoursEnabled}
                  onChange={(value) =>
                    setNotificationPrefs((prev) => ({
                      ...prev,
                      quietHoursEnabled: value,
                    }))
                  }
                />
              </div>

              <div className="grid-2">
                <label style={{ display: 'grid', gap: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>開始時間</span>
                  <input
                    className="input"
                    type="time"
                    value={notificationPrefs.quietHoursStart}
                    disabled={
                      !cloudEnabled || savingNotifications || !notificationPrefs.quietHoursEnabled
                    }
                    onChange={(event) =>
                      setNotificationPrefs((prev) => ({
                        ...prev,
                        quietHoursStart: event.target.value,
                      }))
                    }
                  />
                </label>
                <label style={{ display: 'grid', gap: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>結束時間</span>
                  <input
                    className="input"
                    type="time"
                    value={notificationPrefs.quietHoursEnd}
                    disabled={
                      !cloudEnabled || savingNotifications || !notificationPrefs.quietHoursEnabled
                    }
                    onChange={(event) =>
                      setNotificationPrefs((prev) => ({
                        ...prev,
                        quietHoursEnd: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            </div>
          </>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn primary"
            disabled={!cloudEnabled || savingNotifications}
            onClick={handleSaveNotifications}
          >
            {savingNotifications ? '同步中...' : '儲存通知設定'}
          </button>
        </div>
      </div>
    );
  }

  function renderAppearance() {
    return (
      <div className="pageStack">
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div className="sectionTitle">即時套用</div>
              <div className="sectionText">外觀設定會立即反映在這個瀏覽器，並持久保存在本機。</div>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => setAppearancePrefs(defaultWebPreferences.appearance)}
            >
              還原預設
            </button>
          </div>
        </div>

        <div>
          <div className="insetGroupHeader">主題</div>
          <div className="insetGroup">
            <SettingRow
              icon={
                appearancePrefs.theme === 'system'
                  ? '🖥️'
                  : appearancePrefs.theme === 'dark'
                    ? '🌙'
                    : '☀️'
              }
              iconBg={appearancePrefs.theme === 'dark' ? '#2C2C2E' : '#FFF8E8'}
              title="色彩模式"
              subtitle={
                appearancePrefs.theme === 'system'
                  ? '跟隨系統'
                  : appearancePrefs.theme === 'dark'
                    ? '固定深色'
                    : '固定淺色'
              }
              right={
                <div className="segmentedGroup" style={{ padding: 3, gap: 3 }}>
                  {(
                    [
                      { value: 'system', label: '系統' },
                      { value: 'light', label: '淺色' },
                      { value: 'dark', label: '深色' },
                    ] as Array<{ value: ThemePreference; label: string }>
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={appearancePrefs.theme === option.value ? 'active' : ''}
                      onClick={() => updateAppearance('theme', option.value)}
                      style={{ padding: '4px 10px', fontSize: 12 }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              }
            />
            <SettingRow
              icon="📏"
              iconBg="#F3F0FF"
              title="字級"
              subtitle="同步調整主要標題與內文尺寸"
              right={
                <div className="segmentedGroup" style={{ padding: 3, gap: 3 }}>
                  {(
                    [
                      { value: 'small', label: '小' },
                      { value: 'medium', label: '中' },
                      { value: 'large', label: '大' },
                    ] as Array<{ value: FontSizePreference; label: string }>
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={appearancePrefs.fontSize === option.value ? 'active' : ''}
                      onClick={() => updateAppearance('fontSize', option.value)}
                      style={{ padding: '4px 10px', fontSize: 12 }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              }
            />
            <SettingRow
              icon="▤"
              iconBg="#FFF8E8"
              title="緊湊模式"
              subtitle="縮小頁面間距與卡片留白"
              right={
                <Toggle
                  label="緊湊模式"
                  value={appearancePrefs.compactMode}
                  onChange={(value) => updateAppearance('compactMode', value)}
                />
              }
            />
            <SettingRow
              icon="✨"
              iconBg="#FFF0F5"
              title="動畫效果"
              subtitle="減少介面移動與轉場"
              right={
                <Toggle
                  label="動畫效果"
                  value={appearancePrefs.animations}
                  onChange={(value) => updateAppearance('animations', value)}
                />
              }
            />
          </div>
        </div>

        <div>
          <div className="insetGroupHeader">品牌主色</div>
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {THEME_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => updateAppearance('themeColor', color)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: color,
                    border:
                      appearancePrefs.themeColor === color
                        ? '3px solid var(--text)'
                        : '3px solid transparent',
                    boxShadow:
                      appearancePrefs.themeColor === color
                        ? 'var(--shadow-md)'
                        : 'var(--shadow-sm)',
                    cursor: 'pointer',
                    transition: 'box-shadow 0.2s ease, transform 0.15s ease',
                    transform: appearancePrefs.themeColor === color ? 'scale(1.15)' : 'scale(1)',
                  }}
                  title={color}
                />
              ))}
            </div>
            <div className="grid-2" style={{ marginTop: 16 }}>
              <label style={{ display: 'grid', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>自訂主色</span>
                <input
                  className="input"
                  value={appearancePrefs.themeColor}
                  onChange={(event) =>
                    updateAppearance(
                      'themeColor',
                      event.target.value.toUpperCase() || defaultThemeColor,
                    )
                  }
                  placeholder={defaultThemeColor}
                />
              </label>
              <div
                className="card"
                style={{
                  padding: 16,
                  background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand2) 100%)',
                  border: 'none',
                  color: '#fff',
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.8 }}>即時預覽</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8 }}>Campus One</div>
                <div style={{ fontSize: 13, opacity: 0.86, marginTop: 4 }}>
                  主色與字級已立即套用
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderPrivacy() {
    return (
      <section className="card" style={{ padding: 24 }}>
        <h2>隱私與個人資料</h2>
        <p className="sectionText">
          目前尚未提供個人頁公開範圍的調整。課程與訊息的存取權限依帳號及成員資格決定。
        </p>
        <Link className="btn" href={`/privacy${schoolSearch}`}>
          查看隱私政策
        </Link>
      </section>
    );
  }

  function renderAccount() {
    return (
      <div className="pageStack">
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
              fontWeight: 700,
              flexShrink: 0,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            {currentDisplayName.slice(0, 1)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{currentDisplayName}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
              {user?.email ?? '尚未登入'} · {schoolName || '靜宜大學'}
            </div>
          </div>
          <span className={`pill ${cloudEnabled ? 'success' : 'subtle'}`} style={{ fontSize: 11 }}>
            {cloudEnabled ? '帳號資料已讀取' : user ? '等待確認帳號資料' : '尚未登入'}
          </span>
        </div>

        {!user ? (
          <div className="card" style={{ display: 'grid', gap: 10 }}>
            <div className="sectionTitle">登入後可編輯個人資料</div>
            <div className="sectionText">你可以先調整外觀；登入後再編輯個人資料與通知設定。</div>
            <div>
              <Link href={`/login${schoolSearch}`} className="btn primary">
                前往登入
              </Link>
            </div>
          </div>
        ) : null}

        <div>
          <div className="insetGroupHeader">登入方式</div>
          <div className="insetGroup">
            <SettingRow
              icon="🪪"
              iconBg="#E8F4FD"
              title="PU 學號登入"
              subtitle="前往學校登入頁連結帳號"
              right={
                <span className="pill success" style={{ fontSize: 11 }}>
                  學校登入
                </span>
              }
            />
            <SettingRow
              icon="🔥"
              iconBg="var(--success-soft)"
              title="校園帳號"
              subtitle={cloudEnabled ? '目前可讀寫個人資料' : '尚未確認帳號連線'}
              right={
                <span className="pill subtle" style={{ fontSize: 11 }}>
                  {cloudEnabled ? '可用' : '受限'}
                </span>
              }
            />
          </div>
        </div>

        <div className="card" style={{ display: 'grid', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div className="sectionTitle">個人資料</div>
              <div className="sectionText">儲存後會重新讀取帳號資料，確認更新結果。</div>
            </div>
            <button
              type="button"
              className="btn primary"
              disabled={!cloudEnabled || savingProfile}
              onClick={handleSaveProfile}
            >
              {savingProfile ? '儲存中...' : '儲存資料'}
            </button>
          </div>

          <div className="grid-2">
            <label style={{ display: 'grid', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>姓名</span>
              <input
                className="input"
                value={profileForm.displayName}
                onChange={(event) => updateProfileField('displayName', event.target.value)}
                disabled={!cloudEnabled || savingProfile}
                placeholder="輸入你的姓名"
              />
            </label>
            <label style={{ display: 'grid', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>學號</span>
              <input
                className="input"
                value={profileForm.studentId}
                onChange={(event) => updateProfileField('studentId', event.target.value)}
                disabled={!cloudEnabled || savingProfile}
                placeholder="例如：B11201234"
              />
            </label>
            <label style={{ display: 'grid', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>系所</span>
              <input
                className="input"
                value={profileForm.department}
                onChange={(event) => updateProfileField('department', event.target.value)}
                disabled={!cloudEnabled || savingProfile}
                placeholder="例如：資訊工程學系"
              />
            </label>
            <label style={{ display: 'grid', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>年級</span>
              <input
                className="input"
                value={profileForm.grade}
                onChange={(event) => updateProfileField('grade', event.target.value)}
                disabled={!cloudEnabled || savingProfile}
                placeholder="例如：大三"
              />
            </label>
            <label style={{ display: 'grid', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>電話</span>
              <input
                className="input"
                value={profileForm.phone}
                onChange={(event) => updateProfileField('phone', event.target.value)}
                disabled={!cloudEnabled || savingProfile}
                placeholder="例如：0912-345-678"
              />
            </label>
            <label style={{ display: 'grid', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>Email</span>
              <input className="input" value={user?.email ?? ''} disabled />
            </label>
          </div>

          <label style={{ display: 'grid', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>自我介紹</span>
            <textarea
              className="input"
              value={profileForm.bio}
              onChange={(event) => updateProfileField('bio', event.target.value)}
              disabled={!cloudEnabled || savingProfile}
              placeholder="介紹你的研究方向、興趣或目前專案"
              style={{ minHeight: 120, paddingTop: 14, paddingBottom: 14, resize: 'vertical' }}
            />
          </label>
        </div>

        <div>
          <div className="insetGroupHeader">登出</div>
          <div className="insetGroup">
            <SettingRow
              icon="🚪"
              iconBg="var(--danger-soft)"
              title="登出"
              subtitle="清除此瀏覽器中的登入會話"
              danger
              right={null}
              onClick={user ? handleSignOut : undefined}
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
  };

  return (
    <SiteShell title="設定" subtitle="調整外觀、通知與個人資料。" schoolName={schoolName}>
      {profileLoadError && (
        <section className="card" role="alert">
          <p>{profileLoadError}</p>
          <button className="btn" onClick={() => setLoadAttempt((value) => value + 1)}>
            重新讀取帳號設定
          </button>
        </section>
      )}
      <div className="settingsLayout">
        <aside className="settingsSidebar">
          <div className="sidebarMenu">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`sidebarMenuButton${activeSection === section.id ? ' active' : ''}`}
                onClick={() => setActiveSection(section.id)}
              >
                <span style={{ fontSize: 18 }}>{section.icon}</span>
                {section.label}
              </button>
            ))}
          </div>
        </aside>

        <div>{contentMap[activeSection]()}</div>
      </div>
    </SiteShell>
  );
}
