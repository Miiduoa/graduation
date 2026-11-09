'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { loadCampusPostBookmarks } from '@/lib/community/bookmarks';
import { followUser, listFollowingIds, unfollowUser } from '@/lib/community/follows';
import type { CampusPostDoc } from '@/lib/community/firestore';
import {
  listCreatorPosts,
  readCreatorIdentity,
  type CreatorCursor,
  type CreatorIdentity,
} from '@/lib/community/creatorProfile';
import { readCreatorPin, saveCreatorPin, type CreatorPin } from '@/lib/community/creatorPin';
import styles from './CreatorProfile.module.css';
import { CreatorCardPanel } from './CreatorCardPanel';

type ProfileTab = 'posts' | 'media' | 'saved';
type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: T };
type PostsPage = { rows: CampusPostDoc[]; cursor: CreatorCursor; hasMore: boolean };
type FollowState = 'loading' | 'following' | 'not-following' | 'pending' | 'error';
type PinState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: CreatorPin };

type CreatorProfileProps = {
  schoolId: string;
  schoolName: string;
  memberUid: string;
};

function safeMedia(post: CampusPostDoc): string[] {
  return Array.isArray(post.mediaUrls)
    ? post.mediaUrls.filter((url): url is string =>
      typeof url === 'string' && /^https:\/\/[^\s]+$/i.test(url),
    )
    : [];
}

