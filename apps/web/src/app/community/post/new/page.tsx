'use client';

/**
 * 校園社群 — 發文（Web）
 *
 * 對應 mobile/PostComposeScreen：標題、內文、看板、匿名 toggle、圖片附件、標籤。
 * 圖片走 lib/community/media.ts 上傳到 Firebase Storage 後寫入 mediaUrls。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CommunityLoadError, useCommunityLoad } from '../../_components/useCommunityLoad';
import { CommunityAccess } from '../../_components/CommunityAccess';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import {
  createCampusPost,
  listBoards,
  getBoardById,
  getOrCreateBoardAlias,
  CAMPUS_BOARD_TYPE_LABEL,
  type CampusBoard,
  type CampusBoardType,
} from '@/lib/community/firestore';
import { uploadCampusMedia } from '@/lib/community/media';

const MAX_MEDIA = 4;
const MAX_TITLE = 60;
const MAX_BODY = 1500;
const MAX_TAGS = 5;

export default function PostComposePage() {
  return (
    <SiteShell title="發文" subtitle="撰寫校園社群貼文">
      <CommunityAccess>
        <PostComposeInner />
      </CommunityAccess>
    </SiteShell>
  );
}

function PostComposeInner() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { schoolId } = useMemo(() => resolveSchoolPageContext({}), []);
  const searchParams = useSearchParams();
  const routeBoardId = searchParams?.get('boardId') ?? '';

  const [boards, setBoards] = useState<CampusBoard[]>([]);
  const [boardId, setBoardId] = useState(routeBoardId);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [tagsRaw, setTagsRaw] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadBoards = useCallback(async () => {
    const rows = await listBoards(schoolId, 80);
    if (routeBoardId && !rows.some((board) => board.id === routeBoardId)) {
      const selected = await getBoardById(schoolId, routeBoardId);
      if (selected) rows.push(selected);
    }
    setBoards(rows);
  }, [schoolId, routeBoardId]);
  const {
    loading: boardsLoading,
    error: boardsError,
    refresh: refreshBoards,
  } = useCommunityLoad(loadBoards, '暫時無法讀取看板，請確認連線後重試。');

  const selectedBoard = useMemo(() => boards.find((b) => b.id === boardId), [boards, boardId]);

  useEffect(() => {
    if (selectedBoard?.defaultAnonymous != null) {
      setAnonymous(selectedBoard.defaultAnonymous);
    }
  }, [selectedBoard?.defaultAnonymous]);

  // Generate object URLs for previews
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);

  const onPickFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list).slice(0, MAX_MEDIA - files.length);
    setFiles((prev) => [...prev, ...incoming]);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const submit = useCallback(async () => {
    if (!user?.uid) {
      alert('請先登入');
      return;
    }
    const bid = boardId.trim();
    if (!bid || !selectedBoard) {
      alert('請先選擇要發布的看板。');
      return;
    }
    if (!title.trim()) {
      alert('請填標題');
      return;
    }
    if (!content.trim() && files.length === 0) {
      alert('請輸入內文或加入至少一張圖');
      return;
    }
    const tags = tagsRaw
      .split(/[,，、\s]+/)
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, MAX_TAGS);

    setSending(true);
    try {
      let mediaUrls: string[] = [];
      if (files.length > 0) {
        const uploaded = await Promise.all(
          files.map((f) => uploadCampusMedia({ scope: 'posts', schoolId, uid: user.uid, file: f })),
        );
        mediaUrls = uploaded.map((u) => u.url);
      }

      let aliasSnap: string | undefined;
      if (anonymous) {
        try {
          aliasSnap = await getOrCreateBoardAlias(user.uid, schoolId, bid);
        } catch {
          aliasSnap = '匿名使用者';
        }
      }

      const postId = await createCampusPost({
        schoolId,
        boardId: bid,
        title: title.trim(),
        content: content.trim(),
        anonymous,
        tags,
        mediaUrls,
        ...(anonymous ? { aliasSnapshot: aliasSnap } : { authorUid: user.uid }),
      });
      alert('已發佈');
      router.push(`/community/post/${postId}`);
    } catch {
      alert('這次未能發佈，請稍後再試。');
    } finally {
      setSending(false);
    }
  }, [user, schoolId, boardId, selectedBoard, title, content, anonymous, tagsRaw, files, router]);

  if (authLoading) {
    return (
      <div className="card" style={{ padding: 24 }}>
        載入中…
      </div>
    );
  }
  if (!user) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: 'var(--muted)' }}>請先登入後再發文</p>
        <Link href="/login" className="btn primary">
          前往登入
        </Link>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 18, maxWidth: 720 }}>
      <label htmlFor="post-board" style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>
        發布看板
      </label>
      {boardsError ? (
        <CommunityLoadError message={boardsError} retry={refreshBoards} />
      ) : boardsLoading ? (
        <p role="status">正在讀取看板…</p>
      ) : boards.length === 0 ? (
        <p>
          目前沒有可發布的看板。<Link href="/community?tab=boards">前往建立看板</Link>
        </p>
      ) : (
        <select
          id="post-board"
          className="input"
          value={boardId}
          disabled={!!routeBoardId}
          onChange={(event) => setBoardId(event.target.value)}
          style={{ width: '100%' }}
        >
          <option value="">選擇看板</option>
          {boards.map((board) => (
            <option key={board.id} value={board.id}>
              {board.name}
            </option>
          ))}
        </select>
      )}
      {!boardsLoading && !boardsError && routeBoardId && !selectedBoard && (
        <p role="alert">
          這個看板已不存在或無法使用。<Link href="/community?tab=boards">選擇其他看板</Link>
        </p>
      )}
      {selectedBoard && (
        <div
          style={{
            marginTop: 6,
            display: 'inline-block',
            padding: '4px 10px',
            background: 'var(--accent-soft)',
            borderRadius: 6,
            color: 'var(--brand)',
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {CAMPUS_BOARD_TYPE_LABEL[(selectedBoard.type ?? 'topic') as CampusBoardType]}板
          {selectedBoard.defaultAnonymous ? ' · 預設匿名' : ''}
        </div>
      )}

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          fontWeight: 700,
          marginTop: 16,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
        />
        匿名貼文
      </label>

      <Label>標題</Label>
      <input
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
        placeholder="一句話描述你的貼文"
        style={{ width: '100%' }}
      />
      <Counter current={title.length} max={MAX_TITLE} />

      <Label>內文</Label>
      <textarea
        className="input"
        value={content}
        onChange={(e) => setContent(e.target.value.slice(0, MAX_BODY))}
        rows={8}
        placeholder="想分享什麼？"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          resize: 'vertical',
          fontFamily: 'inherit',
        }}
      />
      <Counter current={content.length} max={MAX_BODY} />

      <Label>圖片（最多 {MAX_MEDIA} 張）</Label>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => onPickFiles(e.target.files)}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {previews.map((src, i) => (
          <div
            key={src}
            style={{
              width: 84,
              height: 84,
              position: 'relative',
              borderRadius: 8,
              overflow: 'hidden',
              background: 'var(--panel2)',
            }}
          >
            <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <button
              type="button"
              onClick={() => removeFile(i)}
              aria-label="移除圖片"
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 22,
                height: 22,
                borderRadius: 11,
                border: 'none',
                background: 'rgba(0,0,0,0.6)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              ×
            </button>
          </div>
        ))}
        {files.length < MAX_MEDIA && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: 84,
              height: 84,
              border: '1px dashed var(--border)',
              borderRadius: 8,
              background: 'transparent',
              color: 'var(--muted)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            <span style={{ fontSize: 22 }}>🖼</span>
            <span>+ 圖片</span>
          </button>
        )}
      </div>

      <Label>標籤（逗號分隔，最多 {MAX_TAGS} 個）</Label>
      <input
        className="input"
        value={tagsRaw}
        onChange={(e) => setTagsRaw(e.target.value)}
        placeholder="例：分享, 學期心得, 程設"
        style={{ width: '100%' }}
      />

      <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Link href="/community" className="btn">
          取消
        </Link>
        <button
          type="button"
          className="btn primary"
          disabled={sending || boardsLoading || !!boardsError || !selectedBoard}
          onClick={submit}
        >
          {sending ? '發佈中…' : '發布'}
        </button>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{ display: 'block', fontSize: 13, fontWeight: 700, marginTop: 14, marginBottom: 6 }}
    >
      {children}
    </label>
  );
}

function Counter({ current, max }: { current: number; max: number }) {
  return (
    <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
      {current} / {max}
    </div>
  );
}
