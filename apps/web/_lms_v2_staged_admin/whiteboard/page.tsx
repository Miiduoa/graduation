'use client';

import { useCallback, useEffect, useState } from 'react';

import { RequireAdmin } from '@/components/RequireAdmin';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type CourseRow = { id: string; title: string };
type Whiteboard = {
  id: string;
  course_id: string;
  provider: string;
  join_url: string;
  embed_url: string | null;
  snapshot_url: string | null;
  created_at: string;
};

/**
 * Excalidraw / Jamboard / Miro / Figma iframe 嵌入頁。
 * 因應「電子白板」對齊 whiteboard_sessions schema。
 * 注意：iframe 沙箱使用 allow="clipboard-write; fullscreen" 與 sandbox restriction，
 * 避免第三方腳本接觸宿主頁 cookies。
 */
export default function WhiteboardPage() {
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [courseId, setCourseId] = useState('');
  const [boards, setBoards] = useState<Whiteboard[]>([]);
  const [activeId, setActiveId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = getBrowserSupabase();
      const { data, error: e } = await supabase
        .from('courses')
        .select('id, title')
        .order('created_at', { ascending: false })
        .limit(200);
      if (e) setError(e.message);
      setCourses((data ?? []) as CourseRow[]);
    })();
  }, []);

  const reload = useCallback(async () => {
    if (!courseId) {
      setBoards([]);
      return;
    }
    const supabase = getBrowserSupabase();
    const { data, error: e } = await supabase
      .from('whiteboard_sessions')
      .select('id, course_id, provider, join_url, embed_url, snapshot_url, created_at')
      .eq('course_id', courseId)
      .order('created_at', { ascending: false });
    if (e) setError(e.message);
    setBoards((data ?? []) as Whiteboard[]);
  }, [courseId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function createBoard(provider: string) {
    if (!courseId) {
      window.alert('請先選課');
      return;
    }
    let joinUrl = window.prompt(`${provider} join URL`);
    if (!joinUrl) return;
    if (!/^https?:/i.test(joinUrl)) {
      window.alert('需 http(s) URL');
      return;
    }
    const embedUrl = window.prompt('iframe 嵌入 URL（選填，留空則用 join URL）') || joinUrl;

    setBusy(true);
    const supabase = getBrowserSupabase();
    const { error: ie } = await supabase.from('whiteboard_sessions').insert({
      course_id: courseId,
      provider,
      join_url: joinUrl,
      embed_url: embedUrl,
    });
    setBusy(false);
    if (ie) {
      window.alert(ie.message);
      return;
    }
    await reload();
  }

  const active = boards.find((b) => b.id === activeId);

  return (
    <RequireAdmin>
      <h1 style={{ marginTop: 0 }}>電子白板（iframe 嵌入）</h1>
      <p style={{ color: '#4b5563', lineHeight: 1.6 }}>
        對應 <code>whiteboard_sessions</code> 表；支援 Excalidraw / Miro / Jamboard / Figma 等任何接受 iframe 嵌入的服務。
        iframe 啟用 sandbox 限制：禁止存取宿主頁 cookies／storage；允許剪貼簿與全螢幕。
      </p>

      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>課程</span>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} style={selectStyle}>
            <option value="">請選課…</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['excalidraw', 'miro', 'jamboard', 'figma', 'custom'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => void createBoard(p)}
              disabled={busy || !courseId}
              style={btnStyle}>
              + {p}
            </button>
          ))}
        </div>
      </div>

      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}

      <div style={{ marginTop: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <aside style={{ width: 300, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h2 style={{ fontSize: 14, marginTop: 0 }}>白板列表</h2>
          {boards.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: 13 }}>尚無白板。</p>
          ) : (
            <ul style={{ padding: 0, margin: 0, listStyle: 'none' }}>
              {boards.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(b.id)}
                    style={{
                      ...listBtnStyle,
                      background: b.id === activeId ? '#dbeafe' : '#fff',
                    }}>
                    <strong>{b.provider}</strong>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>
                      {new Date(b.created_at).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <main style={{ flex: 1, minWidth: 320 }}>
          {active ? (
            <div style={{ background: '#000', borderRadius: 12, overflow: 'hidden', height: '70vh' }}>
              <iframe
                src={active.embed_url ?? active.join_url}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                allow="clipboard-write; fullscreen"
                title={`whiteboard-${active.id}`}
                style={{ width: '100%', height: '100%', border: 0 }}
              />
            </div>
          ) : (
            <p style={{ color: '#6b7280' }}>請從左側選擇一個白板。</p>
          )}
        </main>
      </div>
    </RequireAdmin>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid #d1d5db',
  fontSize: 14,
  minWidth: 220,
};
const btnStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid #2563eb',
  background: '#2563eb',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
};
const listBtnStyle: React.CSSProperties = {
  width: '100%',
  textAlign: 'left',
  padding: 10,
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  marginBottom: 6,
  cursor: 'pointer',
};
