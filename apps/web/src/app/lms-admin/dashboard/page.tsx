'use client';

import { useCallback, useEffect, useState } from 'react';

import { RequireAdmin } from '@/components/RequireAdmin';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type CourseRow = { id: string; title: string };
type AtRiskRow = {
  course_id: string;
  student_id: string;
  weighted_percent: number | null;
  recent_attendances: number;
  recent_forum_posts: number;
  recent_quiz_attempts: number;
  missing_assignments: number;
  risk_level: string;
};
type DashboardRow = {
  course_id: string;
  student_id: string;
  assignments_pending: number | null;
  quizzes_not_attempted: number | null;
  peer_reviews_pending: number | null;
  badges_earned: number | null;
  weighted_percent: number | null;
};
type SearchRow = {
  kind: string;
  record_id: string;
  title: string;
  snippet: string;
  touched_at: string;
};

/**
 * 教師／管理員儀表板 widgets：
 * 1. 學生儀表板（my_dashboard，匿名查整課平均）
 * 2. 預警系統（reporting_at_risk_students）
 * 3. 全文搜尋（search_course）
 */
export default function DashboardPage() {
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [courseId, setCourseId] = useState('');
  const [atRisk, setAtRisk] = useState<AtRiskRow[]>([]);
  const [dashboard, setDashboard] = useState<DashboardRow[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = getBrowserSupabase();
      const { data } = await supabase.from('courses').select('id, title').order('created_at', { ascending: false }).limit(200);
      setCourses((data ?? []) as CourseRow[]);
    })();
  }, []);

  const reload = useCallback(async () => {
    if (!courseId) return;
    const supabase = getBrowserSupabase();
    const { data: atR, error: e1 } = await supabase
      .from('reporting_at_risk_students')
      .select('*')
      .eq('course_id', courseId);
    if (e1) setError(e1.message);
    setAtRisk(((atR ?? []) as AtRiskRow[]).filter((r) => r.risk_level !== 'ok'));

    const { data: db, error: e2 } = await supabase
      .from('reporting_student_dashboard')
      .select('course_id, student_id, assignments_pending, quizzes_not_attempted, peer_reviews_pending, badges_earned, weighted_percent')
      .eq('course_id', courseId)
      .limit(200);
    if (e2) setError(e2.message);
    setDashboard((db ?? []) as DashboardRow[]);
  }, [courseId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function runSearch() {
    if (!courseId || !query.trim()) return;
    setBusy(true);
    const supabase = getBrowserSupabase();
    const { data, error: e } = await supabase.rpc('search_course', {
      p_course_id: courseId,
      p_query: query.trim(),
    });
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    setHits((data ?? []) as SearchRow[]);
  }

  const summary = (() => {
    if (dashboard.length === 0) return null;
    const sum = (k: keyof DashboardRow) =>
      dashboard.reduce((s, r) => s + Number(r[k] ?? 0), 0);
    const avgWp = (() => {
      const vs = dashboard
        .map((r) => Number(r.weighted_percent ?? 0))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (vs.length === 0) return 0;
      return vs.reduce((a, b) => a + b, 0) / vs.length;
    })();
    return {
      students: dashboard.length,
      assignments_pending: sum('assignments_pending'),
      quizzes_not_attempted: sum('quizzes_not_attempted'),
      peer_reviews_pending: sum('peer_reviews_pending'),
      badges_earned: sum('badges_earned'),
      avgWp,
    };
  })();

  return (
    <RequireAdmin>
      <h1 style={{ marginTop: 0 }}>教學儀表板（學生儀表板／預警／搜尋）</h1>
      <p style={{ color: '#3C3C43', lineHeight: 1.6 }}>
        對應 view <code>reporting_student_dashboard</code>、<code>reporting_at_risk_students</code> 與 RPC <code>search_course</code>。
      </p>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12, maxWidth: 320 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>課程</span>
        <select value={courseId} onChange={(e) => setCourseId(e.target.value)} style={selectStyle}>
          <option value="">請選課…</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>

      {error ? <p style={{ color: '#FF3B30' }}>{error}</p> : null}

      {/* Widget 1: 課程整體儀表板摘要 */}
      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16 }}>課程整體統計（aggregated student dashboard）</h2>
        {!summary ? (
          <p style={{ color: '#8E8E93' }}>請選課。</p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
            }}>
            <Card label="學生數" value={summary.students} />
            <Card label="待繳作業（總）" value={summary.assignments_pending} />
            <Card label="未作答測驗（總）" value={summary.quizzes_not_attempted} />
            <Card label="待評同儕（總）" value={summary.peer_reviews_pending} />
            <Card label="徽章累積" value={summary.badges_earned} />
            <Card label="加權平均" value={`${summary.avgWp.toFixed(1)}%`} />
          </div>
        )}
      </section>

      {/* Widget 2: 預警學員 */}
      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 16 }}>預警學員（warn/critical）</h2>
        {atRisk.length === 0 ? (
          <p style={{ color: '#8E8E93' }}>目前沒有預警學員。</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: '#F2F2F7' }}>
                  <th style={cellStyle}>學號／profile</th>
                  <th style={cellStyle}>加權</th>
                  <th style={cellStyle}>21d 簽到</th>
                  <th style={cellStyle}>21d 發文</th>
                  <th style={cellStyle}>21d 作答</th>
                  <th style={cellStyle}>缺繳</th>
                  <th style={cellStyle}>等級</th>
                </tr>
              </thead>
              <tbody>
                {atRisk.map((r) => (
                  <tr
                    key={r.student_id}
                    style={{ background: r.risk_level === 'critical' ? '#fee2e2' : '#fef3c7' }}>
                    <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: 11 }}>{r.student_id}</td>
                    <td style={cellStyle}>{Number(r.weighted_percent ?? 0).toFixed(1)}%</td>
                    <td style={cellStyle}>{r.recent_attendances}</td>
                    <td style={cellStyle}>{r.recent_forum_posts}</td>
                    <td style={cellStyle}>{r.recent_quiz_attempts}</td>
                    <td style={cellStyle}>{r.missing_assignments}</td>
                    <td style={cellStyle}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: r.risk_level === 'critical' ? '#FF3B30' : '#FF9500',
                          color: '#fff',
                          fontSize: 11,
                          fontWeight: 700,
                        }}>
                        {r.risk_level}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Widget 3: 全文搜尋 */}
      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 16 }}>全文搜尋（教材／公告／論壇）</h2>
        <div style={{ display: 'flex', gap: 8, maxWidth: 600 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch();
            }}
            placeholder="輸入關鍵字…"
            style={{ ...selectStyle, flex: 1 }}
          />
          <button type="button" onClick={() => void runSearch()} disabled={busy || !courseId} style={btnStyle}>
            搜尋
          </button>
        </div>

        {hits.length > 0 ? (
          <ul style={{ marginTop: 12, padding: 0, listStyle: 'none' }}>
            {hits.map((h) => (
              <li
                key={`${h.kind}-${h.record_id}`}
                style={{ padding: 10, marginBottom: 6, border: '1px solid #E5E5EA', borderRadius: 8, background: '#fff' }}>
                <strong>[{h.kind}]</strong> {h.title}
                <div style={{ fontSize: 12, color: '#8E8E93' }}>{h.snippet}</div>
                <div style={{ fontSize: 11, color: '#AEAEB2' }}>{new Date(h.touched_at).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </RequireAdmin>
  );
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ padding: 12, background: '#F2F2F7', borderRadius: 10, border: '1px solid #E5E5EA' }}>
      <div style={{ fontSize: 12, color: '#8E8E93' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#1C1C1E' }}>{value}</div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14,
};
const btnStyle: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 10, border: '1px solid #5856D6',
  background: '#5856D6', color: '#fff', fontWeight: 700, cursor: 'pointer',
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const cellStyle: React.CSSProperties = { padding: 8, border: '1px solid #E5E5EA', textAlign: 'left' };
