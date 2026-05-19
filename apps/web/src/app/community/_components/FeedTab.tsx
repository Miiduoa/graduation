'use client';

/**
 * 校園社群 — 動態（Web）
 *
 * 對應 mobile/HomeFeedScreen.tsx：
 *  - 頂部 Story 列（橫向卷軸；點 + 我的 Story 跳到 /community/story/new）
 *  - 篩選 chip：全部 / 我訂閱 / 圖文
 *  - 貼文卡片：作者頭像、看板 chip、圖片 grid、點讚、留言、跳 /community/post/[id]
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/components/AuthGuard';
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

type FilterKey = 'all' | 'subscribed' | 'media';

const FILTERS: { key: FilterKey; label: string; icon: string }[] = [
  { key: 'all', label: '全部', icon: '✨' },
  { key: 'subscribed', label: '我訂閱', icon: '🔔' },
  { key: 'media', label: '圖文', icon: '🖼' },
];

function formatTs(t: unknown): string {
  const d = t instanceof Date ? t : typeof (t as any)?.toMillis === 'function' ? new Date((t as any).toMillis()) : null;
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
  return Array.isArray(p.mediaUrls) ? p.mediaUrls.filter((u) => typeof u === 'string' && u.length > 0) : [];
}

export function FeedTab(props: { schoolId: string; schoolSearch: string }) {
  const { schoolId } = props;
  const { user, loading: authLoading } = useAuth();
  const [posts, setPosts] = useState<CampusPostDoc[]>([]);
  const [boards, setBoards] = useState<CampusBoard[]>([]);
  const [stories, setStories] = useState<StoryAuthorGroup[]>([]);
  const [subscribedIds, setSubscribedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterKey>('all');
  const [nameByUid, setNameByUid] = useState<Record<string, string>>({});
  const [avatarByUid, setAvatarByUid] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const likeFlightRef = useRef(false);

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

  useEffect(() => {
    if (authLoading) return;
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [authLoading, load]);

  // hydrate display names for post authors + story authors
  useEffect(() => {
    (async () => {
      const uids = new Set<string>();
      posts.forEach((p) => {
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
  }, [posts, stories, schoolId]);

  const boardNameById = useMemo(() => {
    const m: Record<string, string> = {};
    boards.forEach((b) => {
      m[b.id] = b.name;
    });
    return m;
  }, [boards]);

  const visible = useMemo(() => {
    if (filter === 'subscribed') return posts.filter((p) => subscribedIds.has(p.boardId));
    if (filter === 'media') return posts.filter((p) => mediaOf(p).length > 0);
    return posts;
  }, [posts, filter, subscribedIds]);

  const onToggleLike = useCallback(
    async (row: CampusPostDoc) => {
      if (!user || !schoolId || likeFlightRef.current) return;
      likeFlightRef.current = true;
      setPosts((prev) =>
        prev.map((p) => {
          if (p.id !== row.id) return p;
          const arr = Array.isArray(p.likedBy) ? [...p.likedBy] : [];
          const idx = arr.indexOf(user.uid);
          if (idx >= 0) arr.splice(idx, 1);
          else arr.push(user.uid);
          return {
            ...p,
            likedBy: arr,
            likes: typeof p.likes === 'number' ? p.likes + (idx >= 0 ? -1 : 1) : arr.length,
          };
        }),
      );
      try {
        await toggleCampusPostLike(schoolId, row.id, user.uid);
      } catch (e) {
        console.warn(e);
        await load();
      } finally {
        likeFlightRef.current = false;
      }
    },
    [user, schoolId, load],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const authorLine = (p: CampusPostDoc) => {
    if (p.anonymous) return p.aliasSnapshot ?? '匿名貼文';
    if (!p.authorUid) return '成員';
    return nameByUid[p.authorUid] ?? '載入中…';
  };

  if (!user && !authLoading) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
        請先登入以瀏覽校園動態
      </div>
    );
  }

  return (
    <div>
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
          href="/community/story/new"
          aria-label="發布我的 Story"
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
              color: 'var(--brand, #5856D6)',
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
                aria-label={`查看 ${nameByUid[g.authorUid] ?? g.authorUid.slice(0, 6)} 的 Story`}
              >
                <div
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: '50%',
                    border: '2px solid var(--brand, #5856D6)',
                    padding: 3,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: av ? '#fff' : 'var(--brand, #5856D6)',
                    color: '#fff',
                    overflow: 'hidden',
                    fontSize: 20,
                    fontWeight: 700,
                  }}
                >
                  {av ? (
                    <Image src={av} alt="" width={52} height={52} style={{ borderRadius: '50%' }} unoptimized />
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '7px 14px',
                borderRadius: 999,
                border: active ? '1px solid var(--brand, #5856D6)' : '1px solid var(--border)',
                background: active ? 'var(--brand, #5856D6)' : 'var(--surface)',
                color: active ? '#fff' : 'var(--text)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <span>{f.icon}</span>
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
            borderRadius: 999,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--muted)',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          {refreshing ? '更新中…' : '🔄 重新整理'}
        </button>
        <Link
          href="/community/post/new"
          className="btn primary"
          style={{ fontSize: 13, padding: '7px 14px', borderRadius: 999 }}
        >
          ＋ 發文
        </Link>
      </div>

      {/* ── Posts ── */}
      {loading ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
          載入中…
        </div>
      ) : visible.length === 0 ? (
        <div
          className="card"
          style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}
        >
          {filter === 'subscribed' ? '尚無已訂閱看板的新貼文' : '尚無校園貼文'}
          <div style={{ marginTop: 10 }}>
            <Link href="/community/post/new" className="btn primary">
              發第一篇貼文 →
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visible.map((item) => {
            const liked = !!(user && Array.isArray(item.likedBy) && item.likedBy.includes(user.uid));
            const media = mediaOf(item);
            const board = boardNameById[item.boardId] ?? item.boardId;
            const av = !item.anonymous && item.authorUid ? avatarByUid[item.authorUid] : undefined;
            return (
              <article
                key={item.id}
                className="card"
                style={{ padding: 16, cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: '50%',
                      background: item.anonymous ? 'var(--panel2, #F2F2F7)' : 'var(--brand, #5856D6)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      overflow: 'hidden',
                    }}
                  >
                    {item.anonymous ? '🎭' : av ? (
                      <Image src={av} alt="" width={38} height={38} style={{ borderRadius: '50%' }} unoptimized />
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
                      href={`/community/board/${item.boardId}`}
                      style={{ fontSize: 12, color: 'var(--brand, #5856D6)', fontWeight: 700, textDecoration: 'none' }}
                    >
                      ＃{board}
                    </Link>
                  </div>
                </div>

                <Link
                  href={`/community/post/${item.id}`}
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

                {media.length > 0 && <MediaGrid uris={media.slice(0, 4)} postId={item.id} />}

                {(item.tags ?? []).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {(item.tags ?? []).slice(0, 4).map((t) => (
                      <span
                        key={t}
                        style={{
                          fontSize: 11,
                          color: 'var(--brand, #5856D6)',
                          background: 'rgba(88,86,214,0.10)',
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

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 18,
                    marginTop: 12,
                    paddingTop: 10,
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void onToggleLike(item);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 13,
                      fontWeight: 700,
                      color: liked ? 'var(--danger, #FF3B30)' : 'var(--muted)',
                    }}
                  >
                    {liked ? '❤️' : '🤍'} {likesOf(item)}
                  </button>
                  <Link
                    href={`/community/post/${item.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 13,
                      fontWeight: 700,
                      color: 'var(--muted)',
                      textDecoration: 'none',
                    }}
                  >
                    💬 {typeof item.commentCount === 'number' ? item.commentCount : 0}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MediaGrid({ uris, postId }: { uris: string[]; postId: string }) {
  if (uris.length === 1) {
    return (
      <Link
        href={`/community/post/${postId}`}
        style={{ display: 'block', marginTop: 10, borderRadius: 12, overflow: 'hidden', position: 'relative' }}
      >
        <img
          src={uris[0]}
          alt=""
          style={{ width: '100%', height: 'auto', maxHeight: 480, objectFit: 'cover', display: 'block' }}
        />
      </Link>
    );
  }
  return (
    <Link
      href={`/community/post/${postId}`}
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
