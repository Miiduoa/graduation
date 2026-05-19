'use client';

import { useEffect, useState } from 'react';

import { RequireAdmin } from '@/components/RequireAdmin';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type Row = {
  course_id: string;
  user_id: string;
  role: string;
  profiles: { display_name: string | null } | null;
  courses: { title: string } | null;
};

export default function AdminMembersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getBrowserSupabase();
      const { data, error: qErr } = await supabase
        .from('course_members')
        .select('course_id, user_id, role, profiles(display_name), courses(title)')
        .limit(300)
        .order('course_id');
      if (cancelled) return;
      if (qErr) setError(qErr.message);
      setRows((data ?? []) as unknown as Row[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <RequireAdmin>
      <h1 style={{ marginTop: 0 }}>課程成員（快照）</h1>
      <p style={{ color: '#8E8E93' }}>上限 300 筆；如需完整報表請在 SQL／BI 工具處理。</p>
      {error ? <p style={{ color: '#FF3B30' }}>{error}</p> : null}
      <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 12, border: '1px solid #E5E5EA' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead style={{ background: '#F2F2F7', textAlign: 'left' }}>
            <tr>
              <th style={{ padding: 10 }}>課程</th>
              <th style={{ padding: 10 }}>成員</th>
              <th style={{ padding: 10 }}>user_id</th>
              <th style={{ padding: 10 }}>角色</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.course_id}:${r.user_id}`} style={{ borderTop: '1px solid #E5E5EA' }}>
                <td style={{ padding: 10 }}>{r.courses?.title ?? r.course_id.slice(0, 8)}</td>
                <td style={{ padding: 10 }}>{r.profiles?.display_name ?? '—'}</td>
                <td style={{ padding: 10, fontFamily: 'monospace', fontSize: 12 }}>{r.user_id}</td>
                <td style={{ padding: 10 }}>{r.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RequireAdmin>
  );
}
