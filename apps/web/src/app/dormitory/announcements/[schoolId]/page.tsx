'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { dormAnnouncementPublishedTime, type DormWorkflowRows } from '@campus/shared/src/dormWorkflow';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { useAuth } from '@/components/AuthGuard';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { SiteShell } from '@/components/SiteShell';
import { dormAnnouncementHref } from '@/lib/dormAnnouncementLink';
import { DormWorkflowRequestError, invokeDormWorkflow } from '@/lib/dormWorkflowClient';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import styles from '../../dormitory.module.css';

type Announcements = NonNullable<DormWorkflowRows['announcements']>;
type Feed = { status: 'loading' | 'error' | 'denied' } | { status: 'ready'; rows: Announcements };

function ResidentAnnouncements({ uid, schoolId, id }: { uid: string; schoolId: string; id: string | null }) {
  const [feed, setFeed] = useState<Feed>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let generation = 0;
    let loading = false;
    function conceal() {
      generation += 1;
      loading = false;
      setFeed({ status: 'loading' });
    }
    function read() {
      if (document.hidden || loading) return;
      loading = true;
      const request = ++generation;
      setFeed({ status: 'loading' });
      invokeDormWorkflow<DormWorkflowRows>({ action: 'mine', schoolId }, uid)
        .then((result) => {
          if (!Array.isArray(result?.announcements)) throw new Error('Missing announcement list');
          if (request === generation) setFeed({ status: 'ready', rows: result.announcements });
        })
        .catch((error: unknown) => {
          if (request !== generation) return;
          const denied = error instanceof DormWorkflowRequestError && [401, 403].includes(error.status);
          setFeed({ status: denied ? 'denied' : 'error' });
        })
        .finally(() => { if (request === generation) loading = false; });
    }
    function onVisibility() {
      if (document.hidden) conceal();
      else read();
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) read();
    }
    read();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', conceal);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', read);
    return () => {
      generation += 1;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', conceal);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', read);
    };
  }, [uid, schoolId, attempt]);
  function retry() {
    setFeed({ status: 'loading' });
    setAttempt((value) => value + 1);
  }
  if (feed.status === 'loading') return <p role="status">正在確認本棟公告…</p>;
  if (feed.status !== 'ready') return (
    <div className={styles.panel}>
      <p role="alert">{feed.status === 'denied'
        ? '目前的學校帳號無法查看本棟公告，請確認學校身分與住宿名冊。'
        : '暫時無法讀取本棟公告，請稍後再試。'}</p>
      <button type="button" onClick={retry}>重新讀取</button>
    </div>
  );
  if (id) {
    const announcement = feed.rows.find((row) => row.id === id);
    return (
      <section className={styles.panel}>
        {announcement ? <>
          <p>棟別 {announcement.building}</p>
          <h2>{announcement.title}</h2>
          <p>{dormAnnouncementPublishedTime(announcement.publishedAt)}</p>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{announcement.body}</p>
        </> : <>
          <h2>查無這則本棟公告</h2>
          <p>公告可能已移除，或目前住宿名冊已變更。</p>
          <button type="button" onClick={retry}>重新確認</button>
        </>}
        <p><Link href={dormAnnouncementHref(schoolId)}>查看本棟公告列表</Link></p>
      </section>
    );
  }
  return (
    <section className={styles.panel} aria-label="本棟公告列表">
      {feed.rows.length ? <ul>
        {feed.rows.map((row) => <li key={row.id}>
          <Link href={dormAnnouncementHref(schoolId, row.id)}>{row.title}</Link> · {row.building}
          <div>{dormAnnouncementPublishedTime(row.publishedAt)}</div>
        </li>)}
      </ul> : <p>目前沒有可查看的本棟公告。</p>}
      <button type="button" onClick={retry}>更新公告</button>
    </section>
  );
}

export default function DormAnnouncementPage({ params, searchParams }: {
  params: Promise<{ schoolId: string }>;
  searchParams: Promise<{ dormAnnouncementId?: string | string[] }>;
}) {
  const { schoolId: sourceSchool } = use(params);
  const { user, loading } = useAuth();
  const campus = useCampusBrowseContext();
  const { dormAnnouncementId: target } = use(searchParams);
  const id = typeof target === 'string' ? target : null;
  const malformed = target !== undefined && (!id || id.length > 128 || id === '.' || id === '..' || id.includes('/'));
  const returnUrl = dormAnnouncementHref(sourceSchool, id);
  return (
    <SiteShell title="本棟公告" schoolName={campus.schoolName}>
      {loading ? <p role="status">正在確認登入狀態…</p>
        : campus.status !== 'ready' || !campus.schoolId ? <SchoolScopePlaceholder />
        : toPublicSchoolId(campus.schoolId) !== toPublicSchoolId(sourceSchool) ? <p role="alert">這則宿舍通知屬於其他校園，請切換至原校園查看。</p>
        : malformed ? <div className={styles.panel}>
          <p role="alert">公告連結不完整。</p><Link href={dormAnnouncementHref(sourceSchool)}>查看本棟公告列表</Link>
        </div>
        : !user ? <SchoolAccountRequired returnUrl={returnUrl} alternative="請以住宿名冊使用的學校帳號登入查看本棟公告。" />
        : <ResidentAnnouncements key={JSON.stringify([user.uid, sourceSchool, id])}
            uid={user.uid} schoolId={sourceSchool} id={id} />}
      <p><Link href={`/dormitory${campus.schoolSearch}`}>返回宿舍服務</Link></p>
    </SiteShell>
  );
}
