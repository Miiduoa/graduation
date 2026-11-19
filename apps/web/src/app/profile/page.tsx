'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { useAuth } from '@/components/AuthGuard';
import { SiteShell } from '@/components/SiteShell';
import { NuniAccountPanel } from '@/components/NuniAccountPanel';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { useNuniSession } from '@/features/nuni/Session';
import { getAuth, getDb } from '@/lib/firebase';
import { useSignInOptions } from '@/lib/signInOptions';
import { loadFailureCopy } from '@campus/shared/src/loadFailureCopy';
import { loginHref, schoolLoginHref } from '@/lib/navigation';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import { MySocialProfile } from './MySocialProfile';
import styles from './profile.module.css';

type Profile = Partial<
  Record<'displayName' | 'studentId' | 'department' | 'grade' | 'phone' | 'bio', string>
>;
type ProfileState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; profile: Profile | null };

function readProfile(data: Record<string, unknown>): Profile {
  const profile: Profile = {};
  for (const key of ['displayName', 'studentId', 'department', 'grade', 'phone', 'bio'] as const) {
    if (typeof data[key] === 'string') profile[key] = data[key].trim();
  }
  return profile;
}

function PersonalProfile({ user, navigationSearch }: { user: User; navigationSearch: string }) {
  const [state, setState] = useState<ProfileState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const current = () => active && getAuth()?.currentUser?.uid === user.uid;
    async function load() {
      try {
        const db = getDb();
        if (!db) throw new Error('Account service unavailable');
        const snapshot = await getDocFromServer(doc(db, 'users', user.uid));
        if (current())
          setState({
            status: 'ready',
            profile: snapshot.exists() ? readProfile(snapshot.data()) : null,
          });
      } catch (error) {
        if (current()) setState({ status: 'error', error });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [user.uid, attempt]);

  if (state.status === 'loading')
    return (
      <div className={styles.panel} role="status">
        正在讀取個人資料…
      </div>
    );
  if (state.status === 'error')
    return (
      <section className={styles.panel} role="alert">
        <h2>暫時無法讀取個人資料</h2>
        <p>{loadFailureCopy(state.error, { online: navigator.onLine })}。這次未取得資料。</p>
        <button
          className="btn primary"
          onClick={() => {
            setState({ status: 'loading' });
            setAttempt((value) => value + 1);
          }}
        >
          重新讀取
        </button>
      </section>
    );
  const profile = state.profile;
  const displayName = profile?.displayName || user.displayName || '我的帳號';
  return (
    <section className={styles.panel} aria-label="帳號資料">
      <div className={styles.identity}>
        <span className={styles.avatar} aria-hidden="true">
          {Array.from(displayName)[0]}
        </span>
        <div>
          <p className={styles.label}>學校帳號個人資料</p>
          <h2>{displayName}</h2>
        </div>
        <Link href={campusServiceHref('/settings?section=account', navigationSearch)} className="btn">
          編輯個人資料
        </Link>
      </div>
      {!profile && <p>尚未填寫個人資料，可以到帳號設定補上。</p>}
      <dl className={styles.details}>
        {[
          ['電子郵件', user.email],
          ['學號', profile?.studentId],
          ['系所', profile?.department],
          ['年級', profile?.grade],
          ['電話', profile?.phone],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || '未提供'}</dd>
          </div>
        ))}
      </dl>
      {profile?.bio && (
        <div className={styles.bio}>
          <h3>關於我</h3>
          <p>{profile.bio}</p>
        </div>
      )}
      <p className={styles.note}>學號、系所與年級是你填寫的資料；課程與成績請以學校紀錄為準。</p>
    </section>
  );
}

type PersonalService = { href: string; label: string; description: string };

function PersonalServiceLink({ service, navigationSearch }: { service: PersonalService; navigationSearch: string }) {
  return (
    <Link href={campusServiceHref(service.href, navigationSearch)} className={styles.service}>
      <span>
        <strong>{service.label}</strong>
        <span className={styles.description}>{service.description}</span>
      </span>
      <span aria-hidden="true">→</span>
    </Link>
  );
}

