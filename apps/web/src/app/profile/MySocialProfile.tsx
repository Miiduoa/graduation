'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import { campusServiceHref } from '@/lib/campusNavigationLinks';
import { loadOwnCampusPosts, type OwnPostCursor } from '@/lib/community/myPosts';
import type { CampusPostDoc } from '@/lib/community/firestore';
import styles from './my-social-profile.module.css';

type Timeline = {
  status: 'loading' | 'ready' | 'error';
  posts: CampusPostDoc[];
  cursor: OwnPostCursor | null;
  hasMore: boolean;
};
const initial: Timeline = { status: 'loading', posts: [], cursor: null, hasMore: false };

function publishedDate(value: unknown) {
  const timestamp = value as { toDate?: () => Date } | null;
  const date = timestamp && typeof timestamp.toDate === 'function'
    ? timestamp.toDate()
    : value instanceof Date ? value : null;
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' })
    : '日期未提供';
}

function TimelineContent({ uid, schoolId, schoolName, name, navigationSearch }: {
  uid: string;
  schoolId: string;
  schoolName: string;
  name: string;
  navigationSearch: string;
}) {
  const [timeline, setTimeline] = useState<Timeline>(initial);
  const [kind, setKind] = useState<'all' | 'media'>('all');
  const [revision, setRevision] = useState(0);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const moreLock = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let live = true;
    setTimeline(initial);
    setMoreError(false);
    void loadOwnCampusPosts(schoolId, uid).then(
      (page) => {
        if (live) setTimeline({ status: 'ready', posts: page.items, cursor: page.cursor, hasMore: page.hasMore });
      },
      () => {
        if (live) setTimeline({ ...initial, status: 'error' });
      },
    );
    return () => { live = false; };
  }, [schoolId, uid, revision]);

  async function more() {
    if (moreLock.current || !timeline.hasMore || !timeline.cursor || timeline.status !== 'ready') return;
    moreLock.current = true;
    const cursor = timeline.cursor;
    setMoreBusy(true);
    setMoreError(false);
    try {
      const page = await loadOwnCampusPosts(schoolId, uid, cursor);
      if (mounted.current) setTimeline((current) => {
        if (current.status !== 'ready' || current.cursor !== cursor) return current;
        const seen = new Set(current.posts.map((post) => post.id));
        return {
          status: 'ready',
          posts: [...current.posts, ...page.items.filter((post) => !seen.has(post.id))],
          cursor: page.cursor,
          hasMore: page.hasMore,
        };
      });
    } catch {
      if (mounted.current) setMoreError(true);
    } finally {
      moreLock.current = false;
      if (mounted.current) setMoreBusy(false);
    }
  }

  const posts = kind === 'media'
    ? timeline.posts.filter((post) => Array.isArray(post.mediaUrls) && post.mediaUrls.length > 0)
    : timeline.posts;
  const scope = encodeURIComponent(schoolId);
  const href = (path: string) => campusServiceHref(path, navigationSearch);
  return (
    <section className={styles.profile} aria-labelledby="my-social-title">
      <header className={styles.header}>
        <span className={styles.avatar} aria-hidden="true">{Array.from(name)[0] || '我'}</span>
        <div className={styles.identity}>
          <p className={styles.eyebrow}>nuni · 我的社群</p>
          <h2 id="my-social-title">{name}</h2>
          <p>在 {schoolName} 分享的公開署名內容</p>
        </div>
        <div className={styles.actions}>
          <Link className={styles.secondary} href={href('/settings?section=account')}>編輯資料</Link>
          <Link className={styles.primary} href={href('/community/post/new?schoolId=' + scope + '&source=profile')}>發表貼文</Link>
        </div>
      </header>

      <div className={styles.contentHeading}>
        <div>
          <h3>我的作品</h3>
          <p>文字、照片與校園生活，整理在同一個地方。</p>
        </div>
        {timeline.status === 'ready' && <span className={styles.count}>已載入 {timeline.posts.length} 則</span>}
      </div>
      <div className={styles.tabs} role="group" aria-label="作品分類">
        <button type="button" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>全部貼文</button>
        <button type="button" aria-pressed={kind === 'media'} onClick={() => setKind('media')}>圖文作品</button>
      </div>

      {timeline.status === 'loading' && <p role="status" className={styles.notice}>正在整理你的貼文…</p>}
      {timeline.status === 'error' && (
        <div className={styles.notice} role="alert">
          <p>暫時無法讀取這個校園的貼文。</p>
          <button className={styles.secondary} type="button" onClick={() => setRevision((n) => n + 1)}>重新讀取</button>
        </div>
      )}
      {timeline.status === 'ready' && (
        <>
          {posts.length === 0 ? (
            <div className={styles.notice}>
              <strong>{kind === 'media' ? '目前載入的貼文還沒有照片' : '還沒有署名貼文'}</strong>
              <p>{kind === 'media'
                ? '有照片的貼文會集中顯示在這裡。'
                : '從一段想法或一張照片開始。匿名貼文不會連到個人頁。'}</p>
              <Link className={styles.secondary} href={href('/community/post/new?schoolId=' + scope + '&source=profile')}>去發第一篇</Link>
            </div>
          ) : (
            <div className={styles.grid}>
              {posts.map((post) => {
                const cover = post.mediaUrls?.find((url) => typeof url === 'string' && url.startsWith('https://'));
                const likes = typeof post.likes === 'number' && post.likes >= 0 ? post.likes : 0;
                const replies = typeof post.commentCount === 'number' && post.commentCount >= 0 ? post.commentCount : 0;
                return (
                  <Link key={post.id} className={styles.post} href={href('/community/post/' + encodeURIComponent(post.id) + '?schoolId=' + scope)}>
                    {cover && <div className={styles.cover}><Image src={cover} width={480} height={300} alt="貼文附圖" unoptimized /></div>}
                    <div className={styles.postText}>
                      <time className={styles.date}>{publishedDate(post.createdAt)}</time>
                      <strong>{post.title || '未命名貼文'}</strong>
                      <p>{post.content || '照片分享'}</p>
                      <span className={styles.engagement}>{likes} 讚 · {replies} 回覆 <span aria-hidden="true">↗</span></span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
          {moreError && <p role="alert" className={styles.moreError}>載入較早貼文失敗，已載入的內容仍保留。</p>}
          {timeline.hasMore && (
            <div className={styles.more}>
              <button type="button" className={styles.secondary} disabled={moreBusy} onClick={() => void more()}>
                {moreBusy ? '載入中…' : '載入較早的貼文'}
              </button>
            </div>
          )}
          <div className={styles.bottomLink}>
            <Link href={href('/community?schoolId=' + scope)}>看看校園動態</Link>
            <Link href={href('/dms')}>私人訊息</Link>
          </div>
        </>
      )}
    </section>
  );
}

export function MySocialProfile({ uid, name, navigationSearch = '' }: {
  uid: string;
  name: string;
  navigationSearch?: string;
}) {
  const { ready, schoolId, schoolName } = useBrowsingSchoolPageContext();
  if (!ready) {
    return (
      <section className={styles.profile}>
        <h2>我的社群</h2>
        <p className={styles.notice}>選擇校園後，就能整理在該校發表的內容。</p>
        <Link href={campusServiceHref('/community', navigationSearch)} className={styles.secondary}>選擇校園</Link>
      </section>
    );
  }
  return <TimelineContent key={uid + ':' + schoolId} uid={uid} name={name} schoolId={schoolId} schoolName={schoolName} navigationSearch={navigationSearch} />;
}
