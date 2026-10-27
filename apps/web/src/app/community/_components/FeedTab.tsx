'use client';

/**
 * 校園社群 — 動態（Web）
 *
 * 對應 mobile/HomeFeedScreen.tsx：
 *  - 頂部 Story 列（橫向卷軸；點 + 我的動態 跳到 /community/story/new）
 *  - 篩選 chip：全部 / 我訂閱 / 圖文
 *  - 貼文卡片：作者頭像、看板 chip、圖片 grid、點讚、留言、跳 /community/post/[id]
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import styles from '../community.module.css';
import { CommunityLoadError, useCommunityLoad } from './useCommunityLoad';
import { selectCampusFeedPosts, type FeedFilter, type FeedOrder } from './feedView';
import { listFollowingIds, followUser, unfollowUser } from '@/lib/community/follows';
import Image from 'next/image';
import { useAuth } from '@/components/AuthGuard';
import { PostActionsRow, PostBookmarkShareActions } from './PostActionBar';
import {
  BOOKMARK_UNAVAILABLE_COPY,
  listCampusPostBookmarkIds,
  loadCampusPostBookmarks,
  saveCampusPostBookmark,
  removeCampusPostBookmark,
} from '@/lib/community/bookmarks';
import { isPermissionDeniedError } from '@campus/shared/src/signedInSocialReads';
import {
  fetchRecentCampusPosts,
  rankFeedPosts,
  toggleCampusPostLike,
  listBoards,
  listSubscribedBoardIds,
  listActiveStoriesForSchool,
  groupStoriesByAuthor,
  fetchSchoolDirectoryProfiles,
  type CampusPostDoc,
  type CampusBoard,
  type StoryAuthorGroup,
} from '@/lib/community/firestore';

type FilterKey = FeedFilter | 'saved';
const EMPTY_SAVED_POSTS: CampusPostDoc[] = [];
const EMPTY_FOLLOWING_IDS: ReadonlySet<string> = new Set();

const FILTERS: { key: FilterKey; label: string; icon: string }[] = [
  { key: 'all', label: '全部', icon: '✨' },
  { key: 'following', label: '追蹤', icon: '👥' },
  { key: 'subscribed', label: '我訂閱', icon: '🔔' },
  { key: 'media', label: '圖文', icon: '🖼' },
  { key: 'saved', label: '收藏', icon: '🔖' },
];

function formatTs(t: unknown): string {
  const d =
    t instanceof Date
      ? t
      : typeof (t as any)?.toMillis === 'function'
        ? new Date((t as any).toMillis())
        : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '剛剛';
  if (m < 60) return `${m} 分鐘前`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} 小時前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function likesOf(p: CampusPostDoc) {
  return typeof p.likes === 'number' ? p.likes : Array.isArray(p.likedBy) ? p.likedBy.length : 0;
}
function mediaOf(p: CampusPostDoc): string[] {
  return Array.isArray(p.mediaUrls)
    ? p.mediaUrls.filter((u) => typeof u === 'string' && u.length > 0)
    : [];
}

type FeedTabProps = { schoolId: string; schoolSearch: string };

export function FeedTab(props: FeedTabProps) {
  const { user, loading: authLoading } = useAuth();
  if (authLoading) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }} role="status">
        正在確認登入狀態…
      </div>
    );
  }
  if (!user) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
        請先登入以瀏覽校園動態
      </div>
    );
  }
  // Reads, pending writes and search text belong to one account and school.
  // Replacing the scope also detaches late completions from the next account's state.
  return <ScopedFeedTab key={JSON.stringify([user.uid, props.schoolId])} {...props} user={user} />;
}

function ScopedFeedTab(props: FeedTabProps & { user: { uid: string } }) {
  const { schoolId, user } = props;
  const [posts, setPosts] = useState<CampusPostDoc[]>([]);
  const [boards, setBoards] = useState<CampusBoard[]>([]);
  const [stories, setStories] = useState<StoryAuthorGroup[]>([]);
  const [subscribedIds, setSubscribedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterKey>('all');
  const [order, setOrder] = useState<FeedOrder>('recommended');
  const [search, setSearch] = useState('');
  const [nameByUid, setNameByUid] = useState<Record<string, string>>({});
  const [avatarByUid, setAvatarByUid] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<{ postId: string; text: string } | null>(null);
  const likeFlightsRef = useRef<Set<string>>(new Set());
  const [pendingLikes, setPendingLikes] = useState<ReadonlySet<string>>(new Set());
  const [likeFeedback, setLikeFeedback] = useState<{ postId: string; text: string } | null>(null);
  const [bookmarkScope, setBookmarkScope] = useState('');
  const [bookmarkedIds, setBookmarkedIds] = useState<ReadonlySet<string>>(new Set());
  const [bookmarkedPosts, setBookmarkedPosts] = useState<CampusPostDoc[]>([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(false);
  const [bookmarksError, setBookmarksError] = useState('');
  const [bookmarkUnavailable, setBookmarkUnavailable] = useState(false);
  const [bookmarkRevision, setBookmarkRevision] = useState(0);
  const bookmarkFlights = useRef<Set<string>>(new Set());
  const [bookmarksPending, setBookmarksPending] = useState<ReadonlySet<string>>(new Set());
  const [bookmarkFeedback, setBookmarkFeedback] = useState<{ postId: string; text: string } | null>(null);
  const currentBookmarkScope = `${user?.uid ?? ''}:${schoolId}`;
  const validBookmarks = bookmarkScope === currentBookmarkScope;
  const savedIds = validBookmarks ? bookmarkedIds : new Set<string>();
  const savedPosts = validBookmarks ? bookmarkedPosts : EMPTY_SAVED_POSTS;
  const savedView = filter === 'saved';
  const followingView = filter === 'following';
  const [followingScope, setFollowingScope] = useState('');
  const [followingIds, setFollowingIds] = useState<ReadonlySet<string>>(new Set());
  const [followingLoading, setFollowingLoading] = useState(false);
  const [followingError, setFollowingError] = useState('');
  const [followingFeedback, setFollowingFeedback] = useState('');
  const [followingRevision, setFollowingRevision] = useState(0);
  const followingFlights = useRef<Set<string>>(new Set());
  const [followingPending, setFollowingPending] = useState<ReadonlySet<string>>(new Set());
  const currentFollowingScope = `${user?.uid ?? ''}:${schoolId}`;
  const followingScopeRef = useRef(currentFollowingScope);
  useLayoutEffect(() => {
    followingScopeRef.current = currentFollowingScope;
  }, [currentFollowingScope]);
  const validFollowing = followingScope === currentFollowingScope;
  const followedIds = validFollowing ? followingIds : EMPTY_FOLLOWING_IDS;

  const load = useCallback(async () => {
    if (!schoolId || !user) {
      setPosts([]);
      setBoards([]);
      setStories([]);
      setSubscribedIds(new Set());
      return;
    }
    const [rows, boardList, subs, storyRows] = await Promise.all([
      fetchRecentCampusPosts(schoolId, undefined, 60),
      listBoards(schoolId, 80),
      listSubscribedBoardIds(user.uid, schoolId),
      listActiveStoriesForSchool(schoolId, 80),
    ]);
    setPosts(rankFeedPosts(rows, 80));
    setBoards(boardList);
    setSubscribedIds(new Set(subs));
    setStories(groupStoriesByAuthor(storyRows, user.uid));
  }, [schoolId, user]);

  const { loading, error, refresh } = useCommunityLoad(
    load,
    '暫時無法讀取校園動態，請確認連線後重試。',
  );

  // hydrate display names for post authors + story authors
  useEffect(() => {
    (async () => {
      const uids = new Set<string>();
      [...posts, ...savedPosts].forEach((p) => {
        if (!p.anonymous && p.authorUid) uids.add(p.authorUid);
      });
      stories.forEach((g) => uids.add(g.authorUid));
      if (!schoolId || uids.size === 0) {
        setNameByUid({});
        setAvatarByUid({});
        return;
      }
      const profiles = await fetchSchoolDirectoryProfiles(schoolId, [...uids]);
      const n: Record<string, string> = {};
      const a: Record<string, string> = {};
      profiles.forEach((p) => {
        n[p.uid] = (p.displayName ?? p.uid.slice(0, 8)).trim();
        if (p.avatarUrl) a[p.uid] = p.avatarUrl;
      });
      setNameByUid(n);
      setAvatarByUid(a);
    })().catch(() => {});
  }, [posts, savedPosts, stories, schoolId]);

  const boardNameById = useMemo(() => {
    const m: Record<string, string> = {};
    boards.forEach((b) => {
      m[b.id] = b.name;
    });
    return m;
  }, [boards]);

  const visible = useMemo(
    () =>
      selectCampusFeedPosts(savedView ? savedPosts : posts, {
        filter: filter === 'saved' ? 'all' : filter,
        order,
        search,
        subscribedIds,
        followingIds: followedIds,
        boardNames: boardNameById,
        authorNames: nameByUid,
      }),
    [posts, savedPosts, savedView, filter, order, search, subscribedIds, followedIds, boardNameById, nameByUid],
  );

  useEffect(() => {
    const uid = user?.uid;
    if (!uid || !schoolId) {
      setBookmarkScope('');
      setBookmarkedIds(new Set());
      setBookmarkedPosts([]);
      setBookmarkUnavailable(false);
      return;
    }
    const scope = `${uid}:${schoolId}`;
    let live = true;
    setBookmarksError('');
    if (savedView) setBookmarksLoading(true);
    void (async () => {
      if (savedView) {
        const result = await loadCampusPostBookmarks(uid, schoolId);
        if (!live) return;
        setBookmarkedIds(new Set(result.ids));
        setBookmarkedPosts(result.posts);
      } else {
        const ids = await listCampusPostBookmarkIds(uid, schoolId);
        if (!live) return;
        setBookmarkedIds(new Set(ids));
      }
      setBookmarkUnavailable(false);
      setBookmarkScope(scope);
    })()
      .catch((error) => {
        if (!live) return;
        if (isPermissionDeniedError(error)) {
          setBookmarkedIds(new Set());
          setBookmarkedPosts([]);
          setBookmarkScope(scope);
          setBookmarksError('');
          setBookmarkUnavailable(true);
          return;
        }
        setBookmarkUnavailable(false);
        setBookmarksError('暫時無法讀取收藏，請確認連線與校籍後重試。');
      })
      .finally(() => {
        if (live) setBookmarksLoading(false);
      });
    return () => {
      live = false;
    };
  }, [user?.uid, schoolId, savedView, bookmarkRevision]);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid || !schoolId) {
      setFollowingScope('');
      setFollowingIds(new Set());
      setFollowingLoading(false);
      return;
    }
    const scope = `${uid}:${schoolId}`;
    let live = true;
    setFollowingLoading(true);
    setFollowingError('');
    void listFollowingIds(schoolId, uid)
      .then((ids) => {
        if (!live) return;
        setFollowingIds(new Set(ids));
        setFollowingScope(scope);
      })
      .catch(() => {
        if (live) setFollowingError('無法讀取追蹤清單，請確認網路及校籍後重試。');
      })
      .finally(() => {
        if (live) setFollowingLoading(false);
      });
    return () => { live = false; };
  }, [user?.uid, schoolId, followingRevision]);

  const toggleFollow = async (targetUid: string) => {
    if (
      !user?.uid || !schoolId || targetUid === user.uid ||
      !validFollowing || followingError || followingFlights.current.has(targetUid)
    ) return;
    const scope = currentFollowingScope;
    const removing = followedIds.has(targetUid);
    followingFlights.current.add(targetUid);
    setFollowingPending((prev) => new Set([...prev, targetUid]));
    setFollowingFeedback('');
    try {
      if (removing) await unfollowUser(schoolId, user.uid, targetUid);
      else await followUser(schoolId, user.uid, targetUid);
      if (followingScopeRef.current !== scope) return;
      setFollowingIds((prev) => {
        const next = new Set(prev);
        if (removing) next.delete(targetUid);
        else next.add(targetUid);
        return next;
      });
      setFollowingRevision((prev) => prev + 1);
    } catch {
      if (followingScopeRef.current === scope)
        setFollowingFeedback('追蹤狀態未更新，請確認網路和對方校籍後重試。');
    } finally {
      followingFlights.current.delete(targetUid);
      if (followingScopeRef.current === scope) {
        setFollowingPending((prev) => {
          const next = new Set(prev);
          next.delete(targetUid);
          return next;
        });
      }
    }
  };

  const toggleBookmark = async (item: CampusPostDoc) => {
    if (!user?.uid || !schoolId || bookmarkUnavailable || bookmarkFlights.current.has(item.id)) return;
    const removing = savedIds.has(item.id);
    bookmarkFlights.current.add(item.id);
    setBookmarksPending((prev) => new Set([...prev, item.id]));
    setBookmarkFeedback(null);
    try {
      if (removing) await removeCampusPostBookmark(user.uid, schoolId, item.id);
      else await saveCampusPostBookmark(user.uid, schoolId, item.id);
      setBookmarkedIds((prev) => {
        const next = new Set(prev);
        if (removing) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      if (removing) setBookmarkedPosts((prev) => prev.filter((post) => post.id !== item.id));
      setBookmarkScope(currentBookmarkScope);
      setBookmarkRevision((prev) => prev + 1);
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        setBookmarkUnavailable(true);
        setBookmarkFeedback(null);
      } else {
        setBookmarkFeedback({ postId: item.id, text: '收藏未更新，請確認連線及校籍後重試。' });
      }
    } finally {
      bookmarkFlights.current.delete(item.id);
      setBookmarksPending((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const onToggleLike = useCallback(
    async (row: CampusPostDoc) => {
      if (!user || !schoolId || likeFlightsRef.current.has(row.id)) return;
      likeFlightsRef.current.add(row.id);
      setPendingLikes((prev) => new Set([...prev, row.id]));
      setLikeFeedback(null);
      const optimistic = (items: CampusPostDoc[]) =>
        items.map((p) => {
          if (p.id !== row.id) return p;
          const likedBy = Array.isArray(p.likedBy) ? [...p.likedBy] : [];
          const index = likedBy.indexOf(user.uid);
          if (index >= 0) likedBy.splice(index, 1);
          else likedBy.push(user.uid);
          return {
            ...p, likedBy,
            likes: typeof p.likes === 'number' ? Math.max(0, p.likes + (index >= 0 ? -1 : 1)) : likedBy.length,
          };
        });
      setPosts(optimistic);
      setBookmarkedPosts(optimistic);
      try {
        await toggleCampusPostLike(schoolId, row.id, user.uid);
      } catch {
        // A failed write must not leave an unconfirmed reaction on screen.
        const rollback = (items: CampusPostDoc[]) =>
          items.map((post) =>
            post.id === row.id ? { ...post, likedBy: row.likedBy, likes: row.likes } : post,
          );
        setPosts(rollback);
        setBookmarkedPosts(rollback);
        setLikeFeedback({ postId: row.id, text: '讚沒有成功更新，請確認網路後再試。' });
      } finally {
        likeFlightsRef.current.delete(row.id);
        setPendingLikes((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
      }
    },
    [user, schoolId],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    setFollowingRevision((prev) => prev + 1);
    setBookmarkRevision((prev) => prev + 1);
    await refresh();
    setRefreshing(false);
  };

  const sharePost = async (post: CampusPostDoc) => {
    const href = `/community/post/${encodeURIComponent(post.id)}?schoolId=${encodeURIComponent(schoolId)}`;
    const url = new URL(href, window.location.origin).toString();
    setShareFeedback(null);
    try {
      if (navigator.share) {
        await navigator.share({ title: post.title, url });
        return;
      }
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(url);
      setShareFeedback({ postId: post.id, text: '連結已複製；對方仍需具備校園閱讀權限。' });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setShareFeedback({ postId: post.id, text: '無法自動分享，請開啟貼文後複製網址。' });
    }
  };

  const authorLine = (p: CampusPostDoc) => {
    if (p.anonymous) return p.aliasSnapshot ?? '匿名貼文';
    if (!p.authorUid) return '成員';
    return nameByUid[p.authorUid] ?? '載入中…';
  };

  if (error) return <CommunityLoadError message={error} retry={refresh} />;

  const selectedFeedLoading = loading ||
    (savedView && (bookmarksLoading || (!validBookmarks && !bookmarksError))) ||
    (followingView && (followingLoading || (!validFollowing && !followingError)));
  const selectedFeedError = (savedView && bookmarksError) || (followingView && followingError);

  return (
    <div className={styles.feedColumn}>
      {/* ── Story strip ── */}
      <div
        style={{
          display: 'flex',
          gap: 14,
          overflowX: 'auto',
          padding: '4px 4px 14px',
          borderBottom: '1px solid var(--border)',
          marginBottom: 14,
        }}
      >
        <Link
          href={`/community/story/new?schoolId=${encodeURIComponent(schoolId)}`}
          aria-label="發布限時動態"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textDecoration: 'none',
            color: 'var(--text)',
            minWidth: 68,
          }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: '50%',
              border: '2px dashed var(--border)',
              padding: 3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--surface)',
              fontSize: 24,
              color: 'var(--brand)',
              fontWeight: 700,
            }}
          >
            ＋
          </div>
          <span style={{ marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>新增</span>
        </Link>
        {stories
          .filter((g) => g.authorUid !== user?.uid)
          .map((g) => {
            const av = avatarByUid[g.authorUid];
            return (
              <button
                key={g.authorUid}
                type="button"
                onClick={() => {
                  // Web 上 Story viewer 走「即時」分頁完整體驗
                  const ev = new CustomEvent('community:open-story', { detail: g.authorUid });
                  window.dispatchEvent(ev);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  minWidth: 68,
                }}
                aria-label={`查看 ${nameByUid[g.authorUid] ?? g.authorUid.slice(0, 6)} 的限時動態`}
              >
                <div
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: '50%',
                    border: '2px solid var(--brand)',
                    padding: 3,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: av ? '#fff' : 'var(--brand)',
                    color: 'var(--on-brand)',
                    overflow: 'hidden',
                    fontSize: 20,
                    fontWeight: 700,
                  }}
                >
                  {av ? (
                    <Image
                      src={av}
                      alt=""
                      width={52}
                      height={52}
                      style={{ borderRadius: '50%' }}
                      unoptimized
                    />
                  ) : (
                    (nameByUid[g.authorUid] ?? '?').slice(0, 1)
                  )}
                </div>
                <span
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    color: 'var(--muted)',
                    maxWidth: 64,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {nameByUid[g.authorUid] ?? g.authorUid.slice(0, 6)}
                </span>
              </button>
            );
          })}
      </div>

      {/* ── Filter chips ── */}
      <div className={styles.toolbar}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (f.key === 'saved' && filter !== 'saved') setBookmarksLoading(true);
                setFilter(f.key);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '7px 14px',
                borderRadius: 'var(--radius)',
                border: active ? '1px solid var(--brand)' : '1px solid var(--border)',
                background: active ? 'var(--brand)' : 'var(--surface)',
                color: active ? 'var(--on-brand)' : 'var(--text)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <span>{f.label}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          style={{
            padding: '7px 14px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--muted)',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          {refreshing ? '更新中…' : '重新整理'}
        </button>
        <Link
          href={`/community/post/new?schoolId=${encodeURIComponent(schoolId)}`}
          className="btn primary"
          style={{ fontSize: 13, padding: '7px 14px', borderRadius: 'var(--radius)' }}
        >
          ＋ 發文
        </Link>
      </div>

      <div className={styles.feedDiscovery}>
        <label className={styles.feedSearch}>
          搜尋此校動態
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="貼文、標籤、看板或作者"
            autoComplete="off"
          />
        </label>
        <div className={styles.feedOrder} role="group" aria-label="動態排序">
          <button
            type="button"
            aria-pressed={order === 'recommended'}
            onClick={() => setOrder('recommended')}
          >
            {savedView ? '收藏順序' : '推薦'}
          </button>
          <button
            type="button"
            aria-pressed={order === 'latest'}
            onClick={() => setOrder('latest')}
          >
            {savedView ? '貼文最新' : '最新'}
          </button>
        </div>
      </div>
      {!selectedFeedLoading && !selectedFeedError && !(savedView && bookmarkUnavailable) && (
        <p className={styles.feedScope} role="status">
          {savedView
            ? `顯示 ${visible.length} 則 · 本校最近最多 40 筆私人收藏，跨裝置同步`
            : followingView
              ? `顯示 ${visible.length} 則 · 目前載入 ${posts.length} 則貼文中追蹤的作者`
              : `顯示 ${visible.length} 則 · 目前載入 ${posts.length} 則本校動態，搜尋與排序僅適用於這些貼文`}
        </p>
      )}
      {followingError && (
        <div className={styles.feedError} role="alert">
          {followingError}{' '}
          <button type="button" onClick={() => setFollowingRevision((prev) => prev + 1)}>
            重新讀取追蹤
          </button>
        </div>
      )}
      {followingFeedback && (
        <p className={styles.feedError} role="alert">{followingFeedback}</p>
      )}
      {bookmarkUnavailable && (
        <p className={styles.feedScope} role="status">
          {BOOKMARK_UNAVAILABLE_COPY}
        </p>
      )}
      {savedView && bookmarksError && (
        <div className={styles.feedError} role="alert">
          {bookmarksError}{' '}
          <button type="button" onClick={() => setBookmarkRevision((prev) => prev + 1)}>
            重新載入
          </button>
        </div>
      )}

      {/* ── Posts ── */}
      {selectedFeedLoading ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }} role="status">
          {savedView ? '正在讀取收藏…' : followingView ? '正在讀取追蹤動態…' : '載入中…'}
        </div>
      ) : selectedFeedError ? null : visible.length === 0 && !(savedView && bookmarkUnavailable) ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
          {search.trim()
            ? '找不到符合的貼文'
            : filter === 'following'
              ? '追蹤的作者尚無新貼文'
              : filter === 'subscribed'
                ? '尚無已訂閱看板的新貼文'
              : filter === 'media'
                ? '目前沒有圖文貼文'
                : filter === 'saved'
                  ? '還沒有收藏貼文'
                  : '尚無校園貼文'}
          <div className={styles.feedEmptyActions}>
            {search.trim() ? (
              <button type="button" className="btn" onClick={() => setSearch('')}>
                清除搜尋
              </button>
            ) : filter === 'saved' || filter === 'following' ? (
              <button type="button" className="btn primary" onClick={() => setFilter('all')}>
                {filter === 'following' ? '探索其他作者' : '探索校園動態'}
              </button>
            ) : (
              <Link href={`/community/post/new?schoolId=${encodeURIComponent(schoolId)}`} className="btn primary">
                發第一篇貼文
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.feedCards}>
          {visible.map((item) => {
            const liked = !!(
              user &&
              Array.isArray(item.likedBy) &&
              item.likedBy.includes(user.uid)
            );
            const media = mediaOf(item);
            const board = boardNameById[item.boardId] ?? item.boardId;
            const av = !item.anonymous && item.authorUid ? avatarByUid[item.authorUid] : undefined;
            return (
              <article key={item.id} className={`card ${styles.feedCard}`} style={{ padding: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: '50%',
                      background: item.anonymous ? 'var(--panel2)' : 'var(--brand)',
                      color: 'var(--on-brand)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      overflow: 'hidden',
                    }}
                  >
                    {item.anonymous ? (
                      '🎭'
                    ) : av ? (
                      <Image
                        src={av}
                        alt=""
                        width={38}
                        height={38}
                        style={{ borderRadius: '50%' }}
                        unoptimized
                      />
                    ) : (
                      authorLine(item).slice(0, 1)
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                      {authorLine(item)}
                      <span style={{ color: 'var(--muted)', fontWeight: 500, marginLeft: 6 }}>
                        · {formatTs(item.createdAt)}
                      </span>
                    </div>
                    <Link
                      href={`/community/board/${item.boardId}?schoolId=${encodeURIComponent(schoolId)}`}
                      style={{
                        fontSize: 12,
                        color: 'var(--brand)',
                        fontWeight: 700,
                        textDecoration: 'none',
                      }}
                    >
                      ＃{board}
                    </Link>
                  </div>
                  {!item.anonymous &&
                    !followingError &&
                    item.authorUid &&
                    user &&
                    item.authorUid !== user.uid &&
                    validFollowing && (
                      <button
                        type="button"
                        className={styles.authorFollow}
                        aria-label={followedIds.has(item.authorUid) ? `取消追蹤 ${authorLine(item)}` : `追蹤 ${authorLine(item)}`}
                        aria-pressed={followedIds.has(item.authorUid)}
                        disabled={followingLoading || !!followingError || followingPending.has(item.authorUid)}
                        onClick={() => void toggleFollow(item.authorUid!)}
                      >
                        {followedIds.has(item.authorUid) ? '追蹤中' : '追蹤'}
                      </button>
                    )}
                </div>

                <Link
                  href={`/community/post/${item.id}?schoolId=${encodeURIComponent(schoolId)}`}
                  style={{ textDecoration: 'none', color: 'var(--text)', display: 'block' }}
                >
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{item.title}</h3>
                  <p
                    style={{
                      margin: '6px 0 0',
                      fontSize: 14,
                      color: 'var(--muted)',
                      lineHeight: 1.5,
                      display: '-webkit-box',
                      WebkitLineClamp: media.length > 0 ? 3 : 5,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {item.content}
                  </p>
                </Link>

                {media.length > 0 && <MediaGrid uris={media.slice(0, 4)} postId={item.id} schoolId={schoolId} />}

                {(item.tags ?? []).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {(item.tags ?? []).slice(0, 4).map((t) => (
                      <span
                        key={t}
                        style={{
                          fontSize: 11,
                          color: 'var(--brand)',
                          background: 'var(--accent-soft)',
                          padding: '2px 8px',
                          borderRadius: 999,
                          fontWeight: 700,
                        }}
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                <PostActionsRow>
                  <button
                    type="button"
                    aria-label={liked ? '取消按讚' : '按讚'}
                    aria-pressed={liked}
                    disabled={pendingLikes.has(item.id)}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void onToggleLike(item);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      flexWrap: 'nowrap',
                      alignItems: 'center',
                      flexShrink: 0,
                      gap: 5,
                      fontSize: 13,
                      fontWeight: 700,
                      color: liked ? 'var(--danger, var(--danger))' : 'var(--muted)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {liked ? '❤️' : '🤍'} {likesOf(item)}
                  </button>
                  <Link
                    href={`/community/post/${item.id}?schoolId=${encodeURIComponent(schoolId)}`}
                    style={{
                      display: 'inline-flex',
                      flexWrap: 'nowrap',
                      alignItems: 'center',
                      flexShrink: 0,
                      gap: 5,
                      fontSize: 13,
                      fontWeight: 700,
                      color: 'var(--muted)',
                      textDecoration: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    💬 {typeof item.commentCount === 'number' ? item.commentCount : 0}
                  </Link>
                  <PostBookmarkShareActions
                    saved={savedIds.has(item.id)}
                    bookmarkDisabled={bookmarksPending.has(item.id)}
                    bookmarkUnavailable={bookmarkUnavailable}
                    onBookmark={() => void toggleBookmark(item)}
                    onShare={() => void sharePost(item)}
                    shareAriaLabel={`分享貼文：${item.title}`}
                  />
                </PostActionsRow>
                {bookmarkFeedback?.postId === item.id && (
                  <p role="alert" className={styles.feedError}>{bookmarkFeedback.text}</p>
                )}
                {likeFeedback?.postId === item.id && (
                  <p role="alert" className={styles.feedError}>{likeFeedback.text}</p>
                )}
                {shareFeedback?.postId === item.id && (
                  <p role="status" className={styles.shareFeedback}>{shareFeedback.text}</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MediaGrid({ uris, postId, schoolId }: { uris: string[]; postId: string; schoolId: string }) {
  if (uris.length === 1) {
    return (
      <Link
        href={`/community/post/${postId}?schoolId=${encodeURIComponent(schoolId)}`}
        style={{
          display: 'block',
          marginTop: 10,
          borderRadius: 12,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <img
          src={uris[0]}
          alt=""
          style={{
            width: '100%',
            height: 'auto',
            maxHeight: 480,
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </Link>
    );
  }
  return (
    <Link
      href={`/community/post/${postId}?schoolId=${encodeURIComponent(schoolId)}`}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 4,
        marginTop: 10,
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {uris.map((u) => (
        <img
          key={u}
          src={u}
          alt=""
          style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' }}
        />
      ))}
    </Link>
  );
}
