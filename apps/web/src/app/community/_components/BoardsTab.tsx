'use client';

/**
 * 校園社群 — 看板（Web）
 *
 * 對應 mobile/BoardsScreen.tsx：
 *  - 依類型分組（系所/課程/主題/匿名）
 *  - 訂閱 toggle（不必進詳情）
 *  - 建立看板 Modal
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthGuard';
import {
  listBoards,
  listSubscribedBoardIds,
  subscribeToBoard,
  unsubscribeFromBoard,
  groupBoardsByType,
  createBoard,
  CAMPUS_BOARD_TYPE_LABEL,
  type CampusBoard,
  type CampusBoardType,
} from '@/lib/community/firestore';

const TYPE_ICON: Record<CampusBoardType, string> = {
  department: '🏛',
  course: '📘',
  topic: '🏷',
  anon: '🫥',
};

export function BoardsTab(props: { schoolId: string; schoolSearch: string }) {
  const { schoolId } = props;
  const { user } = useAuth();
  const [boards, setBoards] = useState<CampusBoard[]>([]);
  const [subscribed, setSubscribed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);

  const load = useCallback(async () => {
    if (!schoolId) {
      setBoards([]);
      setSubscribed(new Set());
      return;
    }
    const [rows, subs] = await Promise.all([
      listBoards(schoolId, 120),
      user?.uid ? listSubscribedBoardIds(user.uid, schoolId) : Promise.resolve([] as string[]),
    ]);
    setBoards(rows);
    setSubscribed(new Set(subs));
  }, [schoolId, user]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const q = filter.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? boards.filter((b) => `${b.name} ${b.slug ?? ''} ${b.rules ?? ''}`.toLowerCase().includes(q))
        : boards,
    [boards, q],
  );

  const grouped = useMemo(() => groupBoardsByType(filtered), [filtered]);

  const onToggleSub = async (b: CampusBoard) => {
    if (!user?.uid || !schoolId) {
      alert('請先登入');
      return;
    }
    const wasSub = subscribed.has(b.id);
    setSubscribed((prev) => {
      const next = new Set(prev);
      if (wasSub) next.delete(b.id);
      else next.add(b.id);
      return next;
    });
    try {
      if (wasSub) await unsubscribeFromBoard(user.uid, schoolId, b.id);
      else await subscribeToBoard(user.uid, schoolId, b.id);
    } catch (e: any) {
      alert(`訂閱失敗：${e?.message ?? String(e)}`);
      setSubscribed((prev) => {
        const next = new Set(prev);
        if (wasSub) next.add(b.id);
        else next.delete(b.id);
        return next;
      });
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <input
          type="search"
          className="input"
          placeholder="搜尋看板"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, maxWidth: 420 }}
        />
        <button
          type="button"
          className="btn primary"
          onClick={() => setComposeOpen(true)}
          style={{ fontSize: 13, padding: '8px 16px' }}
        >
          ＋ 建立看板
        </button>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
          載入中…
        </div>
      ) : boards.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🗂</div>
          <div style={{ fontWeight: 700, color: 'var(--text)' }}>尚無任何看板</div>
          <div style={{ marginTop: 6, fontSize: 12 }}>點右上「建立看板」開出第一個版面</div>
        </div>
      ) : (
        (['department', 'course', 'topic', 'anon'] as CampusBoardType[]).map((t) => {
          const arr = grouped[t];
          if (!arr || arr.length === 0) return null;
          return (
            <section key={t} style={{ marginBottom: 24 }}>
              <h3
                style={{
                  margin: '4px 0 10px',
                  fontSize: 12,
                  letterSpacing: 0.6,
                  color: 'var(--muted)',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>{TYPE_ICON[t]}</span>
                {CAMPUS_BOARD_TYPE_LABEL[t]}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 10 }}>
                {arr.map((b) => {
                  const isSub = subscribed.has(b.id);
                  return (
                    <div
                      key={b.id}
                      className="card"
                      style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}
                    >
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 8,
                          background: 'var(--panel2, #F2F2F7)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 22,
                          flexShrink: 0,
                        }}
                      >
                        {TYPE_ICON[(b.type ?? 'topic') as CampusBoardType]}
                      </div>
                      <Link
                        href={`/community/board/${b.id}`}
                        style={{ flex: 1, minWidth: 0, color: 'var(--text)', textDecoration: 'none' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 14, fontWeight: 700 }}>{b.name}</span>
                          {b.defaultAnonymous && (
                            <span
                              style={{
                                fontSize: 10,
                                color: 'var(--muted)',
                                background: 'var(--panel2, #F2F2F7)',
                                padding: '1px 6px',
                                borderRadius: 999,
                                border: '1px solid var(--border)',
                              }}
                            >
                              匿名
                            </span>
                          )}
                        </div>
                        {b.rules ? (
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--muted)',
                              marginTop: 4,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              lineHeight: 1.4,
                            }}
                          >
                            {b.rules}
                          </div>
                        ) : (
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                            {CAMPUS_BOARD_TYPE_LABEL[(b.type ?? 'topic') as CampusBoardType]}板
                          </div>
                        )}
                      </Link>
                      <button
                        type="button"
                        onClick={() => onToggleSub(b)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '6px 10px',
                          borderRadius: 999,
                          border: '1px solid var(--brand, #5856D6)',
                          background: isSub ? 'var(--brand, #5856D6)' : 'transparent',
                          color: isSub ? '#fff' : 'var(--brand, #5856D6)',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        {isSub ? '🔔 已訂閱' : '訂閱'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {composeOpen && (
        <CreateBoardModal
          schoolId={schoolId}
          onClose={() => setComposeOpen(false)}
          onCreated={async () => {
            setComposeOpen(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function CreateBoardModal(props: {
  schoolId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [type, setType] = useState<CampusBoardType>('topic');
  const [rules, setRules] = useState('');
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAnon(type === 'anon');
  }, [type]);

  const submit = async () => {
    if (!user?.uid) {
      alert('請先登入');
      return;
    }
    if (name.trim().length < 2) {
      alert('看板名稱至少 2 個字');
      return;
    }
    setBusy(true);
    try {
      await createBoard({
        schoolId: props.schoolId,
        name: name.trim(),
        type,
        rules: rules.trim(),
        defaultAnonymous: anon,
        createdBy: user.uid,
      });
      props.onCreated();
    } catch (e: any) {
      alert(`建立失敗：${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

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
      <div
        className="card"
        style={{ padding: 24, width: '100%', maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>建立看板</h2>
          <button
            type="button"
            onClick={props.onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}
          >
            ×
          </button>
        </div>

        <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginTop: 16, marginBottom: 6 }}>
          看板名稱
        </label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例：資工系 / 程式甘苦談 / 校隊招新"
          maxLength={32}
          style={{ width: '100%', boxSizing: 'border-box' }}
        />

        <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginTop: 14, marginBottom: 6 }}>類型</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['department', 'course', 'topic', 'anon'] as CampusBoardType[]).map((k) => {
            const on = type === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setType(k)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: on ? '1px solid var(--brand, #5856D6)' : '1px solid var(--border)',
                  background: on ? 'var(--brand, #5856D6)' : 'var(--surface)',
                  color: on ? '#fff' : 'var(--text)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {TYPE_ICON[k]} {CAMPUS_BOARD_TYPE_LABEL[k]}
              </button>
            );
          })}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} />
          預設匿名發文
        </label>

        <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginTop: 14, marginBottom: 6 }}>
          看板規則（選填）
        </label>
        <textarea
          className="input"
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          rows={4}
          placeholder="例：請以友善與尊重為原則，請勿張貼商業廣告。"
          maxLength={400}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={props.onClose}>取消</button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={submit}
          >
            {busy ? '建立中…' : '建立'}
          </button>
        </div>
      </div>
    </div>
  );
}