function isVideo(url: string) {
  return /\.(mp4|mov|webm)(?:[?#]|$)/i.test(url);
}

function postDate(value: unknown): string {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    date = (value as { toDate: () => Date }).toDate();
  }
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
    : '';
}

function count(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function PostCard({ post, schoolId }: { post: CampusPostDoc; schoolId: string }) {
  const href = `/community/post/${encodeURIComponent(post.id)}?schoolId=${encodeURIComponent(schoolId)}`;
  const media = safeMedia(post);
  return (
    <article className={styles.postCard}>
      <Link className={styles.postLink} href={href} aria-label={`閱讀貼文：${post.title}`}>
        <div className={styles.postText}>
          <div className={styles.postMeta}>
            <span>{postDate(post.createdAt) || '發布時間未提供'}</span>
            {post.kind === 'thread' && <span>討論串</span>}
          </div>
          <h3>{post.title || '未命名貼文'}</h3>
          <p className={styles.postExcerpt}>{post.content}</p>
          <div className={styles.postStats} aria-label="貼文互動">
            <span>喜歡 {count(post.likes)}</span>
            <span>回覆 {count(post.commentCount)}</span>
            {media.length > 0 && <span>{media.length} 則媒體</span>}
          </div>
        </div>
        {media.length > 0 && (
          <div className={styles.postThumbnail} aria-hidden="true">
            {isVideo(media[0]) ? (
              <span className={styles.videoMarker}>影片</span>
            ) : (
              <img src={media[0]} alt="" loading="lazy" />
            )}
          </div>
        )}
      </Link>
    </article>
  );
}

function ScopedCreatorProfile({
  schoolId,
  schoolName,
  memberUid,
  viewerUid,
  ownDisplayName,
}: CreatorProfileProps & { viewerUid: string; ownDisplayName: string | null }) {
  const own = viewerUid === memberUid;
  const [identity, setIdentity] = useState<LoadState<CreatorIdentity | null>>({ status: 'loading' });
  const [posts, setPosts] = useState<LoadState<PostsPage>>({ status: 'loading' });
  const [saved, setSaved] = useState<LoadState<CampusPostDoc[]>>({ status: 'loading' });
  const [followState, setFollowState] = useState<FollowState>('loading');
  const [tab, setTab] = useState<ProfileTab>('posts');
  const [refresh, setRefresh] = useState(0);
  const [savedRefresh, setSavedRefresh] = useState(0);
  const [followingRefresh, setFollowingRefresh] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [followError, setFollowError] = useState('');
  const [pin, setPin] = useState<PinState>({ status: 'loading' });
  const [pinRevision, setPinRevision] = useState(0);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinFeedback, setPinFeedback] = useState('');
  const active = useRef(true);
  const postVersion = useRef(0);
  const moreFlight = useRef(false);
  const followFlight = useRef(false);
  const pinFlight = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    let live = true;
    setIdentity({ status: 'loading' });
    void readCreatorIdentity(schoolId, memberUid).then((value) => {
      if (live) setIdentity({ status: 'ready', value });
    }).catch(() => {
      if (live) setIdentity({ status: 'error' });
    });
    return () => { live = false; };
  }, [schoolId, memberUid, refresh]);

  useEffect(() => {
    let live = true;
    const version = ++postVersion.current;
    setPosts({ status: 'loading' });
    setMoreError('');
    setLoadingMore(false);
    moreFlight.current = false;
    void listCreatorPosts(schoolId, memberUid).then((page) => {
      if (live && version === postVersion.current) {
        setPosts({ status: 'ready', value: { rows: page.posts, cursor: page.cursor, hasMore: page.hasMore } });
      }
    }).catch(() => {
      if (live && version === postVersion.current) setPosts({ status: 'error' });
    });
    return () => { live = false; };
  }, [schoolId, memberUid, refresh]);

  useEffect(() => {
    if (own) return;
    let live = true;
    setFollowState('loading');
    setFollowError('');
    void listFollowingIds(schoolId, viewerUid).then((ids) => {
      if (live) setFollowState(ids.includes(memberUid) ? 'following' : 'not-following');
    }).catch(() => {
      if (live) setFollowState('error');
    });
    return () => { live = false; };
  }, [own, schoolId, memberUid, viewerUid, followingRefresh]);

  useEffect(() => {
    if (!own || tab !== 'saved') return;
    let live = true;
    setSaved({ status: 'loading' });
    void loadCampusPostBookmarks(viewerUid, schoolId, 40).then((result) => {
      if (live) setSaved({
        status: 'ready',
        value: result.posts.filter((post) => post.schoolId === schoolId),
      });
    }).catch(() => {
      if (live) setSaved({ status: 'error' });
    });
    return () => { live = false; };
  }, [own, tab, viewerUid, schoolId, savedRefresh]);

  const loadMore = useCallback(async () => {
    if (posts.status !== 'ready' || !posts.value.hasMore || !posts.value.cursor || moreFlight.current) return;
    moreFlight.current = true;
    const version = postVersion.current;
    setLoadingMore(true);
    setMoreError('');
    try {
      const next = await listCreatorPosts(schoolId, memberUid, posts.value.cursor);
      if (!active.current || version !== postVersion.current) return;
      setPosts((current) => {
        if (current.status !== 'ready') return current;
        const byId = new Map(current.value.rows.map((post) => [post.id, post]));
        for (const post of next.posts) byId.set(post.id, post);
        return {
          status: 'ready',
          value: { rows: [...byId.values()], cursor: next.cursor, hasMore: next.hasMore },
        };
      });
    } catch {
      if (active.current && version === postVersion.current) {
        setMoreError('更多貼文暫時無法讀取，已載入的內容不受影響。');
      }
    } finally {
      moreFlight.current = false;
      if (active.current && version === postVersion.current) setLoadingMore(false);
    }
  }, [posts, schoolId, memberUid]);

  const toggleFollow = useCallback(async () => {
    if (own || followFlight.current || !['following', 'not-following'].includes(followState)) return;
    const previouslyFollowing = followState === 'following';
    followFlight.current = true;
    setFollowState('pending');
    setFollowError('');
    try {
      if (previouslyFollowing) await unfollowUser(schoolId, viewerUid, memberUid);
      else await followUser(schoolId, viewerUid, memberUid);
      if (active.current) setFollowState(previouslyFollowing ? 'not-following' : 'following');
    } catch {
      if (active.current) {
        setFollowState('error');
        setFollowError('追蹤狀態沒有更新，請重新確認。');
      }
    } finally {
      followFlight.current = false;
    }
  }, [own, followState, schoolId, viewerUid, memberUid]);

  useEffect(() => {
    let live = true;
    setPin({ status: 'loading' });
    setPinFeedback('');
    void readCreatorPin(schoolId, memberUid).then((value) => {
      if (live) setPin({ status: 'ready', value });
    }).catch(() => { if (live) setPin({ status: 'error' }); });
    return () => { live = false; };
  }, [schoolId, memberUid, pinRevision]);

  const changePin = useCallback(async (postId: string) => {
    if (!own || pin.status !== 'ready' || pinFlight.current) return;
    pinFlight.current = true;
    setPinBusy(true);
    setPinFeedback('');
    try {
      const confirmed = await saveCreatorPin(schoolId, viewerUid, postId);
      if (!active.current) return;
      setPin({ status: 'ready', value: confirmed });
      setPinFeedback(postId ? '這篇貼文已置頂到你的個人頁。' : '已取消個人頁置頂。');
    } catch {
      if (active.current) setPinFeedback('尚未確認置頂變更，請檢查連線和貼文狀態後重試。');
    } finally {
      pinFlight.current = false;
      if (active.current) setPinBusy(false);
    }
  }, [own, pin.status, schoolId, viewerUid]);

  const shareProfile = useCallback(async () => {
    const url = new URL(
      `/community/member/${encodeURIComponent(memberUid)}?schoolId=${encodeURIComponent(schoolId)}`,
      window.location.origin,
    ).toString();
    setShareStatus('');
    try {
      if (navigator.share) {
        await navigator.share({ title: '校園個人頁', url });
        return;
      }
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard not supported');
      await navigator.clipboard.writeText(url);
      setShareStatus('個人頁連結已複製；只有具備所屬校園閱讀權限的人能看到貼文。');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setShareStatus('無法自動分享，請從瀏覽器網址列複製連結。');
    }
  }, [schoolId, memberUid]);

  const displayName =
    identity.status === 'ready' && identity.value?.displayName
      ? identity.value.displayName
      : own ? (ownDisplayName || '我的頁面') : '校園成員';
  const avatar = identity.status === 'ready' ? identity.value?.avatarUrl : null;
  const loadedPosts = posts.status === 'ready' ? posts.value.rows : [];
  const mediaPosts = loadedPosts.filter((post) => safeMedia(post).length > 0);
  const activePosts = tab === 'saved'
    ? saved.status === 'ready' ? saved.value : []
    : tab === 'media' ? mediaPosts : loadedPosts;
  const pinnedPost = pin.status === 'ready' ? pin.value.post : null;
  const shownPosts = tab === 'posts' && pinnedPost
    ? activePosts.filter((post) => post.id !== pinnedPost.id) : activePosts;
  const feedLoading = tab === 'saved' ? saved.status === 'loading' : posts.status === 'loading';
  const feedError = tab === 'saved' ? saved.status === 'error' : posts.status === 'error';

  const tabs: { key: ProfileTab; label: string }[] = [
    { key: 'posts', label: '貼文' },
    { key: 'media', label: '相片與影片' },
    ...(own ? [{ key: 'saved' as const, label: '我的收藏' }] : []),
  ];

  return (
    <div className={styles.page}>
      <nav className={styles.back} aria-label="個人頁導覽">
        <Link href={`/community?tab=feed&schoolId=${encodeURIComponent(schoolId)}`}>返回校園動態</Link>
      </nav>
      <header className={styles.profileHeader}>
        <div className={styles.profileMain}>
          <span className={styles.avatar} aria-hidden="true">
            {avatar ? <img src={avatar} alt="" /> : displayName.slice(0, 1)}
          </span>
          <div className={styles.profileCopy}>
            <p className={styles.school}>{schoolName}</p>
            <h1>{displayName}</h1>
            <p className={styles.scope}>
              {own ? '你的校園社群頁' : '校園成員'} · 僅向具備所屬校園權限的成員展示
            </p>
          </div>
        </div>
        {identity.status === 'error' && (
          <div className={styles.alert} role="alert">
            公開名片暫時無法讀取。
            <button type="button" onClick={() => setRefresh((n) => n + 1)}>重試</button>
          </div>
        )}
        <CreatorCardPanel schoolId={schoolId} ownerUid={memberUid} own={own} />
        <div className={styles.actions}>
          {own ? (
            <>
              <Link className={styles.primaryAction} href={`/community/post/new?schoolId=${encodeURIComponent(schoolId)}`}>發表貼文</Link>
              <Link className={styles.secondaryAction} href={`/community/story/new?schoolId=${encodeURIComponent(schoolId)}`}>發布限動</Link>
              <Link className={styles.secondaryAction} href="/settings">帳號設定</Link>
            </>
          ) : followState === 'error' ? (
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={() => setFollowingRefresh((n) => n + 1)}
            >重新確認追蹤</button>
          ) : (
            <button
              type="button"
              className={followState === 'following' ? styles.secondaryAction : styles.primaryAction}
              disabled={followState === 'loading' || followState === 'pending'}
              aria-pressed={followState === 'following'}
              onClick={() => void toggleFollow()}
            >
              {followState === 'following' ? '追蹤中' :
                followState === 'loading' ? '正在確認追蹤…' :
                  followState === 'pending' ? '正在更新…' : '追蹤'}
            </button>
          )}
          <button type="button" className={styles.secondaryAction} onClick={() => void shareProfile()}>
            分享個人頁
          </button>
        </div>
        {followError && <p className={styles.alert} role="alert">{followError}</p>}
        {shareStatus && <p className={styles.feedback} role="status">{shareStatus}</p>}
        <div className={styles.profileStats}>
          <span>
            {posts.status === 'ready'
              ? `已載入 ${loadedPosts.length} 則公開貼文${posts.value.hasMore ? '，還有更多' : ''}`
              : '公開貼文'}
          </span>
          <span>{own ? '收藏僅自己可見' : '不顯示私人帳號資料'}</span>
        </div>
      </header>

      <section className={styles.library} aria-label={own ? '我的社群內容' : '作者的社群內容'}>
        <div className={styles.tabs} role="tablist" aria-label="內容類別">
          {tabs.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              id={`creator-tab-${entry.key}`}
              aria-selected={tab === entry.key}
              aria-controls="creator-content-panel"
              onClick={() => setTab(entry.key)}
            >{entry.label}</button>
          ))}
        </div>
        <div id="creator-content-panel" role="tabpanel" aria-labelledby={`creator-tab-${tab}`}>
          {tab === 'posts' && pin.status === 'error' && (
            <div className={styles.pinNotice} role="alert">
              <span>置頂內容暫時無法讀取。</span>
              <button type="button" className={styles.pinButton} onClick={() => setPinRevision((n) => n + 1)}>重新讀取置頂</button>
            </div>
          )}
          {tab === 'posts' && pinnedPost && (
            <section className={styles.pinnedBlock} aria-label="置頂貼文">
              <div className={styles.pinHeading}>
                <strong>置頂貼文</strong>
                {own && <button
                  type="button"
                  className={styles.pinButton}
                  disabled={pinBusy}
                  onClick={() => void changePin('')}
                >取消置頂</button>}
              </div>
              <PostCard post={pinnedPost} schoolId={schoolId} />
            </section>
          )}
          {pinFeedback && tab === 'posts' && <p role="status" className={styles.pinNotice}>{pinFeedback}</p>}
          {feedLoading ? (
            <p role="status" className={styles.message}>正在讀取內容…</p>
          ) : feedError ? (
            <div className={styles.message} role="alert">
              <p>{tab === 'saved' ? '私人收藏' : '公開貼文'}暫時無法讀取，請確認連線與校園資格。</p>
              <button className={styles.secondaryAction} type="button" onClick={() =>
                tab === 'saved' ? setSavedRefresh((n) => n + 1) : setRefresh((n) => n + 1)
              }>重新讀取</button>
            </div>
          ) : shownPosts.length === 0 && !pinnedPost ? (
            <div className={styles.message}>
              <p>
                {tab === 'media'
                  ? '目前載入的貼文還沒有相片或影片。'
                  : tab === 'saved'
                    ? '還沒有收藏貼文，收藏的內容只會顯示給你。'
                    : own ? '你還沒有用公開身分發表貼文。' : '這位成員還沒有公開貼文。'}
              </p>
              {own && tab === 'posts' && (
                <Link className={styles.primaryAction} href={`/community/post/new?schoolId=${encodeURIComponent(schoolId)}`}>
                  發表第一篇貼文
                </Link>
              )}
            </div>
          ) : tab === 'media' ? (
            <div className={styles.mediaGrid}>
              {shownPosts.flatMap((post) => safeMedia(post).map((url, index) => (
                <Link
                  key={`${post.id}-${index}`}
                  href={`/community/post/${encodeURIComponent(post.id)}?schoolId=${encodeURIComponent(schoolId)}`}
                  className={styles.mediaTile}
                  aria-label={`觀看 ${post.title || '貼文'} 的第 ${index + 1} 則媒體`}
                >
                  {isVideo(url) ? <span className={styles.videoMarker}>影片</span> : <img src={url} alt="" loading="lazy" />}
                </Link>
              )))}
            </div>
          ) : (
            <div className={styles.postList}>
              {tab === 'saved' && <p className={styles.privateNote}>私人收藏 · 最多顯示最近 40 筆，僅自己可見</p>}
              {shownPosts.map((post) => (
                <div key={post.id}>
                  <PostCard post={post} schoolId={schoolId} />
                  {own && tab === 'posts' && (
                    <div className={styles.pinActions}>
                      <button
                        type="button"
                        className={styles.pinButton}
                        disabled={pinBusy || pin.status !== 'ready'}
                        onClick={() => void changePin(post.id)}
                      >置頂到個人頁</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {tab !== 'saved' && posts.status === 'ready' && posts.value.hasMore && (
            <div className={styles.more}>
              {moreError && <p role="alert">{moreError}</p>}
              <button type="button" className={styles.secondaryAction} disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? '正在載入…' : '載入更多貼文'}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export function CreatorProfile({ schoolId, schoolName, memberUid }: CreatorProfileProps) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">正在確認登入狀態…</p>;
  if (!user) return null;
  return (
    <ScopedCreatorProfile
      key={JSON.stringify([schoolId, memberUid, user.uid])}
      schoolId={schoolId}
      schoolName={schoolName}
      memberUid={memberUid}
      viewerUid={user.uid}
      ownDisplayName={user.displayName}
    />
  );
}
