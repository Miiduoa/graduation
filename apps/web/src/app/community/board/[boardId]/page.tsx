'use client';

/**
 * 校園社群 — 看板詳情（Web）
 *
 * 對應 mobile/BoardDetailScreen：板規 / 訂閱 toggle / 發文按鈕 / 該板貼文列表
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import {
  CAMPUS_BOARD_TYPE_LABEL,
  fetchRecentCampusPosts,
  getBoardById,
  listSubscribedBoardIds,
  rankFeedPosts,
  subscribeToBoard,
  unsubscribeFromBoard,
  type CampusBoard,
  type CampusBoardType,
  type CampusPostDoc,
} from '@/lib/community/firestore';

async function checkIsSubscribed(uid: string, schoolId: string, boardId: string) {
  const arr = await listSubscribedBoardIds(uid, schoolId);
  return arr.includes(boardId);
}

export default function BoardDetailPage() {
  return (
    <SiteShell title="看板" subtitle="校園社群">
      <BoardDetailInner />
    </SiteShell>
  );
}

function BoardDetailInner() {
  const params = useParams<{ boardId: string }>();
  const boardId = params?.boardId;
  const { user } = useAuth();
  const { schoolId } = useMemo(() => resolveSchoolPageContext({}), []);

  const [board, setBoard] = useState<CampusBoard | null>(null);
  const [posts, setPosts] = useState<CampusPostDoc[]>([]);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!boardId || !schoolId) return;
    const [b, list, isSub] = await Promise.all([
      getBoardById(schoolId, boardId),
      fetchRecentCampusPosts(schoolId, boardId, 45),
      user?.uid ? checkIsSubscribed(user.uid, schoolId, boardId) : Promise.resolve(false),
    ]);
    setBoard(b);
    setPosts(rankFeedPosts(list, 50));
    setSubscribed(isSub);
  }, [boardId, schoolId, user]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  const toggleSub = async () => {
    if (!user?.uid || !schoolId || !boardId) {
      alert('請先登入');
      return;
    }
    try {
      if (subscribed) await unsubscribeFromBoard(user.uid, schoolId, boardId);
      else await subscribeToBoard(user.uid, schoolId, boardId);
      setSubscribed(!subscribed);
    } catch (e: any) {
      alert(`訂閱失敗：${e?.message ?? String(e)}`);
    }
  };

  if (!boardId) {
    return <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>無看板 ID</div>;
  }

  if (loading) {
    return <div className="card" style={{ padding: 24 }}>載入中…</div>;
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 8,
              background: 'var(--panel2, #F2F2F7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
            }}
          >
            {board?.coverImage ? (
              <img src={board.coverImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} />
            ) : (
              '🗂'
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{board?.name ?? boardId}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {CAMPUS_BOARD_TYPE_LABEL[(board?.type ?? 'topic') as CampusBoardType]}板
              {board?.defaultAnonymous ? ' · 預設匿名' : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={toggleSub}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 12px',
              borderRadius: 999,
              border: '1px solid var(--brand, #5856D6)',
              background: subscribed ? 'var(--brand, #5856D6)' : 'transparent',
              color: subscribed ? '#fff' : 'var(--brand, #5856D6)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {subscribed ? '🔔 已訂閱' : '訂閱'}
          </button>
          <Link
            href={`/community/post/new?boardId=${encodeURIComponent(boardId)}`}
            className="btn primary"
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            ＋ 發文
          </Link>
        </div>
        {board?.rules && (
          <div
            style={{
              marginTop: 10,
              padding: '10px 12px',
              background: 'var(--panel2, #F2F2F7)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--muted)',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {board.rules}
          </div>
        )}
      </div>

      {posts.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
          <div style={{ fontWeight: 700, color: 'var(--text)' }}>此看板尚未有貼文</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>成為第一篇吧</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {posts.map((p) => {
            const likes =
              typeof p.likes === 'number' ? p.likes : Array.isArray(p.likedBy) ? p.likedBy.length : 0;
            const cc = typeof p.commentCount === 'number' ? p.commentCount : 0;
            return (
              <Link
                key={p.id}
                href={`/community/post/${p.id}`}
                className="card"
                style={{ padding: 14, textDecoration: 'none', color: 'var(--text)' }}
              >
                <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--brand, #5856D6)',
                      background: 'rgba(88,86,214,0.10)',
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontWeight: 700,
                    }}
                  >
                    {p.anonymous ? p.aliasSnapshot ?? '匿名' : '實名'}
                  </span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{p.title}</div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 13,
                    color: 'var(--muted)',
                    lineHeight: 1.5,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {p.content}
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 14,
                    marginTop: 10,
                    paddingTop: 8,
                    borderTop: '1px solid var(--border)',
                    fontSize: 12,
                    color: 'var(--muted)',
                    fontWeight: 700,
                  }}
                >
                  <span>🤍 {likes}</span>
                  <span>💬 {cc}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
