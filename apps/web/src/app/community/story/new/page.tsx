'use client';

/**
 * 校園社群 — 發 Story（Web）
 *
 * 對應 mobile/StoryComposeScreen：文字 / 圖片兩種，背景色 palette，可帶入 POI。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { findSocialPoi } from '@/lib/community/pois';
import { publishStory, type StoryKind } from '@/lib/community/firestore';
import { uploadCampusMedia } from '@/lib/community/media';

const BG_COLORS = ['#0f172a', '#7c5dfa', '#0ea5e9', '#10b981', '#f97316', '#ef4444'];
const TTL_24H = 24 * 3600 * 1000;
const MAX_TEXT = 220;

export default function StoryComposePage() {
  return (
    <SiteShell title="發 Story" subtitle="24 小時校園即時動態">
      <StoryComposeInner />
    </SiteShell>
  );
}

function StoryComposeInner() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { schoolId } = useMemo(() => resolveSchoolPageContext({}), []);
  const searchParams = useSearchParams();
  const initialPoiId = searchParams?.get('poiId') ?? null;
  const initialPoi = initialPoiId ? findSocialPoi(initialPoiId) : null;

  const [kind, setKind] = useState<StoryKind>('text');
  const [body, setBody] = useState('');
  const [bgColor, setBgColor] = useState(BG_COLORS[0]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [poiId, setPoiId] = useState<string | null>(initialPoiId);
  const [poiName, setPoiName] = useState<string | null>(initialPoi?.name ?? null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pickImage = () => fileInputRef.current?.click();

  const clearImage = () => {
    setFile(null);
    setKind('text');
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setKind('image');
  };

  const publish = async () => {
    if (!user?.uid) {
      alert('請先登入');
      return;
    }
    if (kind === 'text' && !body.trim()) {
      alert('請輸入文字');
      return;
    }
    if (kind === 'image' && !file) {
      alert('請選擇圖片');
      return;
    }
    setBusy(true);
    try {
      let mediaUrl: string | null = null;
      if (kind === 'image' && file) {
        const res = await uploadCampusMedia({ scope: 'stories', schoolId, uid: user.uid, file });
        mediaUrl = res.url;
      }
      await publishStory({
        schoolId,
        authorUid: user.uid,
        kind,
        text: body.trim(),
        mediaUrl,
        bgColor,
        poiId,
        poiName,
        expiresAtMs: Date.now() + TTL_24H,
      });
      alert('Story 已發佈，24 小時後自動下架');
      router.push('/community?tab=realtime');
    } catch (e: any) {
      alert(`發佈失敗：${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) {
    return <div className="card" style={{ padding: 24 }}>載入中…</div>;
  }
  if (!user) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: 'var(--muted)' }}>請先登入後再發 Story</p>
        <Link href="/login" className="btn primary">前往登入</Link>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 18, maxWidth: 540 }}>
      {/* Preview */}
      <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>預覽</label>
      <div
        style={{
          aspectRatio: '9 / 16',
          borderRadius: 14,
          overflow: 'hidden',
          background: kind === 'image' ? '#000' : bgColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          padding: 24,
          boxSizing: 'border-box',
        }}
      >
        {kind === 'image' && preview && (
          <img src={preview} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
        )}
        {body.trim().length > 0 ? (
          <span
            style={{
              position: 'relative',
              color: '#fff',
              fontSize: 22,
              lineHeight: 1.5,
              fontWeight: 700,
              textAlign: 'center',
              textShadow: kind === 'image' ? '0 1px 4px rgba(0,0,0,0.55)' : 'none',
            }}
          >
            {body.trim()}
          </span>
        ) : (
          <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            💡 內容會即時顯示在這裡
          </div>
        )}
        {poiName && (
          <div
            style={{
              position: 'absolute',
              bottom: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.4)',
              color: '#fff',
              padding: '4px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            📍 {poiName}
          </div>
        )}
      </div>

      {/* Type buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setKind('text')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '7px 12px',
            borderRadius: 999,
            border: kind === 'text' ? '1px solid var(--brand, #5856D6)' : '1px solid var(--border)',
            background: kind === 'text' ? 'var(--brand, #5856D6)' : 'var(--surface)',
            color: kind === 'text' ? '#fff' : 'var(--text)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          📝 文字
        </button>
        <button
          type="button"
          onClick={pickImage}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '7px 12px',
            borderRadius: 999,
            border: kind === 'image' ? '1px solid var(--brand, #5856D6)' : '1px solid var(--border)',
            background: kind === 'image' ? 'var(--brand, #5856D6)' : 'var(--surface)',
            color: kind === 'image' ? '#fff' : 'var(--text)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          🖼 {file ? '更換圖片' : '選擇圖片'}
        </button>
        {file && (
          <button
            type="button"
            onClick={clearImage}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--danger, #FF3B30)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            🗑 清除圖片
          </button>
        )}
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onFileChange} />

      {kind === 'text' && (
        <>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginTop: 14, marginBottom: 6 }}>背景色</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {BG_COLORS.map((c) => {
              const on = bgColor === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setBgColor(c)}
                  aria-label={`背景色 ${c}`}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    background: c,
                    border: on ? '3px solid var(--brand, #5856D6)' : '1px solid rgba(0,0,0,0.15)',
                    cursor: 'pointer',
                  }}
                />
              );
            })}
          </div>
        </>
      )}

      <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginTop: 14, marginBottom: 6 }}>文字內容</label>
      <textarea
        className="input"
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX_TEXT))}
        rows={4}
        placeholder={kind === 'image' ? '為這張圖加上一句話（選填）' : '跟大家分享此刻⋯'}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
      />
      <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{body.length} / {MAX_TEXT}</div>

      {poiId && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            background: 'rgba(88,86,214,0.10)',
            borderRadius: 999,
            color: 'var(--brand, #5856D6)',
            fontSize: 12,
            fontWeight: 700,
            marginTop: 8,
          }}
        >
          📍 {poiName ?? poiId}
          <button
            type="button"
            onClick={() => {
              setPoiId(null);
              setPoiName(null);
            }}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14 }}
            aria-label="清除位置"
          >
            ×
          </button>
        </div>
      )}

      <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Link href="/community?tab=realtime" className="btn">取消</Link>
        <button type="button" className="btn primary" disabled={busy} onClick={publish}>
          {busy ? '發佈中…' : '發布 Story'}
        </button>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
        Story 24 小時後自動下架；會出現在「即時」分頁與動態頁頂端 Story 列。
      </div>
    </div>
  );
}
