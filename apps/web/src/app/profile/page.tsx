'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { useAuth } from '@/components/AuthGuard';
import { SiteShell } from '@/components/SiteShell';
import { getAuth, getDb } from '@/lib/firebase';
import styles from './profile.module.css';

type Profile = Partial<
  Record<'displayName' | 'studentId' | 'department' | 'grade' | 'phone' | 'bio', string>
>;
type ProfileState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; profile: Profile | null };

function readProfile(data: Record<string, unknown>): Profile {
  const profile: Profile = {};
  for (const key of ['displayName', 'studentId', 'department', 'grade', 'phone', 'bio'] as const) {
    if (typeof data[key] === 'string') profile[key] = data[key].trim();
  }
  return profile;
}

function PersonalProfile({ user }: { user: User }) {
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
      } catch {
        if (current()) setState({ status: 'error' });
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
        <p>請確認網路後再試一次。這次未取得資料。</p>
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
          <p className={styles.label}>Campus One 帳號</p>
          <h2>{displayName}</h2>
        </div>
        <Link href="/settings" className="btn">
          帳號設定
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

const services = [
  { href: '/timetable', label: '我的課表', description: '查看學校提供的上課時間與教室。' },
  { href: '/grades', label: '成績紀錄', description: '查詢學期成績與原始紀錄。' },
  { href: '/credit-planner', label: '學分規劃', description: '整理修課紀錄與接下來的計畫。' },
  { href: '/library', label: '圖書館', description: '查找館藏，前往學校借閱帳號。' },
];

export default function ProfilePage() {
  const { user, loading, error } = useAuth();
  return (
    <SiteShell title="個人資料" subtitle="管理你的帳號，接著處理課務與校園生活。">
      <div className={styles.layout}>
        {loading ? (
          <div className={styles.panel} role="status">
            正在確認帳號…
          </div>
        ) : user ? (
          <PersonalProfile key={user.uid} user={user} />
        ) : (
          <section className={styles.panel}>
            <h2>{error ? '暫時無法確認帳號' : '登入後，查看你的資料'}</h2>
            <p>使用你的學校帳號，查看個人資料與校務紀錄。</p>
            <Link className="btn primary" href="/login?returnUrl=%2Fprofile">
              登入帳號
            </Link>
          </section>
        )}
        <section className={styles.services} aria-labelledby="personal-services">
          <h2 id="personal-services">我的校園生活</h2>
          <div className={styles.links}>
            {services.map(({ href, label, description }) => (
              <Link key={href} href={href} className={styles.service}>
                <span>
                  <strong>{label}</strong>
                  <span className={styles.description}>{description}</span>
                </span>
                <span aria-hidden="true">↗</span>
              </Link>
            ))}
          </div>
          <Link className={styles.settings} href="/settings">
            外觀與通知設定 →
          </Link>
        </section>
      </div>
    </SiteShell>
  );
}
