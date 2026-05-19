'use client';

import { useCallback, useEffect, useState } from 'react';

import { RequireAdmin } from '@/components/RequireAdmin';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type Term = {
  id: string;
  code: string;
  display_name: string;
  starts_at: string;
  ends_at: string;
  is_current: boolean;
};
type Department = {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
};

/**
 * 學年學期與系所管理頁。
 * 對應 academic_terms 與 departments 表（migration 20260520160000）。
 */
export default function TermsPage() {
  const [tab, setTab] = useState<'terms' | 'departments'>('terms');
  const [terms, setTerms] = useState<Term[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const supabase = getBrowserSupabase();
    if (tab === 'terms') {
      const { data, error: e } = await supabase
        .from('academic_terms')
        .select('id, code, display_name, starts_at, ends_at, is_current')
        .order('starts_at', { ascending: false });
      if (e) setError(e.message);
      setTerms((data ?? []) as Term[]);
    } else {
      const { data, error: e } = await supabase
        .from('departments')
        .select('id, code, name, parent_id')
        .order('code');
      if (e) setError(e.message);
      setDepartments((data ?? []) as Department[]);
    }
  }, [tab]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function addTerm() {
    const code = window.prompt('學期代碼（例：114-1）');
    if (!code) return;
    const display = window.prompt('顯示名稱（例：114 學年度 第一學期）');
    if (!display) return;
    const starts = window.prompt('起始日（YYYY-MM-DD）');
    if (!starts) return;
    const ends = window.prompt('結束日（YYYY-MM-DD）');
    if (!ends) return;
    setBusy(true);
    const supabase = getBrowserSupabase();
    const { error: e } = await supabase.from('academic_terms').insert({
      code, display_name: display,
      starts_at: new Date(starts).toISOString(),
      ends_at: new Date(ends).toISOString(),
    });
    setBusy(false);
    if (e) { window.alert(e.message); return; }
    setInfo('學期已新增');
    await reload();
  }

  async function setCurrentTerm(id: string) {
    if (!window.confirm('將此學期設為當前學期？其他學期會自動取消。')) return;
    setBusy(true);
    const supabase = getBrowserSupabase();
    // 同時 update：先清掉舊的，再開新的
    const { error: e1 } = await supabase
      .from('academic_terms')
      .update({ is_current: false })
      .eq('is_current', true);
    if (e1) { setBusy(false); window.alert(e1.message); return; }
    const { error: e2 } = await supabase
      .from('academic_terms')
      .update({ is_current: true })
      .eq('id', id);
    setBusy(false);
    if (e2) { window.alert(e2.message); return; }
    setInfo('已切換當前學期');
    await reload();
  }

  async function addDept() {
    const code = window.prompt('系所代碼（例：CSIE、MIS、EE）');
    if (!code) return;
    const name = window.prompt('系所名稱');
    if (!name) return;
    const parent = window.prompt('上層系所 UUID（選填，留空則為頂層）') || null;
    setBusy(true);
    const supabase = getBrowserSupabase();
    const { error: e } = await supabase.from('departments').insert({
      code, name, parent_id: parent,
    });
    setBusy(false);
    if (e) { window.alert(e.message); return; }
    setInfo('系所已新增');
    await reload();
  }

  return (
    <RequireAdmin>
      <h1 style={{ marginTop: 0 }}>學期 / 系所管理</h1>
      <p style={{ color: '#4b5563', lineHeight: 1.6 }}>
        對應 <code>academic_terms</code> 與 <code>departments</code>。學期切換會影響 <code>courses.term_id</code> 查詢；
        標示 <code>is_current=true</code> 之學期僅一筆（UI 限制）。
      </p>

      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        {(['terms', 'departments'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: '8px 14px', borderRadius: 8, border: '1px solid #d1d5db',
              background: tab === t ? '#2563eb' : '#fff', color: tab === t ? '#fff' : '#111827',
              fontWeight: 700, cursor: 'pointer',
            }}>
            {t === 'terms' ? '學期' : '系所'}
          </button>
        ))}
      </div>

      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      {info ? <p style={{ color: '#059669' }}>{info}</p> : null}

      {tab === 'terms' ? (
        <section style={{ marginTop: 16 }}>
          <button type="button" onClick={() => void addTerm()} disabled={busy} style={primaryBtn}>+ 新增學期</button>
          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: '#f3f4f6' }}>
                  <th style={cellStyle}>代碼</th>
                  <th style={cellStyle}>名稱</th>
                  <th style={cellStyle}>起</th>
                  <th style={cellStyle}>迄</th>
                  <th style={cellStyle}>當前</th>
                  <th style={cellStyle}>操作</th>
                </tr>
              </thead>
              <tbody>
                {terms.map((t) => (
                  <tr key={t.id} style={{ background: t.is_current ? '#ecfdf5' : undefined }}>
                    <td style={cellStyle}>{t.code}</td>
                    <td style={cellStyle}>{t.display_name}</td>
                    <td style={cellStyle}>{new Date(t.starts_at).toLocaleDateString()}</td>
                    <td style={cellStyle}>{new Date(t.ends_at).toLocaleDateString()}</td>
                    <td style={cellStyle}>{t.is_current ? '✅' : ''}</td>
                    <td style={cellStyle}>
                      {!t.is_current ? (
                        <button type="button" onClick={() => void setCurrentTerm(t.id)} disabled={busy} style={smallBtn}>
                          設為當前
                        </button>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {terms.length === 0 ? <p style={{ color: '#6b7280' }}>尚無學期，請新增。</p> : null}
        </section>
      ) : (
        <section style={{ marginTop: 16 }}>
          <button type="button" onClick={() => void addDept()} disabled={busy} style={primaryBtn}>+ 新增系所</button>
          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: '#f3f4f6' }}>
                  <th style={cellStyle}>代碼</th>
                  <th style={cellStyle}>名稱</th>
                  <th style={cellStyle}>上層</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.id}>
                    <td style={cellStyle}>{d.code}</td>
                    <td style={cellStyle}>{d.name}</td>
                    <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: 11 }}>{d.parent_id ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {departments.length === 0 ? <p style={{ color: '#6b7280' }}>尚無系所，請新增。</p> : null}
        </section>
      )}
    </RequireAdmin>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 10, border: '1px solid #2563eb',
  background: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer',
};
const smallBtn: React.CSSProperties = {
  padding: '4px 10px', fontSize: 12, borderRadius: 6,
  border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer',
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const cellStyle: React.CSSProperties = { padding: 8, border: '1px solid #e5e7eb', textAlign: 'left' };
