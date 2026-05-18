'use client';

import { FormEvent, useState } from 'react';

import { RequireAdmin } from '@/components/RequireAdmin';
import { RichTextEditor } from '@/components/RichTextEditor';
import { getBrowserSupabase } from '@/lib/supabase-browser';

export default function AdminNotifyPage() {
  const [mode, setMode] = useState<'notification' | 'announcement'>('notification');
  const [courseId, setCourseId] = useState('');
  const [title, setTitle] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [scope, setScope] = useState<'course' | 'group' | 'role'>('course');
  const [scopeTargetId, setScopeTargetId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    const cid = courseId.trim();
    const ttl = title.trim();
    if (!cid || !ttl) {
      setError('請輸入課程 UUID 與標題');
      return;
    }

    setBusy(true);
    const supabase = getBrowserSupabase();

    if (mode === 'notification') {
      const { data, error: rpcErr } = await supabase.rpc('notify_course_members', {
        p_course_id: cid,
        p_title: ttl,
        p_body: bodyText.trim() || stripHtml(bodyHtml),
      });
      setBusy(false);
      if (rpcErr) {
        setError(rpcErr.message);
        return;
      }
      setMsg(`已寫入 notifications：${typeof data === 'number' ? `${data} 筆` : 'OK'}`);
      return;
    }

    // announcement 模式：直接 INSERT（RLS announcements_insert 仍會檢查 capability）
    const payload: Record<string, unknown> = {
      course_id: cid,
      title: ttl,
      body: bodyText.trim() || stripHtml(bodyHtml),
      body_html: bodyHtml,
      visibility_scope: scope,
    };
    if (scope === 'group' && scopeTargetId.trim()) {
      payload.visibility_target_id = scopeTargetId.trim();
    }
    if (scheduledAt) {
      payload.scheduled_at = new Date(scheduledAt).toISOString();
    }
    const { error: insErr } = await supabase.from('announcements').insert({
      ...payload,
      author_id: (await supabase.auth.getUser()).data.user?.id,
    });
    setBusy(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setMsg(scheduledAt ? '公告已排程' : '公告已發布');
  }

  return (
    <RequireAdmin>
      <h1 style={{ marginTop: 0 }}>發送站內通知 / 公告</h1>
      <p style={{ color: '#8E8E93', lineHeight: 1.6 }}>
        Notification 走 <code>notify_course_members</code> RPC（純文字）；公告寫入 <code>announcements</code>（含 body_html、排程、對象範圍）。
      </p>

      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        {(['notification', 'announcement'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              background: mode === m ? '#007aff' : '#fff',
              color: mode === m ? '#fff' : '#111827',
              fontWeight: 700,
              cursor: 'pointer',
            }}>
            {m === 'notification' ? '站內通知' : '公告（含富文本＋排程）'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} style={formStyle}>
        <label style={fieldStyle}>
          <span>課程 UUID</span>
          <input style={inputStyle} value={courseId} onChange={(ev) => setCourseId(ev.target.value)} />
        </label>
        <label style={fieldStyle}>
          <span>標題</span>
          <input style={inputStyle} value={title} onChange={(ev) => setTitle(ev.target.value)} />
        </label>

        {mode === 'announcement' ? (
          <>
            <div style={fieldStyle}>
              <span>內文（富文本）</span>
              <RichTextEditor value={bodyHtml} onChange={setBodyHtml} placeholder="輸入公告內容…" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={fieldStyle}>
                <span>排程發布（選填）</span>
                <input
                  type="datetime-local"
                  style={inputStyle}
                  value={scheduledAt}
                  onChange={(ev) => setScheduledAt(ev.target.value)}
                />
              </label>
              <label style={fieldStyle}>
                <span>對象範圍</span>
                <select style={inputStyle} value={scope} onChange={(ev) => setScope(ev.target.value as 'course' | 'group' | 'role')}>
                  <option value="course">全課程</option>
                  <option value="group">指定 group</option>
                  <option value="role">指定角色（後續擴充）</option>
                </select>
              </label>
            </div>
            {scope === 'group' ? (
              <label style={fieldStyle}>
                <span>group UUID</span>
                <input style={inputStyle} value={scopeTargetId} onChange={(ev) => setScopeTargetId(ev.target.value)} />
              </label>
            ) : null}
          </>
        ) : (
          <label style={fieldStyle}>
            <span>內文</span>
            <textarea
              style={{ ...inputStyle, minHeight: 120 }}
              value={bodyText}
              onChange={(ev) => setBodyText(ev.target.value)}
            />
          </label>
        )}

        {error ? <p style={{ color: '#FF3B30', margin: 0 }}>{error}</p> : null}
        {msg ? <p style={{ color: '#047857', margin: 0 }}>{msg}</p> : null}
        <button type="submit" disabled={busy} style={submitBtn}>
          {busy ? '送出中…' : '送出'}
        </button>
      </form>
    </RequireAdmin>
  );
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const formStyle: React.CSSProperties = {
  marginTop: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  maxWidth: 720,
  background: '#fff',
  padding: 16,
  borderRadius: 12,
  border: '1px solid #E5E5EA',
};
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const inputStyle: React.CSSProperties = {
  padding: 10,
  borderRadius: 8,
  border: '1px solid #d1d5db',
  fontSize: 14,
};
const submitBtn: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 10,
  border: 'none',
  background: '#111827',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
};
