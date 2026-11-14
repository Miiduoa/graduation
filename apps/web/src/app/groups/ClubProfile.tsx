'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { loadClubProfile } from './clubProfileService';
import styles from './groups.module.css';

export function ClubProfile({
  uid,
  schoolId,
  groupId,
}: {
  uid: string;
  schoolId: string;
  groupId: string;
}) {
  const [group, setGroup] = useState<Awaited<ReturnType<typeof loadClubProfile>> | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setGroup(null);
    setError('');
    loadClubProfile(uid, schoolId, groupId).then(
      (result) => {
        if (generation.current === request) setGroup(result);
      },
      () => {
        if (generation.current === request) setError('無法讀取社團資料，請確認資格與連線後重試。');
      },
    );
    return () => {
      generation.current++;
    };
  }, [uid, schoolId, groupId, revision]);
  return (
    <section className={styles.group} aria-label="社團頁">
      <Link href={`/clubs?schoolId=${encodeURIComponent(schoolId)}`}>回我的社團</Link>
      {error ? (
        <p role="alert">{error}</p>
      ) : !group ? (
        <p role="status">正在讀取社團資料…</p>
      ) : (
        <>
          <h1 style={{ fontSize: 28 }}>{group.name}</h1>
          <p>
            類別未提供 ·{' '}
            {group.memberCount === null ? '社員數未提供' : `${group.memberCount} 位社員`} ·
            社課時間未提供
          </p>
          <button className="btn" style={{ minHeight: 44 }} disabled>
            已加入
          </button>
          <p>這是你已加入的社團群組；本頁不代表課外組已核可，也不提供入社或申請。</p>
          <section>
            <h2>近期活動</h2>
            <p>目前沒有排定的活動。</p>
            <p>此頁尚未接入社團內部活動，實際排程請向幹部確認。校園活動與社團內部活動分開管理。</p>
          </section>
          <section>
            <h2>公告</h2>
            {group.announcements.length ? (
              group.announcements.map((post) => (
                <article key={post.id}>
                  <h3>{post.title}</h3>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{post.body}</p>
                </article>
              ))
            ) : (
              <p>近期沒有公告。</p>
            )}
            <p>顯示最近 20 則討論中的最新 3 則公告。</p>
            <Link
              className="btn"
              href={`/groups/${encodeURIComponent(groupId)}?schoolId=${encodeURIComponent(schoolId)}`}
            >
              查看社團討論與更多公告
            </Link>
          </section>
          <section>
            <h2>介紹</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{group.description || '社團尚未提供介紹。'}</p>
            <p>僅供現有社員閱讀。IG、LINE 官方連結尚未提供。</p>
          </section>
          {['owner', 'admin'].includes(group.role) && <p>這所學校還沒開放社團管理。</p>}
        </>
      )}
      <button className="btn" onClick={() => setRevision((v) => v + 1)}>
        重新讀取社團資料
      </button>
    </section>
  );
}
