'use client';

import { useCallback, useEffect, useState } from 'react';

import { RequireAdmin } from '@/components/RequireAdmin';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type Policy = {
  id: string;
  enabled: boolean;
  daily_user_limit: number;
  monthly_course_limit: number | null;
  retention_days_transcript: number;
  retention_days_segments: number;
  pii_redaction_required: boolean;
  cross_border_storage_allowed: boolean;
  cross_border_region: string | null;
  consent_text: string;
  data_processor_name: string;
  updated_at: string;
};

type QuotaRow = {
  user_id: string;
  usage_date: string;
  requests: number;
  quota: number;
  utilization: number | null;
  over_limit: boolean;
};

export default function AiCompliancePage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [quota, setQuota] = useState<QuotaRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const supabase = getBrowserSupabase();
    const { data, error: pErr } = await supabase
      .from('ai_compliance_policies')
      .select('*')
      .eq('id', 'default')
      .maybeSingle();
    if (pErr) {
      setError(pErr.message);
      return;
    }
    setPolicy((data ?? null) as Policy);
    setDraft((data ?? null) as Policy);

    const { data: qd } = await supabase.rpc('admin_ai_quota_overview');
    setQuota((qd ?? []) as QuotaRow[]);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setInfo(null);
    const supabase = getBrowserSupabase();
    const { error: sErr } = await supabase
      .from('ai_compliance_policies')
      .update({
        enabled: draft.enabled,
        daily_user_limit: Math.max(1, Number(draft.daily_user_limit) || 1),
        monthly_course_limit: draft.monthly_course_limit ?? null,
        retention_days_transcript: Math.max(0, Number(draft.retention_days_transcript) || 0),
        retention_days_segments: Math.max(0, Number(draft.retention_days_segments) || 0),
        pii_redaction_required: draft.pii_redaction_required,
        cross_border_storage_allowed: draft.cross_border_storage_allowed,
        cross_border_region: draft.cross_border_region,
        consent_text: draft.consent_text,
        data_processor_name: draft.data_processor_name,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 'default');
    setBusy(false);
    if (sErr) {
      window.alert(`儲存失敗：${sErr.message}`);
      return;
    }
    setInfo('已儲存');
    await reload();
  }

  async function purge() {
    if (!window.confirm('清空已逾保留期之 transcript / segments 內容（不可復原）？')) return;
    setBusy(true);
    const supabase = getBrowserSupabase();
    const { data, error: rErr } = await supabase.rpc('admin_purge_expired_ai');
    setBusy(false);
    if (rErr) {
      window.alert(`RPC 失敗：${rErr.message}`);
      return;
    }
    window.alert(JSON.stringify(data ?? {}));
  }

  return (
    <RequireAdmin>
      <h1 style={{ marginTop: 0 }}>AI 合規組態（保留期／PII／跨境）</h1>
      <p style={{ color: '#3C3C43', lineHeight: 1.6 }}>
        對應 <code>ai_compliance_policies</code>；Edge function <code>material-ai-pipeline</code>／<code>ai-course-assistant</code>{' '}
        會根據此組態套用 quota 與保留期。修改後請通知 SRE／法務 留底。
      </p>

      {error ? <p style={{ color: '#FF3B30' }}>{error}</p> : null}
      {!draft ? <p style={{ color: '#8E8E93' }}>載入中…（或 migration 未到帳）</p> : null}

      {draft ? (
        <div style={{ background: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, padding: 20, marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <Field label="啟用 AI 管道">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
            </Field>
            <Field label="使用者每日上限">
              <input
                type="number"
                min={1}
                value={draft.daily_user_limit}
                onChange={(e) => setDraft({ ...draft, daily_user_limit: Number(e.target.value) })}
                style={inputStyle}
              />
            </Field>
            <Field label="課程每月上限（選填）">
              <input
                type="number"
                min={1}
                value={draft.monthly_course_limit ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    monthly_course_limit: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                style={inputStyle}
              />
            </Field>
            <Field label="字幕／逐字稿保留天數">
              <input
                type="number"
                min={0}
                value={draft.retention_days_transcript}
                onChange={(e) => setDraft({ ...draft, retention_days_transcript: Number(e.target.value) })}
                style={inputStyle}
              />
            </Field>
            <Field label="切段摘要保留天數">
              <input
                type="number"
                min={0}
                value={draft.retention_days_segments}
                onChange={(e) => setDraft({ ...draft, retention_days_segments: Number(e.target.value) })}
                style={inputStyle}
              />
            </Field>
            <Field label="強制 PII 屏蔽">
              <input
                type="checkbox"
                checked={draft.pii_redaction_required}
                onChange={(e) => setDraft({ ...draft, pii_redaction_required: e.target.checked })}
              />
            </Field>
            <Field label="允許跨境保存">
              <input
                type="checkbox"
                checked={draft.cross_border_storage_allowed}
                onChange={(e) => setDraft({ ...draft, cross_border_storage_allowed: e.target.checked })}
              />
            </Field>
            <Field label="跨境地區註記">
              <input
                value={draft.cross_border_region ?? ''}
                onChange={(e) => setDraft({ ...draft, cross_border_region: e.target.value || null })}
                placeholder="例：US-East / EU / TW"
                style={inputStyle}
              />
            </Field>
            <Field label="資料處理者名稱">
              <input
                value={draft.data_processor_name}
                onChange={(e) => setDraft({ ...draft, data_processor_name: e.target.value })}
                style={inputStyle}
              />
            </Field>
          </div>

          <Field label="同意條款內文（顯示給師生）">
            <textarea
              value={draft.consent_text}
              onChange={(e) => setDraft({ ...draft, consent_text: e.target.value })}
              rows={4}
              style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
            />
          </Field>

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              style={{
                padding: '10px 16px',
                borderRadius: 10,
                border: '1px solid #007aff',
                background: '#007aff',
                color: '#fff',
                fontWeight: 700,
                cursor: busy ? 'wait' : 'pointer',
              }}>
              {busy ? '儲存中…' : '儲存'}
            </button>
            <button
              type="button"
              onClick={() => void purge()}
              disabled={busy}
              style={{
                padding: '10px 16px',
                borderRadius: 10,
                border: '1px solid #fca5a5',
                background: '#fff',
                fontWeight: 700,
                cursor: busy ? 'wait' : 'pointer',
              }}>
              清掃過期 transcript / segments
            </button>
            {info ? <span style={{ color: '#34C759', alignSelf: 'center' }}>{info}</span> : null}
            {policy ? (
              <span style={{ color: '#8E8E93', alignSelf: 'center', fontSize: 12 }}>
                最後更新：{new Date(policy.updated_at).toLocaleString()}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <h2 style={{ marginTop: 28, fontSize: 18 }}>Quota 概況（最近 500 列）</h2>
      <p style={{ color: '#8E8E93', fontSize: 13 }}>
        紅底列為已達當日上限的使用者。請與法務／系所對齊配額是否合理。
      </p>
      <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #E5E5EA', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F2F2F7' }}>
              <th style={cellStyle}>user_id</th>
              <th style={cellStyle}>日期</th>
              <th style={cellStyle}>使用</th>
              <th style={cellStyle}>配額</th>
              <th style={cellStyle}>使用率</th>
              <th style={cellStyle}>超限</th>
            </tr>
          </thead>
          <tbody>
            {quota.map((q, i) => (
              <tr key={`${q.user_id}-${q.usage_date}-${i}`} style={{ background: q.over_limit ? '#fef2f2' : undefined }}>
                <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: 11 }}>{q.user_id}</td>
                <td style={cellStyle}>{q.usage_date}</td>
                <td style={cellStyle}>{q.requests}</td>
                <td style={cellStyle}>{q.quota}</td>
                <td style={cellStyle}>
                  {q.utilization == null ? '—' : `${(q.utilization * 100).toFixed(0)}%`}
                </td>
                <td style={cellStyle}>{q.over_limit ? '是' : '否'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {quota.length === 0 ? <p style={{ color: '#8E8E93' }}>尚無 AI usage 資料。</p> : null}
    </RequireAdmin>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
      <span style={{ fontWeight: 700, fontSize: 13 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  fontSize: 14,
  width: '100%',
  maxWidth: 320,
};

const cellStyle: React.CSSProperties = {
  padding: 8,
  border: '1px solid #E5E5EA',
  textAlign: 'left',
};
