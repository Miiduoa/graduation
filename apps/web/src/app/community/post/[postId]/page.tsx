'use client';

/**
 * 校園社群 — 貼文詳情（Web）
 *
 * 對應 mobile/PostDetailScreen：
 *  - 圖片 grid
 *  - 留言 threaded
 *  - 按讚 / 留言 / 分享 / 檢舉 / 自貼文編輯與刪除
 *  - 軟刪除自留言
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CommunityAccess } from '../../_components/CommunityAccess';
import { ReportPostDialog, type ReportPostSubmitPayload } from '../../_components/ReportPostDialog';
import { SiteShell } from '@/components/SiteShell';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import {
  COMMUNITY_FORM_PENDING_COPY,
  useCommunityFormSession,
  type CommunityFormCloseReason,
} from '../../_components/useCommunityFormSession';
import formStyles from '../../_components/CommunityForm.module.css';
import modalStyles from '@/components/ui/Modal.module.css';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useAuth } from '@/components/AuthGuard';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import { PostActionsRow, PostBookmarkShareActions } from '../../_components/PostActionBar';
import {
  BOOKMARK_UNAVAILABLE_COPY,
  isCampusPostBookmarked,
  saveCampusPostBookmark,
  removeCampusPostBookmark,
} from '@/lib/community/bookmarks';
import { isPermissionDeniedError } from '@campus/shared/src/signedInSocialReads';
import {
  addCampusReply,
  deleteCampusPost,
  fetchSchoolDirectoryProfiles,
  flattenCampusRepliesThread,
  getCampusPostById,
  getOrCreateBoardAlias,
  listCampusReplies,
  softDeleteCampusReply,
  submitCampusReport,
  toggleCampusPostLike,
  updateCampusPost,
  type CampusPostDoc,
  type CampusReply,
} from '@/lib/community/firestore';

export default function PostDetailPage() {
  const { schoolId, schoolName, ready } = useBrowsingSchoolPageContext();
  const { user } = useAuth();
  const params = useParams<{ postId: string }>();
  return (
    <SiteShell title="貼文" subtitle="校園交流" schoolName={ready ? schoolName : undefined}>
      {ready ? (
        <CommunityAccess>
          <PostDetailInner
            key={`${schoolId}:${params?.postId ?? ''}:${user?.uid ?? ''}`}
            schoolId={schoolId}
          />
        </CommunityAccess>
      ) : (
        <SchoolScopePlaceholder />
      )}
    </SiteShell>
  );
}

function PostDetailInner({ schoolId }: { schoolId: string }) {
  const router = useRouter();
  const params = useParams<{ postId: string }>();
  const postId = params?.postId;
  const { user } = useAuth();

  const [post, setPost] = useState<CampusPostDoc | null>(null);
  const postReads = useRef({ started: 0, settled: 0, confirmed: 0 });
  const postDeletion = useRef<'pending' | 'confirmed' | null>(null);
  const replyDeletions = useRef(new Map<string, 'pending' | 'confirmed'>());
  const replyReads = useRef({ started: 0, settled: 0, confirmed: 0 });
  const [editNeedsRefresh, setEditNeedsRefresh] = useState(false);
  const [postRefreshError, setPostRefreshError] = useState(false);
  const [repliesRefreshError, setRepliesRefreshError] = useState(false);
  const refreshError = postRefreshError || repliesRefreshError;
  const editBlocked = editNeedsRefresh || postRefreshError;
  const [likeNeedsRefresh, setLikeNeedsRefresh] = useState(false);
  const [replies, setReplies] = useState<CampusReply[]>([]);
  const [nameByUid, setNameByUid] = useState<Record<string, string>>({});
  const [avatarByUid, setAvatarByUid] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyAnonymous, setReplyAnonymous] = useState(true);
  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [editSession, setEditSession] = useState<{ scope: string; open: boolean } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [bookmarkState, setBookmarkState] = useState<{ scope: string; saved: boolean } | null>(
    null,
  );
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [bookmarkError, setBookmarkError] = useState('');
  const [bookmarkUnavailable, setBookmarkUnavailable] = useState(false);
  const [bookmarkRevision, setBookmarkRevision] = useState(0);
  const bookmarkScope = `${user?.uid ?? ''}:${schoolId}:${postId ?? ''}`;
  const bookmarkReady = bookmarkState?.scope === bookmarkScope;
  const saved = bookmarkReady ? bookmarkState.saved : false;

  useEffect(() => {
    const uid = user?.uid;
    if (!uid || !schoolId || !postId) return;
    let live = true;
    void isCampusPostBookmarked(uid, schoolId, postId)
      .then((value) => {
        if (!live) return;
        setBookmarkState({ scope: `${uid}:${schoolId}:${postId}`, saved: value });
        setBookmarkUnavailable(false);
        setBookmarkError('');
      })
      .catch((error) => {
        if (!live) return;
        if (isPermissionDeniedError(error)) {
          setBookmarkState({ scope: `${uid}:${schoolId}:${postId}`, saved: false });
          setBookmarkUnavailable(true);
          setBookmarkError('');
          return;
        }
        setBookmarkUnavailable(false);
        setBookmarkError('無法讀取收藏狀態，請確認校籍與連線。');
      });
    return () => {
      live = false;
    };
  }, [user?.uid, schoolId, postId, bookmarkRevision]);

  const onToggleBookmark = async () => {
    if (!user?.uid || !postId || !bookmarkReady || bookmarkBusy || bookmarkUnavailable) return;
    const uid = user.uid;
    setBookmarkBusy(true);
    setBookmarkError('');
    try {
      if (saved) await removeCampusPostBookmark(uid, schoolId, postId);
      else await saveCampusPostBookmark(uid, schoolId, postId);
      setBookmarkState({ scope: `${uid}:${schoolId}:${postId}`, saved: !saved });
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        setBookmarkUnavailable(true);
        setBookmarkError('');
      } else {
        setBookmarkError('這次收藏未成功更新，請確認校籍與連線後重試。');
      }
    } finally {
      setBookmarkBusy(false);
    }
  };

  const loadPost = useCallback(async (source: 'default' | 'server' = 'server') => {
    if (!postId || !schoolId) return;
    const reads = postReads.current;
    const request = ++reads.started;
    // A read started before the latest confirmed write cannot replace its result.
    const isCurrent = () =>
      postDeletion.current !== 'confirmed' && request > Math.max(reads.settled, reads.confirmed);
    try {
      const row = await getCampusPostById(schoolId, postId, source);
      if (!isCurrent()) return;
      reads.settled = request;
      setPost(row ? { ...row, title: row.title ?? '' } : null);
      setPostRefreshError(false);
      setEditNeedsRefresh(false);
      setLikeNeedsRefresh(false);
    } catch (error) {
      if (source === 'default') throw error;
      if (!isCurrent()) return;
      reads.settled = request;
      setPostRefreshError(true);
    }
  }, [postId, schoolId]);

  const loadReplies = useCallback(async (source: 'default' | 'server' = 'server') => {
    if (!postId || !schoolId) return;
    const reads = replyReads.current;
    const request = ++reads.started;
    const isCurrent = () => request > Math.max(reads.settled, reads.confirmed);
    try {
      const rows = await listCampusReplies(schoolId, postId, source);
      if (!isCurrent()) return;
      reads.settled = request;
      setReplies(rows.map((reply) =>
        replyDeletions.current.get(reply.id) === 'confirmed' ? deletedReply(reply) : reply,
      ));
      setRepliesRefreshError(false);
    } catch (error) {
      if (source === 'default') throw error;
      if (!isCurrent()) return;
      reads.settled = request;
      setRepliesRefreshError(true);
    }
  }, [postId, schoolId]);

  const refreshThreadAfterWrite = async () => {
    postReads.current.confirmed = postReads.current.started;
    replyReads.current.confirmed = replyReads.current.started;
    await Promise.all([loadPost(), loadReplies()]);
  };

  const hydrateProfiles = useCallback(async () => {
    if (!schoolId) return;
    const uids = new Set<string>();
    if (post && !post.anonymous && post.authorUid) uids.add(post.authorUid);
    replies.forEach((r) => {
      if (!r.anonymous && r.authorUid) uids.add(r.authorUid as string);
    });
    if (uids.size === 0) {
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
  }, [schoolId, post, replies]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await Promise.all([loadPost('default'), loadReplies('default')]);
      } catch {
        setLoadError('無法讀取貼文，請確認連線與學校資格後重試。');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadPost, loadReplies]);

  useEffect(() => {
    void hydrateProfiles().catch(() => {
      setNameByUid({});
      setAvatarByUid({});
    });
  }, [hydrateProfiles]);

  const threaded = useMemo(() => flattenCampusRepliesThread(replies), [replies]);
  const isMine = !!(post && !post.anonymous && post.authorUid && post.authorUid === user?.uid);

  const submitReply = async () => {
    if (!user?.uid || !schoolId || !postId || sendingReply || postDeletion.current || !replyText.trim()) return;
    if (replyParentId && replyDeletions.current.has(replyParentId)) return;
    setSendingReply(true);
    const boardForAlias = post?.boardId ?? 'general';
    let aliasSnap: string | undefined;
    if (replyAnonymous) {
      try {
        aliasSnap = await getOrCreateBoardAlias(user.uid, schoolId, boardForAlias);
      } catch {
        aliasSnap = '匿名';
      }
    }
    try {
      let depth = 0;
      if (replyParentId) {
        const parent = replies.find((r) => r.id === replyParentId);
        depth = (typeof parent?.depth === 'number' ? parent.depth : 0) + 1;
      }
      await addCampusReply(schoolId, postId, {
        anonymous: replyAnonymous,
        ...(replyAnonymous ? { aliasSnapshot: aliasSnap } : { authorUid: user.uid }),
        content: replyText.trim(),
        parentReplyId: replyParentId,
        depth,
      });
      setReplyText('');
      setReplyParentId(null);
      await refreshThreadAfterWrite();
    } catch {
      alert('這次未能送出，請稍後再試。');
    } finally {
      setSendingReply(false);
    }
  };

  const onToggleLike = async () => {
    if (!user?.uid || !schoolId || !postId || likeBusy || likeNeedsRefresh || postDeletion.current) return;
    setLikeBusy(true);
    try {
      await toggleCampusPostLike(schoolId, postId, user.uid);
      postReads.current.confirmed = postReads.current.started;
      setLikeNeedsRefresh(true);
      await loadPost();
    } catch {
      alert('這次未能按讚，請稍後再試。');
    } finally {
      setLikeBusy(false);
    }
  };

  const onDeletePost = () => {
    if (!schoolId || !postId || postDeletion.current) return;
    if (!confirm('確定要刪除這篇貼文？此操作不可復原。')) return;
    postDeletion.current = 'pending';
    void (async () => {
      try {
        await deleteCampusPost(schoolId, postId);
      } catch {
        postDeletion.current = null;
        alert('這次未能刪除，請稍後再試。');
        return;
      }
      postDeletion.current = 'confirmed';
      setPost(null);
      alert('已刪除');
      router.push(`/community?schoolId=${encodeURIComponent(schoolId)}`);
    })();
  };

  const onReport = () => {
    if (!user?.uid || !schoolId || !postId) return;
    setReportOpen(true);
  };

  const submitReport = async (payload: ReportPostSubmitPayload) => {
    if (!user?.uid || !schoolId || !postId) throw new Error('missing report context');
    await submitCampusReport({
      schoolId,
      reporterUid: user.uid,
      targetType: 'post',
      targetId: postId,
      reason: payload.reason,
      ...(payload.detail ? { detail: payload.detail } : {}),
    });
  };

  const onDeleteReply = (r: CampusReply) => {
    if (!schoolId || !postId || postDeletion.current || r.deleted || replyDeletions.current.has(r.id)) return;
    if (!confirm('確定要刪除這則留言？')) return;
    replyDeletions.current.set(r.id, 'pending');
    void (async () => {
      try {
        await softDeleteCampusReply(schoolId, postId, r.id);
      } catch {
        replyDeletions.current.delete(r.id);
        alert('這次未能刪除，請稍後再試。');
        return;
      }
      replyDeletions.current.set(r.id, 'confirmed');
      setReplies((current) => current.map((reply) => reply.id === r.id ? deletedReply(reply) : reply));
      setReplyParentId((current) => current === r.id ? null : current);
      await refreshThreadAfterWrite();
    })();
  };

  const onShare = async () => {
    if (!postId || !post) return;
    const url = `${window.location.origin}/community/post/${encodeURIComponent(postId)}?schoolId=${encodeURIComponent(schoolId)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: post.title, text: post.content, url });
        return;
      } catch {
        /* fall through */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      alert('已複製連結');
    } catch {
      alert(`連結：${url}`);
    }
  };

  if (loadError)
    return (
      <div role="alert" className="card" style={{ padding: 24 }}>
        <p>{loadError}</p>
        <button
          className="btn"
          onClick={() => {
            setLoadError('');
            setLoading(true);
            void Promise.all([loadPost('default'), loadReplies('default')])
              .catch(() => setLoadError('無法讀取貼文，請稍後重試。'))
              .finally(() => setLoading(false));
          }}
        >
          重試
        </button>
      </div>
    );

  if (loading) {
    return (
      <div className="card" style={{ padding: 24 }}>
        載入中…
      </div>
    );
  }
  if (!post) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
        找不到貼文，可能已被刪除。
        <div style={{ marginTop: 10 }}>
          <Link href="/community" className="btn">
            返回動態
          </Link>
        </div>
      </div>
    );
  }

  const likes =
    typeof post.likes === 'number'
      ? post.likes
      : Array.isArray(post.likedBy)
        ? post.likedBy.length
        : 0;
  const cc = typeof post.commentCount === 'number' ? post.commentCount : replies.length;
  const liked = !!(user && Array.isArray(post.likedBy) && post.likedBy.includes(user.uid));
  const media = Array.isArray(post.mediaUrls) ? post.mediaUrls : [];
  const av = !post.anonymous && post.authorUid ? avatarByUid[post.authorUid] : undefined;
  const authorName = post.anonymous
    ? (post.aliasSnapshot ?? '匿名貼文')
    : post.authorUid
      ? (nameByUid[post.authorUid] ?? '載入中…')
      : '成員';

  return (
    <div style={{ maxWidth: 720 }}>
      {editNeedsRefresh && !refreshError && <p role="status">正在重新讀取貼文，更新後即可編輯。</p>}
      {refreshError && (
        <p role="status">
          操作已完成，但部分資料無法更新。{' '}
          {editBlocked && '請重新讀取貼文後再編輯。 '}
          <button
            type="button"
            onClick={() => {
              void Promise.all([loadPost(), loadReplies()]);
            }}
          >
            重新讀取
          </button>
        </p>
      )}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: post.anonymous ? 'var(--panel2)' : 'var(--brand)',
              color: post.anonymous ? 'var(--text)' : 'var(--on-brand)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              overflow: 'hidden',
            }}
          >
            {post.anonymous ? (
              '🎭'
            ) : av ? (
              <img src={av} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              authorName.slice(0, 1)
            )}
          </div>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            {!post.anonymous && post.authorUid ? (
              <Link
                href={`/community/member/${encodeURIComponent(post.authorUid)}?schoolId=${encodeURIComponent(schoolId)}`}
                aria-label={`查看 ${authorName} 的個人頁`}
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                {authorName}
              </Link>
            ) : (
              authorName
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {isMine ? (
              <>
                <button
                  type="button"
                  disabled={editBlocked}
                  onClick={() => setEditSession({ scope: bookmarkScope, open: true })}
                  style={btnGhost}
                >
                  ✏️ 編輯
                </button>
                <button
                  type="button"
                  onClick={onDeletePost}
                  style={{ ...btnGhost, color: 'var(--danger, var(--danger))' }}
                >
                  🗑 刪除
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onReport}
                style={{ ...btnGhost, color: 'var(--danger, var(--danger))' }}
              >
                檢舉
              </button>
            )}
          </div>
        </div>

        <h1 style={{ margin: '12px 0 4px', fontSize: 22, fontWeight: 700 }}>{post.title}</h1>
        {post.content && (
          <p
            style={{
              margin: '8px 0 0',
              fontSize: 16,
              lineHeight: 1.6,
              color: 'var(--text)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {post.content}
          </p>
        )}

        {media.length > 0 && (
          <div
            style={{
              display: media.length === 1 ? 'block' : 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 4,
              marginTop: 12,
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            {media.map((u) => (
              <img
                key={u}
                src={u}
                alt=""
                style={{
                  width: '100%',
                  height: media.length === 1 ? 'auto' : undefined,
                  aspectRatio: media.length === 1 ? undefined : '1 / 1',
                  maxHeight: media.length === 1 ? 540 : undefined,
                  objectFit: 'cover',
                  display: 'block',
                }}
              />
            ))}
          </div>
        )}

        {(post.tags ?? []).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {(post.tags ?? []).map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 12,
                  color: 'var(--brand)',
                  background: 'var(--accent-soft)',
                  padding: '3px 10px',
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
          <button type="button" onClick={onToggleLike} disabled={likeBusy || likeNeedsRefresh} style={statChip}>
            <span style={{ color: liked ? 'var(--danger, var(--danger))' : 'var(--muted)' }}>
              {liked ? '❤️' : '🤍'}
            </span>
            <span
              style={{
                fontWeight: 700,
                color: liked ? 'var(--danger, var(--danger))' : 'var(--muted)',
              }}
            >
              {likes}
            </span>
          </button>
          <div style={statChip}>
            <span>💬</span>
            <span style={{ fontWeight: 700, color: 'var(--muted)' }}>{cc}</span>
          </div>
          <PostBookmarkShareActions
            saved={saved}
            bookmarkDisabled={!bookmarkReady || bookmarkBusy}
            bookmarkUnavailable={bookmarkUnavailable}
            onBookmark={() => void onToggleBookmark()}
            onShare={() => void onShare()}
            shareAriaLabel="分享"
          />
        </PostActionsRow>
        {bookmarkUnavailable && (
          <p role="status" style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 13 }}>
            {BOOKMARK_UNAVAILABLE_COPY}
          </p>
        )}
        {bookmarkError && (
          <p role="alert" style={{ margin: '8px 0 0', color: 'var(--danger)', fontSize: 13 }}>
            {bookmarkError}{' '}
            <button type="button" onClick={() => setBookmarkRevision((prev) => prev + 1)}>
              重試
            </button>
          </p>
        )}
      </div>

      {/* Replies */}
      <div style={{ marginTop: 18 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700 }}>
          討論串 · {threaded.length}
        </h2>
        {threaded.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>尚無留言，當第一人吧。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {threaded.map((r) => {
              const isMyReply = !r.anonymous && r.authorUid === user?.uid;
              const deleted = r.deleted === true;
              const who = r.anonymous
                ? (r.aliasSnapshot ?? '匿名')
                : r.authorUid
                  ? (nameByUid[r.authorUid] ?? r.authorUid.slice(0, 8))
                  : '成員';
              return (
                <div
                  key={r.id}
                  className="card"
                  style={{
                    padding: 12,
                    marginLeft: Math.min(r.threadDepth, 6) * 16,
                    opacity: deleted ? 0.6 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>
                      {who}
                    </div>
                    {!deleted && (
                      <>
                        <button
                          type="button"
                          onClick={() => setReplyParentId(r.id)}
                          style={btnGhost}
                        >
                          回覆
                        </button>
                        {isMyReply && (
                          <button
                            type="button"
                            onClick={() => onDeleteReply(r)}
                            style={{ ...btnGhost, color: 'var(--danger, var(--danger))' }}
                          >
                            刪除
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      color: 'var(--text)',
                      marginTop: 6,
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {r.content}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Compose reply */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>寫留言</div>
          {replyParentId && (
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--muted)' }}>正在回覆⋯</span>
              <button type="button" onClick={() => setReplyParentId(null)} style={btnGhost}>
                取消
              </button>
            </div>
          )}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              marginBottom: 8,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={replyAnonymous}
              onChange={(e) => setReplyAnonymous(e.target.checked)}
            />
            匿名留言
          </label>
          <textarea
            className="input"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={3}
            placeholder="輸入留言⋯"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              type="button"
              className="btn primary"
              disabled={sendingReply || !replyText.trim()}
              onClick={() => void submitReply()}
            >
              {sendingReply ? '送出中…' : '送出留言'}
            </button>
          </div>
        </div>
      </div>

      {editSession?.scope === bookmarkScope && isMine && post.id === postId && (
        <EditPostModal
          key={bookmarkScope}
          open={editSession.open}
          initial={{
            title: post.title,
            content: post.content,
            tagsRaw: (post.tags ?? []).join(', '),
          }}
          onClose={(reason) =>
            setEditSession(reason === 'pending' ? { scope: bookmarkScope, open: false } : null)
          }
          onSubmit={(patch) => updateCampusPost(schoolId, postId, patch)}
          onSaved={(patch) => {
            postReads.current.confirmed = postReads.current.started;
            setEditNeedsRefresh(true);
            setEditSession(null);
            setPost((current) => (current?.id === postId ? { ...current, ...patch } : current));
            void loadPost();
          }}
        />
      )}

      <ReportPostDialog
        isOpen={reportOpen}
        onClose={() => setReportOpen(false)}
        onSubmit={submitReport}
      />
    </div>
  );
}

function deletedReply(reply: CampusReply): CampusReply {
  return { ...reply, deleted: true, content: '（此留言已被作者刪除）' };
}

type EditPostPatch = { title: string; content: string; tags: string[] };

function EditPostModal(props: {
  open: boolean;
  initial: { title: string; content: string; tagsRaw: string };
  onClose: (reason: CommunityFormCloseReason) => void;
  onSubmit: (patch: EditPostPatch) => Promise<void>;
  onSaved: (patch: EditPostPatch) => void;
}) {
  const [title, setTitle] = useState(props.initial.title);
  const [content, setContent] = useState(props.initial.content);
  const [tagsRaw, setTagsRaw] = useState(props.initial.tagsRaw);
  const titleRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const session = useCommunityFormSession(props.onClose);

  function submit() {
    if (session.busy) return;
    const patch = {
      title: title.trim(),
      content: content.trim(),
      tags: tagsRaw
        .split(/[,，、\s]+/)
        .map((tag) => tag.trim().replace(/^#/, ''))
        .filter(Boolean)
        .slice(0, 5),
    };
    void session.submit(
      () => props.onSubmit(patch),
      () => props.onSaved(patch),
      '暫時無法確認儲存結果，修改內容已保留。請先查看貼文，再決定是否重試。',
    );
  }

  return (
    <Modal
      isOpen={props.open}
      onClose={session.requestClose}
      title="編輯貼文"
      size="lg"
      initialFocusRef={titleRef}
      showCloseButton={!session.busy}
      closeOnEsc={session.canClose}
      closeOnOverlayClick={session.canClose}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={session.requestClose}
            disabled={!session.canClose}
          >
            {session.busy && session.slow ? '先關閉' : '取消'}
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={session.busy}>
            {session.busy ? '儲存中…' : '儲存'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset className={formStyles.fields} disabled={session.busy}>
          <Input
            ref={titleRef}
            label="標題"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Textarea
            label="內文"
            value={content}
            rows={6}
            onChange={(event) => setContent(event.target.value)}
          />
          <Input
            label="標籤（逗號分隔）"
            value={tagsRaw}
            hint="最多 5 個標籤。"
            onChange={(event) => setTagsRaw(event.target.value)}
          />
        </fieldset>
        {session.busy && (
          <p role="status" className={modalStyles.notice}>
            {session.slow ? COMMUNITY_FORM_PENDING_COPY : '正在儲存，請稍候。'}
          </p>
        )}
        {session.error && (
          <p role="alert" className={modalStyles.error}>
            {session.error}
          </p>
        )}
      </form>
    </Modal>
  );
}

const btnGhost: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--brand)',
  padding: '4px 6px',
};

const statChip: React.CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'row',
  flexWrap: 'nowrap',
  alignItems: 'center',
  flexShrink: 0,
  gap: 6,
  background: 'var(--surface)',
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  cursor: 'pointer',
  fontSize: 13,
  whiteSpace: 'nowrap',
};
