'use client';

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
} from 'recharts';

import { RequireAdmin } from '@/components/RequireAdmin';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type CourseRow = {
  id: string;
  title: string;
};

type Rollup = {
  weighted_percent?: number | null;
};

type ItemScoreRow = {
  grade_item_id: string;
  item_title: string;
  max_points?: number | null;
  score?: number | null;
  student_id: string;
  category_title: string | null;
  score_updated_at?: string | null;
};

type QuizOverviewRow = {
  course_id: string;
  quiz_id: string;
  quiz_title: string;
  submitted_students: number | null;
  total_attempts: number | null;
  submitted_attempts: number | null;
  avg_score: number | null;
  max_score: number | null;
  min_score: number | null;
};

type LiveOverviewRow = {
  course_id: string;
  session_id: string;
  session_title: string;
  started_at: string;
  ended_at: string | null;
  attendance_total: number | null;
  attendance_late: number | null;
  attendance_on_time: number | null;
  attendance_absent: number | null;
};

type EngagementRow = {
  course_id: string;
  course_title: string;
  forum_posts_7d: number;
  quiz_submissions_7d: number;
  attendance_7d: number;
  refreshed_at: string;
};

type ViewMode = 'rollup' | 'detail' | 'quiz' | 'live' | 'engagement';

export default function AdminReportsPage() {
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [courseId, setCourseId] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('rollup');

  const [series, setSeries] = useState<{ idx: string; pct: number }[]>([]);
  const [itemScores, setItemScores] = useState<ItemScoreRow[]>([]);
  const [itemAvgSeries, setItemAvgSeries] = useState<{ name: string; avgPct: number }[]>([]);
  const [quizRows, setQuizRows] = useState<QuizOverviewRow[]>([]);
  const [liveRows, setLiveRows] = useState<LiveOverviewRow[]>([]);
  const [engagement, setEngagement] = useState<EngagementRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const loadCourses = useCallback(async () => {
    const supabase = getBrowserSupabase();
    const { data, error: qErr } = await supabase
      .from('courses')
      .select('id, title')
      .order('created_at', { ascending: false })
      .limit(200);
    if (qErr) {
      setError(qErr.message);
      setCourses([]);
      return;
    }
    setCourses((data ?? []) as CourseRow[]);
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadCourses();
      if (!cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCourses]);

  async function reloadRollups(cid: string) {
    const supabase = getBrowserSupabase();
    const { data, error: qErr } = await supabase
      .from('course_grade_rollups')
      .select('weighted_percent')
      .eq('course_id', cid);
    if (qErr) {
      setError(qErr.message);
      setSeries([]);
      return;
    }
    const rows = (data ?? []) as Rollup[];
    const withPct = rows
      .filter((r) => typeof r.weighted_percent === 'number')
      .slice(0, 40)
      .map((r) => ({
        pct: Number(r.weighted_percent),
      }));
    const sortedAsc = [...withPct].sort((a, b) => a.pct - b.pct).map((row, idx) => ({
      idx: `#${idx + 1}`,
      pct: row.pct,
    }));
    setSeries(sortedAsc);
    setError(null);
  }

  async function reloadItemScores(cid: string) {
    const supabase = getBrowserSupabase();
    const { data, error: qErr } = await supabase
      .from('reporting_grade_course_item_scores')
      .select('grade_item_id, item_title, max_points, score, student_id, category_title, score_updated_at')
      .eq('course_id', cid)
      .order('category_title')
      .order('item_title');
    if (qErr) {
      setError(qErr.message);
      setItemScores([]);
      setItemAvgSeries([]);
      return;
    }
    const rows = (data ?? []) as ItemScoreRow[];
    setItemScores(rows);

    type Acc = { sums: Record<string, { title: string; total: number; count: number; maxPts: number }> };
    const acc: Acc = { sums: {} };
    for (const r of rows) {
      const id = r.grade_item_id;
      const sc = typeof r.score === 'number' ? r.score : null;
      if (sc == null || !Number.isFinite(sc)) continue;
      const mx = typeof r.max_points === 'number' && r.max_points > 0 ? r.max_points : 0;
      if (!mx) continue;
      if (!acc.sums[id]) {
        acc.sums[id] = { title: r.item_title ?? id, total: 0, count: 0, maxPts: mx };
      }
      acc.sums[id].total += Math.min(Math.max(sc, 0), mx) / mx;
      acc.sums[id].count += 1;
    }

    const avgs = Object.entries(acc.sums)
      .map(([gid, v]) => ({
        gid,
        name: v.title.length > 36 ? `${v.title.slice(0, 34)}…` : v.title,
        avgPct: v.count > 0 ? (100 * v.total) / v.count : 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    setItemAvgSeries(avgs);
    setError(null);
  }

  async function reloadQuiz(cid: string) {
    const supabase = getBrowserSupabase();
    const { data, error: qErr } = await supabase
      .from('reporting_quiz_overview')
      .select('*')
      .eq('course_id', cid)
      .order('quiz_title');
    if (qErr) {
      setError(qErr.message);
      setQuizRows([]);
      return;
    }
    setQuizRows((data ?? []) as QuizOverviewRow[]);
    setError(null);
  }

  async function reloadLive(cid: string) {
    const supabase = getBrowserSupabase();
    const { data, error: qErr } = await supabase
      .from('reporting_live_attendance_overview')
      .select('*')
      .eq('course_id', cid)
      .order('started_at', { ascending: false })
      .limit(80);
    if (qErr) {
      setError(qErr.message);
      setLiveRows([]);
      return;
    }
    setLiveRows((data ?? []) as LiveOverviewRow[]);
    setError(null);
  }

  async function reloadEngagement() {
    const supabase = getBrowserSupabase();
    const { data, error: qErr } = await supabase.rpc('admin_course_engagement_7d');
    if (qErr) {
      setError(qErr.message);
      setEngagement([]);
      return;
    }
    setEngagement((data ?? []) as EngagementRow[]);
    setError(null);
  }

  async function refreshEngagement() {
    const supabase = getBrowserSupabase();
    const { error: rErr } = await supabase.rpc('refresh_reporting_course_engagement_7d');
    if (rErr) {
      window.alert(`MV 重整失敗：${rErr.message}`);
      return;
    }
    await reloadEngagement();
  }

  function csvDownload(rows: Record<string, unknown>[], filename: string) {
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push(
        headers
          .map((h) => {
            const v = r[h];
            if (v == null) return '';
            const s = String(v).replace(/"/g, '""');
            return /[,\n"]/.test(s) ? `"${s}"` : s;
          })
          .join(','),
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function enqueueExportJob(kind: string, format: 'csv' | 'xlsx' | 'pdf') {
    if (!courseId && kind !== 'course_engagement') {
      window.alert('請先選課程（除 course_engagement 外）');
      return;
    }
    setExportBusy(true);
    const supabase = getBrowserSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setExportBusy(false);
      window.alert('未登入');
      return;
    }
    const { error: rErr } = await supabase.from('report_export_jobs').insert({
      requested_by: user.id,
      report_kind: kind,
      scope_course_id: kind === 'course_engagement' ? null : courseId,
      format,
    });
    setExportBusy(false);
    if (rErr) {
      window.alert(`匯出任務入列失敗：${rErr.message}`);
      return;
    }
    window.alert('匯出任務已入列；請至「匯出任務」頁查看狀態。');
  }

  async function handleCoursePick(nid: string) {
    setCourseId(nid);
    if (!nid && viewMode !== 'engagement') {
      setSeries([]);
      setItemScores([]);
      setItemAvgSeries([]);
      setQuizRows([]);
      setLiveRows([]);
      return;
    }
    await runViewLoader(viewMode, nid);
  }

  async function runViewLoader(mode: ViewMode, cid: string) {
    if (mode === 'engagement') {
      await reloadEngagement();
      return;
    }
    if (!cid) return;
    if (mode === 'rollup') await reloadRollups(cid);
    else if (mode === 'detail') await reloadItemScores(cid);
    else if (mode === 'quiz') await reloadQuiz(cid);
    else if (mode === 'live') await reloadLive(cid);
  }

  async function handleViewSwitch(next: ViewMode) {
    setViewMode(next);
    await runViewLoader(next, courseId);
  }

  const subtitle = useMemo(() => courses.find((c) => c.id === courseId)?.title ?? '', [courses, courseId]);

  return (
    <RequireAdmin>
      <h1 style={{ marginTop: 0 }}>商用對齊：成績／測驗／互動課堂報表</h1>
      <p style={{ color: '#4b5563', lineHeight: 1.6 }}>
        報表底層為 view／materialized view，RLS 仍由各業務表強制；平台管理員以 admin_* RPC 取得；
        大量匯出請以「入列匯出任務」走非同步 Worker（避免瀏覽器拖慢）。
      </p>
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', marginTop: 20 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontWeight: 700 }}>課程</span>
          <select
            value={courseId}
            onChange={(e) => void handleCoursePick(e.target.value)}
            style={selectStyle}>
            <option value="">請選課…</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontWeight: 700 }}>視圖</span>
          <select value={viewMode} onChange={(e) => void handleViewSwitch(e.target.value as ViewMode)} style={selectStyle}>
            <option value="rollup">成績加權彙總</option>
            <option value="detail">成績項目明細</option>
            <option value="quiz">試卷彙整</option>
            <option value="live">互動課堂簽到</option>
            <option value="engagement">全平台參與度（近 7 日）</option>
          </select>
        </label>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {viewMode === 'engagement' ? (
            <button type="button" onClick={() => void refreshEngagement()} style={primaryBtnStyle}>
              重整 MV
            </button>
          ) : null}
          <button
            type="button"
            disabled={exportBusy || (!courseId && viewMode !== 'engagement')}
            onClick={() => void enqueueExportJob(reportKindOf(viewMode), 'csv')}
            style={{ ...primaryBtnStyle, background: '#0ea5e9', borderColor: '#0ea5e9' }}>
            入列 CSV 匯出
          </button>
          <button
            type="button"
            disabled={exportBusy || (!courseId && viewMode !== 'engagement')}
            onClick={() => void enqueueExportJob(reportKindOf(viewMode), 'xlsx')}
            style={{ ...primaryBtnStyle, background: '#16a34a', borderColor: '#16a34a' }}>
            入列 XLSX 匯出
          </button>
        </div>
      </div>

      {subtitle ? (
        <p style={{ marginTop: 14, fontWeight: 600 }}>
          {subtitle}
        </p>
      ) : null}

      <div style={{ marginTop: 24, padding: 20, borderRadius: 16, border: '1px solid #e5e7eb', background: '#fff' }}>
        {viewMode === 'engagement' ? (
          <EngagementView rows={engagement} csvDownload={csvDownload} />
        ) : !courseId ? (
          <p style={{ color: '#6b7280' }}>請選擇課程。</p>
        ) : viewMode === 'rollup' ? (
          <RollupView series={series} csvDownload={(r) => csvDownload(r, `rollup-${courseId.slice(0, 8)}.csv`)} />
        ) : viewMode === 'detail' ? (
          <DetailView itemScores={itemScores} itemAvgSeries={itemAvgSeries} courseId={courseId} csvDownload={csvDownload} />
        ) : viewMode === 'quiz' ? (
          <QuizView rows={quizRows} courseId={courseId} csvDownload={csvDownload} />
        ) : (
          <LiveView rows={liveRows} courseId={courseId} csvDownload={csvDownload} />
        )}
      </div>
    </RequireAdmin>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid #d1d5db',
  fontSize: 14,
  minWidth: 220,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid #2563eb',
  background: '#2563eb',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
};

function reportKindOf(mode: 'rollup' | 'detail' | 'quiz' | 'live' | 'engagement'): string {
  if (mode === 'rollup') return 'grade_rollups';
  if (mode === 'detail') return 'grade_item_scores';
  if (mode === 'quiz') return 'quiz_overview';
  if (mode === 'live') return 'live_attendance';
  return 'course_engagement';
}

function RollupView({
  series,
  csvDownload,
}: {
  series: { idx: string; pct: number }[];
  csvDownload: (rows: Record<string, unknown>[]) => void;
}) {
  if (series.length === 0) return <p style={{ color: '#6b7280' }}>此課程尚無可用的加權彙總列。</p>;
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ color: '#6b7280', fontSize: 13 }}>注意：以序號呈現並非去識別化保證；正式環境請再做資料最小化／遮罩。</p>
        <button type="button" style={smallBtnStyle} onClick={() => csvDownload(series.map((s) => ({ ...s })))}>
          下載 CSV
        </button>
      </div>
      <div style={{ width: '100%', height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series} margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="4 8" stroke="#e5e7eb" />
            <XAxis dataKey="idx" tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 100]} unit="%" width={52} />
            <Tooltip formatter={(value: number) => [`${value?.toFixed(2)}%`, 'weighted']} />
            <Legend />
            <Bar name="weighted %" dataKey="pct" fill="#2563eb" radius={[8, 8, 2, 2]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function DetailView({
  itemScores,
  itemAvgSeries,
  courseId,
  csvDownload,
}: {
  itemScores: ItemScoreRow[];
  itemAvgSeries: { name: string; avgPct: number }[];
  courseId: string;
  csvDownload: (rows: Record<string, unknown>[], filename: string) => void;
}) {
  if (itemAvgSeries.length === 0) {
    return (
      <p style={{ color: '#6b7280' }}>
        {itemScores.length === 0
          ? '此課程尚無可讀取之項目級分數，或所有列缺 score／max_points。'
          : '無法將分數換算為平均達成率（請確認評分項目有合理 max_points）。'}
      </p>
    );
  }
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ color: '#6b7280', fontSize: 13 }}>
          各評分項目以「(score clamp 至 max)／max」之平均達成率表示；可由「入列 CSV／XLSX 匯出」做大量匯出。
        </p>
        <button
          type="button"
          style={smallBtnStyle}
          onClick={() => csvDownload(itemScores as unknown as Record<string, unknown>[], `item-scores-${courseId.slice(0, 8)}.csv`)}>
          即時 CSV
        </button>
      </div>
      <div style={{ width: '100%', height: 380 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={itemAvgSeries} margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="4 8" stroke="#e5e7eb" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-25} height={90} dx={6} dy={16} />
            <YAxis domain={[0, 100]} unit="%" width={52} />
            <Tooltip formatter={(value: number) => [`${value?.toFixed(2)}%`, 'avg 達成率']} />
            <Legend />
            <Bar name="平均達成率" dataKey="avgPct" fill="#059669" radius={[8, 8, 2, 2]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function QuizView({
  rows,
  courseId,
  csvDownload,
}: {
  rows: QuizOverviewRow[];
  courseId: string;
  csvDownload: (rows: Record<string, unknown>[], filename: string) => void;
}) {
  if (rows.length === 0) return <p style={{ color: '#6b7280' }}>此課程尚無試卷紀錄。</p>;
  const series = rows.map((r) => ({
    name: r.quiz_title.length > 24 ? r.quiz_title.slice(0, 22) + '…' : r.quiz_title,
    avg: r.avg_score ?? 0,
    students: r.submitted_students ?? 0,
  }));
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ color: '#6b7280', fontSize: 13 }}>每張試卷的繳交人數、平均分數。</p>
        <button
          type="button"
          style={smallBtnStyle}
          onClick={() => csvDownload(rows as unknown as Record<string, unknown>[], `quiz-overview-${courseId.slice(0, 8)}.csv`)}>
          即時 CSV
        </button>
      </div>
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series}>
            <CartesianGrid strokeDasharray="4 8" stroke="#e5e7eb" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-25} height={90} dy={16} interval={0} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar name="avg score" dataKey="avg" fill="#7c3aed" />
            <Bar name="繳交人次" dataKey="students" fill="#0ea5e9" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ overflowX: 'auto', marginTop: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <th style={cellStyle}>試卷</th>
              <th style={cellStyle}>人次</th>
              <th style={cellStyle}>繳交 attempt</th>
              <th style={cellStyle}>平均</th>
              <th style={cellStyle}>最高</th>
              <th style={cellStyle}>最低</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.quiz_id}>
                <td style={cellStyle}>{r.quiz_title}</td>
                <td style={cellStyle}>{r.submitted_students ?? 0}</td>
                <td style={cellStyle}>{r.submitted_attempts ?? 0}</td>
                <td style={cellStyle}>{r.avg_score ?? '—'}</td>
                <td style={cellStyle}>{r.max_score ?? '—'}</td>
                <td style={cellStyle}>{r.min_score ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LiveView({
  rows,
  courseId,
  csvDownload,
}: {
  rows: LiveOverviewRow[];
  courseId: string;
  csvDownload: (rows: Record<string, unknown>[], filename: string) => void;
}) {
  if (rows.length === 0) return <p style={{ color: '#6b7280' }}>此課程尚無 live session。</p>;
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ color: '#6b7280', fontSize: 13 }}>每場 live session 的簽到統計。</p>
        <button
          type="button"
          style={smallBtnStyle}
          onClick={() => csvDownload(rows as unknown as Record<string, unknown>[], `live-attendance-${courseId.slice(0, 8)}.csv`)}>
          即時 CSV
        </button>
      </div>
      <div style={{ overflowX: 'auto', marginTop: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <th style={cellStyle}>session</th>
              <th style={cellStyle}>開始</th>
              <th style={cellStyle}>結束</th>
              <th style={cellStyle}>總人次</th>
              <th style={cellStyle}>按時</th>
              <th style={cellStyle}>遲到</th>
              <th style={cellStyle}>缺席</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.session_id}>
                <td style={cellStyle}>{r.session_title || r.session_id.slice(0, 8)}</td>
                <td style={cellStyle}>{new Date(r.started_at).toLocaleString()}</td>
                <td style={cellStyle}>{r.ended_at ? new Date(r.ended_at).toLocaleString() : '—'}</td>
                <td style={cellStyle}>{r.attendance_total ?? 0}</td>
                <td style={cellStyle}>{r.attendance_on_time ?? 0}</td>
                <td style={cellStyle}>{r.attendance_late ?? 0}</td>
                <td style={cellStyle}>{r.attendance_absent ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EngagementView({
  rows,
  csvDownload,
}: {
  rows: EngagementRow[];
  csvDownload: (rows: Record<string, unknown>[], filename: string) => void;
}) {
  if (rows.length === 0) return <p style={{ color: '#6b7280' }}>尚無數據（或 MV 需重整）。</p>;
  const top = rows.slice(0, 30).map((r) => ({
    name: r.course_title.length > 22 ? r.course_title.slice(0, 20) + '…' : r.course_title,
    forum: r.forum_posts_7d,
    quiz: r.quiz_submissions_7d,
    live: r.attendance_7d,
  }));
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ color: '#6b7280', fontSize: 13 }}>近 7 日：討論貼文／作答／簽到，依「總和」由多至少排序。</p>
        <button
          type="button"
          style={smallBtnStyle}
          onClick={() => csvDownload(rows as unknown as Record<string, unknown>[], `course-engagement-7d.csv`)}>
          即時 CSV
        </button>
      </div>
      <div style={{ width: '100%', height: 380 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={top}>
            <CartesianGrid strokeDasharray="4 8" stroke="#e5e7eb" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-25} height={90} dy={16} interval={0} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="forum" name="討論" fill="#0ea5e9" stackId="a" />
            <Bar dataKey="quiz" name="作答" fill="#16a34a" stackId="a" />
            <Bar dataKey="live" name="簽到" fill="#f59e0b" stackId="a" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

const smallBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
};

const cellStyle: React.CSSProperties = {
  padding: 8,
  border: '1px solid #e5e7eb',
  textAlign: 'left',
  fontSize: 12,
};
