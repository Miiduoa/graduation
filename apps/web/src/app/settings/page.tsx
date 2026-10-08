'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  defaultWebPreferences,
  readStoredWebPreferences,
  writeStoredWebPreferences,
  webPreferencesStorageKey,
  type FontSizePreference,
  type StoredWebPreferences,
  type ThemePreference,
} from '@/lib/webPreferences';
import styles from './settings.module.css';

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

const SECTIONS: { id: Section; label: string; description: string }[] = [
  { id: 'general', label: '一般', description: '校園與服務資訊' },
  { id: 'account', label: '帳號', description: '個人資料與登入' },
  { id: 'notifications', label: '通知', description: '接收類型與勿擾時段' },
  { id: 'appearance', label: '外觀', description: '色彩、字級與閱讀方式' },
  { id: 'privacy', label: '隱私', description: '個人資料與存取範圍' },
];

const THEME_COLORS = [
  { value: '#314D40', label: '森林綠' },
  { value: '#41646A', label: '湖水藍' },
  { value: '#8B631E', label: '茶褐色' },
  { value: '#983F32', label: '磚紅色' },
  { value: '#665770', label: '暮紫色' },
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
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={styles.toggle}
    >
      <span />
    </button>
  );
}

function SettingRow({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className={styles.control}>{children}</div>
    </div>
  );
}

function SectionHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.sectionHeading}>
      <h2>{title}</h2>
      <p>{children}</p>
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
  const fallback = user?.displayName ?? user?.email?.split('@')[0] ?? '訪客';
  return form.displayName.trim() || fallback;
}

