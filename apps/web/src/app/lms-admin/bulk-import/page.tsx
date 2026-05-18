'use client';

// Supabase 客戶端會在 prerender 時 throw（env 缺失），明確 opt-out 靜態產生
export const dynamic = 'force-dynamic';

import { RequireAdmin } from '@/components/RequireAdmin';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useState } from 'react';

/** CSV：email,role（role 可為 student／assistant；非 admin 時 teacher 會降級為 student） */
export default function BulkImportMembersPage() {
  const supabase = getBrowserSupabase();
  const [courseId, setCourseId] = useState('');
  const [raw, setRaw] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runImport() {
    setBusy(true);
    setResult(null);
    const cid = courseId.trim();
    if (!cid) {
      setResult('請輸入課程 UUID');
      setBusy(false);
      return;
    }

    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rows: { email: string; role: string }[] = [];

    for (const line of lines) {
      const parts = line.split(/[,，\t]/).map((s) => s.trim());
      const email = parts[0];
      const role = (parts[1] || 'student').toLowerCase();
      if (!email) continue;
      rows.push({ email, role });
    }

    if (!rows.length) {
      setResult('無有效列');
      setBusy(false);
      return;
    }

    const { data, error } = await supabase.rpc('bulk_import_course_members', {
      p_course_id: cid,
      p_rows: rows,
    });

    setBusy(false);
    if (error) {
      setResult(`錯誤：${error.message}`);
      return;
    }
    setResult(JSON.stringify(data, null, 2));
  }

  return (
    <RequireAdmin>
      <h1 style={{ marginTop: 0 }}>批量匯入課程成員</h1>
      <p style={{ color: '#4b5563', fontSize: 14 }}>
        依 email 對應既有 Supabase 使用者寫入 course_members。使用者須已註冊（可先跑 Edge Function{' '}
        <code>sync-external-directory</code>
        發邀請）。
      </p>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16 }}>
        <span>課程 UUID</span>
        <input
          style={{ padding: 10, borderRadius: 8, border: '1px solid #d1d5db' }}
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          autoCapitalize="none"
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
        <span>CSV（每行：email,role）</span>
        <textarea
          style={{ padding: 10, borderRadius: 8, border: '1px solid #d1d5db', minHeight: 180, fontFamily: 'monospace' }}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={`alice@school.edu.tw,student\nbob@school.edu.tw,assistant`}
        />
      </label>

      <button
        type="button"
        disabled={busy}
        style={{
          marginTop: 14,
          padding: '12px 18px',
          borderRadius: 10,
          border: 'none',
          background: '#2563eb',
          color: '#fff',
          fontWeight: 700,
          cursor: busy ? 'wait' : 'pointer',
        }}
        onClick={runImport}>
        {busy ? '執行中…' : '呼叫 bulk_import_course_members'}
      </button>

      {result ? (
        <pre style={{ marginTop: 16, padding: 12, background: '#f9fafb', borderRadius: 8, overflow: 'auto' }}>{result}</pre>
      ) : null}
    </RequireAdmin>
  );
}
