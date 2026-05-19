'use client';

import { useEffect, useState } from 'react';

import { RequireAdmin } from '@/components/RequireAdmin';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type Row = {
  id: string;
  title: string;
  created_at: string;
};

export default function AdminCoursesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getBrowserSupabase();
      const { data, error: qErr } = await supabase.from('courses').select('id, title, created_at').order('created_at', { ascending: false }).limit(200);
      if (cancelled) return;
      if (qErr) setError(qErr.message);
      setRows((data ?? []) as Row[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <RequireAdmin>
      <h1 style={{ marginTop: 0 }}>課程列表</h1>
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
        <thead style={{ background: '#f3f4f6', textAlign: 'left' }}>
          <tr>
            <th style={{ padding: 10 }}>標題</th>
            <th style={{ padding: 10 }}>course_id</th>
            <th style={{ padding: 10 }}>建立時間</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: '1px solid #e5e7eb' }}>
              <td style={{ padding: 10 }}>{r.title}</td>
              <td style={{ padding: 10, fontFamily: 'monospace', fontSize: 12 }}>{r.id}</td>
              <td style={{ padding: 10 }}>{new Date(r.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </RequireAdmin>
  );
}
