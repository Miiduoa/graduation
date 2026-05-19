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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { resolveSchoolPageContext } from '@/lib/pageContext';
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
  return (
    <SiteShell title="貼文" subtitle="校園社群">
      <PostDetailInner />
    </SiteShell>
  );
}

function PostDetailInner() {
  const router = useRouter();
  const params = useParams<{ postId: string }>();
  const postId = params?.postId;
  const { user } = useAuth();
  const { schoolId } = useMemo(() => resolveSchoolPageContext({}), []);

  const [post, setPost] = useState<CampusPostDoc | null>(null);
  const [replies, setReplies] = useState<CampusReply[]>([]);
  const [nameByUid, setNameByUid] = useState<Record<string, string>>({});
  const [avatarByUid, setAvatarByUid] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [replyAnonymous, setReplyAnonymous] = useState(true);
  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const loadPost = useCallback(async () => {
    if (!postId || !schoolId) return;
    const row = await getCampusPostById(schoolId, postId);
    setPost(row);
  }, [postId, schoolId]);

  const loadReplies = useCallback(async () => {
    if (!postId || !schoolId) return;
    const rows = await listCampusReplies(schoolId, postId);
    setReplies(rows);
  }, [postId, schoolId]);

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
      await Promise.all([loadPost(), loadReplies()]);
      setLoading(false);
    })();
  }, [loadPost, loadReplies]);

  useEffect(() => {
    void hydrateProfiles();
  }, [hydrateProfiles]);

  const threaded = useMemo(() => flattenCampusRepliesThread(replies), [replies]);
  const isMine = !!(post && !post.anonymous && post.authorUid && post.authorUid === user?.uid);

  const submitReply = async () => {
    if (!user?.uid || !schoolId || !postId || !replyText.trim()) return;
    const boardForAlias = post?.boardId ?? 'general';
    let aliasSnap: string | undefined;
    if (replyAnonymous) {
      try {
        aliasSnap = await getOrCreateBoardAlias(user.uid, schoolId, boardForAlias);
      } catch {
        aliasSnap = '匿名';
      }
    }
    setSendingReply(true);
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
      await Promise.all([loadReplies(), loadPost()]);
    } catch (e: any) {
      alert(`送出失敗：${e?.message ?? String(e)}`);
    } finally {
      setSendingReply(false);
    }
  };

  const onToggleLike = async () => {
    if (!user?.uid || !schoolId || !postId) return;
    setLikeBusy(true);
    try {
      await toggleCampusPostLike(schoolId, postId, user.uid);
      await loadPost();
    } catch (e: any) {
      alert(`按讚失敗：${e?.message ?? String(e)}`);
    } finally {
      setLikeBusy(false);
    }
  };

  const onDeletePost = () => {
    if (!schoolId || !postId) return;
    if (!confirm('確定要刪除這篇貼文？此操作不可復原。')) return;
    void (async () => {
      try {
        await deleteCampusPost(schoolId, postId);
        alert('已刪除');
        router.push('/community');
      } catch (e: any) {
        alert(`刪除失敗：${e?.message ?? String(e)}`);
      }
    })();
  };

  const onReport = () => {
    if (!user?.uid || !schoolId || !postId) return;
    const reason = prompt('檢舉原因（騷擾、垃圾訊息或其他）：', '其他違規');
    if (!reason) return;
    void (async () => {
      try {
        await submitCampusReport({
          schoolId,
          reporterUid: user.uid,
          targetType: 'post',
          targetId: postId,
          reason,
        });
        alert('已送出檢舉');
      } catch (e: any) {
        alert(`檢舉失敗：${e?.message ?? String(e)}`);
      }
    })();
  };

  const onDeleteReply = (r: CampusReply) => {
    if (!schoolId || !postId) return;
    if (!confirm('確定要刪除這則留言？')) return;
    void (async () => {
      try {
        await softDeleteCampusReply(schoolId, postId, r.id);
        await Promise.all([loadReplies(), loadPost()]);
      } catch (e: any) {
        alert(`刪除失敗：${e?.message ?? String(e)}`);
      }
    })();
  };

  const onShare = async () => {
    if (!postId || !post) return;
    const url = `${window.location.origin}/community/post/${postId}`;
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

  if (loading) {
    return <div className="card" style={{ padding: 24 }}>載入中…</div>;
  }
  if (!post) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
        找不到貼文，可能已被刪除。
        <div style={{ marginTop: 10 }}>
          <Link href="/community" className="btn">返回動態</Link>
        </div>
      </div>
    );
  }

  const likes =
    typeof post.likes === 'number' ? post.likes : Array.isArray(post.likedBy) ? post.likedBy.length : 0;
  const cc = typeof post.commentCount === 'number' ? post.commentCount : replies.length;
  const liked = !!(user && Array.isArray(post.likedBy) && post.likedBy.includes(user.uid));
  const media = Array.isArray(post.mediaUrls) ? post.mediaUrls : [];
  const av = !post.anonymous && post.authorUid ? avatarByUid[post.authorUid] : undefined;
  const authorName = post.anonymous
    ? post.aliasSnapshot ?? '匿名貼文'
    : post.authorUid
      ? nameByUid[post.authorUid] ?? '載入中…'
      : '成員';

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: post.anonymous ? 'var(--panel2, #F2F2F7)' : 'var(--brand, #5856D6)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              overflow: 'hidden',
            }}
          >
            {post.anonymous ? '🎭' : av ? (
              <img src={av} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              authorName.slice(0, 1)
            )}
          </div>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{authorName}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {isMine ? (
              <>
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  style={btnGhost}
                >
                  ✏️ 編輯
                </button>
                <button
                  type="button"
                  onClick={onDeletePost}
                  style={{ ...btnGhost, color: 'var(--danger, #FF3B30)' }}
                >
                  🗑 刪除
                </button>
              </>
            ) : (
              <button type="button" onClick={onReport} style={{ ...btnGhost, color: 'var(--danger, #FF3B30)' }}>
                檢舉
              </button>
            )}
          </div>
        </div>

        <h1 style={{ margin: '12px 0 4px', fontSize: 22, fontWeight: 700 }}>{post.title}</h1>
        {post.content && (
          <p style={{ margin: '8px 0 0', fontSize: 16, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
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
                  color: 'var(--brand, #5856D6)',
                  background: 'rgba(88,86,214,0.12)',
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <button type="button" onClick={onToggleLike} disabled={likeBusy} style={statChip}>
            <span style={{ color: liked ? 'var(--danger, #FF3B30)' : 'var(--muted)' }}>
              {liked ? '❤️' : '🤍'}
            </span>
            <span style={{ fontWeight: 700, color: liked ? 'var(--danger, #FF3B30)' : 'var(--muted)' }}>{likes}</span>
          </button>
          <div style={statChip}>
            <span>💬</span>
            <span style={{ fontWeight: 700, color: 'var(--muted)' }}>{cc}</span>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onShare} style={statChip}>
            <span>🔗</span>
            <span style={{ fontWeight: 700, color: 'var(--muted)' }}>分享</span>
          </button>
        </div>
      </div>

      {/* Replies */}
      <div style={{ marginTop: 18 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700 }}>討論串 · {threaded.length}</h2>
        {threaded.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>尚無留言，當第一人吧。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {threaded.map((r) => {
              const isMyReply = !r.anonymous && r.authorUid === user?.uid;
              const deleted = r.deleted === true;
              const who = r.anonymous
                ? r.aliasSnapshot ?? '匿名'
                : r.authorUid
                  ? nameByUid[r.authorUid] ?? r.authorUid.slice(0, 8)
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
                    <div style={{ flex: 1, fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>{who}</div>
                    {!deleted && (
                      <>
                        <button type="button" onClick={() => setReplyParentId(r.id)} style={btnGhost}>
                          回覆
                        </button>
                        {isMyReply && (
                          <button
                            type="button"
                            onClick={() => onDeleteReply(r)}
                            style={{ ...btnGhost, color: 'var(--danger, #FF3B30)' }}
                          >
                            刪除
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--text)', marginTop: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={replyAnonymous} onChange={(e) => setReplyAnonymous(e.target.checked)} />
            匿名留言
          </label>
          <textarea
            className="input"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={3}
            placeholder="輸入留言⋯"
            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
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

      {editOpen && (
        <EditPostModal
          initial={{ title: post.title, content: post.content, tagsRaw: (post.tags ?? []).join(', ') }}
          onClose={() => setEditOpen(false)}
          onSubmit={async (patch) => {
            if (!schoolId || !postId) return;
            const tags = patch.tagsRaw
              .split(/[,，、\s]+/)
              .map((t) => t.trim().replace(/^#/, ''))
              .filter(Boolean)
              .slice(0, 5);
            await updateCampusPost(schoolId, postId, {
              title: patch.title.trim(),
              content: patch.content.trim(),
              tags,
            });
            setEditOpen(false);
            await loadPost();
          }}
        />
      )}
    </div>
  );
}

function EditPostModal(props: {
  initial: { title: string; content: string; tagsRaw: string };
  onClose: () => void;
  onSubmit: (patch: { title: string; content: string; tagsRaw: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState(props.initial.title);
  const [content, setContent] = useState(props.initial.content);
  const [tagsRaw, setTagsRaw] = useState(props.initial.tagsRaw);
  const [busy, setBusy] = useState(false);

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={props.onClose}
    >
      <div className="card" style={{ padding: 24, width: '100%', maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>編輯貼文</h2>
          <button
            type="button"
            onClick={props.onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}
          >
            ×
          </button>
        </div>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginTop: 14, marginBottom: 6 }}>標題</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%' }} />

        <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginTop: 14, marginBottom: 6 }}>內文</label>
        <textarea
          className="input"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
        />

        <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginTop: 14, marginBottom: 6 }}>標籤（逗號分隔）</label>
        <input className="input" value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} style={{ width: '100%' }} />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button type="button" className="btn" onClick={props.onClose}>取消</button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await props.onSubmit({ title, content, tagsRaw });
              } catch (e: any) {
                alert(`儲存失敗：${e?.message ?? String(e)}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  );
}

const btnGhost: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--brand, #5856D6)',
  padding: '4px 6px',
};

const statChip: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: 'var(--surface)',
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  cursor: 'pointer',
  fontSize: 13,
};
