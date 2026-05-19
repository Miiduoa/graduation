'use client';

import { useCallback, useEffect, useState } from 'react';

import { RequireAdmin } from '@/components/RequireAdmin';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type CourseRow = { id: string; title: string };
type MaterialRow = { id: string; title: string; external_url: string | null; storage_path: string | null; mime_type: string | null };
type PreviewRow = {
  material_id: string;
  preview_kind: string;
  preview_url: string;
  thumbnail_url: string | null;
  page_count: number | null;
};

/**
 * Office Web Viewer / Google Docs Viewer / pdf.js iframe 嵌入頁。
 * 對應 material_previews 表：preview_kind in ('office_online','google_viewer','pdfjs',...).
 * Office Online 公開 URL 規格：https://view.officeapps.live.com/op/view.aspx?src={ENCODED_URL}
 * Google Docs Viewer：https://docs.google.com/gview?url={ENCODED_URL}&embedded=true
 */
export default function OfficePreviewPage() {
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [courseId, setCourseId] = useState('');
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [previews, setPreviews] = useState<Record<string, PreviewRow>>({});
  const [activeMid, setActiveMid] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = getBrowserSupabase();
      const { data } = await supabase
        .from('courses').select('id, title').order('created_at', { ascending: false }).limit(200);
      setCourses((data ?? []) as CourseRow[]);
    })();
  }, []);

  const reload = useCallback(async () => {
    if (!courseId) {
      setMaterials([]);
      setPreviews({});
      return;
    }
    const supabase = getBrowserSupabase();
    const { data: mats, error: e1 } = await supabase
      .from('course_materials')
      .select('id, title, external_url, storage_path, mime_type')
      .eq('course_id', courseId)
      .order('created_at', { ascending: false });
    if (e1) setError(e1.message);
    setMaterials((mats ?? []) as MaterialRow[]);

    const ids = (mats ?? []).map((m) => (m as MaterialRow).id);
    if (ids.length === 0) {
      setPreviews({});
      return;
    }
    const { data: pv } = await supabase
      .from('material_previews')
      .select('material_id, preview_kind, preview_url, thumbnail_url, page_count')
      .in('material_id', ids);
    const map: Record<string, PreviewRow> = {};
    for (const p of (pv ?? []) as PreviewRow[]) map[p.material_id] = p;
    setPreviews(map);
  }, [courseId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function ensurePreview(mat: MaterialRow, kind: 'office_online' | 'google_viewer' | 'pdfjs') {
    if (!mat.external_url) {
      window.alert('此教材沒有公開 external_url；無法用 Office Online／Google Viewer。');
      return;
    }
    setBusy(true);
    const encoded = encodeURIComponent(mat.external_url);
    let url = '';
    if (kind === 'office_online') {
      url = `https://view.officeapps.live.com/op/view.aspx?src=${encoded}`;
    } else if (kind === 'google_viewer') {
      url = `https://docs.google.com/gview?url=${encoded}&embedded=true`;
    } else {
      url = `https://mozilla.github.io/pdf.js/web/viewer.html?file=${encoded}`;
    }

    const supabase = getBrowserSupabase();
    const { error: ue } = await supabase
      .from('material_previews')
      .upsert(
        { material_id: mat.id, preview_kind: kind, preview_url: url },
        { onConflict: 'material_id' },
      );
    setBusy(false);
    if (ue) {
      window.alert(ue.message);
      return;
    }
    await reload();
  }

  const active = materials.find((m) => m.id === activeMid);
  const activePreview = active ? previews[active.id] : undefined;

  return (
    <RequireAdmin>
      <h1 style={{ marginTop: 0 }}>Office / PDF 預覽（iframe）</h1>
      <p style={{ color: '#4b5563', lineHeight: 1.6 }}>
        對應 <code>material_previews</code>。Office Online 公開 viewer 僅能讀取「**公開**可下載的 URL」；
        若教材在 Supabase Storage，請先設成 signed URL 或 public bucket。
      </p>

      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
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
      </div>

      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}

      <div style={{ marginTop: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <aside style={{ width: 340, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h2 style={{ fontSize: 14, marginTop: 0 }}>教材列表</h2>
          {materials.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: 13 }}>請先選課，並有教材。</p>
          ) : (
            <ul style={{ padding: 0, margin: 0, listStyle: 'none' }}>
              {materials.map((m) => {
                const p = previews[m.id];
                return (
                  <li key={m.id} style={{ marginBottom: 8 }}>
                    <button
                      type="button"
                      onClick={() => setActiveMid(m.id)}
                      style={{ ...listBtnStyle, background: m.id === activeMid ? '#dbeafe' : '#fff' }}>
                      <strong>{m.title}</strong>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>
                        {p ? `已設預覽：${p.preview_kind}` : '未設定'}
                      </div>
                    </button>
                    <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => void ensurePreview(m, 'office_online')} disabled={busy} style={smallBtn}>
                        Office Online
                      </button>
                      <button type="button" onClick={() => void ensurePreview(m, 'google_viewer')} disabled={busy} style={smallBtn}>
                        Google Viewer
                      </button>
                      <button type="button" onClick={() => void ensurePreview(m, 'pdfjs')} disabled={busy} style={smallBtn}>
                        pdf.js
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <main style={{ flex: 1, minWidth: 320 }}>
          {active && activePreview ? (
            <div style={{ background: '#000', borderRadius: 12, overflow: 'hidden', height: '75vh' }}>
              <iframe
                src={activePreview.preview_url}
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                title={`preview-${active.id}`}
                style={{ width: '100%', height: '100%', border: 0, background: '#fff' }}
              />
            </div>
          ) : (
            <p style={{ color: '#6b7280' }}>請選擇一個教材並按上方任一預覽鈕。</p>
          )}
        </main>
      </div>
    </RequireAdmin>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14, minWidth: 220,
};
const listBtnStyle: React.CSSProperties = {
  width: '100%', textAlign: 'left', padding: 10,
  background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer',
};
const smallBtn: React.CSSProperties = {
  padding: '4px 8px', fontSize: 11, borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer',
};
