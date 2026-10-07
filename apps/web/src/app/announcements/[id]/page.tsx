'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { findSchoolById, findSchoolsByCode } from '@campus/shared/src/schools';
import { useAuth } from '@/components/AuthGuard';
import { SiteShell } from '@/components/SiteShell';
import type { Announcement } from '@/lib/firebase';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { loadAnnouncement } from '../publicAnnouncements';
import styles from '../announcements.module.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; announcement: Announcement | null };

function AnnouncementDetail({ schoolId, id }: { schoolId: string; id: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const mounted = useRef(false);
  const load = useCallback(() => {
    const request = ++generation.current;
    return loadAnnouncement(schoolId, id).then(
      (announcement) => {
        if (mounted.current && request === generation.current) {
          setState({ status: 'ready', announcement });
        }
      },
      () => {
        if (mounted.current && request === generation.current) setState({ status: 'error' });
      },
    );
  }, [schoolId, id]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [load]);

  function refresh() {
    setState({ status: 'loading' });
    setNotice('');
    void load();
  }

  async function copyLink() {
    const request = generation.current;
    const url = new URL(`/announcements/${encodeURIComponent(id)}`, window.location.origin);
    url.searchParams.set('schoolId', schoolId);
    setNotice('');
    try {
      await navigator.clipboard.writeText(url.href);
      if (mounted.current && request === generation.current) setNotice('已複製公告連結。');
    } catch {
      if (mounted.current && request === generation.current)
        setNotice('複製失敗，請從網址列複製連結。');
    }
  }

  if (state.status === 'loading')
    return (
      <p className={styles.status} role="status">
        正在讀取公告…
      </p>
    );
  if (state.status === 'error') {
    return (
      <section className={styles.status} role="alert">
        <h2>暫時無法讀取這則公告</h2>
        <p>請確認網路後再試一次。</p>
        <button className="btn primary" onClick={refresh}>
          重新讀取
        </button>
      </section>
    );
  }
  if (!state.announcement) {
    return (
      <section className={styles.status}>
        <h2>找不到這則公告</h2>
        <p>公告可能已移除，或不屬於目前查看的學校。</p>
      </section>
    );
  }
  const announcement = state.announcement;
  return (
    <article className={styles.announcement}>
      <div className={styles.meta}>
        {announcement.pinned && <span className={styles.pinned}>置頂</span>}
        <span>公開公告</span>
        {announcement.source && <span>{announcement.source}</span>}
        {announcement.publishedAt ? (
          <time dateTime={announcement.publishedAt}>
            {new Date(announcement.publishedAt).toLocaleDateString('zh-TW', {
              timeZone: 'Asia/Taipei',
              year: 'numeric',
              month: 'numeric',
              day: 'numeric',
            })}
          </time>
        ) : (
          <span>未提供發布日期</span>
        )}
      </div>
      <h2>{announcement.title}</h2>
      {announcement.body && <p className={styles.body}>{announcement.body}</p>}
      <div className={styles.detailActions}>
        <button className="btn" onClick={() => void copyLink()}>
          複製連結
        </button>
        <button className="btn" onClick={refresh}>
          更新公告
        </button>
      </div>
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
    </article>
  );
}

export default function AnnouncementDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ school?: string; schoolId?: string }>;
}) {
  const { id } = use(props.params);
  const params = props.searchParams ? use(props.searchParams) : undefined;
  const matches = findSchoolsByCode(params?.school);
  const school =
    findSchoolById(params?.schoolId) ??
    (matches.length === 1 ? matches[0] : resolveSchoolPageContext().school);
  const { user, loading } = useAuth();
  return (
    <SiteShell schoolName={school.name} schoolCode={school.code} title="公告詳情">
      <div className={styles.page}>
        <Link
          className={styles.back}
          href={`/announcements?schoolId=${encodeURIComponent(school.id)}`}
        >
          ← 返回公告列表
        </Link>
        {loading ? (
          <p className={styles.status} role="status">
            正在準備公告…
          </p>
        ) : (
          <AnnouncementDetail
            key={JSON.stringify([school.id, id, user?.uid ?? null])}
            schoolId={school.id}
            id={id}
          />
        )}
      </div>
    </SiteShell>
  );
}
