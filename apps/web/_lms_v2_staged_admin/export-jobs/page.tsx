'use client';

import { useCallback, useEffect, useState } from 'react';

import { RequireAdmin } from '@/components/RequireAdmin';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type Job = {
  id: string;
  requested_by: string;
  report_kind: string;
  scope_course_id: string | null;
  format: string;
  status: string;
  row_count: number | null;
  storage_path: string | null;
  error_detail: string | null;
  created_at: string;
  updated_at: string;
};

export default function ExportJobsPage() {
  const [rows, setRows] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const supabase = getBrowserSupabase();
    const { data, error: qErr } = await supabase
      .from('report_export_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (qErr) {
      setError(qErr.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as Job[]);
    setError(null);
  }, []);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 8000);
    return () => clearInterval(id);
  }, [reload]);

  return (
    <RequireAdmin>
      <h1 style={{ marginTop: 0 }}>匯出任務（非同步）</h1>
      <p style={{ color: '#4b5563', lineHeight: 1.6 }}>
        報表匯出任務由各報表頁「入列」後寫入 <code>report_export_jobs</code>；外部 worker（Edge function 或 cron）
        以 <code>report_export_jobs_claim_next</code> 取出處理；完成時 <code>storage_path</code> 會指到簽名儲存物件路徑。
        頁面每 8 秒自動重整。
      </p>

      <button
        type="button"
        onClick={() => void reload()}
        style={{
          marginTop: 12,
          padding: '8px 14px',
          borderRadius: 8,
          border: '1px solid #2563eb',
          background: '#2563eb',
          color: '#fff',
          fontWeight: 700,
          cursor: 'pointer',
        }}>
        手動重整
      </button>

      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}

      <div style={{ overflowX: 'auto', marginTop: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <th style={cellStyle}>建立</th>
              <th style={cellStyle}>kind</th>
              <th style={cellStyle}>scope</th>
              <th style={cellStyle}>format</th>
              <th style={cellStyle}>status</th>
              <th style={cellStyle}>row_count</th>
              <th style={cellStyle}>儲存路徑</th>
              <th style={cellStyle}>更新</th>
              <th style={cellStyle}>錯誤</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ background: r.status === 'failed' ? '#fef2f2' : undefined }}>
                <td style={cellStyle}>{new Date(r.created_at).toLocaleString()}</td>
                <td style={cellStyle}>{r.report_kind}</td>
                <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: 11 }}>{r.scope_course_id ?? '—'}</td>
                <td style={cellStyle}>{r.format}</td>
                <td style={cellStyle}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: statusBg(r.status),
                      color: statusFg(r.status),
                      fontSize: 11,
                      fontWeight: 700,
                    }}>
                    {r.status}
                  </span>
                </td>
                <td style={cellStyle}>{r.row_count ?? '—'}</td>
                <td style={{ ...cellStyle, maxWidth: 240, wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 11 }}>
                  {r.storage_path ?? '—'}
                </td>
                <td style={cellStyle}>{new Date(r.updated_at).toLocaleString()}</td>
                <td style={{ ...cellStyle, maxWidth: 220, wordBreak: 'break-word', fontSize: 12 }}>
                  {r.error_detail ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!error && rows.length === 0 ? (
        <p style={{ color: '#6b7280' }}>目前沒有匯出任務。</p>
      ) : null}
    </RequireAdmin>
  );
}

function statusBg(s: string) {
  if (s === 'queued') return '#fef3c7';
  if (s === 'running') return '#dbeafe';
  if (s === 'ready') return '#dcfce7';
  if (s === 'failed') return '#fecaca';
  return '#f3f4f6';
}
function statusFg(s: string) {
  if (s === 'queued') return '#92400e';
  if (s === 'running') return '#1d4ed8';
  if (s === 'ready') return '#166534';
  if (s === 'failed') return '#991b1b';
  return '#111827';
}

const cellStyle: React.CSSProperties = {
  padding: 8,
  border: '1px solid #e5e7eb',
  textAlign: 'left',
};
