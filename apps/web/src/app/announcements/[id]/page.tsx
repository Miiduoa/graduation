'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthGuard';
import { SiteShell } from '@/components/SiteShell';
import type { Announcement } from '@/lib/firebase';
import { loadAnnouncement } from '../publicAnnouncements';
import {
  formatStaleAnnouncementNotice,
  listAnnouncementCatalogLinks,
  SOURCE_NOT_CONNECTED_TEXT,
  staleAnnouncementUpdatedAt,
} from '@campus/shared/src/campusAnnouncements';
import { isAnnouncementSchoolVisibleToPublic } from '@campus/shared/src/campusAnnouncements';
import { getAnnouncementVisibilityEnv } from '@/lib/runtime';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import styles from '../announcements.module.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'not_connected' }
  | { status: 'ready'; announcement: Announcement | null; fetchedAt: string; stale: boolean };

function OfficeSourceLinks({
  links,
}: {
  links: Array<{ sourceId: string; office: string; listUrl?: string }>;
}) {
  const items = links.filter((item) => item.listUrl);
  if (!items.length) return null;
  return (
    <p>
      {items.map((item, index) => (
        <span key={item.sourceId}>
          {index > 0 ? '、' : null}
          <a href={item.listUrl} rel="noopener noreferrer" target="_blank">
            {item.office}
          </a>
        </span>
      ))}
    </p>
  );
}

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
          setState({
            status: 'ready',
            announcement,
            fetchedAt: new Date().toISOString(),
            stale: false,
          });
        }
      },
      () => {
        if (!mounted.current || request !== generation.current) return;
        setState((current) =>
          current.status === 'ready' && current.announcement
            ? { ...current, stale: true }
            : { status: 'not_connected' },
        );
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
    setNotice('');
    setState((current) =>
      current.status === 'ready' && current.announcement ? current : { status: 'loading' },
    );
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
  if (state.status === 'not_connected') {
    return (
      <section className={styles.status}>
        <h2>{SOURCE_NOT_CONNECTED_TEXT}</h2>
        <OfficeSourceLinks links={listAnnouncementCatalogLinks(schoolId)} />
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
      {state.stale ? (
        <p role="status" className={styles.notice}>
          {formatStaleAnnouncementNotice(
            staleAnnouncementUpdatedAt(
              [{ status: 'unavailable', lastSuccessAt: state.fetchedAt }],
              [announcement],
            ),
            'firestore',
          )}
        </p>
      ) : null}
      <h2>{announcement.title}</h2>
      {(announcement.summary || announcement.body) && (
        <p className={styles.body}>{announcement.summary || announcement.body}</p>
      )}
      {announcement.originalUrl && (
        <a
          className={styles.share}
          href={announcement.originalUrl}
          rel="noreferrer"
          target="_blank"
        >
          看原文
        </a>
      )}
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
  searchParams?: Promise<{ school?: string; schoolId?: string; campus?: string }>;
}) {
  const { id } = use(props.params);
  const params = props.searchParams ? use(props.searchParams) : undefined;
  const context = useCampusBrowseContext(params);
  const schoolId = context.schoolId;
  const visible =
    context.status === 'ready' &&
    Boolean(schoolId && isAnnouncementSchoolVisibleToPublic(
      { schoolId },
      getAnnouncementVisibilityEnv(),
    ));
  const { user, loading } = useAuth();
  return (
    <SiteShell
      schoolName={visible ? context.schoolName : undefined}
      title="公告詳情"
    >
      <div className={styles.page}>
        <Link
          className={styles.back}
          href={
            visible && schoolId
              ? `/announcements?schoolId=${encodeURIComponent(schoolId)}`
              : '/announcements'
          }
        >
          ← 返回公告列表
        </Link>
        {!visible ? (
          <section className={styles.status}>
            <h2>
              {context.status === 'loading'
                ? '正在確認所選校園…'
                : context.status === 'error'
                  ? '無法取得校園目錄'
                  : context.status === 'unselected'
                    ? '先選擇一所學校'
                    : '目前沒有公開公告'}
            </h2>
          </section>
        ) : loading ? (
          <p className={styles.status} role="status">
            正在準備公告…
          </p>
        ) : (
          <AnnouncementDetail
            key={JSON.stringify([schoolId, id, user?.uid ?? null])}
            schoolId={schoolId!}
            id={id}
          />
        )}
      </div>
    </SiteShell>
  );
}