export default function ProfilePage() {
  const { user, loading, error } = useAuth();
  const nuni = useNuniSession();
  const selection = useOptionalSelectedSchool();
  const params = useSearchParams();
  const campusSearch = useCampusNavigationSearch(params);
  const href = (path: string) => campusServiceHref(path, campusSearch);
  const profileReturn = href('/profile');
  const options = useSignInOptions(selection?.selectedSchoolId, !selection || !selection.loading);
  const hasCourseAccount = !nuni.loading && !nuni.pendingLogout && !nuni.error && !!nuni.session;
  const hasSchoolAccount = !loading && !error && !!user;
  const needsSignIn = !loading && !user && !nuni.loading && !nuni.session && !nuni.error && !nuni.pendingLogout;
  const services: PersonalService[] = [
    { href: '/timetable', label: '我的課表', description: '查看上課時間與教室，整理自己的課表。' },
    ...(hasSchoolAccount ? [
      { href: '/community/me', label: '我的社群頁', description: '整理公開貼文、媒體與私人收藏。' },
      { href: '/grades?tab=semester', label: '成績紀錄', description: '查詢學期成績與原始紀錄。' },
      { href: '/credit-planner', label: '學分規劃', description: '整理修課紀錄與接下來的計畫。' },
    ] : hasCourseAccount ? [
      { href: '/grades?tab=feedback', label: '課堂成績與回饋', description: '查看已加入課程的作業、測驗與老師評語。' },
      { href: '/import?kind=grades', label: '匯入成績', description: '整理自己保存的成績紀錄。' },
    ] : [
      { href: '/import?kind=grades', label: '匯入成績', description: '從文字、截圖或檔案整理自己的紀錄。' },
    ]),
    { href: '/library', label: '圖書館', description: '查找館藏，前往學校借閱帳號。' },
  ];
  const preferences: PersonalService[] = [
    ...(hasSchoolAccount || hasCourseAccount ? [
      { href: '/settings?section=assistant', label: 'AI 助理權限', description: '選擇助理可以代你執行的動作。' },
    ] : []),
    ...(hasCourseAccount ? [
      { href: '/settings?section=platform', label: '平台服務權限', description: '管理 Google 帳號的課務、社群與生活服務。' },
    ] : []),
    ...(hasSchoolAccount ? [
      { href: '/settings?section=notifications', label: '通知偏好', description: '選擇通知類型與勿擾時段。' },
    ] : []),
    { href: '/settings?section=appearance', label: '外觀與閱讀', description: '調整深色模式、字級與動態效果。' },
    { href: '/settings?section=privacy', label: '隱私與資料', description: '查看個人資料的使用與存取範圍。' },
  ];
  return (
    <SiteShell title="我的" subtitle="管理你的資料、帳號連線與使用偏好。">
      <nav className={styles.sectionNavigation} aria-label="個人中心分區">
        <a href="#profile-personal">個人資料</a>
        <a href="#profile-connections">帳號與連線</a>
        <a href="#profile-preferences">偏好與權限</a>
      </nav>
      <Link href={href('/student-card')} className={styles.studentCard}>
        <span>
          <strong>數位學生證</strong>
          <span className={styles.description}>
            {hasSchoolAccount ? '出示卡片、學號與證件資訊。' : '查看校方證件入口；個人卡片需學校帳號。'}
          </span>
        </span>
        <span className={styles.cardAction}>開啟 <span aria-hidden="true">→</span></span>
      </Link>
      <div className={styles.layout}>
        <div className={styles.accountStack}>
          <section id="profile-personal" className={styles.section} aria-labelledby="profile-personal-title">
            <h2 id="profile-personal-title" className={styles.sectionTitle}>個人資料</h2>
            {loading ? (
              <div className={styles.panel} role="status">正在確認帳號…</div>
            ) : user ? (
              <>
                <PersonalProfile key={`profile:${user.uid}`} user={user} navigationSearch={campusSearch} />
                <MySocialProfile key={`social:${user.uid}`} uid={user.uid} name={user.displayName?.trim() || '我的帳號'} navigationSearch={campusSearch} />
              </>
            ) : error ? (
              <section className={styles.panel}>
                <h3>暫時無法確認學校帳號</h3>
                <p>{loadFailureCopy(error, { online: navigator.onLine })}。</p>
              </section>
            ) : hasCourseAccount ? (
              <section className={styles.socialAccess}>
                <h3>我的公開交流</h3>
                <p>使用目前的 Google 帳號參與跨校話題。帳號資料與學校資格可在下方查看。</p>
                <Link className="btn primary" href={href('/social')}>前往跨校交流</Link>
              </section>
            ) : needsSignIn ? (
              <section className={styles.panel}>
                <h3>登入後，查看你的資料</h3>
                <p>用同一個帳號接續課程與公開交流，並管理自己的服務權限。課表匯入與外觀設定可以先使用。</p>
                <Link className="btn primary" href={href(loginHref(profileReturn))}>登入帳號</Link>
              </section>
            ) : (
              <p className={styles.sectionDescription}>帳號確認完成後，會顯示你的資料與常用入口。</p>
            )}
          </section>
          <section id="profile-connections" className={styles.section} aria-labelledby="profile-connections-title">
            <h2 id="profile-connections-title" className={styles.sectionTitle}>帳號與連線</h2>
            <NuniAccountPanel />
            {!loading && user ? (
              <section className={styles.panel}>
                <h3>學校帳號已登入</h3>
                <p>個人校務紀錄使用目前的學校帳號，課程與店家服務依各自資格提供。</p>
                <div className={styles.connectionActions}>
                  <Link className="btn" href={href('/settings?section=account')}>管理學校帳號</Link>
                  {!nuni.loading && !nuni.error && !nuni.pendingLogout && !nuni.session && (
                    <Link className="btn" href={href(loginHref(profileReturn))}>連線 Google 帳號</Link>
                  )}
                </div>
              </section>
            ) : !loading && !error && options.loading ? (
              <p role="status">正在確認學校登入方式…</p>
            ) : !loading && !error && options.error ? (
              <section className={styles.panel} role="alert">
                <h3>暫時無法確認學校登入方式</h3>
                <button type="button" className="btn" onClick={options.retry}>重新確認</button>
              </section>
            ) : !loading && !error && options.studentId ? (
              <section className={styles.panel}>
                <h3>連線學校帳號，查看學校資料</h3>
                <p>需要校務個人紀錄時，再使用學校帳號驗證。</p>
                <Link className="btn" href={href(schoolLoginHref(profileReturn))}>連線學校帳號</Link>
              </section>
            ) : needsSignIn ? (
              <p className={styles.sectionDescription}>Google 帳號可使用課程與公開交流。需要學校資料時，再依學校開放的方式連線。</p>
            ) : null}
          </section>
        </div>
        <div className={styles.sideStack}>
          <section className={styles.services} aria-labelledby="personal-services">
            <h2 id="personal-services">常用入口</h2>
            <div className={styles.links}>
              {services.map((service) => <PersonalServiceLink key={service.href} service={service} navigationSearch={campusSearch} />)}
            </div>
          </section>
          <section id="profile-preferences" className={styles.section} aria-labelledby="profile-preferences-title">
            <h2 id="profile-preferences-title" className={styles.sectionTitle}>偏好與權限</h2>
            <div className={styles.links}>
              {preferences.map((service) => <PersonalServiceLink key={service.href} service={service} navigationSearch={campusSearch} />)}
            </div>
            <Link className={styles.settings} href={href('/settings')}>所有設定 →</Link>
          </section>
        </div>
      </div>
    </SiteShell>
  );
}
