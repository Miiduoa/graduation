'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { RequireAdmin } from '@/components/RequireAdmin';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type CourseRow = { id: string; title: string };
type LtiTool = {
  id: string; name: string; client_id: string; issuer: string;
  is_active: boolean; created_at: string;
};
type Rubric = {
  id: string; course_id: string; title: string; description: string;
  bound_kind: string | null; bound_id: string | null;
};
type Meeting = {
  id: string; provider: string; title: string; meeting_url: string;
  starts_at: string; ends_at: string | null;
};
type Livestream = {
  id: string; title: string; status: string; hls_play_url: string | null;
  scheduled_at: string;
};
type Workload = {
  teacher_id: string; course_id: string;
  announcements_authored: number; forum_posts_authored: number;
  submissions_graded: number; essay_manual_scored: number;
  live_sessions_hosted: number;
};

type Tab = 'lti' | 'rubric' | 'meeting' | 'livestream' | 'workload';

export default function Wave6Page() {
  const [tab, setTab] = useState<Tab>('lti');
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [courseId, setCourseId] = useState('');
  const [tools, setTools] = useState<LtiTool[]>([]);
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [livestreams, setLivestreams] = useState<Livestream[]>([]);
  const [workload, setWorkload] = useState<Workload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = getBrowserSupabase();
      const { data } = await supabase
        .from('courses')
        .select('id, title')
        .order('created_at', { ascending: false })
        .limit(200);
      setCourses((data ?? []) as CourseRow[]);
    })();
  }, []);

  const reload = useCallback(async () => {
    const supabase = getBrowserSupabase();
    if (tab === 'lti') {
      const { data, error: e } = await supabase
        .from('lti_tools')
        .select('id, name, client_id, issuer, is_active, created_at')
        .order('created_at', { ascending: false });
      if (e) setError(e.message);
      setTools((data ?? []) as LtiTool[]);
    } else if (tab === 'workload') {
      const { data, error: e } = await supabase.rpc('admin_teacher_workload');
      if (e) setError(e.message);
      setWorkload((data ?? []) as Workload[]);
    } else if (courseId) {
      if (tab === 'rubric') {
        const { data, error: e } = await supabase
          .from('rubrics')
          .select('id, course_id, title, description, bound_kind, bound_id')
          .eq('course_id', courseId);
        if (e) setError(e.message);
        setRubrics((data ?? []) as Rubric[]);
      } else if (tab === 'meeting') {
        const { data, error: e } = await supabase
          .from('course_meetings')
          .select('id, provider, title, meeting_url, starts_at, ends_at')
          .eq('course_id', courseId)
          .order('starts_at', { ascending: false });
        if (e) setError(e.message);
        setMeetings((data ?? []) as Meeting[]);
      } else if (tab === 'livestream') {
        const { data, error: e } = await supabase
          .from('livestream_sessions')
          .select('id, title, status, hls_play_url, scheduled_at')
          .eq('course_id', courseId)
          .order('scheduled_at', { ascending: false });
        if (e) setError(e.message);
        setLivestreams((data ?? []) as Livestream[]);
      }
    }
  }, [tab, courseId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function addLtiTool() {
    const name = window.prompt('工具名稱');
    if (!name) return;
    const issuer = window.prompt('Issuer URL (e.g. https://lms.school.edu)');
    if (!issuer) return;
    const client_id = window.prompt('client_id');
    if (!client_id) return;
    const jwks_url = window.prompt('JWKS URL') || '';
    const auth_login_url = window.prompt('OIDC login URL') || '';
    const auth_token_url = window.prompt('Token URL') || '';
    const deployment_id = window.prompt('deployment_id') || '';
    setBusy(true);
    const supabase = getBrowserSupabase();
    const { error: e } = await supabase.from('lti_tools').insert({
      name, issuer, client_id, jwks_url, auth_login_url, auth_token_url, deployment_id,
    });
    setBusy(false);
    if (e) { window.alert(e.message); return; }
    setInfo('LTI 工具新增成功');
    void reload();
  }

  async function addRubric() {
    if (!courseId) { window.alert('請先選課'); return; }
    const title = window.prompt('Rubric 名稱');
    if (!title) return;
    setBusy(true);
    const supabase = getBrowserSupabase();
    const { error: e } = await supabase.from('rubrics').insert({ course_id: courseId, title });
    setBusy(false);
    if (e) { window.alert(e.message); return; }
    setInfo('Rubric 新增成功');
    void reload();
  }

  async function addMeeting() {
    if (!courseId) return;
    const title = window.prompt('會議標題');
    if (!title) return;
    const url = window.prompt('會議 URL（Zoom/Teams/Meet/BBB）');
    if (!url) return;
    const when = window.prompt('開始時間 ISO 例 2026-06-01T10:00:00+08:00');
    if (!when) return;
    const provider = window.prompt('provider (zoom/teams/bbb/webex/google_meet/other)', 'zoom') || 'other';
    setBusy(true);
    const supabase = getBrowserSupabase();
    const { error: e } = await supabase.from('course_meetings').insert({
      course_id: courseId, provider, title, meeting_url: url, starts_at: when,
    });
    setBusy(false);
    if (e) { window.alert(e.message); return; }
    setInfo('會議新增成功');
    void reload();
  }

  async function addLivestream() {
    if (!courseId) return;
    const title = window.prompt('直播標題');
    if (!title) return;
    const hls = window.prompt('HLS 播放 URL（m3u8）') || '';
    const when = window.prompt('排定時間 ISO');
    if (!when) return;
    setBusy(true);
    const supabase = getBrowserSupabase();
    const { error: e } = await supabase.from('livestream_sessions').insert({
      course_id: courseId, title, hls_play_url: hls, scheduled_at: when,
    });
    setBusy(false);
    if (e) { window.alert(e.message); return; }
    setInfo('直播排程已新增');
    void reload();
  }

  const subtitle = useMemo(() => courses.find((c) => c.id === courseId)?.title ?? '', [courses, courseId]);

  return (
    <RequireAdmin>
      <h1 style={{ marginTop: 0 }}>商用核心模組（Wave 6）</h1>
      <p style={{ color: '#4b5563', lineHeight: 1.6 }}>
        LTI 1.3／Rubric／會議整合／直播課程／教師工作量；對應 migration 20260520140000–140200。
      </p>
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      {info ? <p style={{ color: '#059669' }}>{info}</p> : null}

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>課程（LTI／工作量不需）</span>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} style={selectStyle}>
            <option value="">請選課…</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['lti', 'rubric', 'meeting', 'livestream', 'workload'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{ ...tabBtn, background: tab === t ? '#2563eb' : '#fff', color: tab === t ? '#fff' : '#111827' }}>
              {labelOf(t)}
            </button>
          ))}
        </div>
      </div>

      {subtitle ? <p style={{ marginTop: 12, fontWeight: 600 }}>{subtitle}</p> : null}

      <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 }}>
        {tab === 'lti' ? (
          <>
            <button type="button" onClick={() => void addLtiTool()} disabled={busy} style={primaryBtn}>新增 LTI 1.3 工具</button>
            <ul style={{ marginTop: 12, padding: 0, listStyle: 'none' }}>
              {tools.map((t) => (
                <li key={t.id} style={listItem}>
                  <strong>{t.name}</strong>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    issuer: {t.issuer}｜client_id: {t.client_id}｜active: {t.is_active ? 'Y' : 'N'}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : tab === 'rubric' ? (
          <>
            <button type="button" onClick={() => void addRubric()} disabled={busy || !courseId} style={primaryBtn}>新增 Rubric</button>
            <ul style={{ marginTop: 12, padding: 0, listStyle: 'none' }}>
              {rubrics.map((r) => (
                <li key={r.id} style={listItem}>
                  <strong>{r.title}</strong>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{r.description || '—'}</div>
                </li>
              ))}
            </ul>
          </>
        ) : tab === 'meeting' ? (
          <>
            <button type="button" onClick={() => void addMeeting()} disabled={busy || !courseId} style={primaryBtn}>新增會議</button>
            <ul style={{ marginTop: 12, padding: 0, listStyle: 'none' }}>
              {meetings.map((m) => (
                <li key={m.id} style={listItem}>
                  <strong>{m.title}</strong>（{m.provider}）
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {new Date(m.starts_at).toLocaleString()} ｜ <a href={m.meeting_url} target="_blank" rel="noreferrer">URL</a>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : tab === 'livestream' ? (
          <>
            <button type="button" onClick={() => void addLivestream()} disabled={busy || !courseId} style={primaryBtn}>排程直播</button>
            <ul style={{ marginTop: 12, padding: 0, listStyle: 'none' }}>
              {livestreams.map((ls) => (
                <li key={ls.id} style={listItem}>
                  <strong>{ls.title}</strong>（{ls.status}）
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {new Date(ls.scheduled_at).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f3f4f6' }}>
                  <th style={cellStyle}>teacher_id</th>
                  <th style={cellStyle}>course_id</th>
                  <th style={cellStyle}>公告</th>
                  <th style={cellStyle}>論壇</th>
                  <th style={cellStyle}>批改</th>
                  <th style={cellStyle}>essay 複閱</th>
                  <th style={cellStyle}>主持 live</th>
                </tr>
              </thead>
              <tbody>
                {workload.map((w) => (
                  <tr key={`${w.teacher_id}-${w.course_id}`}>
                    <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: 11 }}>{w.teacher_id}</td>
                    <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: 11 }}>{w.course_id}</td>
                    <td style={cellStyle}>{w.announcements_authored}</td>
                    <td style={cellStyle}>{w.forum_posts_authored}</td>
                    <td style={cellStyle}>{w.submissions_graded}</td>
                    <td style={cellStyle}>{w.essay_manual_scored}</td>
                    <td style={cellStyle}>{w.live_sessions_hosted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </RequireAdmin>
  );
}

function labelOf(t: Tab): string {
  if (t === 'lti') return 'LTI 工具';
  if (t === 'rubric') return 'Rubric';
  if (t === 'meeting') return '會議';
  if (t === 'livestream') return '直播';
  return '工作量';
}

const selectStyle: React.CSSProperties = { padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14, minWidth: 220 };
const tabBtn: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: '1px solid #d1d5db', fontWeight: 700, cursor: 'pointer' };
const primaryBtn: React.CSSProperties = { padding: '10px 14px', borderRadius: 10, border: '1px solid #2563eb', background: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer' };
const listItem: React.CSSProperties = { padding: 12, border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 8 };
const cellStyle: React.CSSProperties = { padding: 8, border: '1px solid #e5e7eb', textAlign: 'left' };