function saveLocalPreferences(prefs: StoredWebPreferences) {
  try {
    const raw = JSON.stringify(prefs);
    if (window.localStorage.getItem(webPreferencesStorageKey) !== raw) {
      writeStoredWebPreferences(window.localStorage, prefs);
    }
    return true;
  } catch {
    return false;
  }
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
  const signOutLock = useRef(false);
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
  const [signingOut, setSigningOut] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileFormState>(emptyProfileForm(null));
  const [generalPrefs, setGeneralPrefs] = useState(defaultWebPreferences.general);
  const [appearancePrefs, setAppearancePrefs] = useState(defaultWebPreferences.appearance);
  const [privacyPrefs, setPrivacyPrefs] = useState(defaultWebPreferences.privacy);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(
    defaultNotificationPreferences,
  );
  const [localPrefsReady, setLocalPrefsReady] = useState(false);
  const [localPrefsSaved, setLocalPrefsSaved] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const load = () => {
      let stored = defaultWebPreferences;
      try {
        stored = readStoredWebPreferences(window.localStorage);
      } catch {
        setLocalPrefsSaved(false);
      }
      setGeneralPrefs(stored.general);
      setAppearancePrefs(stored.appearance);
      setPrivacyPrefs(stored.privacy);
      setLocalPrefsReady(true);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === webPreferencesStorageKey) load();
    };
    load();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!localPrefsReady) {
      return;
    }

    applyWebAppearancePreferences(document, appearancePrefs);
  }, [appearancePrefs, localPrefsReady]);

  useEffect(() => {
    if (!localPrefsReady) {
      return;
    }

    setLocalPrefsSaved(
      saveLocalPreferences({
        general: generalPrefs,
        appearance: appearancePrefs,
        privacy: privacyPrefs,
      }),
    );
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
    Boolean(user) && isFirebaseConfigured() && !loadingProfile && !profileLoadError && !signingOut;

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

    if (
      !isCurrent() ||
      loadingProfile ||
      profileLoadError ||
      notificationLock.current ||
      signOutLock.current
    )
      return;
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

    if (
      !isCurrent() ||
      loadingProfile ||
      profileLoadError ||
      profileLock.current ||
      signOutLock.current
    )
      return;
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
    if (!user || !isCurrent() || signOutLock.current) return;
    signOutLock.current = true;
    setSigningOut(true);
    try {
      await signOut();
      if (mounted.current && !getAuth()?.currentUser) success('已登出帳號');
    } catch (signOutError) {
      console.error('Failed to sign out:', signOutError);
      if (isCurrent()) error('登出失敗', '請稍後再試一次');
    } finally {
      signOutLock.current = false;
      if (mounted.current) setSigningOut(false);
    }
  };

  function renderGeneral() {
    return (
      <div className={styles.stack}>
        <SectionHeading title="一般設定">查看目前校園與服務資訊。</SectionHeading>
        <section className={styles.group} aria-label="校園與語言">
          <SettingRow title="目前校園" subtitle={schoolName}>
            <span className={styles.value}>校園服務</span>
          </SettingRow>
          <SettingRow title="介面語言" subtitle="目前以繁體中文提供服務。">
            <span className={styles.value}>繁體中文</span>
          </SettingRow>
          <SettingRow title="此瀏覽器的外觀" subtitle="色彩、字級與閱讀偏好會保留在這個瀏覽器。">
            <button type="button" className="btn" onClick={() => setActiveSection('appearance')}>
              調整外觀
            </button>
          </SettingRow>
        </section>
        <section aria-labelledby="service-information">
          <h3 className={styles.groupHeading} id="service-information">
            服務資訊
          </h3>
          <div className={styles.group}>
            <Link href={`/terms${schoolSearch}`} className={styles.linkRow}>
              <span>
                <strong>服務條款</strong>
                <span>服務範圍與帳號使用約定</span>
              </span>
              <span aria-hidden="true">↗</span>
            </Link>
            <Link href={`/privacy${schoolSearch}`} className={styles.linkRow}>
              <span>
                <strong>隱私政策</strong>
                <span>資料蒐集、使用與保存方式</span>
              </span>
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </section>
      </div>
    );
  }

  function renderNotifications() {
    const notificationRows: Array<{
      key: NotificationToggleKey;
      title: string;
      subtitle: string;
    }> = [
      { key: 'announcements', title: '公告', subtitle: '校方公告與課務更新' },
      { key: 'events', title: '活動', subtitle: '校園活動與社團行程' },
      { key: 'groups', title: '群組', subtitle: '課程與社群互動' },
      { key: 'assignments', title: '作業', subtitle: '截止提醒與繳交更新' },
      { key: 'grades', title: '成績', subtitle: '分數公布與成績異動' },
      { key: 'messages', title: '訊息', subtitle: '私訊與服務通知' },
    ];
    return (
      <div className={styles.stack}>
        <SectionHeading title="通知設定">選擇要接收的內容，儲存到你的帳號。</SectionHeading>
        {!user && (
          <div className={styles.notice}>
            <h3>登入後設定通知</h3>
            <p>通知偏好會跟著帳號保留。</p>
            <Link href={`/login${schoolSearch}`} className="btn primary">
              前往登入
            </Link>
          </div>
        )}
        {user && !isFirebaseConfigured() && (
          <div className={styles.notice} role="status">
            <h3>目前無法連線帳號服務</h3>
            <p>連線恢復後才能讀取與儲存通知設定。</p>
          </div>
        )}
        <div className={styles.group}>
          <SettingRow
            title="推播通知"
            subtitle="設定帳號的通知偏好；裝置是否收到推播，也取決於系統通知權限。"
          >
            <Toggle
              label="推播通知"
              disabled={!cloudEnabled || savingNotifications}
              value={notificationPrefs.enabled}
              onChange={(enabled) => setNotificationPrefs((prev) => ({ ...prev, enabled }))}
            />
          </SettingRow>
        </div>
        {notificationPrefs.enabled && (
          <>
            <section aria-labelledby="notification-types">
              <h3 className={styles.groupHeading} id="notification-types">
                通知類型
              </h3>
              <div className={styles.group}>
                {notificationRows.map((row) => (
                  <SettingRow key={row.key} title={row.title} subtitle={row.subtitle}>
                    <Toggle
                      label={row.title}
                      disabled={!cloudEnabled || savingNotifications}
                      value={notificationPrefs[row.key]}
                      onChange={(value) =>
                        setNotificationPrefs((prev) => ({ ...prev, [row.key]: value }))
                      }
                    />
                  </SettingRow>
                ))}
              </div>
            </section>
            <section className={styles.group} aria-label="勿擾時段">
              <SettingRow title="勿擾時段" subtitle="在指定時段暫停推播提醒。">
                <Toggle
                  label="勿擾時段"
                  disabled={!cloudEnabled || savingNotifications}
                  value={notificationPrefs.quietHoursEnabled}
                  onChange={(quietHoursEnabled) =>
                    setNotificationPrefs((prev) => ({ ...prev, quietHoursEnabled }))
                  }
                />
              </SettingRow>
              <div className={styles.timeFields}>
                <label className={styles.field}>
                  <span>開始時間</span>
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
                <label className={styles.field}>
                  <span>結束時間</span>
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
              <p className={styles.groupNote}>依通知服務使用的台北時間（UTC+8）計算。</p>
            </section>
          </>
        )}
        <div className={styles.actions}>
          <p>變更後請儲存，才會更新帳號偏好。</p>
          <button
            type="button"
            className="btn primary"
            disabled={!cloudEnabled || savingNotifications}
            onClick={handleSaveNotifications}
          >
            {savingNotifications ? '儲存中…' : '儲存通知設定'}
          </button>
        </div>
      </div>
    );
  }

  function renderAppearance() {
    return (
      <div className={styles.stack}>
        <SectionHeading title="外觀設定">調整適合你的閱讀方式，所有頁面會一起套用。</SectionHeading>
        <div className={styles.savedNotice} role="status">
          <span>
            {!localPrefsReady
              ? '正在讀取外觀設定…'
              : localPrefsSaved
                ? '變更會自動儲存在此瀏覽器'
                : '目前無法儲存外觀設定'}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => setAppearancePrefs(defaultWebPreferences.appearance)}
          >
            還原預設
          </button>
        </div>
        <div className={styles.group}>
          <SettingRow title="色彩模式" subtitle="可跟隨裝置的明暗設定。">
            <div className={styles.segmented} role="group" aria-label="色彩模式">
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
                  aria-pressed={appearancePrefs.theme === option.value}
                  onClick={() => updateAppearance('theme', option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </SettingRow>
          <SettingRow title="字級" subtitle="一起調整標題與內文大小。">
            <div className={styles.segmented} role="group" aria-label="字級">
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
                  aria-pressed={appearancePrefs.fontSize === option.value}
                  onClick={() => updateAppearance('fontSize', option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </SettingRow>
          <SettingRow title="緊湊模式" subtitle="減少頁面間距與卡片留白。">
            <Toggle
              label="緊湊模式"
              value={appearancePrefs.compactMode}
              onChange={(value) => updateAppearance('compactMode', value)}
            />
          </SettingRow>
          <SettingRow
            title="動畫效果"
            subtitle="關閉後減少移動與轉場；也會尊重裝置的減少動態設定。"
          >
            <Toggle
              label="動畫效果"
              value={appearancePrefs.animations}
              onChange={(value) => updateAppearance('animations', value)}
            />
          </SettingRow>
        </div>
        <section aria-labelledby="accent-color">
          <h3 className={styles.groupHeading} id="accent-color">
            重點色彩
          </h3>
          <div className={styles.colorPanel}>
            <div className={styles.swatches} role="group" aria-label="重點色彩">
              {THEME_COLORS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={styles.swatch}
                  aria-label={`選擇${label}`}
                  aria-pressed={appearancePrefs.themeColor === value}
                  onClick={() => updateAppearance('themeColor', value)}
                  style={{ background: value }}
                  title={label}
                >
                  {appearancePrefs.themeColor === value && <span aria-hidden="true">✓</span>}
                </button>
              ))}
              <label className={styles.customColor}>
                <span>自訂色彩</span>
                <input
                  type="color"
                  value={appearancePrefs.themeColor}
                  onChange={(event) =>
                    updateAppearance('themeColor', event.target.value.toUpperCase())
                  }
                />
              </label>
            </div>
            <div className={styles.preview}>
              <span className={styles.previewLabel}>色彩預覽</span>
              <strong>Campus One</strong>
              <p>色彩會依明暗模式調整，讓文字保持清楚。</p>
              <span className={styles.previewAccent}>你的校園日常</span>
            </div>
          </div>
        </section>
      </div>
    );
  }

  function renderPrivacy() {
    return (
      <div className={styles.stack}>
        <SectionHeading title="隱私與個人資料">了解哪些資料可以修改，以及誰能存取。</SectionHeading>
        <div className={styles.group}>
          <SettingRow
            title="個人資料"
            subtitle="姓名、學號與系所由你自行填寫，不會因此取得學校或課程權限。"
          >
            <button type="button" className="btn" onClick={() => setActiveSection('account')}>
              查看資料
            </button>
          </SettingRow>
          <SettingRow
            title="課程與訊息"
            subtitle="存取範圍依帳號與成員資格決定。目前未提供個人頁公開範圍的調整。"
          >
            <span className={styles.value}>依成員資格</span>
          </SettingRow>
          <SettingRow
            title="此瀏覽器的偏好"
            subtitle="外觀設定只儲存在目前瀏覽器，其他裝置需個別設定。"
          >
            <span className={styles.value}>本機保存</span>
          </SettingRow>
        </div>
        <div>
          <Link className="btn" href={`/privacy${schoolSearch}`}>
            查看隱私政策
          </Link>
        </div>
      </div>
    );
  }

  function renderAccount() {
    const providerIds = user?.providerData?.map((provider) => provider.providerId) ?? [];
    const loginMethod = providerIds.includes('google.com')
      ? 'Google 帳號'
      : providerIds.includes('password')
        ? '電子郵件與密碼'
        : providerIds.some((provider) => provider.startsWith('saml.'))
          ? '學校單一登入'
          : user
            ? '已登入校園帳號'
            : '尚未登入';
    return (
      <div className={styles.stack}>
        <SectionHeading title="帳號設定">更新個人資料，管理此瀏覽器的登入狀態。</SectionHeading>
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">
            {user ? Array.from(currentDisplayName)[0] : '—'}
          </span>
          <div>
            <h3>{currentDisplayName}</h3>
            <p>{user?.email ?? '登入後可管理個人資料'}</p>
          </div>
          <span className={styles.accountStatus}>
            {signingOut ? '正在登出' : cloudEnabled ? '資料已讀取' : user ? '等待讀取資料' : '訪客'}
          </span>
        </div>
        {!user && (
          <div className={styles.notice}>
            <h3>登入後可編輯個人資料</h3>
            <p>你可以先調整外觀；登入後再編輯個人資料與通知設定。</p>
            <Link href={`/login${schoolSearch}`} className="btn primary">
              前往登入
            </Link>
          </div>
        )}
        <div className={styles.group}>
          <SettingRow title="登入方式" subtitle={loginMethod}>
            <span className={styles.value}>{user ? '目前帳號' : '尚未登入'}</span>
          </SettingRow>
        </div>
        <form
          className={styles.profileForm}
          onSubmit={(event) => {
            event.preventDefault();
            void handleSaveProfile();
          }}
        >
          <div>
            <h3 className={styles.groupHeading}>個人資料</h3>
            <p className={styles.description}>
              學號、系所與年級是你提供的資料；課程與成績仍以學校紀錄為準。
            </p>
          </div>
          <div className={styles.fields}>
            <label className={styles.field}>
              <span>姓名</span>
              <input
                className="input"
                autoComplete="name"
                value={profileForm.displayName}
                onChange={(event) => updateProfileField('displayName', event.target.value)}
                disabled={!cloudEnabled || savingProfile}
                placeholder="你的姓名"
              />
            </label>
            <label className={styles.field}>
              <span>學號</span>
              <input
                className="input"
                value={profileForm.studentId}
                onChange={(event) => updateProfileField('studentId', event.target.value)}
                disabled={!cloudEnabled || savingProfile}
                placeholder="你的學號"
              />
            </label>
            <label className={styles.field}>
              <span>系所</span>
              <input
                className="input"
                value={profileForm.department}
                onChange={(event) => updateProfileField('department', event.target.value)}
                disabled={!cloudEnabled || savingProfile}
                placeholder="就讀系所"
              />
            </label>
            <label className={styles.field}>
              <span>年級</span>
              <input
                className="input"
                value={profileForm.grade}
                onChange={(event) => updateProfileField('grade', event.target.value)}
                disabled={!cloudEnabled || savingProfile}
                placeholder="目前年級"
              />
            </label>
            <label className={styles.field}>
              <span>電話</span>
              <input
                className="input"
                type="tel"
                autoComplete="tel"
                value={profileForm.phone}
                onChange={(event) => updateProfileField('phone', event.target.value)}
                disabled={!cloudEnabled || savingProfile}
                placeholder="聯絡電話（選填）"
              />
            </label>
            <label className={styles.field}>
              <span>電子郵件</span>
              <input className="input" type="email" value={user?.email ?? ''} disabled />
            </label>
          </div>
          <label className={styles.field}>
            <span>自我介紹</span>
            <textarea
              className="input"
              value={profileForm.bio}
              onChange={(event) => updateProfileField('bio', event.target.value)}
              disabled={!cloudEnabled || savingProfile}
              placeholder="分享你的興趣或目前在做的事（選填）"
            />
          </label>
          <div className={styles.actions}>
            <p>確認儲存成功後，變更才會套用至帳號。</p>
            <button type="submit" className="btn primary" disabled={!cloudEnabled || savingProfile}>
              {savingProfile ? '儲存中…' : '儲存資料'}
            </button>
          </div>
        </form>
        {user && (
          <div className={styles.signOut}>
            <div>
              <h3>登出此瀏覽器</h3>
              <p>下次使用帳號服務時，需要重新登入。</p>
            </div>
            <button
              type="button"
              className={`btn ${styles.signOutButton}`}
              onClick={() => void handleSignOut()}
              disabled={signingOut || savingProfile || savingNotifications}
            >
              {signingOut ? '登出中…' : '登出帳號'}
            </button>
          </div>
        )}
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
    <SiteShell title="設定" subtitle="讓校園生活，照你的習慣安排。" schoolName={schoolName}>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <nav aria-label="設定分類" className={styles.navigation}>
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                aria-label={section.label}
                aria-current={activeSection === section.id ? 'page' : undefined}
                aria-controls="settings-section"
                onClick={() => setActiveSection(section.id)}
              >
                <strong>{section.label}</strong>
                <span>{section.description}</span>
              </button>
            ))}
          </nav>
          <Link className={styles.profileLink} href="/profile">
            返回個人資料 <span aria-hidden="true">↗</span>
          </Link>
        </aside>
        <div className={styles.content} id="settings-section">
          {!localPrefsSaved && (
            <p role="alert" className={styles.notice}>
              此瀏覽器無法儲存外觀設定，這次調整只會保留到關閉頁面。
            </p>
          )}
          {profileLoadError && (
            <section className={styles.notice} role="alert">
              <p>{profileLoadError}</p>
              <button className="btn" onClick={() => setLoadAttempt((value) => value + 1)}>
                重新讀取帳號設定
              </button>
            </section>
          )}
          {contentMap[activeSection]()}
        </div>
      </div>
    </SiteShell>
  );
}
