'use client';

import { useEffect, useMemo, useState } from 'react';

import { RequireAdmin } from '@/components/RequireAdmin';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type CapRow = {
  role_key: string;
  capability_slug: string;
  allowed: boolean;
};

const ROLE_KEYS = ['teacher', 'assistant', 'moderator', 'student'] as const;
type RoleKey = (typeof ROLE_KEYS)[number];

const ROLE_LABEL: Record<RoleKey, string> = {
  teacher: '教師',
  assistant: '助教',
  moderator: '仲裁',
  student: '學生',
};

export default function RoleMatrixPage() {
  const [rows, setRows] = useState<CapRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function reload() {
    const supabase = getBrowserSupabase();
    const { data, error: qErr } = await supabase
      .from('course_role_capabilities')
      .select('role_key, capability_slug, allowed')
      .order('capability_slug', { ascending: true })
      .order('role_key', { ascending: true });
    if (qErr) {
      setError(qErr.message);
      setRows([]);
    } else {
      setRows((data ?? []) as CapRow[]);
      setError(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await reload();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const slugs = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.capability_slug);
    return Array.from(set).sort();
  }, [rows]);

  const byKey = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const r of rows) m.set(`${r.role_key}::${r.capability_slug}`, r.allowed);
    return m;
  }, [rows]);

  async function toggle(role: RoleKey, slug: string, next: boolean) {
    setBusyKey(`${role}::${slug}`);
    setInfo(null);
    const supabase = getBrowserSupabase();
    const { error: rErr } = await supabase.rpc('admin_set_course_role_capability', {
      p_role_key: role,
      p_capability_slug: slug,
      p_allowed: next,
    });
    setBusyKey(null);
    if (rErr) {
      window.alert(`RPC 失敗：${rErr.message}`);
      return;
    }
    setInfo(`${ROLE_LABEL[role]} × ${slug} → ${next ? '允許' : '禁止'}`);
    await reload();
  }

  async function addSlugFromPrompt() {
    const slug = window.prompt('新增 capability slug（例如：reports.bi_export）');
    if (!slug || !slug.trim()) return;
    const trimmed = slug.trim();
    setBusyKey(`add::${trimmed}`);
    setInfo(null);
    const supabase = getBrowserSupabase();
    const seed = ROLE_KEYS.map((rk) => ({
      role_key: rk,
      capability_slug: trimmed,
      allowed: rk === 'teacher',
    }));
    const { error: rErr } = await supabase.rpc('admin_bulk_set_course_role_capabilities', {
      p_rows: seed,
    });
    setBusyKey(null);
    if (rErr) {
      window.alert(`RPC 失敗：${rErr.message}`);
      return;
    }
    setInfo(`已新增能力 slug：${trimmed}（預設僅教師為 true）`);
    await reload();
  }

  return (
    <RequireAdmin>
      <h1 style={{ marginTop: 0 }}>課程角色能力矩陣（組態 RBAC）</h1>
      <p style={{ color: '#4b5563', lineHeight: 1.6 }}>
        資料表 <code>course_role_capabilities</code>；變更會即時影響 <code>course_member_has_capability</code> 與所有以該函式為門檻的 RLS／RPC。
        修改前請確認你的角色為 <code>profiles.role=&apos;admin&apos;</code>，且該能力之 RLS／RPC 已對應到該 slug。
      </p>

      <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid #2563eb',
            background: '#2563eb',
            color: '#fff',
            fontWeight: 700,
            cursor: 'pointer',
          }}
          onClick={() => void addSlugFromPrompt()}>
          新增能力 slug
        </button>
        {info ? <p style={{ color: '#059669', margin: 0 }}>{info}</p> : null}
      </div>

      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}

      <div style={{ overflowX: 'auto', marginTop: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
              <th style={{ padding: 10, borderBottom: '1px solid #e5e7eb' }}>Capability</th>
              {ROLE_KEYS.map((rk) => (
                <th key={rk} style={{ padding: 10, borderBottom: '1px solid #e5e7eb', textAlign: 'center' }}>
                  {ROLE_LABEL[rk]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slugs.map((slug) => (
              <tr key={slug}>
                <td
                  style={{
                    padding: 10,
                    borderBottom: '1px solid #f3f4f6',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 12,
                  }}>
                  {slug}
                </td>
                {ROLE_KEYS.map((rk) => {
                  const k = `${rk}::${slug}`;
                  const cur = byKey.get(k) ?? false;
                  const busy = busyKey === k;
                  return (
                    <td
                      key={rk}
                      style={{
                        padding: 10,
                        borderBottom: '1px solid #f3f4f6',
                        textAlign: 'center',
                      }}>
                      <label style={{ cursor: busy ? 'wait' : 'pointer' }}>
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={cur}
                          onChange={(e) => void toggle(rk, slug, e.target.checked)}
                        />
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!error && slugs.length === 0 ? (
        <p style={{ color: '#6b7280' }}>資料表為空或未套用最新 migration。</p>
      ) : null}
    </RequireAdmin>
  );
}
