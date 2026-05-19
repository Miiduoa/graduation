'use client';

import { RequireAdmin } from '@/components/RequireAdmin';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '@/lib/rechartsShim';

type PushLogRow = {
  id: string;
  notification_id: string;
  status: string;
  http_status: number | null;
  error_detail: string | null;
  expo_ticket_sample: unknown;
  created_at: string;
};

type DlqNotificationRow = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  push_dispatch_attempts: number | null;
  push_dispatch_error: string | null;
  push_dispatch_abandoned_at: string | null;
  created_at: string;
};

type DlqSummary = {
  pending_total?: number;
  stuck_ge3?: number;
  exhausted_total?: number;
  logs_last_24h?: number;
  alerts_pending?: number;
  error?: string;
};

type RetryCurvePoint = { bucket_hour: string; status: string; event_count: number };

/** 對齊 Dispatch：尚待派發、未放棄、且已達重試門檻者視為「卡住（DLQ 候選）」。 */
export default function PushLogsPage() {
  const [rows, setRows] = useState<PushLogRow[]>([]);
  const [filterId, setFilterId] = useState('');
  const [stuckThreshold, setStuckThreshold] = useState(3);
  const [pendingDlq, setPendingDlq] = useState<DlqNotificationRow[]>([]);
  const [exhaustedDlq, setExhaustedDlq] = useState<DlqNotificationRow[]>([]);
  const [summary, setSummary] = useState<DlqSummary | null>(null);
  const [curve, setCurve] = useState<{ hour: string; success: number; failed: number; attempted: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dlqError, setDlqError] = useState<string | null>(null);
  const [dlqBusyId, setDlqBusyId] = useState<string | null>(null);
  const [selectedPending, setSelectedPending] = useState<Set<string>>(new Set());
  const [selectedExhausted, setSelectedExhausted] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const trimmedFilter = filterId.trim();

  const loadSummary = useCallback(async () => {
    const supabase = getBrowserSupabase();
    const { data, error: sErr } = await supabase.rpc('admin_dlq_summary');
    if (sErr) {
      setSummary({ error: sErr.message });
      return;
    }
    setSummary((data as DlqSummary) ?? null);
  }, []);

  const loadCurve = useCallback(async () => {
    const supabase = getBrowserSupabase();
    const { data, error: cErr } = await supabase.rpc('admin_push_retry_curve', { p_hours: 48 });
    if (cErr) {
      setCurve([]);
      return;
    }
    const rows = (data ?? []) as RetryCurvePoint[];
    const buckets = new Map<string, { hour: string; success: number; failed: number; attempted: number }>();
    for (const r of rows) {
      const h = new Date(r.bucket_hour).toLocaleString(undefined, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
      });
      const b = buckets.get(h) ?? { hour: h, success: 0, failed: 0, attempted: 0 };
      if (r.status === 'success') b.success += r.event_count;
      else if (r.status === 'failed') b.failed += r.event_count;
      else if (r.status === 'attempted') b.attempted += r.event_count;
      buckets.set(h, b);
    }
    setCurve(Array.from(buckets.values()));
  }, []);

  const loadDlq = useCallback(async () => {
    const supabase = getBrowserSupabase();
    const { data: pending, error: pErr } = await supabase
      .from('notifications')
      .select(
        'id, user_id, title, body, push_dispatch_attempts, push_dispatch_error, push_dispatch_abandoned_at, created_at',
      )
      .is('push_dispatched_at', null)
      .is('push_dispatch_abandoned_at', null)
      .gte('push_dispatch_attempts', stuckThreshold)
      .order('created_at', { ascending: true })
      .limit(80);

    const { data: exhausted, error: eErr } = await supabase
      .from('notifications')
      .select(
        'id, user_id, title, body, push_dispatch_attempts, push_dispatch_error, push_dispatch_abandoned_at, created_at',
      )
      .is('push_dispatched_at', null)
      .not('push_dispatch_abandoned_at', 'is', null)
      .order('push_dispatch_abandoned_at', { ascending: false })
      .limit(80);

    const errMsg = pErr?.message ?? eErr?.message ?? null;
    if (errMsg) {
      setDlqError(errMsg);
      setPendingDlq([]);
      setExhaustedDlq([]);
      return false;
    }
    setPendingDlq((pending ?? []) as DlqNotificationRow[]);
    setExhaustedDlq((exhausted ?? []) as DlqNotificationRow[]);
    setSelectedPending(new Set());
    setSelectedExhausted(new Set());
    setDlqError(null);
    return true;
  }, [stuckThreshold]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.all([loadDlq(), loadSummary(), loadCurve()]);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDlq, loadSummary, loadCurve]);

  async function retryDispatchRow(id: string) {
    if (!window.confirm('清除此列之重試鎖並歸零次數（僅限尚未 dispatched）？須 migration 已到帳。')) return;
    setDlqBusyId(id);
    const supabase = getBrowserSupabase();
    const { data, error: rErr } = await supabase.rpc('admin_retry_notification_dispatch', {
      p_notification_id: id,
    });
    setDlqBusyId(null);
    if (rErr) {
      window.alert(`RPC 失敗：${rErr.message}`);
      return;
    }
    if (data !== true) {
      window.alert('未取得更新（通知可能已成功 dispatched 或非平台管理員）；請檢察 RLS。');
      return;
    }
    await Promise.all([loadDlq(), loadSummary()]);
  }

  async function bulkRetry(ids: string[]) {
    if (ids.length === 0) return;
    if (!window.confirm(`對 ${ids.length} 筆通知清除重試鎖並歸零次數？`)) return;
    setBulkBusy(true);
    const supabase = getBrowserSupabase();
    const { data, error: rErr } = await supabase.rpc('admin_bulk_retry_notification_dispatch', {
      p_ids: ids,
    });
    setBulkBusy(false);
    if (rErr) {
      window.alert(`RPC 失敗：${rErr.message}`);
      return;
    }
    window.alert(`成功清除 ${data ?? 0} 列重試鎖`);
    await Promise.all([loadDlq(), loadSummary()]);
  }

  async function bulkCancel(ids: string[]) {
    if (ids.length === 0) return;
    if (!window.confirm(`對 ${ids.length} 筆通知標記放棄（停止後續派發）？`)) return;
    setBulkBusy(true);
    const supabase = getBrowserSupabase();
    const { data, error: rErr } = await supabase.rpc('admin_bulk_cancel_notification_dispatch', {
      p_ids: ids,
    });
    setBulkBusy(false);
    if (rErr) {
      window.alert(`RPC 失敗：${rErr.message}`);
      return;
    }
    window.alert(`成功放棄 ${data ?? 0} 列`);
    await Promise.all([loadDlq(), loadSummary()]);
  }

  async function purgeExpired() {
    if (!window.confirm('清除 push 派發 log 中已過保留期之條目（不可復原）？')) return;
    setBulkBusy(true);
    const supabase = getBrowserSupabase();
    const { data, error: rErr } = await supabase.rpc('admin_purge_expired_dlq');
    setBulkBusy(false);
    if (rErr) {
      window.alert(`RPC 失敗：${rErr.message}`);
      return;
    }
    window.alert(`已清除 ${data ?? 0} 筆 log`);
    await Promise.all([loadDlq(), loadSummary()]);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getBrowserSupabase();
      let q = supabase
        .from('notification_push_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(120);
      if (trimmedFilter) {
        q = q.eq('notification_id', trimmedFilter);
      }
      const { data, error: qErr } = await q;
      if (cancelled) return;
      if (qErr) {
        setError(qErr.message);
        setRows([]);
        return;
      }
      setRows((data ?? []) as PushLogRow[]);
      setError(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [trimmedFilter]);

  const summaryView = useMemo(() => ({ count: rows.length }), [rows.length]);

  return (
    <RequireAdmin>
      <h1 style={{ marginTop: 0 }}>推播發送紀錄與 DLQ（商用對齊）</h1>
      <p style={{ color: '#3C3C43', fontSize: 14, lineHeight: 1.6 }}>
        由 Edge <code>dispatch-notification-push</code> 寫入紀錄；未成功派發之通知仍留在 <code>notifications</code>（
        <code>push_dispatched_at</code>
        {` `}為 null）。環境變數 <code>PUSH_DISPATCH_MAX_ATTEMPTS</code> 決定自動重試上限，逾限後標記{' '}
        <code>push_dispatch_abandoned_at</code>。
      </p>

      <section
        style={{
          marginTop: 16,
          padding: 16,
          background: '#fff',
          borderRadius: 12,
          border: '1px solid #E5E5EA',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
        }}>
        <SummaryCell label="待派發 (total)" value={summary?.pending_total} />
        <SummaryCell label="卡住 (≥3 次)" value={summary?.stuck_ge3} highlight={!!(summary?.stuck_ge3 ?? 0)} />
        <SummaryCell
          label="窮舉 (已放棄)"
          value={summary?.exhausted_total}
          highlight={!!(summary?.exhausted_total ?? 0)}
        />
        <SummaryCell label="24h log" value={summary?.logs_last_24h} />
        <SummaryCell label="未派發告警" value={summary?.alerts_pending} highlight={!!(summary?.alerts_pending ?? 0)} />
      </section>

      <section
        style={{
          marginTop: 16,
          padding: 16,
          background: '#fff',
          borderRadius: 12,
          border: '1px solid #E5E5EA',
        }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>近 48 小時派發重試曲線</h2>
        {curve.length === 0 ? (
          <p style={{ color: '#8E8E93', fontSize: 13 }}>尚無資料（或 migration 未到帳）。</p>
        ) : (
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={curve}>
                <CartesianGrid strokeDasharray="4 8" stroke="#E5E5EA" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} width={40} />
                <Tooltip />
                <Legend />
                <Bar dataKey="success" stackId="a" fill="#34C759" name="success" />
                <Bar dataKey="attempted" stackId="a" fill="#5856D6" name="attempted" />
                <Bar dataKey="failed" stackId="a" fill="#FF3B30" name="failed" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section style={{ marginTop: 24, padding: 16, background: '#fff', borderRadius: 12, border: '1px solid #fecaca' }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>DLQ／卡住區塊</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>
            「卡住」重試次數門檻（gte）
            <input
              type="number"
              min={1}
              max={50}
              value={stuckThreshold}
              onChange={(e) => setStuckThreshold(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
              style={{
                display: 'block',
                marginTop: 8,
                width: 120,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => void purgeExpired()}
            disabled={bulkBusy}
            style={dangerBtnStyle}>
            清除過期 log
          </button>
        </div>

        {dlqError ? (
          <p style={{ color: '#FF3B30', marginTop: 12 }}>
            DLQ 讀取錯誤：{dlqError}（若 migration 未到帳或未具 admin RLS）
          </p>
        ) : null}

        <h3 style={{ marginTop: 20, fontSize: 15 }}>尚待派發且重試達門檻</h3>
        <BulkActions
          ids={Array.from(selectedPending)}
          onRetry={(ids) => void bulkRetry(ids)}
          onCancel={(ids) => void bulkCancel(ids)}
          disabled={bulkBusy}
        />
        <DlqMiniTable
          rows={pendingDlq}
          variant="pending"
          busyId={dlqBusyId}
          selected={selectedPending}
          onToggle={(id) => {
            const n = new Set(selectedPending);
            if (n.has(id)) n.delete(id); else n.add(id);
            setSelectedPending(n);
          }}
          onSelectAll={() => setSelectedPending(new Set(pendingDlq.map((r) => r.id)))}
          onClear={() => setSelectedPending(new Set())}
          onRetry={(rid) => void retryDispatchRow(rid)}
        />

        <h3 style={{ marginTop: 20, fontSize: 15 }}>達重試上限（已標記放棄）</h3>
        <BulkActions
          ids={Array.from(selectedExhausted)}
          onRetry={(ids) => void bulkRetry(ids)}
          onCancel={() => undefined}
          disabled={bulkBusy}
          hideCancel
        />
        <DlqMiniTable
          rows={exhaustedDlq}
          variant="exhausted"
          busyId={dlqBusyId}
          selected={selectedExhausted}
          onToggle={(id) => {
            const n = new Set(selectedExhausted);
            if (n.has(id)) n.delete(id); else n.add(id);
            setSelectedExhausted(n);
          }}
          onSelectAll={() => setSelectedExhausted(new Set(exhaustedDlq.map((r) => r.id)))}
          onClear={() => setSelectedExhausted(new Set())}
          onRetry={(rid) => void retryDispatchRow(rid)}
        />
      </section>

      <hr style={{ margin: '28px 0', borderColor: '#E5E5EA' }} />

      <h2 style={{ fontSize: 18 }}>推播發送紀錄</h2>
      <label style={{ display: 'block', marginTop: 12, fontSize: 14, fontWeight: 600 }}>
        notification_id（選填）
        <input
          value={filterId}
          onChange={(e) => setFilterId(e.target.value)}
          placeholder="UUID"
          style={{
            display: 'block',
            marginTop: 6,
            width: '100%',
            maxWidth: 420,
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid #d1d5db',
            fontFamily: 'ui-monospace, monospace',
            fontSize: 13,
          }}
        />
      </label>
      <p style={{ color: '#8E8E93', fontSize: 13 }}>目前顯示 {summaryView.count} 筆（最多 120）。</p>
      {error ? <p style={{ color: '#FF3B30' }}>{error}</p> : null}
      <div style={{ overflowX: 'auto', marginTop: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F2F2F7', textAlign: 'left' }}>
              <th style={{ padding: 8, border: '1px solid #E5E5EA' }}>時間</th>
              <th style={{ padding: 8, border: '1px solid #E5E5EA' }}>notification</th>
              <th style={{ padding: 8, border: '1px solid #E5E5EA' }}>狀態</th>
              <th style={{ padding: 8, border: '1px solid #E5E5EA' }}>HTTP</th>
              <th style={{ padding: 8, border: '1px solid #E5E5EA' }}>錯誤摘要</th>
              <th style={{ padding: 8, border: '1px solid #E5E5EA' }}>Expo ticket 樣本</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: 8, border: '1px solid #eee', whiteSpace: 'nowrap' }}>
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td style={{ padding: 8, border: '1px solid #eee', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 11 }}>
                  {r.notification_id}
                </td>
                <td style={{ padding: 8, border: '1px solid #eee' }}>{r.status}</td>
                <td style={{ padding: 8, border: '1px solid #eee' }}>{r.http_status ?? '—'}</td>
                <td style={{ padding: 8, border: '1px solid #eee', maxWidth: 260, wordBreak: 'break-word' }}>
                  {r.error_detail ?? '—'}
                </td>
                <td style={{ padding: 8, border: '1px solid #eee', maxWidth: 320, wordBreak: 'break-word', fontFamily: 'monospace', fontSize: 11 }}>
                  {JSON.stringify(r.expo_ticket_sample ?? null)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!error && rows.length === 0 ? (
        <p style={{ color: '#8E8E93' }}>尚無紀錄（或請確認 migration 已套用）。</p>
      ) : null}
    </RequireAdmin>
  );
}

const dangerBtnStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 13,
  fontWeight: 700,
  borderRadius: 8,
  border: '1px solid #fca5a5',
  background: '#fff',
  cursor: 'pointer',
};

function SummaryCell({ label, value, highlight }: { label: string; value?: number; highlight?: boolean }) {
  return (
    <div
      style={{
        padding: 12,
        background: highlight ? '#fef2f2' : '#F2F2F7',
        borderRadius: 10,
        border: highlight ? '1px solid #fecaca' : '1px solid #E5E5EA',
      }}>
      <div style={{ fontSize: 12, color: '#8E8E93' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: highlight ? '#FF3B30' : '#1C1C1E' }}>
        {value == null ? '—' : value}
      </div>
    </div>
  );
}

function BulkActions({
  ids,
  onRetry,
  onCancel,
  disabled,
  hideCancel,
}: {
  ids: string[];
  onRetry: (ids: string[]) => void;
  onCancel: (ids: string[]) => void;
  disabled: boolean;
  hideCancel?: boolean;
}) {
  if (ids.length === 0) return null;
  return (
    <div style={{ margin: '8px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, color: '#1f2937' }}>已選 {ids.length} 筆 ▸</span>
      <button type="button" disabled={disabled} onClick={() => onRetry(ids)} style={dangerBtnStyle}>
        批次清除重試鎖
      </button>
      {!hideCancel ? (
        <button type="button" disabled={disabled} onClick={() => onCancel(ids)} style={dangerBtnStyle}>
          批次標記放棄
        </button>
      ) : null}
    </div>
  );
}

function DlqMiniTable({
  rows,
  variant,
  busyId,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  onRetry,
}: {
  rows: DlqNotificationRow[];
  variant: 'pending' | 'exhausted';
  busyId: string | null;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onRetry: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p style={{ color: '#8E8E93', fontSize: 13 }}>
        {variant === 'pending' ? '目前沒有待處理的「卡住」通知。' : '目前沒有窮舉記錄。'}
      </p>
    );
  }

  return (
    <div style={{ overflowX: 'auto', marginTop: 10 }}>
      <div style={{ display: 'flex', gap: 8, padding: 6 }}>
        <button type="button" onClick={onSelectAll} style={selBtnStyle}>全選</button>
        <button type="button" onClick={onClear} style={selBtnStyle}>清除</button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#fef2f2', textAlign: 'left' }}>
            <th style={{ padding: 8, border: '1px solid #fecaca' }}>選</th>
            <th style={{ padding: 8, border: '1px solid #fecaca' }}>建立時間</th>
            <th style={{ padding: 8, border: '1px solid #fecaca' }}>id</th>
            <th style={{ padding: 8, border: '1px solid #fecaca' }}>收件人 profile</th>
            <th style={{ padding: 8, border: '1px solid #fecaca' }}>標題／摘要</th>
            <th style={{ padding: 8, border: '1px solid #fecaca' }}>#重試</th>
            <th style={{ padding: 8, border: '1px solid #fecaca' }}>錯誤</th>
            {variant === 'exhausted' ? (
              <th style={{ padding: 8, border: '1px solid #fecaca' }}>放棄於</th>
            ) : null}
            <th style={{ padding: 8, border: '1px solid #fecaca' }}>營運</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ padding: 8, border: '1px solid #fde8e8' }}>
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => onToggle(r.id)}
                />
              </td>
              <td style={{ padding: 8, border: '1px solid #fde8e8', whiteSpace: 'nowrap' }}>
                {new Date(r.created_at).toLocaleString()}
              </td>
              <td style={{ padding: 8, border: '1px solid #fde8e8', fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{r.id}</td>
              <td style={{ padding: 8, border: '1px solid #fde8e8', fontFamily: 'monospace', fontSize: 11 }}>{r.user_id}</td>
              <td style={{ padding: 8, border: '1px solid #fde8e8', maxWidth: 220 }}>
                <strong>{r.title}</strong>
                <div style={{ fontSize: 12, color: '#3C3C43' }}>{(r.body ?? '').slice(0, 120)}{(r.body?.length ?? 0) > 120 ? '…' : ''}</div>
              </td>
              <td style={{ padding: 8, border: '1px solid #fde8e8' }}>{r.push_dispatch_attempts ?? 0}</td>
              <td style={{ padding: 8, border: '1px solid #fde8e8', maxWidth: 280, wordBreak: 'break-word', fontSize: 12 }}>
                {r.push_dispatch_error ?? '—'}
              </td>
              {variant === 'exhausted' ? (
                <td style={{ padding: 8, border: '1px solid #fde8e8', whiteSpace: 'nowrap', fontSize: 12 }}>
                  {r.push_dispatch_abandoned_at ? new Date(r.push_dispatch_abandoned_at).toLocaleString() : '—'}
                </td>
              ) : null}
              <td style={{ padding: 8, border: '1px solid #fde8e8' }}>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => onRetry(r.id)}
                  style={{
                    padding: '6px 10px',
                    fontSize: 12,
                    fontWeight: 700,
                    borderRadius: 8,
                    border: '1px solid #fca5a5',
                    background: '#fff',
                    cursor: busyId === r.id ? 'wait' : 'pointer',
                  }}>
                  {busyId === r.id ? '…' : '復原重試計數'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const selBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid #E5E5EA',
  background: '#fff',
  cursor: 'pointer',
};
