'use client';

import { RequireAdmin } from '@/components/RequireAdmin';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useEffect, useState } from 'react';

type AuditRow = {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export default function AuditLogsPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getBrowserSupabase();
      const { data, error: qErr } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (qErr) {
        setError(qErr.message);
        setRows([]);
        return;
      }
      setRows((data ?? []) as AuditRow[]);
      setError(null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <RequireAdmin>
      <h2>稽核紀錄</h2>
      <p style={{ color: 'var(--muted)', fontSize: 14 }}>
        敏感資料僅記錄摘要（forum_posts、grade_scores）。僅 platform admin 可讀。
      </p>
      {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}
      <div style={{ overflowX: 'auto', marginTop: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-soft)', textAlign: 'left' }}>
              <th style={{ padding: 8, border: '1px solid var(--border)' }}>時間</th>
              <th style={{ padding: 8, border: '1px solid var(--border)' }}>動作</th>
              <th style={{ padding: 8, border: '1px solid var(--border)' }}>實體</th>
              <th style={{ padding: 8, border: '1px solid var(--border)' }}>actor</th>
              <th style={{ padding: 8, border: '1px solid var(--border)' }}>payload</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: 8, border: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td style={{ padding: 8, border: '1px solid var(--border)' }}>{r.action}</td>
                <td style={{ padding: 8, border: '1px solid var(--border)' }}>
                  {r.entity_type}
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.entity_id ?? ''}</div>
                </td>
                <td style={{ padding: 8, border: '1px solid var(--border)', wordBreak: 'break-all' }}>{r.actor_id ?? ''}</td>
                <td style={{ padding: 8, border: '1px solid var(--border)', maxWidth: 360, wordBreak: 'break-word', fontFamily: 'monospace', fontSize: 11 }}>
                  {JSON.stringify(r.payload)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && !error ? <p style={{ color: 'var(--muted)' }}>尚無紀錄。</p> : null}
    </RequireAdmin>
  );
}
